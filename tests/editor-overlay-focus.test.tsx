import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import type { Registry } from '../packages/runtime/registry';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import {
  RuntimeRenderer,
  useMaterialNode,
  useRuntime,
  type MaterialPresentation,
  type NodeRenderProps,
} from '../packages/react-runtime/Renderer';
import { EditorCanvas, type CanvasMode } from '../src/editor/Canvas';
import { ComponentTree } from '../src/editor/ComponentTree';
import { CanvasBreadcrumb } from '../src/editor/CanvasBreadcrumb';
import { clippingBounds } from '../src/editor/CanvasHost';
import { nodeRect } from '../src/editor/geometry';
import { DragDropProvider } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { materials, registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const text = (id: string, value = id): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value: literal(value) },
});
const overlay = (id: string, component = 'ui.dialog', children: NodeSchema[] = []): NodeSchema => ({
  id,
  component,
  props: {
    title: literal(id),
    open: literal(false),
    triggerLabel: literal(`打开 ${id}`),
  },
  children,
});
function fixture(): ApplicationSchema {
  const nested = overlay('nested', 'ui.dialog', [text('nested-probe')]);
  const a = overlay('overlay-a', 'ui.drawer', [
    text('probe-a'),
    {
      id: 'bound-input',
      component: 'ui.input',
      props: {},
      field: { formId: 'model', fieldId: 'name' },
    },
    {
      id: 'unbound-select',
      component: 'ui.select',
      props: {
        label: literal('独立选择'),
        value: literal(''),
        options: literal([{ label: '本地保留值', value: 'preserved' }]),
      },
    },
    {
      id: 'details',
      component: 'ui.fieldArray',
      props: { formId: literal('model'), arrayId: literal('items') },
    },
    nested,
  ]);
  a.slots = {
    footer: {
      params: [],
      children: [
        text('footer-probe'),
        overlay('footer-nested', 'ui.dialog', [text('footer-nested-child')]),
      ],
    },
  };
  const repeated = overlay('repeated-overlay', 'ui.dialog', [text('repeated-probe')]);
  repeated.repeat = {
    items: literal([{ id: 'one' }, { id: 'two' }]),
    item: 'item',
    key: expression('scope.item.id'),
  };
  const hidden = overlay('hidden-overlay', 'ui.drawer', [text('hidden-child')]);
  hidden.when = literal(false);
  const empty = overlay('empty-overlay', 'ui.dialog', [text('empty-child')]);
  empty.repeat = { items: literal([]), item: 'item', key: expression('scope.item.id') };
  return {
    schemaVersion: '0.1.0',
    id: 'overlay-focus',
    title: '浮层设计验收',
    entryPageId: 'page',
    dependencies: {
      components: Object.fromEntries(
        Object.entries(registry.components).map(([id, contract]) => [id, contract.version]),
      ),
      actions: {},
    },
    pages: [
      {
        id: 'page',
        title: '页面',
        state: [],
        forms: [
          {
            id: 'model',
            fields: [
              { id: 'name', path: ['name'], label: '绑定名称', type: 'string', initial: '' },
            ],
            arrays: [
              {
                id: 'items',
                path: ['items'],
                label: '明细',
                fields: [
                  { id: 'name', path: ['name'], label: '项目', type: 'string', initial: '' },
                ],
                initial: [{ name: '第一行' }],
              },
            ],
          },
        ],
        children: [
          {
            id: 'form',
            component: 'ui.form',
            formId: 'model',
            props: {},
            children: [
              text('page-probe'),
              a,
              overlay('overlay-b', 'ui.dialog', [text('probe-b')]),
              repeated,
              hidden,
              empty,
            ],
          },
        ],
      },
    ],
  };
}

