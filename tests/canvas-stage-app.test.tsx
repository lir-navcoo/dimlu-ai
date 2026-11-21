import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema } from '../packages/schema/types';
import { PageRuntime } from '../packages/runtime/engine';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import App from '../src/App';
import { registry } from '../src/materials';
import { ViewportStore, resolveViewport } from '../src/editor/viewport';
import type { useEditorSession } from '../src/editor/session';
import { selectionApplication, lit } from './multiselection-fixture';
import { changeControl, selectPage } from './ui-helpers';

const captured = vi.hoisted(() => ({
  author: undefined as EditorDocument | undefined,
  session: undefined as ReturnType<typeof useEditorSession> | undefined,
}));
// Transparent constructor/provider witnesses retain the actual document/session
// implementation. They add no business root, runtime, command or test API.
vi.mock('../packages/editor/project-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../packages/editor/project-storage')>();
  return {
    ...actual,
    ProjectStorage: class extends actual.ProjectStorage {
      constructor(...args: ConstructorParameters<typeof actual.ProjectStorage>) {
        super(...args);
        captured.author = this.getSnapshot().document;
      }
    },
  };
});
vi.mock('../src/editor/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/editor/session')>();
  function Probe() {
    captured.session = actual.useEditorSession();
    return null;
  }
  return {
    ...actual,
    EditorSessionProvider: ({ children }: { children: ReactNode }) => (
      <actual.EditorSessionProvider>
        <Probe />
        {children}
      </actual.EditorSessionProvider>
    ),
  };
});

const runtimes = new Set<PageRuntime>();
let boxes: WeakMap<Element, DOMRect>;
beforeEach(() => {
  vi.stubEnv('MODE', 'canvas-stage');
  captured.author = undefined;
  captured.session = undefined;
  boxes = new WeakMap();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this) ?? new DOMRect(80, 60, 300, 40);
  });
  const enter = PageRuntime.prototype.enter;
  vi.spyOn(PageRuntime.prototype, 'enter').mockImplementation(function (this: PageRuntime) {
    runtimes.add(this);
    return enter.call(this);
  });
});
afterEach(() => {
  try {
    cleanup();
  } finally {
    runtimes.clear();
    captured.author = undefined;
    captured.session = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});
function schema(): ApplicationSchema {
  const result = selectionApplication();
  result.dependencies.components = Object.fromEntries(
    Object.entries(registry.components).map(([key, value]) => [key, value.version]),
  );
  result.pages[0].children.push(
    {
      id: 'local-input',
      component: 'ui.input',
      props: { label: lit('阶段本地输入'), value: lit('') },
    },
    {
      id: 'local-select',
      component: 'ui.select',
      props: {
        label: lit('阶段本地选择'),
        value: lit(''),
        options: lit([{ label: '阶段选项', value: 'local' }]),
      },
    },
    {
      id: 'local-dialog',
      component: 'ui.dialog',
      props: { title: lit('阶段对话框'), open: lit(false), triggerLabel: lit('阶段打开') },
      children: [
        { id: 'dialog-text', component: 'ui.text', props: { value: lit('阶段弹层正文') } },
      ],
    },
  );
  return result;
}
function mount(definition = schema()) {
  const saved = JSON.stringify({
    storageVersion: 1,
    savedAt: 'stage-independent',
    schema: definition,
    selection: { pageId: 'a', nodeId: 'alpha' },
  });
  const storage = new Map([[PROJECT_STORAGE_KEY, saved]]);
  const adapter = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  };
  return { ...render(<App projectStorage={adapter} saveDelayMs={1} />), storage };
}
function frameIn(container: HTMLElement) {
  const frame = container.querySelector<HTMLIFrameElement>('iframe[aria-label="画布运行文档"]');
  expect(frame).toBeTruthy();
  return frame!;
}
// Real current iframe doc/window/portals. Completion/module/CSSOM are controlled
// because JSDOM cannot fetch Vite runtime assets; not actual browser readiness.
function ready(frame: HTMLIFrameElement) {
  const doc = frame.contentDocument!;
  const win = doc.defaultView!;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  if (!doc.head) doc.documentElement.appendChild(doc.createElement('head'));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
  vi.spyOn(doc, 'readyState', 'get').mockReturnValue('complete');
  doc.documentElement.dataset.dimluRuntimeEntry = 'ready';
  const style = doc.createElement('style');
  style.textContent = ':root { --dimlu-runtime-baseline: ready; }';
  doc.head.append(style);
  const content = doc.createElement('div');
  content.id = 'canvas-content';
  const portals = doc.createElement('div');
  portals.id = 'canvas-portals';
  doc.body.append(content, portals);
  vi.spyOn(win.Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    return boxes.get(this) ?? new DOMRect(20, 30, 220, 40);
  });
  act(() => frame.dispatchEvent(new frame.ownerDocument.defaultView!.Event('load')));
  return {
    doc,
    win,
    content,
    portals,
    query: within(doc.body),
    author: () => within(doc.body).getByLabelText('页面编辑画布'),
  };
}
function key(target: HTMLElement, value: string, init: KeyboardEventInit = {}) {
  const event = new target.ownerDocument.defaultView!.KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}
