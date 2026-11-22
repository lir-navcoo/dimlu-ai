import { useEditorSession } from './session';
import { Tabs } from '@base-ui/react/tabs';
import { LayoutGrid, ListTree } from 'lucide-react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { ComponentTree } from './ComponentTree';
import { InsertPanel } from './InsertPanel';

export function ComponentsPanel({
  document,
  snapshot,
  authoringAllowed,
  onEditProperties,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed?: boolean;
  onEditProperties?: () => void;
}) {
  const { componentView: tab, setComponentView: setTab } = useEditorSession();
  return (
    <section className="components-panel" aria-label="组件工作区">
      <Tabs.Root
        className="components-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as 'materials' | 'structure')}
      >
        <Tabs.List className="components-tabs-list" aria-label="组件工作区视图">
          <Tabs.Tab value="materials" aria-label="添加组件">
            <LayoutGrid size={14} aria-hidden="true" />
            <span>组件</span>
          </Tabs.Tab>
          <Tabs.Tab value="structure" aria-label="组件树">
            <ListTree size={14} aria-hidden="true" />
            <span>大纲</span>
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="materials" className="components-tabs-panel sidebar-content" keepMounted>
          <InsertPanel
            document={document}
            snapshot={snapshot}
            authoringAllowed={authoringAllowed}
          />
        </Tabs.Panel>
        <Tabs.Panel value="structure" className="components-tabs-panel sidebar-content" keepMounted>
          <ComponentTree
            document={document}
            snapshot={snapshot}
            onEditProperties={onEditProperties}
          />
        </Tabs.Panel>
      </Tabs.Root>
    </section>
  );
}