const runtimes: PageRuntime[] = [];
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const style = getComputedStyle(this);
    if (this.closest('[data-editor-design-hidden]') || style.display === 'none')
      return new DOMRect();
    if (this.classList.contains('canvas-scroll')) return new DOMRect(300, 100, 800, 600);
    if (this.classList.contains('sidebar-content')) return new DOMRect(0, 100, 240, 600);
    return new DOMRect(340, 150, 650, 100);
  });
});
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
});
function createRuntime(schema = fixture()) {
  const runtime = new PageRuntime(compileApplication(schema, registry), 'page', {
    designMode: true,
  });
  runtimes.push(runtime);
  return runtime;
}
function Decorator({ node, instanceKey, presentation, inactiveReason, children }: NodeRenderProps) {
  return (
    <div
      data-test-node={node.id}
      data-test-instance={instanceKey}
      data-test-hidden={presentation?.hidden || undefined}
      data-test-inactive={inactiveReason}
      style={{ display: presentation?.hidden ? 'none' : 'contents' }}
    >
      {children}
    </div>
  );
}
const host = (nodeId: string) =>
  document.querySelector<HTMLElement>(`.material-overlay-host[data-overlay-node="${nodeId}"]`)!;
const hosts = (nodeId: string) => [
  ...document.querySelectorAll<HTMLElement>(
    `.material-overlay-host[data-overlay-node="${nodeId}"]`,
  ),
];
const modeOf = (nodeId: string) => host(nodeId)?.dataset.overlayPresentation;
const visibleScope = () => screen.queryByRole('region', { name: '浮层编辑范围' });

