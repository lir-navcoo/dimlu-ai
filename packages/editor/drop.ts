import { findNode, type InsertTarget } from './document';
import type { PageSchema } from '../schema/types';

export type DragSource = { kind: 'material'; component: string } | { kind: 'node'; nodeId: string };
export type DropIntent =
  | { kind: 'before' | 'after'; nodeId: string }
  | { kind: 'inside'; parentId?: string; slot?: string };

/** Gaps are described against the original tree; move commands use indexes after removal. */
export function resolveDrop(
  page: PageSchema,
  source: DragSource,
  intent: DropIntent,
): InsertTarget {
  if (intent.kind === 'inside') return { parentId: intent.parentId, slot: intent.slot };
  const anchor = findNode(page, intent.nodeId);
  if (!anchor) throw new Error('落点节点不存在');
  let index = anchor.index + (intent.kind === 'after' ? 1 : 0);
  if (source.kind === 'node') {
    const moving = findNode(page, source.nodeId);
    if (!moving) throw new Error('拖动节点不存在');
    if (moving.list === anchor.list && moving.index < index) index--;
  }
  return { parentId: anchor.parentId, slot: anchor.slot, index };
}
