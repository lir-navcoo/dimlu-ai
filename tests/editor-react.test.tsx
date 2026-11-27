import { useSyncExternalStore } from 'react';
import { changeControl, insertMaterial, selectPage } from './ui-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import App from '../src/App';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { exampleApplication } from './fixtures/examples';
import { seedLegacyProject } from './legacy-project';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const canvasText = (name: string) =>
  within(screen.getByLabelText('页面编辑画布')).getByText(name, { exact: true });
const canvasQueryText = (name: string) =>
  within(screen.getByLabelText('页面编辑画布')).queryByText(name, { exact: true });
function editTitle(value: string) {
  changeControl(screen.getByRole('textbox', { name: '文本内容' }), value);
}
describe('authoring workbench', () => {
  it('prioritizes page code settings while keeping the component selection', () => {
    const document = new EditorDocument(exampleApplication, registry);
    const { pageId, nodeId } = document.getSnapshot().selection;
    expect(nodeId).toBe('purchase-heading');

    function Inspector() {
      const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
      return <PropertyPanel document={document} snapshot={snapshot} authoringAllowed />;
    }
    render(
      <EditorSessionProvider>
        <TipProvider>
          <Inspector />
        </TipProvider>
      </EditorSessionProvider>,
    );
    expect(screen.getByRole('tablist', { name: '组件设置' })).toBeTruthy();
    act(() => document.select(pageId, null));
    expect(screen.getByRole('tab', { name: '页面逻辑', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '页面样式' })).toBeNull();
    act(() => document.select(pageId, nodeId));

    act(() => {
      document.setPageCode(pageId, {
        enabled: true,
        language: 'tsx',
        source: 'export default () => <p>Page code</p>;',
        css: '',
      });
    });
    expect(document.getSnapshot().selection.nodeId).toBe(nodeId);
    expect(screen.getByRole('tab', { name: '页面代码', selected: true })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '页面样式' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'CSS' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: '组件设置' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '禁用代码' }));
    expect(document.getSnapshot().selection.nodeId).toBe(nodeId);
    expect(screen.getByRole('tablist', { name: '组件设置' })).toBeTruthy();
  });
  it('edits the selected title immediately and undoes a complete focus session', () => {
    seedLegacyProject();
    render(<App />);
    const input = screen.getByRole('textbox', { name: '文本内容' });
    fireEvent.focus(input);
    editTitle('新');
    editTitle('新的采购页面');
    fireEvent.blur(input);
    expect(canvasText('新的采购页面')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(canvasText('创建采购申请')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(canvasText('新的采购页面')).toBeTruthy();
  });
  it('retains the accepted preview for invalid expressions and applies valid JavaScript expressions', () => {
    seedLegacyProject();
    render(<App />);
    changeControl(screen.getByLabelText('文本内容绑定方式'), 'expression');
    const expression = screen.getByRole('textbox', { name: '文本内容' });
    changeControl(expression, 'state.');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(canvasText('创建采购申请')).toBeTruthy();
    changeControl(expression, JSON.stringify('表达式标题'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(canvasText('表达式标题')).toBeTruthy();
  });
  it('preserves form input when selecting nodes and keeps field-owned properties managed', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const input = screen.getByRole('textbox', { name: '申请名称' });
    changeControl(input, '保留运行数据');
    fireEvent.click(screen.getByRole('button', { name: '选中 文本输入 purchase-name' }));
    expect(screen.getByRole('textbox', { name: '申请名称' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('保留运行数据');
    expect(screen.queryByLabelText('输入值绑定方式')).toBeNull();
    expect(screen.getAllByText('由表单字段 name 管理').length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: '占位提示' })).toBeTruthy();
  });
  it('removes an optional property and inserts and deletes a component with undo', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 200, 40),
    );
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 purchase-heading-note' }));
    changeControl(screen.getByLabelText('文字色调绑定方式'), 'unset');
    // 可选属性取消后，绑定控件保留并显示“未设置”。
    expect(screen.getByLabelText('文字色调绑定方式').getAttribute('data-value')).toBe('unset');
    insertMaterial();
    expect(canvasText('新的文本')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '删除选中组件' }));
    expect(canvasQueryText('新的文本')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(canvasText('新的文本')).toBeTruthy();
  });
  it('keeps state references until explicitly replaced and supports named slot insertion', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    fireEvent.click(screen.getByRole('button', { name: '选中 插槽卡片 person-card' }));
    expect(screen.getByLabelText('成员数据绑定方式').getAttribute('data-value')).toBe('reference');
    expect(screen.getByText(/stateRef/, { selector: '.reference-value' })).toBeTruthy();
    insertMaterial('文本', { kind: 'inside', parentId: 'person-card', slot: 'header' });
    const inserted = canvasText('新的文本');
    expect(inserted.closest('.material-card header')).toBeTruthy();
  });
  it('roundtrips editor changes through the shared Schema import surface', () => {
    seedLegacyProject();
    render(<App />);
    editTitle('JSON往返');
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    const source = screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement;
    const exported = source.value;
    expect(JSON.parse(exported).pages[0].children[0].props.value.value).toBe('JSON往返');
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(canvasText('创建采购申请')).toBeTruthy();
    changeControl(source, exported);
    fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
    expect(canvasText('JSON往返')).toBeTruthy();
    changeControl(source, '{}');
    fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(canvasText('JSON往返')).toBeTruthy();
  });
  it('edits numeric values without coercing incomplete input and leaves unbound controls read-only', () => {
    seedLegacyProject();
    render(<App />);
    insertMaterial('数字输入');
    const preview = screen.getByRole('spinbutton', { name: '数字输入' }) as HTMLInputElement;
    expect(preview.readOnly).toBe(true);
    changeControl(screen.getByRole('spinbutton', { name: '输入值' }), '12.5');
    expect((screen.getByRole('spinbutton', { name: '数字输入' }) as HTMLInputElement).value).toBe(
      '12.5',
    );
    changeControl(screen.getByRole('spinbutton', { name: '输入值' }), '');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('spinbutton', { name: '数字输入' }) as HTMLInputElement).value).toBe(
      '12.5',
    );
  });
  it('applies boolean, select and structured JSON setters using their actual types', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '选中 按钮 purchase-reset' }));
    changeControl(screen.getByLabelText('禁用绑定方式'), 'literal');
    fireEvent.click(screen.getByRole('checkbox', { name: '禁用' }));
    expect((screen.getByRole('button', { name: '重置表单' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    changeControl(screen.getByLabelText('按钮样式'), '"primary"');
    expect(screen.getByRole('button', { name: '重置表单' }).className).toContain('primary');
    selectPage('composition');
    fireEvent.click(screen.getByRole('button', { name: '选中 插槽卡片 person-card' }));
    changeControl(screen.getByLabelText('成员数据绑定方式'), 'literal');
    changeControl(
      screen.getByRole('textbox', { name: '成员数据' }),
      '{"name":"JSON成员","department":"测试部","role":"工程师"}',
    );
    expect(screen.getByText('JSON成员', { exact: true })).toBeTruthy();
    changeControl(screen.getByRole('textbox', { name: '成员数据' }), '{"name":');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('JSON成员', { exact: true })).toBeTruthy();
  });
});
