import { changeControl, selectPage, moveNode } from './ui-helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { registry } from '../src/materials';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 200, 40));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const preview = () => fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
const edit = () => fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
const schema = () => {
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  return (screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value;
};
describe('canvas selection and structural authoring', () => {
  it('selects the nearest node, synchronizes the tree and property panel and keeps the debug view open', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: '页面状态' }));
    fireEvent.click(screen.getByRole('heading', { name: '采购明细' }));
    expect(
      screen
        .getByRole('button', { name: '选中 采购明细 purchase-items' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('textbox', { name: '明细 ID' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '页面状态' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByLabelText('运行调试').className).toContain('open');
    fireEvent.click(screen.getByRole('heading', { name: '创建采购申请' }));
    expect(screen.getByRole('textbox', { name: '标题' })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('页面编辑画布'), { key: 'Escape' });
    expect(screen.getByText('选择组件后配置')).toBeTruthy();
  });
  it('blocks form actions in edit mode and keeps form data when switching modes and selecting', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /新增明细/ }));
    expect(screen.getAllByRole('group', { name: /采购明细第/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    expect(screen.queryByText('请填写申请名称')).toBeNull();
    preview();
    const input = screen.getByRole('textbox', { name: '申请名称' }) as HTMLInputElement;
    changeControl(input, '跨模式保留');
    fireEvent.click(screen.getByRole('button', { name: /新增明细/ }));
    expect(screen.getAllByRole('group', { name: /采购明细第/ })).toHaveLength(2);
    edit();
    fireEvent.pointerDown(input);
    fireEvent.click(input);
    expect(
      screen
        .getByRole('button', { name: '选中 文本输入 purchase-name' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    preview();
    expect(screen.getByRole('textbox', { name: '申请名称' })).toBe(input);
    expect(input.value).toBe('跨模式保留');
    expect(screen.getAllByRole('group', { name: /采购明细第/ })).toHaveLength(2);
  });
  it('preserves native React hook state and prevents component event handlers in edit mode', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    preview();
    const counter = screen.getByRole('button', { name: /本地计数/ });
    expect(counter.getAttribute('tabindex')).toBe('0');
    fireEvent.click(counter);
    expect(counter.textContent).toContain('1');
    edit();
    expect(counter.getAttribute('tabindex')).toBe('-1');
    fireEvent.click(counter);
    expect(counter.textContent).toContain('1');
    expect(
      screen
        .getByRole('button', { name: '选中 React 计数器 native-react' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    preview();
    expect(counter.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('button', { name: /本地计数/ })).toBe(counter);
    fireEvent.click(counter);
    expect(counter.textContent).toContain('2');
  });
  it('copies a selected heading, edits it, moves it into a container, undoes and roundtrips JSON', async () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('heading', { name: '创建采购申请' }));
    const copy = await screen.findByRole('button', { name: '复制选中组件' });
    copy.focus();
    expect(document.activeElement).toBe(copy);
    fireEvent.pointerDown(copy);
    fireEvent.click(copy);
    expect(screen.getAllByRole('heading', { name: '创建采购申请' })).toHaveLength(2);
    changeControl(screen.getByRole('textbox', { name: '标题' }), '副本标题');
    const copyId = screen
      .getByRole('heading', { name: '副本标题' })
      .closest('[data-editor-node]')!
      .getAttribute('data-editor-node')!;
    moveNode(copyId, { kind: 'inside', parentId: 'purchase-note' });
    expect(
      screen.getByRole('heading', { name: '副本标题' }).closest('.material-layout.row'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(
      screen.getByRole('heading', { name: '副本标题' }).closest('.material-layout.row'),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    const exported = schema();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    changeControl(screen.getByLabelText('应用定义 · JSON'), exported);
    fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
    expect(
      screen.getByRole('heading', { name: '副本标题' }).closest('.material-layout.row'),
    ).toBeTruthy();
    expect((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).toBe(exported);
  }, 15000);
  it('reorders siblings with keyboard dragging', () => {
    seedLegacyProject();
    render(<App />);
    moveNode('purchase-heading', { kind: 'after', nodeId: 'purchase-form' });
    const page = JSON.parse(schema()).pages[0];
    expect(page.children.map((n: { id: string }) => n.id)).toEqual([
      'purchase-form',
      'purchase-heading',
    ]);
  });
  it('selects slot content and rejects loss of required slot scope without changing the preview', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    fireEvent.click(screen.getByRole('heading', { name: '林知远' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动 标题 card-heading' }), { key: ' ' });
    expect(screen.getByText(/scope.record/, { selector: '.drag-feedback small' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: '林知远' }).closest('.material-card header'),
    ).toBeTruthy();
    changeControl(
      screen.getByLabelText('拖放位置'),
      JSON.stringify({ kind: 'inside', parentId: 'person-card', slot: 'footer' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('heading', { name: '林知远' }).closest('.material-card footer'),
    ).toBeTruthy();
  });
  it('keeps an empty repeated definition selectable without business requests in design mode', () => {
    const search = vi.spyOn(registry.actions['demo.searchPeople'], 'execute');
    seedLegacyProject();
    render(<App />);
    selectPage('people');
    const canvas = screen.getByLabelText('页面编辑画布');
    const placeholder = within(canvas).getByText(/循环数据为空/);
    expect(within(canvas).queryByText('陈嘉宁', { exact: true })).toBeNull();
    fireEvent.click(placeholder);
    expect(
      screen.getByRole('button', { name: '选中 成员行 people-row' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(search).not.toHaveBeenCalled();
  });
  it('selects a shared definition from repeated instances', async () => {
    seedLegacyProject();
    render(<App />);
    selectPage('people');
    preview();
    const person = await screen.findByText('陈嘉宁', { exact: true });
    edit();
    expect(screen.getByText('陈嘉宁', { exact: true })).toBe(person);
    fireEvent.click(person);
    const canvas = screen.getByLabelText('页面编辑画布');
    const repeated = person.closest('[data-editor-node]')!;
    const id = repeated.getAttribute('data-editor-node');
    expect(
      screen.getByRole('button', { name: `选中 成员行 ${id}` }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(canvas).getAllByText('查看资料 ↗')).toHaveLength(4);
  });
});
