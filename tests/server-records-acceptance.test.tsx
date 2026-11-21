import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import { createRecordsTransports, type RecordEntry } from '../src/records-transports';
import { serverRecordsExample } from '../src/server-records-example';
import { TipProvider } from '../src/ui/primitives';
import type { ApplicationSchema, Json } from '../packages/schema/types';
import { changeControl } from './ui-helpers';

const runtimes: PageRuntime[] = [];
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
});
const queryInput = (patch: Record<string, Json> = {}) => ({
  query: '',
  page: 1,
  pageSize: 5,
  sortKey: '',
  sortDirection: '',
  ...patch,
});
const context = () => ({ signal: new AbortController().signal });
async function mount(options: { rows?: RecordEntry[]; schema?: ApplicationSchema } = {}) {
  const transports = createRecordsTransports({ rows: options.rows, delayMs: 0 });
  const query = vi.spyOn(transports['demo.recordsQuery'], 'execute');
  const save = vi.spyOn(transports['demo.recordSave'], 'execute');
  const runtime = new PageRuntime(
    compileApplication(options.schema ?? serverRecordsExample, {
      ...registry,
      transports: { ...registry.transports, ...transports },
    }),
    'records',
  );
  runtimes.push(runtime);
  const effects = vi.fn();
  runtime.subscribeEffects(effects);
  render(
    <TipProvider>
      <RuntimeRenderer runtime={runtime} materials={materials} />
    </TipProvider>,
  );
  await act(async () => {
    await runtime.enter();
  });
  return { runtime, query, save, effects };
}
const names = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
async function openFirst() {
  fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
  return screen.findByRole('dialog', { name: '编辑服务端记录' });
}
async function closed() {
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑服务端记录' })).toBeNull());
}

