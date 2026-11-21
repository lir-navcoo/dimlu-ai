import type { NodeSchema, PageSchema } from '../schema/types';

export interface Selection {
  pageId: string;
  nodeId: string | null;
  /** Present only for two or more definitions; nodeId is the primary member. */
  nodeIds?: readonly string[];
}
const emptyIds: readonly string[] = Object.freeze([]);
export function selectedNodeIds(selection: Readonly<Selection>): readonly string[] {
  return selection.nodeIds ?? (selection.nodeId ? [selection.nodeId] : emptyIds);
}
export function pageNodeOrder(page: PageSchema): string[] {
  const ids: string[] = [];
  const visit = (nodes: readonly NodeSchema[]) => {
    for (const node of nodes) {
      ids.push(node.id);
      visit(node.children ?? []);
      for (const slot of Object.values(node.slots ?? {})) visit(slot.children);
    }
  };
  visit(page.children);
  return ids;
}
/** Callers validate explicit inputs; history normalization can filter removed definitions. */
export function canonicalSelection(
  page: PageSchema,
  ids: readonly string[],
  primary?: string | null,
): Readonly<Selection> {
  const wanted = new Set(ids);
  const ordered = pageNodeOrder(page).filter((id) => wanted.has(id));
  const nodeId = primary && ordered.includes(primary) ? primary : (ordered[0] ?? null);
  return Object.freeze({
    pageId: page.id,
    nodeId,
    ...(ordered.length > 1 ? { nodeIds: Object.freeze(ordered) } : {}),
  });
}
export function topSelectedNodeIds(page: PageSchema, ids: readonly string[]): string[] {
  const selected = new Set(ids),
    roots: string[] = [];
  const visit = (nodes: readonly NodeSchema[]) => {
    for (const node of nodes) {
      if (selected.has(node.id)) roots.push(node.id);
      else {
        visit(node.children ?? []);
        for (const slot of Object.values(node.slots ?? {})) visit(slot.children);
      }
    }
  };
  visit(page.children);
  return roots;
}
