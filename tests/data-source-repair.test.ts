import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { createRegistry } from '../packages/runtime/registry';
import type { ApplicationSchema, Json } from '../packages/schema/types';
const fixture = (execute: () => Promise<Json>) => {
  const registry = createRegistry(
    {
      'ui.form': { version: '1.0.0', props: {}, form: true, children: true, events: ['onSubmit'] },
    },
    {},
    {},
    {
      'test.query': {
        version: '1.0.0',
        input: { query: { type: 'string', required: true } },
        output: 'array',
        execute,
      },
    },
  );
  const schema: ApplicationSchema = {
    schemaVersion: '0.1.0',
    id: 'repair',
    title: 'repair',
    entryPageId: 'page',
    dependencies: {
      components: { 'ui.form': '1.0.0' },
      actions: { 'data.execute': '1.0.0', 'form.submit': '1.0.0', 'state.set': '1.0.0' },
      transports: { 'test.query': '1.0.0' },
    },
    pages: [
      {
        id: 'page',
        title: 'page',
        state: [{ id: 'done', type: 'boolean', initial: false }],
        forms: [
          {
            id: 'record',
            fields: [
              { id: 'name', path: ['name'], label: 'name', type: 'string', initial: '' },
              { id: 'other', path: ['other'], label: 'other', type: 'string', initial: '' },
            ],
          },
        ],
        dataSources: [
          {
            id: 'query',
            kind: 'query',
            transport: 'test.query',
            input: {
              query: {
                kind: 'expression',
                language: 'javascript',
                source: 'forms.record.fields.name.value',
              },
            },
            initial: [],
          },
        ],
        children: [
          {
            id: 'form',
            component: 'ui.form',
            formId: 'record',
            props: {},
            on: {
              onSubmit: [
                {
                  id: 'submit-query',
                  action: 'data.execute',
                  input: { sourceId: { kind: 'literal', value: 'query' } },
                },
              ],
            },
          },
        ],
        onEnter: [
          {
            id: 'submit',
            action: 'form.submit',
            input: { formId: { kind: 'literal', value: 'record' } },
          },
          {
            id: 'mark-done',
            action: 'state.set',
            input: {
              stateId: { kind: 'literal', value: 'done' },
              value: { kind: 'literal', value: true },
            },
          },
        ],
      },
    ],
  };
  return { schema, registry };
};
describe('source boundary repairs', () => {
  it('protects source defaults when removing fields and form models', () => {
    const { schema, registry } = fixture(async () => []);
    schema.pages[0].children = [];
    schema.pages[0].onEnter = [];
    const doc = new EditorDocument(schema, registry);
    const before = doc.getSnapshot();
    expect(() => doc.removeField('page', 'record', 'name')).toThrow('数据源 query/input');
    expect(() => doc.removeForm('page', 'record')).toThrow('数据源 query/input');
    expect(doc.getSnapshot()).toBe(before);
  });
  it('preserves structured cancellation through form.submit without business errors', async () => {
    let resolveOld!: (value: Json) => void, resolveNew!: (value: Json) => void;
    let count = 0;
    const { schema, registry } = fixture(
      () =>
        new Promise((resolve) => {
          if (++count === 1) resolveOld = resolve;
          else resolveNew = resolve;
        }),
    );
    const rt = new PageRuntime(compileApplication(schema, registry), 'page');
    const old = rt.run(rt.page.onEnter, {}, undefined, 'submit-lane');
    const current = rt.getDataSource('query').execute();
    expect(await old).toBe(false);
    expect(rt.getState().done).toBe(false);
    expect(rt.getForm('record').getSnapshot().submitError).toBeUndefined();
    expect(rt.getForm('record').getSnapshot().isSubmitting).toBe(false);
    expect(rt.getRecords().filter((record) => record.kind === 'action.error')).toEqual([]);
    resolveNew(['current']);
    await current;
    resolveOld(['old']);
    await Promise.resolve();
    expect(rt.getDataSource('query').getSnapshot().data).toEqual(['current']);
    expect(rt.getPending()).toBe(0);
    rt.dispose();
  });
  it('still reports genuine service errors during form submission', async () => {
    const { schema, registry } = fixture(async () => {
      throw new Error('service failed');
    });
    const rt = new PageRuntime(compileApplication(schema, registry), 'page');
    expect(await rt.run(rt.page.onEnter, {}, undefined, 'submit-lane')).toBe(false);
    expect(rt.getForm('record').getSnapshot().submitError).toBe('service failed');
    expect(rt.getRecords().some((record) => record.kind === 'action.error')).toBe(true);
    expect(rt.getState().done).toBe(false);
    rt.dispose();
  });
});
