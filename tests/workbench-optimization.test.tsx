import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl, selectPage, insertMaterial, showStructure } from './ui-helpers';

const originalWidth = window.innerWidth;
function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  fireEvent(window, new Event('resize'));
}
function pointer(target: HTMLElement, type: string, x: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}
beforeEach(() => {
  localStorage.clear();
  resize(1280);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resize(originalWidth);
});
function selectName() {
  showStructure();
  fireEvent.click(screen.getByRole('button', { name: '选中 文本输入 purchase-name' }));
}
function editName() {
  selectName();
  fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
}
function showFormModels() {
  fireEvent.click(screen.getByRole('tab', { name: '数据' }));
  fireEvent.click(screen.getByRole('tab', { name: '表单模型' }));
}

describe('workbench organization and session state', () => {
  it('shows a compact basic palette with SVG icons and no manual insertion or demo materials', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: '组件' }));
    for (const name of ['成员行', '摘要', 'React 计数器', '插槽卡片', '标题'])
      expect(screen.queryByRole('button', { name: `拖入 ${name}` })).toBeNull();
    for (const name of ['容器', '富文本', '图文展示', '评分', '滑块', '颜色选择', '级联选择', '附件上传'])
      expect(screen.getByRole('button', { name: `拖入 ${name}` })).toBeTruthy();
    expect(screen.queryByLabelText('组件类型')).toBeNull();
    expect(screen.queryByRole('button', { name: '＋ 添加组件' })).toBeNull();
    const materials = document.querySelectorAll('.material-tile');
    expect(materials).toHaveLength(38);
    expect(
      [...materials].every(
        (tile) =>
          tile.querySelector('.material-icon svg[width="16"]') && !tile.hasAttribute('title'),
      ),
    ).toBe(true);
  });
  it('adds consecutive materials with keyboard insertion into an explicit slot without switching tabs', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    for (let i = 0; i < 3; i++)
      insertMaterial('文本', { kind: 'inside', parentId: 'person-card', slot: 'footer' });
    expect(screen.getByRole('tab', { name: '组件' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const headings = within(screen.getByLabelText('页面编辑画布')).getAllByText('新的文本');
    expect(headings).toHaveLength(3);
    expect(headings.every((heading) => heading.closest('.material-card footer'))).toBe(true);
    expect(screen.queryByLabelText('插入位置')).toBeNull();
    expect(screen.getByRole('tablist', { name: '设计面板' }).getAttribute('aria-orientation')).toBe(
      'vertical',
    );
  });

  it('retains an invalid expression draft after node changes and reparenting to the mobile inspector', () => {
    seedLegacyProject();
    render(<App />);
    changeControl(screen.getByLabelText('文本内容绑定方式'), 'expression');
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), 'state.');
    selectName();
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 purchase-heading' }));
    expect((screen.getByRole('textbox', { name: '文本内容' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    resize(390);
    fireEvent.click(screen.getByRole('button', { name: '打开属性检查器' }));
    expect((screen.getByRole('textbox', { name: '文本内容' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    expect(within(screen.getByLabelText('页面编辑画布')).getByText('创建采购申请')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '文本内容放弃草稿' }));
    expect((screen.getByRole('textbox', { name: '文本内容' }) as HTMLInputElement).value).toBe(
      '创建采购申请',
    );
  });

  it('opens the property tab directly from a single selected tree row on narrow screens', () => {
    seedLegacyProject();
    resize(390);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
    showStructure();
    const field = screen.getByRole('button', { name: '选中 文本输入 purchase-name' });
    fireEvent.click(field);
    expect(screen.queryByRole('dialog', { name: '属性检查器' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑属性 purchase-name' }));

    expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull();
    const inspector = within(screen.getByRole('dialog', { name: '属性检查器' }));
    expect(inspector.getByRole('tab', { name: '属性', selected: true })).toBeTruthy();
    expect(inspector.getByRole('button', { name: '编辑字段设置' })).toBeTruthy();
    fireEvent.click(inspector.getByRole('tab', { name: '事件' }));
    fireEvent.click(inspector.getByRole('button', { name: '关闭属性检查器' }));

    fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
    expect(field.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 purchase-heading' }), {
      ctrlKey: true,
    });
    expect(screen.queryByRole('button', { name: /^编辑属性 / })).toBeNull();
    fireEvent.click(field);
    fireEvent.click(screen.getByRole('button', { name: '编辑属性 purchase-name' }));
    expect(screen.getByRole('tab', { name: '属性', selected: true })).toBeTruthy();
  });

  it('retains unsaved field rules across tabs, selections, unrelated document edits and responsive drawers', () => {
    seedLegacyProject();
    render(<App />);
    editName();
    changeControl(screen.getByLabelText('字段名称'), '未保存联系人');
    changeControl(screen.getByLabelText('规则 1 错误提示'), '请输入联系人');
    fireEvent.click(screen.getByRole('button', { name: '关闭字段设置' }));
    showStructure();
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 purchase-heading' }));
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), '与字段无关的修改');
    showFormModels();
    fireEvent.click(screen.getByRole('button', { name: '编辑字段 purchase/name' }));
    expect((screen.getByLabelText('字段名称') as HTMLInputElement).value).toBe('未保存联系人');
    resize(390);
    expect((screen.getByLabelText('规则 1 错误提示') as HTMLInputElement).value).toBe(
      '请输入联系人',
    );
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    expect(screen.queryByText('有未保存草稿')).toBeNull();
    resize(1280);
    expect(screen.getByRole('textbox', { name: '未保存联系人' })).toBeTruthy();
  });

  it('requires explicit acknowledgement when undo changes a field with a dirty draft', () => {
    seedLegacyProject();
    render(<App />);
    editName();
    changeControl(screen.getByLabelText('字段名称'), '联系人');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    changeControl(screen.getByLabelText('字段名称'), '再次修改');
    fireEvent.click(screen.getByRole('button', { name: '关闭字段设置' }));
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    expect(
      (screen.getByRole('button', { name: '保存字段设置' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText('字段名称') as HTMLInputElement).value).toBe('再次修改');
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    expect(screen.getByRole('textbox', { name: '再次修改' })).toBeTruthy();
  });

  it('preserves a Schema draft and marks conflicts while keeping properties available beside debugging', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    const source = screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement;
    const draft = source.value + '\n ';
    changeControl(source, draft);
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), '文档新版本');
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).toBe(draft);
    expect((screen.getByRole('button', { name: '校验并应用' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '最大化调试区' }));
    fireEvent.click(screen.getByRole('button', { name: '还原调试区' }));
    selectName();
    expect(screen.getByRole('tab', { name: 'Schema' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '重新载入' }));
    expect((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).toContain(
      '文档新版本',
    );
    expect(screen.getByRole('textbox', { name: '占位提示' })).toBeTruthy();
  });

  it('resizes and collapses panels without resetting React state and remembers dimensions', () => {
    seedLegacyProject();
    const view = render(<App />);
    selectPage('composition');
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const counter = screen.getByRole('button', { name: /本地计数/ });
    fireEvent.click(counter);
    const handle = screen.getByRole('separator', { name: '调整左侧面板宽度' });
    expect(handle.getAttribute('aria-valuenow')).toBe('248');
    pointer(handle, 'pointerdown', 248);
    pointer(handle, 'pointerdown', 400, 2);
    pointer(handle, 'pointercancel', 400, 2);
    pointer(handle, 'pointermove', 280);
    pointer(handle, 'pointerup', 280);
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    const width = handle.getAttribute('aria-valuenow');
    expect(Number(width)).toBeGreaterThan(224);
    fireEvent.click(screen.getByRole('button', { name: '收起左侧面板' }));
    expect(screen.getByRole('button', { name: /本地计数/ })).toBe(counter);
    expect(counter.textContent).toContain('1');
    view.unmount();
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '展开左侧面板' }));
    expect(
      screen.getByRole('separator', { name: '调整左侧面板宽度' }).getAttribute('aria-valuenow'),
    ).toBe(width);
  });

  it('keeps the outline docked when a saved inspector would otherwise consume the canvas', () => {
    localStorage.setItem('dimlu.workbench.layout.v1', JSON.stringify({
      leftWidth: 224,
      rightWidth: 460,
    }));
    resize(1024);
    seedLegacyProject();
    render(<App />);
    const left = screen.getByRole('separator', { name: '调整左侧面板宽度' });
    const right = screen.getByRole('separator', { name: '调整右侧面板宽度' });
    expect(left.getAttribute('aria-valuenow')).toBe('248');
    expect(right.getAttribute('aria-valuenow')).toBe('290');
    expect(right.getAttribute('aria-valuemax')).toBe('290');

    fireEvent.keyDown(right, { key: 'End' });
    expect(left.isConnected).toBe(true);
    expect(right.getAttribute('aria-valuenow')).toBe('290');
    resize(1440);
    expect(right.getAttribute('aria-valuenow')).toBe('460');
  });

  it('fits a persisted wide inspector to narrow desktop widths and restores its preference', () => {
    localStorage.setItem('dimlu.workbench.layout.v1', JSON.stringify({ rightWidth: 460 }));
    resize(760);
    seedLegacyProject();
    render(<App />);
    const handle = screen.getByRole('separator', { name: '调整右侧面板宽度' });
    expect(handle.getAttribute('aria-valuenow')).toBe('280');
    expect(Number(handle.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(280);
    resize(1280);
    expect(handle.getAttribute('aria-valuenow')).toBe('460');
  });

  it('creates a standalone model field after editing a bound field without changing its binding', () => {
    seedLegacyProject();
    render(<App />);
    editName();
    fireEvent.click(screen.getByRole('button', { name: '关闭字段设置' }));
    showFormModels();
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建字段' }));
    changeControl(screen.getByLabelText('字段 ID'), 'standalone');
    changeControl(screen.getByLabelText('数据路径'), 'standalone');
    changeControl(screen.getByLabelText('字段名称'), '独立字段');
    fireEvent.click(screen.getByRole('button', { name: '创建字段' }));
    expect(screen.getByRole('textbox', { name: '申请名称' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '独立字段' })).toBeNull();
    expect(screen.getByRole('button', { name: '编辑字段 purchase/standalone' })).toBeTruthy();
  });

  it('searches and folds the tree and locates a selected node hidden by the query', () => {
    seedLegacyProject();
    render(<App />);
    selectName();
    fireEvent.click(screen.getByRole('button', { name: '折叠 purchase-form' }));
    expect(screen.queryByRole('button', { name: '选中 文本输入 purchase-name' })).toBeNull();
    changeControl(screen.getByLabelText('搜索组件树'), '创建采购');
    expect(screen.getByRole('button', { name: '选中 文本 purchase-heading' })).toBeTruthy();
    changeControl(screen.getByLabelText('搜索组件树'), 'purchase-items');
    expect(screen.getByRole('button', { name: '选中 采购明细 purchase-items' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '定位当前节点' }));
    expect(screen.getByRole('button', { name: '选中 文本输入 purchase-name' })).toBeTruthy();
    expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('');
  });

  it('keeps the covered canvas out of keyboard navigation during mobile debugging', () => {
    seedLegacyProject();
    render(<App />);
    const canvas = screen.getByLabelText('页面画布');
    resize(390);
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(canvas.hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('button', { name: '最大化调试区' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    expect(canvas.hasAttribute('inert')).toBe(false);
    expect(window.document.activeElement).toBe(screen.getByRole('tab', { name: 'Schema' }));
  });

  it('retains a manually selected data field when crossing responsive breakpoints', () => {
    seedLegacyProject();
    render(<App />);
    selectName();
    showFormModels();
    fireEvent.click(screen.getByRole('button', { name: '编辑字段 purchase/approvalReason' }));
    changeControl(screen.getByLabelText('字段名称'), '待保存说明');
    resize(390);
    expect((screen.getByLabelText('字段名称') as HTMLInputElement).value).toBe('待保存说明');
    resize(1280);
    expect((screen.getByLabelText('字段名称') as HTMLInputElement).value).toBe('待保存说明');
  });

  it('searches page navigation and exposes import and export through the file menu', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
    changeControl(screen.getByLabelText('搜索页面'), '成员');
    expect(screen.queryByRole('option', { name: '采购申请' })).toBeNull();
    const option = screen.getByRole('option', { name: '成员目录' });
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe(
      'people',
    );
    fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: '导入 JSON' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: '导出 JSON' })).toBeTruthy();
  });
});
