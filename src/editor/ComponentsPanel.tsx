import { useEditorSession } from './session';
import { Tabs } from '@base-ui/react/tabs';
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
      <div className="components-panel-heading">
        <strong>组件</strong>
        <span>添加组件、查看组件树并定位当前节点</span>
      </div>
      <Tabs.Root
        className="components-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as 'materials' | 'structure')}
      >
        <Tabs.List className="components-tabs-list" aria-label="组件工作区视图">
          <Tabs.Tab value="materials" aria-label="添加组件">
            添加组件
          </Tabs.Tab>
          <Tabs.Tab value="structure" aria-label="组件树">
            组件树
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="materials" className="components-tabs-panel" keepMounted>
          <InsertPanel
            document={document}
            snapshot={snapshot}
            authoringAllowed={authoringAllowed}
          />
        </Tabs.Panel>
        <Tabs.Panel value="structure" className="components-tabs-panel" keepMounted>
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
