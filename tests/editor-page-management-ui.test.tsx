import { useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PROJECT_STORAGE_KEY, ProjectStorage } from '../packages/editor/project-storage';
import * as applicationMethods from '../packages/runtime/application-methods';
import {
  ApplicationDirectory,
  applicationProjectStorageKey,
} from '../packages/editor/application-directory';
import type { ApplicationSchema, PageSchema } from '../packages/schema/types';
import App from '../src/App';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { PagePanel } from '../src/editor/PagePanel';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { EditorSessionProvider } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { changeControl, closeActionConfig, openActionConfig } from './ui-helpers';

const application = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'page-management-ui',
  title: '页面管理界面验收',
  entryPageId: 'a',
  dependencies: { components: { 'ui.text': '1.0.0' }, actions: {} },
  pages: ['a', 'b'].map((id): PageSchema => ({
    id,
    title: id === 'a' ? '首页' : '次页',
    state: [],
    children: [
      {
        id: `${id}-text`,
        component: 'ui.text',
        props: { value: { kind: 'literal', value: `内容 ${id}` } },
      },
    ],
  })),
});
const pageIds = (document: EditorDocument) =>
  document.getSnapshot().plan.schema.pages.map((page) => page.id);
const nameOf = (document: EditorDocument, id: string) =>
  document.getSnapshot().plan.pages.get(id)!.schema.title;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(schema = application()) {
  const document = new EditorDocument(schema, registry);
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let duringPending: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <button
        onPointerDown={(event) => {
          drag.begin(
            { kind: 'node', nodeId: `${document.getSnapshot().selection.pageId}-text` },
            event,
          );
          duringPending?.();
        }}
        onClick={() =>
          drag.begin({ kind: 'node', nodeId: `${document.getSnapshot().selection.pageId}-text` })
        }
      >
        测试拖拽
      </button>
    );
  }
  function Harness() {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const [allowed, setAllowed] = useState(true);
    const [panel, setPanel] = useState<'pages' | 'lifecycle'>('pages');
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={allowed}>
        <Probe />
        <button onClick={() => setAllowed((current) => !current)}>测试切换模式</button>
        <button
          onClick={() => setPanel((current) => (current === 'pages' ? 'lifecycle' : 'pages'))}
        >
          测试切换面板
        </button>
        {panel === 'pages' ? (
          <PagePanel document={document} snapshot={snapshot} authoringAllowed={allowed} />
        ) : (
          <PageLifecyclePanel document={document} snapshot={snapshot} authoringAllowed={allowed} />
        )}
      </DragDropProvider>
    );
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Harness />
      </TipProvider>
    </EditorSessionProvider>,
  );
  return {
    document,
    view,
    getDrag: () => drag,
    setDuringPending: (callback: () => void) => {
      duringPending = callback;
    },
  };
}
async function menu(document: EditorDocument, id: string, label: string) {
  fireEvent.click(screen.getByRole('button', { name: `页面操作 ${nameOf(document, id)} (${id})` }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label }));
}
const pageRow = (document: EditorDocument, id: string) =>
  screen.getByRole('button', { name: `切换到页面 ${nameOf(document, id)} (${id})` });
function pointerDown(target: HTMLElement) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

