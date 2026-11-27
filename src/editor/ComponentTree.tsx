import { MaterialIcon } from '../ui/MaterialIcon';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import {
  ChevronRight,
  EyeOff,
  LocateFixed,
  Lock,
  ScanSearch,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, Input, Tip } from '../ui/primitives';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { NodeSchema } from '../../packages/schema/types';
import { nodePath } from '../../packages/editor/node-path';
import { catalog } from './catalog';
import { DragHandle, DropZone, useDragDrop } from './DragDrop';
import { useEditorNavigation, useSessionState } from './session';
import { revealRect } from './CanvasHost';
import { selectedNodeIds } from '../../packages/editor/selection';
import { useAuthorGuard } from './author-guard';
import { SelectionControls } from './SelectionControls';
import { NodeContextMenu, type NodeContextMenuState } from './NodeContextMenu';
import { useKeyboardSelectAll } from './keyboard-authoring';
import {
  isHistoryKeyFamily,
  isDuplicateKeyFamily,
  isClipboardKeyFamily,
  useKeyboardDelete,
  useKeyboardHistory,
  useKeyboardClipboard,
} from './keyboard-authoring';
import './navigation.css';
import { describeNodeName, displayNodeName } from './node-display-name';
import {
  buildTreeNavigation,
  treeNavigationAction,
  type TreeNavigationKey,
  type TreeNavigationNode,
} from './tree-navigation';

const navigationKeys = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);
type FocusReceipt = {
  active: boolean;
  owner: { context: CompletionDomain; active: boolean };
  document: EditorDocument;
  plan: EditorSnapshot['plan'];
  pageId: string;
  host: HTMLDivElement;
  origin: HTMLButtonElement;
  target: HTMLButtonElement;
  node: NodeSchema;
  query: string;
  closed: string[];
  revision: number;
  enabled: boolean;
  focusEpoch: number;
  phase: 'select' | 'focus';
  blurred: boolean;
  focused: boolean;
};
type TreeContext = {
  document: EditorDocument;
  plan: EditorSnapshot['plan'];
  selection: EditorSnapshot['selection'];
  pageId: string;
  query: string;
  closed: string[];
  model: ReturnType<typeof buildTreeNavigation>;
  navigation: ReturnType<typeof useEditorNavigation>['navigation'];
  enabled: boolean;
  interacting: boolean;
  revision: number;
  publication: number;
};
type CompletionDomain = Pick<
  TreeContext,
  'document' | 'plan' | 'pageId' | 'navigation' | 'enabled' | 'interacting'
>;

function eligibleTreeButton(button: HTMLButtonElement, host: HTMLDivElement, nodeId: string) {
  const row = button.closest<HTMLElement>('[data-editor-tree-node]');
  if (
    !host.isConnected ||
    !host.matches('.component-tree') ||
    host.getAttribute('role') !== 'region' ||
    !button.isConnected ||
    !host.contains(button) ||
    button.closest('.component-tree') !== host ||
    !button.matches('.tree-select') ||
    button.disabled ||
    button.getAttribute('aria-disabled') === 'true' ||
    !row ||
    row.dataset.editorTreeNode !== nodeId ||
    row.querySelector('.tree-select') !== button ||
    button.isContentEditable ||
    button.closest(
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),.monaco-editor,.code-editor,[role="textbox"],[role="combobox"]',
    )
  )
    return false;
  for (let element: HTMLElement | null = button; element; element = element.parentElement) {
    if (
      element.matches(
        '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="tooltip"],[popover]',
      )
    )
      return false;
    // A legitimate ResponsiveSide dialog may wrap this region. Only foreign
    // popup ownership at or inside the tree borrows this keyboard domain.
    if (element === host) break;
  }
  for (let element: HTMLElement | null = button; element; element = element.parentElement) {
    if (element.hidden || element.hasAttribute('inert')) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    )
      return false;
  }
  return true;
}

