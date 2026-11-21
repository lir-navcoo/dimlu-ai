import { useLayoutEffect, useRef } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { selectedNodeIds } from '../../packages/editor/selection';
import { useDragDrop } from './DragDrop';

/** Invocation guard, including retained callbacks before a render or unmount has completed. */
export function useAuthorGuard(
  document: EditorDocument,
  snapshot: EditorSnapshot,
  singleNodeId?: string,
  enabled = true,
  intent: 'author' | 'navigation' = 'author',
) {
  const drag = useDragDrop();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = useRef({ document, snapshot, enabled, drag, singleNodeId, intent });
  current.current = { document, snapshot, enabled, drag, singleNodeId, intent };
  return () => {
    const latest = current.current,
      actual = latest.document.getSnapshot();
    const selectionStable =
      actual.selection === snapshot.selection && latest.snapshot.selection === snapshot.selection;
    return (
      mounted.current &&
      enabled &&
      latest.enabled &&
      latest.document === document &&
      latest.singleNodeId === singleNodeId &&
      latest.intent === intent &&
      actual.plan === snapshot.plan &&
      latest.snapshot.plan === snapshot.plan &&
      (intent === 'navigation' || selectionStable) &&
      (intent === 'navigation' ||
        (!actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled &&
          latest.drag?.enabled !== false)) &&
      !latest.drag?.isInteracting &&
      (singleNodeId === undefined ||
        (selectedNodeIds(actual.selection).length === 1 &&
          actual.selection.nodeId === singleNodeId))
    );
  };
}
