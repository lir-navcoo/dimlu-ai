import type { ActionCall, ApplicationSchema, NodeSchema, PageSchema } from '../schema/types';
import type { Selection } from './selection';
import type { ApplicationPlan } from '../runtime/engine';
import type { Registry } from '../runtime/registry';

export interface InsertTarget {
  parentId?: string;
  slot?: string;
  index?: number;
}
export interface NodeLocation {
  node: NodeSchema;
  list: NodeSchema[];
  index: number;
  parentId?: string;
  slot?: string;
}

/** Locate a node anywhere in the page tree, remembering its owner list and slot path. */
export function findNode(page: PageSchema, id: string): NodeLocation | undefined {
  const visit = (
    list: NodeSchema[],
    parentId?: string,
    slot?: string,
  ): NodeLocation | undefined => {
    for (const [index, node] of list.entries()) {
      if (node.id === id) return { node, list, index, parentId, slot };
      const child = visit(node.children ?? [], node.id);
      if (child) return child;
      for (const [name, definition] of Object.entries(node.slots ?? {})) {
        const found = visit(definition.children, node.id, name);
        if (found) return found;
      }
    }
  };
  return visit(page.children);
}

export function containsNode(node: NodeSchema, id: string): boolean {
  return (
    node.id === id ||
    [
      ...(node.children ?? []),
      ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children),
    ].some((child) => containsNode(child, id))
  );
}

/** Every node id and action-call id already present on the page; new identities avoid this set. */
export function collectUsedIds(page: PageSchema): Set<string> {
  const used = new Set<string>();
  const collect = (nodes: readonly NodeSchema[]) => {
    for (const node of nodes) {
      used.add(node.id);
      for (const calls of Object.values(node.on ?? {}))
        for (const call of calls) used.add(call.id);
      collect(node.children ?? []);
      for (const slot of Object.values(node.slots ?? {})) collect(slot.children);
    }
  };
  collect(page.children);
  for (const call of page.onEnter ?? []) used.add(call.id);
  for (const call of page.onLeave ?? []) used.add(call.id);
  return used;
}

/**
 * Rename a copied tree's identities through the site-specific allocators. Call-id
 * renaming is opt-in: paste and material instantiation keep copied call ids (the page
 * they came from has already been scanned for conflicts), while duplicate flows mint
 * fresh ids for every node and call.
 */
export function reidentifyTree(
  node: NodeSchema,
  allocateNode: (node: NodeSchema) => string,
  allocateCall?: (call: ActionCall) => string,
): void {
  node.id = allocateNode(node);
  if (allocateCall)
    for (const calls of Object.values(node.on ?? {}))
      for (const call of calls) call.id = allocateCall(call);
  node.children?.forEach((child) => reidentifyTree(child, allocateNode, allocateCall));
  for (const slot of Object.values(node.slots ?? {}))
    slot.children.forEach((child) => reidentifyTree(child, allocateNode, allocateCall));
}

interface Entry {
  plan: ApplicationPlan;
  selection: Readonly<Selection>;
}

/** Editor-owned frozen captures. This payload never leaves the document instance. */
interface StaticForest {
  nodes: NodeSchema[];
  components: Record<string, string>;
}

export interface EditorSnapshot extends Entry {
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  change: string;
}

export type { Entry, StaticForest };

/**
 * The transaction and indexing primitives domain collaborators run on. The document
 * builds one implementation of this interface; collaborators never import the document
 * class itself, keeping module boundaries acyclic.
 */
export interface DocumentHost {
  registry(): Registry;
  plan(): ApplicationPlan;
  selection(): Readonly<Selection>;
  draft(pageId: string): { schema: ApplicationSchema; page: PageSchema };
  commit(
    input: unknown,
    change: string,
    selection?: Readonly<Selection>,
    group?: string,
  ): boolean;
  targetList(page: PageSchema, target: InsertTarget): NodeSchema[];
  insertInto(list: NodeSchema[], node: NodeSchema, index?: number): void;
  idSequence(): number;
  setIdSequence(value: number): void;
  allocatePageId(): string;
  allocateMethodId(): string;
}
