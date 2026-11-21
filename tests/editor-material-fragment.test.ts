import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode, type InsertTarget } from '../packages/editor/document';
import {
  cloneLiteralJson,
  cloneMaterialTemplate,
  type MaterialTemplate,
} from '../packages/editor/material-template';
import { createRegistry } from '../packages/runtime/registry';
import type { ApplicationSchema, NodeSchema } from '../packages/schema/types';

const registry = createRegistry(
  {
    'test.box': {
      version: '2.1.0',
      children: true,
      props: { payload: { type: 'json' } },
      slots: { footer: ['record'], empty: [] },
    },
    'test.leaf': { version: '3.2.0', props: { text: { type: 'string', required: true } } },
    'test.slotLeaf': { version: '4.3.0', props: {} },
    'test.reject': { version: '1.0.0', props: {}, validateProps: () => ['not allowed'] },
  },
  {},
);
const app = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'fragment-test',
  title: 'Fragment test',
  entryPageId: 'page',
  dependencies: { components: {}, actions: {} },
  pages: [{ id: 'page', title: 'Page', state: [], children: [] }],
});
const make = () => new EditorDocument(app(), registry);
const page = (doc: EditorDocument) => doc.getSnapshot().plan.pages.get('page')!.schema;
const leaf = (): MaterialTemplate => ({
  component: 'test.leaf',
  props: { text: 'scope.record / forms.example / test-leaf-1' },
});
const tree = (): MaterialTemplate => ({
  component: 'test.box',
  props: {
    payload: {
      formId: 'opaque-form',
      arrayId: 'opaque-array',
      kind: 'stateRef',
      stateId: 'not-a-reference',
    },
  },
  children: [leaf()],
  slots: { footer: { children: [{ component: 'test.slotLeaf', props: {} }] } },
});
const ids = (node: NodeSchema): string[] => [
  node.id,
  ...(node.children ?? []).flatMap(ids),
  ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children.flatMap(ids)),
];

describe('literal material template boundary', () => {
  it.each([
    ['undefined', undefined],
    ['function', () => 1],
    ['symbol', Symbol('x')],
    ['bigint', 1n],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['Date', new Date()],
    ['Map', new Map()],
    ['Set', new Set()],
    [
      'class',
      new (class Example {
        value = 1;
      })(),
    ],
    ['null prototype', Object.create(null)],
  ])('rejects unsupported nested JSON: %s', (_name, value) => {
    expect(() => cloneLiteralJson({ nested: [value] })).toThrow();
  });
  it('rejects structural and nested-JSON ancestor cycles without stack overflow', () => {
    const structural = tree();
    structural.children = [structural];
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);
    for (const value of [
      structural,
      { component: 'test.box', props: { payload: object } },
      { component: 'test.box', props: { payload: array } },
    ]) {
      expect(() => cloneMaterialTemplate(value, registry)).toThrow(/循环/);
    }
  });
  it('expands shared acyclic subtrees and JSON independently without mutation', () => {
    const shared = leaf(),
      payload = { nested: [1, true, null] };
    const input = {
      component: 'test.box',
      props: { payload: { a: payload, b: payload } },
      children: [shared, shared],
    };
    const cloned = cloneMaterialTemplate(input, registry);
    expect(cloned).toEqual(input);
    expect(cloned.children![0]).not.toBe(cloned.children![1]);
    expect(cloned.children![0]).not.toBe(shared);
    const json = cloneLiteralJson({ a: payload, b: payload }) as { a: unknown; b: unknown };
    expect(json.a).not.toBe(json.b);
    expect(shared.props.text).toBe('scope.record / forms.example / test-leaf-1');
  });
  it('rejects accessors without invoking them, hidden/symbol props and sparse arrays', () => {
    let invoked = false;
    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get() {
        invoked = true;
        return 1;
      },
    });
    for (const value of [
      accessor,
      Object.defineProperty({}, 'hidden', { value: 1 }),
      { [Symbol('x')]: 1 },
      new Array(2),
    ])
      expect(() => cloneLiteralJson(value)).toThrow();
    expect(invoked).toBe(false);
  });
  it.each(['id', 'on', 'actions', 'when', 'repeat', 'formId', 'field', 'style', 'extensions'])(
    'rejects unknown structural field %s',
    (key) => {
      expect(() => cloneMaterialTemplate({ ...leaf(), [key]: {} }, registry)).toThrow();
    },
  );
  it.each(['formId', 'arrayId'])(
    'prohibits top-level model convention %s but preserves nested business JSON',
    (key) => {
      expect(() =>
        cloneMaterialTemplate({ component: 'test.box', props: { [key]: 'model' } }, registry),
      ).toThrow();
      expect(cloneMaterialTemplate(tree(), registry).props).toEqual(tree().props);
    },
  );
  it.each([
    { component: 'missing', props: {} },
    { component: 'test.leaf', props: {} },
    { component: 'test.leaf', props: { text: 3 } },
    { component: 'test.leaf', props: { text: 'x', surprise: true } },
    { ...leaf(), children: [] },
    { ...tree(), slots: { missing: { children: [] } } },
    { ...tree(), slots: { footer: { children: [], params: ['record'] } } },
    { ...tree(), children: {} },
    { component: 'test.reject', props: {} },
  ])('validates full shape, registered props and contracts %#', (input) => {
    expect(() => cloneMaterialTemplate(input, registry)).toThrow();
  });
});