function expectSameElements(actual: Element[], expected: Element[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((element, index) => expect(element).toBe(expected[index]));
}

describe('host-only overlay presentation preserves React and runtime ownership', () => {
  it('retains Hook tokens, local state, Portal hosts, bound Form and row identities across page, sibling and nested presentation changes', async () => {
    const runtime = createRuntime();
    const form = runtime.getForm('model');
    const run = vi.spyOn(runtime, 'run');
    const enter = vi.spyOn(runtime, 'enter');
    const reset = vi.spyOn(form, 'reset');
    const submit = vi.spyOn(form, 'submit');
    let serial = 0;
    const mounted = vi.fn(),
      unmounted = vi.fn();
    function Probe() {
      const node = useMaterialNode()!;
      const token = useRef(++serial);
      const [value, setValue] = useState('initial');
      const owner = useRuntime();
      useEffect(() => {
        mounted(node.id, token.current, owner);
        return () => {
          unmounted(node.id, token.current);
        };
      }, []);
      return (
        <input
          aria-label={`Hook ${node.id}`}
          data-hook-token={token.current}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    let focused: string | null = null;
    const presentation = (node: NodeSchema): MaterialPresentation => ({
      ...(node.component === 'ui.dialog' || node.component === 'ui.drawer'
        ? {
            overlay:
              node.id === focused
                ? 'expanded'
                : focused === 'nested' && node.id === 'overlay-a'
                  ? 'ancestor'
                  : 'collapsed',
          }
        : {}),
    });
    const customMaterials = { ...materials, 'ui.text': Probe };
    const view = render(
      <TipProvider>
        <RuntimeRenderer
          runtime={runtime}
          materials={customMaterials}
          designMode
          designPresentation={presentation}
          nodeDecorator={Decorator}
        />
      </TipProvider>,
    );
    await waitFor(() =>
      expect(document.querySelector('[aria-label="Hook footer-probe"]')).not.toBeNull(),
    );
    const probes = [...document.querySelectorAll<HTMLInputElement>('input[data-hook-token]')];
    const portalHosts = [...document.querySelectorAll('.material-overlay-mount')];
    const popups = [...document.querySelectorAll('.material-modal')];
    act(() => {
      form.setValue('name', '保留绑定值');
      form.blur('name');
      form.append('items', { name: '第二行' });
    });
    const formSnapshot = form.getSnapshot();
    const ids = formSnapshot.arrays.items.rows.map((row) => row.id);
    for (const probe of probes)
      fireEvent.change(probe, { target: { value: `draft-${probe.dataset.hookToken}` } });
    const baseline = {
      mounts: mounted.mock.calls.length,
      unmounts: unmounted.mock.calls.length,
      run: run.mock.calls.length,
      enter: enter.mock.calls.length,
    };
    const bound = document.querySelector<HTMLInputElement>('input[aria-invalid]')!;
    const rowElements = [...document.querySelectorAll('[data-row-id]')];
    expect(probes.length).toBeGreaterThanOrEqual(7);
    expect(portalHosts.length).toBeGreaterThanOrEqual(6);
    expect(bound).not.toBeNull();
    expect(rowElements).toHaveLength(2);
    for (focused of [
      'overlay-a',
      'overlay-b',
      'overlay-a',
      'nested',
      null,
      'overlay-b',
      'overlay-a',
      null,
    ]) {
      view.rerender(
        <TipProvider>
          <RuntimeRenderer
            runtime={runtime}
            materials={customMaterials}
            designMode
            designPresentation={presentation}
            nodeDecorator={Decorator}
          />
        </TipProvider>,
      );
      expectSameElements([...document.querySelectorAll('.material-overlay-mount')], portalHosts);
      expectSameElements([...document.querySelectorAll('.material-modal')], popups);
      expectSameElements([...document.querySelectorAll('input[data-hook-token]')], probes);
      for (const probe of probes) expect(probe.value).toBe(`draft-${probe.dataset.hookToken}`);
      expect(document.querySelector('input[aria-invalid]')).toBe(bound);
      expectSameElements([...document.querySelectorAll('[data-row-id]')], rowElements);
      expect(runtime.getForm('model')).toBe(form);
      expect(form.getSnapshot()).toBe(formSnapshot);
      expect(form.getSnapshot().fields.name).toMatchObject({
        value: '保留绑定值',
        touched: true,
        dirty: true,
      });
      expect(form.getSnapshot().arrays.items.rows.map((row) => row.id)).toEqual(ids);
      expect(mounted).toHaveBeenCalledTimes(baseline.mounts);
      expect(unmounted).toHaveBeenCalledTimes(baseline.unmounts);
      expect(run).toHaveBeenCalledTimes(baseline.run);
      expect(enter).toHaveBeenCalledTimes(baseline.enter);
      expect(reset).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    }
    expect(mounted.mock.calls.every((call) => call[2] === runtime)).toBe(true);
  });

  it('does not call host presentation in preview and preserves standalone Renderer design behavior when no policy is supplied', async () => {
    const runtime = createRuntime();
    const policy = vi.fn((): MaterialPresentation => ({ overlay: 'collapsed' }));
    const view = render(
      <TipProvider>
        <RuntimeRenderer runtime={runtime} materials={materials} designPresentation={policy} />
      </TipProvider>,
    );
    await waitFor(() => expect(host('overlay-a')).toBeTruthy());
    expect(policy).not.toHaveBeenCalled();
    expect(modeOf('overlay-a')).toBeUndefined();
    expect(screen.queryByRole('dialog', { name: 'overlay-a' })).toBeNull();
    view.rerender(
      <TipProvider>
        <RuntimeRenderer runtime={runtime} materials={materials} designMode />
      </TipProvider>,
    );
    expect(modeOf('overlay-a')).toBe('expanded');
    expect(modeOf('overlay-b')).toBe('expanded');
    expect(policy).not.toHaveBeenCalled();
  });

  it('keeps hidden and empty-repeat business branches absent even when the host asks every material to expand', () => {
    const runtime = createRuntime();
    const policy = vi.fn((): MaterialPresentation => ({ overlay: 'expanded' }));
    render(
      <TipProvider>
        <RuntimeRenderer
          runtime={runtime}
          materials={materials}
          designMode
          designPresentation={policy}
          nodeDecorator={Decorator}
        />
      </TipProvider>,
    );
    expect(host('hidden-overlay')).toBeNull();
    expect(host('empty-overlay')).toBeNull();
    expect(document.querySelector('[data-test-node="hidden-child"]')).toBeNull();
    expect(document.querySelector('[data-test-node="empty-child"]')).toBeNull();
    expect(
      document
        .querySelector('[data-test-node="hidden-overlay"]')
        ?.getAttribute('data-test-inactive'),
    ).toBe('condition');
    expect(
      document
        .querySelector('[data-test-node="empty-overlay"]')
        ?.getAttribute('data-test-inactive'),
    ).toBe('empty-repeat');
    expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
  });
});

function setupCanvas(
  schema = fixture(),
  designRuntime = true,
  runtimeRegistry: Registry = registry,
) {
  const document = new EditorDocument(schema, runtimeRegistry);
  const runtime = new PageRuntime(document.getSnapshot().plan, 'page', {
    designMode: designRuntime,
  });
  runtimes.push(runtime);
  let session!: ReturnType<typeof useEditorSession>;
  function Scene() {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const [mode, setMode] = useState<CanvasMode>('edit');
    session = useEditorSession();
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={mode === 'edit'}>
        <button
          type="button"
          onClick={() => setMode((current) => (current === 'edit' ? 'preview' : 'edit'))}
        >
          切换验收模式
        </button>
        <CanvasBreadcrumb document={document} snapshot={snapshot} />
        <div className="sidebar-content">
          <ComponentTree document={document} snapshot={snapshot} />
        </div>
        <div className="canvas-scroll">
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
  return { document, runtime, view, session: () => session };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}
function selectTree(nodeId: string, type = '文本') {
  fireEvent.click(screen.getByRole('button', { name: `选中 ${type} ${nodeId}` }));
}

function pointer(target: Element | Window, type: string, x = 400, y = 180) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

describe('editor overlay scope follows explicit selection without changing business ownership', () => {
  it('starts with compact placeholders and switches one scope between sibling and nested overlays, preserving body and footer DOM', async () => {
    const { document, runtime } = setupCanvas();
    await settle();
    expect(visibleScope()).toBeNull();
    expect(modeOf('overlay-a')).toBe('collapsed');
    expect(modeOf('overlay-b')).toBe('collapsed');
    const a = host('overlay-a'),
      b = host('overlay-b');
    const aBody = a.querySelector('.material-modal-body');
    const aFooter = a.querySelector('.material-modal')!.querySelector(':scope > footer');
    const portal = a.querySelector('.material-overlay-mount');
    const original = document.getSnapshot();
    const run = vi.spyOn(runtime, 'run');
    for (const [id, overlayId] of [
      ['probe-a', 'overlay-a'],
      ['probe-b', 'overlay-b'],
      ['footer-probe', 'overlay-a'],
      ['nested-probe', 'nested'],
    ] as const) {
      selectTree(id);
      await settle();
      expect(visibleScope()?.textContent).toContain(overlayId);
      expect(modeOf(overlayId)).toBe('expanded');
      expect(
        globalThis.document.querySelectorAll(
          '.material-overlay-host[data-overlay-presentation="expanded"]',
        ),
      ).toHaveLength(1);
      expect(host('overlay-a')).toBe(a);
      expect(host('overlay-b')).toBe(b);
      expect(a.querySelector('.material-modal-body')).toBe(aBody);
      expect(a.querySelector('.material-modal')!.querySelector(':scope > footer')).toBe(aFooter);
      expect(a.querySelector('.material-overlay-mount')).toBe(portal);
      expect(document.getSnapshot().plan).toBe(original.plan);
      expect(document.getSnapshot().canUndo).toBe(false);
    }
    expect(modeOf('overlay-a')).toBe('ancestor');
    fireEvent.click(screen.getByRole('button', { name: '返回页面' }));
    await settle();
    expect(visibleScope()).toBeNull();
    expect(modeOf('overlay-a')).toBe('collapsed');
    expect(modeOf('nested')).toBe('collapsed');
    expect(run).not.toHaveBeenCalled();
  });

  it('opens exactly one repeated instance and preserves an explicitly selected second canvas instance', async () => {
    const { document, session } = setupCanvas();
    await settle();
    const repeated = hosts('repeated-overlay');
    expect(repeated).toHaveLength(2);
    const second = repeated[1].closest<HTMLElement>('[data-editor-instance]')!;
    act(() => {
      document.select('page', 'repeated-overlay');
      session().navigation.setSelectedInstance({
        pageId: 'page',
        nodeId: 'repeated-overlay',
        instanceKey: second.dataset.editorInstance,
      });
    });
    await settle();
    expect(repeated.map((element) => element.dataset.overlayPresentation)).toEqual([
      'collapsed',
      'expanded',
    ]);
    expect(visibleScope()?.textContent).toContain('repeated-overlay');
    fireEvent.click(screen.getByRole('button', { name: '返回页面' }));
    await settle();
    selectTree('repeated-overlay', '对话框');
    await settle();
    expect(
      hosts('repeated-overlay').filter(
        (element) => element.dataset.overlayPresentation === 'expanded',
      ),
    ).toHaveLength(1);
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('keeps a nested overlay in a footer slot reachable through the ancestor without replacing its footer or portal', async () => {
    const { document: editorDocument } = setupCanvas();
    await settle();
    const footer = host('overlay-a')
      .querySelector('.material-modal')!
      .querySelector(':scope > footer')!;
    const nested = host('footer-nested');
    const portal = nested.querySelector('.material-overlay-mount');
    const original = editorDocument.getSnapshot().plan;
    selectTree('footer-nested-child');
    await settle();
    expect(modeOf('overlay-a')).toBe('ancestor');
    expect(modeOf('footer-nested')).toBe('expanded');
    expect(footer.contains(nested)).toBe(true);
    expect(footer.hasAttribute('data-overlay-slot-footer')).toBe(true);
    expect(getComputedStyle(footer).display).not.toBe('none');
    expect(nested.closest('[data-editor-design-hidden]')).toBeNull();
    expect(
      host('overlay-a').querySelector('.material-modal')!.querySelector(':scope > footer'),
    ).toBe(footer);
    expect(host('footer-nested').querySelector('.material-overlay-mount')).toBe(portal);
    expect(editorDocument.getSnapshot().plan).toBe(original);
    expect(editorDocument.getSnapshot().canUndo).toBe(false);
  });

  it('places the selected component toolbar below the visible sticky scope banner without covering the return action', async () => {
    setupCanvas();
    selectTree('probe-a');
    await settle();
    const context = screen.getByRole('region', { name: '浮层编辑范围' });
    const contextRect = new DOMRect(340, 110, 650, 42);
    Object.defineProperty(context, 'getBoundingClientRect', {
      configurable: true,
      value: () => contextRect,
    });
    const canvas = screen.getByLabelText('页面编辑画布');
    const leaf = within(canvas).getByText('probe-a');
    Object.defineProperty(leaf, 'getBoundingClientRect', {
      configurable: true,
      value: () => new DOMRect(350, 145, 500, 100),
    });
    fireEvent.scroll(canvas.closest('.canvas-scroll')!);
    await settle();
    const marker = leaf.closest<HTMLElement>('[data-editor-node]')!;
    expect(nodeRect(marker)).toMatchObject({ left: 350, top: 145, right: 850, bottom: 245 });
    expect(
      clippingBounds(marker, canvas.querySelector<HTMLElement>('.editor-surface')!),
    ).toMatchObject({ left: 300, top: 100, right: 1100, bottom: 700 });
    expect(canvas.querySelector('[aria-label="复制选中组件"]')).not.toBeNull();
    const copy = await screen.findByRole('button', { name: '复制选中组件' });
    const outline = copy.closest<HTMLElement>('[data-editor-outline]')!;
    const toolbar = copy.closest<HTMLElement>('.canvas-selection-toolbar')!;
    const base = canvas.getBoundingClientRect();
    const left = base.left + parseFloat(outline.style.left) + parseFloat(toolbar.style.left);
    const top = base.top + parseFloat(outline.style.top) + parseFloat(toolbar.style.top);
    const width = parseFloat(toolbar.style.width);
    const intersects =
      left < contextRect.right &&
      left + width > contextRect.left &&
      top < contextRect.bottom &&
      top + 28 > contextRect.top;
    expect(intersects).toBe(false);
    expect(top).toBeGreaterThanOrEqual(contextRect.bottom);
    expect(top + 28).toBeLessThanOrEqual(700);
    expect((screen.getByRole('button', { name: '返回页面' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('prefers the currently measurable repeated instance when tree selection supplies only the shared definition', async () => {
    const { document: editorDocument, session } = setupCanvas();
    await settle();
    const repeated = hosts('repeated-overlay');
    const secondMarker = repeated[1].closest<HTMLElement>('[data-editor-instance]')!;
    const secondChild = repeated[1].querySelector<HTMLElement>(
      '[data-editor-node="repeated-probe"]',
    )!;
    act(() => {
      editorDocument.select('page', 'repeated-probe');
      session().navigation.setSelectedInstance({
        pageId: 'page',
        nodeId: 'repeated-probe',
        instanceKey: secondChild.dataset.editorInstance,
      });
    });
    await settle();
    expect(repeated.map((element) => element.dataset.overlayPresentation)).toEqual([
      'collapsed',
      'expanded',
    ]);
    expect(repeated[0].closest('[data-editor-design-hidden]')).not.toBeNull();
    selectTree('repeated-overlay', '对话框');
    await settle();
    expect(repeated.map((element) => element.dataset.overlayPresentation)).toEqual([
      'collapsed',
      'expanded',
    ]);
    expect(screen.getByLabelText('页面编辑画布').getAttribute('data-overlay-focus-instance')).toBe(
      secondMarker.dataset.editorInstance,
    );
  });

  it('does not force hidden or empty-repeat targets into business DOM when selecting their definitions or descendants', async () => {
    const { document, session } = setupCanvas();
    const original = document.getSnapshot().plan;
    for (const id of ['hidden-overlay', 'hidden-child', 'empty-overlay', 'empty-child']) {
      act(() => document.select('page', id));
      await settle();
      expect(visibleScope()).toBeNull();
      expect(host('hidden-overlay')).toBeNull();
      expect(host('empty-overlay')).toBeNull();
      expect(document.getSnapshot().plan).toBe(original);
      act(() => {
        session().navigation.requestLocate('canvas', id);
      });
      await settle();
      expect(visibleScope()).toBeNull();
      expect(session().navigation.getSnapshot().message).toMatch(/占位|不可见/);
    }
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('freezes the current scope throughout a pending pointer gesture and never replays a rejected scope change after release', async () => {
    const { document: editorDocument, session } = setupCanvas();
    selectTree('probe-a');
    await settle();
    const canvas = screen.getByLabelText('页面编辑画布');
    const leaf = within(canvas).getByText('probe-a');
    pointer(leaf, 'pointerdown');
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    selectTree('probe-b');
    await settle();
    expect(modeOf('overlay-a')).toBe('expanded');
    expect(modeOf('overlay-b')).toBe('collapsed');
    expect((screen.getByRole('button', { name: '返回页面' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(session().navigation.requestLocate('canvas', 'overlay-b')).toBe(false);
    pointer(window, 'pointermove', 402, 182);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    pointer(window, 'pointerup', 402, 182);
    await settle();
    expect(modeOf('overlay-a')).toBe('expanded');
    expect(modeOf('overlay-b')).toBe('collapsed');
    expect(session().navigation.getSnapshot().request).toBeNull();
    expect(editorDocument.getSnapshot().canUndo).toBe(false);
    selectTree('probe-b');
    await settle();
    expect(modeOf('overlay-b')).toBe('expanded');
  });

  it('freezes the current scope during active keyboard dragging and does not switch it on cancellation', async () => {
    const { session } = setupCanvas();
    selectTree('probe-a');
    await settle();
    fireEvent.keyDown(screen.getByLabelText('页面编辑画布'), { key: ' ' });
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    selectTree('probe-b');
    await settle();
    expect(modeOf('overlay-a')).toBe('expanded');
    expect(modeOf('overlay-b')).toBe('collapsed');
    expect(session().navigation.requestLocate('canvas', 'overlay-b')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '取消拖动' }));
    await settle();
    expect(modeOf('overlay-a')).toBe('expanded');
    expect(modeOf('overlay-b')).toBe('collapsed');
    selectTree('probe-b');
    await settle();
    expect(modeOf('overlay-b')).toBe('expanded');
  });

  it('restores the real preview Drawer and preserves its local Select value across design scope changes and return to the page', async () => {
    const { document: editorDocument, runtime } = setupCanvas();
    await settle();
    const original = editorDocument.getSnapshot().plan;
    const toggleMode = screen.getByRole('button', { name: '切换验收模式' });
    fireEvent.click(toggleMode);
    expect(visibleScope()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'overlay-a' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开 overlay-a' }));
    const dialog = await screen.findByRole('dialog', { name: 'overlay-a' });
    const field = within(dialog).getByRole('combobox', { name: '独立选择' });
    fireEvent.click(field);
    const option = await screen.findByRole('option', { name: '本地保留值' });
    fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
    fireEvent.click(option);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.textContent).toContain('本地保留值');
    const run = vi.spyOn(runtime, 'run');
    fireEvent.click(toggleMode);
    for (const id of ['probe-a', 'probe-b', 'probe-a']) {
      selectTree(id);
      await settle();
    }
    fireEvent.click(screen.getByRole('button', { name: '返回页面' }));
    await settle();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(toggleMode);
    expect(await screen.findByRole('dialog', { name: 'overlay-a' })).toBe(dialog);
    expect(screen.getByRole('combobox', { name: '独立选择' })).toBe(field);
    expect(field.textContent).toContain('本地保留值');
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.keyUp(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'overlay-a' })).toBeNull());
    expect(editorDocument.getSnapshot().plan).toBe(original);
    expect(editorDocument.getSnapshot().canUndo).toBe(false);
  });

  it('intercepts design confirm, close, input and form reset without invoking real authored callbacks or changing business state', async () => {
    const schema = fixture();
    schema.dependencies.actions = {
      'state.set': '1.0.0',
      'ui.notify': '1.0.0',
      'data.execute': '1.0.0',
    };
    schema.dependencies.transports = { 'test.read': '1.0.0' };
    schema.pages[0].dataSources = [
      { id: 'source', kind: 'query', transport: 'test.read', input: {}, initial: {} },
    ];
    schema.pages[0].state = [{ id: 'businessOpen', type: 'boolean', initial: false }];
    schema.pages[0].onEnter = [
      { id: 'enter-observer', action: 'ui.notify', input: { title: literal('页面进入') } },
      { id: 'initial-query', action: 'data.execute', input: { sourceId: literal('source') } },
    ];
    const target = schema.pages[0].children[0].children![2];
    expect(target.id).toBe('overlay-b');
    target.props.open = { kind: 'stateRef', stateId: 'businessOpen' };
    target.on = {
      onOpenChange: [
        {
          id: 'open-observer',
          action: 'state.set',
          input: { stateId: literal('businessOpen'), value: expression('event') },
        },
      ],
      onConfirm: [
        { id: 'confirm-observer', action: 'ui.notify', input: { title: literal('确认执行') } },
      ],
    };
    const notify = vi.spyOn(registry.actions['ui.notify'], 'execute');
    const request = vi.fn(() => ({ okay: true }));
    const runtimeRegistry: Registry = {
      ...registry,
      transports: {
        ...registry.transports,
        'test.read': { version: '1.0.0', input: {}, output: 'object', execute: request },
      },
    };
    const { runtime, document: editorDocument } = setupCanvas(schema, false, runtimeRegistry);
    await act(async () => {
      await runtime.enter();
    });
    expect(notify).toHaveBeenCalledOnce();
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    const enter = vi.spyOn(runtime, 'enter');
    const run = vi.spyOn(runtime, 'run');
    const form = runtime.getForm('model');
    const reset = vi.spyOn(form, 'reset');
    const before = editorDocument.exportJson();
    for (let turn = 0; turn < 2; turn++) {
      selectTree('probe-b');
      await settle();
      const popup = host('overlay-b').querySelector<HTMLElement>('.material-modal')!;
      fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
      fireEvent.click(within(popup).getByRole('button', { name: '关闭overlay-b' }));
      selectTree('bound-input', '文本输入');
      await settle();
      const bound = within(screen.getByLabelText('页面编辑画布')).getByRole('textbox', {
        name: '绑定名称',
      });
      fireEvent.change(bound, { target: { value: '不应写入' } });
      fireEvent.reset(bound.closest('form')!);
      fireEvent.click(screen.getByRole('button', { name: '返回页面' }));
      await settle();
    }
    expect(notify).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(enter).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(runtime.getState().businessOpen).toBe(false);
    expect(form.getSnapshot().fields.name.value).toBe('');
    expect(editorDocument.exportJson()).toBe(before);
    expect(editorDocument.getSnapshot().canUndo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '切换验收模式' }));
    fireEvent.click(screen.getByRole('button', { name: '打开 overlay-b' }));
    await waitFor(() => expect(runtime.getState().businessOpen).toBe(true));
    const dialog = await screen.findByRole('dialog', { name: 'overlay-b' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    await waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(runtime.getState().businessOpen).toBe(false));
  });
});
