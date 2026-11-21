import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findNode } from '../packages/editor/document';
import { registry } from '../src/materials';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { changeControl } from './ui-helpers';
import {
  emptyEventApplication,
  overviewHarness,
  overviewNode,
} from './saved-event-overview-fixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const overview = () => screen.getByRole('region', { name: '已保存事件' });
const selector = () => screen.getByRole('combobox', { name: '组件事件' });
const selectEvent = (name: string) => changeControl(selector(), name);
const rows = () => within(overview()).queryAllByRole('listitem');
const savedRow = (event: string) =>
  rows().find((row) => within(row).queryByText(event, { selector: 'code' }))!;
const assertCount = (event: string, count: number) => {
  expect(savedRow(event)).toBeTruthy();
  expect(savedRow(event).textContent).toContain(`已保存 ${count} 个动作`);
};

describe('saved component event overview independent integration', () => {
  it('discovers nonselected stock table/pagination chains while keeping first empty event and real Select values', () => {
    const query = vi.spyOn(registry.transports!['demo.purchasesQuery'], 'execute');
    const action = vi.spyOn(registry.actions['state.set'], 'execute');
    const h = overviewHarness();
    const snapshot = h.author.getSnapshot();
    const changed = vi.fn();
    const stop = h.author.subscribe(changed);
    const write = vi.spyOn(h.session().drafts, 'write');
    expect(selector().textContent).toContain('onSelectionChange');
    expect(selector().textContent).toContain('未配置');
    expect(screen.getByText('此事件尚未配置动作。')).toBeTruthy();
    assertCount('onSortChange', 6);
    assertCount('onRetry', 3);
    expect(rows().map((row) => row.querySelector('code')!.textContent)).toEqual([
      'onSortChange',
      'onRetry',
    ]);
    expect(within(overview()).queryByRole('button')).toBeNull();
    expect(overview().querySelector('[title]')).toBeNull();
    fireEvent.click(selector());
    const options = screen.getAllByRole('option');
    expect(options.map((item) => item.dataset.value)).toEqual(
      registry.components['ui.table'].events,
    );
    expect(options.find((item) => item.dataset.value === 'onSortChange')!.textContent).toContain(
      '已保存 6 个动作',
    );
    expect(
      options.find((item) => item.dataset.value === 'onSelectionChange')!.textContent,
    ).toContain('未配置');
    fireEvent.keyDown(selector(), { key: 'Escape' });
    expect(write).not.toHaveBeenCalled();
    expect(h.author.getSnapshot()).toBe(snapshot);
    expect(changed).not.toHaveBeenCalled();
    stop();
    act(() => {
      h.author.select('purchases', 'purchase-pagination');
    });
    expect(selector().textContent).toContain('onPageChange');
    expect(selector().textContent).toContain('未配置');
    expect(rows()).toHaveLength(1);
    assertCount('onPaginationChange', 5);
    expect(h.author.getSnapshot().canUndo).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });

  it('excludes unapplied additions/deletions, retains event drafts, and derives count after one save and Undo/Redo', () => {
    const h = overviewHarness();
    const original = overviewNode(h.author).on!;
    fireEvent.click(screen.getByRole('button', { name: '添加动作' }));
    expect(screen.getByRole('region', { name: '动作 1' })).toBeTruthy();
    expect(savedRow('onSelectionChange')).toBeUndefined();
    expect(selector().textContent).toContain('未配置');
    selectEvent('onSortChange');
    fireEvent.click(screen.getByRole('button', { name: '删除动作 1' }));
    expect(screen.getAllByRole('region', { name: /^动作 \d+$/ })).toHaveLength(5);
    assertCount('onSortChange', 6);
    selectEvent('onRetry');
    fireEvent.click(screen.getByRole('button', { name: '删除动作 1' }));
    assertCount('onRetry', 3);
    selectEvent('onSortChange');
    expect(screen.getAllByRole('region', { name: /^动作 \d+$/ })).toHaveLength(5);
    assertCount('onSortChange', 6);
    const before = h.author.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    expect(overviewNode(h.author).on!.onSortChange).toEqual(original.onSortChange.slice(1));
    expect(overviewNode(h.author).on!.onRetry).toEqual(original.onRetry);
    assertCount('onSortChange', 5);
    assertCount('onRetry', 3);
    act(() => h.author.undo());
    assertCount('onSortChange', 6);
    expect(overviewNode(h.author).on!.onSortChange).toEqual(original.onSortChange);
    act(() => h.author.redo());
    assertCount('onSortChange', 5);
    selectEvent('onRetry');
    expect(screen.getAllByRole('region', { name: /^动作 \d+$/ })).toHaveLength(2);
    assertCount('onRetry', 3);
    selectEvent('onSelectionChange');
    expect(screen.getByRole('region', { name: '动作 1' })).toBeTruthy();
    expect(savedRow('onSelectionChange')).toBeUndefined();
    expect(overviewNode(h.author).on!.onSelectionChange).toBeUndefined();
  });

  it('derives exact saved overview for node/page/import replacement and preserves per-node event choice', () => {
    const schema = structuredClone(purchaseManagementExample);
    const second = structuredClone(schema.pages[0]);
    second.id = 'purchases-other';
    second.title = 'Other page';
    schema.pages.push(second);
    const h = overviewHarness(schema);
    selectEvent('onRetry');
    act(() => h.author.select('purchases', 'purchase-pagination'));
    assertCount('onPaginationChange', 5);
    selectEvent('onPaginationChange');
    act(() => h.author.select('purchases', 'purchase-table'));
    expect(selector().textContent).toContain('onRetry');
    act(() => {
      h.author.setEventActions(
        'purchases-other',
        'purchase-table',
        'onSortChange',
        overviewNode(h.author).on!.onSortChange.slice(0, 2),
      );
      h.author.select('purchases-other', 'purchase-table');
    });
    expect(selector().textContent).toContain('onSelectionChange');
    assertCount('onSortChange', 2);
    assertCount('onRetry', 3);
    const imported = structuredClone(h.author.getSnapshot().plan.schema);
    const table = findNode(imported.pages[1], 'purchase-table')!.node;
    table.on!.onSortChange = [];
    table.on!.onRetry = table.on!.onRetry.slice(0, 1);
    act(() => h.author.replace(imported));
    expect(rows()).toHaveLength(1);
    assertCount('onRetry', 1);
    expect(savedRow('onSortChange')).toBeUndefined();
    expect(selector().textContent).toContain('onSelectionChange');
    act(() => h.author.select('purchases', 'purchase-table'));
    expect(selector().textContent).toContain('onRetry');
    assertCount('onSortChange', 6);
  });

  it('distinguishes allowed empty chains from managed-field and no-event components without misleading saved entries', () => {
    const h = overviewHarness(emptyEventApplication(), 'page', 'absent');
    for (const nodeId of ['absent', 'empty']) {
      act(() => h.author.select('page', nodeId));
      expect(within(overview()).getByText('暂无已保存事件动作。')).toBeTruthy();
      expect(rows()).toHaveLength(0);
      expect(selector().textContent).toContain('onClick');
      expect(selector().textContent).toContain('未配置');
    }
    act(() => h.author.select('page', 'managed'));
    expect(screen.queryByRole('region', { name: '已保存事件' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: '组件事件' })).toBeNull();
    expect(screen.getByText('change / blur 事件由表单字段适配器管理。')).toBeTruthy();
    act(() => h.author.select('page', 'none'));
    expect(screen.queryByRole('region', { name: '已保存事件' })).toBeNull();
    expect(screen.getByText('此物料没有可配置事件。')).toBeTruthy();
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });
});
