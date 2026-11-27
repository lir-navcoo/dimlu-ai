import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { selectedNodeIds } from '../../packages/editor/selection';
import type { StyleCapability } from '../../packages/schema/style';
import { isAuthorEscape, isEscapeTextTarget, resizingWindows } from './author-escape';
import { useCanvasStage } from './canvas-stage';
import {
  normalizeRect,
  toParentPoint,
  toParentRect,
  visualScale,
  type ScreenPoint,
  type ScreenRect,
} from './coordinates';
import { errorText } from './errors';
import './canvas-resize.css';

const directions = [
  ['nw', -1, -1, '左上'],
  ['n', 0, -1, '上方'],
  ['ne', 1, -1, '右上'],
  ['e', 1, 0, '右侧'],
  ['se', 1, 1, '右下'],
  ['s', 0, 1, '下方'],
  ['sw', -1, 1, '左下'],
  ['w', -1, 0, '左侧'],
] as const;
type Direction = (typeof directions)[number];
type SizeAxis = 'width' | 'height';
type Size = Partial<Record<SizeAxis, number>>;
type Axis = { initial: number; scale: number; min: number; max: number };
type Geometry = { element: HTMLElement; rect: ScreenRect; width: Axis; height: Axis };

type Props = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  marker: HTMLElement;
  canAuthor: () => boolean;
  onError?: (message: string) => void;
  onActiveChange?: (active: boolean) => void;
  bounds?: ScreenRect;
  outline?: ScreenRect;
};

function target(marker: HTMLElement, kind: StyleCapability['target']) {
  const win = marker.ownerDocument.defaultView;
  if (
    !marker.isConnected ||
    !win ||
    marker.dataset.editorInactive ||
    marker.dataset.editorDesignHidden
  )
    return;
  const roots = [...marker.children].filter(
    (element): element is HTMLElement =>
      element instanceof win.HTMLElement && !element.hasAttribute('data-editor-node'),
  );
  if (kind === 'root') return roots.length === 1 ? roots[0] : undefined;
  if (kind === 'field') return roots.find((element) => element.matches('.material-field'));
  const popups = roots.flatMap((root) =>
    [...root.querySelectorAll<HTMLElement>('.material-modal.design:not([data-closed])')].filter(
      (element) => element.closest('[data-editor-node]') === marker,
    ),
  );
  return popups.length === 1 ? popups[0] : undefined;
}

const px = (source: string) => (source === '0' || source.endsWith('px') ? parseFloat(source) : NaN);
function measure(element: HTMLElement): Geometry | undefined {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  if (
    ['none', 'contents', 'inline'].includes(style.display) ||
    ['hidden', 'collapse'].includes(style.visibility)
  )
    return;
  const raw = normalizeRect(element.getBoundingClientRect());
  const rect = toParentRect(raw, element.ownerDocument);
  if (!rect || !Number.isFinite(rect.width + rect.height) || rect.width <= 0 || rect.height <= 0)
    return;
  const local = visualScale(element);
  const horizontal =
    (px(style.paddingLeft) || 0) +
    (px(style.paddingRight) || 0) +
    (px(style.borderLeftWidth) || 0) +
    (px(style.borderRightWidth) || 0);
  const vertical =
    (px(style.paddingTop) || 0) +
    (px(style.paddingBottom) || 0) +
    (px(style.borderTopWidth) || 0) +
    (px(style.borderBottomWidth) || 0);
  const axis = (
    size: number,
    localSize: number,
    scale: number,
    insets: number,
    min: string,
    max: string,
  ) => {
    const borderBox = style.boxSizing === 'border-box';
    const floor = borderBox ? insets : 0;
    const initial = Math.max(floor, localSize / scale - (borderBox ? 0 : insets));
    const minimum = Math.max(floor, px(min) || 0);
    const maximum = px(max);
    return {
      initial,
      scale: (size / localSize) * scale,
      min: minimum,
      max: Number.isFinite(maximum) ? Math.max(minimum, maximum) : Infinity,
    };
  };
  return {
    element,
    rect,
    width: axis(rect.width, raw.width, local.x, horizontal, style.minWidth, style.maxWidth),
    height: axis(rect.height, raw.height, local.y, vertical, style.minHeight, style.maxHeight),
  };
}

