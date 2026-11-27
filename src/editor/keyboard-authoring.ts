import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import {
  pageNodeOrder,
  selectedNodeIds,
  topSelectedNodeIds,
} from '../../packages/editor/selection';
import { useAuthorGuard } from './author-guard';
import { resizingWindows } from './author-escape';
import { useDragDrop } from './DragDrop';
import { errorText } from './errors';
import { useEditorNavigation } from './session';
import {
  matchesCopySummary,
  matchesKeyboardPasteSnapshot,
  matchesPasteResult,
  type ClipboardOperationWitness,
} from './clipboard-operation';
import type {
  ClipboardPasteReservation,
  ClipboardRuntimeWitness,
  ClipboardTreeWitness,
} from './navigation';
import { isDocumentElement, isDocumentNode } from '../ui/runtime-dom';
import { useCanvasStage, type CanvasStage } from './canvas-stage';

function authorHostCurrent(element: HTMLElement, domain: 'canvas' | 'tree', stage?: CanvasStage) {
  return domain === 'canvas' && stage
    ? stage.current()?.author === element && stage.focused(element)
    : element.ownerDocument === window.document;
}
function hostElement(value: EventTarget | null, host: HTMLElement): value is HTMLElement {
  return (
    isDocumentElement(value, host.ownerDocument) &&
    value instanceof host.ownerDocument.defaultView!.HTMLElement
  );
}
function shadowPath(path: EventTarget[], host: HTMLElement) {
  return path.some((entry) => entry instanceof host.ownerDocument.defaultView!.ShadowRoot);
}

const consumed = new WeakSet<Event>();
export const isDeleteKey = (key: string) => key === 'Delete' || key === 'Backspace';
/** Routing is deliberately broader than eligibility so denied native history keys propagate. */
export const isHistoryKeyFamily = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>) =>
  (event.ctrlKey || event.metaKey) && /^[zy]$/i.test(event.key);
export const isDuplicateKeyFamily = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>) =>
  (event.ctrlKey || event.metaKey) && /^d$/i.test(event.key);
export const isClipboardKeyFamily = (event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey'>) =>
  (event.ctrlKey || event.metaKey) && /^[cv]$/i.test(event.key);
function visible(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.hasAttribute('inert')) return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

function clipboardTargetCurrent(
  element: HTMLElement,
  target: HTMLElement,
  domain: 'canvas' | 'tree',
  snapshot: EditorSnapshot,
  stage?: CanvasStage,
) {
  if (
    !authorHostCurrent(element, domain, stage) ||
    !element.isConnected ||
    !target.isConnected ||
    element.ownerDocument.activeElement !== target ||
    !element.contains(target) ||
    !visible(element) ||
    !visible(target) ||
    target.shadowRoot ||
    target.isContentEditable ||
    target.matches(':disabled,[aria-disabled="true"]') ||
    target.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"],[role="combobox"]',
    )
  )
    return false;
  if (
    domain === 'canvas'
      ? target !== element
      : target !== element &&
        (!target.matches('.tree-select') ||
          target.closest('.component-tree') !== element ||
          target.closest<HTMLElement>('[data-editor-tree-node]')?.querySelector('.tree-select') !==
            target ||
          !selectedNodeIds(snapshot.selection).includes(
            target.closest<HTMLElement>('[data-editor-tree-node]')?.dataset.editorTreeNode ?? '',
          ))
  )
    return false;
  for (let ancestor: HTMLElement | null = target; ancestor; ancestor = ancestor.parentElement) {
    if (
      ancestor.matches(
        '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[popover]',
      )
    )
      return false;
    if (ancestor === element) break;
  }
  try {
    if (element.ownerDocument.defaultView?.getSelection()?.isCollapsed === false) return false;
  } catch {
    return false;
  }
  return true;
}