describe('page management authoring UI', () => {
  it('reveals matches inside collapsed groups and restores folds when clearing the query', () => {
    const { document } = setup();
    act(() => document.setPageGroup('b', '采购管理'));
    const groupName = /^采购管理\s*1$/;
    const groupButton = () => screen.getByRole('button', { name: groupName });
    fireEvent.click(groupButton());
    const hiddenPage = () => screen.queryByRole('button', { name: '切换到页面 次页 (b)' });
    expect(hiddenPage()).toBeNull();

    const search = screen.getByRole('textbox', { name: '筛选页面' });
    changeControl(search, '次页');
    expect(hiddenPage()).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('1/2');
    expect(screen.queryByRole('button', { name: groupName })).toBeNull();

    changeControl(search, '采购');
    expect(hiddenPage()).toBeTruthy();
    expect(screen.queryByRole('button', { name: '切换到页面 首页 (a)' })).toBeNull();

    changeControl(search, '无结果');
    expect(screen.getByText('没有匹配的页面')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('0/2');
    const clear = screen.getByRole('button', { name: '清除页面搜索' });
    clear.focus();
    fireEvent.click(clear);
    expect(document.getSnapshot().selection.pageId).toBe('a');
    expect(window.document.activeElement).toBe(search);
    expect(groupButton().getAttribute('aria-expanded')).toBe('false');
    expect(hiddenPage()).toBeNull();
  });

  it('creates only on explicit save, renames, duplicates, reorders and sets entry', async () => {
    const { document } = setup();
    const initial = document.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
    const dialog = await screen.findByRole('dialog', { name: '新建页面' });
    changeControl(within(dialog).getByLabelText('页面名称'), '  新建空页  ');
    expect(document.getSnapshot()).toBe(initial);
    fireEvent.click(within(dialog).getByRole('button', { name: '保存页面' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const id = document.getSnapshot().selection.pageId;
    expect(document.getSnapshot().selection.nodeId).toBeNull();
    expect(document.getSnapshot().plan.pages.get(id)!.schema.children).toEqual([]);
    expect(pageRow(document, id).getAttribute('aria-current')).toBe('page');
    await menu(document, id, '重命名');
    changeControl(screen.getByLabelText('页面名称'), '已重命名');
    fireEvent.click(screen.getByRole('button', { name: '保存页面' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(nameOf(document, id)).toBe('已重命名');
    await menu(document, id, '复制页面');
    const copy = document.getSnapshot().selection.pageId;
    expect(nameOf(document, copy)).toBe('已重命名 副本');
    expect(pageIds(document)).toEqual(['a', 'b', id, copy]);
    await menu(document, copy, '上移页面');
    expect(pageIds(document)).toEqual(['a', 'b', copy, id]);
    await menu(document, copy, '下移页面');
    expect(pageIds(document)).toEqual(['a', 'b', id, copy]);
    await menu(document, copy, '设为入口');
    expect(document.getSnapshot().plan.schema.entryPageId).toBe(copy);
    expect(pageRow(document, copy).textContent).toContain('入口');
  });

  it.each(['create', 'duplicate'] as const)(
    '%s updates the route and restores its page after reload',
    async (operation) => {
      localStorage.setItem(
        PROJECT_STORAGE_KEY,
        JSON.stringify({
          storageVersion: 1,
          savedAt: 'fixture',
          schema: application(),
          selection: { pageId: 'a', nodeId: null },
        }),
      );
      window.history.replaceState({}, '', '/editor/pages');
      const view = render(<App saveDelayMs={1} />);

      if (operation === 'create') {
        fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
        const dialog = await screen.findByRole('dialog', { name: '新建页面' });
        changeControl(within(dialog).getByLabelText('页面名称'), '路由回归页');
        fireEvent.click(within(dialog).getByRole('button', { name: '保存页面' }));
      } else {
        fireEvent.click(screen.getByRole('button', { name: '页面操作 首页 (a)' }));
        fireEvent.click(await screen.findByRole('menuitem', { name: '复制页面' }));
      }

      await waitFor(() => expect(window.location.pathname).toBe('/editor/page/page-1'));
      // A created page is blank and parks on the materials panel; a duplicated page keeps content,
      // so its URL carries no explicit panel parameter.
      expect(window.location.search).toBe(operation === 'create' ? '?panel=materials' : '');
      fireEvent(window, new Event('pagehide'));
      expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).selection.pageId).toBe(
        'page-1',
      );

      view.unmount();
      render(<App saveDelayMs={1} />);
      await waitFor(() =>
        expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe(
          'page-1',
        ),
      );
      expect(window.location.pathname).toBe('/editor/page/page-1');
    },
  );

  it('opens the existing page management panel from the page switcher', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/b');
    render(<App saveDelayMs={1} />);

    fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
    fireEvent.click(await screen.findByRole('button', { name: '页面管理' }));

    expect(await screen.findByRole('region', { name: '页面管理' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^页面$/ }).getAttribute('aria-selected')).toBe('true');
    expect(window.location.pathname + window.location.search).toBe('/editor/page/b?panel=pages');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: '搜索页面' })).toBeNull());
  });

  it('opens enter actions for the active page even when the switcher search has no match', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/b');
    render(<App saveDelayMs={1} />);

    fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
    changeControl(await screen.findByRole('combobox', { name: '搜索页面' }), '不存在的页面');
    expect(await screen.findByText('没有匹配的页面')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '页面进入动作' }));

    expect(await screen.findByRole('region', { name: '页面生命周期配置' })).toBeTruthy();
    expect(window.location.pathname + window.location.search).toBe('/editor/page/b?panel=logic');
    await waitFor(() => expect(screen.queryByRole('combobox', { name: '搜索页面' })).toBeNull());
  });

  it('opens application settings as a separate route and saves app title and entry page', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/a');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '当前应用菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '应用设置' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/application'));
    expect(screen.getByRole('heading', { name: '应用设置' })).toBeTruthy();
    changeControl(screen.getByLabelText('应用名称'), '新应用名称');
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    fireEvent.change(screen.getByLabelText('入口页面'), { target: { value: 'b' } });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!);
      expect(saved.schema.title).toBe('新应用名称');
      expect(saved.schema.entryPageId).toBe('b');
    });
  });

  it('opens the root URL as the application home instead of dropping directly into a page editor', async () => {
    window.history.replaceState({}, '', '/');
    render(<App saveDelayMs={1} />);
    expect(await screen.findByRole('heading', { name: '我的应用' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: '新建空白应用' })).toBeTruthy();
  });

  it('renames an application ID and keeps its storage and editor route usable', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/a');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '当前应用菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '应用设置' }));
    changeControl(screen.getByLabelText('应用 ID'), 'renamed-page-app');
    fireEvent.click(screen.getByRole('button', { name: '修改 ID' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/page/a'));
    expect(
      JSON.parse(localStorage.getItem('dimlu.workbench.application.v1:renamed-page-app')!).schema
        .id,
    ).toBe('renamed-page-app');
    expect(JSON.parse(localStorage.getItem('dimlu.workbench.applications.v1')!).activeAppId).toBe(
      'renamed-page-app',
    );
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('a');
  });

  it('creates and persists a custom JavaScript method from application settings', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/a');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '当前应用菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '应用设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '新建方法' }));
    changeControl(screen.getByLabelText('方法名称'), '整理名称');
    changeControl(screen.getByLabelText('方法说明'), '去除首尾空格');
    changeControl(
      screen.getByRole('textbox', { name: '方法 JavaScript 代码' }),
      'return String(input.payload).trim();',
    );
    changeControl(screen.getByRole('textbox', { name: '测试 payload JSON' }), '"  hello  "');
    fireEvent.click(screen.getByRole('button', { name: '测试当前方法' }));
    expect(await screen.findByText('"hello"')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存方法' }));
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!);
      expect(saved.schema.methods).toEqual([
        expect.objectContaining({
          id: 'method-1',
          title: '整理名称',
          description: '去除首尾空格',
          source: 'return String(input.payload).trim();',
        }),
      ]);
    });
  });

  it('ignores a late method test result after the test input changes', async () => {
    let finishFirstRun!: (result: string) => void;
    const firstRun = new Promise<string>((resolve) => {
      finishFirstRun = resolve;
    });
    const execute = vi.spyOn(applicationMethods, 'executeApplicationMethod');
    execute.mockReturnValueOnce(firstRun);
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/a?panel=logic');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '应用自定义方法' }));
    fireEvent.click(await screen.findByRole('button', { name: '新建方法' }));
    const tester = within(await screen.findByRole('dialog', { name: '新建自定义方法' }));
    const run = tester.getByRole('button', { name: '测试当前方法' });
    const payload = tester.getByRole('textbox', { name: '测试 payload JSON' });
    changeControl(payload, '"first"');
    fireEvent.click(run);
    expect(tester.getByRole('status').textContent).toBe('正在试跑…');
    expect(run.matches(':disabled')).toBe(true);
    fireEvent.click(run);
    expect(execute).toHaveBeenCalledTimes(1);

    changeControl(payload, '"second"');
    expect(tester.getByRole('status').textContent).toBe('测试内容已修改，请重新试跑。');
    expect(run.matches(':disabled')).toBe(false);
    fireEvent.click(run);
    expect(await tester.findByText('"second"', { selector: 'pre' })).toBeTruthy();
    await act(async () => finishFirstRun('first'));
    expect(tester.queryByText('"first"', { selector: 'pre' })).toBeNull();
    expect(tester.getByText('"second"', { selector: 'pre' })).toBeTruthy();

    changeControl(tester.getByLabelText('返回值类型'), 'number');
    expect(tester.queryByText('"second"', { selector: 'pre' })).toBeNull();
    expect(tester.getByRole('status').textContent).toBe('测试内容已修改，请重新试跑。');
    fireEvent.click(run);
    expect((await tester.findByRole('alert')).textContent).toContain('返回值不符合声明类型');
  });

  it('opens shared methods from page logic without leaving the current page or panel', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/b?panel=logic');
    render(<App saveDelayMs={1} />);
    const trigger = screen.getByRole('button', { name: '应用自定义方法' });
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(trigger.matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    trigger.focus();
    fireEvent.click(trigger);
    const methods = await screen.findByRole('dialog', { name: '应用自定义方法' });
    expect(within(methods).queryByLabelText('应用名称')).toBeNull();
    expect(window.location.pathname + window.location.search).toBe('/editor/page/b?panel=logic');

    fireEvent.click(within(methods).getByRole('button', { name: '新建方法' }));
    changeControl(await screen.findByLabelText('方法名称'), '检查名称');
    changeControl(
      screen.getByRole('textbox', { name: '方法 JavaScript 代码' }),
      'return String(input.payload).trim();',
    );
    fireEvent.click(screen.getByRole('button', { name: '保存方法' }));
    const close = await within(methods).findByRole('button', { name: '关闭应用自定义方法' });
    fireEvent.click(close);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '应用自定义方法' })).toBeNull(),
    );
    await waitFor(() => expect(window.document.activeElement).toBe(trigger));
    expect(window.location.pathname + window.location.search).toBe('/editor/page/b?panel=logic');
    expect(screen.getByRole('tab', { name: '页面逻辑' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent(window, new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).schema.methods).toEqual([
      expect.objectContaining({
        title: '检查名称',
        source: 'return String(input.payload).trim();',
      }),
    ]);
  });

  it('discards cancelled method drafts and requires confirmation to delete a saved method', async () => {
    const schema = application();
    schema.methods = [{ id: 'trim', title: '整理名称', source: 'return input.payload;' }];
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
    );
    window.history.replaceState({}, '', '/editor/page/a?panel=logic');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '应用自定义方法' }));
    const methods = await screen.findByRole('dialog', { name: '应用自定义方法' });
    const create = within(methods).getByRole('button', { name: '新建方法' });
    fireEvent.click(create);
    const draft = await screen.findByRole('dialog', { name: '新建自定义方法' });
    changeControl(within(draft).getByLabelText('方法名称'), '未保存');
    expect(within(draft).queryByRole('button', { name: '删除方法' })).toBeNull();
    fireEvent.click(within(draft).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(draft.isConnected).toBe(false));
    const list = within(within(methods).getByRole('navigation', { name: '方法列表' }));
    expect(list.getAllByRole('button')).toHaveLength(1);
    fireEvent(window, new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).schema.methods).toEqual(
      schema.methods,
    );

    fireEvent.click(list.getByRole('button', { name: /^整理名称\s*trim$/ }));
    const editor = await screen.findByRole('dialog', { name: '整理名称' });
    const remove = within(editor).getByRole('button', { name: '删除方法' });
    remove.focus();
    fireEvent.click(remove);
    const confirmation = await screen.findByRole('dialog', { name: '删除方法？' });
    const cancel = within(confirmation).getByRole('button', { name: '取消' });
    await waitFor(() => expect(window.document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    await waitFor(() => expect(confirmation.isConnected).toBe(false));
    expect(editor.isConnected).toBe(true);
    await waitFor(() => expect(window.document.activeElement).toBe(remove));
    fireEvent.click(remove);
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(editor.isConnected).toBe(false));
    expect(within(methods).getByText('还没有自定义方法。')).toBeTruthy();
    await waitFor(() => expect(window.document.activeElement).toBe(create));
  });

  it('shows saved calls across pages and blocks deletion of a referenced method', async () => {
    const schema = application();
    schema.methods = [{ id: 'format', title: '格式化', source: 'return input.payload;' }];
    const call = {
      id: 'entry-format',
      action: 'app.method.format',
      input: { payload: { kind: 'literal', value: '示例' } },
    } as const;
    schema.pages[0].onEnter = [call];
    schema.dependencies.components['ui.card'] = '1.0.0';
    schema.dependencies.components['ui.button'] = '1.0.0';
    schema.pages[1].children.push({
      id: 'card',
      component: 'ui.card',
      props: {},
      slots: {
        footer: {
          params: [],
          children: [
            {
              id: 'format-button',
              component: 'ui.button',
              props: { label: { kind: 'literal', value: '格式化' } },
              on: { onClick: [{ ...call, id: 'click-format' }] },
            },
          ],
        },
      },
    });
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
    );
    window.history.replaceState({}, '', '/editor/page/a?panel=logic');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '应用自定义方法' }));
    const methods = within(await screen.findByRole('dialog', { name: '应用自定义方法' }));
    expect(methods.getByText('已保存的调用 · 2 处')).toBeTruthy();
    fireEvent.click(methods.getByRole('button', { name: '编辑方法' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除方法' }));
    const confirmation = within(await screen.findByRole('dialog', { name: '删除方法？' }));
    const references = within(confirmation.getByRole('list', { name: '已保存的调用位置' }));
    expect(references.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      expect.stringMatching(/首页.*\(a\).*页面进入事件.*动作 1/),
      expect.stringMatching(/次页.*\(b\).*format-button\/onClick.*动作 1/),
    ]);
    const confirm = confirmation.getByRole('button', { name: '确认删除' });
    expect(confirm.matches(':disabled')).toBe(true);
    fireEvent.click(confirm);
    fireEvent(window, new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).schema.methods).toEqual(
      schema.methods,
    );
  });

  it.each([1280, 390])(
    'edits and locates method calls while preserving drafts at %ipx',
    async (width) => {
      vi.stubGlobal('innerWidth', width);
      try {
        const schema = application();
        schema.methods = [{ id: 'format', title: '格式化', source: 'return input.payload;' }];
        const call = {
          id: 'entry-format',
          action: 'app.method.format',
          input: { payload: { kind: 'literal', value: '示例' } },
        } as const;
        schema.dependencies.components['ui.card'] = '1.0.0';
        schema.dependencies.components['ui.dialog'] = '1.0.0';
        schema.pages[0].onEnter = [call];
        schema.pages[1].children.push({
          id: 'card',
          component: 'ui.card',
          props: {},
          slots: {
            footer: {
              params: [],
              children: [
                {
                  id: 'format-dialog',
                  component: 'ui.dialog',
                  props: { title: { kind: 'literal', value: '格式化弹窗' } },
                  on: { onConfirm: [{ ...call, id: 'confirm-format' }] },
                },
              ],
            },
          },
        });
        localStorage.setItem(
          PROJECT_STORAGE_KEY,
          JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
        );
        window.history.replaceState({}, '', '/editor/page/a?panel=logic');
        render(<App saveDelayMs={1} />);
        if (width === 390) fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
        await screen.findByRole('region', { name: '页面生命周期配置' });
        // Action parameters live in the config dialog.
        openActionConfig(1);
        changeControl(screen.getByRole('textbox', { name: 'payload' }), '"未保存内容"');
        closeActionConfig();

        const editMethod = async (title: string, nextTitle?: string) => {
          // The 编辑 JS affordance lives inside the config dialog.
          openActionConfig(1);
          const trigger = screen.getByRole('button', { name: '编辑 JS' });
          trigger.focus();
          fireEvent.click(trigger);
          const modal = await screen.findByRole('dialog', { name: title });
          expect(screen.queryByRole('dialog', { name: '应用自定义方法' })).toBeNull();
          const form = within(modal);
          expect((form.getByLabelText('方法名称') as HTMLInputElement).value).toBe(title);
          if (nextTitle) {
            changeControl(form.getByLabelText('方法名称'), nextTitle);
            fireEvent.click(form.getByRole('button', { name: '保存方法' }));
          } else {
            fireEvent.click(form.getByRole('button', { name: '取消' }));
          }
          await waitFor(() => expect(window.document.activeElement).toBe(trigger));
        };
        await editMethod('格式化');
        expect(window.location.pathname + window.location.search).toBe(
          '/editor/page/a?panel=logic',
        );

        const followReference = async (trigger: HTMLElement, name: RegExp) => {
          fireEvent.click(trigger);
          const dialog = await screen.findByRole('dialog', { name: '应用自定义方法' });
          const methods = within(dialog);
          fireEvent.click(methods.getByText('已保存的调用 · 2 处'));
          fireEvent.click(methods.getByRole('button', { name }));
          await waitFor(() => expect(dialog.isConnected).toBe(false));
        };
        closeActionConfig();
        await followReference(
          screen.getByRole('button', { name: '应用自定义方法' }),
          /format-dialog\/onConfirm/,
        );
        // Reference location now surfaces the matching action config dialog; the
        // rest of the panel is aria-hidden while it is open.
        expect(window.location.pathname + window.location.search).toBe('/editor/page/b');
        await waitFor(() =>
          expect(screen.queryByRole('dialog', { name: /动作配置 · 1/ })).toBeTruthy(),
        );
        closeActionConfig();
        const events = within(await screen.findByRole('region', { name: '事件配置' }));
        expect(events.getByRole('combobox', { name: '组件事件' }).getAttribute('data-value')).toBe(
          'onConfirm',
        );

        await editMethod('格式化', '格式化输入');
        expect(events.getByText('1. 格式化输入')).toBeTruthy();
        expect(window.location.pathname + window.location.search).toBe('/editor/page/b');

        closeActionConfig();
        await followReference(
          screen.getByRole('button', { name: '应用自定义方法' }),
          /页面进入事件/,
        );
        expect(window.location.pathname + window.location.search).toBe(
          '/editor/page/a?panel=logic',
        );
        await waitFor(() =>
          expect(screen.queryByRole('dialog', { name: /动作配置 · 1/ })).toBeTruthy(),
        );
        expect((screen.getByRole('textbox', { name: 'payload' }) as HTMLInputElement).value).toBe(
          '"未保存内容"',
        );
        closeActionConfig();
        await screen.findByRole('region', { name: '页面生命周期配置' });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('filters shared methods and returns focus to search when a renamed result disappears', async () => {
    const schema = application();
    schema.methods = [
      {
        id: 'normalize-name',
        title: '整理名称',
        description: '清理空格',
        source: 'return input.payload;',
      },
      { id: 'check-order', title: '检查订单', source: 'return input.payload;' },
    ];
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
    );
    window.history.replaceState({}, '', '/editor/page/a?panel=logic');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '应用自定义方法' }));
    const methods = within(await screen.findByRole('dialog', { name: '应用自定义方法' }));
    const list = within(methods.getByRole('navigation', { name: '方法列表' }));
    const search = methods.getByRole('textbox', { name: '搜索自定义方法' });
    changeControl(search, '  CHECK-ORDER  ');
    expect(list.getAllByRole('button')).toHaveLength(1);
    expect(list.getByRole('button', { name: /检查订单/ })).toBeTruthy();
    expect(methods.queryByText('清理空格')).toBeNull();
    changeControl(search, '空格');
    expect(list.getByRole('button', { name: /整理名称/ })).toBeTruthy();
    changeControl(search, '整理名称');
    const result = list.getByRole('button', { name: /整理名称/ });
    result.focus();
    fireEvent.click(result);
    changeControl(await screen.findByLabelText('方法名称'), '处理姓名');
    fireEvent.click(screen.getByRole('button', { name: '保存方法' }));
    await waitFor(() => expect(window.document.activeElement).toBe(search));
    expect(list.getByText('没有匹配的方法。')).toBeTruthy();
    expect(methods.getByRole('status').textContent).toContain('0/2');
    fireEvent.click(methods.getByRole('button', { name: '清除方法搜索' }));
    expect(window.document.activeElement).toBe(search);
    expect(list.getAllByRole('button')).toHaveLength(2);
    expect(list.getByRole('button', { name: /处理姓名/ })).toBeTruthy();
  });

  // TODO(action-dialog): these cases assert panel-inline parameter editing and
  // focus-restoration semantics that moved into the action config dialog;
  // they need a dedicated adaptation pass.
  it('opens shared methods from a component event and preserves its unsaved action draft', async () => {
    const schema = application();
    schema.dependencies.components['ui.button'] = '1.0.0';
    schema.pages[0].children = [
      {
        id: 'event-button',
        component: 'ui.button',
        props: { label: { kind: 'literal', value: '事件按钮' } },
      },
    ];
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
    );
    window.history.replaceState({}, '', '/editor/page/a');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('tab', { name: '事件' }));
    const events = within(screen.getByRole('region', { name: '事件配置' }));
    fireEvent.click(events.getByRole('button', { name: '添加动作' }));
    openActionConfig(1);
    changeControl(screen.getByRole('combobox', { name: '动作 1 类型' }), 'ui.notify');
    changeControl(screen.getByLabelText('title取值方式'), 'literal');
    changeControl(screen.getByRole('textbox', { name: 'title' }), '未保存通知');
    closeActionConfig();

    const trigger = events.getByRole('button', { name: '应用自定义方法' });
    trigger.focus();
    fireEvent.click(trigger);
    const methods = await screen.findByRole('dialog', { name: '应用自定义方法' });
    fireEvent.click(within(methods).getByRole('button', { name: '新建方法' }));
    changeControl(await screen.findByLabelText('方法名称'), '格式化输入');
    fireEvent.click(screen.getByRole('button', { name: '保存方法' }));
    fireEvent.click(await within(methods).findByRole('button', { name: '关闭应用自定义方法' }));
    await waitFor(() => expect(window.document.activeElement).toBe(trigger));
    expect(window.location.pathname + window.location.search).toBe('/editor/page/a');
    expect(screen.getByRole('tab', { name: '事件' }).getAttribute('aria-selected')).toBe('true');
    openActionConfig(1);
    expect((screen.getByRole('textbox', { name: 'title' }) as HTMLInputElement).value).toBe(
      '未保存通知',
    );
    closeActionConfig();

    fireEvent.click(events.getByRole('button', { name: '添加动作' }));
    openActionConfig(2);
    changeControl(screen.getByRole('combobox', { name: '动作 2 类型' }), 'app.method.method-1');
    expect(screen.getByRole('combobox', { name: '动作 2 类型' }).getAttribute('data-value')).toBe(
      'app.method.method-1',
    );
    closeActionConfig();
    const createAndBind = events.getByRole('button', { name: '新建并绑定 JS' });
    createAndBind.focus();
    fireEvent.click(createAndBind);
    const cancelled = within(await screen.findByRole('dialog', { name: '新建自定义方法' }));
    changeControl(cancelled.getByLabelText('方法名称'), '不保存');
    fireEvent.click(cancelled.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(window.document.activeElement).toBe(createAndBind));
    expect(events.queryByRole('region', { name: '动作 3' })).toBeNull();

    fireEvent.click(createAndBind);
    const direct = within(await screen.findByRole('dialog', { name: '新建自定义方法' }));
    changeControl(direct.getByLabelText('方法名称'), '计算合计');
    fireEvent.click(direct.getByRole('button', { name: '保存方法' }));
    await waitFor(() => expect(window.document.activeElement).toBe(createAndBind));
    openActionConfig(3);
    expect(screen.getByRole('combobox', { name: '动作 3 类型' }).getAttribute('data-value')).toBe(
      'app.method.method-2',
    );
    closeActionConfig();
    // The unsaved draft lives on the first action (ui.notify title).
    openActionConfig(1);
    expect((screen.getByRole('textbox', { name: 'title' }) as HTMLInputElement).value).toBe(
      '未保存通知',
    );
    closeActionConfig();
    await waitFor(() => {
      const saved: ApplicationSchema = JSON.parse(
        localStorage.getItem(PROJECT_STORAGE_KEY)!,
      ).schema;
      expect(saved.methods?.map((method) => method.title)).toEqual(['格式化输入', '计算合计']);
      expect(saved.pages[0].children[0].on?.onClick ?? []).toEqual([]);
    });
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(events.queryByRole('button', { name: '应用自定义方法' })).toBeNull();
    expect(events.queryByRole('button', { name: '新建并绑定 JS' })).toBeNull();
  });

  it('opens a saved application directly at its entry page and routes between pages', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/apps/page-management-ui');
    render(<App saveDelayMs={1} />);
    expect(await screen.findByText('页面管理界面验收')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '切换应用页面' }), {
      target: { value: 'b' },
    });
    await waitFor(() => expect(window.location.pathname).toBe('/apps/page-management-ui/pages/b'));
    expect(
      (screen.getByRole('combobox', { name: '切换应用页面' }) as HTMLSelectElement).value,
    ).toBe('b');
  });

  it('executes app.navigate while previewing and updates the editor page route', async () => {
    const schema = application();
    schema.dependencies.components['ui.button'] = registry.components['ui.button'].version;
    schema.pages[0].children.push({
      id: 'navigate-to-b',
      component: 'ui.button',
      props: {
        label: { kind: 'literal', value: '转到次页' },
        type: { kind: 'literal', value: 'button' },
      },
      on: {
        onClick: [
          {
            id: 'navigate-call',
            action: 'app.navigate',
            input: { pageId: { kind: 'literal', value: 'b' } },
          },
        ],
      },
    });
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
    );
    window.history.replaceState({}, '', '/editor/page/a');
    render(<App saveDelayMs={1} />);
    fireEvent.click(await screen.findByRole('button', { name: '预览模式' }));
    fireEvent.click(await screen.findByRole('button', { name: '转到次页' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/page/b'));
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('b');
  });

  it('runs a non-active application directly from its application URL', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    const directory = new ApplicationDirectory(localStorage, registry, application());
    const other = structuredClone(application());
    other.id = 'other-runtime-app';
    other.title = '另一个运行应用';
    other.pages[0].title = '另一个首页';
    directory.addApplication(other);
    const otherProject = new ProjectStorage(localStorage, registry, other, {
      storageKey: applicationProjectStorageKey(other.id),
      debounceMs: 1,
    });
    otherProject.start();
    other.id = 'imported-runtime-id';
    other.title = '导入 ID 后的另一个应用';
    otherProject.getSnapshot().document.importJson(JSON.stringify(other));
    otherProject.flush();
    otherProject.stop();
    directory.setActive(application().id);
    window.history.replaceState({}, '', '/apps/imported-runtime-id/pages/b');
    render(<App saveDelayMs={1} />);
    expect(await screen.findByText('导入 ID 后的另一个应用')).toBeTruthy();
    expect(screen.getByRole('option', { name: '另一个首页' })).toBeTruthy();
    expect(window.location.pathname).toBe('/apps/imported-runtime-id/pages/b');
    fireEvent.click(screen.getByRole('button', { name: '编辑应用' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/page/b'));
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('b');
    expect(JSON.parse(localStorage.getItem('dimlu.workbench.applications.v1')!).activeAppId).toBe(
      'other-runtime-app',
    );
  });

  it('creates an isolated blank application and switches back to the migrated project', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/apps');
    render(<App saveDelayMs={1} />);
    expect(await screen.findByRole('heading', { name: '我的应用' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建空白应用' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/page/home'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: '切换页面' })).toBeTruthy());
    const directory = JSON.parse(localStorage.getItem('dimlu.workbench.applications.v1')!);
    expect(directory.appIds).toEqual(['page-management-ui', 'application-1']);
    expect(
      JSON.parse(localStorage.getItem('dimlu.workbench.application.v1:application-1')!).schema,
    ).toMatchObject({
      id: 'application-1',
      title: '新建应用',
      entryPageId: 'home',
      pages: [{ id: 'home', title: '首页', children: [] }],
    });

    fireEvent.click(screen.getByRole('button', { name: '当前应用菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '切换应用' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/apps'));
    fireEvent.click(await screen.findByRole('button', { name: '打开应用' }));
    await waitFor(() => expect(window.location.pathname).toBe('/editor/page/a'));
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('a');
  });

  it('duplicates an application and confirms directory removal without deleting saved bytes', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    window.history.replaceState({}, '', '/editor/page/a');
    render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '当前应用菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '切换应用' }));
    const original = (await screen.findByText('页面管理界面验收')).closest('article')!;
    fireEvent.click(within(original).getByRole('button', { name: '复制' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe(
        'a',
      ),
    );
    const duplicateKey = 'page-management-ui-copy-1';
    const duplicateStorageKey = 'dimlu.workbench.application.v1:page-management-ui-copy-1';
    expect(JSON.parse(localStorage.getItem(duplicateStorageKey)!).schema.title).toBe(
      '页面管理界面验收 副本',
    );

    fireEvent.click(screen.getByRole('button', { name: '当前应用菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '切换应用' }));
    const duplicate = (await screen.findByText('页面管理界面验收 副本')).closest('article')!;
    fireEvent.click(within(duplicate).getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('dialog', { name: '删除应用？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByText('页面管理界面验收 副本')).toBeNull());
    expect(localStorage.getItem(duplicateStorageKey)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('dimlu.workbench.applications.v1')!).appIds).toEqual([
      'page-management-ui',
    ]);
    expect(duplicateKey).toBe('page-management-ui-copy-1');
  });

  it('requires explicit replacement for entry deletion, starts focus on Cancel and restores stable focus', async () => {
    const { document } = setup();
    const initial = document.getSnapshot();
    await menu(document, 'a', '删除页面');
    const dialog = await screen.findByRole('dialog', { name: '删除页面？' });
    const cancel = within(dialog).getByRole('button', { name: '取消' });
    await waitFor(() => expect(window.document.activeElement).toBe(cancel));
    expect(within(dialog).getByText(/首页.*a/)).toBeTruthy();
    expect(
      (within(dialog).getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.getSnapshot()).toBe(initial);
    await menu(document, 'a', '删除页面');
    changeControl(screen.getByLabelText('新入口页面'), 'b');
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pageIds(document)).toEqual(['b']);
    expect(document.getSnapshot().plan.schema.entryPageId).toBe('b');
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'b-text' });
    await waitFor(() =>
      expect(window.document.activeElement).toBe(screen.getByRole('button', { name: '新建页面' })),
    );
    await menu(document, 'b', '重命名');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(nameOf(document, 'b')).toBe('次页');
    fireEvent.click(screen.getByRole('button', { name: '页面操作 次页 (b)' }));
    const deleteItem = await screen.findByRole('menuitem', { name: '删除页面' });
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps invalid title local and discards title draft on cancel/reopen', async () => {
    const { document } = setup();
    const initial = document.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
    await screen.findByRole('dialog');
    changeControl(screen.getByLabelText('页面名称'), '  ');
    fireEvent.click(screen.getByRole('button', { name: '保存页面' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.getSnapshot()).toBe(initial);
    changeControl(screen.getByLabelText('页面名称'), '不持久草稿');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
    expect(((await screen.findByLabelText('页面名称')) as HTMLInputElement).value).toBe('');
  });

  it('invalidates an open dialog after any plan update and never applies it after reverting permission', async () => {
    const { document } = setup();
    await menu(document, 'a', '重命名');
    changeControl(screen.getByLabelText('页面名称'), '旧对话框名称');
    act(() => document.renamePage('b', '其他定义变更'));
    expect(screen.getByRole('alert').textContent).toContain('页面或编辑环境已变化');
    const before = document.getSnapshot();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(document.getSnapshot()).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await menu(document, 'a', '重命名');
    changeControl(screen.getByLabelText('页面名称'), '权限变化草稿');
    fireEvent.click(screen.getByText('测试切换模式'));
    fireEvent.click(screen.getByText('测试切换模式'));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(nameOf(document, 'a')).toBe('首页');
    expect(screen.getByRole('alert').textContent).toContain('页面或编辑环境已变化');
  });

  it('permits preview switching while disabling all author controls', () => {
    const { document } = setup();
    fireEvent.click(screen.getByRole('button', { name: '测试切换模式' }));
    expect((screen.getByRole('button', { name: '新建页面' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: '页面操作 首页 (a)' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(pageRow(document, 'b'));
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'b-text' });
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('reads pending drag synchronously before rerender and blocks page switching in that same event', () => {
    const { document, getDrag, setDuringPending } = setup();
    const retainedApi = getDrag();
    const switchPage = pageRow(document, 'b');
    const before = document.getSnapshot();
    setDuringPending(() => {
      expect(retainedApi.isInteracting).toBe(true);
      expect(retainedApi.session).toBeNull();
      fireEvent.click(switchPage);
    });
    pointerDown(screen.getByRole('button', { name: '测试拖拽' }));
    expect(document.getSnapshot()).toBe(before);
    act(() => getDrag().cancel());
    expect(retainedApi.isInteracting).toBe(false);
    fireEvent.click(pageRow(document, 'b'));
    expect(document.getSnapshot().selection.pageId).toBe('b');
  });

  it('invalidates a previously open dialog once active drag starts', async () => {
    const { document, getDrag } = setup();
    await menu(document, 'a', '重命名');
    changeControl(screen.getByLabelText('页面名称'), '拖动前草稿');
    act(() => getDrag().begin({ kind: 'node', nodeId: 'a-text' }));
    expect(getDrag().isInteracting).toBe(true);
    const before = document.getSnapshot();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(document.getSnapshot()).toBe(before);
    act(() => getDrag().cancel());
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(document.getSnapshot()).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain('页面或编辑环境已变化');
  });

  it('keeps deleted-page lifecycle drafts available to Undo without giving them to a new page', async () => {
    const { document } = setup();
    fireEvent.click(screen.getByRole('button', { name: '测试切换面板' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: '页面进入动作' })).getByRole('button', {
        name: '添加动作',
      }),
    );
    openActionConfig(1);
    changeControl(screen.getByLabelText('动作 1 类型'), 'ui.notify');
    changeControl(screen.getByLabelText('title取值方式'), 'literal');
    changeControl(screen.getByRole('textbox', { name: 'title' }), '首页的未保存草稿');
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '测试切换面板' }));
    act(() => document.removePage('a', 'b'));
    act(() => document.createPage('新身份'));
    fireEvent.click(screen.getByRole('button', { name: '测试切换面板' }));
    expect(screen.queryByRole('dialog', { name: /动作配置/ })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'title' })).toBeNull();
    act(() => {
      document.undo();
      document.undo();
    });
    expect(document.getSnapshot().selection.pageId).toBe('a');
    openActionConfig(1);
    expect((screen.getByRole('textbox', { name: 'title' }) as HTMLInputElement).value).toBe(
      '首页的未保存草稿',
    );
    closeActionConfig();
  });
});

describe('page management App persistence', () => {
  it('preserves exact accessible names for unique page titles in quick navigation', () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema: application() }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
    expect(screen.getByRole('option', { name: '首页' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '次页' })).toBeTruthy();
  });

  it('disambiguates duplicate page titles by their stable IDs in quick navigation', () => {
    const schema = application();
    schema.pages[1].title = schema.pages[0].title;
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(screen.getByRole('option', { name: /首页.*a/ }).dataset.value).toBe('a');
    expect(screen.getByRole('option', { name: /首页.*b/ }).dataset.value).toBe('b');
  });

  it('restores authored order, entry and valid selection after storage reload and keeps top page switcher', async () => {
    const schema = application();
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        storageVersion: 1,
        savedAt: 'fixture',
        schema,
        selection: { pageId: 'a', nodeId: 'a-text' },
      }),
    );
    const view = render(<App saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('tab', { name: '页面' }));
    fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
    await screen.findByRole('dialog', { name: '新建页面' });
    changeControl(screen.getByLabelText('页面名称'), '持久新页');
    fireEvent.click(screen.getByRole('button', { name: '保存页面' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '页面操作 持久新页 (page-1)' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '上移页面' }));
    fireEvent.click(screen.getByRole('button', { name: '页面操作 持久新页 (page-1)' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '设为入口' }));
    fireEvent(window, new Event('pagehide'));
    const saved = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!);
    expect(saved.schema.pages.map((page: PageSchema) => page.id)).toEqual(['a', 'page-1', 'b']);
    expect(saved.schema.entryPageId).toBe('page-1');
    expect(saved.selection).toEqual({ pageId: 'page-1', nodeId: null });
    view.unmount();
    window.history.replaceState({}, '', '/editor');
    render(<App saveDelayMs={1} />);
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe(
      'page-1',
    );
    fireEvent.click(screen.getByRole('tab', { name: '页面' }));
    expect(
      screen
        .getByRole('button', { name: '切换到页面 持久新页 (page-1)' })
        .getAttribute('aria-current'),
    ).toBe('page');
    fireEvent.click(screen.getByRole('combobox', { name: '切换页面' }));
    const target = screen.getAllByRole('option').find((option) => option.dataset.value === 'a')!;
    fireEvent.pointerDown(target, { pointerType: 'mouse', button: 0 });
    fireEvent.click(target);
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('a');
  });
});