function model({ snapshot, marker }: Props) {
  const { pageId, nodeId } = snapshot.selection;
  const page = snapshot.plan.pages.get(pageId)?.schema;
  if (
    !page ||
    page.code?.enabled ||
    !nodeId ||
    nodeId !== marker.dataset.editorNode ||
    selectedNodeIds(snapshot.selection).length !== 1
  )
    return;
  const node = findNode(page, nodeId)?.node;
  if (!node || node.lock || node.hidden) return;
  const capability = snapshot.plan.registry.components[node.component]?.style;
  if (!capability) return;
  // 不用一次拖动替换数据或表达式绑定；用户可在样式面板主动解除绑定。
  const axis = (name: SizeAxis) =>
    capability.properties.includes(name) &&
    (!node.style?.[name] || node.style[name]?.kind === 'literal');
  const width = axis('width'),
    height = axis('height');
  if (!width && !height) return;
  const element = target(marker, capability.target);
  const geometry = element && measure(element);
  if (!geometry) return;
  return { pageId, nodeId, node, width, height, geometry };
}

type ResizeModel = NonNullable<ReturnType<typeof model>>;
type Gesture = {
  props: Props;
  model: ResizeModel;
  direction: Direction;
  capture: HTMLButtonElement;
  pointerId: number;
  start: ScreenPoint;
  dispose: () => void;
};

function resized(gesture: Gesture, point: ScreenPoint): Size {
  const {
    direction: [, x, y],
    model: {
      geometry: { width, height },
    },
    start,
  } = gesture;
  const axis = ({ initial, scale, min, max }: Axis, delta: number) => {
    if (Math.abs(delta / scale) < 1) return;
    const size = Math.max(min, Math.min(max, Math.round(initial + delta / scale)));
    return Math.abs(size - initial) >= 0.5 ? size : undefined;
  };
  return {
    width: axis(width, (point.x - start.x) * x),
    height: axis(height, (point.y - start.y) * y),
  };
}

function current(gesture: Gesture, props: Props) {
  const started = gesture.props;
  if (
    props.document !== started.document ||
    props.document.getSnapshot() !== started.snapshot ||
    props.snapshot !== started.snapshot ||
    props.marker !== started.marker ||
    !gesture.capture.isConnected ||
    !props.canAuthor()
  )
    return false;
  const next = model(props)?.geometry;
  const before = gesture.model.geometry;
  return (
    !!next &&
    next.element === before.element &&
    (['width', 'height'] as const).every(
      (axis) =>
        Math.abs(next[axis].scale - before[axis].scale) <= 0.001 &&
        Math.abs(next[axis].initial - before[axis].initial) <= 0.1 &&
        next[axis].min === before[axis].min &&
        next[axis].max === before[axis].max,
    )
  );
}

