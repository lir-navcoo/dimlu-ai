import { describe, expect, it } from 'vitest';
import { createPurchaseTransports } from '../src/purchase-transports';
const context = () => ({ signal: new AbortController().signal });
const queryInput = (patch = {}) => ({
  query: '',
  page: 1,
  pageSize: 5,
  sortKey: '',
  sortDirection: '',
  ...patch,
});
const values = (patch = {}) => ({
  name: '办公用品采购',
  applicant: '林知远',
  department: '研发中心',
  purchaseDate: '2026-11-08',
  approvalReason: '',
  items: [{ name: '办公纸', quantity: 2, price: 12.35 }],
  ...patch,
});

describe('purchase mock service', () => {
  it('filters, sorts, normalizes pages and isolates service factories', async () => {
    const a = createPurchaseTransports({ delayMs: 0 }),
      b = createPurchaseTransports({ delayMs: 0 });
    const result = (await a['demo.purchasesQuery'].execute(
      queryInput({
        page: 99,
        query: '研发中心',
        pageSize: 2,
        sortKey: 'amount',
        sortDirection: 'desc',
      }),
      context(),
    )) as any;
    expect(result).toMatchObject({
      total: 4,
      page: 2,
      pageSize: 2,
      sort: { key: 'amount', direction: 'desc' },
    });
    expect(result.items[0].amount).toBeGreaterThanOrEqual(result.items[1].amount);
    const saved = (await a['demo.purchaseSave'].execute(
      { id: '', values: values({ name: '隔离申请' }) },
      context(),
    )) as any;
    expect(saved.id).toBeTruthy();
    expect(
      await a['demo.purchasesQuery'].execute(queryInput({ query: '隔离申请' }), context()),
    ).toMatchObject({ total: 1 });
    expect(
      await b['demo.purchasesQuery'].execute(queryInput({ query: '隔离申请' }), context()),
    ).toMatchObject({ total: 0 });
  });
  it('creates stable IDs, updates only known IDs and recomputes the amount rather than trusting totals', async () => {
    const transports = createPurchaseTransports({ delayMs: 0 });
    const created = (await transports['demo.purchaseSave'].execute(
      { id: '', values: values({ amount: 999999 }) },
      context(),
    )) as any;
    expect(created.amount).toBe(24.7);
    const edited = (await transports['demo.purchaseSave'].execute(
      {
        id: created.id,
        values: values({
          name: '已修改申请',
          items: [{ name: '免费样品', quantity: 3, price: 0 }],
        }),
      },
      context(),
    )) as any;
    expect(edited.id).toBe(created.id);
    expect(edited.amount).toBe(0);
    await expect(
      transports['demo.purchaseSave'].execute({ id: 'missing', values: values() }, context()),
    ).rejects.toThrow('申请不存在');
    expect(
      await transports['demo.purchasesQuery'].execute(
        queryInput({ query: '已修改申请' }),
        context(),
      ),
    ).toMatchObject({ total: 1, items: [{ id: created.id, amount: 0 }] });
  });
  it.each([
    [{ quantity: 0, price: 1 }, '数量'],
    [{ quantity: 1.5, price: 1 }, '数量'],
    [{ quantity: 1, price: -1 }, '单价'],
    [{ quantity: 1, price: 0.001 }, '单价'],
    [{ quantity: 1, price: 50001 }, '50,000'],
  ])('rejects invalid monetary and quantity domains without writing %#', async (row, message) => {
    const transports = createPurchaseTransports({ delayMs: 0 });
    await expect(
      transports['demo.purchaseSave'].execute(
        { id: '', values: values({ items: [{ name: '设备', ...row }] }) },
        context(),
      ),
    ).rejects.toThrow(message);
    expect(await transports['demo.purchasesQuery'].execute(queryInput(), context())).toMatchObject({
      total: 16,
    });
  });
  it('enforces required fields, dates, row limits and conditional approval', async () => {
    const transports = createPurchaseTransports({ delayMs: 0 });
    for (const patch of [
      { name: '' },
      { applicant: '' },
      { department: '' },
      { purchaseDate: '2026-02-30' },
      { items: [] },
      { items: Array.from({ length: 21 }, () => ({ name: '纸', quantity: 1, price: 1 })) },
      { items: [{ name: '设备', quantity: 1, price: 10001 }] },
    ])
      await expect(
        transports['demo.purchaseSave'].execute({ id: '', values: values(patch) }, context()),
      ).rejects.toThrow();
    expect(
      await transports['demo.purchaseSave'].execute(
        {
          id: '',
          values: values({
            approvalReason: '新增研发工位',
            items: [{ name: '设备', quantity: 1, price: 10001 }],
          }),
        },
        context(),
      ),
    ).toMatchObject({ amount: 10001 });
  });
  it('distinguishes failed saves from committed writes with failed refresh, and honors cancellation', async () => {
    const transports = createPurchaseTransports({ delayMs: 0 });
    await expect(
      transports['demo.purchaseSave'].execute(
        { id: '', values: values({ name: '保存失败' }) },
        context(),
      ),
    ).rejects.toThrow('保存失败');
    const controller = new AbortController();
    controller.abort();
    await expect(
      transports['demo.purchaseSave'].execute(
        { id: '', values: values() },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await transports['demo.purchasesQuery'].execute(queryInput(), context())).toMatchObject({
      total: 16,
    });
    const saved = (await transports['demo.purchaseSave'].execute(
      { id: '', values: values({ name: '刷新失败申请' }) },
      context(),
    )) as any;
    await expect(
      transports['demo.purchasesQuery'].execute(queryInput(), context()),
    ).rejects.toThrow('列表刷新失败');
    expect(
      await transports['demo.purchasesQuery'].execute(
        queryInput({ query: '刷新失败申请' }),
        context(),
      ),
    ).toMatchObject({ total: 1, items: [{ id: saved.id }] });
  });
});
