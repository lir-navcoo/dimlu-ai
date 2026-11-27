import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { createPurchaseTransports } from '../src/purchase-transports';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';
import App from '../src/App';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { exampleApplication } from './fixtures/examples';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(delayMs = 0) {
  const transports = createPurchaseTransports({ delayMs });
  const save = vi.spyOn(transports['demo.purchaseSave'], 'execute');
  const query = vi.spyOn(transports['demo.purchasesQuery'], 'execute');
  const runtime = new PageRuntime(
    compileApplication(purchaseManagementExample, {
      ...registry,
      transports: { ...registry.transports, ...transports },
    }),
    'purchases',
  );
  render(
    <TipProvider>
      <RuntimeRenderer runtime={runtime} materials={materials} />
    </TipProvider>,
  );
  await act(async () => {
    await runtime.enter();
  });
  return { runtime, save, query };
}
async function basic(name = '新申请') {
  await screen.findByRole('textbox', { name: '申请名称' });
  changeControl(screen.getByRole('textbox', { name: '申请名称' }), name);
  changeControl(screen.getByRole('textbox', { name: '申请人' }), '测试申请人');
  fireEvent.click(screen.getByRole('combobox', { name: '所属部门' }));
  const department = screen.getByRole('option', { name: '研发中心' });
  fireEvent.pointerDown(department, { pointerType: 'mouse', button: 0 });
  fireEvent.click(department);
  changeControl(screen.getByLabelText(/^采购日期/, { selector: 'input' }), '2026-11-08');
  changeControl(screen.getByRole('textbox', { name: '物品名称' }), '显示器');
  changeControl(screen.getByRole('spinbutton', { name: '数量' }), '2');
  changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '1299');
}
describe('purchase business composition', () => {
  it('uses the new starter only without saved projects, restores legacy v1 unchanged and makes no design requests', () => {
    const query = vi.spyOn(registry.transports!['demo.purchasesQuery'], 'execute');
    const view = render(<App />);
    expect(within(screen.getByLabelText('页面编辑画布')).getByText('采购申请管理')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建申请' })).toBeTruthy();
    expect(screen.queryByText(/本地计数|需主管审批|成员目录/)).toBeNull();
    expect(document.querySelector('.form-status')).toBeNull();
    expect(query).not.toHaveBeenCalled();
    view.unmount();
    const raw = JSON.stringify({
      storageVersion: 1,
      schema: exampleApplication,
      selection: { pageId: 'purchase', nodeId: 'purchase-heading' },
    });
    localStorage.clear();
    localStorage.setItem(PROJECT_STORAGE_KEY, raw);
    render(<App />);
    expect(within(screen.getByLabelText('页面编辑画布')).getByText('创建采购申请')).toBeTruthy();
    expect(localStorage.getItem(PROJECT_STORAGE_KEY)).toBe(raw);
    expect(query).not.toHaveBeenCalled();
  });
  it('searches, pages and sorts at the service, creates/edits once, and isolates new sessions and array row identities', async () => {
    const { runtime, query, save } = await setup();
    expect(screen.getByText('共 16 条采购申请')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(runtime.getState().page).toBe(2));
    await waitFor(() =>
      expect(runtime.getDataSource('purchases').getSnapshot().loading).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '排序采购金额 / 元' }));
    await waitFor(() =>
      expect(runtime.getDataSource('purchases').getSnapshot().data).toMatchObject({
        sort: { key: 'amount', direction: 'asc' },
        page: 1,
      }),
    );
    changeControl(screen.getByRole('textbox', { name: '搜索采购申请' }), '研发中心');
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByText('共 4 条采购申请');
    fireEvent.click(screen.getByRole('button', { name: '新建申请' }));
    await screen.findByRole('dialog', { name: '新建采购申请' });
    await basic('N10新建采购');
    const row = document.querySelector('[data-row-id]')!;
    const rowId = row.getAttribute('data-row-id');
    fireEvent.click(screen.getByRole('button', { name: '新增一行' }));
    fireEvent.click(screen.getByRole('button', { name: '下移第 1 行' }));
    expect(document.querySelectorAll('[data-row-id]')[1].getAttribute('data-row-id')).toBe(rowId);
    fireEvent.click(screen.getByRole('button', { name: '删除第 1 行' }));
    expect(screen.getByText('¥ 2598')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    changeControl(screen.getByRole('textbox', { name: '搜索采购申请' }), 'N10新建采购');
    fireEvent.click(screen.getByRole('button', { name: '查询' }));
    await screen.findByText('共 1 条采购申请');
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog', { name: '编辑采购申请' });
    expect((screen.getByRole('textbox', { name: '申请名称' }) as HTMLInputElement).value).toBe(
      'N10新建采购',
    );
    expect(runtime.getForm('purchase').getSnapshot().values.items).toEqual([
      { name: '显示器', quantity: 2, price: 1299 },
    ]);
    changeControl(screen.getByRole('textbox', { name: '申请名称' }), 'N10更新采购');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '新建申请' }));
    await screen.findByRole('dialog', { name: '新建采购申请' });
    expect(runtime.getState()).toMatchObject({ selectedId: '', saveCommitted: false });
    expect(runtime.getForm('purchase').getSnapshot().values).toMatchObject({
      name: '',
      applicant: '',
      department: '',
      purchaseDate: '',
      items: [{ name: '', quantity: 1, price: 0 }],
    });
    expect(query.mock.calls.length).toBeGreaterThan(5);
    runtime.dispose();
  });
  it('validates quantity/money/approval and whole-form limits while retaining failed inputs', async () => {
    const { runtime, save } = await setup();
    fireEvent.click(screen.getByRole('button', { name: '新建申请' }));
    await basic();
    changeControl(screen.getByRole('spinbutton', { name: '数量' }), '1.5');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    expect(await screen.findByText('数量必须为整数')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    changeControl(screen.getByRole('spinbutton', { name: '数量' }), '1');
    changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '0.001');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    expect(await screen.findByText('单价最多两位小数')).toBeTruthy();
    changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '10001');
    expect(screen.getByRole('textbox', { name: '审批说明' })).toBeTruthy();
    changeControl(screen.getByRole('textbox', { name: '审批说明' }), '新增研发设备');
    changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '50001');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    expect(await screen.findByText('单笔采购金额不能超过50,000元')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '0');
    changeControl(screen.getByRole('textbox', { name: '申请名称' }), '保存失败采购');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    await screen.findByText('申请尚未保存');
    expect(runtime.getForm('purchase').getSnapshot().values.name).toBe('保存失败采购');
    expect(save).toHaveBeenCalledTimes(1);
    changeControl(screen.getByRole('textbox', { name: '申请名称' }), '重试成功采购');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });
  it('blocks repeated busy submissions and retries only query after a committed save with failed refresh', async () => {
    const { runtime, save, query } = await setup(25);
    fireEvent.click(screen.getByRole('button', { name: '新建申请' }));
    await basic('刷新失败采购');
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    await act(async () => {
      expect(
        await runtime.getForm('purchase').submit(async () => {
          throw new Error('duplicate');
        }),
      ).toBe(false);
    });
    await screen.findByText('申请已保存，仅列表刷新失败');
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await expect(runtime.submitForm('purchase')).rejects.toThrow('申请已保存');
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '仅重试刷新' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(3);
    expect(screen.getByText('刷新失败采购')).toBeTruthy();
    runtime.dispose();
  });
});
