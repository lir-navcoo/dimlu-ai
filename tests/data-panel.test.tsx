import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { EditorDocument } from '../packages/editor/document';
import { DataPanel } from '../src/editor/DataPanel';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { dataSourceExample } from '../src/data-source-example';
import { changeControl } from './ui-helpers';
afterEach(cleanup);
function Harness({ document }: { document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  return <DataPanel document={document} snapshot={snapshot} />;
}
function mount(document: EditorDocument) {
  render(
    <TipProvider>
      <EditorSessionProvider>
        <Harness document={document} />
      </EditorSessionProvider>
    </TipProvider>,
  );
}
describe('data configuration panels', () => {
  it('authors dataRef properties through the shared source and reversible path controls', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    doc.select('query', 'query-error');
    function Inspector() {
      const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
      return <PropertyPanel document={doc} snapshot={snapshot} />;
    }
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Inspector />
        </EditorSessionProvider>
      </TipProvider>,
    );
    changeControl(screen.getByLabelText('文本内容绑定方式'), 'dataRef');
    changeControl(screen.getByLabelText('文本内容数据源'), 'people');
    changeControl(screen.getByRole('textbox', { name: '文本内容数据路径' }), '["rows"]');
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('query')!
        .schema.children.find((node) => node.id === 'query-error')!.props.value,
    ).toEqual({ kind: 'dataRef', sourceId: 'people', path: ['rows'] });
    changeControl(screen.getByRole('textbox', { name: '文本内容数据路径' }), '[');
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => doc.select('query', 'heading'));
    act(() => doc.select('query', 'query-error'));
    expect(
      (screen.getByRole('textbox', { name: '文本内容数据路径' }) as HTMLInputElement).value,
    ).toBe('[');
  });
  it('creates a state with one undoable save and keeps invalid source drafts across tabs', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    fireEvent.click(screen.getByRole('button', { name: '新建状态' }));
    changeControl(screen.getByRole('textbox', { name: '状态 ID' }), 'selected');
    changeControl(screen.getByRole('textbox', { name: '状态初始值' }), '"新状态"');
    fireEvent.click(screen.getByRole('button', { name: '创建状态' }));
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('query')!
        .schema.state.some((state) => state.id === 'selected'),
    ).toBe(true);
    act(() => doc.undo());
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('query')!
        .schema.state.some((state) => state.id === 'selected'),
    ).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{');
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭数据源编辑' }));
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    expect(
      (screen.getByRole('textbox', { name: '数据源初始值' }) as HTMLTextAreaElement).value,
    ).toBe('{');
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0].initial).toEqual({
      rows: [],
      total: 0,
    });
  });
  it('requires conflict confirmation before replacing updated source definitions', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{"rows":[],"total":5}');
    const source = doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0];
    act(() =>
      doc.updateDataSource('query', 'people', { ...source, initial: { rows: [], total: 2 } }),
    );
    expect((screen.getByRole('button', { name: '保存数据源' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0].initial).toEqual({
      rows: [],
      total: 5,
    });
  });
});