/** Only exact focused author targets own deletion; no global keyboard listener. */
export function useKeyboardDelete({
  document,
  snapshot,
  host,
  domain,
  enabled = true,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  host: RefObject<HTMLDivElement | null>;
  domain: 'canvas' | 'tree';
  enabled?: boolean;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, undefined, enabled);
  const { navigation, state } = useEditorNavigation();
  const drag = useDragDrop();
  const stage = useCanvasStage();
  const composing = useRef(false);
  const [error, setError] = useState('');
  useLayoutEffect(
    () => () => {
      if (domain === 'tree') navigation.cancelDeletionFocus('tree', document);
    },
    [document, domain, navigation],
  );
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
    };
    element.addEventListener('compositionstart', start, true);
    element.addEventListener('compositionend', end, true);
    return () => {
      element.removeEventListener('compositionstart', start, true);
      element.removeEventListener('compositionend', end, true);
    };
  }, [host, host.current]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    if (
      !enabled ||
      !authorHostCurrent(element, domain, stage) ||
      drag?.enabled === false ||
      drag?.isInteracting ||
      snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled ||
      !visible(element)
    ) {
      navigation.cancelDeletionFocus(domain, document);
      return;
    }
    const selected = snapshot.selection.nodeId;
    const fallback =
      domain === 'tree' && selected
        ? [...element.querySelectorAll<HTMLElement>('[data-editor-tree-node]')]
            .find((row) => row.dataset.editorTreeNode === selected)
            ?.querySelector<HTMLElement>('.tree-select')
        : undefined;
    navigation.restoreDeletionFocus(
      document,
      snapshot,
      domain,
      fallback && visible(fallback) ? fallback : element,
    );
  }, [document, snapshot, host, domain, enabled, drag, navigation, state]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isDeleteKey(event.key)) return;
    const native = event.nativeEvent,
      element = host.current;
    if (
      !element ||
      event.defaultPrevented ||
      native.defaultPrevented ||
      consumed.has(native) ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      native.isComposing ||
      native.keyCode === 229 ||
      composing.current ||
      !canAuthor()
    )
      return;
    const target = event.target;
    if (
      !hostElement(target, element) ||
      !authorHostCurrent(element, domain, stage) ||
      element.ownerDocument.activeElement !== target ||
      !element.contains(target) ||
      !visible(target) ||
      (domain === 'canvas' ? target !== element : !target.matches('.tree-select')) ||
      target.shadowRoot ||
      target.isContentEditable ||
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"],[role="combobox"]',
      )
    )
      return;
    const path = native.composedPath();
    if (path[0] !== target || shadowPath(path, element)) return;
    const ids = selectedNodeIds(snapshot.selection);
    if (!ids.length) return;
    if (
      domain === 'tree' &&
      !ids.includes(
        target.closest<HTMLElement>('[data-editor-tree-node]')?.dataset.editorTreeNode ?? '',
      )
    )
      return;
    try {
      const selection = element.ownerDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) return;
    } catch {
      return;
    }
    consumed.add(native);
    event.preventDefault();
    event.stopPropagation();
    try {
      navigation.retireClipboardPasteForCommand(document, domain);
      const changed =
        ids.length > 1
          ? document.removeNodes(snapshot.selection.pageId, ids)
          : document.removeNode(snapshot.selection.pageId, ids[0]);
      setError('');
      if (changed)
        navigation.requestDeletionFocus(document, document.getSnapshot(), domain, target);
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return { onKeyDown, error };
}

/** Local visual-author history and duplication share post-command focus recovery. */
export function useKeyboardHistory({
  document,
  snapshot,
  host,
  domain,
  enabled = true,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  host: RefObject<HTMLDivElement | null>;
  domain: 'canvas' | 'tree';
  enabled?: boolean;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, undefined, enabled);
  const { navigation, state } = useEditorNavigation();
  const drag = useDragDrop();
  const stage = useCanvasStage();
  const current = useRef({ document, snapshot, enabled, drag, stage });
  current.current = { document, snapshot, enabled, drag, stage };
  const mounted = useRef(false);
  const composing = useRef(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (domain === 'tree') navigation.cancelHistoryFocus('tree', document);
    };
  }, [document, domain, navigation]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
    };
    element.addEventListener('compositionstart', start, true);
    element.addEventListener('compositionend', end, true);
    return () => {
      element.removeEventListener('compositionstart', start, true);
      element.removeEventListener('compositionend', end, true);
    };
  }, [host, host.current]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    if (
      !enabled ||
      !authorHostCurrent(element, domain, stage) ||
      drag?.enabled === false ||
      drag?.isInteracting ||
      snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled ||
      !visible(element)
    ) {
      navigation.cancelHistoryFocus(domain, document);
      return;
    }
    const primary = snapshot.selection.nodeId;
    const fallback =
      domain === 'tree' && primary
        ? [...element.querySelectorAll<HTMLElement>('[data-editor-tree-node]')]
            .find((row) => row.dataset.editorTreeNode === primary)
            ?.querySelector<HTMLElement>('.tree-select')
        : undefined;
    navigation.restoreHistoryFocus(
      document,
      snapshot,
      domain,
      fallback && visible(fallback) ? fallback : element,
    );
  }, [document, snapshot, host, domain, enabled, drag, navigation, state]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const duplicate = isDuplicateKeyFamily(event);
    if (!duplicate && !isHistoryKeyFamily(event)) return;
    const native = event.nativeEvent,
      element = host.current,
      key = event.key.toLowerCase();
    if (
      !element ||
      event.defaultPrevented ||
      native.defaultPrevented ||
      native.cancelBubble ||
      consumed.has(native) ||
      event.ctrlKey === event.metaKey ||
      event.altKey ||
      event.repeat ||
      ((duplicate || key === 'y') && event.shiftKey) ||
      (duplicate && resizingWindows.has(element.ownerDocument.defaultView!)) ||
      native.isComposing ||
      native.keyCode === 229 ||
      composing.current ||
      !canAuthor()
    )
      return;
    const target = event.target;
    if (
      !hostElement(target, element) ||
      !authorHostCurrent(element, domain, stage) ||
      element.ownerDocument.activeElement !== target ||
      !element.contains(target) ||
      !visible(element) ||
      !visible(target) ||
      (domain === 'canvas'
        ? target !== element
        : target !== element && !target.matches('.tree-select')) ||
      target.shadowRoot ||
      target.isContentEditable ||
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"],[role="combobox"]',
      )
    )
      return;
    const path = native.composedPath();
    if (path[0] !== target || shadowPath(path, element)) return;
    if (
      duplicate &&
      (!path.includes(element) || !clipboardTargetCurrent(element, target, domain, snapshot, stage))
    )
      return;
    if (
      domain === 'tree' &&
      target !== element &&
      !selectedNodeIds(snapshot.selection).includes(
        target.closest<HTMLElement>('[data-editor-tree-node]')?.dataset.editorTreeNode ?? '',
      )
    )
      return;
    try {
      const selection = element.ownerDocument.defaultView?.getSelection();
      if (selection && !selection.isCollapsed) return;
    } catch {
      return;
    }
    const command = key === 'y' || event.shiftKey ? 'redo' : 'undo';
    const before = document.getSnapshot();
    const ids = selectedNodeIds(before.selection);
    if (duplicate ? !ids.length : command === 'undo' ? !before.canUndo : !before.canRedo) return;
    const attachment = domain === 'canvas' ? stage?.current() : undefined;
    if (domain === 'canvas' && stage && !attachment) return;
    let retired = false;
    const release = attachment
      ? stage!.onInvalidate((reason) => {
          if (reason !== 'binding') retired = true;
        })
      : undefined;
    consumed.add(native);
    event.preventDefault();
    event.stopPropagation();
    try {
      navigation.retireClipboardPasteForCommand(document, domain);
      if (duplicate) {
        if (ids.length === 1) document.duplicateNode(before.selection.pageId, ids[0]);
        else document.duplicateNodes(before.selection.pageId, ids);
      } else document[command]();
      setError('');
      const after = document.getSnapshot(),
        latest = current.current,
        focus = element.ownerDocument.activeElement;
      const platform = attachment ? stage!.platform() : undefined;
      // A successful history command can replace the runtime before React restores focus.
      const commandHostCurrent = attachment
        ? !retired &&
          latest.stage === stage &&
          stage!.context.document === document &&
          stage!.context.snapshot.selection.pageId === before.selection.pageId &&
          platform?.environment === attachment.environment &&
          platform?.frame === attachment.frame &&
          attachment.environment.document === element.ownerDocument &&
          attachment.frame.ownerDocument.activeElement === attachment.frame &&
          visible(attachment.frame)
        : latest.drag?.enabled !== false;
      const expectedRender =
        (latest.snapshot.plan === before.plan && latest.snapshot.selection === before.selection) ||
        (latest.snapshot.plan === after.plan && latest.snapshot.selection === after.selection);
      if (
        after !== before &&
        after.selection.pageId === before.selection.pageId &&
        !after.plan.pages.get(after.selection.pageId)?.schema.code?.enabled &&
        mounted.current &&
        latest.document === document &&
        enabled &&
        latest.enabled &&
        expectedRender &&
        commandHostCurrent &&
        !latest.drag?.isInteracting &&
        (focus === target || focus === element.ownerDocument.body || focus === null)
      )
        navigation.requestHistoryFocus(document, after, domain, target);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      release?.();
    }
  };
  return { onKeyDown, error };
}

