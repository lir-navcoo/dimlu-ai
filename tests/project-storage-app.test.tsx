import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { serverRecordsExample } from '../src/server-records-example';
import { registry } from '../src/materials';
import { exampleApplication } from '../src/examples';
import { changeControl } from './ui-helpers';
import { seedLegacyProject } from './legacy-project';
import { findNode } from '../packages/editor/document';

function selectHeading() {
  fireEvent.click(screen.getByRole('button', { name: '选中 标题 purchase-heading' }));
}
const undoButton = () =>
  within(screen.getByLabelText('文档操作')).getByRole('button', {
    name: '↶ 撤销',
  });
const savedHeading = (raw: string) =>
  findNode(JSON.parse(raw).schema.pages[0], 'purchase-heading')!.node.props.title;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('workbench saved project recovery', () => {
  it('persists committed edits/Undo on pagehide and rebuilds in edit mode without preview values or history', async () => {
    seedLegacyProject();
    const view = render(
      <StrictMode>
        <App saveDelayMs={10} />
      </StrictMode>,
    );
    const title = screen.getByRole('textbox', { name: '标题' });
    fireEvent.focus(title);
    changeControl(title, '本地项目');
    fireEvent.blur(title);
    fireEvent.focus(title);
    changeControl(title, '待撤销');
    fireEvent.blur(title);
    fireEvent.click(undoButton());
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    changeControl(screen.getByRole('textbox', { name: '申请名称' }), '运行时输入不保存');
    fireEvent.click(screen.getByRole('button', { name: '选中 文本输入 purchase-name' }));
    fireEvent(window, new Event('pagehide'));
    expect(screen.getByLabelText('本地保存状态').textContent).toBe('已保存');
    view.unmount();
    render(<App saveDelayMs={10} />);
    expect(screen.getByRole('button', { name: '编辑模式' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('heading', { name: '本地项目' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '申请名称' }) as HTMLInputElement).value).toBe('');
    expect((undoButton() as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen
        .getByRole('button', { name: '选中 文本输入 purchase-name' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).not.toContain('运行时输入不保存');
  });
  it('restores a query page without entering preview or executing onEnter', () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        storageVersion: 1,
        savedAt: 'old',
        schema: serverRecordsExample,
        selection: { pageId: 'records', nodeId: null },
      }),
    );
    localStorage.setItem('dimlu.workbench.layout.v1', 'null');
    const query = vi.spyOn(registry.transports!['demo.recordsQuery'], 'execute');
    render(<App />);
    expect(screen.getByRole('heading', { name: '服务端记录管理' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑模式' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(query).not.toHaveBeenCalled();
  });
  it('preserves bad raw storage through selection/layout/unmount and requires Dialog confirmation to replace', async () => {
    const raw = '{"storageVersion":88,"schema":"future"}  ';
    localStorage.setItem(PROJECT_STORAGE_KEY, raw);
    const view = render(<App saveDelayMs={1} />);
    expect(screen.getByRole('alert').textContent).toContain('本地副本已保护');
    selectHeading();
    changeControl(screen.getByRole('textbox', { name: '标题' }), '覆盖前内存');
    fireEvent.click(screen.getByRole('button', { name: '选中 文本输入 purchase-applicant' }));
    fireEvent.click(screen.getByRole('button', { name: '收起左侧面板' }));
    fireEvent(window, new Event('pagehide'));
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    fireEvent.click(screen.getByRole('button', { name: '本地项目菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '用当前项目替换本地副本…' }));
    expect(await screen.findByRole('dialog', { name: '替换受保护的本地副本？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    view.unmount();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '本地项目菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '用当前项目替换本地副本…' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认替换' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '替换受保护的本地副本？' })).toBeNull(),
    );
    expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).storageVersion).toBe(1);
    expect(screen.getByLabelText('本地保存状态').textContent).toBe('已保存');
  });
  it('requires explicit reset and rebuilds the document/session', async () => {
    seedLegacyProject();
    render(<App />);
    changeControl(screen.getByRole('textbox', { name: '标题' }), '已修改项目');
    fireEvent.click(screen.getByRole('button', { name: '本地项目菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重置项目…' }));
    expect(await screen.findByRole('dialog', { name: '重置本地项目？' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '已修改项目', hidden: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认重置' }));
    expect(screen.getByRole('heading', { name: '采购申请管理' })).toBeTruthy();
    expect((undoButton() as HTMLButtonElement).disabled).toBe(true);
    expect(savedHeading(localStorage.getItem(PROJECT_STORAGE_KEY)!)).toEqual({
      kind: 'literal',
      value: '采购申请管理',
    });
  });
  it('keeps write failures visible, preserves current memory and retries the latest committed Schema', async () => {
    let saved: string | null = null,
      fail = true;
    const storage = {
      getItem: () => saved,
      setItem: vi.fn((_key: string, value: string) => {
        if (fail) throw new DOMException('没有存储权限', 'SecurityError');
        saved = value;
      }),
    };
    render(<App projectStorage={storage} saveDelayMs={1} />);
    await waitFor(() => expect(screen.getByLabelText('本地保存状态').textContent).toBe('保存失败'));
    selectHeading();
    changeControl(screen.getByRole('textbox', { name: '标题' }), '失败后的最新定义');
    fireEvent(window, new Event('pagehide'));
    expect(screen.getByRole('heading', { name: '失败后的最新定义' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('当前修改仍保留在内存');
    expect(saved).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '本地项目菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '重试保存当前项目' }));
    expect(screen.getByLabelText('本地保存状态').textContent).toBe('已保存');
    expect(savedHeading(saved!)).toEqual({ kind: 'literal', value: '失败后的最新定义' });
  }, 15000);
  it('exports protected raw text without altering it and leaves an unapplied Schema draft out of recovery', async () => {
    const raw = '  {broken  ';
    localStorage.setItem(PROJECT_STORAGE_KEY, raw);
    const objectUrl = vi.fn((_blob: Blob) => 'blob:recovery');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = objectUrl;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '本地项目菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '导出恢复原文' }));
    expect(objectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const blob = objectUrl.mock.calls[0][0] as Blob;
    const exported = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(exported).toBe(raw);
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    first.unmount();
    localStorage.clear();
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, schema: exampleApplication }),
    );
    const next = render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    changeControl(screen.getByLabelText('应用定义 · JSON'), '{"unapplied":true}');
    fireEvent(window, new Event('pagehide'));
    next.unmount();
    render(<App />);
    expect(screen.getByRole('heading', { name: '创建采购申请' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).not.toContain(
      'unapplied',
    );
    // Let the resource revocation use the same mocked browser URL object that created it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }, 15000);
});
