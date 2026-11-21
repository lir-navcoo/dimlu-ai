import { existsSync, readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ProjectStorage, type ProjectStorageAdapter } from '../packages/editor/project-storage';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import type { ApplicationSchema, Json } from '../packages/schema/types';
import { registry, materials } from '../src/materials';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { createPurchaseTransports, type PurchaseRecord } from '../src/purchase-transports';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

const load = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const legacyRaw = load('./fixtures/legacy-v1-project-010.txt');
const legacySchema = JSON.parse(load('./fixtures/legacy-starter-010.txt')) as ApplicationSchema;
const runtimes: PageRuntime[] = [];
const projects: ProjectStorage[] = [];
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  projects.splice(0).forEach((project) => project.stop());
  vi.restoreAllMocks();
});
function memory(raw: string | null = null) {
  let current = raw;
  const adapter: ProjectStorageAdapter = {
    getItem: vi.fn(() => current),
    setItem: vi.fn((_key, value) => {
      current = value;
    }),
  };
  return { adapter, raw: () => current };
}
const context = () => ({ signal: new AbortController().signal });
const queryInput = (patch: Record<string, Json> = {}) => ({
  query: '',
  page: 1,
  pageSize: 100,
  sortKey: '',
  sortDirection: '',
  ...patch,
});
const values = (patch: Record<string, Json> = {}) => ({
  name: '独立采购申请',
  applicant: '验收人',
  department: '研发中心',
  purchaseDate: '2026-11-08',
  approvalReason: '',
  items: [{ name: '样品', quantity: 1, price: 0 }],
  ...patch,
});
const record = (id: string, name: string, prices: number[]): PurchaseRecord => ({
  id,
  number: `CG-${id}`,
  name,
  applicant: `申请人${id}`,
  department: '研发中心',
  purchaseDate: '2026-11-08',
  approvalReason: '',
  items: prices.map((price, i) => ({ name: `${name}物品${i}`, quantity: 1, price })),
  amount: prices.reduce((a, b) => a + b, 0),
});
async function mount(rows: PurchaseRecord[]) {
  const transports = createPurchaseTransports({ rows, delayMs: 0 });
  const query = vi.spyOn(transports['demo.purchasesQuery'], 'execute');
  const save = vi.spyOn(transports['demo.purchaseSave'], 'execute');
  const runtime = new PageRuntime(
    compileApplication(purchaseManagementExample, {
      ...registry,
      transports: { ...registry.transports, ...transports },
    }),
    'purchases',
  );
  runtimes.push(runtime);
  render(
    <TipProvider>
      <RuntimeRenderer runtime={runtime} materials={materials} />
    </TipProvider>,
  );
  await act(async () => {
    await runtime.enter();
  });
  return { runtime, query, save };
}