type ClipboardFeedback = {
  active: boolean;
  message: string;
  error: boolean;
  snapshot: EditorSnapshot;
  clipboard: ReturnType<EditorDocument['getClipboardSnapshot']>;
  focus: Element | null;
};
type ClipboardKeyboardOwner = {
  document: EditorDocument;
  pageId: string;
  enabled: boolean;
  dragEnabled: boolean;
  interacting: boolean;
  canvasRuntime?: ClipboardRuntimeWitness;
  treeQuery?: string;
  treeClosed?: readonly string[];
  host: HTMLElement | null;
  domain: 'canvas' | 'tree';
};
type ClipboardKeyboardReceipt = ClipboardOperationWitness & {
  stage?: CanvasStage;
  attachment?: ReturnType<CanvasStage['current']>;
  active: boolean;
  copy: boolean;
  executing: boolean;
  gap: boolean;
  finalized: boolean;
  owner: { active: boolean; context: ClipboardKeyboardOwner };
  operationOwner: object;
  host: HTMLElement;
  focus: HTMLElement;
  documents: number;
  clipboards: number;
  candidate?: EditorSnapshot;
  summary?: ReturnType<EditorDocument['getClipboardSnapshot']>;
  reservation?: ClipboardPasteReservation;
};

/** Session component commands belong only to exact focused visual author surfaces. */
export function useKeyboardClipboard({
  document,
  snapshot,
  host,
  domain,
  enabled = true,
  canvasRuntime,
  treeQuery,
  treeClosed,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  host: RefObject<HTMLDivElement | null>;
  domain: 'canvas' | 'tree';
  enabled?: boolean;
  canvasRuntime?: ClipboardRuntimeWitness;
  treeQuery?: string;
  treeClosed?: readonly string[];
}) {
  const clipboard = useSyncExternalStore(
    document.subscribeClipboard,
    document.getClipboardSnapshot,
    document.getClipboardSnapshot,
  );
  const canAuthor = useAuthorGuard(document, snapshot, undefined, enabled);
  const drag = useDragDrop();
  const stage = useCanvasStage();
  const { navigation, state: navigationState } = useEditorNavigation();
  const mounted = useRef(false),
    composing = useRef(false),
    inFlight = useRef(false);
  const boundHost = useRef<HTMLElement | null>(null);
  const treeContext = useRef<ClipboardTreeWitness>({
    active: false,
    query: treeQuery,
    closed: treeClosed,
    host: null,
  });
  treeContext.current.query = treeQuery;
  treeContext.current.closed = treeClosed;
  treeContext.current.host = host.current;
  const operation = useRef<ClipboardKeyboardReceipt | null>(null);
  const finalOwner = useRef<{
    owner: object;
    result: EditorSnapshot;
    sourceRuntime?: ClipboardRuntimeWitness;
    destinationRuntime?: ClipboardRuntimeWitness;
    treeQuery?: string;
    treeClosed?: readonly string[];
    treeHost: HTMLElement;
  } | null>(null);
  const feedbackOwner = useRef<ClipboardFeedback | null>(null);
  const [feedback, setFeedback] = useState<ClipboardFeedback | null>(null);
  const [publication, setPublication] = useState(0);
  const current = useRef({
    document,
    snapshot,
    clipboard,
    enabled,
    drag,
    canvasRuntime,
    treeQuery,
    treeClosed,
    host: host.current,
    domain,
  });
  current.current = {
    document,
    snapshot,
    clipboard,
    enabled,
    drag,
    canvasRuntime,
    treeQuery,
    treeClosed,
    host: host.current,
    domain,
  };
  const ownerContext: ClipboardKeyboardOwner = {
    document,
    pageId: snapshot.selection.pageId,
    enabled,
    dragEnabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
    canvasRuntime,
    treeQuery,
    treeClosed,
    host: host.current,
    domain,
  };
  const owner = useRef({ active: true, context: ownerContext });
  const retire = (pending: ClipboardKeyboardReceipt) => {
    pending.active = false;
    if (pending.reservation) navigation.releaseClipboardPastePresentation(pending.operationOwner);
    navigation.cancelClipboardPasteFocus(pending.operationOwner, domain, document);
  };
  const clearFeedback = () => {
    if (!feedbackOwner.current?.active) return;
    feedbackOwner.current.active = false;
    feedbackOwner.current = null;
    if (mounted.current) setFeedback(null);
  };
  if (
    !owner.current.active ||
    (Object.keys(ownerContext) as (keyof ClipboardKeyboardOwner)[]).some(
      (key) => owner.current.context[key] !== ownerContext[key],
    )
  ) {
    owner.current.active = false;
    if (operation.current) retire(operation.current);
    if (feedbackOwner.current) feedbackOwner.current.active = false;
    owner.current = { active: true, context: ownerContext };
  }
  const context = {
    ...ownerContext,
    plan: snapshot.plan,
    selection: snapshot.selection,
    clipboard,
    publication,
  };
  const permission = useRef({ active: true, context });
  if (
    !permission.current.active ||
    (Object.keys(context) as (keyof typeof context)[]).some(
      (key) => permission.current.context[key] !== context[key],
    )
  ) {
    permission.current.active = false;
    permission.current = { active: true, context };
  }
  const generation = permission.current;
  const contextCurrent = (pending: ClipboardKeyboardReceipt, candidateGap = false) => {
    const latest = current.current,
      captured = pending.owner.context,
      actual = document.getSnapshot();
    const platform = stage?.platform(),
      attachment = pending.attachment,
      focus = pending.host.ownerDocument.activeElement;
    const pasteGap =
      pending.active &&
      pending.executing &&
      !pending.copy &&
      attachment &&
      pending.stage === stage &&
      matchesKeyboardPasteSnapshot(actual, pending) &&
      stage?.context.document === document &&
      stage.context.snapshot.selection.pageId === captured.pageId &&
      platform?.environment === attachment.environment &&
      platform?.frame === attachment.frame &&
      attachment.environment.document === pending.host.ownerDocument &&
      visible(attachment.frame) &&
      attachment.frame.ownerDocument.activeElement === attachment.frame &&
      (focus === pending.focus || focus === pending.host.ownerDocument.body || focus === null);
    return (
      (!stage ||
        domain !== 'canvas' ||
        (!!stage.platform() &&
          stage.platform()!.frame.ownerDocument.activeElement === stage.platform()!.frame)) &&
      latest.document === document &&
      latest.document === captured.document &&
      actual.selection.pageId === captured.pageId &&
      latest.enabled &&
      captured.enabled &&
      (latest.drag?.enabled !== false || pasteGap) &&
      !latest.drag?.isInteracting &&
      !actual.plan.pages.get(captured.pageId)?.schema.code?.enabled &&
      latest.canvasRuntime === captured.canvasRuntime &&
      latest.treeQuery === captured.treeQuery &&
      latest.treeClosed === captured.treeClosed &&
      captured.domain === domain &&
      captured.host === pending.host &&
      (host.current === pending.host ||
        ((pending.gap || candidateGap) && domain === 'canvas' && !pending.copy)) &&
      ((latest.snapshot.plan === pending.initial.plan &&
        latest.snapshot.selection === pending.initial.selection) ||
        (!pending.copy &&
          matchesKeyboardPasteSnapshot(latest.snapshot, pending) &&
          (!pending.candidate || latest.snapshot === pending.candidate)))
    );
  };
  const observe = (pending: ClipboardKeyboardReceipt) => {
    if (!pending.active) return;
    const actual = document.getSnapshot(),
      liveClipboard = document.getClipboardSnapshot();
    if (
      !contextCurrent(pending) ||
      pending.owner !== owner.current ||
      (!pending.owner.active && !pending.gap) ||
      pending.documents > (pending.copy ? 0 : 1) ||
      pending.clipboards > (pending.copy ? 1 : 0)
    ) {
      retire(pending);
      return;
    }
    if (pending.copy) {
      if (
        actual.plan !== pending.initial.plan ||
        actual.selection !== pending.initial.selection ||
        actual.revision !== pending.initial.revision
      ) {
        retire(pending);
        return;
      }
      if (liveClipboard !== pending.clipboard) {
        if (
          !matchesCopySummary(liveClipboard, pending) ||
          (pending.summary && pending.summary !== liveClipboard)
        ) {
          retire(pending);
          return;
        }
        pending.summary = liveClipboard;
      }
      if (
        current.current.clipboard !== pending.clipboard &&
        current.current.clipboard !== pending.summary
      )
        retire(pending);
    } else {
      if (liveClipboard !== pending.clipboard) {
        retire(pending);
        return;
      }
      if (actual.plan !== pending.initial.plan || actual.selection !== pending.initial.selection) {
        if (
          !matchesKeyboardPasteSnapshot(actual, pending) ||
          (pending.candidate && pending.candidate !== actual)
        ) {
          retire(pending);
          return;
        }
        pending.candidate = actual;
      } else if (pending.candidate) {
        retire(pending);
        return;
      }
      if (pending.reservation) {
        pending.reservation.documents = pending.documents;
        pending.reservation.clipboards = pending.clipboards;
        pending.reservation.candidate = pending.candidate;
        if (!pending.finalized && !pending.reservation.active) retire(pending);
      }
    }
  };
  if (operation.current) observe(operation.current);
  const retained = finalOwner.current;
  if (retained?.destinationRuntime && retained.destinationRuntime !== canvasRuntime)
    navigation.cancelClipboardPasteFocus(retained.owner, domain, document);
  if (
    retained &&
    domain === 'tree' &&
    (retained.treeQuery !== treeQuery ||
      retained.treeClosed !== treeClosed ||
      retained.treeHost !== host.current)
  )
    navigation.cancelClipboardPasteFocus(retained.owner, domain, document);

  useLayoutEffect(() => {
    mounted.current = true;
    treeContext.current.active = true;
    treeContext.current.host = host.current;
    if (!permission.current.active) setPublication((value) => value + 1);
    return () => {
      const pending = operation.current;
      if (pending?.active) {
        const actual = document.getSnapshot();
        const expectedGap =
          domain === 'canvas' &&
          !pending.copy &&
          pending.executing &&
          !!pending.owner.context.canvasRuntime &&
          pending.owner.context.canvasRuntime === current.current.canvasRuntime &&
          pending.owner.context.canvasRuntime.plan === pending.initial.plan &&
          pending.owner.context.canvasRuntime.page.schema.id === pending.initial.selection.pageId &&
          matchesKeyboardPasteSnapshot(actual, pending) &&
          document.getClipboardSnapshot() === pending.clipboard &&
          pending.documents <= 1 &&
          pending.clipboards === 0 &&
          contextCurrent(pending, true) &&
          (!!pending.reservation?.active ||
            navigation.clipboardPasteFocusOwner(document, actual, domain) ===
              pending.operationOwner);
        if (expectedGap) {
          pending.gap = true;
          pending.candidate = actual;
          if (pending.reservation) pending.reservation.candidate = actual;
        } else retire(pending);
      }
      const final = finalOwner.current;
      if (final) {
        const actual = document.getSnapshot();
        const expectedGap =
          domain === 'canvas' &&
          final.sourceRuntime === current.current.canvasRuntime &&
          current.current.canvasRuntime?.plan !== final.result.plan &&
          actual.plan === final.result.plan &&
          actual.selection === final.result.selection &&
          navigation.clipboardPasteFocusOwner(document, actual, domain) === final.owner;
        if (!expectedGap) navigation.cancelClipboardPasteFocus(final.owner, domain, document);
      }
      mounted.current = false;
      treeContext.current.active = false;
      permission.current.active = false;
      owner.current.active = false;
      if (feedbackOwner.current) feedbackOwner.current.active = false;
    };
  }, [document, domain, navigation]);
  useLayoutEffect(() => {
    const element = host.current;
    if (boundHost.current === element && permission.current.context.host === element) return;
    boundHost.current = element;
    permission.current.active = false;
    owner.current.active = false;
    if (operation.current) retire(operation.current);
    clearFeedback();
    const final = finalOwner.current;
    if (final && domain === 'tree' && final.treeHost !== element)
      navigation.cancelClipboardPasteFocus(final.owner, domain, document);
    if (mounted.current) setPublication((value) => value + 1);
  });
  useLayoutEffect(
    () =>
      stage?.onInvalidate((reason) => {
        if (domain !== 'canvas' || reason === 'binding') return;
        permission.current.active = false;
        owner.current.active = false;
        composing.current = false;
        if (operation.current) retire(operation.current);
        clearFeedback();
        if (mounted.current) setPublication((value) => value + 1);
      }),
    [stage, domain, document],
  );
  useLayoutEffect(() => {
    const changed = () => {
      permission.current.active = false;
      clearFeedback();
      if (operation.current) observe(operation.current);
      if (mounted.current) setPublication((value) => value + 1);
    };
    const stopDocument = document.subscribe(changed),
      stopClipboard = document.subscribeClipboard(changed);
    const element = host.current;
    const start = () => {
        composing.current = true;
      },
      end = () => {
        composing.current = false;
      };
    const focus = (event: FocusEvent) => {
      if (feedbackOwner.current && event.target !== feedbackOwner.current.focus) clearFeedback();
    };
    const pointer = (event: PointerEvent) => {
      const focusTarget = feedbackOwner.current?.focus;
      if (
        focusTarget &&
        (!isDocumentNode(event.target, focusTarget.ownerDocument) ||
          !focusTarget.contains(event.target))
      )
        clearFeedback();
    };
    element?.addEventListener('compositionstart', start, true);
    element?.addEventListener('compositionend', end, true);
    element?.ownerDocument.addEventListener('focusin', focus, true);
    element?.ownerDocument.addEventListener('pointerdown', pointer, true);
    return () => {
      stopDocument();
      stopClipboard();
      element?.removeEventListener('compositionstart', start, true);
      element?.removeEventListener('compositionend', end, true);
      element?.ownerDocument.removeEventListener('focusin', focus, true);
      element?.ownerDocument.removeEventListener('pointerdown', pointer, true);
    };
  }, [document, host, ownerContext.host]);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const ticket = navigation.clipboardPasteFocusOwner(document, snapshot, domain);
    if (!ticket) return;
    const previous = finalOwner.current;
    finalOwner.current =
      previous?.owner === ticket
        ? previous
        : {
            owner: ticket,
            result: snapshot,
            treeHost: element,
            sourceRuntime: undefined,
            destinationRuntime: canvasRuntime,
            treeQuery,
            treeClosed,
          };
    if (
      !enabled ||
      drag?.enabled === false ||
      drag?.isInteracting ||
      !visible(element) ||
      !authorHostCurrent(element, domain, stage)
    ) {
      navigation.cancelClipboardPasteFocus(ticket, domain, document);
      return;
    }
    const primary = snapshot.selection.nodeId;
    const row =
      domain === 'tree' && primary
        ? [...element.querySelectorAll<HTMLElement>('[data-editor-tree-node]')]
            .find((entry) => entry.dataset.editorTreeNode === primary)
            ?.querySelector<HTMLElement>('.tree-select')
        : null;
    navigation.restoreClipboardPasteFocus(
      document,
      snapshot,
      domain,
      row && visible(row) && !row.matches(':disabled,[aria-disabled="true"]') ? row : element,
      { canvasRuntime, treeQuery, treeClosed, treeHost: element },
    );
  }, [
    document,
    snapshot,
    domain,
    navigation,
    navigationState,
    enabled,
    drag,
    canvasRuntime,
    treeQuery,
    treeClosed,
    host,
  ]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isClipboardKeyFamily(event)) return;
    const native = event.nativeEvent,
      element = host.current;
    if (generation.context.host !== element || generation.context.domain !== domain) {
      generation.active = false;
      return;
    }
    if (
      !element ||
      inFlight.current ||
      !mounted.current ||
      permission.current !== generation ||
      !generation.active ||
      !owner.current.active ||
      event.defaultPrevented ||
      native.defaultPrevented ||
      native.cancelBubble ||
      consumed.has(native) ||
      event.ctrlKey === event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.repeat ||
      native.isComposing ||
      native.keyCode === 229 ||
      composing.current ||
      !canAuthor() ||
      document.getClipboardSnapshot() !== clipboard
    )
      return;
    const target = event.target;
    if (
      !hostElement(target, element) ||
      !clipboardTargetCurrent(element, target, domain, snapshot, stage)
    )
      return;
    const path = native.composedPath();
    if (path[0] !== target || !path.includes(element) || shadowPath(path, element)) return;
    try {
      if (element.ownerDocument.defaultView?.getSelection()?.isCollapsed === false) return;
    } catch {
      return;
    }
    const copy = event.key.toLowerCase() === 'c',
      ids = selectedNodeIds(snapshot.selection);
    if (copy ? !ids.length : !clipboard.available) return;
    const initial = document.getSnapshot(),
      page = initial.plan.pages.get(initial.selection.pageId)!.schema;
    if (
      initial.plan !== snapshot.plan ||
      initial.selection !== snapshot.selection ||
      (domain === 'canvas' &&
        (!canvasRuntime ||
          canvasRuntime.disposed ||
          canvasRuntime.plan !== initial.plan ||
          canvasRuntime.page.schema.id !== initial.selection.pageId))
    )
      return;
    const roots = copy ? topSelectedNodeIds(page, ids) : [];
    const pending: ClipboardKeyboardReceipt = {
      stage,
      attachment: domain === 'canvas' ? stage?.current() : undefined,
      active: true,
      copy,
      executing: false,
      gap: false,
      finalized: false,
      owner: owner.current,
      operationOwner: {},
      host: element,
      focus: target,
      initial,
      clipboard,
      rootCount: copy ? roots.length : (clipboard.rootCount ?? 1),
      component: copy && roots.length === 1 ? findNode(page, roots[0]!)!.node.component : undefined,
      pageTitle: page.title,
      oldNodeIds: new Set(pageNodeOrder(page)),
      documents: 0,
      clipboards: 0,
    };
    inFlight.current = true;
    generation.active = false;
    consumed.add(native);
    operation.current = pending;
    clearFeedback();
    const stopDocument = document.subscribe(() => {
      pending.documents++;
      observe(pending);
    });
    const stopClipboard = document.subscribeClipboard(() => {
      pending.clipboards++;
      observe(pending);
    });
    const takeover = (event: FocusEvent | PointerEvent) => {
      if (
        event.type === 'focusin'
          ? event.target !== target && event.target !== element.ownerDocument.body
          : !isDocumentNode(event.target, element.ownerDocument) || !target.contains(event.target)
      )
        retire(pending);
    };
    element.ownerDocument.addEventListener('focusin', takeover, true);
    element.ownerDocument.addEventListener('pointerdown', takeover, true);
    const emit = (message: string, error: boolean) => {
      if (!pending.active || !mounted.current || !contextCurrent(pending)) return;
      const entry: ClipboardFeedback = {
        active: true,
        message,
        error,
        snapshot: document.getSnapshot(),
        clipboard: document.getClipboardSnapshot(),
        focus: element.ownerDocument.activeElement,
      };
      feedbackOwner.current = entry;
      setFeedback(entry);
    };
    try {
      event.preventDefault();
      event.stopPropagation();
      navigation.retireClipboardPasteForCommand(document, domain);
      if (
        !pending.active ||
        !mounted.current ||
        !canAuthor() ||
        host.current !== element ||
        !clipboardTargetCurrent(element, target, domain, snapshot, stage) ||
        document.getSnapshot() !== initial ||
        document.getClipboardSnapshot() !== clipboard ||
        !contextCurrent(pending) ||
        (domain === 'canvas' &&
          (!canvasRuntime ||
            canvasRuntime.disposed ||
            current.current.canvasRuntime !== canvasRuntime ||
            canvasRuntime.plan !== initial.plan ||
            canvasRuntime.page.schema.id !== initial.selection.pageId))
      )
        return;
      pending.executing = true;
      if (!copy) {
        const reservation: ClipboardPasteReservation = {
          ...pending,
          document,
          domain,
          originFocus: target,
          canvasRuntime,
          treeQuery,
          treeClosed,
          treeContext: domain === 'tree' ? treeContext.current : undefined,
          executing: true,
          active: true,
        };
        pending.reservation = reservation;
        if (!navigation.reserveClipboardPastePresentation(reservation)) {
          retire(pending);
          return;
        }
      }
      if (copy) {
        document.copyNodesToClipboard(initial.selection.pageId, ids);
        observe(pending);
        if (
          !pending.active ||
          !mounted.current ||
          pending.documents !== 0 ||
          pending.clipboards !== 1 ||
          document.getClipboardSnapshot() !== pending.summary ||
          !pending.summary ||
          !matchesCopySummary(pending.summary, pending)
        )
          return;
        emit(
          pending.rootCount === 1
            ? '已复制组件到当前会话剪贴板。'
            : `已复制 ${pending.rootCount} 个顶层组件到当前会话剪贴板。`,
          false,
        );
      } else {
        const pasted = document.pasteClipboardNodes(initial.selection.pageId);
        observe(pending);
        const actual = document.getSnapshot();
        if (
          !pending.active ||
          (!mounted.current && !pending.gap) ||
          pending.documents !== 1 ||
          pending.clipboards !== 0 ||
          actual !== pending.candidate ||
          !matchesPasteResult(actual, pending, pasted) ||
          !pending.reservation?.active
        )
          return;
        finalOwner.current = {
          owner: pending.operationOwner,
          result: actual,
          sourceRuntime: canvasRuntime,
          treeQuery,
          treeClosed,
          treeHost: element,
        };
        pending.finalized = true;
        // The final intent installs its own takeover listeners before publishing.
        element.ownerDocument.removeEventListener('focusin', takeover, true);
        element.ownerDocument.removeEventListener('pointerdown', takeover, true);
        if (
          !navigation.requestClipboardPasteFocus(pending.reservation, {
            snapshot: actual,
            ids: pasted,
          })
        ) {
          if (finalOwner.current?.owner === pending.operationOwner) finalOwner.current = null;
          retire(pending);
          return;
        }
        emit(
          pending.rootCount === 1
            ? '已粘贴组件到页面末尾，可撤销。'
            : `已粘贴 ${pending.rootCount} 个顶层组件到页面末尾，可撤销。`,
          false,
        );
      }
    } catch (error) {
      if (pending.finalized) {
        navigation.cancelClipboardPasteFocus(pending.operationOwner, domain, document);
        if (finalOwner.current?.owner === pending.operationOwner) finalOwner.current = null;
      }
      observe(pending);
      const actual = document.getSnapshot();
      if (
        pending.active &&
        mounted.current &&
        pending.documents === 0 &&
        pending.clipboards === 0 &&
        actual.plan === initial.plan &&
        actual.selection === initial.selection &&
        actual.revision === initial.revision &&
        document.getClipboardSnapshot() === clipboard &&
        canAuthor() &&
        element.ownerDocument.activeElement === target
      )
        emit(errorText(error), true);
    } finally {
      stopDocument();
      stopClipboard();
      element.ownerDocument.removeEventListener('focusin', takeover, true);
      element.ownerDocument.removeEventListener('pointerdown', takeover, true);
      navigation.releaseClipboardPastePresentation(pending.operationOwner);
      pending.active = false;
      pending.executing = false;
      if (operation.current === pending) operation.current = null;
      inFlight.current = false;
      if (mounted.current) setPublication((value) => value + 1);
    }
  };
  const displayed =
    feedback?.active &&
    feedbackOwner.current === feedback &&
    feedback.snapshot.plan === snapshot.plan &&
    feedback.snapshot.selection === snapshot.selection &&
    feedback.clipboard === clipboard
      ? feedback
      : null;
  return { onKeyDown, feedback: displayed };
}

