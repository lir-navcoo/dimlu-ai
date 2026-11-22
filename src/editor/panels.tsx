import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { findNode } from '../../packages/editor/document';
import type { ApplicationMethodReference } from '../../packages/editor/data';
import type { OpenApplicationMethods } from './ActionPanel';
import { ComponentTree } from './ComponentTree';
import { DataPanel } from './DataPanel';
import { CodePanel } from '../code/CodePanel';
import { InsertPanel } from './InsertPanel';
import { PagePanel } from './PagePanel';
import { PageLifecyclePanel } from './PageLifecyclePanel';
import { editorPanelRoutes, type EditorPanelId } from './panel-routes';
import type { ReactNode } from 'react';
export type EditorPanelContext = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  dataNodeId?: string;
  authoringAllowed?: boolean;
  onNavigatePage?: (pageId: string) => void;
  onOpenMethods?: OpenApplicationMethods;
  onEditProperties?: () => void;
  pageEntryTarget?: ApplicationMethodReference;
};
const renderers: Record<EditorPanelId, (context: EditorPanelContext) => ReactNode> = {
  pages: ({ document, snapshot, authoringAllowed, onNavigatePage }) => (
    <PagePanel
      document={document}
      snapshot={snapshot}
      authoringAllowed={authoringAllowed}
      onNavigatePage={onNavigatePage}
    />
  ),
  materials: ({ document, snapshot, authoringAllowed }) => (
    <InsertPanel
      document={document}
      snapshot={snapshot}
      authoringAllowed={authoringAllowed}
    />
  ),
  outline: ({ document, snapshot, onEditProperties }) => (
    <ComponentTree document={document} snapshot={snapshot} onEditProperties={onEditProperties} />
  ),
  data: ({ document, snapshot, dataNodeId, authoringAllowed }) => (
    <DataPanel
      key={snapshot.selection.pageId}
      document={document}
      snapshot={snapshot}
      authoringAllowed={authoringAllowed}
      node={
        dataNodeId
          ? findNode(snapshot.plan.pages.get(snapshot.selection.pageId)!.schema, dataNodeId)?.node
          : undefined
      }
    />
  ),
  logic: ({ document, snapshot, authoringAllowed, onOpenMethods, pageEntryTarget }) => (
    <PageLifecyclePanel
      key={snapshot.selection.pageId}
      document={document}
      snapshot={snapshot}
      authoringAllowed={authoringAllowed ?? false}
      onOpenMethods={onOpenMethods}
      focusReference={pageEntryTarget}
    />
  ),
  code: ({ document, snapshot }) => (
    <CodePanel key={snapshot.selection.pageId} document={document} snapshot={snapshot} />
  ),
};
export const designPanels = editorPanelRoutes.map((panel) => ({
  ...panel,
  render: renderers[panel.id],
}));
export { editorPanelRoute, type EditorPanelId } from './panel-routes';