describe('independent N4 server records acceptance', () => {
  it('normalizes the last filtered page after save and refreshes exactly once', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: String(index + 1),
      name: `研发成员${index + 1}`,
      department: '保留部门',
      amount: index,
    }));
    const schema = structuredClone(serverRecordsExample);
    schema.pages[0].state!.find((state) => state.id === 'query')!.initial = '保留部门';
    schema.pages[0].state!.find((state) => state.id === 'page')!.initial = 2;
    const { runtime, query, save, effects } = await mount({ rows, schema });
    expect(names()).toEqual(['研发成员6']);
    expect(screen.getByText('2 / 2 页')).toBeTruthy();
    await openFirst();
    changeControl(screen.getByRole('textbox', { name: '部门' }), '其他部门');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await closed();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toMatchObject({ query: '保留部门', page: 2, pageSize: 5 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(runtime.getState()).toMatchObject({ page: 1, pageSize: 5 });
    expect(names()).toEqual(['研发成员1', '研发成员2', '研发成员3', '研发成员4', '研发成员5']);
    expect(screen.getByText('1 / 1 页')).toBeTruthy();
    expect((screen.getByRole('button', { name: '下一页' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(effects).toHaveBeenCalledTimes(1);
  });

  it('sorts the whole service dataset through asc, desc, and clear and resets page', async () => {
    const { query, runtime } = await mount();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(names()[0]).toBe('成员06'));
    fireEvent.click(screen.getByRole('button', { name: '排序金额' }));
    await waitFor(() => expect(names()[0]).toBe('成员01'));
    expect(runtime.getState()).toMatchObject({ page: 1, sortKey: 'amount', sortDirection: 'asc' });
    fireEvent.click(screen.getByRole('button', { name: '排序金额' }));
    await waitFor(() =>
      expect(names()).toEqual(['成员23', '成员22', '成员21', '成员20', '成员19']),
    );
    fireEvent.click(screen.getByRole('button', { name: '排序金额' }));
    await waitFor(() => expect(names()[0]).toBe('成员01'));
    expect(runtime.getState()).toMatchObject({ page: 1, sortKey: '', sortDirection: '' });
    expect(query).toHaveBeenCalledTimes(5);
  });

  it('keeps successful data during a query error and retries using the current explicit input', async () => {
    const { query, runtime, save, effects } = await mount();
    const original = runtime.getDataSource('records').getSnapshot().data;
    changeControl(screen.getByRole('textbox', { name: '搜索姓名或部门' }), '查询失败');
    expect(query).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByText('模拟查询失败，请修改条件后重试');
    expect(runtime.getDataSource('records').getSnapshot().data).toEqual(original);
    expect(screen.queryByRole('table')).toBeNull();
    changeControl(screen.getByRole('textbox', { name: '搜索姓名或部门' }), '产品设计部');
    expect(query).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('共 8 条记录');
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toMatchObject({ query: '产品设计部', page: 1 });
    expect(names()).toEqual(['成员02', '成员05', '成员08', '成员11', '成员14']);
    expect(save).not.toHaveBeenCalled();
    expect(effects).not.toHaveBeenCalled();
  });

  it('cancels an unsaved edit and resets values and errors when a different row opens', async () => {
    const { query, save, runtime } = await mount();
    await openFirst();
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '保存失败草稿');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await screen.findByText('模拟保存失败，输入已保留');
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑服务端记录' }));
    await closed();
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1]);
    await screen.findByRole('dialog', { name: '编辑服务端记录' });
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).value).toBe(
      '成员02',
    );
    expect(screen.queryByText('模拟保存失败，输入已保留')).toBeNull();
    expect(runtime.getState()).toMatchObject({ selectedId: 'record-2', saveCommitted: false });
    fireEvent.click(screen.getByRole('button', { name: '关闭编辑服务端记录' }));
    await closed();
    expect(query).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(names()[0]).toBe('成员01');
  });

  it('locks committed fields after refresh failure and unlocks only a new editing session', async () => {
    const { save, query, runtime } = await mount();
    await openFirst();
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '刷新失败验收');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await screen.findByText('保存已完成，仅列表刷新失败');
    for (const label of ['姓名', '部门'])
      expect((screen.getByRole('textbox', { name: label }) as HTMLInputElement).disabled).toBe(
        true,
      );
    expect((screen.getByRole('spinbutton', { name: '金额' }) as HTMLInputElement).disabled).toBe(
      true,
    );
    const form = screen.getByRole('button', { name: '保存记录' }).closest('form')!;
    await act(async () => {
      fireEvent.submit(form);
    });
    await waitFor(() =>
      expect(runtime.getForm('edit').getSnapshot().submitError).toContain('保存已完成'),
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '仅重试刷新' }));
    await closed();
    expect(save).toHaveBeenCalledTimes(1);
    await openFirst();
    expect(runtime.getState().saveCommitted).toBe(false);
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).disabled).toBe(
      false,
    );
  });

  it('aborts query and save without mutating the dataset or caller-owned seed rows', async () => {
    const rows = [{ id: 'one', name: '原值', department: '研发', amount: 1 }];
    const transports = createRecordsTransports({ rows, delayMs: 10 });
    rows[0].name = '外部改动';
    const controller = new AbortController();
    const save = transports['demo.recordSave'].execute(
      {
        id: 'one',
        values: { name: '不应提交', department: '研发', amount: 2 },
      },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(save).rejects.toMatchObject({ name: 'AbortError' });
    const queryAbort = new AbortController();
    queryAbort.abort();
    await expect(
      transports['demo.recordsQuery'].execute(queryInput(), { signal: queryAbort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const result = await transports['demo.recordsQuery'].execute(queryInput(), context());
    expect(result).toMatchObject({ items: [{ name: '原值', amount: 1 }] });
    expect(rows[0]).toMatchObject({ name: '外部改动', amount: 1 });
  });

  it('keeps deterministic tie order across pages and rejects invalid saves atomically', async () => {
    const transports = createRecordsTransports({
      rows: [
        { id: 'c', name: '相同', department: '研发', amount: 1 },
        { id: 'a', name: '相同', department: '研发', amount: 1 },
        { id: 'b', name: '相同', department: '研发', amount: 1 },
      ],
      delayMs: 0,
    });
    for (const direction of ['asc', 'desc']) {
      const result = await transports['demo.recordsQuery'].execute(
        queryInput({
          sortKey: 'amount',
          sortDirection: direction,
          page: 2,
          pageSize: 1,
        }),
        context(),
      );
      expect(result).toMatchObject({ items: [{ id: 'b' }], total: 3, page: 2 });
    }
    await expect(
      transports['demo.recordSave'].execute(
        {
          id: 'b',
          values: { name: '已改变', department: '研发', amount: -1 },
        },
        context(),
      ),
    ).rejects.toMatchObject({ fieldErrors: { amount: '金额必须为非负数' } });
    expect(await transports['demo.recordsQuery'].execute(queryInput(), context())).toMatchObject({
      items: [
        { id: 'c', name: '相同' },
        { id: 'a', name: '相同' },
        { id: 'b', name: '相同' },
      ],
    });
  });
});
