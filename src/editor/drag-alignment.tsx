import { useLayoutEffect, useRef, useState } from 'react';
import { findNode, type InsertTarget } from '../../packages/editor/document';
import type { PageSchema } from '../../packages/schema/types';
import { clippingBounds, documentViewport, intersectRect } from './CanvasHost';
import { toParentRect, type ScreenPoint, type ScreenRect } from './coordinates';
import { nodeFlow, nodeRect } from './geometry';
import type { DropHit } from './hit-test';

const nodeSelector = '[data-editor-node]';
const hiddenSelector = '[data-editor-inactive],[data-editor-design-hidden]';
const snapDistance = 6; // 使用屏幕 CSS 像素，画布缩放不影响阈值。
const neighborDistance = 96;

type Axis = 'x' | 'y';
type Guide = {
  axis: Axis;
  position: number;
  start: number;
  end: number;
};

/** 插槽末尾的落点会分隔同一 DOM 父元素中的多次渲染。 */
function slotPeers(reference: HTMLElement, lane: HTMLElement, parentId: string, slot: string) {
  let group: Element[] = [];
  const slotIntent = JSON.stringify({ kind: 'inside', parentId, slot });
  for (const element of lane.children) {
    group.push(element);
    if (element.getAttribute('data-drop-intent') !== slotIntent) continue;
    if (group.includes(reference)) return group;
    group = [];
  }
  return group.includes(reference) ? group : [];
}

function nearbyGuide(point: ScreenPoint, rect: ScreenRect, clip: ScreenRect, axis: Axis) {
  const visible = intersectRect(rect, clip);
  if (!visible) return;
  const [near, far, clipNear, clipFar] =
    axis === 'x'
      ? [rect.left, rect.right, clip.left, clip.right]
      : [rect.top, rect.bottom, clip.top, clip.bottom];
  const [start, end, clipStart, clipEnd, across] =
    axis === 'x'
      ? [visible.top, visible.bottom, clip.top, clip.bottom, point.y]
      : [visible.left, visible.right, clip.left, clip.right, point.x];
  const distance = Math.max(start - across, 0, across - end);
  if (distance > neighborDistance) return;
  let best: { guide: Guide; delta: number; distance: number } | undefined;
  for (const position of [near, (near + far) / 2, far]) {
    const delta = Math.abs(point[axis] - position);
    if (position < clipNear || position >= clipFar || delta > (best?.delta ?? snapDistance))
      continue;
    best = {
      guide: {
        axis,
        position,
        start: Math.max(clipStart, Math.min(across, start) - 4),
        end: Math.min(clipEnd, Math.max(across, end) + 4),
      },
      delta,
      distance,
    };
  }
  return best;
}

/** 插入方向已有落点指示，辅助线只提示交叉轴上的对齐位置。 */
export function measureDragAlignment(
  point: ScreenPoint,
  { surface, intent, reference }: DropHit,
  target: InsertTarget,
  page: PageSchema,
  sourceId?: string,
): Guide | undefined {
  if (!surface?.isConnected || !surface.contains(reference) || reference.closest(hiddenSelector))
    return;
  const owner = target.parentId
    ? reference.closest<HTMLElement>(`[data-editor-node="${target.parentId}"]`)
    : surface;
  if (!owner) return;
  const beside = intent.kind !== 'inside';
  const lane = beside || target.slot ? reference.parentElement : owner;
  if (!lane) return;
  const parent = target.parentId ? findNode(page, target.parentId)?.node : undefined;
  const list = target.parentId
    ? parent && (target.slot ? parent.slots?.[target.slot]?.children : parent.children)
    : page.children;
  if (!list?.length) return;
  const siblingIds = new Set(list.map((node) => node.id));
  const markers =
    target.slot && target.parentId
      ? slotPeers(reference, lane, target.parentId, target.slot)
      : beside
        ? lane.children
        : lane.querySelectorAll(nodeSelector);
  const referenceClip = clippingBounds(reference, surface);
  const viewport = referenceClip && intersectRect(referenceClip, documentViewport(window.document));
  if (!viewport) return;
  let best: ReturnType<typeof nearbyGuide>;
  const crossAxis = beside ? (nodeFlow(reference).axis === 'x' ? 'y' : 'x') : undefined;
  for (const element of markers) {
    const marker = element as HTMLElement;
    const id = marker.dataset.editorNode;
    if (!id || id === sourceId || !siblingIds.has(id) || marker.closest(hiddenSelector)) continue;
    if (marker.parentElement?.closest(nodeSelector) !== (target.parentId ? owner : null)) continue;
    // 同一落点定义可能有多个实例，此处只使用实际命中的实例。
    if (beside && id === reference.dataset.editorNode && marker !== reference) continue;
    const raw = nodeRect(marker);
    const bounds = raw && toParentRect(raw, marker.ownerDocument);
    const clip = bounds && clippingBounds(marker, surface);
    const shared = clip && intersectRect(clip, viewport);
    if (!bounds || !shared) continue;
    const match = nearbyGuide(
      point,
      bounds,
      shared,
      crossAxis ?? (nodeFlow(marker).axis === 'x' ? 'y' : 'x'),
    );
    if (
      match &&
      (!best ||
        match.delta < best.delta ||
        (match.delta === best.delta && match.distance < best.distance))
    )
      best = match;
  }
  return best?.guide;
}

export function DragAlignment({
  point,
  hit,
  target,
  page,
  sourceId,
}: {
  point: ScreenPoint;
  hit: DropHit;
  target: InsertTarget;
  page: PageSchema;
  sourceId?: string;
}) {
  const [measurement, setMeasurement] = useState<{
    reference: HTMLElement;
    target: InsertTarget;
    guide: Guide;
  }>();
  const latest = useRef({ point, hit, target, page, sourceId });
  latest.current = { point, hit, target, page, sourceId };
  const schedule = useRef<() => void>(() => {});
  const owner = hit.surface?.ownerDocument;
  useLayoutEffect(() => {
    let frame = 0;
    schedule.current = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const current = latest.current;
        const guide = measureDragAlignment(
          current.point,
          current.hit,
          current.target,
          current.page,
          current.sourceId,
        );
        setMeasurement(
          guide ? { reference: current.hit.reference, target: current.target, guide } : undefined,
        );
      });
    };
    window.addEventListener('scroll', schedule.current, true);
    window.addEventListener('resize', schedule.current);
    const frameView = owner?.defaultView;
    if (frameView !== window) frameView?.addEventListener('scroll', schedule.current, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule.current, true);
      window.removeEventListener('resize', schedule.current);
      if (frameView !== window) frameView?.removeEventListener('scroll', schedule.current, true);
    };
  }, [owner]);
  useLayoutEffect(() => schedule.current(), [point, hit, target, page, sourceId]);
  const guide =
    measurement?.reference === hit.reference && measurement.target === target
      ? measurement.guide
      : undefined;
  if (!guide) return null;
  const length = guide.end - guide.start;
  return (
    <div
      aria-hidden="true"
      className={`canvas-alignment-guide ${guide.axis === 'x' ? 'vertical' : 'horizontal'}`}
      style={
        guide.axis === 'x'
          ? { left: guide.position, top: guide.start, height: length }
          : { left: guide.start, top: guide.position, width: length }
      }
    />
  );
}
