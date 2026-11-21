import { useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { PageRuntime } from '../../packages/runtime/engine';
import type { RuntimeDomEnvironment } from '../ui/runtime-dom';
import { useDragDrop } from './DragDrop';
import { CanvasDocumentHost } from './CanvasDocumentHost';
import { CanvasFrameSurface, useViewportMetrics } from './CanvasViewport';
import { registerCanvasBoundary } from './coordinates';
import { useEditorNavigation } from './session';

type Reason = 'retire' | 'binding' | 'takeover';
type Context = { document: EditorDocument; snapshot: EditorSnapshot; runtime: PageRuntime | null };
export const useCanvasStage = () => useDragDrop()?.stage;
/** Attachment only. The existing document/runtime/navigation own every author operation. */
export class CanvasStage {
  context!: Context;
  environment: RuntimeDomEnvironment | null = null;
  author: HTMLDivElement | null = null;
  overlay: HTMLDivElement | null = null;
  parent: HTMLDivElement | null = null;
  setParent = (element: HTMLDivElement | null) => {
    this.parent = element;
  };
  setOverlay = (element: HTMLDivElement | null) => {
    this.overlay = element;
  };
  private version = 0;
  private listeners = new Set<() => void>();
  private invalidators = new Set<(reason: Reason) => void>();
  private unregister = () => {};
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.version;
  publish = () => {
    this.version++;
    this.listeners.forEach((listener) => listener());
  };
  onInvalidate = (listener: (reason: Reason) => void) => {
    this.invalidators.add(listener);
    return () => {
      this.invalidators.delete(listener);
    };
  };
  invalidate = (reason: Reason) => {
    this.invalidators.forEach((listener) => listener(reason));
  };
  platform() {
    try {
      const environment = this.environment;
      const frame = environment?.document.defaultView?.frameElement as HTMLIFrameElement | null;
      return environment?.isCurrent() &&
        frame?.isConnected &&
        this.parent?.contains(frame) &&
        frame.ownerDocument === this.parent.ownerDocument &&
        frame.contentDocument === environment.document &&
        environment.portalRoot.ownerDocument === environment.document &&
        environment.portalRoot.isConnected
        ? { environment, frame }
        : undefined;
    } catch {
      return undefined;
    }
  }
  runtimeEnvironment() {
    const { document, snapshot, runtime } = this.context;
    const actual = document.getSnapshot();
    return actual.plan === snapshot.plan &&
      actual.selection.pageId === snapshot.selection.pageId &&
      runtime &&
      !runtime.disposed &&
      runtime.plan === actual.plan &&
      runtime.page.schema.id === actual.selection.pageId &&
      !runtime.page.schema.code?.enabled
      ? (this.platform()?.environment ?? null)
      : null;
  }
  current() {
    const platform = this.platform(),
      author = this.author,
      overlay = this.overlay;
    for (
      let ancestor: HTMLElement | null = platform?.frame ?? null;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = ancestor.ownerDocument.defaultView!.getComputedStyle(ancestor);
      if (
        ancestor.hidden ||
        ancestor.hasAttribute('inert') ||
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      )
        return undefined;
    }
    return platform &&
      this.runtimeEnvironment() &&
      author?.isConnected &&
      overlay?.isConnected &&
      author.ownerDocument === platform.environment.document &&
      platform.environment.document.getElementById('canvas-content')?.contains(author)
      ? { ...platform, author, overlay }
      : undefined;
  }
  focused(host: HTMLElement) {
    const current = this.current();
    if (
      !current ||
      current.author !== host ||
      current.frame.ownerDocument.activeElement !== current.frame
    )
      return false;
    const active = current.environment.document.activeElement;
    return active === host || active === current.environment.document.body || active === null;
  }
  setAuthor = (author: HTMLDivElement | null) => {
    if (this.author === author) return;
    this.author = author;
    this.publish();
  };
  attach = (environment: RuntimeDomEnvironment | null) => {
    if (this.environment === environment) return;
    this.environment = environment;
    this.unregister();
    this.invalidate('retire');
    const platform = this.platform();
    if (platform && this.parent)
      this.unregister = registerCanvasBoundary({
        document: platform.environment.document,
        frame: platform.frame,
        parent: this.parent,
        isCurrent: () => !!this.current(),
      });
    this.publish();
  };
}
export function CanvasStageFrame({
  stage,
  mode,
  children,
}: {
  stage?: CanvasStage;
  mode: 'edit' | 'preview';
  children: ReactNode;
}) {
  const metrics = useViewportMetrics()!;
  const { navigation } = useEditorNavigation();
  const owner = stage?.context.document;
  const page = stage?.context.snapshot.selection.pageId;
  const lifetime = useRef({ owner, page, key: 0 });
  if (lifetime.current.owner !== owner || lifetime.current.page !== page)
    lifetime.current = { owner, page, key: lifetime.current.key + 1 };
  useLayoutEffect(() => {
    if (!stage || !owner) return;
    const parent = stage.parent!.ownerDocument;
    const cancelOwner = () => {
      navigation.cancelDeletionFocus('canvas', owner);
      navigation.cancelHistoryFocus('canvas', owner);
      navigation.retireClipboardPasteForCommand(owner, 'canvas');
    };
    const takeover = (event: Event) => {
      if (stage.context.document !== owner || stage.context.snapshot.selection.pageId !== page)
        return;
      const platform = stage.platform();
      if (platform && event.target === platform.frame) return;
      cancelOwner();
      stage.invalidate('takeover');
    };
    const retire = stage.onInvalidate((reason) => {
      if (reason === 'retire') cancelOwner();
    });
    parent.addEventListener('focusin', takeover, true);
    parent.addEventListener('pointerdown', takeover, true);
    return () => {
      cancelOwner();
      retire();
      parent.removeEventListener('focusin', takeover, true);
      parent.removeEventListener('pointerdown', takeover, true);
    };
  }, [stage, navigation, owner, page]);
  return !stage ? (
    children
  ) : (
    <div className="canvas-stage-frame" ref={stage.setParent}>
      <CanvasFrameSurface>
        <CanvasDocumentHost
          pageKey={String(lifetime.current.key)}
          width={metrics.width}
          height={metrics.measured ? Math.max(240, metrics.availableHeight) : 600}
          onEnvironmentChange={stage.attach}
        >
          {children}
        </CanvasDocumentHost>
      </CanvasFrameSurface>
      <div className={`editor-canvas canvas-stage-editor-ui ${mode}`} ref={stage.setOverlay} />
    </div>
  );
}
export function useCanvasStageVersion(stage: CanvasStage | undefined) {
  return useSyncExternalStore(
    stage?.subscribe ?? (() => () => {}),
    stage?.getSnapshot ?? (() => 0),
    () => 0,
  );
}
