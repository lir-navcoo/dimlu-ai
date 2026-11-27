import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PaginationMaterial, TableMaterial } from '../src/materials/data';
import { registry, materials } from '../src/materials';
import { createRecordsTransports } from '../src/records-transports';
import { serverRecordsExample } from './fixtures/server-records-example';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';
afterEach(cleanup);
describe('server list composition', () => {
  it('emits one unified size event, gives it precedence and stays controlled without legacy callbacks', () => {
    const unified = vi.fn(),
      legacyPage = vi.fn(),
      legacySize = vi.fn();
    const { rerender } = render(
      <TipProvider>
        <PaginationMaterial
          page={3}
          pageSize={5}
          total={100}
          onPaginationChange={unified}
          onPageChange={legacyPage}
          onPageSizeChange={legacySize}
        />
      </TipProvider>,
    );
    changeControl(screen.getByLabelText('每页条数'), '10');
    expect(unified).toHaveBeenCalledExactlyOnceWith({ page: 1, pageSize: 10 });
    expect(legacyPage).not.toHaveBeenCalled();
    expect(legacySize).not.toHaveBeenCalled();
    expect(screen.getByText('3 / 20 页')).toBeTruthy();
    rerender(
      <TipProvider>
        <PaginationMaterial page={1} pageSize={10} total={100} onPaginationChange={unified} />
      </TipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(unified).toHaveBeenLastCalledWith({ page: 2, pageSize: 10 });
    expect(screen.getByText('1 / 10 页')).toBeTruthy();
  });
  it('displays an already ordered server page without re-sorting or slicing', () => {
    const props = {
      data: [
        { id: '1', name: 'A' },
        { id: '2', name: 'B' },
      ],
      columns: [{ key: 'name', title: '姓名' }],
      sort: { key: 'name', direction: 'desc' as const },
      paginate: false,
      pageSize: 1,
    };
    const { rerender } = render(<TableMaterial {...props} sortMode="server" />);
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getByRole('cell').textContent),
    ).toEqual(['A', 'B']);
    rerender(<TableMaterial {...props} sortMode="client" />);
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .map((row) => within(row).getByRole('cell').textContent),
    ).toEqual(['B', 'A']);
  });
  it('keeps a committed save separate from failed refresh and retries only the query', async () => {
    const transports = createRecordsTransports({ delayMs: 0 });
    const save = vi.spyOn(transports['demo.recordSave'], 'execute'),
      query = vi.spyOn(transports['demo.recordsQuery'], 'execute');
    const host = { ...registry, transports: { ...registry.transports, ...transports } };
    const rt = new PageRuntime(compileApplication(serverRecordsExample, host), 'records');
    const effects = vi.fn();
    rt.subscribeEffects(effects);
    render(
      <TipProvider>
        <RuntimeRenderer runtime={rt} materials={materials} />
      </TipProvider>,
    );
    await act(async () => {
      await rt.enter();
    });
    expect(query).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await screen.findByRole('dialog', { name: '编辑服务端记录' });
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '刷新失败01');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await screen.findByText('保存已完成，仅列表刷新失败');
    expect(rt.getState().saveCommitted).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(effects).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '保存记录' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () => {
      await expect(rt.submitForm('edit')).rejects.toThrow('保存已完成');
    });
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '仅重试刷新' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '编辑服务端记录' })).toBeNull(),
    );
    expect(save).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(3);
    expect(effects).toHaveBeenCalledTimes(1);
    expect(screen.getByText('刷新失败01')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await screen.findByRole('dialog', { name: '编辑服务端记录' });
    expect(rt.getState().saveCommitted).toBe(false);
    expect((screen.getByRole('button', { name: '保存记录' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    rt.dispose();
  });
  it('keeps failed save input editable and performs refresh only after a successful retry', async () => {
    const transports = createRecordsTransports({ delayMs: 0 });
    const save = vi.spyOn(transports['demo.recordSave'], 'execute'),
      query = vi.spyOn(transports['demo.recordsQuery'], 'execute');
    const host = { ...registry, transports: { ...registry.transports, ...transports } };
    const rt = new PageRuntime(compileApplication(serverRecordsExample, host), 'records');
    render(
      <TipProvider>
        <RuntimeRenderer runtime={rt} materials={materials} />
      </TipProvider>,
    );
    await act(async () => {
      await rt.enter();
    });
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await screen.findByRole('dialog', { name: '编辑服务端记录' });
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '保存失败01');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await screen.findByText('模拟保存失败，输入已保留');
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).value).toBe(
      '保存失败01',
    );
    expect(rt.getState().saveCommitted).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '已修正01');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '编辑服务端记录' })).toBeNull(),
    );
    expect(save).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(2);
    expect(screen.getByText('已修正01')).toBeTruthy();
    rt.dispose();
  });
  it('issues one request per size change and resets search/sort to the first server page', async () => {
    const transports = createRecordsTransports({ delayMs: 0 });
    const query = vi.spyOn(transports['demo.recordsQuery'], 'execute');
    const rt = new PageRuntime(
      compileApplication(serverRecordsExample, {
        ...registry,
        transports: { ...registry.transports, ...transports },
      }),
      'records',
    );
    render(
      <TipProvider>
        <RuntimeRenderer runtime={rt} materials={materials} />
      </TipProvider>,
    );
    await act(async () => {
      await rt.enter();
    });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('2 / 5 页')).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByLabelText('每页条数') as HTMLButtonElement).disabled).toBe(false),
    );
    changeControl(screen.getByLabelText('每页条数'), '10');
    await waitFor(() => expect(screen.getByText('1 / 3 页')).toBeTruthy());
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toMatchObject({ page: 1, pageSize: 10 });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText('2 / 3 页')).toBeTruthy());
    await screen.findByRole('button', { name: '排序金额' });
    fireEvent.click(screen.getByRole('button', { name: '排序金额' }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(5));
    await waitFor(() => expect(screen.getByText('1 / 3 页')).toBeTruthy());
    expect(query.mock.calls[4][0]).toMatchObject({
      page: 1,
      sortKey: 'amount',
      sortDirection: 'asc',
    });
    changeControl(screen.getByRole('textbox', { name: '搜索姓名或部门' }), '研发中心');
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(screen.getByText('共 8 条记录')).toBeTruthy());
    expect(query.mock.calls[5][0]).toMatchObject({ page: 1, query: '研发中心' });
    fireEvent.click(screen.getByRole('button', { name: '清空筛选' }));
    await waitFor(() => expect(screen.getByText('共 23 条记录')).toBeTruthy());
    expect(query).toHaveBeenCalledTimes(7);
    expect(rt.getState().query).toBe('');
    rt.dispose();
  });
  it('starts in design mode without requests and suppresses an old query normalization chain', async () => {
    const transports = createRecordsTransports({ delayMs: 0 });
    const queries: ((value: unknown) => void)[] = [];
    transports['demo.recordsQuery'].execute = vi.fn(
      () => new Promise((resolve) => queries.push(resolve)),
    );
    const plan = compileApplication(serverRecordsExample, {
      ...registry,
      transports: { ...registry.transports, ...transports },
    });
    const rt = new PageRuntime(plan, 'records', { designMode: true });
    await rt.enter();
    await expect(rt.getDataSource('records').execute()).rejects.toThrow();
    expect(queries).toHaveLength(0);
    rt.setDesignMode(false);
    await waitFor(() => expect(queries).toHaveLength(1));
    const page = plan.pages.get('records')!;
    const pagination = page.children.find((node) => node.schema.id === 'records-pagination')!;
    const next = rt.run(
      pagination.on.onPaginationChange,
      {},
      { page: 2, pageSize: 5 },
      'pagination',
    );
    await waitFor(() => expect(queries).toHaveLength(2));
    queries[1]({ items: [], total: 12, page: 2, pageSize: 5, sort: null });
    await next;
    expect(rt.getState().page).toBe(2);
    queries[0]({ items: [], total: 0, page: 1, pageSize: 10, sort: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(rt.getState()).toMatchObject({ page: 2, pageSize: 5 });
    expect(rt.getDataSource('records').getSnapshot().data).toMatchObject({ page: 2, pageSize: 5 });
    rt.dispose();
  });
});
