import { changeControl, showMaterials, selectPage, showStructure } from './ui-helpers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';

const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalElementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
const beginMaterial = (title = '标题') => {
  showMaterials();
  fireEvent.keyDown(screen.getByRole('button', { name: `拖入 ${title}` }), { key: ' ' });
};
const choose = (intent: object) =>
  changeControl(screen.getByLabelText('拖放位置'), JSON.stringify(intent));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
function readSchema() {
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  return (screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value;
}
function pointerEvent(target: Element | Window, type: string, pointerId = 1, x = 10, y = 10) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

describe('drag authoring', () => {
  it('keeps the same canvas and tree drop targets when a drag starts or changes target', () => {
    seedLegacyProject();
    const { container } = render(<App />);
    selectPage('composition');
    showMaterials();
    const zones = [...container.querySelectorAll('[data-drop-intent]')];
    beginMaterial();
    expect([...container.querySelectorAll('[data-drop-intent]')]).toEqual(zones);
    choose({ kind: 'inside', parentId: 'person-card', slot: 'footer' });
    expect([...container.querySelectorAll('[data-drop-intent]')]).toEqual(zones);
  });
  it('starts keyboard dragging from the focused canvas without an overlay handle', () => {
    seedLegacyProject();
    render(<App />);
    const canvas = screen.getByLabelText('页面编辑画布');
    canvas.focus();
    fireEvent.keyDown(canvas, { key: ' ' });
    expect(screen.getByLabelText('拖放位置')).toBe(document.activeElement);
    expect(screen.queryByRole('button', { name: '拖动画布组件 purchase-heading' })).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
  });
  it('drags the selected component body with stable capture and a movement threshold', () => {
    seedLegacyProject();
    const { container } = render(<App />);
    const heading = screen.getByRole('heading', { name: '创建采购申请' });
    const canvas = screen.getByLabelText('页面编辑画布');
    const capture = vi.fn();
    Object.defineProperty(canvas, 'setPointerCapture', { value: capture });
    pointerEvent(heading, 'pointerdown', 1, 10, 10);
    expect(capture).toHaveBeenCalledWith(1);
    pointerEvent(window, 'pointermove', 1, 12, 12);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    pointerEvent(window, 'pointermove', 1, 100, 100);
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    expect(container.querySelector('.editor-canvas')).toBe(canvas);
    pointerEvent(window, 'pointercancel');
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    pointerEvent(heading, 'pointerdown');
    pointerEvent(window, 'pointerup');
    fireEvent.click(canvas, { detail: 1 });
    expect(screen.getByRole('textbox', { name: '标题' })).toBeTruthy();
  });
  it('drags a selected container from its children and permits click selection without moving', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '选中 表单容器 purchase-form' }));
    const input = screen.getByRole('textbox', { name: '申请名称' });
    pointerEvent(input, 'pointerdown');
    pointerEvent(window, 'pointermove', 1, 100, 100);
    expect(
      screen.getByText(/移动.*purchase-form/, { selector: '.drag-feedback strong' }),
    ).toBeTruthy();
    pointerEvent(window, 'pointercancel');
    pointerEvent(input, 'pointerdown');
    pointerEvent(window, 'pointerup');
    fireEvent.click(screen.getByLabelText('页面编辑画布'), { detail: 1 });
    expect(screen.getByRole('textbox', { name: '占位提示' })).toBeTruthy();
  });
  it('ignores cancellation from another pointer and cancels when its own capture is lost', () => {
    seedLegacyProject();
    render(<App />);
    showMaterials();
    const source = screen.getByRole('button', { name: '拖入 标题' });
    pointerEvent(source, 'pointerdown');
    pointerEvent(window, 'pointermove', 1, 100, 100);
    pointerEvent(window, 'pointercancel', 2);
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    pointerEvent(source, 'lostpointercapture');
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('inserts material into a named slot, reorders it, undoes once and roundtrips the result', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    beginMaterial();
    expect(document.activeElement).toBe(screen.getByLabelText('拖放位置'));
    choose({ kind: 'inside', parentId: 'person-card', slot: 'footer' });
    confirm();
    const heading = screen.getByRole('heading', { name: '新的标题' });
    expect(heading.closest('.material-card footer')).toBeTruthy();
    const id = heading.closest('[data-editor-node]')!.getAttribute('data-editor-node')!;
    showStructure();
    fireEvent.keyDown(screen.getByRole('button', { name: `拖动 标题 ${id}` }), { key: 'Enter' });
    choose({ kind: 'before', nodeId: 'card-status' });
    confirm();
    const exported = readSchema(),
      page = JSON.parse(exported).pages[2];
    expect(page.children[1].slots.footer.children.map((n: { id: string }) => n.id)).toEqual([
      id,
      'card-status',
    ]);
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(
      JSON.parse(
        (screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value,
      ).pages[2].children[1].slots.footer.children.map((n: { id: string }) => n.id),
    ).toEqual(['card-status', id]);
    changeControl(screen.getByLabelText('应用定义 · JSON'), exported);
    fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
    expect((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).toBe(exported);
  });
  it('rejects cyclic and scope-breaking destinations before drop and cancels without history', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动 标题 card-heading' }), { key: ' ' });
    expect((screen.getByRole('button', { name: '确认放置' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/移动后缺少作用域 scope.record/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动 插槽卡片 person-card' }), {
      key: ' ',
    });
    choose({ kind: 'inside', parentId: 'person-card', slot: 'header' });
    expect(screen.getByText('不能移动到自身或自己的子树')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消拖动' }));
    expect(screen.getByRole('heading', { name: '林知远' })).toBeTruthy();
  });
  it('exposes empty page, layout and slot targets and hides them in preview mode', () => {
    seedLegacyProject();
    render(<App />);
    beginMaterial('布局容器');
    confirm();
    expect(screen.getByText('布局容器 · 空容器，拖入组件')).toBeTruthy();
    expect(
      screen.getByText('布局容器 · 空容器，拖入组件').closest('.material-layout'),
    ).toBeTruthy();
    const layout = screen
      .getByText('布局容器 · 空容器，拖入组件')
      .closest('[data-editor-node]')!
      .getAttribute('data-editor-node')!;
    beginMaterial();
    choose({ kind: 'inside', parentId: layout });
    confirm();
    expect(
      screen.getByRole('heading', { name: '新的标题' }).closest('.material-layout.stack'),
    ).toBeTruthy();
    expect(screen.queryByText('布局容器 · 空容器，拖入组件')).toBeNull();
    selectPage('composition');
    expect(screen.getAllByText('footer 插槽 · 拖入组件')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(screen.queryByText('footer 插槽 · 拖入组件')).toBeNull();
    expect(screen.queryByText('页面末尾 · 拖入组件')).toBeNull();
    showMaterials();
    expect((screen.getByRole('button', { name: '拖入 标题' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  it('shows why conditional and field nodes are invisible while keeping preview visibility unchanged', () => {
    seedLegacyProject();
    const { container } = render(<App />);
    expect(container.querySelector('[data-editor-node="purchase-reason"]')?.textContent).toContain(
      '字段当前不可见',
    );
    expect(container.querySelector('[data-editor-node="purchase-result"]')?.textContent).toContain(
      '显示条件未满足',
    );
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(container.querySelector('[data-editor-node="purchase-reason"]')).toBeNull();
    expect(container.querySelector('[data-editor-node="purchase-result"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    expect(container.querySelector('[data-editor-node="purchase-reason"]')).toBeTruthy();
  });
  it('keeps native state, cancels on document changes and blocks page switching until drag is canceled', () => {
    seedLegacyProject();
    render(<App />);
    selectPage('composition');
    changeControl(screen.getByRole('textbox', { name: '标题' }), '拖拽前历史标题');
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const counter = screen.getByRole('button', { name: /本地计数/ });
    fireEvent.click(counter);
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    beginMaterial();
    expect(counter.textContent).toContain('1');
    fireEvent.click(screen.getByRole('button', { name: '取消拖动' }));
    expect(screen.getByRole('button', { name: /本地计数/ })).toBe(counter);
    const beforeDragWrite = readSchema();
    beginMaterial();
    changeControl(screen.getByRole('textbox', { name: '标题' }), '修改会取消拖动');
    expect(readSchema()).toBe(beforeDragWrite);
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(readSchema()).not.toBe(beforeDragWrite);
    expect(readSchema()).not.toContain('拖拽前历史标题');
    beginMaterial();
    const pageSwitcher = screen.getByRole('combobox', { name: '切换页面' });
    expect((pageSwitcher as HTMLButtonElement).disabled).toBe(true);
    expect(pageSwitcher.getAttribute('data-value')).toBe('composition');
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消拖动' }));
    selectPage('purchase');
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    const schema = readSchema();
    expect(schema).not.toContain('candidate');
    expect(schema).not.toContain('data-drop-intent');
  }, 15000);
  it('uses pointer thresholds, fresh release hit testing, cancellation and a single undo step', () => {
    seedLegacyProject();
    render(<App />);
    showMaterials();
    const source = screen.getByRole('button', { name: '拖入 标题' });
    const target = screen.getByText('页面末尾 · 拖入组件');
    const hitTest = vi.fn((): Element | null => target);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: hitTest,
    });
    const pointer = (type: string, x: number, y: number) =>
      fireEvent(
        window,
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
        }),
      );
    fireEvent(
      source,
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 0,
      }),
    );
    pointer('pointermove', 12, 12);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    pointer('pointermove', 150, 150);
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '新的标题' })).toBeNull();
    // A previously valid hover must not commit when released outside the editor.
    hitTest.mockReturnValue(null);
    pointer('pointerup', 150, 150);
    fireEvent.click(source, { detail: 1 });
    expect(screen.queryByRole('heading', { name: '新的标题' })).toBeNull();
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    hitTest.mockReturnValue(target);
    fireEvent(
      source,
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 0,
      }),
    );
    pointer('pointermove', 150, 150);
    pointer('pointerup', 150, 150);
    fireEvent.click(source, { detail: 1 });
    expect(screen.getByRole('heading', { name: '新的标题' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(screen.queryByRole('heading', { name: '新的标题' })).toBeNull();
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent(
      source,
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 0,
      }),
    );
    pointer('pointermove', 150, 150);
    pointer('pointercancel', 150, 150);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
  }, 15000);
});
