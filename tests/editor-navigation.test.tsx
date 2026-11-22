import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { EditorCanvas, type CanvasMode } from '../src/editor/Canvas';
import { ComponentTree } from '../src/editor/ComponentTree';
import { CanvasBreadcrumb } from '../src/editor/CanvasBreadcrumb';
import { clippingBounds } from '../src/editor/CanvasHost';
import { DragDropProvider } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { EditorNavigation } from '../src/editor/navigation';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl } from './ui-helpers';
import { designPanels } from '../src/editor/panels';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const text = (id: string, value: string): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value: literal(value) },
});
const fixture: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'editor-navigation',
  title: '导航回归',
  entryPageId: 'page',
  dependencies: {
    components: {
      'ui.layout': '1.0.0',
      'ui.text': '1.0.0',
      'ui.select': '1.0.0',
      'ui.card': '1.0.0',
    },
    actions: {},
  },
  pages: [
    {
      id: 'page',
      title: '页面一',
      state: [],
      children: [
        {
          id: 'root',
          component: 'ui.layout',
          props: {},
          children: [
            text('leaf', '离屏叶节点'),
            {
              id: 'draft',
              component: 'ui.select',
              props: {
                label: literal('本地草稿'),
                value: literal(''),
                options: literal([{ label: '保留的本地值', value: 'local-value' }]),
              },
            },
            { ...text('inactive', '不可见业务内容'), when: literal(false) },
            {
              id: 'repeated',
              component: 'ui.text',
              props: {
                value: { kind: 'expression', language: 'javascript', source: 'scope.item.label' },
              },
              repeat: {
                items: literal([
                  { id: 'one', label: '实例一' },
                  { id: 'two', label: '实例二' },
                ]),
                item: 'item',
                key: { kind: 'expression', language: 'javascript', source: 'scope.item.id' },
              },
            },
            {
              id: 'card',
              component: 'ui.card',
              props: {},
              slots: {
                footer: { params: [], children: [text('slot-leaf', '插槽叶节点')] },
              },
            },
          ],
        },
      ],
    },
    {
      id: 'other-page',
      title: '页面二',
      state: [],
      children: [text('leaf', '第二页同名节点')],
    },
  ],
};

const frames = new Map<number, FrameRequestCallback>();
const runtimes: PageRuntime[] = [];
let frameId = 0;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

beforeEach(() => {
  frames.clear();
  frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('canvas-scroll')) return new DOMRect(400, 100, 600, 400);
    if (this.classList.contains('sidebar-content')) return new DOMRect(0, 100, 240, 400);
    const canvasOffset = this.closest<HTMLElement>('.canvas-scroll')?.scrollTop ?? 0;
    if (this.classList.contains('editor-canvas'))
      return new DOMRect(400, 100 - canvasOffset, 600, 1600);
    const marker = this.closest<HTMLElement>('[data-editor-node]');
    if (marker?.dataset.editorNode === 'leaf')
      return new DOMRect(420, 1200 - canvasOffset, 400, 40);
    if (marker?.dataset.editorNode === 'slot-leaf')
      return new DOMRect(420, 1000 - canvasOffset, 400, 40);
    if (marker?.dataset.editorNode === 'repeated')
      return new DOMRect(
        420,
        (marker.textContent?.includes('实例二') ? 1450 : 650) - canvasOffset,
        400,
        40,
      );
    const row = this.closest<HTMLElement>('[data-editor-tree-node]');
    if (row?.dataset.editorTreeNode === 'leaf')
      return new DOMRect(
        0,
        1200 - (this.closest<HTMLElement>('.sidebar-content')?.scrollTop ?? 0),
        220,
        30,
      );
    return new DOMRect(420, 120 - canvasOffset, 400, 40);
  });
});

afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frames.clear();
  if (originalElementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});