describe('atomic composite insertion', () => {
  it.each(['test.box', 'test.leaf', 'test.slotLeaf'])(
    'rejects an existing dependency pin conflict at %s without consuming identity or redo',
    (component) => {
      const custom = createRegistry(
          Object.fromEntries(
            Object.entries(registry.components).map(([name, contract]) => [name, { ...contract }]),
          ),
          {},
        ),
        input = app();
      input.dependencies.components[component] = custom.components[component].version;
      const doc = new EditorDocument(input, custom),
        control = new EditorDocument(input, custom);
      doc.insertFragment('page', leaf());
      control.insertFragment('page', leaf());
      doc.undo();
      control.undo();
      const before = doc.getSnapshot(),
        oldVersion = custom.components[component].version;
      custom.components[component].version = '9.9.9';
      try {
        expect(() => doc.checkInsertFragment('page', tree())).toThrow();
        expect(() => doc.insertFragment('page', tree())).toThrow();
        expect(doc.getSnapshot()).toBe(before);
        expect(doc.getSnapshot().canRedo).toBe(true);
        expect(doc.getSnapshot().plan.schema.dependencies.components[component]).toBe(oldVersion);
      } finally {
        custom.components[component].version = oldVersion;
      }
      expect(doc.insertFragment('page', tree())).toBe(control.insertFragment('page', tree()));
      expect(doc.exportJson()).toBe(control.exportJson());
    },
  );
  it('populates all descendant dependencies, registered slot params and literal Values', () => {
    const doc = make(),
      template = tree(),
      original = structuredClone(template);
    const id = doc.insertFragment('page', template),
      node = findNode(page(doc), id)!.node;
    expect(doc.getSnapshot().plan.schema.dependencies.components).toEqual({
      'test.box': '2.1.0',
      'test.leaf': '3.2.0',
      'test.slotLeaf': '4.3.0',
    });
    expect(node.slots!.footer.params).toEqual(['record']);
    expect(node.slots!.empty).toEqual({ params: [], children: [] });
    expect(node.children![0].props.text).toEqual({ kind: 'literal', value: leaf().props.text });
    expect(node.props.payload).toEqual({ kind: 'literal', value: original.props.payload });
    expect(new Set(ids(node)).size).toBe(3);
    template.children![0].props.text = 'caller mutated';
    expect(node.children![0].props.text).toEqual({ kind: 'literal', value: leaf().props.text });
    expect(template.slots!.footer.children[0]).toEqual(original.slots!.footer.children[0]);
    expect(node.slots!.footer.children[0]).not.toHaveProperty('initialChildren');
  });
  it('checks and fails without changing snapshot, redo or subsequent allocation', () => {
    const doc = make(),
      control = make();
    const before = doc.getSnapshot();
    for (let i = 0; i < 3; i++) doc.checkInsertFragment('page', tree());
    for (const target of [
      { parentId: 'missing' },
      { slot: 'footer' },
      { index: -1 },
      { index: 0.5 },
      { index: 1 },
    ]) {
      expect(() => doc.checkInsertFragment('page', tree(), target)).toThrow();
      expect(() => doc.insertFragment('page', tree(), target)).toThrow();
      expect(doc.getSnapshot()).toBe(before);
    }
    expect(() => doc.insertFragment('missing', tree())).toThrow();
    expect(() =>
      doc.insertFragment('page', { ...tree(), children: [{ component: 'missing', props: {} }] }),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    expect(doc.insertFragment('page', tree())).toBe(control.insertFragment('page', tree()));
    expect(doc.exportJson()).toBe(control.exportJson());
    doc.undo();
    const undone = doc.getSnapshot();
    expect(() => doc.insertFragment('page', tree(), { index: -1 })).toThrow();
    expect(doc.getSnapshot()).toBe(undone);
    expect(doc.getSnapshot().canRedo).toBe(true);
  });
  it('inserts a whole nested fragment in one undo/redo and selects only its root', () => {
    const doc = make(),
      before = doc.exportJson(),
      selection = doc.getSnapshot().selection;
    const id = doc.insertFragment('page', tree()),
      exported = doc.exportJson();
    expect(doc.getSnapshot().selection).toEqual({ pageId: 'page', nodeId: id });
    expect(doc.getSnapshot().revision).toBe(1);
    doc.undo();
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().selection).toEqual(selection);
    expect(doc.getSnapshot().canUndo).toBe(false);
    doc.redo();
    expect(doc.exportJson()).toBe(exported);
    expect(doc.getSnapshot().selection.nodeId).toBe(id);
  });
  it('allocates against imported descendants and slots and keeps old explicit IDs intact', () => {
    const input = app();
    input.dependencies.components = { 'test.box': '2.1.0', 'test.leaf': '3.2.0' };
    input.pages[0].children = [
      {
        id: 'existing',
        component: 'test.box',
        props: {},
        slots: {
          footer: {
            params: ['record'],
            children: [
              {
                id: 'test-box-1',
                component: 'test.leaf',
                props: { text: { kind: 'literal', value: 'existing' } },
              },
            ],
          },
          empty: { params: [], children: [] },
        },
      },
    ];
    const doc = new EditorDocument(input, registry),
      id = doc.insertFragment('page', tree());
    expect(id).not.toBe('test-box-1');
    const all = page(doc).children.flatMap(ids);
    expect(new Set(all).size).toBe(all.length);
    const explicit = {
      id: 'caller-owned',
      component: 'test.leaf',
      props: { text: { kind: 'literal' as const, value: 'explicit' } },
    };
    doc.checkInsert('page', explicit);
    expect(doc.insertNode('page', explicit)).toBe('caller-owned');
    expect(findNode(page(doc), 'caller-owned')!.node).toEqual(explicit);
    const before = doc.getSnapshot();
    expect(() => doc.checkInsert('page', explicit)).toThrow();
    expect(() => doc.insertNode('page', explicit)).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });
  it('supports explicit child and slot targets and rejects leaf targets atomically', () => {
    const doc = make(),
      root = doc.insertFragment('page', tree());
    const targets: InsertTarget[] = [
      { parentId: root, index: 0 },
      { parentId: root, slot: 'footer', index: 0 },
    ];
    for (const target of targets) {
      doc.checkInsertFragment('page', leaf(), target);
      const id = doc.insertFragment('page', leaf(), target);
      expect(findNode(page(doc), id)).toMatchObject({
        parentId: root,
        index: 0,
        ...(target.slot ? { slot: target.slot } : {}),
      });
    }
    const before = doc.getSnapshot(),
      leafId = findNode(page(doc), root)!.node.children![0].id;
    expect(() => doc.insertFragment('page', tree(), { parentId: leafId })).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });
});
