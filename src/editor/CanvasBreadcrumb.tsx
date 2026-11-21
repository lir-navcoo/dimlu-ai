import { useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { nodePath } from '../../packages/editor/node-path';
import { selectedNodeIds } from '../../packages/editor/selection';
import { useAuthorGuard } from './author-guard';
import { Button, Tip } from '../ui/primitives';
import { catalog } from './catalog';
import { useDragDrop } from './DragDrop';
import { useEditorNavigation } from './session';
import './canvas-breadcrumb.css';
import { describeNodeName, displayNodeName } from './node-display-name';

export function CanvasBreadcrumb({
  document,
  snapshot,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
}) {
  const canAuthor = useAuthorGuard(document, snapshot);
  const canNavigate = useAuthorGuard(document, snapshot, undefined, true, 'navigation');
  const count = selectedNodeIds(snapshot.selection).length;
  const { pageId, nodeId } = snapshot.selection;
  const { navigation, state: interaction } = useEditorNavigation();
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const path = nodePath(page, nodeId);
  const host = useRef<HTMLElement>(null);
  const dragging = !!useDragDrop()?.isInteracting;
  useEffect(() => {
    if (host.current) host.current.scrollLeft = host.current.scrollWidth;
  }, [pageId, nodeId]);
  return (
    <nav className="canvas-breadcrumb" aria-label="组件层级" ref={host}>
      <Tip content={`${page.title} · ${page.id}`} side="bottom">
        <Button
          variant="ghost"
          aria-label={`选择页面 ${page.title}`}
          aria-current={!nodeId ? 'page' : undefined}
          disabled={dragging}
          onClick={() => {
            if (canNavigate()) document.select(pageId, null);
          }}
        >
          {page.title}
        </Button>
      </Tip>
      {path.map(({ node, slot }, index) => {
        const value = node.props.title ?? node.props.label;
        const legacyLabel =
          value?.kind === 'literal' && typeof value.value === 'string' && value.value.trim()
            ? value.value
            : (catalog[node.component]?.title ?? node.component);
        const label = displayNodeName(node, legacyLabel);
        return (
          <span className="canvas-breadcrumb-item" key={node.id}>
            <ChevronRight size={11} aria-hidden />
            {slot && <span className="canvas-breadcrumb-slot">{slot}</span>}
            <Tip
              content={`${describeNodeName(node, catalog[node.component]?.title ?? node.component)}${slot ? ` · ${slot} 插槽` : ''}`}
              side="bottom"
            >
              <Button
                variant="ghost"
                aria-label={`选择层级 ${label} ${node.id}`}
                aria-current={index === path.length - 1 ? 'true' : undefined}
                disabled={dragging}
                data-editor-hovered={
                  (interaction.hover?.pageId === pageId && interaction.hover.nodeId === node.id) ||
                  undefined
                }
                onPointerEnter={() =>
                  navigation.setHover({ pageId, nodeId: node.id }, 'breadcrumb')
                }
                onPointerLeave={() =>
                  navigation.clearHover('breadcrumb', { pageId, nodeId: node.id })
                }
                onClick={() => {
                  if (canAuthor()) document.select(pageId, node.id);
                }}
              >
                {label}
              </Button>
            </Tip>
          </span>
        );
      })}
      {count > 1 && <span className="canvas-breadcrumb-count">已选 {count} 项</span>}
    </nav>
  );
}
