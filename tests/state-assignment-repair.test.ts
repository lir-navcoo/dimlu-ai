import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { createRegistry } from '../packages/runtime/registry';
import type { ApplicationSchema, Value } from '../packages/schema/types';
const registry = createRegistry(
  { button: { version: '1.0.0', props: {}, events: ['onClick'] } },
  {},
  {},
  {
    'test.string': { version: '1.0.0', input: {}, output: 'string', execute: () => '' },
    'test.number': { version: '1.0.0', input: {}, output: 'number', execute: () => 0 },
    'test.object': { version: '1.0.0', input: {}, output: 'object', execute: () => ({}) },
  },
);
function fixture(value: Value, targetType: 'string' | 'object' = 'string'): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'assign',
    title: 'assign',
    entryPageId: 'page',
    dependencies: {
      components: { button: '1.0.0' },
      actions: { 'state.set': '1.0.0' },
      transports: { 'test.string': '1.0.0' },
    },
    pages: [
      {
        id: 'page',
        title: 'page',
        state: [
          { id: 'source', type: 'string', initial: 'value' },
          { id: 'target', type: targetType, initial: targetType === 'string' ? '' : {} },
        ],
        forms: [
          {
            id: 'edit',
            fields: [{ id: 'name', path: ['name'], label: 'name', type: 'string', initial: '' }],
          },
        ],
        dataSources: [
          { id: 'remote', kind: 'query', transport: 'test.string', input: {}, initial: '' },
        ],
        children: [
          {
            id: 'button',
            component: 'button',
            props: {},
            on: {
              onClick: [
                {
                  id: 'assign',
                  action: 'state.set',
                  input: { stateId: { kind: 'literal', value: 'target' }, value },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
describe('state assignment reference typing', () => {
  it.each<Value>([
    { kind: 'stateRef', stateId: 'source' },
    { kind: 'fieldRef', formId: 'edit', fieldId: 'name' },
    { kind: 'dataRef', sourceId: 'remote' },
  ])('rejects changing a target used by known typed reference %j', (value) => {
    const doc = new EditorDocument(fixture(value), registry);
    const before = doc.getSnapshot();
    expect(() => doc.updateState('page', 'target', { type: 'number', initial: 0 })).toThrow('类型');
    expect(doc.getSnapshot()).toBe(before);
  });
  it('protects source state types and formValues assignments', () => {
    const doc = new EditorDocument(fixture({ kind: 'stateRef', stateId: 'source' }), registry);
    expect(() => doc.updateState('page', 'source', { type: 'number', initial: 0 })).toThrow('类型');
    const formDoc = new EditorDocument(
      fixture({ kind: 'formValues', formId: 'edit' }, 'object'),
      registry,
    );
    expect(() => formDoc.updateState('page', 'target', { type: 'number', initial: 0 })).toThrow(
      '类型',
    );
  });
  it('rejects a source transport output change that breaks state assignments', () => {
    const doc = new EditorDocument(fixture({ kind: 'dataRef', sourceId: 'remote' }), registry);
    const before = doc.getSnapshot();
    expect(() =>
      doc.updateDataSource('page', 'remote', {
        kind: 'query',
        transport: 'test.number',
        input: {},
        initial: 0,
      }),
    ).toThrow('类型');
    expect(doc.getSnapshot()).toBe(before);
  });
  it('leaves nested data paths to runtime validation', () => {
    const schema = fixture({ kind: 'dataRef', sourceId: 'remote', path: ['first.name'] });
    schema.dependencies.transports = { 'test.object': '1.0.0' };
    schema.pages[0].dataSources![0] = {
      id: 'remote',
      kind: 'query',
      transport: 'test.object',
      input: {},
      initial: { 'first.name': 'text' },
    };
    const doc = new EditorDocument(schema, registry);
    expect(() => doc.updateState('page', 'target', { type: 'number', initial: 0 })).not.toThrow();
  });
});
