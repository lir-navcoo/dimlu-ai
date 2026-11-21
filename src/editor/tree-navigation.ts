import type { NodeSchema } from '../../packages/schema/types';

export type TreeNavigationKey =
  'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
export type TreeNavigationNode = {
  node: NodeSchema;
  parentId: string | null;
  expandable: boolean;
  open: boolean;
  children: readonly TreeNavigationNode[];
  slots: readonly { name: string; children: readonly TreeNavigationNode[] }[];
};
export type TreeNavigationModel = {
  roots: readonly TreeNavigationNode[];
  rows: readonly TreeNavigationNode[];
  byId: ReadonlyMap<string, TreeNavigationNode>;
  query: string;
};
export type TreeNavigationAction =
  | { kind: 'move'; nodeId: string }
  | { kind: 'expand' | 'collapse'; nodeId: string }
  | { kind: 'none' };

/** The filtered groups drive rendering; only their open branches enter rows. */
export function buildTreeNavigation({
  roots,
  query,
  closed,
  searchText,
  canExpand,
}: {
  roots: readonly NodeSchema[];
  query: string;
  closed: readonly string[];
  searchText: (node: NodeSchema) => string;
  canExpand: (node: NodeSchema) => boolean;
}): TreeNavigationModel {
  const needle = query.toLowerCase();
  const closedIds = new Set(closed);
  function list(nodes: readonly NodeSchema[], parentId: string | null): TreeNavigationNode[] {
    return nodes.flatMap((node) => {
      const children = list(node.children ?? [], node.id);
      const slots = Object.entries(node.slots ?? {}).map(([name, slot]) => ({
        name,
        children: list(slot.children, node.id),
      }));
      if (
        query &&
        !searchText(node).toLowerCase().includes(needle) &&
        !children.length &&
        !slots.some((slot) => slot.children.length)
      )
        return [];
      return [
        {
          node,
          parentId,
          expandable: canExpand(node),
          open: !!query || !closedIds.has(node.id),
          children,
          slots,
        },
      ];
    });
  }
  const visibleRoots = list(roots, null);
  const rows: TreeNavigationNode[] = [];
  const byId = new Map<string, TreeNavigationNode>();
  function flatten(nodes: readonly TreeNavigationNode[]) {
    for (const entry of nodes) {
      rows.push(entry);
      byId.set(entry.node.id, entry);
      if (entry.open) {
        flatten(entry.children);
        for (const slot of entry.slots) flatten(slot.children);
      }
    }
  }
  flatten(visibleRoots);
  return { roots: visibleRoots, rows, byId, query };
}

export function treeNavigationAction(
  model: TreeNavigationModel,
  nodeId: string,
  key: TreeNavigationKey,
): TreeNavigationAction {
  const row = model.byId.get(nodeId);
  if (!row) return { kind: 'none' };
  const move = (target?: TreeNavigationNode): TreeNavigationAction =>
    target && target !== row ? { kind: 'move', nodeId: target.node.id } : { kind: 'none' };
  switch (key) {
    case 'ArrowUp':
      return move(model.rows[model.rows.indexOf(row) - 1]);
    case 'ArrowDown':
      return move(model.rows[model.rows.indexOf(row) + 1]);
    case 'Home':
      return move(model.rows[0]);
    case 'End':
      return move(model.rows.at(-1));
    case 'ArrowRight':
      if (!model.query && row.expandable && !row.open) return { kind: 'expand', nodeId };
      return row.open
        ? move(row.children[0] ?? row.slots.find((slot) => slot.children.length)?.children[0])
        : { kind: 'none' };
    case 'ArrowLeft':
      if (!model.query && row.expandable && row.open) return { kind: 'collapse', nodeId };
      return move(row.parentId ? model.byId.get(row.parentId) : undefined);
  }
}