export function CanvasResize(props: Props) {
  const { bounds, outline } = props;
  const stage = useCanvasStage();
  const latest = useRef(props);
  latest.current = props;
  const active = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Size | null>(null);
  const targetModel = model(props);

  const stop = (update = true) => {
    const gesture = active.current;
    if (!gesture) return;
    active.current = null;
    gesture.dispose();
    const { capture, pointerId } = gesture;
    if (capture.hasPointerCapture?.(pointerId)) capture.releasePointerCapture(pointerId);
    if (update) setPreview(null);
    latest.current.onActiveChange?.(false);
  };
  useLayoutEffect(() => () => stop(false), []);
  useLayoutEffect(() => {
    if (active.current && !current(active.current, props)) stop();
  });

  function begin(event: ReactPointerEvent<HTMLButtonElement>, direction: Direction) {
    if (
      active.current ||
      event.button !== 0 ||
      event.isPrimary === false ||
      !props.canAuthor() ||
      props.document.getSnapshot() !== props.snapshot
    )
      return;
    const resolved = model(props);
    if (!resolved || (direction[1] && !resolved.width) || (direction[2] && !resolved.height))
      return;
    const capture = event.currentTarget,
      pointerId = event.pointerId;
    const start = toParentPoint({ x: event.clientX, y: event.clientY }, capture.ownerDocument);
    if (!start || !Number.isFinite(start.x + start.y)) return;
    if (capture.setPointerCapture) {
      try {
        capture.setPointerCapture(pointerId);
      } catch {
        return;
      }
    }
    event.preventDefault();
    event.stopPropagation();
    const gesture: Gesture = {
      props,
      model: resolved,
      direction,
      capture,
      pointerId,
      start,
      dispose: () => {},
    };
    active.current = gesture;
    const cleanups: (() => void)[] = [];
    const update = (pointer: PointerEvent, owner: Document, commit: boolean) => {
      if (active.current !== gesture || pointer.pointerId !== pointerId) return;
      if (commit && pointer.button !== 0) return;
      const point = toParentPoint({ x: pointer.clientX, y: pointer.clientY }, owner);
      if (!point || !Number.isFinite(point.x + point.y) || !current(gesture, latest.current)) {
        stop();
        return;
      }
      pointer.preventDefault();
      const size = resized(gesture, point);
      if (!commit) {
        setPreview(size);
        return;
      }
      stop();
      // 停止回调可能切换文档或选择；最后一次写入仍需重新验证。
      if (
        (size.width === undefined && size.height === undefined) ||
        !current(gesture, latest.current)
      )
        return;
      const { pageId, nodeId, node } = resolved;
      const literal = (axis: SizeAxis) => {
        const next = size[axis];
        const before = node.style?.[axis];
        return next !== undefined && !(before?.kind === 'literal' && before.value === next)
          ? { kind: 'literal' as const, value: next }
          : undefined;
      };
      const width = literal('width'),
        height = literal('height');
      if (!width && !height) return;
      try {
        props.document.setStyle(pageId, nodeId, {
          ...(width && { width }),
          ...(height && { height }),
        });
        latest.current.onError?.('');
      } catch (error) {
        latest.current.onError?.(errorText(error));
      }
    };
    const cancel = () => {
      if (active.current === gesture) stop();
    };
    const pointerCancel = (pointer: PointerEvent) => {
      if (
        pointer.pointerId === pointerId &&
        (pointer.type !== 'lostpointercapture' || pointer.target === capture)
      )
        cancel();
    };
    const mouseWindow = capture.ownerDocument.defaultView!;
    const childWindow = props.marker.ownerDocument.defaultView!;
    for (const win of new Set([mouseWindow, childWindow])) {
      const move = (pointer: PointerEvent) => update(pointer, win.document, false);
      const up = (pointer: PointerEvent) => update(pointer, win.document, true);
      const key = (event: KeyboardEvent) => {
        if (!isAuthorEscape(event) || isEscapeTextTarget(event, null, win.document)) return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      };
      win.addEventListener('pointermove', move, { passive: false });
      win.addEventListener('pointerup', up);
      win.addEventListener('pointercancel', pointerCancel);
      win.addEventListener('lostpointercapture', pointerCancel);
      win.addEventListener('keydown', key, true);
      win.addEventListener('pagehide', cancel);
      cleanups.push(() => {
        win.removeEventListener('pointermove', move);
        win.removeEventListener('pointerup', up);
        win.removeEventListener('pointercancel', pointerCancel);
        win.removeEventListener('lostpointercapture', pointerCancel);
        win.removeEventListener('keydown', key, true);
        win.removeEventListener('pagehide', cancel);
      });
    }
    mouseWindow.addEventListener('blur', cancel);
    cleanups.push(() => mouseWindow.removeEventListener('blur', cancel));
    const invalidate = stage?.onInvalidate(cancel);
    if (invalidate) cleanups.push(invalidate);
    cleanups.push(
      props.document.subscribe(() => {
        if (props.document.getSnapshot() !== props.snapshot) cancel();
      }),
    );
    for (const win of new Set([mouseWindow, childWindow])) {
      resizingWindows.add(win);
      cleanups.push(() => resizingWindows.delete(win));
    }
    gesture.dispose = () => cleanups.forEach((dispose) => dispose());
    setPreview({});
    props.onActiveChange?.(true);
  }

  const displayed = targetModel ?? active.current?.model;
  if (!displayed) return null;
  const { rect } = displayed.geometry;
  const base = outline ?? rect;
  return (
    <span className="canvas-resize" data-resizing={preview !== null || undefined}>
      {directions.map((direction) => {
        const [id, x, y, label] = direction;
        if ((x && !displayed.width) || (y && !displayed.height)) return null;
        const left = x < 0 ? rect.left : x > 0 ? rect.right : rect.left + rect.width / 2;
        const top = y < 0 ? rect.top : y > 0 ? rect.bottom : rect.top + rect.height / 2;
        const held = active.current?.direction === direction;
        if (
          !held &&
          bounds &&
          (left < bounds.left || left > bounds.right || top < bounds.top || top > bounds.bottom)
        )
          return null;
        return (
          <button
            key={id}
            type="button"
            tabIndex={-1}
            className="canvas-resize-handle"
            data-resize-handle={id}
            data-resize-held={held || undefined}
            data-canvas-action="true"
            aria-label={`从${label}调整尺寸`}
            style={{ left: left - base.left, top: top - base.top }}
            onPointerDown={(event) => begin(event, direction)}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          />
        );
      })}
      {preview && (
        <span
          className="canvas-resize-preview"
          data-resize-preview="true"
          role="status"
          style={{
            left: rect.left - base.left + rect.width / 2,
            top: rect.top - base.top + rect.height / 2,
          }}
        >
          {Math.round(preview.width ?? displayed.geometry.width.initial)} ×{' '}
          {Math.round(preview.height ?? displayed.geometry.height.initial)} px
        </span>
      )}
    </span>
  );
}