function currentRuntime() {
  return [...runtimes].filter((runtime) => !runtime.disposed).at(-1)!;
}

describe('actual compiled-mode App canvas integration', () => {
  it('A1 keeps the platform document outside real committed runtime loading gaps and retires it on page lifetime changes', async () => {
    const view = mount();
    const frame = frameIn(view.container);
    const child = ready(frame);
    const firstCanvas = child.author();
    const runtime = currentRuntime();
    const gaps: boolean[] = [];
    const dispose = PageRuntime.prototype.dispose;
    vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
      dispose.call(this);
      if (this === runtime) gaps.push(!firstCanvas.isConnected && frame.isConnected);
    });
    child.doc.documentElement.scrollTop = 321;
    act(() => captured.author!.setProp('a', 'alpha', 'value', lit('阶段提交内容')));
    await waitFor(() =>
      expect(child.query.getByText('阶段提交内容', { selector: 'p' })).toBeTruthy(),
    );
    expect(gaps).toEqual([true]);
    expect(runtime.disposed).toBe(true);
    expect(currentRuntime()).not.toBe(runtime);
    expect(frameIn(view.container)).toBe(frame);
    expect(frame.contentDocument).toBe(child.doc);
    expect(child.doc.documentElement.scrollTop).toBe(321);
    expect(child.author()).not.toBe(firstCanvas);
    expect(child.doc.querySelectorAll('.editor-surface')).toHaveLength(1);
    const beforeReset = currentRuntime();
    fireEvent.click(screen.getByRole('button', { name: '重置页面' }));
    expect(beforeReset.disposed).toBe(true);
    expect(frameIn(view.container)).toBe(frame);
    selectPage('b');
    const nextFrame = frameIn(view.container);
    expect(nextFrame).not.toBe(frame);
    expect(frame.isConnected).toBe(false);
    expect(ready(nextFrame).query.getByText('B one', { selector: 'p' })).toBeTruthy();
  });

  it('A2 measures equal-default height once and preserves current business DOM selection and drafts through presentation changes', async () => {
    const store = new ViewportStore();
    expect(resolveViewport(store.getSnapshot(), 'edit').measured).toBe(false);
    store.measure(960, 600);
    expect(resolveViewport(store.getSnapshot(), 'edit').measured).toBe(true);
    store.setInteracting(true);
    store.measure(800, 400);
    expect(resolveViewport(store.getSnapshot(), 'edit').availableHeight).toBe(600);
    store.setInteracting(false);
    expect(resolveViewport(store.getSnapshot(), 'edit').availableHeight).toBe(400);
    const view = mount();
    const frame = frameIn(view.container);
    const child = ready(frame);
    const leaf = child.query.getByText('Alpha text', { selector: 'p' });
    const runtime = currentRuntime();
    const draft = { source: 'original', dirty: true, value: 'state.' };
    act(() => captured.session!.drafts.write('stage:draft', draft));
    const selection = captured.author!.getSnapshot().selection;
    act(() => captured.session!.viewport.measure(960, 600));
    expect(frame.style.height).toBe('600px');
    changeControl(screen.getByRole('combobox', { name: '画布设备宽度' }), 'phone');
    changeControl(screen.getByRole('combobox', { name: '画布缩放' }), '75');
    expect(frame.style.width).toBe('390px');
    expect(frame.style.height).toBe('600px');
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const input = child.query.getByRole('textbox', { name: '阶段本地输入' }) as HTMLInputElement;
    // Existing unbound Input is deliberately readOnly without onChange.
    // Keep its DOM identity witness and use the existing local-state Select
    // for the business state retention witness, without changing materials.
    expect(input.readOnly).toBe(true);
    const localSelect = child.query.getByRole('combobox', { name: '阶段本地选择' });
    fireEvent.click(localSelect);
    const localOption = await child.query.findByRole('option', { name: '阶段选项' });
    fireEvent.pointerDown(localOption, { pointerType: 'mouse', button: 0 });
    fireEvent.click(localOption);
    expect(localSelect.textContent).toContain('阶段选项');
    act(() => captured.session!.viewport.measure(700, 410));
    expect(frame.style.height).toBe('410px');
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    act(() => captured.session!.viewport.measure(700, 120));
    expect(frame.style.height).toBe('240px');
    expect(frameIn(view.container)).toBe(frame);
    expect(child.query.getByText('Alpha text', { selector: 'p' })).toBe(leaf);
    expect(child.query.getByRole('textbox', { name: '阶段本地输入' })).toBe(input);
    expect(child.query.getByRole('combobox', { name: '阶段本地选择' })).toBe(localSelect);
    expect(localSelect.textContent).toContain('阶段选项');
    expect(currentRuntime()).toBe(runtime);
    expect(captured.author!.getSnapshot().selection).toBe(selection);
    expect(captured.session!.drafts.read('stage:draft', 'original', '')).toBe(draft);
    expect(child.content.querySelector('.canvas-scaled-surface')).toBeNull();
  });

  it('A3 keeps complete author UI in the unscaled parent outlet and business popups and effects in the child', async () => {
    const view = mount();
    const frame = frameIn(view.container);
    const child = ready(frame);
    act(() => captured.author!.selectMany('a', ['alpha', 'tail'], 'alpha'));
    await waitFor(() =>
      expect(
        view.container.querySelector('.canvas-stage-editor-ui > .selection-controls'),
      ).toBeTruthy(),
    );
    const controls = view.container.querySelector<HTMLElement>(
      '.canvas-stage-editor-ui > .selection-controls',
    )!;
    expect(controls.parentElement?.matches('.editor-canvas.canvas-stage-editor-ui')).toBe(true);
    expect(controls.closest('.canvas-scaled-surface')).toBeNull();
    expect(child.doc.querySelector('.selection-controls')).toBeNull();
    expect(child.author().hasAttribute('data-editor-multi')).toBe(true);
    const platformStyle = [...child.author().querySelectorAll('style')]
      .map((style) => style.textContent)
      .join('\n');
    expect(platformStyle).toContain('data-editor-multi');
    expect(platformStyle).toMatch(/cursor\s*:\s*pointer/);
    expect(platformStyle).toContain('focus-visible');
    const before = captured.author!.getSnapshot();
    fireEvent.click(within(controls).getByRole('button', { name: '创建所选组件副本' }));
    expect(captured.author!.getSnapshot().revision).toBe(before.revision + 1);
    act(() => captured.author!.undo());
    expect(captured.author!.getSnapshot().plan).toBe(before.plan);
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const select = child.query.getByRole('combobox', { name: '阶段本地选择' });
    fireEvent.click(select);
    const option = await child.query.findByRole('option', { name: '阶段选项' });
    expect(option.ownerDocument).toBe(child.doc);
    expect(child.portals.contains(option)).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);
    fireEvent.click(child.query.getByRole('button', { name: '阶段打开' }));
    const dialog = await child.query.findByRole('dialog', { name: '阶段对话框' });
    expect(dialog.ownerDocument).toBe(child.doc);
    expect(screen.queryByRole('dialog', { name: '阶段对话框' })).toBeNull();
    fireEvent.click(child.query.getByRole('button', { name: '关闭阶段对话框' }));
    const runtime = currentRuntime();
    act(() =>
      runtime.emitEffect({ type: 'ui.notify', data: { title: '阶段真实通知', timeout: 0 } }),
    );
    await waitFor(() => expect(child.query.getByText('阶段真实通知')).toBeTruthy());
    expect(child.portals.querySelector('.material-toast-viewport')).toBeTruthy();
    expect(screen.queryByText('阶段真实通知')).toBeNull();
    expect(child.content.querySelector('.canvas-overlays')).toBeNull();
  });

  it('A4 retains one effect owner and fails closed after native retirement without resurrecting old children or overlays', async () => {
    const view = mount();
    const frame = frameIn(view.container);
    const child = ready(frame);
    const runtime = currentRuntime();
    const subscribe = vi.spyOn(runtime, 'subscribeEffects');
    act(() => captured.session!.viewport.measure(800, 500));
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    expect(subscribe).not.toHaveBeenCalled();
    expect(currentRuntime()).toBe(runtime);
    const root = child.author();
    act(() => child.win.dispatchEvent(new child.win.Event('pagehide')));
    expect(root.isConnected).toBe(false);
    expect(child.content.childElementCount).toBe(0);
    expect(view.container.querySelector('.canvas-overlays')).toBeNull();
    expect(view.container.querySelector('.selection-controls')).toBeNull();
    act(() => frame.dispatchEvent(new Event('load')));
    fireEvent.keyDown(root, { key: 'Delete' });
    expect(child.content.childElementCount).toBe(0);
    expect(screen.getByRole('alert').textContent).toMatch(/文档|画布/);
    selectPage('b');
    const next = ready(frameIn(view.container));
    expect(next.query.getByText('B one', { selector: 'p' })).toBeTruthy();
    act(() => child.win.dispatchEvent(new child.win.Event('pagehide')));
    expect(next.query.getByText('B one', { selector: 'p' })).toBeTruthy();
    view.unmount();
    expect(next.content.childElementCount).toBe(0);
  });

  it('A5 isolates the actual stage mode from the legacy ordinary canvas and unchanged CodePage ShadowRoot branch', async () => {
    vi.stubEnv('MODE', 'test');
    const legacy = mount();
    expect(legacy.container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
    legacy.unmount();
    for (const mode of ['test', 'canvas-stage']) {
      vi.stubEnv('MODE', mode);
      const definition = schema();
      definition.pages[0].code = {
        enabled: true,
        language: 'jsx',
        source: 'export default function Page(){ return <p>阶段原代码页面</p>; }',
        css: 'p { color: rgb(1, 2, 3); }',
      };
      const code = mount(definition);
      expect(code.container.querySelector('iframe')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
      await waitFor(() =>
        expect(code.container.querySelector('.page-code-host')?.shadowRoot?.textContent).toContain(
          '阶段原代码页面',
        ),
      );
      expect(
        code.container.querySelector('.page-code-host')?.shadowRoot?.querySelector('style')
          ?.textContent,
      ).toContain('rgb(1, 2, 3)');
      code.unmount();
    }
  });
});