export function ComponentTree({
  document,
  snapshot,
  onEditProperties,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  onEditProperties?: () => void;
}) {
  const { pageId, nodeId } = snapshot.selection;
  const selected = new Set(selectedNodeIds(snapshot.selection));
  const canAuthor = useAuthorGuard(document, snapshot);
  const canNavigate = useAuthorGuard(document, snapshot, undefined, true, 'navigation');
  const { navigation, state: interaction } = useEditorNavigation();
  const [query, setSessionQuery] = useSessionState(`tree:${pageId}/query`, '');
  const [closed, setSessionClosed] = useSessionState<string[]>(`tree:${pageId}/closed`, []);
  const host = useRef<HTMLDivElement>(null);
  const keyboardDelete = useKeyboardDelete({ document, snapshot, host, domain: 'tree' });
  const keyboardHistory = useKeyboardHistory({ document, snapshot, host, domain: 'tree' });
  const keyboardClipboard = useKeyboardClipboard({
    document,
    snapshot,
    host,
    domain: 'tree',
    treeQuery: query,
    treeClosed: closed,
  });
  const keyboardSelectAll = useKeyboardSelectAll({
    document,
    snapshot,
    host,
    domain: 'tree',
  });
  const drag = useDragDrop(),
    intent = drag?.session?.candidate?.intent;
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const roots = page.children;
  const mounted = useRef(false);
  const permission = useRef<{ context: TreeContext; active: boolean } | null>(null);
  const receipt = useRef<FocusReceipt | null>(null);
  const domainContext: CompletionDomain = {
    document,
    plan: snapshot.plan,
    pageId,
    navigation,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
  };
  const completion = useRef({ context: domainContext, active: true });
  if (
    !completion.current.active ||
    (Object.keys(domainContext) as (keyof CompletionDomain)[]).some(
      (key) => completion.current.context[key] !== domainContext[key],
    )
  ) {
    completion.current.active = false;
    if (receipt.current) receipt.current.active = false;
    completion.current = { context: domainContext, active: true };
  }
  const local = useRef({ query, closed, revision: 0 });
  const composing = useRef(false);
  const focusEpoch = useRef(0);
  const [publication, setPublication] = useState(0);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null);
  if (local.current.query !== query || local.current.closed !== closed) {
    if (permission.current) permission.current.active = false;
    if (receipt.current) receipt.current.active = false;
    local.current = { query, closed, revision: local.current.revision + 1 };
  }
  const setQuery = (value: string) =>
    setSessionQuery((current) => {
      if (value === current) return current;
      if (permission.current) permission.current.active = false;
      if (receipt.current) receipt.current.active = false;
      local.current = { ...local.current, query: value, revision: local.current.revision + 1 };
      return value;
    });
  const setClosed = (
    update: SetStateAction<string[]>,
    source?: { kind: 'selected-effect'; nodeId: string | null },
  ) =>
    setSessionClosed((current) => {
      const value = typeof update === 'function' ? update(current) : update;
      if (value === current) return current;
      if (permission.current) permission.current.active = false;
      const pending = receipt.current;
      const actual = pending?.document.getSnapshot();
      const ancestors =
        pending &&
        new Set(
          nodePath(pending.plan.pages.get(pending.pageId)!.schema, pending.node.id)
            .slice(0, -1)
            .map((entry) => entry.node.id),
        );
      const expected = ancestors && current.filter((id) => !ancestors.has(id));
      const ownCleanup =
        pending?.active &&
        pending.owner.active &&
        completion.current === pending.owner &&
        source?.kind === 'selected-effect' &&
        source.nodeId === pending.node.id &&
        actual?.plan === pending.plan &&
        actual.selection.pageId === pending.pageId &&
        actual.selection.nodeId === pending.node.id &&
        !actual.selection.nodeIds &&
        local.current.query === pending.query &&
        local.current.closed === pending.closed &&
        current === pending.closed &&
        !!expected &&
        expected.length === value.length &&
        expected.every((id, index) => id === value[index]);
      local.current = { ...local.current, closed: value, revision: local.current.revision + 1 };
      if (pending) {
        if (ownCleanup) {
          pending.closed = value;
          pending.revision = local.current.revision;
        } else pending.active = false;
      }
      return value;
    });
  const legacyLabelFor = (node: NodeSchema) => {
    const fieldLabel =
      node.field &&
      page.forms
        ?.find((form) => form.id === node.field!.formId)
        ?.fields.find((field) => field.id === node.field!.fieldId)?.label;
    const value = node.props.title ?? node.props.label;
    const content = node.props.value;
    return (
      fieldLabel ||
      (value?.kind === 'literal' && typeof value.value === 'string' && value.value.trim()
        ? value.value
        : content?.kind === 'literal' && typeof content.value === 'string' && content.value.trim()
          ? content.value
          : (catalog[node.component]?.title ?? node.component))
    );
  };
  const labelFor = (node: NodeSchema) => displayNodeName(node, legacyLabelFor(node));
  const model = useMemo(
    () =>
      buildTreeNavigation({
        roots,
        query,
        closed,
        searchText: (node) =>
          `${labelFor(node)} ${legacyLabelFor(node)} ${catalog[node.component]?.title} ${node.component} ${node.id}`,
        canExpand: (node) => {
          const contract = snapshot.plan.registry.components[node.component];
          return !!(contract.children || Object.keys(contract.slots ?? {}).length);
        },
      }),
    [page, snapshot.plan.registry, query, closed],
  );
  const latest = useRef({ document, snapshot, model, navigation, drag });
  latest.current = { document, snapshot, model, navigation, drag };
  const observeCompletion = () => {
    const pending = receipt.current;
    if (!pending?.active) return;
    const current = latest.current;
    const actual = current.document.getSnapshot();
    const owner = pending.owner;
    const captured = owner.context;
    if (
      !owner.active ||
      completion.current !== owner ||
      current.document !== captured.document ||
      actual.plan !== captured.plan ||
      actual.selection.pageId !== captured.pageId ||
      current.navigation !== captured.navigation ||
      (current.drag?.enabled !== false) !== captured.enabled ||
      !!current.drag?.isInteracting !== captured.interacting
    ) {
      owner.active = false;
      pending.active = false;
    }
  };
  const context: TreeContext = {
    document,
    plan: snapshot.plan,
    selection: snapshot.selection,
    pageId,
    query,
    closed,
    model,
    navigation,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
    revision: local.current.revision,
    publication,
  };
  if (
    !permission.current?.active ||
    (Object.keys(context) as (keyof TreeContext)[]).some(
      (key) => permission.current!.context[key] !== context[key],
    )
  ) {
    if (permission.current) permission.current.active = false;
    permission.current = { context, active: true };
  }
  const generation = permission.current;
  useLayoutEffect(() => {
    mounted.current = true;
    // StrictMode replays the initial mount effects with the same mounted owner.
    if (permission.current) permission.current.active = true;
    completion.current.active = true;
    return () => {
      mounted.current = false;
      if (permission.current) permission.current.active = false;
      completion.current.active = false;
      if (receipt.current) receipt.current.active = false;
    };
  }, []);
  useLayoutEffect(() => {
    const stop = document.subscribe(() => {
      if (!mounted.current || latest.current.document !== document) return;
      observeCompletion();
      if (permission.current) permission.current.active = false;
      // A subscriber may synchronously render before this listener executes.
      // Schedule a fresh local generation instead of leaving those callbacks expired.
      setPublication((value) => value + 1);
    });
    return () => {
      stop();
    };
  }, [document]);
  const active = () => {
    observeCompletion();
    if (!mounted.current || !generation.active || permission.current !== generation) return false;
    const actual = document.getSnapshot();
    const current = latest.current;
    if (
      current.document !== document ||
      actual.plan !== context.plan ||
      actual.selection !== context.selection ||
      current.snapshot.plan !== context.plan ||
      current.snapshot.selection !== context.selection ||
      current.model !== model ||
      local.current.query !== context.query ||
      local.current.closed !== context.closed ||
      local.current.revision !== context.revision ||
      (current.drag?.enabled !== false) !== context.enabled ||
      !!current.drag?.isInteracting !== context.interacting
    ) {
      generation.active = false;
      return false;
    }
    return canNavigate();
  };
  const expand = (id: string | null, source?: 'selected-effect') => {
    const path = nodePath(page, id)
      .slice(0, -1)
      .map((entry) => entry.node.id);
    setClosed(
      (current) =>
        current.some((id) => path.includes(id))
          ? current.filter((id) => !path.includes(id))
          : current,
      source && { kind: source, nodeId: id },
    );
  };
  useEffect(() => {
    if (!navigation.isKeyboardPresentation(document, snapshot)) expand(nodeId, 'selected-effect');
  }, [pageId, nodeId]);
  const reveal = (id: string) => {
    const element = [
      ...(host.current?.querySelectorAll<HTMLElement>('[data-editor-tree-node]') ?? []),
    ].find((row) => row.dataset.editorTreeNode === id);
    const scroll = host.current?.closest<HTMLElement>('.sidebar-content');
    if (element && scroll) revealRect(scroll, element.getBoundingClientRect(), 12);
    element?.querySelector<HTMLElement>('.tree-select')?.focus({ preventScroll: true });
    return !!element;
  };
  function locate() {
    if (!nodeId || !canAuthor() || drag?.isInteracting || !interaction.enabled) return;
    if (navigation.requestLocate('tree', nodeId)) return;
  }
  useLayoutEffect(() => {
    const request = interaction.request;
    if (
      !request ||
      request.destination !== 'tree' ||
      request.pageId !== pageId ||
      !navigation.isCurrent(request)
    )
      return;
    setQuery('');
    expand(request.nodeId);
    const frame = requestAnimationFrame(() => {
      if (!navigation.isCurrent(request)) return;
      navigation.complete(
        request,
        reveal(request.nodeId) ? `已在组件树定位 ${request.nodeId}` : '当前组件不在组件树中',
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [interaction.request, navigation, pageId]);
  const captureFocus = (event: FocusEvent<HTMLElement>, kind: 'focus' | 'blur') => {
    focusEpoch.current++;
    const pending = receipt.current;
    if (!pending?.active) return;
    if (pending.phase !== 'focus') {
      pending.active = false;
      return;
    }
    if (kind === 'blur' && event.target === pending.origin && !pending.blurred && !pending.focused)
      pending.blurred = true;
    else if (
      kind === 'focus' &&
      event.target === pending.target &&
      pending.blurred &&
      !pending.focused
    )
      pending.focused = true;
    else pending.active = false;
  };
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, nodeId: string) => {
    if (!navigationKeys.has(event.key)) return;
    const native = event.nativeEvent;
    const element = host.current;
    const origin = event.currentTarget;
    if (
      !element ||
      event.defaultPrevented ||
      native.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      native.isComposing ||
      native.keyCode === 229 ||
      composing.current ||
      !active() ||
      latest.current.drag?.isInteracting ||
      event.target !== origin ||
      origin.ownerDocument.activeElement !== origin ||
      !model.byId.has(nodeId) ||
      !eligibleTreeButton(origin, element, nodeId)
    )
      return;
    const path = native.composedPath();
    if (
      path[0] !== origin ||
      !path.includes(element) ||
      path.some((entry) => entry instanceof ShadowRoot)
    )
      return;
    const action = treeNavigationAction(model, nodeId, event.key as TreeNavigationKey);
    const targetRow =
      action.kind === 'move'
        ? [...element.querySelectorAll<HTMLElement>('[data-editor-tree-node]')].find(
            (row) => row.dataset.editorTreeNode === action.nodeId,
          )
        : undefined;
    const target = targetRow?.querySelector<HTMLButtonElement>('.tree-select');
    if (action.kind === 'move' && (!target || !eligibleTreeButton(target, element, action.nodeId)))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === 'none') return;
    if (action.kind === 'expand' || action.kind === 'collapse') {
      setClosed((current) =>
        action.kind === 'expand'
          ? current.filter((id) => id !== action.nodeId)
          : [...current, action.nodeId],
      );
      return;
    }
    const destination = model.byId.get(action.nodeId)!;
    const pending: FocusReceipt = {
      active: true,
      owner: completion.current,
      document,
      plan: snapshot.plan,
      pageId,
      host: element,
      origin,
      target: target!,
      node: destination.node,
      query: local.current.query,
      closed: local.current.closed,
      revision: local.current.revision,
      enabled: context.enabled,
      focusEpoch: focusEpoch.current,
      phase: 'select',
      blurred: false,
      focused: false,
    };
    if (receipt.current) receipt.current.active = false;
    receipt.current = pending;
    const initial = document.getSnapshot();
    const expectedPublications =
      initial.selection.nodeId === action.nodeId && !initial.selection.nodeIds ? 0 : 1;
    let publications = 0;
    let observed: EditorSnapshot | undefined;
    const stop = document.subscribe(() => {
      publications++;
      observed = document.getSnapshot();
    });
    const accepted = () => {
      observeCompletion();
      const actual = document.getSnapshot();
      const current = latest.current;
      return (
        mounted.current &&
        pending.active &&
        pending.owner.active &&
        completion.current === pending.owner &&
        receipt.current === pending &&
        host.current === pending.host &&
        current.document === pending.document &&
        current.snapshot.plan === pending.plan &&
        current.snapshot.selection.pageId === pending.pageId &&
        actual.plan === pending.plan &&
        actual.selection.pageId === pending.pageId &&
        actual.selection.nodeId === pending.node.id &&
        !actual.selection.nodeIds &&
        publications === expectedPublications &&
        (expectedPublications === 0
          ? actual.selection === initial.selection
          : observed?.plan === actual.plan && observed.selection === actual.selection) &&
        local.current.query === pending.query &&
        local.current.closed === pending.closed &&
        local.current.revision === pending.revision &&
        (current.drag?.enabled !== false) === pending.enabled &&
        !current.drag?.isInteracting &&
        current.model.byId.get(pending.node.id)?.node === pending.node &&
        eligibleTreeButton(pending.origin, pending.host, nodeId) &&
        eligibleTreeButton(pending.target, pending.host, pending.node.id)
      );
    };
    try {
      document.select(pageId, action.nodeId);
      if (!accepted()) return;
      navigation.setSelectedInstance({ pageId, nodeId: action.nodeId });
      if (
        !accepted() ||
        focusEpoch.current !== pending.focusEpoch ||
        origin.ownerDocument.activeElement !== origin
      )
        return;
      pending.phase = 'focus';
      pending.target.focus({ preventScroll: true });
      if (!accepted() || pending.target.ownerDocument.activeElement !== pending.target) return;
      const scroll = element.closest<HTMLElement>('.sidebar-content');
      if (scroll) revealRect(scroll, targetRow!.getBoundingClientRect(), 12);
    } catch {
      // A refused command or synchronous observer cannot acquire later focus.
    } finally {
      stop();
      pending.active = false;
      if (receipt.current === pending) receipt.current = null;
    }
  };
  function nodes(list: readonly TreeNavigationNode[]) {
    return (
      <ul>
        {list.map((entry) => {
          const { node, expandable, open } = entry;
          const contract = snapshot.plan.registry.components[node.component];
          const candidate =
            intent &&
            ((intent.kind !== 'inside' && intent.nodeId === node.id) ||
              (intent.kind === 'inside' && intent.parentId === node.id && !intent.slot));
          const title = catalog[node.component]?.title ?? node.component;
          return (
            <li key={node.id}>
              <div
                data-editor-tree-node={node.id}
                data-editor-hovered={
                  (interaction.hover?.pageId === pageId && interaction.hover.nodeId === node.id) ||
                  undefined
                }
                onPointerEnter={() => navigation.setHover({ pageId, nodeId: node.id }, 'tree')}
                onPointerLeave={() => navigation.clearHover('tree', { pageId, nodeId: node.id })}
                className={`tree-row ${candidate ? `drop-${intent.kind} ${drag?.session?.candidate?.valid ? 'valid' : 'invalid'}` : ''}`}
              >
                {expandable ? (
                  <Button
                    className="tree-toggle"
                    aria-label={`${open ? '折叠' : '展开'} ${node.id}`}
                    aria-expanded={open}
                    onClick={() =>
                      setClosed((current) =>
                        open ? [...current, node.id] : current.filter((id) => id !== node.id),
                      )
                    }
                  >
                    <ChevronRight size={12} className={open ? 'rotate-90' : ''} />
                  </Button>
                ) : (
                  <span className="tree-spacer" />
                )}
                <Tip
                  content={describeNodeName(node, title)}
                  side="right"
                  disabled={!!drag?.isInteracting}
                >
                  <Button
                    className="tree-select"
                    aria-label={`选中 ${displayNodeName(node, title)}${displayNodeName(node, title) !== title ? ` ${title}` : ''} ${node.id}`}
                    aria-pressed={selected.has(node.id)}
                    disabled={!!drag?.isInteracting}
                    onContextMenu={(event) => {
                      if (drag?.isInteracting) return;
                      event.preventDefault();
                      event.stopPropagation();
                      if (!selected.has(node.id)) document.select(pageId, node.id);
                      setContextMenu({ x: event.clientX, y: event.clientY, pageId, nodeId: node.id });
                    }}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!event.repeat && canAuthor()) document.toggleSelect(pageId, node.id);
                      } else navigate(event, node.id);
                    }}
                    onClick={(event) => {
                      if (event.ctrlKey || event.metaKey) {
                        if (!canAuthor()) return;
                        document.toggleSelect(pageId, node.id);
                      } else {
                        if (!canNavigate()) return;
                        document.select(pageId, node.id);
                      }
                      const current = document.getSnapshot().selection;
                      if (current.nodeId === node.id)
                        navigation.setSelectedInstance({ pageId, nodeId: node.id });
                    }}
                  >
                    <span className="tree-icon">
                      <MaterialIcon name={catalog[node.component]?.icon} size={14} />
                    </span>
                    <span>{labelFor(node)}</span>
                    {(node.lock || node.hidden) && (
                      <span className="tree-flags" aria-hidden="true">
                        {node.lock && <Lock size={11} data-flag="lock" />}
                        {node.hidden && <EyeOff size={11} data-flag="hidden" />}
                      </span>
                    )}
                  </Button>
                </Tip>
                {onEditProperties && nodeId === node.id && selected.size === 1 && (
                  <Tip content="编辑属性" side="right" disabled={!!drag?.isInteracting}>
                    <Button
                      variant="ghost"
                      aria-label={`编辑属性 ${node.id}`}
                      disabled={!!drag?.session}
                      onClick={() => {
                        if (canNavigate()) onEditProperties();
                      }}
                    >
                      <SlidersHorizontal size={14} />
                      属性
                    </Button>
                  </Tip>
                )}
                {nodeId === node.id && (
                  <Tip content="在画布定位" side="right" disabled={!!drag?.isInteracting}>
                    <Button
                      className="tree-locate"
                      variant="ghost"
                      aria-label={`在画布定位 ${node.id}`}
                      disabled={!interaction.enabled || !!drag?.isInteracting}
                      onClick={() => {
                        if (canAuthor()) navigation.requestLocate('canvas', node.id);
                      }}
                    >
                      <ScanSearch size={13} />
                    </Button>
                  </Tip>
                )}
                <DragHandle
                  source={{ kind: 'node', nodeId: node.id }}
                  label={`拖动 ${title} ${node.id}`}
                />
              </div>
              {open && (
                <>
                  {node.children?.length
                    ? nodes(entry.children)
                    : contract.children && (
                        <DropZone
                          intent={{ kind: 'inside', parentId: node.id }}
                          label="空容器 · 拖入组件"
                        />
                      )}
                  {entry.slots.map(({ name, children }) => (
                    <div className="tree-slot" key={name}>
                      <span>↳ {name}</span>
                      {nodes(children)}
                      <DropZone
                        intent={{ kind: 'inside', parentId: node.id, slot: name }}
                        label={`${name} · 拖入组件`}
                      />
                    </div>
                  ))}
                </>
              )}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div
      className="component-tree"
      ref={host}
      role="region"
      aria-label="组件树"
      tabIndex={-1}
      onFocusCapture={(event) => captureFocus(event, 'focus')}
      onBlurCapture={(event) => captureFocus(event, 'blur')}
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      onPointerDownCapture={() => {
        if (receipt.current) receipt.current.active = false;
      }}
      onKeyDown={(event) => {
        if (isClipboardKeyFamily(event)) keyboardClipboard.onKeyDown(event);
        else if (isDuplicateKeyFamily(event)) {
          if (!contextMenu) keyboardHistory.onKeyDown(event);
        } else if (isHistoryKeyFamily(event)) keyboardHistory.onKeyDown(event);
        else if ((event.ctrlKey || event.metaKey) && /^[a]$/i.test(event.key))
          keyboardSelectAll.onKeyDown(event);
        else keyboardDelete.onKeyDown(event);
      }}
    >
      <div className="panel-search">
        <Input
          aria-label="搜索组件树"
          placeholder="搜索组件或 ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Tip content="定位当前节点">
          <Button
            aria-label="定位当前节点"
            disabled={!nodeId || !!drag?.isInteracting || !interaction.enabled}
            onClick={locate}
          >
            <LocateFixed size={14} />
          </Button>
        </Tip>
        <Tip content="在画布定位">
          <Button
            aria-label="在画布定位"
            disabled={!nodeId || !!drag?.isInteracting || !interaction.enabled}
            onClick={() => nodeId && navigation.requestLocate('canvas', nodeId)}
          >
            <ScanSearch size={14} />
          </Button>
        </Tip>
      </div>
      <SelectionControls document={document} snapshot={snapshot} />
      {keyboardDelete.error && (
        <p className="editor-note" role="alert">
          {keyboardDelete.error}
        </p>
      )}
      {keyboardHistory.error && (
        <p className="editor-note" role="alert">
          {keyboardHistory.error}
        </p>
      )}
      {keyboardClipboard.feedback && (
        <p className="editor-note" role={keyboardClipboard.feedback.error ? 'alert' : 'status'}>
          {keyboardClipboard.feedback.message}
        </p>
      )}
      {nodes(model.roots)}
      {query && !model.roots.length && <p className="editor-note">没有匹配的组件</p>}
      <DropZone intent={{ kind: 'inside' }} label="页面末尾" />
      <NodeContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(null)}
        document={document}
        snapshot={snapshot}
        authoringAllowed={canAuthor()}
      />
    </div>
  );
}