describe('cycle 011 independent purchase composition acceptance', () => {
  it('restores the fixed accepted 010 project ahead of the new fallback without any implicit rewrite', () => {
    const m = memory(legacyRaw);
    const project = new ProjectStorage(m.adapter, registry, purchaseManagementExample);
    projects.push(project);
    project.start();
    project.flush();
    expect(project.getSnapshot().document.getSnapshot().plan.schema).toEqual(legacySchema);
    expect(project.getSnapshot().document.getSnapshot().selection).toEqual({
      pageId: 'purchase',
      nodeId: 'purchase-name',
    });
    expect(project.getSnapshot().document.getSnapshot().canUndo).toBe(false);
    expect(m.raw()).toBe(legacyRaw);
    expect(m.adapter.setItem).not.toHaveBeenCalled();
    project.getSnapshot().document.setProp('purchase', 'purchase-heading', 'title', {
      kind: 'literal',
      value: '旧项目继续编辑',
    });
    project.flush();
    const edited = JSON.parse(m.raw()!).schema;
    expect(edited.id).toBe(legacySchema.id);
    expect(edited.pages.map((page: { id: string }) => page.id)).toEqual([
      'purchase',
      'people',
      'composition',
    ]);
    const session = project.getSnapshot().session;
    project.reset();
    expect(project.getSnapshot().session).toBe(session + 1);
    expect(project.getSnapshot().document.getSnapshot().plan.schema).toEqual(
      purchaseManagementExample,
    );
    expect(project.getSnapshot().document.getSnapshot().canUndo).toBe(false);
  });

  it('renders the frozen legacy Schema in edit mode while the new app fallback remains separate', () => {
    const m = memory(legacyRaw);
    const query = vi.spyOn(registry.transports!['demo.purchasesQuery'], 'execute');
    render(<App projectStorage={m.adapter} saveDelayMs={1} />);
    expect(screen.getByRole('heading', { name: '创建采购申请' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑模式' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(
      screen
        .getByRole('button', { name: '选中 文本输入 purchase-name' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: '新建申请' })).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(m.raw()).toBe(legacyRaw);
  });

  it('exports the procurement starter and stops publishing the retired boundary example', () => {
    expect(JSON.parse(load('../public/examples/starter.json'))).toEqual(purchaseManagementExample);
    expect(JSON.parse(load('../public/examples/purchase-management.json'))).toEqual(
      purchaseManagementExample,
    );
    expect(existsSync(new URL('../public/examples/runtime-boundaries.json', import.meta.url))).toBe(
      false,
    );
    const m = memory();
    render(<App projectStorage={m.adapter} saveDelayMs={1} />);
    fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
    expect(screen.getByRole('menuitem', { name: '下载采购管理案例' }).getAttribute('href')).toBe(
      '/examples/purchase-management.json',
    );
    expect(screen.queryByRole('menuitem', { name: '下载运行时边界案例' })).toBeNull();
  });

  it('does not commit a local save aborted during its delay, and clones inputs, seed and returned records', async () => {
    const seed = [record('purchase-2', '原始申请', [0.1, 0.2])];
    const original = structuredClone(seed);
    const transports = createPurchaseTransports({ rows: seed, delayMs: 15 });
    const input = values({ items: [{ name: '待取消', quantity: 1, price: 5 }] });
    const controller = new AbortController();
    const pending = transports['demo.purchaseSave'].execute(
      { id: '', values: input },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    const first = (await transports['demo.purchasesQuery'].execute(queryInput(), context())) as any;
    expect(first.total).toBe(1);
    first.items[0].items[0].price = 999;
    first.items[0].editValues.items[0].name = '输出污染';
    const draft = values({
      items: [
        { name: '克隆提交', quantity: 1, price: 0.1 },
        { name: '小数', quantity: 1, price: 0.2 },
      ],
    });
    const saved = (await transports['demo.purchaseSave'].execute(
      { id: '', values: draft },
      context(),
    )) as any;
    (draft.items as Record<string, Json>[])[0].price = 888;
    const result = (await transports['demo.purchasesQuery'].execute(
      queryInput(),
      context(),
    )) as any;
    expect(saved.amount).toBe(0.3);
    expect(result.items.find((row: any) => row.id === saved.id).items[0].price).toBe(0.1);
    expect(result.items.find((row: any) => row.id === 'purchase-2').items[0].price).toBe(0.1);
    expect(seed).toEqual(original);
    expect(new Set(result.items.map((row: any) => row.id)).size).toBe(2);
  });

  it('enforces exact approval/budget boundaries and rejects invalid calendar values without writing', async () => {
    const transports = createPurchaseTransports({ rows: [], delayMs: 0 });
    const save = (patch: Record<string, Json>) =>
      transports['demo.purchaseSave'].execute({ id: '', values: values(patch) }, context());
    expect(
      await save({ items: [{ name: '边界一', quantity: 1, price: 10000 }], amount: 1 }),
    ).toMatchObject({ amount: 10000 });
    await expect(
      save({ items: [{ name: '需审批', quantity: 1, price: 10000.01 }] }),
    ).rejects.toThrow('审批');
    expect(
      await save({
        items: [{ name: '边界二', quantity: 1, price: 50000 }],
        approvalReason: '边界说明',
        amount: 0,
      }),
    ).toMatchObject({ amount: 50000 });
    const invalidPatches: Record<string, Json>[] = [
      { purchaseDate: '2026-02-29' },
      { purchaseDate: '2026-13-01' },
      { items: [{ name: '非有限金额', quantity: 1, price: Infinity }] },
      { items: [{ name: '超额', quantity: 1, price: 50000.01 }], approvalReason: '说明' },
    ];
    for (const patch of invalidPatches) await expect(save(patch)).rejects.toThrow();
    expect(await transports['demo.purchasesQuery'].execute(queryInput(), context())).toMatchObject({
      total: 2,
    });
  });

  it('sorts the complete filtered dataset and normalizes a page after editing its last matching record', async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      record(String(i), `匹配申请${i}`, [60 - i * 10]),
    );
    const transports = createPurchaseTransports({ rows, delayMs: 0 });
    expect(
      await transports['demo.purchasesQuery'].execute(
        queryInput({
          query: '匹配',
          sortKey: 'amount',
          sortDirection: 'asc',
          pageSize: 2,
          page: 2,
        }),
        context(),
      ),
    ).toMatchObject({ total: 6, page: 2, items: [{ id: '3' }, { id: '2' }] });
    await transports['demo.purchaseSave'].execute(
      { id: '5', values: values({ name: '离开筛选' }) },
      context(),
    );
    expect(
      await transports['demo.purchasesQuery'].execute(
        queryInput({ query: '匹配', pageSize: 1, page: 6 }),
        context(),
      ),
    ).toMatchObject({ total: 5, page: 5, items: [{ id: '4' }] });
  });

  it('keeps generic row DOM and errors with their identity, then isolates cancel/edit/new sessions', async () => {
    const seed = [record('a', '甲申请', [10, 20, 30]), record('b', '乙申请', [77])];
    const { runtime, save } = await mount(seed);
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    await screen.findByRole('dialog', { name: '编辑采购申请' });
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-row-id]')];
    const [a, b, c] = rows();
    const cInput = within(c).getByRole('textbox', { name: '物品名称' });
    changeControl(within(c).getByRole('spinbutton', { name: '数量' }), '0');
    fireEvent.blur(within(c).getByRole('spinbutton', { name: '数量' }));
    expect(within(c).getByText('数量至少为1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '上移第 3 行' }));
    expect(rows()).toEqual([a, c, b]);
    expect(within(rows()[1]).getByRole('textbox', { name: '物品名称' })).toBe(cInput);
    expect(within(rows()[1]).getByText('数量至少为1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除第 3 行' }));
    expect(rows()).toEqual([a, c]);
    changeControl(screen.getByRole('textbox', { name: '申请名称' }), '未保存草稿');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1]);
    await screen.findByRole('dialog', { name: '编辑采购申请' });
    expect(runtime.getForm('purchase').getSnapshot().values).toMatchObject({
      name: '乙申请',
      applicant: '申请人b',
      items: [{ name: '乙申请物品0', quantity: 1, price: 77 }],
    });
    expect(rows()).toHaveLength(1);
    expect(screen.queryByText('数量至少为1')).toBeNull();
    expect(rows()[0]).not.toBe(a);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '新建申请' }));
    await screen.findByRole('dialog', { name: '新建采购申请' });
    expect(runtime.getForm('purchase').getSnapshot().values).toMatchObject({
      name: '',
      applicant: '',
      department: '',
      purchaseDate: '',
      items: [{ name: '', quantity: 1, price: 0 }],
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('retains a hidden approval draft while omitting it from the actual saved payload below the threshold', async () => {
    const { runtime, save } = await mount([record('a', '阈值申请', [10000])]);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await screen.findByRole('dialog', { name: '编辑采购申请' });
    expect(screen.queryByRole('textbox', { name: '审批说明' })).toBeNull();
    changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '10000.01');
    changeControl(screen.getByRole('textbox', { name: '审批说明' }), '隐藏后不提交的说明');
    changeControl(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), '0');
    expect(screen.queryByRole('textbox', { name: '审批说明' })).toBeNull();
    expect(runtime.getForm('purchase').getSnapshot().values.approvalReason).toBe(
      '隐藏后不提交的说明',
    );
    fireEvent.click(screen.getByRole('button', { name: '提交申请' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      id: 'a',
      values: { items: [{ name: '阈值申请物品0', quantity: 1, price: 0 }] },
    });
    expect(save.mock.calls[0][0].values as Record<string, Json>).not.toHaveProperty(
      'approvalReason',
    );
  });
});
