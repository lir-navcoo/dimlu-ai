import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateApplication } from '../packages/schema/validate';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { EditorDocument } from '../packages/editor/document';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { createPurchaseTransports } from '../src/purchase-transports';
import { registry } from '../src/materials';
import type { ApplicationSchema, DataSourceDefinition, Json } from '../packages/schema/types';

afterEach(() => vi.restoreAllMocks());

const sharedQuery = {
  id: 'shared.purchases',
  kind: 'query',
  transport: 'demo.purchasesQuery',
  input: {
    query: { kind: 'literal', value: '' },
    page: { kind: 'literal', value: 1 },
    pageSize: { kind: 'literal', value: 5 },
    sortKey: { kind: 'literal', value: '' },
    sortDirection: { kind: 'literal', value: '' },
  },
  initial: { items: [], total: 0, page: 1, pageSize: 5, sort: null },
};

function appWith(shared: unknown[], pageSources: unknown[]): ApplicationSchema {
  const schema = structuredClone(purchaseManagementExample);
  schema.sharedDataSources = shared as ApplicationSchema['sharedDataSources'];
  (schema.pages[0].dataSources ??= []).push(
    ...(pageSources as NonNullable<ApplicationSchema['pages'][number]['dataSources']>),
  );
  return schema;
}

function transportsWithSpy() {
  const transports = { ...registry.transports, ...createPurchaseTransports({ delayMs: 0 }) };
  return { transports, spy: vi.spyOn(transports['demo.purchasesQuery'], 'execute') };
}

describe('shared application data sources', () => {
  it('validates a page ref against the shared definition', () => {
    const schema = appWith([sharedQuery], [
      {
        id: 'sharedView',
        ref: 'shared.purchases',
        input: { query: { kind: 'stateRef', stateId: 'query' } },
      },
    ]);
    expect(validateApplication(schema, { ...registry, ...transportsWithSpy().transports })).toEqual(
      [],
    );
  });
  it('rejects refs to missing shared sources', () => {
    const schema = appWith([], [{ id: 'sharedView', ref: 'shared.purchases', input: {} }]);
    const issues = validateApplication(schema, { ...registry, ...transportsWithSpy().transports });
    expect(issues.some((issue) => issue.code === 'source.ref')).toBe(true);
  });
  it('rejects ref definitions that also declare transport or initial', () => {
    const schema = appWith([sharedQuery], [
      {
        id: 'sharedView',
        ref: 'shared.purchases',
        transport: 'demo.purchasesQuery',
        kind: 'query',
        input: {},
        initial: null,
      },
    ]);
    expect(validateApplication(schema, { ...registry, ...transportsWithSpy().transports })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'shape.oneOf' })]),
    );
  });
  it('rejects duplicate shared source ids and undeclared transport dependencies', () => {
    const schema = appWith([sharedQuery, { ...sharedQuery }], []);
    const issues = validateApplication(schema, { ...registry, ...transportsWithSpy().transports });
    expect(issues.some((issue) => issue.code === 'source.id')).toBe(true);
    const undeclared = appWith([sharedQuery], []);
    delete undeclared.dependencies.transports!['demo.purchasesQuery'];
    expect(
      validateApplication(undeclared, { ...registry, ...transportsWithSpy().transports }).some(
        (issue) => issue.code === 'dependency.undeclared',
      ),
    ).toBe(true);
  });

  it('resolves the ref at runtime with page input overriding shared values', async () => {
    const schema = appWith([sharedQuery], [
      {
        id: 'sharedView',
        ref: 'shared.purchases',
        input: { query: { kind: 'stateRef', stateId: 'query' } },
      },
    ]);
    // 采购页已有 query 状态：覆盖其初始值即可验证页面覆盖。
    schema.pages[0].state.find((state) => state.id === 'query')!.initial = '办公设备';
    const { transports, spy } = transportsWithSpy();
    const plan = compileApplication(schema, { ...registry, transports });
    const runtime = new PageRuntime(plan, schema.pages[0].id);
    try {
      await runtime.enter();
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      const input = spy.mock.calls.at(-1)![0] as Record<string, Json>;
      expect(input.query).toBe('办公设备');
      expect(input.page).toBe(1);
      expect(input.pageSize).toBe(5);
    } finally {
      runtime.dispose();
    }
  });

  it('keeps the plan schema carrying the ref so the editor can round-trip it', () => {
    const schema = appWith([sharedQuery], [
      { id: 'sharedView', ref: 'shared.purchases', input: {} },
    ]);
    const { transports } = transportsWithSpy();
    const plan = compileApplication(schema, { ...registry, transports });
    expect(
      plan.pages.get(schema.pages[0].id)!.schema.dataSources?.find((item) => item.id === 'sharedView'),
    ).toMatchObject({ id: 'sharedView', ref: 'shared.purchases' });
    expect(plan.schema.sharedDataSources?.[0]).toMatchObject({ id: 'shared.purchases' });
  });
});

describe('shared source document commands', () => {
  it('creates, updates and protects shared sources through the document', () => {
    const doc = new EditorDocument(appWith([], []), registry);
    expect(() =>
      doc.createDataSource('purchases', {
        id: 'sharedView',
        ref: 'shared.purchases',
        input: {},
      } as DataSourceDefinition),
    ).toThrow('引用的共享数据源不存在');
    doc.createSharedDataSource(sharedQuery as unknown as DataSourceDefinition);
    doc.createDataSource('purchases', {
      id: 'sharedView',
      ref: 'shared.purchases',
      input: { query: { kind: 'literal', value: '覆盖' } },
    } as unknown as DataSourceDefinition);
    expect(() => doc.createSharedDataSource({ ...sharedQuery } as unknown as DataSourceDefinition)).toThrow(
      '共享数据源 ID 已存在',
    );
    expect(() => doc.removeSharedDataSource('shared.purchases')).toThrow('仍被页面引用');
    doc.updateSharedDataSource('shared.purchases', {
      kind: 'query',
      transport: 'demo.purchasesQuery',
      input: {
        query: { kind: 'literal', value: '' },
        page: { kind: 'literal', value: 1 },
        pageSize: { kind: 'literal', value: 10 },
        sortKey: { kind: 'literal', value: '' },
        sortDirection: { kind: 'literal', value: '' },
      },
      initial: sharedQuery.initial,
    } as Omit<DataSourceDefinition, 'id'>);
    const schema = doc.getSnapshot().plan.schema;
    expect(schema.sharedDataSources?.[0].input.pageSize).toEqual({ kind: 'literal', value: 10 });
    doc.removeDataSource('purchases', 'sharedView');
    doc.removeSharedDataSource('shared.purchases');
    expect(doc.getSnapshot().plan.schema.sharedDataSources).toEqual([]);
  });
});
