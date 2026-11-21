import type { EditorSnapshot } from '../../packages/editor/document';
import type { ClipboardSummary } from '../../packages/editor/node-clipboard';
import { selectedNodeIds } from '../../packages/editor/selection';

export type ClipboardOperationWitness = {
  initial: EditorSnapshot;
  clipboard: Readonly<ClipboardSummary>;
  rootCount: number;
  component?: string;
  pageTitle: string;
  oldNodeIds: Set<string>;
};

export function matchesCopySummary(
  summary: Readonly<ClipboardSummary>,
  receipt: ClipboardOperationWitness,
) {
  return (
    summary.available &&
    summary.sourcePageId === receipt.initial.selection.pageId &&
    summary.sourcePageTitle === receipt.pageTitle &&
    Number.isInteger(summary.nodeCount) &&
    summary.nodeCount >= receipt.rootCount &&
    (receipt.rootCount === 1
      ? !Object.hasOwn(summary, 'rootCount') && summary.component === receipt.component
      : summary.rootCount === receipt.rootCount && !Object.hasOwn(summary, 'component'))
  );
}
export function matchesPasteSnapshot(snapshot: EditorSnapshot, receipt: ClipboardOperationWitness) {
  const pageId = receipt.initial.selection.pageId;
  const before = receipt.initial.plan.pages.get(pageId)!.schema;
  const after = snapshot.plan.pages.get(pageId)?.schema;
  if (
    snapshot.plan === receipt.initial.plan ||
    snapshot.selection.pageId !== pageId ||
    snapshot.revision !== receipt.initial.revision + 1 ||
    !after ||
    after.children.length !== before.children.length + receipt.rootCount ||
    !before.children.every((node, index) => after.children[index]?.id === node.id)
  )
    return false;
  const ids = after.children.slice(-receipt.rootCount).map((node) => node.id);
  const selected = selectedNodeIds(snapshot.selection);
  return (
    new Set(ids).size === receipt.rootCount &&
    ids.every((id) => !receipt.oldNodeIds.has(id)) &&
    snapshot.selection.nodeId === ids[0] &&
    selected.length === ids.length &&
    selected.every((id, index) => id === ids[index]) &&
    (ids.length === 1 ? !snapshot.selection.nodeIds : !!snapshot.selection.nodeIds)
  );
}

export function matchesKeyboardPasteSnapshot(
  snapshot: EditorSnapshot,
  witness: ClipboardOperationWitness,
) {
  if (!matchesPasteSnapshot(snapshot, witness)) return false;
  const before = witness.initial.plan.pages.get(witness.initial.selection.pageId)!.schema;
  const after = snapshot.plan.pages.get(witness.initial.selection.pageId)!.schema;
  const { children: beforeChildren, ...beforeMetadata } = before;
  const { children: afterChildren, ...afterMetadata } = after;
  return (
    JSON.stringify(beforeMetadata) === JSON.stringify(afterMetadata) &&
    JSON.stringify(beforeChildren) === JSON.stringify(afterChildren.slice(0, beforeChildren.length))
  );
}

export function matchesPasteResult(
  snapshot: EditorSnapshot,
  witness: ClipboardOperationWitness,
  ids: unknown,
): ids is string[] {
  if (
    !matchesKeyboardPasteSnapshot(snapshot, witness) ||
    !Array.isArray(ids) ||
    ids.length !== witness.rootCount ||
    new Set(ids).size !== ids.length
  )
    return false;
  const selected = selectedNodeIds(snapshot.selection);
  return ids.every((id, index) => typeof id === 'string' && id === selected[index]);
}
