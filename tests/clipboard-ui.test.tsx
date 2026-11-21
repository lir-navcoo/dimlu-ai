import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorToolbar } from '../src/editor/Editor';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import App from '../src/App';
import { clipboardUiApplication, expression } from './clipboard-fixture';
import { changeControl } from './ui-helpers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const copyLabel = '复制组件到剪贴板',
  pasteLabel = '粘贴组件到页面末尾';
async function menuItem(label: string) {
  fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
  return screen.findByRole('menuitem', { name: label });
}
async function activate(label: string) {
  fireEvent.click(await menuItem(label));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}
function setup(document = new EditorDocument(clipboardUiApplication(), registry)) {
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>, runtime!: PageRuntime;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <button
        onClick={() =>
          drag.begin({ kind: 'node', nodeId: document.getSnapshot().selection.nodeId! })
        }
      >
        Start keyboard drag
      </button>
    );
  }
  function Harness({ allowed }: { allowed: boolean }) {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const activeRuntime = useMemo(() => new PageRuntime(snapshot.plan, 'source'), [snapshot.plan]);
    runtime = activeRuntime;
    useEffect(() => () => activeRuntime.dispose(), [activeRuntime]);
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={allowed}>
        <Probe />
        <EditorToolbar document={document} snapshot={snapshot} authoringAllowed={allowed} />
        <input aria-label="Native text" defaultValue="native" />
        <textarea aria-label="Native code draft" defaultValue="const draft = 1;" />
      </DragDropProvider>
    );
  }
  const tree = (allowed = true) => (
    <EditorSessionProvider>
      <TipProvider>
        <Harness allowed={allowed} />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return { document, view, tree, getDrag: () => drag, getRuntime: () => runtime };
}

