import { findNode } from '../../packages/editor/document';
import type { DropIntent } from '../../packages/editor/drop';
import type { ApplicationPlan } from '../../packages/runtime/engine';
import { nodeFlow, nodeRect } from './geometry';
import { canvasHitAtPoint } from './coordinates';

type Point = { x: number; y: number };
function beside(marker: HTMLElement, point: Point): DropIntent | undefined {
  const tree = marker.dataset.editorTreeNode;
  const rect = tree ? marker.getBoundingClientRect() : nodeRect(marker);
  if (!rect) return;
  const { axis, reverse } = tree ? { axis: 'y', reverse: false } : nodeFlow(marker);
  const ratio =
    axis === 'x'
      ? (point.x - rect.left) / Math.max(1, rect.width)
      : (point.y - rect.top) / Math.max(1, rect.height);
  return {
    kind: ratio < 0.5 !== reverse ? 'before' : 'after',
    nodeId: tree ?? marker.dataset.editorNode!,
  };
}
function gap(host: Element, point: Point): DropIntent | undefined {
  let nearest: HTMLElement | undefined,
    distance = Infinity;
  for (const marker of host.querySelectorAll<HTMLElement>('[data-editor-node]')) {
    // Only immediate Schema children; nested descendants have their own list.
    if (marker.parentElement?.closest('[data-editor-node]') !== host.closest('[data-editor-node]'))
      continue;
    const rect = nodeRect(marker);
    if (!rect) continue;
    const next = Math.hypot(
      Math.max(rect.left - point.x, 0, point.x - rect.right),
      Math.max(rect.top - point.y, 0, point.y - rect.bottom),
    );
    if (next < distance) {
      nearest = marker;
      distance = next;
    }
  }
  return nearest && beside(nearest, point);
}

export function hitTestDrop(
  point: Point,
  plan: ApplicationPlan,
  pageId: string,
): DropIntent | undefined {
  const hit = canvasHitAtPoint(point);
  const element = hit.element;
  point = hit.point;
  if (!element) return;
  const explicit = element.closest<HTMLElement>('[data-drop-intent]');
  if (explicit) return JSON.parse(explicit.dataset.dropIntent!) as DropIntent;
  const marker = element.closest<HTMLElement>('[data-editor-tree-node],[data-editor-node]');
  if (!marker) {
    const surface = element.closest('.editor-surface');
    return surface ? (gap(surface, point) ?? { kind: 'inside' }) : undefined;
  }
  const id = marker.dataset.editorTreeNode ?? marker.dataset.editorNode!;
  const node = findNode(plan.pages.get(pageId)!.schema, id)?.node;
  if (!node) return;
  const rect = marker.dataset.editorTreeNode ? marker.getBoundingClientRect() : nodeRect(marker);
  if (!rect) return;
  const ratio = (point.y - rect.top) / Math.max(1, rect.height);
  if (plan.registry.components[node.component].children && ratio >= 0.25 && ratio <= 0.75) {
    return (
      (!marker.dataset.editorTreeNode && gap(marker, point)) || { kind: 'inside', parentId: id }
    );
  }
  return beside(marker, point);
}
