import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { validateCatalog, type MaterialCatalog } from '../packages/editor/metadata';
import type { MaterialTemplate } from '../packages/editor/material-template';
import type { ApplicationSchema, NodeSchema } from '../packages/schema/types';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import { catalog } from '../src/editor/catalog';
import {
  DragDropProvider,
  DropZone,
  materialNode,
  materialTemplate,
  useDragDrop,
} from '../src/editor/DragDrop';
import { TipProvider } from '../src/ui/primitives';

const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalElementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
const app = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'defaults-test',
  title: 'Defaults',
  entryPageId: 'page',
  dependencies: { components: {}, actions: {} },
  pages: [{ id: 'page', title: 'Page', state: [], children: [] }],
});
const make = () => new EditorDocument(app(), registry);
const page = (doc: EditorDocument) => doc.getSnapshot().plan.pages.get('page')!.schema;
const allIds = (node: NodeSchema): string[] => [
  node.id,
  ...(node.children ?? []).flatMap(allIds),
  ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children.flatMap(allIds)),
];
function Controls() {
  const drag = useDragDrop()!;
  return (
    <>
      <button
        onKeyDown={(event) => {
          if (event.key === ' ') drag.begin({ kind: 'material', component: 'ui.tabs' });
        }}
        onPointerDown={(event) => drag.begin({ kind: 'material', component: 'ui.tabs' }, event)}
      >
        Tabs source
      </button>
      <button onClick={() => drag.choose({ kind: 'inside', parentId: 'missing' })}>
        Invalid target
      </button>
      <button onClick={() => drag.finish()}>Force finish</button>
      <DropZone intent={{ kind: 'inside' }} label="Drop at page" />
    </>
  );
}
function Harness({ doc }: { doc: EditorDocument }) {
  const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  return (
    <TipProvider>
      <DragDropProvider document={doc} snapshot={snapshot} enabled>
        <Controls />
      </DragDropProvider>
    </TipProvider>
  );
}
function pointer(target: Element | Window, type: string, x = 10, y = 10) {
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

describe('registered composite material defaults', () => {
  it('keeps the complete production catalog valid', () => {
    expect(validateCatalog(catalog, registry)).toEqual([]);
  });
  it.each([
    { component: 'missing', props: {} },
    { component: 'ui.text', props: { unknownProp: 4 } },
    { component: 'ui.tabPanel', props: { label: 'X' }, unexpected: true },
    { component: 'ui.text', props: { value: 'X' }, slots: { missing: { children: [] } } },
  ])('reports invalid initialChildren rather than throwing %#', (child) => {
    const broken = structuredClone(catalog);
    broken['ui.tabs'].initialChildren = [child as MaterialTemplate];
    let errors: string[] = [];
    expect(() => {
      errors = validateCatalog(broken, registry);
    }).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
  });
  it('reports cycles in defaults or initialChildren safely', () => {
    const child: MaterialTemplate = {
      component: 'ui.tabPanel',
      props: { label: 'Loop', value: 'loop' },
    };
    child.children = [child];
    const broken = structuredClone(catalog);
    broken['ui.tabs'].initialChildren = [child];
    expect(validateCatalog(broken, registry).some((error) => error.includes('循环'))).toBe(true);
    const payload: Record<string, unknown> = {};
    payload.self = payload;
    const defaults = structuredClone(catalog) as MaterialCatalog;
    defaults['ui.tabs'].defaultProps.bad = payload as never;
    expect(() => validateCatalog(defaults, registry)).not.toThrow();
    expect(validateCatalog(defaults, registry).length).toBeGreaterThan(0);
  });
  it('builds two neutral panels and independent copies while retaining materialNode compatibility', () => {
    const first = materialTemplate('ui.tabs'),
      second = materialTemplate('ui.tabs');
    expect(first.children).toHaveLength(2);
    expect(
      first.children!.map((child) => [child.component, child.props.label, child.props.value]),
    ).toEqual([
      ['ui.tabPanel', '标签一', 'tab-1'],
      ['ui.tabPanel', '标签二', 'tab-2'],
    ]);
    expect(first.children!.map((child) => child.children!.map((text) => text.component))).toEqual([
      ['ui.text'],
      ['ui.text'],
    ]);
    expect(
      first.children!.every((child) => child.children![0].props.value === '在此添加内容'),
    ).toBe(true);
    first.children![0].props.label = 'Mutated';
    expect(second.children![0].props.label).toBe('标签一');
    expect(catalog['ui.tabs'].initialChildren![0].props.label).toBe('标签一');
    expect(materialNode('ui.text')).toEqual({
      component: 'ui.text',
      props: Object.fromEntries(
        Object.entries(catalog['ui.text'].defaultProps).map(([name, value]) => [
          name,
          { kind: 'literal', value },
        ]),
      ),
    });
    expect(() => materialTemplate('not-registered')).toThrow();
    const unavailable = Object.entries(catalog).find(([, entry]) => entry.insertable === false)!;
    expect(unavailable).toBeDefined();
    expect(() => materialTemplate(unavailable[0])).toThrow();
  });
  it('inserts two independent contexts with unique IDs and functional panel switching', () => {
    const doc = make(),
      first = doc.insertFragment('page', materialTemplate('ui.tabs')),
      second = doc.insertFragment('page', materialTemplate('ui.tabs'));
    expect(first).not.toBe(second);
    const ids = page(doc).children.flatMap(allIds);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    for (const node of page(doc).children)
      expect(node.children!.map((panel) => panel.props.value)).toEqual([
        { kind: 'literal', value: 'tab-1' },
        { kind: 'literal', value: 'tab-2' },
      ]);
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    try {
      render(<RuntimeRenderer runtime={runtime} materials={materials} />);
      const lists = screen.getAllByRole('tablist');
      expect(lists).toHaveLength(2);
      const tabs = lists.map((list) => within(list).getAllByRole('tab'));
      expect(tabs[0].map((tab) => tab.textContent)).toEqual(['标签一', '标签二']);
      expect(tabs[0][0].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1][0].getAttribute('aria-selected')).toBe('true');
      fireEvent.click(tabs[0][1]);
      expect(tabs[0][1].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1][0].getAttribute('aria-selected')).toBe('true');
      expect(screen.getAllByText('在此添加内容').length).toBeGreaterThanOrEqual(2);
      expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
  it('preserves imported empty Tabs without applying palette defaults', () => {
    const doc = make(),
      legacy = { id: 'legacy-tabs', ...materialNode('ui.tabs'), children: [] };
    doc.insertNode('page', legacy);
    const exported = doc.exportJson(),
      restored = make();
    restored.importJson(exported);
    expect(restored.exportJson()).toBe(exported);
    expect(findNode(page(restored), 'legacy-tabs')!.node.children).toEqual([]);
    const runtime = new PageRuntime(restored.getSnapshot().plan, 'page');
    try {
      render(<RuntimeRenderer runtime={runtime} materials={materials} />);
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
});

describe('composite material drag command routing', () => {
  it('preflights keyboard Tabs, commits the same complete tree and undoes once', () => {
    const doc = make(),
      before = doc.exportJson(),
      check = vi.spyOn(doc, 'checkInsertFragment'),
      insert = vi.spyOn(doc, 'insertFragment'),
      oldInsert = vi.spyOn(doc, 'insertNode');
    render(<Harness doc={doc} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Tabs source' }), { key: ' ' });
    expect(check).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().canUndo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
    expect(insert).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(oldInsert).not.toHaveBeenCalled();
    expect(page(doc).children[0].children).toHaveLength(2);
    expect(page(doc).children[0].children![0].children).toHaveLength(1);
    act(() => doc.undo());
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it('preflights pointer Tabs and inserts its full tree only on valid release', () => {
    const doc = make(),
      before = doc.getSnapshot(),
      check = vi.spyOn(doc, 'checkInsertFragment'),
      insert = vi.spyOn(doc, 'insertFragment');
    render(<Harness doc={doc} />);
    const target = screen.getByText('Drop at page');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });
    pointer(screen.getByRole('button', { name: 'Tabs source' }), 'pointerdown');
    pointer(window, 'pointermove', 100, 100);
    expect(check).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(doc.getSnapshot()).toBe(before);
    pointer(window, 'pointerup', 100, 100);
    expect(insert).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(page(doc).children.flatMap(allIds)).toHaveLength(5);
    act(() => doc.undo());
    expect(page(doc).children).toEqual([]);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it('exposes invalid preflight feedback and leaves invalid finish atomic', () => {
    const doc = make(),
      before = doc.getSnapshot(),
      insert = vi.spyOn(doc, 'insertFragment');
    render(<Harness doc={doc} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Tabs source' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Invalid target' }));
    expect(screen.getByRole('button', { name: '确认放置' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('拖放操作').textContent).toContain('不可放入');
    fireEvent.click(screen.getByRole('button', { name: 'Force finish' }));
    expect(insert).not.toHaveBeenCalled();
    expect(doc.getSnapshot()).toBe(before);
  });
});
