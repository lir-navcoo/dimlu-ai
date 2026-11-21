import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { findNode } from '../../packages/editor/document';
import type { ApplicationPlan } from '../../packages/runtime/engine';
import type { ClipboardSummary } from '../../packages/editor/node-clipboard';
import {
  matchesPasteResult,
  matchesKeyboardPasteSnapshot,
  type ClipboardOperationWitness,
} from './clipboard-operation';

export type NavigationTarget = { pageId: string; nodeId: string; instanceKey?: string };
export type HoverSource = 'canvas' | 'tree' | 'breadcrumb';
export type NavigationEnvironment = {
  document: EditorDocument;
  plan: ApplicationPlan;
  pageId: string;
  enabled: boolean;
  dragging: boolean;
};
export type LocateRequest = NavigationTarget & {
  sequence: number;
  destination: 'canvas' | 'tree';
  document: EditorDocument;
  plan: ApplicationPlan;
  selection: ReturnType<EditorDocument['getSnapshot']>['selection'];
};
export type NavigationSnapshot = {
  enabled: boolean;
  hover: (NavigationTarget & { source: HoverSource }) | null;
  request: LocateRequest | null;
  message: string;
  selectedInstance: NavigationTarget | null;
};
type KeyboardFocusOrigin = 'delete' | 'history' | 'clipboard-paste';
export type ClipboardRuntimeWitness = {
  plan: ApplicationPlan;
  page: { schema: { id: string } };
  disposed: boolean;
};
export type ClipboardTreeWitness = {
  active: boolean;
  query?: string;
  closed?: readonly string[];
  host: HTMLElement | null;
};
export type ClipboardPasteReservation = ClipboardOperationWitness & {
  operationOwner: object;
  document: EditorDocument;
  domain: 'canvas' | 'tree';
  host: HTMLElement;
  originFocus: HTMLElement;
  canvasRuntime?: ClipboardRuntimeWitness;
  treeQuery?: string;
  treeClosed?: readonly string[];
  treeContext?: ClipboardTreeWitness;
  active: boolean;
  executing: boolean;
  documents: number;
  clipboards: number;
  candidate?: EditorSnapshot;
};
type ClipboardFocus = {
  operationOwner: object;
  clipboard: Readonly<ClipboardSummary>;
  canvasRuntime?: ClipboardRuntimeWitness;
  treeQuery?: string;
  treeClosed?: readonly string[];
  treeHost: HTMLElement;
  treeContext?: ClipboardTreeWitness;
};
type KeyboardFocusIntent = {
  origin: KeyboardFocusOrigin;
  document: EditorDocument;
  snapshot: EditorSnapshot;
  domain: 'canvas' | 'tree';
  originFocus: HTMLElement;
  owner: Document;
  cleanup: () => void;
  clipboard?: ClipboardFocus;
  restored?: boolean;
  restorationTarget?: HTMLElement;
};
/** Ephemeral editor interaction only. Never writes a document or business runtime. */
export class EditorNavigation {
  private environment: NavigationEnvironment | null = null;
  private sequence = 0;
  private keyboardFocus: KeyboardFocusIntent | null = null;
  private clipboardReservation: ClipboardPasteReservation | null = null;
  private keyboardPresentation: {
    origin: KeyboardFocusOrigin;
    document: EditorDocument;
    snapshot: EditorSnapshot;
    operationOwner?: object;
  } | null = null;
  private canvasContext: Pick<NavigationEnvironment, 'document' | 'plan' | 'pageId'> | null = null;
  private snapshot: NavigationSnapshot = {
    enabled: false,
    hover: null,
    request: null,
    message: '',
    selectedInstance: null,
  };
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(next: NavigationSnapshot) {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
  bind = (next: NavigationEnvironment) => {
    const reservation = this.clipboardReservation;
    if (
      reservation &&
      (!this.clipboardEnvironment(
        next,
        reservation.document,
        reservation.initial.selection.pageId,
      ) ||
        !this.reservationCandidate(reservation, reservation.document.getSnapshot(), true))
    )
      this.releaseClipboardPastePresentation(reservation.operationOwner);
    const clipboardIntent = this.keyboardFocus;
    if (
      clipboardIntent?.clipboard &&
      (!this.clipboardEnvironment(
        next,
        clipboardIntent.document,
        clipboardIntent.snapshot.selection.pageId,
      ) ||
        clipboardIntent.document.getSnapshot().plan !== clipboardIntent.snapshot.plan ||
        clipboardIntent.document.getSnapshot().selection !== clipboardIntent.snapshot.selection ||
        clipboardIntent.document.getClipboardSnapshot() !== clipboardIntent.clipboard.clipboard)
    )
      this.cancelClipboardPasteFocus(
        clipboardIntent.clipboard.operationOwner,
        clipboardIntent.domain,
        clipboardIntent.document,
      );
    if (
      this.keyboardPresentation &&
      !this.isKeyboardPresentation(next.document, next.document.getSnapshot())
    )
      this.keyboardPresentation = null;
    const pending = this.keyboardFocus;
    if (
      pending &&
      (!next.enabled ||
        next.dragging ||
        next.document !== pending.document ||
        next.pageId !== pending.snapshot.selection.pageId)
    )
      this.cancelKeyboardFocus();
    const previous = this.environment;
    this.environment = next;
    if (
      !next.enabled ||
      (previous && (previous.document !== next.document || previous.pageId !== next.pageId))
    )
      this.canvasContext = null;
    if (
      !previous ||
      previous.document !== next.document ||
      previous.plan !== next.plan ||
      previous.pageId !== next.pageId ||
      previous.enabled !== next.enabled ||
      previous.dragging !== next.dragging
    ) {
      this.publish({
        enabled: next.enabled && !next.dragging,
        hover: null,
        request: null,
        message: '',
        selectedInstance: null,
      });
    } else if (this.snapshot.request && !this.isCurrent(this.snapshot.request)) {
      this.publish({ ...this.snapshot, request: null });
    }
  };
  private cancelKeyboardFocus = (
    origin?: KeyboardFocusOrigin,
    domain?: 'canvas' | 'tree',
    document?: EditorDocument,
  ) => {
    const pending = this.keyboardFocus;
    if (
      (origin && pending?.origin !== origin) ||
      (domain && pending?.domain !== domain) ||
      (document && pending?.document !== document)
    )
      return;
    this.keyboardFocus = null;
    pending?.cleanup();
    if (
      pending?.clipboard &&
      this.keyboardPresentation?.operationOwner === pending.clipboard.operationOwner
    )
      this.keyboardPresentation = null;
  };
  cancelDeletionFocus = (domain?: 'canvas' | 'tree', document?: EditorDocument) => {
    this.cancelKeyboardFocus('delete', domain, document);
  };
  cancelHistoryFocus = (domain?: 'canvas' | 'tree', document?: EditorDocument) => {
    this.cancelKeyboardFocus('history', domain, document);
  };
  resetKeyboardInteraction = () => {
    if (this.clipboardReservation)
      this.releaseClipboardPastePresentation(this.clipboardReservation.operationOwner);
    this.cancelKeyboardFocus();
    this.keyboardPresentation = null;
  };
  /** Legacy full-session reset alias; origin-specific consumers use their cancel method. */
  resetDeletionInteraction = () => this.resetKeyboardInteraction();
  isKeyboardPresentation = (document: EditorDocument, snapshot: EditorSnapshot) => {
    const reservation = this.clipboardReservation;
    if (reservation?.document === document && this.reservationCandidate(reservation, snapshot))
      return true;
    const marker = this.keyboardPresentation;
    return (
      !!marker &&
      marker.document === document &&
      marker.snapshot.plan === snapshot.plan &&
      marker.snapshot.selection === snapshot.selection
    );
  };
  isDeletionPresentation = (document: EditorDocument, snapshot: EditorSnapshot) =>
    this.keyboardPresentation?.origin === 'delete' &&
    this.isKeyboardPresentation(document, snapshot);
  /** One resulting canvas remount may consume this; other interaction expires it. */
  private requestKeyboardFocus = (
    origin: KeyboardFocusOrigin,
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    originFocus: HTMLElement,
    clipboard?: ClipboardFocus,
  ) => {
    this.cancelKeyboardFocus();
    this.keyboardPresentation = {
      origin,
      document,
      snapshot,
      ...(clipboard ? { operationOwner: clipboard.operationOwner } : {}),
    };
    const owner = originFocus.ownerDocument;
    const intent: KeyboardFocusIntent = {
      origin,
      document,
      snapshot,
      domain,
      originFocus,
      owner,
      cleanup: () => {},
      clipboard,
    };
    const cancel = () => {
      if (this.keyboardFocus === intent) this.cancelKeyboardFocus(origin);
    };
    const invalidate = () => {
      const actual = document.getSnapshot();
      if (clipboard || actual.plan !== snapshot.plan || actual.selection !== snapshot.selection)
        cancel();
    };
    const focus = (event: FocusEvent) => {
      if (
        clipboard && intent.restored
          ? event.target !== intent.restorationTarget
          : event.target !== originFocus && event.target !== owner.body
      )
        cancel();
    };
    const pointer = (event: PointerEvent) => {
      const currentOrigin = clipboard && intent.restored ? intent.restorationTarget : originFocus;
      const view = owner.defaultView;
      if (
        !view ||
        !(event.target instanceof view.Node) ||
        event.target.ownerDocument !== owner ||
        !currentOrigin?.contains(event.target)
      )
        cancel();
    };
    const unsubscribe = document.subscribe(invalidate);
    const unsubscribeClipboard = clipboard ? document.subscribeClipboard(cancel) : () => {};
    owner.addEventListener('focusin', focus, true);
    owner.addEventListener('pointerdown', pointer, true);
    intent.cleanup = () => {
      unsubscribe();
      unsubscribeClipboard();
      owner.removeEventListener('focusin', focus, true);
      owner.removeEventListener('pointerdown', pointer, true);
    };
    this.keyboardFocus = intent;
    this.publish({ ...this.snapshot });
  };
  requestDeletionFocus = (
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    originFocus: HTMLElement,
  ) => this.requestKeyboardFocus('delete', document, snapshot, domain, originFocus);
  requestHistoryFocus = (
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    originFocus: HTMLElement,
  ) => this.requestKeyboardFocus('history', document, snapshot, domain, originFocus);
  private clipboardEnvironment = (
    env: NavigationEnvironment | null,
    document: EditorDocument,
    pageId: string,
  ) => !!env && env.document === document && env.pageId === pageId && env.enabled && !env.dragging;
  private reservationCandidate = (
    reservation: ClipboardPasteReservation,
    snapshot: EditorSnapshot,
    initialAllowed = false,
  ) => {
    if (
      !reservation.active ||
      !reservation.executing ||
      reservation.documents > 1 ||
      reservation.clipboards !== 0 ||
      reservation.document.getClipboardSnapshot() !== reservation.clipboard ||
      !this.clipboardEnvironment(
        this.environment,
        reservation.document,
        reservation.initial.selection.pageId,
      ) ||
      (reservation.domain === 'tree' &&
        (!reservation.treeContext?.active ||
          reservation.treeContext.host !== reservation.host ||
          reservation.treeContext.query !== reservation.treeQuery ||
          reservation.treeContext.closed !== reservation.treeClosed))
    )
      return false;
    const actual = reservation.document.getSnapshot();
    if (snapshot.plan !== actual.plan || snapshot.selection !== actual.selection) return false;
    if (
      initialAllowed &&
      snapshot.plan === reservation.initial.plan &&
      snapshot.selection === reservation.initial.selection
    )
      return !reservation.candidate;
    return (
      matchesKeyboardPasteSnapshot(snapshot, reservation) &&
      (!reservation.candidate || reservation.candidate === snapshot)
    );
  };
  reserveClipboardPastePresentation = (reservation: ClipboardPasteReservation) => {
    if (
      this.clipboardReservation ||
      !reservation.active ||
      !this.clipboardEnvironment(
        this.environment,
        reservation.document,
        reservation.initial.selection.pageId,
      ) ||
      reservation.document.getSnapshot() !== reservation.initial ||
      reservation.document.getClipboardSnapshot() !== reservation.clipboard
    )
      return false;
    this.clipboardReservation = reservation;
    return true;
  };
  releaseClipboardPastePresentation = (operationOwner: object) => {
    if (this.clipboardReservation?.operationOwner !== operationOwner) return;
    this.clipboardReservation.active = false;
    this.clipboardReservation = null;
  };
  requestClipboardPasteFocus = (
    reservation: ClipboardPasteReservation,
    result: { snapshot: EditorSnapshot; ids: string[] },
  ) => {
    const focus = reservation.originFocus.ownerDocument.activeElement;
    if (
      this.clipboardReservation !== reservation ||
      !this.reservationCandidate(reservation, result.snapshot) ||
      reservation.documents !== 1 ||
      reservation.clipboards !== 0 ||
      reservation.candidate !== result.snapshot ||
      !matchesPasteResult(result.snapshot, reservation, result.ids) ||
      (focus !== reservation.originFocus &&
        focus !== reservation.originFocus.ownerDocument.body &&
        focus !== null)
    )
      return false;
    this.clipboardReservation = null;
    reservation.active = false;
    this.requestKeyboardFocus(
      'clipboard-paste',
      reservation.document,
      result.snapshot,
      reservation.domain,
      reservation.originFocus,
      {
        operationOwner: reservation.operationOwner,
        clipboard: reservation.clipboard,
        canvasRuntime: reservation.canvasRuntime,
        treeQuery: reservation.treeQuery,
        treeClosed: reservation.treeClosed,
        treeHost: reservation.host,
        treeContext: reservation.treeContext,
      },
    );
    return this.keyboardFocus?.clipboard?.operationOwner === reservation.operationOwner;
  };
  clipboardPasteFocusOwner = (
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
  ) => {
    const intent = this.keyboardFocus;
    return intent?.clipboard &&
      intent.document === document &&
      intent.domain === domain &&
      intent.snapshot.plan === snapshot.plan &&
      intent.snapshot.selection === snapshot.selection
      ? intent.clipboard.operationOwner
      : null;
  };
  cancelClipboardPasteFocus = (
    operationOwner: object,
    domain: 'canvas' | 'tree',
    document: EditorDocument,
  ) => {
    const reservation = this.clipboardReservation;
    if (
      reservation?.operationOwner === operationOwner &&
      reservation.domain === domain &&
      reservation.document === document
    )
      this.releaseClipboardPastePresentation(operationOwner);
    const intent = this.keyboardFocus;
    if (
      intent?.clipboard?.operationOwner === operationOwner &&
      intent.domain === domain &&
      intent.document === document
    )
      this.cancelKeyboardFocus('clipboard-paste', domain, document);
  };
  /** Private receipt retirement only: no publish or reentrant user callbacks. */
  retireClipboardPasteForCommand = (document: EditorDocument, domain: 'canvas' | 'tree') => {
    const intent = this.keyboardFocus;
    if (intent?.clipboard && intent.document === document && intent.domain === domain)
      this.cancelClipboardPasteFocus(intent.clipboard.operationOwner, domain, document);
    const reservation = this.clipboardReservation;
    if (reservation?.document === document && reservation.domain === domain)
      this.releaseClipboardPastePresentation(reservation.operationOwner);
  };
  restoreClipboardPasteFocus = (
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    target: HTMLElement,
    context: {
      canvasRuntime?: ClipboardRuntimeWitness;
      treeQuery?: string;
      treeClosed?: readonly string[];
      treeHost?: HTMLElement;
    },
  ) => {
    const intent = this.keyboardFocus;
    const owner = this.clipboardPasteFocusOwner(document, snapshot, domain);
    if (!owner || !intent?.clipboard || intent.restored) return null;
    const source = intent.clipboard;
    const actual = document.getSnapshot();
    if (
      !this.clipboardEnvironment(this.environment, document, snapshot.selection.pageId) ||
      actual.plan !== snapshot.plan ||
      actual.selection !== snapshot.selection ||
      document.getClipboardSnapshot() !== source.clipboard ||
      !this.clipboardTargetOwned(intent, target) ||
      (domain === 'tree' &&
        (source.treeHost !== context.treeHost ||
          source.treeQuery !== context.treeQuery ||
          source.treeClosed !== context.treeClosed ||
          !this.clipboardTreeCurrent(source)))
    ) {
      this.cancelClipboardPasteFocus(owner, domain, document);
      return null;
    }
    if (
      domain === 'canvas' &&
      (!source.canvasRuntime ||
        !context.canvasRuntime ||
        source.canvasRuntime === context.canvasRuntime ||
        !source.canvasRuntime.disposed ||
        context.canvasRuntime.disposed ||
        context.canvasRuntime.plan !== snapshot.plan ||
        context.canvasRuntime.page.schema.id !== snapshot.selection.pageId)
    )
      return null;
    this.restoreKeyboardFocus('clipboard-paste', document, snapshot, domain, target);
    if (
      this.keyboardFocus === intent &&
      intent.restored &&
      domain === 'canvas' &&
      (!source.canvasRuntime?.disposed ||
        !context.canvasRuntime ||
        context.canvasRuntime.disposed ||
        context.canvasRuntime.plan !== snapshot.plan ||
        context.canvasRuntime.page.schema.id !== snapshot.selection.pageId)
    )
      this.cancelClipboardPasteFocus(owner, domain, document);
    return this.keyboardFocus === intent &&
      intent.restored &&
      target.ownerDocument.activeElement === target
      ? owner
      : null;
  };
  private clipboardTreeCurrent = (source: ClipboardFocus) =>
    !!source.treeContext?.active &&
    source.treeContext.host === source.treeHost &&
    source.treeContext.query === source.treeQuery &&
    source.treeContext.closed === source.treeClosed;
  private clipboardTargetOwned = (intent: KeyboardFocusIntent, target: HTMLElement) => {
    if (
      !intent.clipboard ||
      !this.clipboardTargetVisible(target) ||
      target.matches(':disabled,[aria-disabled="true"]') ||
      target.isContentEditable
    )
      return false;
    if (intent.domain === 'canvas') return target.matches('.editor-canvas.edit');
    const host = intent.clipboard.treeHost;
    if (target === host) return true;
    return (
      host.contains(target) &&
      target.closest('.component-tree') === host &&
      target.matches('.tree-select') &&
      target.closest<HTMLElement>('[data-editor-tree-node]')?.dataset.editorTreeNode ===
        intent.snapshot.selection.nodeId
    );
  };
  private clipboardTargetVisible = (target: HTMLElement) => {
    if (!target.isConnected) return false;
    for (let element: HTMLElement | null = target; element; element = element.parentElement) {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      if (
        element.hidden ||
        element.hasAttribute('inert') ||
        style?.display === 'none' ||
        style?.visibility === 'hidden' ||
        style?.visibility === 'collapse'
      )
        return false;
    }
    return true;
  };
  private restoreKeyboardFocus = (
    origin: KeyboardFocusOrigin,
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    target: HTMLElement,
  ) => {
    const intent = this.keyboardFocus;
    if (
      !intent ||
      intent.origin !== origin ||
      intent.domain !== domain ||
      intent.document !== document ||
      intent.snapshot.plan !== snapshot.plan ||
      intent.snapshot.selection !== snapshot.selection
    )
      return;
    if (intent.clipboard && intent.restored) return;
    const actual = document.getSnapshot();
    if (
      actual.plan !== snapshot.plan ||
      actual.selection !== snapshot.selection ||
      !target.isConnected ||
      target.ownerDocument !== intent.owner ||
      (intent.owner.activeElement !== intent.originFocus &&
        intent.owner.activeElement !== intent.owner.body &&
        intent.owner.activeElement !== null)
    ) {
      this.cancelKeyboardFocus(origin);
      return;
    }
    if (intent.clipboard) {
      intent.restored = true;
      intent.restorationTarget = target;
      try {
        target.focus({ preventScroll: true });
      } catch {
        this.cancelClipboardPasteFocus(intent.clipboard.operationOwner, domain, document);
        return;
      }
      const current = document.getSnapshot();
      if (
        this.keyboardFocus !== intent ||
        !this.clipboardTargetOwned(intent, target) ||
        target.ownerDocument.activeElement !== target ||
        current.plan !== snapshot.plan ||
        current.selection !== snapshot.selection ||
        document.getClipboardSnapshot() !== intent.clipboard.clipboard ||
        !this.clipboardEnvironment(this.environment, document, snapshot.selection.pageId) ||
        (domain === 'tree' && !this.clipboardTreeCurrent(intent.clipboard))
      )
        this.cancelClipboardPasteFocus(intent.clipboard.operationOwner, domain, document);
    } else {
      this.cancelKeyboardFocus(origin);
      target.focus({ preventScroll: true });
    }
  };
  restoreDeletionFocus = (
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    target: HTMLElement,
  ) => this.restoreKeyboardFocus('delete', document, snapshot, domain, target);
  restoreHistoryFocus = (
    document: EditorDocument,
    snapshot: EditorSnapshot,
    domain: 'canvas' | 'tree',
    target: HTMLElement,
  ) => this.restoreKeyboardFocus('history', document, snapshot, domain, target);
  /** Survives the loading gap while a committed plan replaces the Canvas component. */
  enterCanvas = (context: Pick<NavigationEnvironment, 'document' | 'plan' | 'pageId'>) => {
    const previous = this.canvasContext;
    this.canvasContext = this.environment?.enabled ? context : null;
    return (
      !!previous &&
      !!this.environment?.enabled &&
      previous.document === context.document &&
      previous.pageId === context.pageId &&
      previous.plan !== context.plan
    );
  };
  private available(nodeId: string, pageId = this.environment?.pageId) {
    const env = this.environment;
    if (!env || !env.enabled || env.dragging || pageId !== env.pageId) return false;
    const live = env.document.getSnapshot();
    return (
      live.plan === env.plan &&
      live.selection.pageId === pageId &&
      !!findNode(env.plan.pages.get(pageId!)!.schema, nodeId)
    );
  }
  setHover = (target: NavigationTarget, source: HoverSource) => {
    if (!this.available(target.nodeId, target.pageId)) return;
    const current = this.snapshot.hover;
    if (
      current?.source === source &&
      current.pageId === target.pageId &&
      current.nodeId === target.nodeId &&
      current.instanceKey === target.instanceKey
    )
      return;
    this.publish({ ...this.snapshot, hover: { ...target, source } });
  };
  clearHover = (source?: HoverSource, target?: NavigationTarget) => {
    const current = this.snapshot.hover;
    if (
      !current ||
      (source && current.source !== source) ||
      (target &&
        (current.pageId !== target.pageId ||
          current.nodeId !== target.nodeId ||
          current.instanceKey !== target.instanceKey))
    )
      return;
    this.publish({ ...this.snapshot, hover: null });
  };
  setSelectedInstance = (target: NavigationTarget) => {
    if (this.available(target.nodeId, target.pageId))
      this.publish({ ...this.snapshot, selectedInstance: target });
  };
  requestLocate = (
    destination: LocateRequest['destination'],
    nodeId: string,
    instanceKey?: string,
  ): boolean => this.requestLocateOwned(destination, nodeId, instanceKey) !== null;
  /** Returns this invocation's request even if an observer publishes a newer one. */
  requestLocateOwned = (
    destination: LocateRequest['destination'],
    nodeId: string,
    instanceKey?: string,
  ): LocateRequest | null => {
    if (!this.available(nodeId)) return null;
    const env = this.environment!;
    const request: LocateRequest = {
      sequence: ++this.sequence,
      destination,
      nodeId,
      ...(instanceKey ? { instanceKey } : {}),
      pageId: env.pageId,
      document: env.document,
      plan: env.plan,
      selection: env.document.getSnapshot().selection,
    };
    this.publish({
      ...this.snapshot,
      message: '',
      request,
    });
    return request;
  };
  isCurrent = (request: LocateRequest) => {
    const env = this.environment;
    return (
      !!env &&
      this.snapshot.request?.sequence === request.sequence &&
      env.document === request.document &&
      env.plan === request.plan &&
      env.pageId === request.pageId &&
      env.document.getSnapshot().selection === request.selection &&
      this.available(request.nodeId, request.pageId)
    );
  };
  complete = (request: LocateRequest, message: string) => {
    if (this.isCurrent(request)) this.publish({ ...this.snapshot, request: null, message });
  };
}
