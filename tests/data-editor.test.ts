import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { createRegistry } from '../packages/runtime/registry';
import type { ApplicationSchema, DataSourceDefinition } from '../packages/schema/types';
const registry = createRegistry(
  { 'ui.button': { version: '1.0.0', props: {}, events: ['onClick'] } },
  {},
  {},
  {
    'test.query': {
      version: '1.0.0',
      input: { query: { type: 'string', required: true } },
      output: 'object',
      execute: () => ({}),
    },
    'test.identity': {
      version: '1.0.0',
      input: { payload: { type: 'json', required: true } },
      output: 'object',
      execute: () => ({}),
    },
  },
);
const schema: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'data-editor',
  title: 'data-editor',
  entryPageId: 'page',
  dependencies: {
    components: { 'ui.button': '1.0.0' },
    actions: { 'data.execute': '1.0.0', 'state.set': '1.0.0' },
  },
  pages: [
    {
      id: 'page',
      title: 'page',
      state: [
        { id: 'query', type: 'string', initial: '' },
        { id: 'result', type: 'object', initial: {} },
      ],
      children: [],
    },
  ],
};
const source: DataSourceDefinition = {
  id: 'people',
  kind: 'query',
  transport: 'test.query',
  input: { query: { kind: 'stateRef', stateId: 'query' } },
  initial: {},
};
describe('atomic data authoring commands', () => {
  it('adds sources and dependencies together, preserves IDs, and supports single undo/redo edits', () => {
    const doc = new EditorDocument(schema, registry);
    const before = doc.getSnapshot().plan.schema;
    doc.createDataSource('page', source);
    expect(doc.getSnapshot().plan.schema.dependencies.transports).toEqual({
      'test.query': '1.0.0',
    });
    doc.undo();
    expect(doc.getSnapshot().plan.schema).toEqual(before);
    doc.redo();
    doc.updateDataSource('page', 'people', { ...source, kind: 'mutation' });
    expect(doc.getSnapshot().plan.pages.get('page')!.schema.dataSources![0]).toMatchObject({
      id: 'people',
      kind: 'mutation',
    });
    doc.undo();
    expect(doc.getSnapshot().plan.pages.get('page')!.schema.dataSources![0].kind).toBe('query');
    const snapshot = doc.getSnapshot();
    expect(() => doc.createDataSource('page', { ...source, id: 'invalid', input: {} })).toThrow(
      '缺少参数',
    );
    expect(doc.getSnapshot()).toBe(snapshot);
    expect(doc.getSnapshot().canRedo).toBe(true);
  });
  it('protects source inputs and state/action references from deletion', () => {
    const doc = new EditorDocument(schema, registry);
    doc.createDataSource('page', source);
    expect(() => doc.removeState('page', 'query')).toThrow('数据源 people/input/query');
    doc.createDataSource('page', {
      id: 'derived',
      kind: 'query',
      transport: 'test.identity',
      input: { payload: { kind: 'dataRef', sourceId: 'people' } },
      initial: {},
    });
    expect(() => doc.removeDataSource('page', 'people')).toThrow('数据源 derived/input/payload');
    doc.removeDataSource('page', 'derived');
    doc.removeDataSource('page', 'people');
    doc.removeState('page', 'query');
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('page')!
        .schema.state.map((state) => state.id),
    ).toEqual(['result']);
  });
  it('conservatively protects dynamic action targets and result destinations', () => {
    const dynamic = structuredClone(schema);
    dynamic.pages[0].children = [
      {
        id: 'button',
        component: 'ui.button',
        props: {},
        on: {
          onClick: [
            {
              id: 'dynamic-set',
              action: 'state.set',
              input: {
                stateId: { kind: 'expression', language: 'javascript', source: 'event' },
                value: { kind: 'literal', value: 'value' },
              },
            },
          ],
        },
      },
    ];
    const stateDoc = new EditorDocument(dynamic, registry);
    expect(() => stateDoc.removeState('page', 'result')).toThrow('动态目标');
    const sourceDoc = new EditorDocument(schema, registry);
    sourceDoc.createDataSource('page', source);
    const withActions = structuredClone(sourceDoc.getSnapshot().plan.schema);
    withActions.pages[0].children = [
      {
        id: 'button',
        component: 'ui.button',
        props: {},
        on: {
          onClick: [
            {
              id: 'dynamic-source',
              action: 'data.execute',
              input: { sourceId: { kind: 'expression', language: 'javascript', source: 'event' } },
              resultTo: 'result',
            },
          ],
        },
      },
    ];
    sourceDoc.replace(withActions);
    expect(() => sourceDoc.removeDataSource('page', 'people')).toThrow('动态目标');
    expect(() => sourceDoc.removeState('page', 'result')).toThrow('resultTo');
  });
  it('creates and updates page states atomically, rejecting incompatible source bindings', () => {
    const doc = new EditorDocument(schema, registry);
    doc.createState('page', { id: 'extra', type: 'number', initial: 1 });
    doc.updateState('page', 'extra', { type: 'number', initial: 2 });
    doc.undo();
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('page')!
        .schema.state.find((state) => state.id === 'extra')!.initial,
    ).toBe(1);
    doc.createDataSource('page', source);
    const before = doc.getSnapshot();
    expect(() => doc.updateState('page', 'query', { type: 'number', initial: 1 })).toThrow('类型');
    expect(doc.getSnapshot()).toBe(before);
  });
});
