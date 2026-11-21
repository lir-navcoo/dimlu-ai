import { describe, expect, it, vi } from 'vitest';
import { DataSourceRuntime } from '../packages/runtime/data-source';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { createRegistry, type TransportContract } from '../packages/runtime/registry';
import type { ApplicationSchema, DataSourceDefinition, Json } from '../packages/schema/types';
const definition: DataSourceDefinition = {
  id: 'people',
  kind: 'query',
  transport: 'api.people',
  input: { query: { kind: 'stateRef', stateId: 'query' } },
  initial: [],
};
const deferred = () => {
  let resolve!: (v: Json) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<Json>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const context = () => ({ state: { query: '初始' }, scope: {} });
function fixture(transport: TransportContract, kind: DataSourceDefinition['kind'] = 'query') {
  const registry = createRegistry({}, {}, {}, { 'api.people': transport });
  const schema: ApplicationSchema = {
    schemaVersion: '0.1.0',
    id: 'sources',
    title: 'sources',
    entryPageId: 'page',
    dependencies: {
      components: {},
      actions: { 'data.execute': '1.0.0', 'state.set': '1.0.0' },
      transports: { 'api.people': '1.0.0' },
    },
    pages: [
      {
        id: 'page',
        title: 'page',
        state: [
          { id: 'query', type: 'string', initial: '初始' },
          { id: 'result', type: 'array', initial: [] },
          { id: 'done', type: 'boolean', initial: false },
        ],
        dataSources: [{ ...definition, kind }],
        children: [],
        onEnter: [
          {
            id: 'enter-query',
            action: 'data.execute',
            input: { sourceId: { kind: 'literal', value: 'people' } },
          },
        ],
      },
    ],
  };
  return { registry, schema, plan: compileApplication(schema, registry) };
}
describe('data source execution', () => {
  it('evaluates defaults at execution, overrides by key and validates before requesting', async () => {
    const execute = vi.fn(async (input: Record<string, Json>) => [input.query]);
    const source = new DataSourceRuntime(
      definition,
      {
        version: '1.0.0',
        input: { query: { type: 'string', required: true } },
        output: 'array',
        execute,
      },
      context,
    );
    expect(execute).not.toHaveBeenCalled();
    expect(source.getSnapshot()).toEqual({ data: [], status: 'idle', loading: false, error: null });
    await expect(source.execute({ query: 12 })).rejects.toThrow('query');
    await expect(source.execute({ extra: 'x' })).rejects.toThrow('extra');
    expect(execute).not.toHaveBeenCalled();
    expect(await source.execute({ query: '覆盖' })).toEqual(['覆盖']);
    expect(await source.refresh()).toEqual(['初始']);
    expect(Object.isFrozen(source.getSnapshot().data)).toBe(true);
    source.dispose();
  });
  it('supersedes a query across action lanes and stops the superseded action chain', async () => {
    const first = deferred(),
      second = deferred();
    let calls = 0;
    const { plan } = fixture({
      version: '1.0.0',
      input: { query: { type: 'string', required: true } },
      output: 'array',
      execute: () => (++calls === 1 ? first.promise : second.promise),
    });
    const rt = new PageRuntime(plan, 'page');
    const query = rt.page.onEnter[0];
    const setSchema = {
      id: 'mark-done',
      action: 'state.set',
      input: {
        stateId: { kind: 'literal' as const, value: 'done' },
        value: { kind: 'literal' as const, value: true },
      },
    };
    const setPlan = compileApplication(
      { ...plan.schema, pages: [{ ...plan.schema.pages[0], onEnter: [setSchema] }] },
      plan.registry,
    ).pages.get('page')!.onEnter[0];
    const old = rt.run([query, setPlan], {}, undefined, 'lane-a');
    const current = rt.run([query], {}, undefined, 'lane-b');
    expect(await old).toBe(false);
    expect(rt.getRecords().filter((record) => record.kind === 'action.error')).toEqual([]);
    expect(rt.getState().done).toBe(false);
    second.resolve(['新结果']);
    expect(await current).toBe(true);
    first.resolve(['过期结果']);
    await Promise.resolve();
    expect(rt.getDataSource('people').getSnapshot().data).toEqual(['新结果']);
    expect(rt.getPending()).toBe(0);
    rt.dispose();
  });
  it('rejects concurrent mutations without aborting the first and normalizes failures', async () => {
    const request = deferred();
    const execute = vi.fn<TransportContract['execute']>(() => request.promise);
    const source = new DataSourceRuntime(
      { ...definition, kind: 'mutation' },
      {
        version: '1.0.0',
        input: { query: { type: 'string', required: true } },
        output: 'array',
        execute,
      },
      context,
    );
    const pending = source.execute();
    await expect(source.execute()).rejects.toThrow('busy');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][1].signal.aborted).toBe(false);
    request.reject(new Error('服务错误'));
    await expect(pending).rejects.toThrow('服务错误');
    expect(source.getSnapshot()).toEqual({
      data: [],
      status: 'error',
      loading: false,
      error: { name: 'Error', message: '服务错误' },
    });
    source.dispose();
  });
  it('guards design mode at the source entry and cancels late publication while preserving page identity', async () => {
    const request = deferred();
    const execute = vi.fn(() => request.promise);
    const { plan } = fixture({
      version: '1.0.0',
      input: { query: { type: 'string', required: true } },
      output: 'array',
      execute,
    });
    const rt = new PageRuntime(plan, 'page', { designMode: true });
    await rt.enter();
    await expect(rt.getDataSource('people').execute()).rejects.toThrow('编辑模式');
    rt.getDataSource('people').setEnabled(true);
    await expect(rt.getDataSource('people').execute()).rejects.toThrow('编辑模式');
    expect(execute).not.toHaveBeenCalled();
    const identity = rt.instanceId;
    rt.setDesignMode(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(rt.getPending()).toBeGreaterThan(0);
    rt.setDesignMode(true);
    request.resolve(['迟到']);
    await Promise.resolve();
    await Promise.resolve();
    expect(rt.instanceId).toBe(identity);
    expect(rt.getDataSource('people').getSnapshot()).toEqual({
      data: [],
      status: 'idle',
      loading: false,
      error: null,
    });
    rt.dispose();
  });
  it('isolates page stores and precisely notifies source dependencies for direct requests', async () => {
    const { plan } = fixture({
      version: '1.0.0',
      input: { query: { type: 'string', required: true } },
      output: 'array',
      execute: async () => ['本页'],
    });
    const a = new PageRuntime(plan, 'page'),
      b = new PageRuntime(plan, 'page');
    const source = vi.fn(),
      state = vi.fn();
    a.subscribeState(['@source:people'], source);
    a.subscribeState(['query'], state);
    const pending = a.getDataSource('people').execute();
    expect(a.getPending()).toBe(1);
    await pending;
    expect(a.getPending()).toBe(0);
    expect(source).toHaveBeenCalledTimes(2);
    expect(state).not.toHaveBeenCalled();
    expect(b.getDataSource('people').getSnapshot().data).toEqual([]);
    a.dispose();
    b.dispose();
  });
});
