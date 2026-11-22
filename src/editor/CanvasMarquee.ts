import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { PageRuntime } from '../../packages/runtime/engine';
import { canvasViewport, clippingBounds, intersectRect, type CanvasRect } from './CanvasHost';
import { toParentPoint, toParentRect, type ScreenPoint } from './coordinates';
import { nodeRect } from './geometry';
import type { CanvasStage } from './canvas-stage';

function rectBetween(a: ScreenPoint, b: ScreenPoint): CanvasRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}
export function marqueeHits(surface: HTMLElement, selection: CanvasRect) {
  const hits = new Map<string, string | undefined>();
  for (const marker of surface.querySelectorAll<HTMLElement>('[data-editor-node]')) {
    if (marker.closest('[data-editor-inactive], [data-editor-design-hidden]')) continue;
    const id = marker.dataset.editorNode!;
    if (hits.has(id)) continue;
    const raw = nodeRect(marker);
    const rect = raw && toParentRect(raw, marker.ownerDocument);
    const bounds = rect && clippingBounds(marker, surface);
    const visible = rect && bounds && intersectRect(rect, bounds);
    if (
      visible &&
      visible.left >= selection.left &&
      visible.right <= selection.right &&
      visible.top >= selection.top &&
      visible.bottom <= selection.bottom
    )
      hits.set(id, marker.dataset.editorInstance);
  }
  return hits;
}

export function useCanvasMarquee({
  stage,
  enabled,
  document,
  snapshot,
  runtime,
  width,
  scale,
  canAuthor,
  onSelect,
}: {
  stage?: CanvasStage;
  enabled: boolean;
  document: EditorDocument;
  snapshot: EditorSnapshot;
  runtime: PageRuntime;
  width?: number;
  scale?: number;
  canAuthor: () => boolean;
  onSelect: (hits: Map<string, string | undefined>, additive: boolean) => void;
}) {
  const [box, setBox] = useState<Pick<CanvasRect, 'left' | 'top' | 'width' | 'height'>>();
  const gesture = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useLayoutEffect(() => {
    const invalidate = stage?.onInvalidate(() => gesture.current?.());
    return () => {
      invalidate?.();
      gesture.current?.();
    };
  }, [stage, enabled, document, snapshot.plan, snapshot.selection, runtime, width, scale]);

  const begin = (
    event: ReactPointerEvent<HTMLDivElement>,
    surface: HTMLElement,
    startedOnNode: boolean,
  ) => {
    if (!enabled || !canAuthor() || event.isPrimary === false || event.pointerType === 'touch')
      return false;
    const canvas = event.currentTarget;
    const owner = canvas.ownerDocument;
    const attachment = stage?.current();
    const overlay = attachment?.overlay ?? canvas;
    const origin = toParentPoint({ x: event.clientX, y: event.clientY }, owner);
    if (!origin || (stage && !attachment)) return false;
    gesture.current?.();
    event.preventDefault();
    event.stopPropagation();
    canvas.focus({ preventScroll: true });
    const pointerId = event.pointerId;
    const additive = event.ctrlKey || event.metaKey;
    const target = event.target as Element;
    let moved = false;
    const windows = new Set([owner.defaultView!, overlay.ownerDocument.defaultView!]);
    const listeners: (() => void)[] = [];
    const stop = () => {
      gesture.current = null;
      listeners.forEach((dispose) => dispose());
      setBox(undefined);
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    };
    const measure = (event: PointerEvent, document: Document) => {
      const point = toParentPoint({ x: event.clientX, y: event.clientY }, document);
      if (!point) return undefined;
      moved ||= Math.hypot(point.x - origin.x, point.y - origin.y) >= 6;
      return moved ? intersectRect(rectBetween(origin, point), canvasViewport(surface)) : undefined;
    };
    for (const view of windows) {
      const move = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        if (!canAuthor()) return stop();
        const rect = measure(event, view.document);
        if (moved) event.preventDefault();
        const base = overlay.getBoundingClientRect();
        setBox(
          rect && {
            left: rect.left - base.left + overlay.scrollLeft,
            top: rect.top - base.top + overlay.scrollTop,
            width: rect.width,
            height: rect.height,
          },
        );
      };
      const up = (event: PointerEvent) => {
        if (event.pointerId !== pointerId) return;
        const rect = measure(event, view.document);
        const allowed = canAuthor();
        suppressClick.current = moved || !startedOnNode;
        stop();
        if (allowed && (moved || !startedOnNode))
          onSelect(rect ? marqueeHits(surface, rect) : new Map(), additive);
      };
      const cancel = (event: PointerEvent) => {
        if (event.pointerId === pointerId) stop();
      };
      const escape = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = true;
        stop();
      };
      view.addEventListener('pointermove', move, { passive: false });
      view.addEventListener('pointerup', up);
      view.addEventListener('pointercancel', cancel);
      view.addEventListener('lostpointercapture', cancel);
      view.addEventListener('keydown', escape, true);
      view.addEventListener('blur', stop);
      listeners.push(() => {
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', up);
        view.removeEventListener('pointercancel', cancel);
        view.removeEventListener('lostpointercapture', cancel);
        view.removeEventListener('keydown', escape, true);
        view.removeEventListener('blur', stop);
      });
    }
    gesture.current = stop;
    // Capture on the original target so a Shift-click still targets that component.
    target.setPointerCapture?.(pointerId);
    return true;
  };
  return { box, gesture, begin, suppressClick };
}
