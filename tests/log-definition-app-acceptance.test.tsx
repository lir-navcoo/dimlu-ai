import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import App from '../src/App';
import { PageRuntime } from '../packages/runtime/engine';
import {
  PROJECT_STORAGE_KEY,
  type ProjectStorageAdapter,
} from '../packages/editor/project-storage';
import type { ApplicationSchema, Json, Value } from '../packages/schema/types';
import { changeControl } from './ui-helpers';

const nativeOpening = vi.hoisted(() => ({ hold: false, delivered: [] as (() => void)[] }));
vi.mock('@base-ui/react/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/dialog')>();
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Root: (props: ComponentProps<typeof actual.Dialog.Root>) => (
        <actual.Dialog.Root
          {...props}
          onOpenChangeComplete={(open) => {
            // Preserve the real Popup and its native completion. Only this one
            // adversarial case delays delivery of an event that actually fired.
            const complete = () => props.onOpenChangeComplete?.(open);
            if (nativeOpening.hold && open && props.onOpenChangeComplete)
              nativeOpening.delivered.push(complete);
            else complete();
          }}
        />
      ),
    },
  };
});

const lit = (value: Json): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const fixture: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'log-definition-app',
  title: 'Local logs',
  entryPageId: 'page',
  dependencies: {
    components: {
      'ui.layout': '1.0.0',
      'ui.card': '1.0.0',
      'ui.text': '1.0.0',
    },
    actions: {},
  },
  pages: [
    {
      id: 'page',
      title: 'Local page',
      state: [{ id: 'invalidDisplay', type: 'string', initial: 'invalid-local-display' }],
      children: [
        { id: 'draft', component: 'ui.text', props: { value: lit('Draft owner') } },
        {
          id: 'root',
          component: 'ui.layout',
          props: {},
          children: [
            {
              id: 'nested',
              component: 'ui.layout',
              props: {},
              children: [
                {
                  id: 'card',
                  component: 'ui.card',
                  props: {},
                  slots: {
                    footer: {
                      params: [],
                      children: [
                        {
                          id: 'failure',
                          component: 'ui.text',
                          props: { value: expr('scope.item.label') },
                          style: { display: expr('state.invalidDisplay') },
                          repeat: {
                            items: lit([
                              { id: 'a', label: 'Repeated A' },
                              { id: 'b', label: 'Repeated B' },
                            ]),
                            item: 'item',
                            key: expr('scope.item.id'),
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const frames = new Map<number, FrameRequestCallback>();
let frameSequence = 0;
const observedRuntimes: PageRuntime[] = [];
const originalReport = PageRuntime.prototype.report;
function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  fireEvent(window, new Event('resize'));
}
beforeEach(() => {
  nativeOpening.hold = false;
  nativeOpening.delivered.length = 0;
  frames.clear();
  frameSequence = 0;
  observedRuntimes.length = 0;
  resize(1280);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameSequence, callback);
    return frameSequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(PageRuntime.prototype, 'report').mockImplementation(function (
    this: PageRuntime,
    ...args
  ) {
    if (!observedRuntimes.includes(this)) observedRuntimes.push(this);
    return originalReport.apply(this, args);
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.closest<HTMLElement>('[data-editor-tree-node]');
    if (row?.dataset.editorTreeNode === 'failure')
      return new DOMRect(
        48,
        1100 - (this.closest<HTMLElement>('.sidebar-content')?.scrollTop ?? 0),
        220,
        28,
      );
    if (this.classList.contains('sidebar-content')) return new DOMRect(44, 100, 240, 300);
    return new DOMRect(44, 100, 240, 300);
  });
});
afterEach(() => {
  cleanup();
  observedRuntimes.forEach((runtime) => runtime.dispose());
  frames.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resize(1280);
});
async function flushFrames() {
  await act(async () => {
    await Promise.resolve();
  });
  for (let round = 0; round < 3; round++) {
    act(() => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(round));
    });
    await act(async () => {
      await Promise.resolve();
    });
  }
}
function mount(width = 1280, selection = 'draft') {
  resize(width);
  let saved = JSON.stringify({
    storageVersion: 1,
    savedAt: 'fixture',
    schema: fixture,
    selection: { pageId: 'page', nodeId: selection },
  });
  const storage: ProjectStorageAdapter = {
    getItem: (key) => (key === PROJECT_STORAGE_KEY ? saved : null),
    setItem: vi.fn((key, value) => {
      if (key === PROJECT_STORAGE_KEY) saved = value;
    }),
  };
  const view = render(<App projectStorage={storage} saveDelayMs={1} />);
  const runtime = () => observedRuntimes.at(-1)!;
  const savedProject = () => {
    fireEvent(window, new Event('pagehide'));
    return JSON.parse(saved) as {
      schema: ApplicationSchema;
      selection: { pageId: string; nodeId: string };
    };
  };
  return { view, runtime, savedProject, storage };
}
function openLogs() {
  fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
}
function recordRows() {
  return [...document.querySelectorAll<HTMLElement>('.logs article')].filter(
    (row) => row.textContent?.includes('style.error') && row.textContent.includes('node · failure'),
  );
}
function locator() {
  return within(recordRows()[0]).getByRole('button');
}
function target() {
  return screen.getByRole('button', { name: '选中 文本 failure' });
}
function unobstructed(element: HTMLElement) {
  expect(element.isConnected).toBe(true);
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    expect(node.hidden).toBe(false);
    expect(node.hasAttribute('inert')).toBe(false);
    expect(getComputedStyle(node).display).not.toBe('none');
    expect(getComputedStyle(node).visibility).not.toBe('hidden');
  }
}
function configureScroll() {
  for (const panel of document.querySelectorAll<HTMLElement>('.sidebar-content')) {
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, value: 1800 });
    Object.defineProperty(panel, 'clientHeight', { configurable: true, value: 300 });
  }
}

describe('043 independent real App log to visible definition integration', () => {
  it('creates actual repeated style errors, preserves their runtime identity through preview/edit, then reveals a filtered slot definition', async () => {
    const app = mount();
    const runtime = app.runtime();
    expect(
      runtime
        .getRecords()
        .filter((record) => record.kind === 'style.error' && record.nodeId === 'failure'),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    openLogs();
    expect(locator().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    expect(app.runtime()).toBe(runtime);
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    changeControl(screen.getByRole('textbox', { name: '搜索组件树' }), 'nothing-matches');
    openLogs();
    configureScroll();
    const records = runtime.getRecords();
    const state = runtime.getState();
    const schema = runtime.plan.schema;
    const button = locator();
    expect(button.getAttribute('aria-label')).toContain('failure');
    expect(button.getAttribute('title')).toBeNull();
    fireEvent.click(button);
    await flushFrames();
    expect(document.activeElement).toBe(target());
    unobstructed(target());
    expect((screen.getByRole('textbox', { name: '搜索组件树' }) as HTMLInputElement).value).toBe(
      '',
    );
    expect(target().getAttribute('aria-pressed')).toBe('true');
    expect(target().closest<HTMLElement>('.sidebar-content')!.scrollTop).toBeGreaterThan(500);
    expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
    expect(runtime.getRecords()).toBe(records);
    expect(runtime.getState()).toBe(state);
    expect(runtime.plan.schema).toBe(schema);
    expect(app.runtime()).toBe(runtime);
    expect(app.savedProject().selection).toEqual({ pageId: 'page', nodeId: 'failure' });
    expect(app.savedProject().schema).toEqual(fixture);
  });

  it.each([390, 760])(
    'closes debug before actual visible tree focus at %ipx, without focusing an inert retained row',
    async (width) => {
      mount(width);
      openLogs();
      configureScroll();
      const focus = HTMLElement.prototype.focus;
      const attempts: boolean[] = [];
      vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (
        this: HTMLElement,
        options?: FocusOptions,
      ) {
        if (
          this.classList.contains('tree-select') &&
          this.closest<HTMLElement>('[data-editor-tree-node]')?.dataset.editorTreeNode === 'failure'
        ) {
          const dockOpen = document.querySelector('#debug-dock')?.classList.contains('open');
          attempts.push(!dockOpen && !this.closest('[hidden],[inert]'));
        }
        return focus.call(this, options);
      });
      fireEvent.click(locator());
      await flushFrames();
      expect(attempts.length).toBeGreaterThan(0);
      expect(attempts.every(Boolean)).toBe(true);
      expect(document.activeElement).toBe(target());
      unobstructed(target());
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBeTruthy();
      expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: '关闭页面设计' }));
      await flushFrames();
      fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
      await flushFrames();
      expect(
        screen.getByRole('dialog', { name: '页面设计' }).contains(document.activeElement),
      ).toBe(true);
    },
  );

  it('unmaximizes obstruction by closing the matching dock and expands a collapsed desktop left host before focus', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: '收起左侧面板' }));
    openLogs();
    fireEvent.click(screen.getByRole('button', { name: '最大化调试区' }));
    configureScroll();
    expect(document.querySelector('#debug-dock')?.classList.contains('maximized')).toBe(true);
    fireEvent.click(locator());
    await flushFrames();
    expect(document.activeElement).toBe(target());
    unobstructed(target());
    expect(document.querySelector('#left-panel')?.hasAttribute('hidden')).toBe(false);
  });

  it('keeps an old native completion bound to its retired owner while a new visible-open locator completes its own tree request', async () => {
    mount(760);
    openLogs();
    await flushFrames();
    configureScroll();
    nativeOpening.hold = true;
    fireEvent.click(locator());
    await flushFrames();
    expect(nativeOpening.delivered).toHaveLength(1);
    expect(document.querySelector('#left-panel')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).not.toBe(target());

    openLogs();
    await flushFrames();
    expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(true);
    fireEvent.click(locator());
    // At 760px reopening debug keeps the existing left Popup visible. The
    // second owner uses its own visible-host commit, never the old event.
    expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
    expect(document.activeElement).not.toBe(target());
    act(() => nativeOpening.delivered.splice(0).forEach((complete) => complete()));
    await flushFrames();
    expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
    expect(document.activeElement).toBe(target());
    unobstructed(target());
  });

  it('keeps dirty property and application Schema text across location and returning to their existing owner', async () => {
    mount();
    changeControl(screen.getByRole('combobox', { name: '文本内容绑定方式' }), 'expression');
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), 'state.');
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    const schemaInput = screen.getByRole('textbox', {
      name: '应用定义 · JSON',
    }) as HTMLTextAreaElement;
    const draft = schemaInput.value + '\n ';
    changeControl(schemaInput, draft);
    openLogs();
    configureScroll();
    fireEvent.click(locator());
    await flushFrames();
    expect(document.activeElement).toBe(target());
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 draft' }));
    expect((screen.getByRole('textbox', { name: '文本内容' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(
      (screen.getByRole('textbox', { name: '应用定义 · JSON' }) as HTMLTextAreaElement).value,
    ).toBe(draft);
  });

  it('keeps dirty style binding and page action code drafts through an already-selected definition locator', async () => {
    const app = mount();
    fireEvent.click(target());
    fireEvent.click(screen.getByRole('tab', { name: '样式' }));
    fireEvent.click(screen.getByRole('button', { name: '宽度绑定设置' }));
    changeControl(screen.getByRole('combobox', { name: '宽度绑定取值方式' }), 'expression');
    await flushFrames();
    changeControl(screen.getByRole('textbox', { name: '宽度绑定' }), 'state.');
    fireEvent.click(screen.getByRole('tab', { name: '代码' }));
    const editor = screen.getByRole('textbox', {
      name: '页面动作源码',
    }) as HTMLTextAreaElement;
    changeControl(editor, 'export function pending() { return 1; }');
    openLogs();
    configureScroll();
    fireEvent.click(locator());
    await flushFrames();
    expect(document.activeElement).toBe(target());
    expect((screen.getByRole('textbox', { name: '宽度绑定' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    fireEvent.click(screen.getByRole('tab', { name: '代码' }));
    const retained = screen.getByRole('textbox', { name: '页面动作源码' }) as HTMLTextAreaElement;
    expect(retained.value).toBe('export function pending() { return 1; }');
    expect(app.savedProject().schema).toEqual(fixture);
  });

  it('keeps no-node lifecycle records readable without making their message an inferred target', () => {
    const app = mount();
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    openLogs();
    expect(
      app
        .runtime()
        .getRecords()
        .some((record) => record.kind === 'lifecycle' && record.nodeId === undefined),
    ).toBe(true);
    const row = [...document.querySelectorAll<HTMLElement>('.logs article')].find((node) =>
      node.textContent?.includes('lifecycle'),
    )!;
    expect(row.textContent).toContain('进入 Local page');
    expect(within(row).queryByRole('button')).toBeNull();
  });
});