async function frame() {
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

function pointer(target: Element | Window, type: string, x = 430, y = 200, pointerId = 1) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

const canvasText = (value: string) =>
  within(screen.getByLabelText('测试画布滚动区')).getByText(value);

function setup() {
  const document = new EditorDocument(fixture, registry);
  let session!: ReturnType<typeof useEditorSession>;
  let currentRuntime!: PageRuntime;
  function Scene() {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const [mode, setMode] = useState<CanvasMode>('edit');
    session = useEditorSession();
    const runtime = useMemo(() => {
      const next = new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true });
      runtimes.push(next);
      return next;
    }, [snapshot.plan, snapshot.selection.pageId]);
    currentRuntime = runtime;
    useEffect(() => () => runtime.dispose(), [runtime]);
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={mode === 'edit'}>
        <CanvasBreadcrumb document={document} snapshot={snapshot} />
        <button type="button" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>
          切换测试模式
        </button>
        <div className="sidebar-content" aria-label="测试结构滚动区">
          <ComponentTree document={document} snapshot={snapshot} />
        </div>
        <div className="canvas-scroll" aria-label="测试画布滚动区">
          <EditorCanvas document={document} snapshot={snapshot} runtime={runtime} mode={mode} />
        </div>
      </DragDropProvider>
    );
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Scene />
      </TipProvider>
    </EditorSessionProvider>,
  );
  const canvasScroll = screen.getByLabelText('测试画布滚动区');
  const treeScroll = screen.getByLabelText('测试结构滚动区');
  for (const element of [canvasScroll, treeScroll]) {
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 400 });
  }
  return {
    document,
    view,
    canvasScroll,
    treeScroll,
    session: () => session,
    runtime: () => currentRuntime,
  };
}

