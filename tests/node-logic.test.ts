import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { nodeLogicScopes } from '../packages/editor/scope';
import { valueScopeReads } from '../packages/runtime/expression';
import { validateApplication } from '../packages/schema/validate';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { registry } from '../src/materials';

const lit = (value: Json): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const loop = (item = 'row', index?: string): NonNullable<NodeSchema['repeat']> => ({
  items: lit([{ id: 'a' }]),
  item,
  ...(index ? { index } : {}),
  key: expr(`scope[${JSON.stringify(item)}].id`),
});
const box = (id: string, patch: Partial<NodeSchema> = {}): NodeSchema => ({
  id,
  component: 'test.box',
  props: {},
  ...patch,
});
const testRegistry = {
  ...registry,
  components: {
    ...registry.components,
    'test.box': {
      version: '1.0.0',
      props: { value: { type: 'json' as const } },
      children: true,
      events: ['onClick'],
      slots: { body: ['row'] },
      style: { target: 'root' as const, properties: ['color' as const] },
    },
  },
};
function app(nodes: NodeSchema[]): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'logic',
    title: 'Logic',
    entryPageId: 'page',
    dependencies: { components: { 'test.box': '1.0.0' }, actions: { 'state.set': '1.0.0' } },
    pages: [
      {
        id: 'page',
        title: 'Logic',
        state: [
          { id: 'shown', type: 'boolean', initial: true },
          { id: 'rows', type: 'array', initial: [] },
          { id: 'text', type: 'string', initial: '' },
        ],
        children: nodes,
      },
    ],
  };
}
const make = (nodes: NodeSchema[]) => new EditorDocument(app(nodes), testRegistry);
const page = (doc: EditorDocument) => doc.getSnapshot().plan.pages.get('page')!.schema;
const node = (doc: EditorDocument, id = 'target') => findNode(page(doc), id)!.node;