/** Ctrl/Cmd+A selects every top-level component of the active page (Yidao parity). */
export function useKeyboardSelectAll({
  document,
  snapshot,
  host,
  domain,
  enabled = true,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  host: RefObject<HTMLDivElement | null>;
  domain: 'canvas' | 'tree';
  enabled?: boolean;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, undefined, enabled);
  const drag = useDragDrop();
  const stage = useCanvasStage();
  const composing = useRef(false);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
    };
    element.addEventListener('compositionstart', start, true);
    element.addEventListener('compositionend', end, true);
    return () => {
      element.removeEventListener('compositionstart', start, true);
      element.removeEventListener('compositionend', end, true);
    };
  }, [host, host.current]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || /^[cvxs]$/i.test(event.key)) return;
    if (event.key !== 'a' && event.key !== 'A') return;
    const native = event.nativeEvent,
      element = host.current;
    if (
      !element ||
      event.defaultPrevented ||
      native.defaultPrevented ||
      consumed.has(native) ||
      event.repeat ||
      event.altKey ||
      native.isComposing ||
      native.keyCode === 229 ||
      composing.current ||
      !enabled ||
      !authorHostCurrent(element, domain, stage) ||
      drag?.enabled === false ||
      drag?.isInteracting ||
      snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled ||
      !canAuthor()
    )
      return;
    const target = event.target;
    if (
      !hostElement(target, element) ||
      !element.contains(target) ||
      target.shadowRoot ||
      target.isContentEditable ||
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"],[role="combobox"]',
      )
    )
      return;
    const page = snapshot.plan.pages.get(snapshot.selection.pageId)?.schema;
    if (!page) return;
    const ids = topSelectedNodeIds(page, pageNodeOrder(page));
    if (!ids.length) return;
    consumed.add(native);
    event.preventDefault();
    event.stopPropagation();
    document.selectMany(snapshot.selection.pageId, ids);
  };
  return { onKeyDown };
}

