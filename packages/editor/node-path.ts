import type { NodeSchema, PageSchema } from '../schema/types';

export interface NodePathEntry {
  node: NodeSchema;
  /** Slot through which this node belongs to the preceding ancestor. */
  slot?: string;
}

/** Structural ancestry includes named slots; repeated instances share this definition path. */
export function nodePath(page: PageSchema, nodeId: string | null): NodePathEntry[] {
  if (!nodeId) return [];
  const visit = (
    nodes: readonly NodeSchema[],
    path: NodePathEntry[],
    slot?: string,
  ): NodePathEntry[] | undefined => {
    for (const node of nodes) {
      const next = [...path, { node, ...(slot ? { slot } : {}) }];
      if (node.id === nodeId) return next;
      const child = visit(node.children ?? [], next);
      if (child) return child;
      for (const [name, value] of Object.entries(node.slots ?? {})) {
        const found = visit(value.children, next, name);
        if (found) return found;
      }
    }
    return undefined;
  };
  return visit(page.children, []) ?? [];
}