describe('editor navigation separates selection from reveal', () => {
  it('selects a tree definition without scrolling or replacing the runtime, plan, history or leaf DOM', async () => {
    const { document, canvasScroll, treeScroll, runtime } = setup();
    const original = document.getSnapshot(),
      initialRuntime = runtime();
    const leaf = canvasText('离屏叶节点');
    canvasScroll.scrollTop = 32;
    treeScroll.scrollTop = 16;
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 leaf' }));
    await frame();
    expect(document.getSnapshot().selection.nodeId).toBe('leaf');
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([32, 16]);
    expect(document.getSnapshot().plan).toBe(original.plan);
    expect(document.getSnapshot().canUndo).toBe(false);
    expect(runtime()).toBe(initialRuntime);
    expect(initialRuntime.disposed).toBe(false);
    expect(canvasText('离屏叶节点')).toBe(leaf);
  });

  it('shares actual canvas instance hover and tree definition hover without selecting, scrolling or rebuilding', async () => {
    const { document, session, canvasScroll, treeScroll, runtime } = setup();
    const original = document.getSnapshot(),
      initialRuntime = runtime();
    const second = screen.getByText('实例二');
    const instance = second.closest<HTMLElement>('[data-editor-instance]')!;
    canvasScroll.scrollTop = 32;
    treeScroll.scrollTop = 16;
    fireEvent.pointerOver(second);
    expect(session().navigation.getSnapshot().hover).toEqual({
      pageId: 'page',
      nodeId: 'repeated',
      instanceKey: instance.dataset.editorInstance,
      source: 'canvas',
    });
    fireEvent.pointerOver(screen.getByRole('button', { name: '选中 文本 leaf' }));
    expect(session().navigation.getSnapshot().hover).toEqual({
      pageId: 'page',
      nodeId: 'leaf',
      source: 'tree',
    });
    await frame();
    expect(document.getSnapshot()).toBe(original);
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([32, 16]);
    expect(runtime()).toBe(initialRuntime);
    expect(screen.getByText('实例二')).toBe(second);
  });

  it('reveals an offscreen tree selection only through the explicit action and only scrolls the canvas', async () => {
    const { document, session, canvasScroll, treeScroll, runtime } = setup();
    const original = document.getSnapshot(),
      initialRuntime = runtime();
    canvasScroll.scrollTop = 32;
    treeScroll.scrollTop = 16;
    fireEvent.click(screen.getByRole('button', { name: '选中 文本 leaf' }));
    await frame();
    expect(canvasScroll.scrollTop).toBe(32);
    fireEvent.click(screen.getByRole('button', { name: '在画布定位 leaf' }));
    await frame();
    expect(canvasScroll.scrollTop).toBeGreaterThan(32);
    expect(treeScroll.scrollTop).toBe(16);
    expect(session().navigation.getSnapshot().request).toBeNull();
    expect(document.getSnapshot().plan).toBe(original.plan);
    expect(document.getSnapshot().canUndo).toBe(false);
    expect(runtime()).toBe(initialRuntime);
  });

  it('reveals the selected canvas node in the tree, clearing a query and opening ancestors without scrolling the canvas', async () => {
    const { document, canvasScroll, treeScroll } = setup();
    act(() => document.select('page', 'leaf'));
    canvasScroll.scrollTop = 1000;
    fireEvent.scroll(canvasScroll);
    await frame();
    fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
    fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: '不匹配的搜索' } });
    treeScroll.scrollTop = 16;
    fireEvent.click(screen.getByRole('button', { name: '在组件树定位' }));
    await frame();
    await frame();
    expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('');
    const row = screen.getByRole('button', { name: '选中 文本 leaf' });
    expect(row).toBe(globalThis.document.activeElement);
    expect(treeScroll.scrollTop).toBeGreaterThan(16);
    expect(canvasScroll.scrollTop).toBe(1000);
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('uses the requested repeated instance rather than the first DOM marker', async () => {
    const { session, canvasScroll, document } = setup();
    act(() => document.select('page', 'repeated'));
    const second = screen.getByText('实例二').closest<HTMLElement>('[data-editor-instance]')!;
    const original = document.getSnapshot();
    act(() => {
      session().navigation.requestLocate('canvas', 'repeated', second.dataset.editorInstance);
    });
    await frame();
    expect(canvasScroll.scrollTop).toBeGreaterThan(800);
    expect(document.getSnapshot()).toBe(original);
  });

  it('does not execute a scheduled reveal after navigation to another page with the same node ID', async () => {
    const { document, session, canvasScroll, treeScroll } = setup();
    canvasScroll.scrollTop = 32;
    treeScroll.scrollTop = 16;
    act(() => {
      session().navigation.requestLocate('canvas', 'leaf');
    });
    act(() => document.select('other-page', 'leaf'));
    await frame();
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([32, 16]);
    expect(session().navigation.getSnapshot().request).toBeNull();
    expect(canvasText('第二页同名节点')).toBeTruthy();
  });

  it('does not execute a scheduled canvas reveal after selecting a different node on the same page', async () => {
    const { document, session, canvasScroll, treeScroll } = setup();
    act(() => document.select('page', 'leaf'));
    canvasScroll.scrollTop = 32;
    treeScroll.scrollTop = 16;
    act(() => {
      session().navigation.requestLocate('canvas', 'leaf');
    });
    act(() => document.select('page', 'slot-leaf'));
    await frame();
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([32, 16]);
    expect(session().navigation.getSnapshot().request).toBeNull();
    expect(document.getSnapshot().selection.nodeId).toBe('slot-leaf');
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('rejects explicit reveal during an active drag and does not replay it when the drag is cancelled', async () => {
    const { document, session, canvasScroll, treeScroll, runtime } = setup();
    act(() => document.select('page', 'leaf'));
    await frame();
    const initialRuntime = runtime();
    canvasScroll.scrollTop = 32;
    treeScroll.scrollTop = 16;
    fireEvent.keyDown(screen.getByLabelText('页面编辑画布'), { key: ' ' });
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    expect(session().navigation.requestLocate('canvas', 'slot-leaf')).toBe(false);
    expect(session().navigation.requestLocate('tree', 'slot-leaf')).toBe(false);
    await frame();
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([32, 16]);
    fireEvent.click(screen.getByRole('button', { name: '取消拖动' }));
    await frame();
    expect(session().navigation.getSnapshot().request).toBeNull();
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([32, 16]);
    expect(runtime()).toBe(initialRuntime);
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('clears hover and ignores new reveal requests in preview without discarding unbound control state', async () => {
    const { session, document } = setup();
    const original = document.getSnapshot();
    fireEvent.pointerOver(canvasText('离屏叶节点'));
    expect(session().navigation.getSnapshot().hover).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换测试模式' }));
    expect(session().navigation.getSnapshot().hover).toBeNull();
    expect(session().navigation.requestLocate('canvas', 'leaf')).toBe(false);
    const field = screen.getByRole('combobox', { name: '本地草稿' });
    fireEvent.click(field);
    const option = screen.getByRole('option', { name: '保留的本地值' });
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);
    expect(field.textContent).toContain('保留的本地值');
    fireEvent.click(screen.getByRole('button', { name: '切换测试模式' }));
    fireEvent.pointerOver(screen.getByRole('button', { name: '选中 文本 leaf' }));
    fireEvent.click(screen.getByRole('button', { name: '切换测试模式' }));
    expect(screen.getByRole('combobox', { name: '本地草稿' })).toBe(field);
    expect(field.textContent).toContain('保留的本地值');
    expect(document.getSnapshot()).toBe(original);
  });

  it('treats breadcrumb hover as an independent owner and ignores its late leave after entering the canvas', async () => {
    const { document, session } = setup();
    act(() => document.select('page', 'leaf'));
    const original = document.getSnapshot();
    const parent = screen.getByRole('button', { name: '选择层级 布局容器 root' });
    fireEvent.pointerOver(parent);
    expect(session().navigation.getSnapshot().hover).toEqual({
      pageId: 'page',
      nodeId: 'root',
      source: 'breadcrumb',
    });
    const leaf = canvasText('离屏叶节点');
    fireEvent.pointerOver(leaf);
    const latest = session().navigation.getSnapshot().hover;
    expect(latest?.source).toBe('canvas');
    fireEvent.pointerOut(parent, { relatedTarget: leaf });
    expect(session().navigation.getSnapshot().hover).toEqual(latest);
    expect(parent.getAttribute('data-editor-hovered')).toBeNull();
    expect(document.getSnapshot()).toBe(original);
  });

  it('keeps multiple repeat selection frames but only one toolbar for the selected visible instance', async () => {
    const { document, canvasScroll, view } = setup();
    canvasScroll.scrollTop = 1300;
    const second = screen.getByText('实例二');
    fireEvent.click(second);
    await frame();
    expect(document.getSnapshot().selection.nodeId).toBe('repeated');
    expect(
      view.container.querySelectorAll('[data-editor-outline="repeated"].selected'),
    ).toHaveLength(2);
    const copies = screen.getAllByRole('button', { name: '复制选中组件' });
    expect(copies).toHaveLength(1);
    expect(
      copies[0].closest<HTMLElement>('[data-editor-outline-instance]')?.dataset
        .editorOutlineInstance,
    ).toBe(second.closest<HTMLElement>('[data-editor-instance]')?.dataset.editorInstance);
    expect(screen.getAllByRole('button', { name: '删除选中组件' })).toHaveLength(1);
  });

  it('clamps the sole toolbar horizontally and places it inside the frame when there is no space above', async () => {
    const { document } = setup();
    const leaf = canvasText('离屏叶节点');
    Object.defineProperty(leaf, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(950, 102, 100, 40),
    });
    act(() => document.select('page', 'leaf'));
    await frame();
    const marker = leaf.closest<HTMLElement>('[data-editor-node]')!;
    expect(clippingBounds(marker, marker.closest<HTMLElement>('.editor-surface')!)).toMatchObject({
      left: 400,
      top: 100,
      right: 1000,
      bottom: 500,
    });
    const action = screen.getByRole('button', { name: '复制选中组件' });
    const toolbar = action.closest<HTMLElement>('.canvas-selection-toolbar')!;
    const outline = action.closest<HTMLElement>('[data-editor-outline]')!;
    const canvas = screen.getByLabelText('页面编辑画布').getBoundingClientRect();
    const x = canvas.left + parseFloat(outline.style.left) + parseFloat(toolbar.style.left);
    const y = canvas.top + parseFloat(outline.style.top) + parseFloat(toolbar.style.top);
    expect(x).toBeGreaterThanOrEqual(400);
    expect(x + parseFloat(toolbar.style.width)).toBeLessThanOrEqual(1000);
    expect(y).toBeGreaterThanOrEqual(102);
    expect(y).toBeLessThan(500);
  });

  it('uses an actually visible repeat instance when the preferred instance is clipped inside a container', async () => {
    const { document, session, view } = setup();
    const first = screen.getByText('实例一');
    const second = screen.getByText('实例二');
    const firstMarker = first.closest<HTMLElement>('[data-editor-instance]')!;
    const secondMarker = second.closest<HTMLElement>('[data-editor-instance]')!;
    const clip = first.closest<HTMLElement>('.material-layout')!;
    clip.style.overflow = 'hidden';
    Object.defineProperty(clip, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(450, 150, 300, 200),
    });
    for (const [element, rect] of [
      [first, new DOMRect(460, 160, 280, 40)],
      [second, new DOMRect(460, 400, 280, 40)],
    ] as const)
      Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => rect,
      });
    act(() => {
      document.select('page', 'repeated');
      session().navigation.setSelectedInstance({
        pageId: 'page',
        nodeId: 'repeated',
        instanceKey: secondMarker.dataset.editorInstance,
      });
    });
    await frame();
    expect(
      view.container.querySelectorAll('[data-editor-outline="repeated"].selected'),
    ).toHaveLength(2);
    const copies = screen.getAllByRole('button', { name: '复制选中组件' });
    expect(copies).toHaveLength(1);
    const outline = copies[0].closest<HTMLElement>('[data-editor-outline-instance]')!;
    expect(outline.dataset.editorOutlineInstance).toBe(firstMarker.dataset.editorInstance);
    const toolbar = copies[0].closest<HTMLElement>('.canvas-selection-toolbar')!;
    const canvas = screen.getByLabelText('页面编辑画布').getBoundingClientRect();
    const x = canvas.left + parseFloat(outline.style.left) + parseFloat(toolbar.style.left);
    const y = canvas.top + parseFloat(outline.style.top) + parseFloat(toolbar.style.top);
    expect(x).toBeGreaterThanOrEqual(450);
    expect(x + parseFloat(toolbar.style.width)).toBeLessThanOrEqual(750);
    expect(y).toBeGreaterThanOrEqual(150);
    expect(y + 28).toBeLessThanOrEqual(350);
  });

  it('blocks navigation during a pending pointer gesture before the drag movement threshold', async () => {
    const { document, session, canvasScroll, treeScroll } = setup();
    act(() => document.select('page', 'leaf'));
    canvasScroll.scrollTop = 1000;
    await frame();
    const leaf = canvasText('离屏叶节点');
    pointer(leaf, 'pointerdown');
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(session().navigation.requestLocate('canvas', 'slot-leaf')).toBe(false);
    expect(session().navigation.requestLocate('tree', 'slot-leaf')).toBe(false);
    pointer(window, 'pointermove', 432, 202);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    pointer(window, 'pointerup', 432, 202);
    await frame();
    expect(session().navigation.getSnapshot().request).toBeNull();
    expect([canvasScroll.scrollTop, treeScroll.scrollTop]).toEqual([1000, 0]);
    expect(document.getSnapshot().canUndo).toBe(false);
  });
});

