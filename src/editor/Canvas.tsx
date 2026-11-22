import { editorContext } from './context';
import {
  Fragment,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
  type HTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import {
  RuntimeRenderer,
  type NodeRenderProps,
  type SlotRenderProps,
} from '../../packages/react-runtime/Renderer';
import type { PageRuntime } from '../../packages/runtime/engine';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { materials } from '../materials';
import { catalog } from './catalog';
import { DropZone, useDragDrop } from './DragDrop';
import { nodeFlow, nodeRect } from './geometry';
import { CanvasSurface, useViewportMetrics } from './CanvasViewport';
import { ArrowUp, Copy, Trash2, ListTree, PanelsTopLeft } from 'lucide-react';
import { useEditorNavigation, useOptionalEditorSession } from './session';
import {
  CanvasHost,
  canvasViewport,
  nearestInstance,
  clippingBounds,
  intersectRect,
  type CanvasRect,
} from './CanvasHost';
import './navigation.css';
import './overlay-focus.css';
import {
  isDesignOverlay,
  overlayDefinition,
  resolveOverlayFocus,
  overlayPresentation,
  type OverlayFocus,
} from './overlay-focus';
import { Button, Tip } from '../ui/primitives';
import { errorText } from './errors';
import { selectedNodeIds } from '../../packages/editor/selection';
import { useAuthorGuard } from './author-guard';
import { SelectionControls } from './SelectionControls';
import { NodeContextMenu, type NodeContextMenuState } from './NodeContextMenu';
import {
  isDeleteKey,
  isHistoryKeyFamily,
  isClipboardKeyFamily,
  useKeyboardDelete,
  useKeyboardHistory,
  useKeyboardClipboard,
  useKeyboardNudge,
  useKeyboardSelectAll,
} from './keyboard-authoring';
import { useStandaloneCanvasEscape } from './author-escape';
import { describeNodeName, displayNodeName } from './node-display-name';
import { useCanvasStage, useCanvasStageVersion } from './canvas-stage';
import { RuntimeDomProvider, isDocumentElement } from '../ui/runtime-dom';
import { toParentRect } from './coordinates';
import { useCanvasMarquee } from './CanvasMarquee';
import { CanvasResize } from './CanvasResize';

function CanvasEditorLayer({
  as = 'div',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'p' | 'span' | 'fragment' }) {
  const stage = useCanvasStage();
  const element = as === 'fragment' ? children : createElement(as, props, children);
  return !stage
    ? element
    : stage.overlay
      ? createPortal(
          <RuntimeDomProvider environment={undefined}>{element}</RuntimeDomProvider>,
          stage.overlay,
        )
      : null;
}
const stagePlatformStyle = `
.editor-canvas.edit[data-editor-multi] .editor-surface [data-editor-selected='true'],
.editor-canvas.edit[data-editor-multi] .editor-surface [data-editor-selected='true'] * {
  cursor: pointer;
}
.editor-canvas { outline: none; }
.editor-canvas:focus-visible {
  outline: 1px dashed #d6def3;
  outline-offset: 8px;
}
`;

export type CanvasMode = 'edit' | 'preview';
const CanvasSelection = editorContext<ReadonlySet<string>>('canvas-selection', new Set());
// Keep the decorator identity and tree stable while switching modes or selecting nodes.
function NodeHost({ node, instanceKey, children, inactiveReason, presentation }: NodeRenderProps) {
  const drag = useDragDrop();
  const selected = useContext(CanvasSelection).has(node.id);
  if (inactiveReason && !drag?.enabled) return null;
  return (
    <div
      className="editor-node"
      data-editor-node={node.id}
      data-editor-instance={instanceKey}
      data-editor-inactive={inactiveReason}
      data-editor-overlay={isDesignOverlay(node) ? node.id : undefined}
      data-editor-design-hidden={presentation?.hidden || undefined}
      style={presentation?.hidden ? { display: 'none' } : undefined}
      data-editor-selected={selected || undefined}
    >
      {inactiveReason ? (
        <div className="canvas-inactive-node">
          <Tip content={describeNodeName(node, catalog[node.component]?.title ?? node.component)}>
            <strong className="node-author-label">
              {displayNodeName(node, catalog[node.component]?.title ?? node.component)} · {node.id}
            </strong>
          </Tip>
          <span>
            {inactiveReason === 'empty-repeat'
              ? '循环数据为空'
              : inactiveReason === 'field'
                ? '字段当前不可见'
                : inactiveReason === 'author-hidden'
                  ? '作者已隐藏'
                  : '显示条件未满足'}{' '}
            · 预览时隐藏
          </span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
function ChildrenHost({ node, children }: NodeRenderProps) {
  return (
    <>
      {children}
      {!node.children?.length && (
        <DropZone
          intent={{ kind: 'inside', parentId: node.id }}
          label={`${catalog[node.component]?.title ?? node.component} · 空容器，拖入组件`}
        />
      )}
    </>
  );
}
function SlotHost({ node, slotName, children }: SlotRenderProps) {
  return (
    <>
      {children}
      <DropZone
        intent={{ kind: 'inside', parentId: node.id, slot: slotName }}
        label={`${slotName} 插槽 · 拖入组件`}
      />
    </>
  );
}
interface Box {
  key: string;
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  selected: boolean;
  pageId: string;
  runtime: PageRuntime;
  drop?: 'line' | 'inside';
  valid?: boolean;
  axis?: 'x' | 'y';
  toolbar?: { left: number; top: number; width: number };
  resize?: { marker: HTMLElement; bounds: CanvasRect; outline: CanvasRect };
}
export function EditorCanvas({
  document,
  snapshot,
  runtime,
  mode,
  children,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  runtime: PageRuntime;
  mode: CanvasMode;
  children?: ReactNode;
}) {
  const canvas = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const stage = useCanvasStage();
  useCanvasStageVersion(stage);
  const bindCanvas = useCallback(
    (element: HTMLDivElement | null) => {
      canvas.current = element;
      stage?.setAuthor(element);
    },
    [stage],
  );
  const Surface = stage ? Fragment : CanvasSurface;
  const { navigation, state: interaction } = useEditorNavigation();
  const session = useOptionalEditorSession();
  const viewportMetrics = useViewportMetrics();
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [actionError, setActionError] = useState('');
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null);
  const [focusState, setFocusState] = useState<{
    document: EditorDocument;
    focus: OverlayFocus;
  } | null>(null);
  const heldSelection = useRef<{
    selection: EditorSnapshot['selection'];
    instance: typeof interaction.selectedInstance;
  } | null>(null);
  const pointerSelection = useRef<{
    id: string | null;
    instanceKey?: string;
    applied?: boolean;
  } | null>(null);
  const drag = useDragDrop();
  const candidate = drag?.session?.candidate;
  const offerStandaloneEscape = useStandaloneCanvasEscape(drag === null && mode === 'edit');
  const { pageId, nodeId } = snapshot.selection;
  const selectedIds = useMemo(
    () => new Set(selectedNodeIds(snapshot.selection)),
    [snapshot.selection],
  );
  const canAuthor = useAuthorGuard(document, snapshot, undefined, mode === 'edit');
  const marquee = useCanvasMarquee({
    stage,
    enabled: mode === 'edit',
    document,
    snapshot,
    runtime,
    width: viewportMetrics?.width,
    scale: viewportMetrics?.scale,
    canAuthor,
    onSelect: (hits, additive) => {
      const ids = additive ? [...new Set([...selectedIds, ...hits.keys()])] : [...hits.keys()];
      document.selectMany(pageId, ids, additive ? (nodeId ?? undefined) : undefined);
      const primary = document.getSnapshot().selection.nodeId;
      if (primary && hits.has(primary))
        navigation.setSelectedInstance({ pageId, nodeId: primary, instanceKey: hits.get(primary) });
    },
  });
  const keyboardDelete = useKeyboardDelete({
    document,
    snapshot,
    host: canvas,
    domain: 'canvas',
    enabled: mode === 'edit',
  });
  const keyboardHistory = useKeyboardHistory({
    document,
    snapshot,
    host: canvas,
    domain: 'canvas',
    enabled: mode === 'edit',
  });
  const keyboardClipboard = useKeyboardClipboard({
    document,
    snapshot,
    host: canvas,
    domain: 'canvas',
    enabled: mode === 'edit',
    canvasRuntime: runtime,
  });
  const keyboardSelectAll = useKeyboardSelectAll({
    document,
    snapshot,
    host: canvas,
    domain: 'canvas',
    enabled: mode === 'edit',
  });
  const keyboardNudge = useKeyboardNudge({
    document,
    snapshot,
    host: canvas,
    enabled: mode === 'edit',
  });
  const hover = interaction.hover?.pageId === pageId ? interaction.hover : null;
  useLayoutEffect(
    () =>
      stage?.onInvalidate((reason) => {
        if (reason !== 'retire') return;
        navigation.clearHover('canvas');
        heldSelection.current = null;
        pointerSelection.current = null;
        setBoxes([]);
      }),
    [stage, navigation],
  );
  useLayoutEffect(() => {
    navigation.bind({
      document,
      plan: snapshot.plan,
      pageId,
      enabled: mode === 'edit',
      dragging: !!drag?.isInteracting,
    });
  }, [navigation, document, snapshot.plan, snapshot.selection, pageId, mode, drag?.isInteracting]);
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const emptyPage = (page.children?.length ?? 0) === 0;
  const focus =
    mode === 'edit' && focusState?.document === document && focusState.focus.pageId === pageId
      ? focusState.focus
      : null;
  useLayoutEffect(() => {
    if (mode !== 'edit' || !surface.current) {
      setFocusState(null);
      heldSelection.current = null;
      return;
    }
    if (drag?.isInteracting) {
      heldSelection.current = {
        selection: snapshot.selection,
        instance: interaction.selectedInstance,
      };
      return;
    }
    const held = heldSelection.current;
    const explicit =
      interaction.request?.destination === 'canvas' && navigation.isCurrent(interaction.request);
    if (
      held &&
      held.selection === snapshot.selection &&
      held.instance === interaction.selectedInstance &&
      !explicit
    )
      return;
    heldSelection.current = null;
    const next = resolveOverlayFocus(surface.current, page, nodeId, interaction.selectedInstance);
    setFocusState((current) =>
      current?.document === document && JSON.stringify(current.focus) === JSON.stringify(next)
        ? current
        : next
          ? { document, focus: next }
          : null,
    );
  }, [
    document,
    page,
    pageId,
    nodeId,
    snapshot.selection,
    mode,
    drag?.isInteracting,
    interaction.selectedInstance,
    interaction.request,
    navigation,
    stage?.environment,
  ]);
  const designPresentation = useMemo(
    () => (node: Parameters<typeof overlayPresentation>[1], instanceKey: string) =>
      overlayPresentation(focus, node, instanceKey),
    [focus],
  );
  useLayoutEffect(() => {
    const request = interaction.request;
    if (
      !request ||
      request.destination !== 'canvas' ||
      !navigation.isCurrent(request) ||
      mode !== 'edit' ||
      drag?.isInteracting
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (!navigation.isCurrent(request) || !surface.current) return;
      const result = new CanvasHost(surface.current).locate(
        snapshot.plan.pages.get(pageId)!.schema,
        request.nodeId,
        request.instanceKey,
      );
      const reasons: Record<string, string> = {
        condition: '显示条件未满足',
        'author-hidden': '作者已隐藏',
        field: '字段当前不可见',
        'empty-repeat': '循环数据为空',
      };
      navigation.complete(
        request,
        !result
          ? `组件 ${request.nodeId} 当前不可见，未找到可定位内容`
          : result.fallback
            ? `组件 ${request.nodeId} 当前不可见，已定位可见祖先 ${result.nodeId}${result.inactiveReason ? ' · ' + (reasons[result.inactiveReason] ?? result.inactiveReason) : ''}`
            : result.inactiveReason
              ? `已定位 ${request.nodeId} 的设计占位 · ${reasons[result.inactiveReason] ?? result.inactiveReason}`
              : request.instanceKey && result.key !== request.instanceKey
                ? `原实例已不可见，已定位 ${request.nodeId} 的最近可见实例`
                : `已在画布定位 ${request.nodeId}`,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    interaction.request,
    navigation,
    mode,
    pageId,
    snapshot.plan,
    drag?.isInteracting,
    stage?.environment,
  ]);
  useEffect(() => {
    setActionError('');
  }, [pageId, nodeId, snapshot.plan]);
  const isEditorControl = (target: EventTarget | null) =>
    (isDocumentElement(target, canvas.current?.ownerDocument) ||
      (!!stage?.overlay && isDocumentElement(target, stage.overlay.ownerDocument))) &&
    !!target.closest('[data-drag-source], [data-canvas-action]');
  const actOnNode = (action: () => unknown) => {
    if (!canAuthor() || selectedIds.size > 1) return;
    try {
      action();
      setActionError('');
    } catch (error) {
      setActionError(errorText(error));
    }
  };
  useEffect(() => {
    // Only a committed same-page plan change reveals its selected node.
    // Initial mounts, page/document switches and a plain runtime reset keep local scroll.
    const committed = navigation.enterCanvas({ document, pageId, plan: snapshot.plan });
    if (
      !committed ||
      mode !== 'edit' ||
      drag?.isInteracting ||
      !nodeId ||
      navigation.isKeyboardPresentation(document, snapshot)
    )
      return;
    if (surface.current)
      new CanvasHost(surface.current).locate(snapshot.plan.pages.get(pageId)!.schema, nodeId);
  }, [runtime, mode]);
  useEffect(() => {
    if (mode !== 'edit') return;
    const content = surface.current!;
    const original = new Map<Element, string | null>();
    const suppress = () => {
      for (const element of content.querySelectorAll(
        'a[href],button,input,textarea,select,summary,iframe,object,embed,[tabindex],[contenteditable]',
      )) {
        const current = element.getAttribute('tabindex');
        if (!original.has(element) || current !== '-1') original.set(element, current);
        if (current !== '-1') element.setAttribute('tabindex', '-1');
      }
    };
    const observer = new MutationObserver(suppress);
    observer.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['tabindex', 'href', 'contenteditable', 'disabled'],
    });
    suppress();
    return () => {
      observer.disconnect();
      for (const [element, value] of original)
        if (value === null) element.removeAttribute('tabindex');
        else element.setAttribute('tabindex', value);
    };
  }, [mode, runtime]);
  useEffect(() => {
    if (mode !== 'edit') {
      setBoxes([]);
      return;
    }
    const host = stage?.current()?.overlay ?? canvas.current!,
      content = surface.current!;
    let frame = 0;
    const measure = () => {
      if (stage && !stage.current()) {
        setBoxes([]);
        return;
      }
      const base = host.getBoundingClientRect();
      const next: Box[] = [];
      const markers = new Map<string, HTMLElement>();
      for (const marker of content.querySelectorAll<HTMLElement>('[data-editor-node]')) {
        const id = marker.dataset.editorNode!;
        markers.set(marker.dataset.editorInstance!, marker);
        const intent = candidate?.intent;
        const dropHere =
          intent &&
          (intent.kind === 'inside'
            ? intent.parentId === id && !intent.slot
            : intent.nodeId === id);
        if (!selectedIds.has(id) && id !== hover?.nodeId && !dropHere) continue;
        const raw = nodeRect(marker);
        const rect = raw && toParentRect(raw, marker.ownerDocument);
        if (!rect) continue;
        const { left, top, right, bottom } = rect;
        const box = {
          key: marker.dataset.editorInstance!,
          id,
          left: left - base.left + host.scrollLeft,
          top: top - base.top + host.scrollTop,
          width: right - left,
          height: bottom - top,
          selected: selectedIds.has(id),
          pageId,
          runtime,
        };
        if (
          selectedIds.has(id) ||
          (id === hover?.nodeId &&
            (!hover.instanceKey || hover.instanceKey === marker.dataset.editorInstance))
        )
          next.push(box);
        if (dropHere) {
          const { axis, reverse } = nodeFlow(marker);
          const atEnd = intent.kind === 'after' ? !reverse : reverse;
          next.push({
            ...box,
            key: box.key + '/drop',
            selected: false,
            drop: intent.kind === 'inside' ? 'inside' : 'line',
            valid: candidate!.valid,
            axis,
            left:
              intent.kind !== 'inside' && axis === 'x' && atEnd
                ? right - base.left + host.scrollLeft
                : box.left,
            top:
              intent.kind !== 'inside' && axis === 'y' && atEnd
                ? bottom - base.top + host.scrollTop
                : box.top,
            width: intent.kind !== 'inside' && axis === 'x' ? 0 : box.width,
            height: intent.kind === 'inside' || axis === 'x' ? box.height : 0,
          });
        }
      }
      const viewport = canvasViewport(content);
      const contextRect = host
        .querySelector<HTMLElement>('.canvas-overlay-context')
        ?.getBoundingClientRect();
      const visible = next
        .filter((box) => box.selected && box.id === nodeId)
        .flatMap((box) => {
          const fullRect = {
            left: box.left + base.left - host.scrollLeft,
            top: box.top + base.top - host.scrollTop,
            right: box.left + base.left - host.scrollLeft + box.width,
            bottom: box.top + base.top - host.scrollTop + box.height,
            width: box.width,
            height: box.height,
          };
          const marker = markers.get(box.key);
          const clipped = marker && clippingBounds(marker, content);
          // Keep the full toolbar below an overlapping sticky editing header.
          const contextOverlaps =
            clipped &&
            contextRect &&
            contextRect.width > 0 &&
            contextRect.height > 0 &&
            contextRect.bottom > clipped.top &&
            contextRect.top < clipped.bottom &&
            contextRect.right > clipped.left &&
            contextRect.left < clipped.right;
          const bounds =
            clipped && contextOverlaps
              ? intersectRect(clipped, {
                  left: clipped.left,
                  right: clipped.right,
                  top: Math.max(clipped.top, contextRect.bottom + 4),
                  bottom: clipped.bottom,
                  width: clipped.right - clipped.left,
                  height: clipped.bottom - Math.max(clipped.top, contextRect.bottom + 4),
                })
              : clipped;
          const rect = bounds && intersectRect(fullRect, bounds);
          return marker && rect && bounds
            ? [{ key: box.key, rect, fullRect, bounds, box, marker }]
            : [];
        });
      const preferred =
        interaction.selectedInstance?.nodeId === nodeId
          ? interaction.selectedInstance.instanceKey
          : undefined;
      const primary = nearestInstance(visible, viewport, preferred);
      if (primary) {
        const bounds = primary.bounds;
        primary.box.resize = { marker: primary.marker, bounds, outline: primary.fullRect };
        const width = Math.min(218, Math.max(0, bounds.width - 8));
        const left = Math.max(
          bounds.left + 4,
          Math.min(primary.fullRect.right - width, bounds.right - width - 4),
        );
        const below = primary.fullRect.bottom + 2;
        const preferredTop =
          primary.fullRect.top - 30 >= bounds.top + 4
            ? primary.fullRect.top - 30
            : below <= bounds.bottom - 30
              ? below
              : Math.max(bounds.top + 4, primary.fullRect.top + 2);
        const top = Math.max(bounds.top + 2, Math.min(preferredTop, bounds.bottom - 30));
        if (width >= 112 && bounds.height >= 30)
          primary.box.toolbar = {
            left: left - primary.fullRect.left,
            top: top - primary.fullRect.top,
            width,
          };
      }

      setBoxes(next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const observe = () => {
      resize?.disconnect();
      resize?.observe(content);
      for (const element of content.querySelectorAll('*'))
        if (!element.hasAttribute('data-editor-node')) resize?.observe(element);
      schedule();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    observe();
    const childDocument = stage?.current()?.environment.document;
    const child = childDocument?.defaultView;
    const childFonts = childDocument?.fonts;
    child?.addEventListener('resize', schedule);
    child?.addEventListener('scroll', schedule, true);
    childFonts?.addEventListener('loadingdone', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.document.fonts?.addEventListener('loadingdone', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation.disconnect();
      child?.removeEventListener('resize', schedule);
      child?.removeEventListener('scroll', schedule, true);
      childFonts?.removeEventListener('loadingdone', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [
    mode,
    nodeId,
    selectedIds,
    pageId,
    runtime,
    hover,
    candidate,
    interaction.selectedInstance,
    viewportMetrics?.width,
    viewportMetrics?.scale,
    stage?.environment,
  ]);
  const markerFor = (target: EventTarget | null) =>
    isDocumentElement(target, canvas.current?.ownerDocument)
      ? target.closest<HTMLElement>('[data-editor-node]')
      : null;
  const block = (event: SyntheticEvent) => {
    if (mode === 'edit') {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const select = (event: SyntheticEvent) => {
    if (mode !== 'edit') return;
    if (isEditorControl(event.target)) return;
    if (!canAuthor()) return;
    if (event.type === 'click' && marquee.suppressClick.current) {
      marquee.suppressClick.current = false;
      pointerSelection.current = null;
      block(event);
      return;
    }
    if (
      event.type === 'click' &&
      event.nativeEvent instanceof canvas.current!.ownerDocument.defaultView!.MouseEvent &&
      event.nativeEvent.detail > 0 &&
      pointerSelection.current?.applied
    ) {
      pointerSelection.current = null;
      block(event);
      return;
    }
    const marker = markerFor(event.target);
    const clicked =
      event.type === 'click' &&
      event.nativeEvent instanceof canvas.current!.ownerDocument.defaultView!.MouseEvent &&
      event.nativeEvent.detail > 0 &&
      pointerSelection.current;
    const selectedId = clicked ? clicked.id : (marker?.dataset.editorNode ?? null);
    const modified = 'ctrlKey' in event && (event.ctrlKey || ('metaKey' in event && event.metaKey));
    if (modified && selectedId) document.toggleSelect(pageId, selectedId);
    else document.select(pageId, selectedId);
    if (selectedId && document.getSnapshot().selection.nodeId === selectedId)
      navigation.setSelectedInstance({
        pageId,
        nodeId: selectedId,
        instanceKey: clicked ? clicked.instanceKey : marker?.dataset.editorInstance,
      });
    if (event.type === 'click') pointerSelection.current = null;
    else if (pointerSelection.current) pointerSelection.current.applied = true;
    block(event);
    canvas.current?.focus({ preventScroll: true });
  };
  const selected = nodeId && findNode(snapshot.plan.pages.get(pageId)!.schema, nodeId)?.node;
  return (
    <div
      className={`editor-canvas ${mode} ${drag?.session?.method === 'pointer' ? 'dragging' : ''}`}
      data-editor-multi={selectedIds.size > 1 || undefined}
      ref={bindCanvas}
      tabIndex={mode === 'edit' ? 0 : undefined}
      aria-label={mode === 'edit' ? '页面编辑画布' : '页面交互预览'}
      data-overlay-focus-node={focus?.nodeId}
      data-overlay-focus-instance={focus?.instanceKey}
      onPointerDownCapture={(event) => {
        if (mode !== 'edit' || isEditorControl(event.target) || event.button !== 0 || !canAuthor())
          return;
        marquee.suppressClick.current = false;
        if (marquee.gesture.current) return;
        const marker = markerFor(event.target);
        if (
          surface.current &&
          (!marker || event.shiftKey) &&
          marquee.begin(event, surface.current, !!marker)
        ) {
          pointerSelection.current = null;
          navigation.clearHover('canvas');
          return;
        }
        pointerSelection.current = {
          id: marker?.dataset.editorNode ?? null,
          instanceKey: marker?.dataset.editorInstance,
        };
        const selectedMarker = marker?.closest<HTMLElement>('[data-editor-selected="true"]');
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          selectedIds.size === 1 &&
          nodeId &&
          selectedMarker?.dataset.editorNode === nodeId
        ) {
          drag?.begin({ kind: 'node', nodeId }, event);
        } else select(event);
      }}
      onPointerCancelCapture={() => {
        pointerSelection.current = null;
      }}
      onClickCapture={select}
      onDoubleClickCapture={block}
      onPointerOverCapture={(event) => {
        if (
          mode !== 'edit' ||
          drag?.isInteracting ||
          marquee.gesture.current ||
          (stage && !stage.current())
        )
          return;
        const marker = markerFor(event.target);
        if (marker?.dataset.editorNode)
          navigation.setHover(
            {
              pageId,
              nodeId: marker.dataset.editorNode,
              instanceKey: marker.dataset.editorInstance,
            },
            'canvas',
          );
        else navigation.clearHover('canvas');
      }}
      onPointerLeave={() => navigation.clearHover('canvas')}
      onContextMenu={(event) => {
        if (mode !== 'edit' || drag?.isInteracting) return;
        const marker = markerFor(event.target);
        const id = marker?.dataset.editorNode ?? null;
        event.preventDefault();
        document.select(pageId, id);
        setContextMenu({ x: event.clientX, y: event.clientY, pageId, nodeId: id });
      }}
      onFocusCapture={(event) => {
        if (isEditorControl(event.target)) return;
        if (mode === 'edit' && event.target !== event.currentTarget) {
          block(event);
          canvas.current?.focus({ preventScroll: true });
        }
      }}
      onKeyDownCapture={(event) => {
        if (isClipboardKeyFamily(event)) {
          keyboardClipboard.onKeyDown(event);
          return;
        }
        if (isHistoryKeyFamily(event)) {
          keyboardHistory.onKeyDown(event);
          return;
        }
        if (isDeleteKey(event.key)) {
          keyboardDelete.onKeyDown(event);
          return;
        }
        if ((event.ctrlKey || event.metaKey) && /^[a]$/i.test(event.key)) {
          keyboardSelectAll.onKeyDown(event);
          return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          keyboardNudge.onKeyDown(event);
          return;
        }
        if (event.key === 'Escape') {
          const element = canvas.current;
          // Do not preempt popup dismissal or turn a Portal event into a Canvas command.
          if (
            mode === 'edit' &&
            element &&
            event.target === element &&
            element.ownerDocument.activeElement === element &&
            event.nativeEvent.composedPath()[0] === element &&
            canAuthor()
          ) {
            const offerEscape = drag?.offerCanvasEscape ?? offerStandaloneEscape;
            offerEscape(event.nativeEvent, () => {
              if (
                canvas.current !== element ||
                element.ownerDocument.activeElement !== element ||
                !canAuthor()
              )
                return false;
              document.select(pageId, null);
              return true;
            });
          }
          return;
        }
        if (isEditorControl(event.target)) return;
        if (mode !== 'edit' || event.key === 'Tab') return;
        if (
          (event.key === ' ' || event.key === 'Enter') &&
          selectedIds.size === 1 &&
          nodeId &&
          !event.repeat &&
          canAuthor()
        )
          drag?.begin({ kind: 'node', nodeId });
        block(event);
      }}
      onChangeCapture={block}
      onInputCapture={block}
      onSubmitCapture={block}
      onResetCapture={block}
    >
      {stage && <style>{stagePlatformStyle}</style>}
      {children}
      {keyboardDelete.error && (
        <CanvasEditorLayer as="p" className="canvas-action-error" role="alert">
          {keyboardDelete.error}
        </CanvasEditorLayer>
      )}
      {keyboardHistory.error && (
        <CanvasEditorLayer as="p" className="canvas-action-error" role="alert">
          {keyboardHistory.error}
        </CanvasEditorLayer>
      )}
      {keyboardClipboard.feedback && (
        <CanvasEditorLayer
          as="p"
          className="canvas-action-error"
          role={keyboardClipboard.feedback.error ? 'alert' : 'status'}
        >
          {keyboardClipboard.feedback.message}
        </CanvasEditorLayer>
      )}
      {focus && (
        <CanvasEditorLayer
          className="canvas-overlay-context"
          role="region"
          aria-label="浮层编辑范围"
          data-canvas-action="true"
        >
          <span>
            正在编辑：{catalog[overlayDefinition(page, nodeId)?.component ?? '']?.title ?? '浮层'} ·{' '}
            {focus.nodeId}
            {focus.instances > 1 ? ` · 当前实例，共 ${focus.instances} 个` : ''}
          </span>
          <Tip content="返回页面" disabled={!!drag?.isInteracting}>
            <Button
              variant="ghost"
              aria-label="返回页面"
              disabled={!!drag?.isInteracting}
              onClick={() => {
                if (canAuthor()) document.select(pageId, null);
              }}
            >
              返回页面
            </Button>
          </Tip>
        </CanvasEditorLayer>
      )}
      <Surface>
        <div
          className={
            mode === 'edit' && emptyPage && !page.code?.enabled
              ? 'editor-surface editor-surface--empty'
              : 'editor-surface'
          }
          ref={surface}
        >
          <CanvasSelection value={mode === 'edit' ? selectedIds : new Set()}>
            <RuntimeRenderer
              runtime={runtime}
              materials={materials}
              nodeDecorator={NodeHost}
              slotDecorator={SlotHost}
              childrenDecorator={ChildrenHost}
              designMode={mode === 'edit'}
              designPresentation={designPresentation}
            />
          </CanvasSelection>
          {mode === 'edit' && (
            <DropZone
              intent={{ kind: 'inside' }}
              className={emptyPage ? 'canvas-empty-drop-zone' : undefined}
              label={emptyPage ? '从组件库拖入组件，开始设计页面' : '页面末尾 · 拖入组件'}
            >
              {emptyPage ? (
                <span className="canvas-empty-guide">
                  <PanelsTopLeft size={26} aria-hidden="true" />
                  <span>从组件库拖入组件，开始设计页面</span>
                </span>
              ) : undefined}
            </DropZone>
          )}
        </div>
      </Surface>
      {mode === 'edit' && (
        <CanvasEditorLayer className="canvas-overlays">
          {marquee.box && <div className="canvas-marquee" style={marquee.box} aria-hidden="true" />}
          {boxes
            .filter(
              (box) =>
                box.pageId === pageId &&
                box.runtime === runtime &&
                (!box.selected || selectedIds.has(box.id)),
            )
            .map((box) => (
              <div
                className={
                  box.drop
                    ? `canvas-drop-${box.drop} ${box.axis === 'x' ? 'horizontal' : ''} ${box.valid ? 'valid' : 'invalid'}`
                    : `canvas-outline ${box.selected ? (box.id === nodeId ? 'selected' : 'selected secondary') : 'hovered'}`
                }
                data-editor-outline={box.id}
                data-editor-outline-instance={box.key}
                key={box.key}
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              >
                {box.resize &&
                  selectedIds.size === 1 &&
                  !drag?.isInteracting &&
                  !marquee.gesture.current && (
                    <CanvasResize
                      document={document}
                      snapshot={snapshot}
                      marker={box.resize.marker}
                      bounds={box.resize.bounds}
                      outline={box.resize.outline}
                      canAuthor={canAuthor}
                      onError={setActionError}
                    />
                  )}
                {box.selected && box.id === nodeId && box.toolbar && (
                  <span
                    className="canvas-selection-toolbar"
                    data-canvas-action="true"
                    style={{
                      left: box.toolbar.left,
                      top: box.toolbar.top,
                      width: box.toolbar.width,
                      right: 'auto',
                      bottom: 'auto',
                    }}
                  >
                    <Tip
                      content={
                        selected
                          ? describeNodeName(
                              selected,
                              catalog[selected.component]?.title ?? selected.component,
                            )
                          : box.id
                      }
                      disabled={!!drag?.isInteracting}
                    >
                      <span className="canvas-selection-name">
                        {selected
                          ? displayNodeName(selected, catalog[selected.component]?.title ?? box.id)
                          : box.id}
                      </span>
                    </Tip>
                    <Tip content="在组件树定位" disabled={!!drag?.isInteracting}>
                      <Button
                        className="canvas-action"
                        aria-label="在组件树定位"
                        disabled={!!drag?.isInteracting}
                        onClick={() => {
                          if (!canAuthor()) return;
                          if (navigation.requestLocate('tree', box.id, box.key))
                            session?.activatePanel('structure');
                        }}
                      >
                        <ListTree size={13} />
                      </Button>
                    </Tip>
                    <Tip content="选择父级" disabled={!!drag?.isInteracting}>
                      <Button
                        className="canvas-action"
                        aria-label="选择父级组件"
                        disabled={!!drag?.isInteracting || selectedIds.size > 1}
                        onClick={() =>
                          canAuthor() &&
                          selectedIds.size === 1 &&
                          document.select(
                            pageId,
                            findNode(snapshot.plan.pages.get(pageId)!.schema, box.id)?.parentId ??
                              null,
                          )
                        }
                      >
                        <ArrowUp size={13} />
                      </Button>
                    </Tip>
                    <Tip content="创建副本" disabled={!!drag?.isInteracting}>
                      <Button
                        className="canvas-action"
                        aria-label="复制选中组件"
                        disabled={!!drag?.isInteracting || selectedIds.size > 1}
                        onClick={() => actOnNode(() => document.duplicateNode(pageId, box.id))}
                      >
                        <Copy size={13} />
                      </Button>
                    </Tip>
                    <Tip content="删除组件" disabled={!!drag?.isInteracting}>
                      <Button
                        className="canvas-action"
                        aria-label="删除选中组件"
                        disabled={!!drag?.isInteracting || selectedIds.size > 1}
                        onClick={() => actOnNode(() => document.removeNode(pageId, box.id))}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </Tip>
                  </span>
                )}
              </div>
            ))}
        </CanvasEditorLayer>
      )}
      {mode === 'edit' && (
        <CanvasEditorLayer as="fragment">
          <SelectionControls document={document} snapshot={snapshot} />
        </CanvasEditorLayer>
      )}
      {mode === 'edit' && (
        <CanvasEditorLayer as="span" className="canvas-announcement" role="status">
          {selected ? `已选中 ${nodeId}` : '点击组件或从组件树选择'}
        </CanvasEditorLayer>
      )}
      {mode === 'edit' && interaction.message && (
        <CanvasEditorLayer as="p" className="canvas-navigation-notice" role="status">
          {interaction.message}
        </CanvasEditorLayer>
      )}
      {mode === 'edit' && actionError && (
        <CanvasEditorLayer as="p" className="canvas-action-error" role="alert">
          {actionError}
        </CanvasEditorLayer>
      )}
      {mode === 'edit' && (
        <NodeContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          document={document}
          snapshot={snapshot}
          authoringAllowed={canAuthor()}
        />
      )}
    </div>
  );
}