/** Arrow up/down reorders the primary selected node among its siblings (canvas only). */
export function useKeyboardNudge({
  document,
  snapshot,
  host,
  enabled = true,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  host: RefObject<HTMLDivElement | null>;
  enabled?: boolean;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, undefined, enabled);
  const { navigation } = useEditorNavigation();
  const drag = useDragDrop();
  const stage = useCanvasStage();
  const composing = useRef(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const start = () => {
      composing.current = true;
    };
    const end = () => {
      composing.current = false;
    };
    element.addEventListener('compositionstart', start, true);
    element.addEventListener('compositionend', end, true);
    return () => {
      element.removeEventListener('compositionstart', start, true);
      element.removeEventListener('compositionend', end, true);
    };
  }, [host, host.current]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const native = event.nativeEvent,
      element = host.current;
    if (
      !element ||
      event.defaultPrevented ||
      native.defaultPrevented ||
      consumed.has(native) ||
      native.isComposing ||
      native.keyCode === 229 ||
      composing.current ||
      !enabled ||
      !authorHostCurrent(element, 'canvas', stage) ||
      drag?.enabled === false ||
      drag?.isInteracting ||
      snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled ||
      !canAuthor()
    )
      return;
    const target = event.target;
    if (
      !hostElement(target, element) ||
      target !== element ||
      element.ownerDocument.activeElement !== target ||
      target.shadowRoot ||
      target.isContentEditable ||
      target.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"],[role="combobox"]',
      )
    )
      return;
    const path = native.composedPath();
    if (path[0] !== target || shadowPath(path, element)) return;
    const nodeId = snapshot.selection.nodeId;
    if (!nodeId) return;
    consumed.add(native);
    event.preventDefault();
    event.stopPropagation();
    try {
      navigation.retireClipboardPasteForCommand(document, 'canvas');
      document.reorderNode(
        snapshot.selection.pageId,
        nodeId,
        event.key === 'ArrowUp' ? 'up' : 'down',
      );
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  };
  return { onKeyDown, error };
}
