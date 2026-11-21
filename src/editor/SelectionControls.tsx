import { useState } from 'react';
import { Copy, Trash2 } from 'lucide-react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { selectedNodeIds, topSelectedNodeIds } from '../../packages/editor/selection';
import { Button, Tip } from '../ui/primitives';
import { useAuthorGuard } from './author-guard';
import { errorText } from './errors';
import './selection.css';
import { useDragDrop } from './DragDrop';

export function SelectionControls({
  document,
  snapshot,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
}) {
  const ids = selectedNodeIds(snapshot.selection);
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const roots = topSelectedNodeIds(page, ids);
  const canAuthor = useAuthorGuard(document, snapshot);
  const drag = useDragDrop();
  const [error, setError] = useState('');
  const disabled = drag?.enabled === false || !!drag?.isInteracting || !!page.code?.enabled;
  if (ids.length < 2) return null;
  return (
    <div className="selection-controls" data-canvas-action="true">
      <span>
        已选 {ids.length} 项{roots.length !== ids.length ? ` · ${roots.length} 个顶层组件` : ''}
      </span>
      <span className="selection-control-actions">
        <Tip content="创建所选组件副本 · 保留原数据绑定，不创建新模型">
          <Button
            className="canvas-action"
            aria-label="创建所选组件副本"
            disabled={disabled}
            onClick={() => {
              if (!canAuthor()) return;
              try {
                document.duplicateNodes(snapshot.selection.pageId, ids);
                setError('');
              } catch (cause) {
                setError(errorText(cause));
              }
            }}
          >
            <Copy size={13} />
          </Button>
        </Tip>
        <Tip content="删除所选组件">
          <Button
            className="canvas-action"
            aria-label="删除所选组件"
            disabled={disabled}
            onClick={() => {
              if (!canAuthor()) return;
              try {
                document.removeNodes(snapshot.selection.pageId, ids);
                setError('');
              } catch (cause) {
                setError(errorText(cause));
              }
            }}
          >
            <Trash2 size={13} />
          </Button>
        </Tip>
      </span>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
