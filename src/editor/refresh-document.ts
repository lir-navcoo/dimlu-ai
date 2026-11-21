import { EditorDocument } from '../../packages/editor/document';
import type { Registry } from '../../packages/runtime/registry';

/** Fast Refresh retains hook state, including instances of an obsolete document class. */
export function refreshEditorDocument(
  previous: EditorDocument,
  registry: Registry,
): EditorDocument {
  if (previous.constructor === EditorDocument && previous.usesRegistry?.(registry)) return previous;
  const { plan, selection } = previous.getSnapshot();
  const next = new EditorDocument(plan.schema, registry);
  next.select(selection.pageId, selection.nodeId);
  return next;
}
