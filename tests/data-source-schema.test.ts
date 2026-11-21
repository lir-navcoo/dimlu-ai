import { describe, expect, it } from 'vitest';
import { createRegistry } from '../packages/runtime/registry';
import { compileApplication } from '../packages/runtime/engine';
import { compileValue } from '../packages/runtime/expression';
import { validateApplication } from '../packages/schema/validate';
import type { ApplicationSchema, Value } from '../packages/schema/types';
const registry = createRegistry(
  { 'ui.text': { version: '1.0.0', props: { value: { type: 'string', required: true } } } },
  {},
  {},
  {
    'api.people': {
      version: '1.0.0',
      input: { query: { type: 'string', required: true } },
      output: 'array',
      execute: async () => [],
    },
  },
);
const base: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'sources',
  title: 'sources',
  entryPageId: 'page',
  dependencies: {
    components: { 'ui.text': '1.0.0' },
    actions: { 'data.execute': '1.0.0' },
    transports: { 'api.people': '1.0.0' },
  },
  pages: [
    {
      id: 'page',
      title: 'page',
      state: [],
      dataSources: [
        {
          id: 'people',
          kind: 'query',
          transport: 'api.people',
          input: { query: { kind: 'literal', value: '' } },
          initial: [],
        },
      ],
      children: [],
    },
  ],
};
describe('data source schema contracts', () => {
  it('accepts backward-compatible documents and rejects source/transport identity and literal input/output errors', () => {
    expect(validateApplication(base, registry)).toEqual([]);
    const old = structuredClone(base);
    delete old.pages[0].dataSources;
    delete old.dependencies.transports;
    expect(validateApplication(old, registry)).toEqual([]);
    const unknown = structuredClone(base);
    unknown.pages[0].dataSources![0].transport = 'missing';
    expect(validateApplication(unknown, registry).some((e) => e.code === 'transport.missing')).toBe(
      true,
    );
    const version = structuredClone(base);
    version.dependencies.transports!['api.people'] = '2.0.0';
    expect(
      validateApplication(version, registry).some((e) => e.code === 'dependency.version'),
    ).toBe(true);
    const initial = structuredClone(base);
    initial.pages[0].dataSources![0].initial = {};
    expect(validateApplication(initial, registry).some((e) => e.code === 'source.type')).toBe(true);
    const invalid = structuredClone(base);
    invalid.pages[0].dataSources![0].input.query = { kind: 'literal', value: 12 };
    expect(validateApplication(invalid, registry).some((e) => e.code === 'source.type')).toBe(true);
  });
  it('forbids event/scope inputs and unreactive source reads inside form rules', () => {
    for (const source of ['event.target.value', 'scope.row.name']) {
      const schema = structuredClone(base);
      schema.pages[0].dataSources![0].input.query = {
        kind: 'expression',
        language: 'javascript',
        source,
      };
      expect(validateApplication(schema, registry).length).toBeGreaterThan(0);
    }
    const schema = structuredClone(base);
    schema.pages[0].forms = [
      {
        id: 'edit',
        fields: [
          {
            id: 'name',
            path: ['name'],
            label: 'name',
            type: 'string',
            initial: '',
            when: { kind: 'expression', language: 'javascript', source: 'sources.people.loading' },
          },
        ],
      },
    ];
    expect(validateApplication(schema, registry).some((e) => e.code === 'form.rule')).toBe(true);
  });
  it('checks known source references, direct binding types and action overrides before compilation', () => {
    const schema = structuredClone(base);
    schema.pages[0].children = [
      {
        id: 'text',
        component: 'ui.text',
        props: { value: { kind: 'dataRef', sourceId: 'people' } },
      },
    ];
    expect(validateApplication(schema, registry).some((e) => e.code === 'source.type')).toBe(true);
    schema.pages[0].children[0].props.value = { kind: 'dataRef', sourceId: 'unknown' };
    expect(validateApplication(schema, registry).some((e) => e.code === 'source.missing')).toBe(
      true,
    );
    schema.pages[0].children = [];
    schema.pages[0].onEnter = [
      {
        id: 'query',
        action: 'data.execute',
        input: {
          sourceId: { kind: 'literal', value: 'people' },
          input: { kind: 'literal', value: { query: 123 } },
        },
      },
    ];
    expect(() => compileApplication(schema, registry)).toThrow('query');
  });
  it('compiles precise snapshot dependencies and preserves dataRef paths', () => {
    const expression: Value = {
      kind: 'expression',
      language: 'javascript',
      source: 'sources.people.loading ? "加载中" : sources.people.status',
    };
    const compiled = compileValue(expression);
    expect(compiled.dependencies).toEqual(['@source:people']);
    expect(
      compiled.evaluate({
        state: {},
        scope: {},
        sources: { people: { loading: false, status: 'success' } },
      }),
    ).toBe('success');
    const ref = compileValue({ kind: 'dataRef', sourceId: 'people', path: ['first.name', ''] });
    expect(
      ref.evaluate({
        state: {},
        scope: {},
        sources: { people: { data: { 'first.name': { '': '原样' } } } },
      }),
    ).toBe('原样');
    expect(ref.dependencies).toEqual(['@source:people']);
  });
});