function bindNavigation() {
  const document = new EditorDocument(fixture, registry);
  const navigation = new EditorNavigation();
  const environment = {
    document,
    plan: document.getSnapshot().plan,
    pageId: 'page',
    enabled: true,
    dragging: false,
  };
  navigation.bind(environment);
  return { document, navigation, environment };
}

describe('ephemeral navigation request ownership', () => {
  it('distinguishes committed same-page plans from initial mounts, runtime resets, preview and identity changes without publishing navigation state', () => {
    const { document, navigation, environment } = bindNavigation();
    const original = navigation.getSnapshot();
    const listener = vi.fn();
    navigation.subscribe(listener);
    expect(navigation.enterCanvas(environment)).toBe(false);
    expect(navigation.enterCanvas(environment)).toBe(false);
    expect(navigation.getSnapshot()).toBe(original);
    expect(listener).not.toHaveBeenCalled();
    const replacement = new EditorDocument(fixture, registry);
    const committed = { ...environment, plan: replacement.getSnapshot().plan };
    expect(navigation.enterCanvas(committed)).toBe(true);
    expect(navigation.enterCanvas(committed)).toBe(false);
    expect(navigation.getSnapshot()).toBe(original);
    expect(listener).not.toHaveBeenCalled();
    navigation.bind({ ...environment, enabled: false });
    expect(navigation.enterCanvas(environment)).toBe(false);
    navigation.bind(environment);
    expect(navigation.enterCanvas(environment)).toBe(false);
    navigation.bind({ ...environment, pageId: 'other-page' });
    expect(navigation.enterCanvas({ ...environment, pageId: 'other-page' })).toBe(false);
    const another = { ...environment, document: replacement, plan: replacement.getSnapshot().plan };
    navigation.bind(another);
    expect(navigation.enterCanvas(another)).toBe(false);
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('publishes deduplicated hover state without selecting or changing document contents or history', () => {
    const { document, navigation } = bindNavigation();
    const snapshot = document.getSnapshot();
    const exported = document.exportJson();
    const listener = vi.fn();
    const unsubscribe = navigation.subscribe(listener);
    const target = { pageId: 'page', nodeId: 'repeated', instanceKey: 'rendered-instance-two' };
    navigation.setHover(target, 'canvas');
    navigation.setHover({ ...target }, 'canvas');
    expect(listener).toHaveBeenCalledOnce();
    expect(navigation.getSnapshot().hover).toEqual({ ...target, source: 'canvas' });
    expect(navigation.getSnapshot().request).toBeNull();
    expect(document.getSnapshot()).toBe(snapshot);
    expect(document.exportJson()).toBe(exported);
    expect(snapshot.canUndo).toBe(false);
    unsubscribe();
  });

  it('does not let an old source or instance leave event clear a newer hover', () => {
    const { navigation } = bindNavigation();
    const first = { pageId: 'page', nodeId: 'repeated', instanceKey: 'one' };
    const second = { ...first, instanceKey: 'two' };
    navigation.setHover(first, 'canvas');
    navigation.setHover(second, 'canvas');
    navigation.clearHover('canvas', first);
    expect(navigation.getSnapshot().hover).toEqual({ ...second, source: 'canvas' });
    navigation.setHover({ pageId: 'page', nodeId: 'leaf' }, 'tree');
    navigation.clearHover('canvas', second);
    expect(navigation.getSnapshot().hover?.source).toBe('tree');
    navigation.clearHover('tree');
    expect(navigation.getSnapshot().hover).toBeNull();
  });

  it('honors only the latest explicit locate request and ignores completion from an older request', () => {
    const { document, navigation } = bindNavigation();
    const original = document.getSnapshot();
    expect(navigation.requestLocate('canvas', 'leaf')).toBe(true);
    const first = navigation.getSnapshot().request!;
    expect(navigation.requestLocate('tree', 'slot-leaf')).toBe(true);
    const second = navigation.getSnapshot().request!;
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(navigation.isCurrent(first)).toBe(false);
    navigation.complete(first, '旧定位已完成');
    expect(navigation.getSnapshot().request).toBe(second);
    expect(navigation.getSnapshot().message).toBe('');
    navigation.complete(second, '新定位已完成');
    expect(navigation.getSnapshot().request).toBeNull();
    expect(navigation.getSnapshot().message).toBe('新定位已完成');
    expect(document.getSnapshot()).toBe(original);
  });

  it('rejects hover and location throughout a drag and never executes a deferred request after cancellation', () => {
    const { navigation, environment } = bindNavigation();
    navigation.requestLocate('canvas', 'leaf');
    const pending = navigation.getSnapshot().request!;
    navigation.bind({ ...environment, dragging: true });
    expect(navigation.isCurrent(pending)).toBe(false);
    expect(navigation.getSnapshot().request).toBeNull();
    expect(navigation.requestLocate('tree', 'leaf')).toBe(false);
    navigation.setHover({ pageId: 'page', nodeId: 'leaf' }, 'tree');
    expect(navigation.getSnapshot().hover).toBeNull();
    navigation.bind(environment);
    expect(navigation.getSnapshot().request).toBeNull();
    navigation.complete(pending, '取消拖动后迟到');
    expect(navigation.getSnapshot().message).toBe('');
  });

  it('rejects an old page request immediately before the next environment bind', () => {
    const { document, navigation, environment } = bindNavigation();
    navigation.requestLocate('canvas', 'leaf');
    const firstPageRequest = navigation.getSnapshot().request!;
    document.select('other-page', 'leaf');
    expect(navigation.isCurrent(firstPageRequest)).toBe(false);
    navigation.complete(firstPageRequest, '不能定位同名新页面节点');
    expect(navigation.getSnapshot().message).toBe('');
    navigation.bind({ ...environment, pageId: 'other-page' });
    expect(navigation.getSnapshot().request).toBeNull();
    navigation.setHover({ pageId: 'page', nodeId: 'leaf' }, 'canvas');
    expect(navigation.getSnapshot().hover).toBeNull();
  });

  it('invalidates old document identities and disabled editing without leaking the old instance target', () => {
    const { navigation, environment } = bindNavigation();
    navigation.setSelectedInstance({ pageId: 'page', nodeId: 'repeated', instanceKey: 'one' });
    navigation.requestLocate('canvas', 'repeated', 'one');
    const oldRequest = navigation.getSnapshot().request!;
    const replacement = new EditorDocument(fixture, registry);
    const next = { ...environment, document: replacement, plan: replacement.getSnapshot().plan };
    navigation.bind(next);
    expect(navigation.isCurrent(oldRequest)).toBe(false);
    expect(navigation.getSnapshot().selectedInstance).toBeNull();
    expect(navigation.getSnapshot().request).toBeNull();
    navigation.bind({ ...next, enabled: false });
    expect(navigation.requestLocate('canvas', 'leaf')).toBe(false);
    navigation.setHover({ pageId: 'page', nodeId: 'leaf' }, 'tree');
    expect(navigation.getSnapshot().hover).toBeNull();
  });

  it('invalidates a queued request when the selection changes on the same page before the next bind', () => {
    const { document, navigation } = bindNavigation();
    navigation.requestLocate('canvas', 'leaf');
    const request = navigation.getSnapshot().request!;
    document.select('page', 'slot-leaf');
    expect(navigation.isCurrent(request)).toBe(false);
    navigation.complete(request, '旧选区迟到');
    expect(navigation.getSnapshot().message).toBe('');
  });
});

describe('registered panel activation through navigation', () => {
  it('lazily activates panels and retains invalid code and data drafts through explicit tree location', async () => {
    seedLegacyProject();
    render(<App />);
    for (const panel of designPanels)
      expect(screen.getByRole('tab', { name: panel.title })).toBeTruthy();
    expect(document.querySelector('[aria-label="页面代码"]')).toBeNull();
    expect(document.querySelector('[aria-label="页面状态管理"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('搜索组件树'), {
      target: { value: '隐藏当前选中节点' },
    });
    fireEvent.click(screen.getByRole('tab', { name: '代码' }));
    const code = screen.getByRole('textbox', { name: '页面 React 代码' }) as HTMLTextAreaElement;
    changeControl(code, 'export default () => <');
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    fireEvent.click(screen.getByRole('button', { name: '新建状态' }));
    const id = screen.getByRole('textbox', { name: '状态 ID' }) as HTMLInputElement;
    const initial = screen.getByRole('textbox', { name: '状态初始值' }) as HTMLTextAreaElement;
    changeControl(id, 'pendingState');
    changeControl(initial, '{未完成');
    await frame();
    fireEvent.click(screen.getByRole('button', { name: '在组件树定位' }));
    await frame();
    await frame();
    expect(screen.getByRole('tab', { name: '大纲' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: '选中 标题 purchase-heading' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '代码' }));
    expect(screen.getByRole('textbox', { name: '页面 React 代码' })).toBe(code);
    expect(code.value).toBe('export default () => <');
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    expect(screen.getByRole('textbox', { name: '状态 ID' })).toBe(id);
    expect(screen.getByRole('textbox', { name: '状态初始值' })).toBe(initial);
    expect(id.value).toBe('pendingState');
    expect(initial.value).toBe('{未完成');
    expect(document.querySelector('[aria-label="页面代码"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="页面状态管理"]')).not.toBeNull();
    const undo = within(screen.getByLabelText('文档操作')).getByRole('button', { name: '↶ 撤销' });
    expect((undo as HTMLButtonElement).disabled).toBe(true);
  });
});
