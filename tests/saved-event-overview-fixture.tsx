import { useSyncExternalStore } from 'react';
import { render } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { ApplicationSchema, NodeSchema } from '../packages/schema/types';
import { ActionPanel } from '../src/editor/ActionPanel';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { registry } from '../src/materials';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { TipProvider } from '../src/ui/primitives';

export function overviewHarness(
  schema: ApplicationSchema = structuredClone(purchaseManagementExample),
  pageId = 'purchases',
  nodeId = 'purchase-table',
) {
  const author = new EditorDocument(schema, registry);
  author.select(pageId, nodeId);
  let session!: ReturnType<typeof useEditorSession>;
  function Host() {
    session = useEditorSession();
    const snapshot = useSyncExternalStore(author.subscribe, author.getSnapshot);
    const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
    const node = snapshot.selection.nodeId && findNode(page, snapshot.selection.nodeId)?.node;
    return node ? <ActionPanel document={author} snapshot={snapshot} node={node} /> : null;
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Host />
      </TipProvider>
    </EditorSessionProvider>,
  );
  return { author, view, session: () => session };
}

export function overviewNode(
  author: EditorDocument,
  id = 'purchase-table',
  pageId = 'purchases',
): NodeSchema {
  return findNode(author.getSnapshot().plan.pages.get(pageId)!.schema, id)!.node;
}

export function emptyEventApplication(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'saved-event-empty',
    title: 'Saved event empty boundary',
    entryPageId: 'page',
    dependencies: {
      components: { 'ui.button': '1.0.0', 'ui.input': '1.0.0', 'ui.text': '1.0.0' },
      actions: {},
    },
    pages: [
      {
        id: 'page',
        title: 'Boundary',
        state: [],
        forms: [
          {
            id: 'form',
            fields: [{ id: 'name', path: ['name'], label: 'Name', type: 'string', initial: '' }],
          },
        ],
        children: [
          {
            id: 'absent',
            component: 'ui.button',
            props: { label: { kind: 'literal', value: 'Absent' } },
          },
          {
            id: 'empty',
            component: 'ui.button',
            props: { label: { kind: 'literal', value: 'Empty' } },
            on: { onClick: [] },
          },
          {
            id: 'managed',
            component: 'ui.input',
            props: {},
            field: { formId: 'form', fieldId: 'name' },
          },
          {
            id: 'none',
            component: 'ui.text',
            props: { value: { kind: 'literal', value: 'No event' } },
          },
        ],
      },
    ],
  };
}
