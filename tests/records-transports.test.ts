import { describe, expect, it } from 'vitest';
import { createRecordsTransports } from '../src/records-transports';
import type { Json } from '../packages/schema/types';
const ctx = () => ({ signal: new AbortController().signal });
const input = (patch: Record<string, Json> = {}) => ({
  query: '',
  page: 1,
  pageSize: 5,
  sortKey: '',
  sortDirection: '',
  ...patch,
});
describe('mock server record transports', () => {
  it('filters/sorts/pages on the service and returns the actual normalized page after shrinking results', async () => {
    const transport = createRecordsTransports({
      delayMs: 0,
      rows: [
        { id: '1', name: '甲', department: '研发', amount: 30 },
        { id: '2', name: '乙', department: '研发', amount: 10 },
        { id: '3', name: '丙', department: '产品', amount: 20 },
      ],
    });
    const query = transport['demo.recordsQuery'];
    const sorted = await query.execute(
      input({ sortKey: 'amount', sortDirection: 'asc', pageSize: 1, page: 2 }),
      ctx(),
    );
    expect(sorted).toMatchObject({
      items: [{ id: '3' }],
      total: 3,
      page: 2,
      pageSize: 1,
      sort: { key: 'amount', direction: 'asc' },
    });
    await transport['demo.recordSave'].execute(
      { id: '2', values: { name: '乙', department: '产品', amount: 10 } },
      ctx(),
    );
    const shrunk = await query.execute(input({ query: '研发', page: 2, pageSize: 1 }), ctx());
    expect(shrunk).toMatchObject({ items: [{ id: '1' }], total: 1, page: 1, pageSize: 1 });
  });
  it('isolates service factories and distinguishes save errors from one-time refresh errors', async () => {
    const rows = [{ id: '1', name: '成员', department: '研发', amount: 1 }];
    const a = createRecordsTransports({ rows, delayMs: 0 }),
      b = createRecordsTransports({ rows, delayMs: 0 });
    await expect(
      a['demo.recordSave'].execute(
        { id: '1', values: { name: '保存失败', department: '研发', amount: 1 } },
        ctx(),
      ),
    ).rejects.toThrow('保存失败');
    await a['demo.recordSave'].execute(
      { id: '1', values: { name: '刷新失败', department: '研发', amount: 1 } },
      ctx(),
    );
    await expect(a['demo.recordsQuery'].execute(input(), ctx())).rejects.toThrow('刷新失败');
    expect(await a['demo.recordsQuery'].execute(input(), ctx())).toMatchObject({
      items: [{ name: '刷新失败' }],
    });
    expect(await b['demo.recordsQuery'].execute(input(), ctx())).toMatchObject({
      items: [{ name: '成员' }],
    });
  });
});
