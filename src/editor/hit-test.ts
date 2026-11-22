import { findNode } from '../../packages/editor/document';
import type { DropIntent } from '../../packages/editor/drop';
import type { ApplicationPlan } from '../../packages/runtime/engine';
import { nodeFlow, nodeRect } from './geometry';
import { canvasHitAtPoint } from './coordinates';

type Point = { x: number; y: number };
export type DropHit = {
  intent: DropIntent;
  surface: HTMLElement | null;
  reference: HTMLElement;
};
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
function gap(host: Element, point: Point): HTMLElement | undefined {
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
  return nearest;
}

/** 保留实际命中的 DOM，辅助线据此区分重复实例。 */
export function locateDrop(
  hit: ReturnType<typeof canvasHitAtPoint>,
  plan: ApplicationPlan,
  pageId: string,
): DropHit | undefined {
  const { element, point } = hit;
  if (!element) return;
  const surface = element.closest<HTMLElement>('.editor-surface');
  const result = (reference: HTMLElement, intent: DropIntent | undefined) =>
    intent && { intent, surface, reference };
  const explicit = element.closest<HTMLElement>('[data-drop-intent]');
  if (explicit) return result(explicit, JSON.parse(explicit.dataset.dropIntent!) as DropIntent);
  const marker = element.closest<HTMLElement>('[data-editor-tree-node],[data-editor-node]');
  if (!marker) {
    if (!surface) return;
    const nearest = gap(surface, point);
    const intent = nearest && beside(nearest, point);
    return nearest && intent ? result(nearest, intent) : result(surface, { kind: 'inside' });
  }
  const id = marker.dataset.editorTreeNode ?? marker.dataset.editorNode!;
  const node = findNode(plan.pages.get(pageId)!.schema, id)?.node;
  if (!node) return;
  const rect = marker.dataset.editorTreeNode ? marker.getBoundingClientRect() : nodeRect(marker);
  if (!rect) return;
  const ratio = (point.y - rect.top) / Math.max(1, rect.height);
  if (plan.registry.components[node.component].children && ratio >= 0.25 && ratio <= 0.75) {
    const nearest = !marker.dataset.editorTreeNode && gap(marker, point);
    const intent = nearest && beside(nearest, point);
    return nearest && intent
      ? result(nearest, intent)
      : result(marker, { kind: 'inside', parentId: id });
  }
  return result(marker, beside(marker, point));
}

export function hitTestDrop(point: Point, plan: ApplicationPlan, pageId: string) {
  return locateDrop(canvasHitAtPoint(point), plan, pageId)?.intent;
}