describe('node logic validation and commands', () => {
  it('validates field/source root types and protects declarations referenced only in node logic', () => {
    const input = app([box('target')]);
    input.dependencies.transports = { 'test.rows': '1.0.0' };
    input.pages[0].forms = [
      {
        id: 'model',
        fields: [
          { id: 'active', path: ['active'], label: 'Active', type: 'boolean', initial: true },
          { id: 'label', path: ['label'], label: 'Label', type: 'string', initial: '' },
        ],
      },
    ];
    input.pages[0].dataSources = [
      { id: 'records', kind: 'query', transport: 'test.rows', input: {}, initial: [] },
    ];
    const linkedRegistry = {
      ...testRegistry,
      transports: {
        ...testRegistry.transports,
        'test.rows': {
          version: '1.0.0',
          input: {},
          output: 'array' as const,
          execute: async () => [],
        },
      },
    };
    const doc = new EditorDocument(input, linkedRegistry);
    doc.setNodeLogic('page', 'target', {
      when: { kind: 'fieldRef', formId: 'model', fieldId: 'active' },
      repeat: {
        ...loop(),
        items: { kind: 'dataRef', sourceId: 'records' },
        key: { kind: 'fieldRef', formId: 'model', fieldId: 'label' },
      },
    });
    const before = doc.getSnapshot();
    expect(() => doc.removeDataSource('page', 'records')).toThrow(/repeat/);
    expect(() => doc.removeForm('page', 'model')).toThrow();
    expect(() =>
      doc.setNodeLogic('page', 'target', { when: { kind: 'dataRef', sourceId: 'records' } }),
    ).toThrow();
    expect(() =>
      doc.setNodeLogic('page', 'target', {
        repeat: { ...loop(), key: { kind: 'fieldRef', formId: 'model', fieldId: 'active' } },
      }),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    doc.setNodeLogic('page', 'target', { when: { kind: 'stateRef', stateId: 'shown' } });
    expect(() => doc.removeState('page', 'shown')).toThrow(/when/);
    const exported = doc.exportJson();
    const restored = new EditorDocument(JSON.parse(exported), linkedRegistry);
    expect(node(restored).repeat).toEqual(node(doc).repeat);
    const copied = doc.duplicateNode('page', 'target');
    expect(node(doc, copied).when).toEqual(node(doc).when);
    expect(node(doc, copied).repeat).toEqual(node(doc).repeat);
  });
  it('extracts static reads and dynamic wildcards, never scanning literal data', () => {
    const reads = valueScopeReads(
      expr('scope.row.id + scope["other"].id + scope[scope.selector].id + String(scope)'),
    );
    expect([...reads.names].sort()).toEqual(['other', 'row', 'selector']);
    expect(reads.wildcard).toBe(true);
    expect(valueScopeReads(lit({ source: 'scope.missing' })).names.size).toBe(0);
    expect(valueScopeReads(expr('"scope.missing"')).wildcard).toBe(false);
  });
  it('rejects all statically invalid logic/scope cases and keeps dynamic syntax compatible', () => {
    const invalid: NodeSchema[] = [
      box('target', { when: lit(1) }),
      box('target', { repeat: { ...loop(), items: lit(1) } }),
      box('target', { repeat: { ...loop(), key: lit(false) } }),
      box('target', { props: { value: expr('scope.missing.id') } }),
      box('target', { when: expr('scope.missing.enabled') }),
      box('target', { repeat: { ...loop(), items: expr('scope.row.children') } }),
      box('target', { repeat: { ...loop(), key: expr('scope.missing.id') } }),
      box('target', {
        on: {
          onClick: [
            {
              id: 'call',
              action: 'state.set',
              input: { stateId: lit('text'), value: expr('scope.missing.id') },
            },
          ],
        },
      }),
    ];
    for (const candidate of invalid)
      expect(validateApplication(app([candidate]), testRegistry).length).toBeGreaterThan(0);
    for (const source of ['scope[String("row")].id', 'String(scope)', 'scope[scope.row.key]'])
      expect(
        validateApplication(
          app([box('target', { repeat: loop(), props: { value: expr(source) } })]),
          testRegistry,
        ),
      ).toEqual([]);
    const nested = box('outer', {
      repeat: loop(),
      children: [box('target', { repeat: { ...loop(), items: expr('scope.row.children') } })],
    });
    expect(validateApplication(app([nested]), testRegistry)).toEqual([]);
  });
  it('checks declared root types, preserves unknown paths, and forbids event outside actions', () => {
    const doc = make([box('target')]);
    doc.setNodeLogic('page', 'target', {
      when: { kind: 'stateRef', stateId: 'shown' },
      repeat: {
        ...loop(),
        items: { kind: 'stateRef', stateId: 'rows' },
        key: { kind: 'stateRef', stateId: 'text' },
      },
    });
    for (const patch of [
      { when: { kind: 'stateRef', stateId: 'text' } },
      { repeat: { ...loop(), items: { kind: 'stateRef', stateId: 'shown' } } },
      { repeat: { ...loop(), key: { kind: 'stateRef', stateId: 'rows' } } },
      { when: expr('event.target.value') },
    ])
      expect(() =>
        doc.setNodeLogic('page', 'target', patch as Parameters<typeof doc.setNodeLogic>[2]),
      ).toThrow();
    doc.setNodeLogic('page', 'target', {
      when: { kind: 'stateRef', stateId: 'rows', path: ['0', 'visible'] },
    });
    expect(node(doc).when).toMatchObject({ path: ['0', 'visible'] });
  });
  it('applies condition+aliases atomically, clones inputs and preserves history/redo on rejection', () => {
    const doc = make([
      box('target', {
        repeat: loop(),
        when: expr('scope.row.visible'),
        props: { value: lit('untouched') },
        children: [box('child')],
      }),
    ]);
    const patch = { when: expr('scope.record.visible'), repeat: loop('record') };
    doc.setNodeLogic('page', 'target', patch);
    patch.repeat.item = 'mutated';
    expect(node(doc).repeat!.item).toBe('record');
    expect(node(doc).props).toEqual({ value: lit('untouched') });
    doc.undo();
    expect(node(doc).repeat!.item).toBe('row');
    const before = doc.getSnapshot();
    expect(() => doc.setNodeLogic('page', 'target', { repeat: undefined })).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    doc.redo();
    expect(node(doc).when).toEqual(expr('scope.record.visible'));
    doc.setNodeLogic('page', 'target', { when: undefined, repeat: undefined });
    expect(node(doc).repeat).toBeUndefined();
    doc.undo();
    expect(node(doc).repeat!.item).toBe('record');
    expect(doc.setNodeLogic('page', 'target', {})).toBe(false);
  });
  it('protects same-name providers in props/styles/conditions/events and effective index roles', () => {
    const consumers = [
      box('child', { props: { value: expr('scope.row.id') } }),
      box('child', { style: { color: expr('scope.row.color') } }),
      box('child', { when: expr('scope.row.visible') }),
      box('child', {
        on: {
          onClick: [
            {
              id: 'call',
              action: 'state.set',
              input: { stateId: lit('text'), value: expr('scope.row.id') },
            },
          ],
        },
      }),
      box('child', { repeat: { ...loop('nested'), items: expr('scope.row.children') } }),
    ];
    for (const child of consumers) {
      const doc = make([
        box('outer', {
          repeat: loop(),
          children: [box('target', { repeat: loop(), children: [child] })],
        }),
      ]);
      for (const repeat of [undefined, loop('record')])
        expect(() => doc.setNodeLogic('page', 'target', { repeat })).toThrow(/scope.row/);
    }
    const doc = make([
      box('outer', {
        repeat: loop(),
        children: [box('target', { props: { value: expr('scope.row.id') } })],
      }),
    ]);
    expect(() => doc.setNodeLogic('page', 'target', { repeat: loop() })).toThrow(/scope.row/);
    const index = make([
      box('target', {
        repeat: loop(),
        children: [box('child', { props: { value: expr('scope.index') } })],
      }),
    ]);
    index.setNodeLogic('page', 'target', { repeat: loop('row', 'index') });
    expect(() => index.setNodeLogic('page', 'target', { repeat: loop('row', 'position') })).toThrow(
      /scope.index/,
    );
    expect(() => index.setNodeLogic('page', 'target', { repeat: loop('index', 'row') })).toThrow();
  });
  it('permits independent nested/slot shadowing but protects descendant items and wildcard environments', () => {
    const doc = make([
      box('target', {
        repeat: loop(),
        children: [box('nested', { repeat: loop(), props: { value: expr('scope.row.id') } })],
        slots: {
          body: {
            params: ['row'],
            children: [box('slot-child', { props: { value: expr('scope.row.id') } })],
          },
        },
      }),
    ]);
    doc.setNodeLogic('page', 'target', { repeat: loop('record') });
    expect(nodeLogicScopes(page(doc), 'slot-child').local).toContain('row');
    for (const source of ['scope[String("row")].id', 'String(scope)']) {
      const wildcard = make([box('target', { repeat: loop(), props: { value: expr(source) } })]);
      expect(() => wildcard.setNodeLogic('page', 'target', { repeat: loop('record') })).toThrow();
    }
    const slot = make([
      box('host', {
        slots: {
          body: {
            params: ['row'],
            children: [box('target', { props: { value: expr('scope.row.id') } })],
          },
        },
      }),
    ]);
    expect(() => slot.setNodeLogic('page', 'target', { repeat: loop() })).toThrow(/scope.row/);
  });
  it('rejects alias conflicts and preserves legacy bracket-access alias grammar', () => {
    const doc = make([box('target')]);
    for (const repeat of [loop('index'), loop('constructor'), loop('row', 'row')])
      expect(() => doc.setNodeLogic('page', 'target', { repeat })).toThrow();
    doc.setNodeLogic('page', 'target', { repeat: loop('row-data') });
    expect(node(doc).repeat!.item).toBe('row-data');
  });
});
