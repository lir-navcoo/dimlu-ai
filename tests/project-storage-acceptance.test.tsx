import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import {
  ProjectStorage,
  PROJECT_STORAGE_KEY,
  type ProjectStorageAdapter,
} from '../packages/editor/project-storage';
import { EditorDocument } from '../packages/editor/document';
import { exampleApplication } from '../src/examples';
import { serverRecordsExample } from '../src/server-records-example';
import { registry } from '../src/materials';
import { changeControl } from './ui-helpers';

const projects: ProjectStorage[] = [];
afterEach(() => {
  cleanup();
  projects.splice(0).forEach((p) => p.stop());
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function memory(raw: string | null = null) {
  let current = raw;
  const adapter: ProjectStorageAdapter = {
    getItem: vi.fn(() => current),
    setItem: vi.fn((_key, value) => {
      current = value;
    }),
  };
  return { adapter, raw: () => current, read: () => JSON.parse(current!) };
}
function project(adapter: ProjectStorageAdapter, options = { debounceMs: 5 }) {
  const p = new ProjectStorage(adapter, registry, exampleApplication, {
    ...options,
    now: () => 'stable-time',
  });
  projects.push(p);
  return p;
}
function title(document: EditorDocument, value: string) {
  document.setProp('purchase', 'purchase-heading', 'title', { kind: 'literal', value });
}
const storedTitle = (m: ReturnType<typeof memory>) =>
  m.read().schema.pages[0].children[0].props.title.value;

describe('independent N5 project persistence acceptance', () => {
  it.each([
    { pageId: 'missing', nodeId: 'people-heading' },
    { pageId: 5, nodeId: 'purchase-heading' },
    ['purchase', 'purchase-heading'],
    null,
  ])('discards malformed selection separately from a valid restored schema: %j', (selection) => {
    const schema = structuredClone(exampleApplication);
    schema.title = '合法恢复应用';
    const m = memory(JSON.stringify({ storageVersion: 1, schema, selection }));
    const p = project(m.adapter);
    expect(m.adapter.getItem).toHaveBeenCalledExactlyOnceWith(PROJECT_STORAGE_KEY);
    expect(p.getSnapshot().protected).toBe(false);
    expect(p.getSnapshot().document.getSnapshot().plan.schema.title).toBe('合法恢复应用');
    expect(p.getSnapshot().document.getSnapshot().selection.pageId).toBe('purchase');
    expect(p.getSnapshot().document.getSnapshot().canUndo).toBe(false);
    p.start();
    p.stop();
    expect(m.adapter.setItem).not.toHaveBeenCalled();
  });

  it('protects dependency-version-invalid raw bytes through edit, Undo, reset confirmation failure, and retry', () => {
    vi.useFakeTimers();
    const schema = structuredClone(exampleApplication);
    schema.dependencies.components['ui.heading'] = '999.0.0';
    const raw = ` \n${JSON.stringify({ storageVersion: 1, schema })}\t `;
    const m = memory(raw),
      p = project(m.adapter);
    p.start();
    title(p.getSnapshot().document, '未授权覆盖');
    p.getSnapshot().document.undo();
    p.getSnapshot().document.select('people', 'people-heading');
    p.retry();
    p.flush();
    vi.runAllTimers();
    p.stop();
    expect(p.getSnapshot()).toMatchObject({ status: 'protected', protected: true, raw });
    expect(m.raw()).toBe(raw);
    expect(m.adapter.setItem).not.toHaveBeenCalled();
    p.start();
    vi.mocked(m.adapter.setItem).mockImplementationOnce(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    p.confirmReplacement();
    expect(p.getSnapshot()).toMatchObject({ status: 'error', protected: false, raw });
    expect(m.raw()).toBe(raw);
    title(p.getSnapshot().document, '重试保存当前最新');
    p.retry();
    expect(storedTitle(m)).toBe('重试保存当前最新');
    expect(p.getSnapshot()).toMatchObject({ status: 'saved', savedAt: 'stable-time', raw: null });
  });

  it('preserves the last successful savedAt and bytes when a later write fails', () => {
    const m = memory(),
      p = project(m.adapter);
    p.start();
    p.flush();
    const firstBytes = m.raw();
    vi.mocked(m.adapter.setItem).mockImplementationOnce(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    title(p.getSnapshot().document, '额度失败后内存');
    p.flush();
    expect(p.getSnapshot()).toMatchObject({ status: 'error', savedAt: 'stable-time' });
    expect(m.raw()).toBe(firstBytes);
    title(p.getSnapshot().document, '手动重试最新');
    p.retry();
    expect(storedTitle(m)).toBe('手动重试最新');
    expect(p.getSnapshot().status).toBe('saved');
  });

  it('cancels every obsolete document timer when reset and repeated start/stop race', () => {
    vi.useFakeTimers();
    const m = memory(),
      p = project(m.adapter);
    p.start();
    p.start();
    const original = p.getSnapshot().document;
    title(original, '待写旧文档');
    const replacement = new EditorDocument(exampleApplication, registry);
    title(replacement, '替换文档');
    p.bindDocument(replacement);
    p.reset();
    const session = p.getSnapshot().session;
    title(original, '过期原实例');
    title(replacement, '过期替换实例');
    vi.runAllTimers();
    expect(m.adapter.setItem).toHaveBeenCalledTimes(1);
    expect(storedTitle(m)).toBe('创建采购申请');
    expect(p.getSnapshot().session).toBe(session);
    p.stop();
    p.stop();
    p.start();
    vi.runAllTimers();
    expect(m.adapter.setItem).toHaveBeenCalledTimes(1);
  });

  it('remounts a StrictMode App from its restored definition with no stale debounce writer', async () => {
    const m = memory(
      JSON.stringify({
        storageVersion: 1,
        schema: exampleApplication,
        selection: { pageId: 'purchase', nodeId: 'purchase-heading' },
      }),
    );
    const first = render(
      <StrictMode>
        <App projectStorage={m.adapter} saveDelayMs={10} />
      </StrictMode>,
    );
    changeControl(screen.getByRole('textbox', { name: '标题' }), '第一轮待保存');
    first.unmount();
    expect(storedTitle(m)).toBe('第一轮待保存');
    const second = render(
      <StrictMode>
        <App projectStorage={m.adapter} saveDelayMs={10} />
      </StrictMode>,
    );
    changeControl(screen.getByRole('textbox', { name: '标题' }), '第二轮最新');
    await waitFor(() => expect(storedTitle(m)).toBe('第二轮最新'));
    expect(screen.getByLabelText('本地保存状态').textContent).toBe('已保存');
    second.unmount();
    render(<App projectStorage={m.adapter} saveDelayMs={10} />);
    expect(screen.getByRole('heading', { name: '第二轮最新' })).toBeTruthy();
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('persists only declarative schema after source queries, save mutation, errors, and runtime business states', async () => {
    const seed = JSON.stringify({
      storageVersion: 1,
      savedAt: 'seed-time',
      schema: serverRecordsExample,
      selection: { pageId: 'records', nodeId: null },
    });
    const m = memory(seed);
    const query = vi.spyOn(registry.transports!['demo.recordsQuery'], 'execute');
    const first = render(<App projectStorage={m.adapter} saveDelayMs={10} />);
    expect(query).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    await screen.findByText('共 23 条记录');
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await screen.findByRole('dialog', { name: '编辑服务端记录' });
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '刷新失败独立恢复');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await screen.findByText('保存已完成，仅列表刷新失败');
    fireEvent(window, new Event('pagehide'));
    expect(m.read().schema).toEqual(serverRecordsExample);
    expect(m.adapter.setItem).not.toHaveBeenCalled();
    expect(Object.keys(m.read()).sort()).toEqual([
      'savedAt',
      'schema',
      'selection',
      'storageVersion',
    ]);
    expect(m.raw()).not.toContain('刷新失败独立恢复');
    const requests = query.mock.calls.length;
    first.unmount();
    render(<App projectStorage={m.adapter} />);
    expect(screen.getByRole('button', { name: '编辑模式' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const placeholder = screen.getByLabelText('编辑服务端记录设计占位');
    expect(
      placeholder.closest('.material-overlay-host')?.getAttribute('data-overlay-presentation'),
    ).toBe('collapsed');
    expect(screen.queryByRole('dialog', { name: '编辑服务端记录' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('共 0 条记录')).toBeTruthy();
    expect(query).toHaveBeenCalledTimes(requests);
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(m.read().schema).toEqual(serverRecordsExample);
    expect(m.adapter.setItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '结构' }));
    fireEvent.click(screen.getByRole('button', { name: '选中 抽屉 edit-drawer' }));
    const designDialog = await screen.findByRole('dialog', { name: '编辑服务端记录' });
    expect(designDialog.classList.contains('design')).toBe(true);
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).disabled).toBe(
      false,
    );
    expect(query).toHaveBeenCalledTimes(requests);
    expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps an invalid data-state draft out of persistence and drops it on remount', async () => {
    const m = memory(JSON.stringify({ storageVersion: 1, schema: serverRecordsExample }));
    const view = render(<App projectStorage={m.adapter} />);
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    changeControl(screen.getByRole('textbox', { name: '状态初始值' }), '{未提交草稿');
    fireEvent(window, new Event('pagehide'));
    expect(m.read().schema).toEqual(serverRecordsExample);
    expect(m.raw()).not.toContain('未提交草稿');
    view.unmount();
    render(<App projectStorage={m.adapter} />);
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    expect(
      (screen.getByRole('textbox', { name: '状态初始值' }) as HTMLTextAreaElement).value,
    ).not.toContain('未提交草稿');
  });
});