describe('component session clipboard actual menu authoring', () => {
  it('uses labeled existing file menu,disabled empty paste and visible CSS/session limitation', async () => {
    const { document } = setup();
    const paste = await menuItem(pasteLabel);
    expect(paste.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('group', { name: /^组件剪贴板/ })).toBeTruthy();
    expect(screen.getByText(/不包含页面 CSS、代码或模型/)).toBeTruthy();
    expect(screen.getByText(/当前编辑会话/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copyLabel })).toBeNull();
    expect(screen.queryByRole('button', { name: pasteLabel })).toBeNull();
    expect(screen.getByRole('menu').querySelectorAll('[title]')).toHaveLength(0);
    expect(document.getClipboardSnapshot().available).toBe(false);
  });
  it('copies without document/preview reset then switches page,pastes at end and undoes one full tree', async () => {
    const { document, getRuntime } = setup(),
      before = document.getSnapshot(),
      runtime = getRuntime();
    runtime.setState('caption', 'runtime draft');
    await activate(copyLabel);
    expect(document.getSnapshot()).toBe(before);
    expect(getRuntime()).toBe(runtime);
    expect(runtime.getState().caption).toBe('runtime draft');
    expect(screen.getByRole('status').textContent).toContain('已复制');
    act(() => document.select('target', 'target-existing'));
    const original = document.exportJson();
    const paste = await menuItem(pasteLabel);
    expect(paste.getAttribute('aria-disabled')).not.toBe('true');
    expect(screen.getByText(/源页面.*布局容器.*4 个组件/)).toBeTruthy();
    fireEvent.click(paste);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const children = document.getSnapshot().plan.pages.get('target')!.schema.children;
    expect(children).toHaveLength(2);
    expect(children[0].id).toBe('target-existing');
    expect(children[1].children).toHaveLength(2);
    expect(children[1].children![1].slots!.footer.children).toHaveLength(1);
    expect(document.getSnapshot().selection.nodeId).toBe(children[1].id);
    expect(screen.getByRole('status').textContent).toContain('页面末尾');
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(document.exportJson()).toBe(original);
    expect(document.getSnapshot().canUndo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(document.getSnapshot().plan.pages.get('target')!.schema.children).toHaveLength(2);
  });
  it('rejects a dynamic component visibly without losing the last good copy', async () => {
    const { document } = setup();
    await activate(copyLabel);
    const captured = document.getClipboardSnapshot();
    act(() => {
      document.setProp('source', 'source-text', 'value', expression('"dynamic"'));
      document.select('source', 'source-text');
    });
    const before = document.getSnapshot();
    await activate(copyLabel);
    expect(screen.getByRole('alert').textContent).toMatch(/绑定|静态/);
    expect(document.getClipboardSnapshot()).toBe(captured);
    expect(document.getSnapshot()).toBe(before);
    act(() => document.selectPage('target'));
    await activate(pasteLabel);
    expect(document.getSnapshot().plan.pages.get('target')!.schema.children).toHaveLength(2);
  });
  it.each(['preview', 'enabled-code', 'keyboard-drag'] as const)(
    'disables copy/paste in %s',
    async (condition) => {
      const { document, view, tree, getDrag } = setup();
      act(() => document.copyNodeToClipboard('source', 'source-frame'));
      if (condition === 'preview') view.rerender(tree(false));
      else if (condition === 'enabled-code')
        act(() =>
          document.setPageCode('source', {
            ...document.getSnapshot().plan.pages.get('source')!.schema.code!,
            enabled: true,
          }),
        );
      else act(() => getDrag().begin({ kind: 'node', nodeId: 'source-frame' }));
      const copy = await menuItem(copyLabel);
      expect(copy.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByRole('menuitem', { name: pasteLabel }).getAttribute('aria-disabled')).toBe(
        'true',
      );
    },
  );
  it('disables copy without selected root but keeps page-end paste reachable on an empty page', async () => {
    const { document } = setup();
    act(() => {
      document.copyNodeToClipboard('source', 'source-frame');
      document.select('target', null);
      document.removeNode('target', 'target-existing');
    });
    const copy = await menuItem(copyLabel);
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    const paste = screen.getByRole('menuitem', { name: pasteLabel });
    expect(paste.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(paste);
    await waitFor(() =>
      expect(document.getSnapshot().plan.pages.get('target')!.schema.children).toHaveLength(1),
    );
  });
  it('leaves native text/code copy and paste key events unhandled', () => {
    const { document } = setup();
    const before = document.getSnapshot(),
      clipboard = document.getClipboardSnapshot();
    for (const label of ['Native text', 'Native code draft'])
      for (const key of ['c', 'v'])
        for (const modifier of ['ctrlKey', 'metaKey']) {
          const event = new KeyboardEvent('keydown', {
            key,
            [modifier]: true,
            bubbles: true,
            cancelable: true,
          });
          fireEvent(screen.getByLabelText(label), event);
          expect(event.defaultPrevented).toBe(false);
        }
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toBe(clipboard);
  });
  it('actual App copy does not autosave or persist clipboard;new mount starts empty', async () => {
    const raw = JSON.stringify({
        storageVersion: 1,
        savedAt: 'fixture',
        schema: clipboardUiApplication(),
        selection: { pageId: 'source', nodeId: 'source-frame' },
      }),
      writes = vi.fn(),
      data = new Map([[PROJECT_STORAGE_KEY, raw]]),
      adapter = {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => {
          writes(key, value);
          data.set(key, value);
        },
      };
    const view = render(<App projectStorage={adapter} saveDelayMs={1} />);
    await activate(copyLabel);
    fireEvent(window, new Event('pagehide'));
    expect(writes).not.toHaveBeenCalled();
    expect(data.get(PROJECT_STORAGE_KEY)).toBe(raw);
    const paste = await menuItem(pasteLabel);
    expect(paste.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.keyDown(paste, { key: 'Escape' });
    view.unmount();
    render(<App projectStorage={adapter} saveDelayMs={1} />);
    const emptyPaste = await menuItem(pasteLabel);
    expect(emptyPaste.getAttribute('aria-disabled')).toBe('true');
    expect(writes).not.toHaveBeenCalled();
  });
  it('actual App passes preview permission to existing file-menu clipboard actions', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        storageVersion: 1,
        savedAt: 'fixture',
        schema: clipboardUiApplication(),
        selection: { pageId: 'source', nodeId: 'source-frame' },
      }),
    );
    render(<App />);
    await activate(copyLabel);
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const copy = await menuItem(copyLabel);
    expect(copy.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: pasteLabel }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});
