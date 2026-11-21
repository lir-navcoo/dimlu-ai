import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCatalog } from '../packages/editor/metadata';
import type { Json } from '../packages/schema/types';
import { catalog } from '../src/editor/catalog';
import { materializeColumn } from '../src/editor/table-columns-draft';
import { registry } from '../src/materials';
import { changeControl } from './ui-helpers';
import { lit } from './multiselection-fixture';
import {
  acceptedColumns,
  applyColumns,
  baseColumns,
  columnInput,
  columnSelect,
  columnsGroup,
  jsonColumns,
  literalColumnsHarness,
  tableHarness,
} from './table-columns-fixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const edit = (index: number, field: '字段路径' | '标题' | '宽度', value: string) =>
  fireEvent.change(columnInput(index, field), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name });
const rows = () => [...columnsGroup().querySelectorAll<HTMLElement>('[data-table-column-row]')];

describe('columns editor preserves accepted JSON and explicit optional absence', () => {
  it('registers only table columns metadata and checks its array field requirement', () => {
    expect(
      catalog['ui.table'].properties.find((property) => property.name === 'columns')!.setter,
    ).toEqual({ kind: 'columns' });
    expect(validateCatalog(catalog, registry)).toEqual([]);
    const wrong = structuredClone(catalog);
    wrong['ui.heading'].properties.find((property) => property.name === 'title')!.setter = {
      kind: 'columns',
    };
    expect(
      validateCatalog(wrong, registry).some((error) => error.includes('ui.heading.title')),
    ).toBe(true);
  });

  it('editing/reordering preserves raw strings,optional presence and nested extras', () => {
    const source = JSON.parse(
      '[{"key":" name ","title":" Name ","future":{"deep":[1,false,null]}},{"key":"amount","title":"Amount","width":80.5,"sortable":false,"align":"right","future":{"id":"second"}}]',
    ) as Json[];
    const untouched = structuredClone(source);
    const { author } = tableHarness({ columns: source });
    const before = author.getSnapshot();
    const nodeBefore = before.plan.pages
      .get('a')!
      .schema.children.find((node) => node.id === 'table')!;
    const command = vi.spyOn(author, 'setProp');
    edit(1, '字段路径', ' profile.name ');
    edit(1, '标题', ' Kept bytes ');
    fireEvent.click(button('下移列 1'));
    expect(author.getSnapshot()).toBe(before);
    fireEvent.click(applyColumns());
    expect(command).toHaveBeenCalledOnce();
    const actual = acceptedColumns(author) as Record<string, Json>[];
    expect(actual[0]).toEqual(untouched[1]);
    expect(actual[1]).toEqual({
      ...(untouched[0] as object),
      key: ' profile.name ',
      title: ' Kept bytes ',
    });
    expect(Object.hasOwn(actual[1], 'width')).toBe(false);
    expect(Object.hasOwn(actual[1], 'sortable')).toBe(false);
    expect(Object.hasOwn(actual[1], 'align')).toBe(false);
    expect(JSON.stringify(actual)).not.toContain('rowId');
    const nodeAfter = author
      .getSnapshot()
      .plan.pages.get('a')!
      .schema.children.find((node) => node.id === 'table')!;
    expect(nodeAfter.props.data).toEqual(nodeBefore.props.data);
    expect(nodeAfter.props.sort).toEqual(nodeBefore.props.sort);
    expect(nodeAfter.on).toEqual(nodeBefore.on);
    expect(author.getSnapshot().selection).toEqual(before.selection);
    expect(source).toEqual(untouched);
    act(() => author.undo());
    expect(acceptedColumns(author)).toEqual(untouched);
  });

  it('reserved own keys remain raw and fail existing JSON rules while materialization copies them safely as data', () => {
    const value = JSON.parse(
      '[{"key":"name","title":"Name","__proto__":{"polluted":"data"},"constructor":{"keep":true},"prototype":"value"}]',
    ) as Record<string, Json>[];
    const materialized = materializeColumn({
      rowId: 'reserved-own-keys',
      original: value[0],
      edits: { title: 'Edited' },
    });
    expect(Object.hasOwn(materialized, '__proto__')).toBe(true);
    expect(materialized.__proto__).toEqual({ polluted: 'data' });
    expect(materialized.constructor).toEqual({ keep: true });
    expect(materialized.prototype).toBe('value');
    expect(Object.getPrototypeOf(materialized)).toBe(Object.prototype);
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(value[0].title).toBe('Name');
    const { commit } = literalColumnsHarness({ value });
    expect(JSON.parse(jsonColumns().value)).toEqual(value);
    const next = structuredClone(value);
    next[0].title = 'Raw edited title';
    const raw = JSON.stringify(next);
    fireEvent.change(jsonColumns(), { target: { value: raw } });
    fireEvent.click(applyColumns());
    expect(commit).not.toHaveBeenCalled();
    expect(jsonColumns().value).toBe(raw);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it.each(['', '   '])(
    'width %j explicitly unsets its own property without writing zero/null',
    (width) => {
      const { author } = tableHarness();
      edit(2, '宽度', width);
      fireEvent.click(applyColumns());
      const value = acceptedColumns(author) as Record<string, Json>[];
      expect(Object.hasOwn(value[1], 'width')).toBe(false);
      expect(value[1].sortable).toBe(false);
      expect(value[1].align).toBe('right');
    },
  );

  it('valid decimal width remains a number with optional absence on the untouched row', () => {
    const { author } = tableHarness();
    edit(2, '宽度', '24.25');
    fireEvent.click(applyColumns());
    const value = acceptedColumns(author) as Record<string, Json>[];
    expect(value[1].width).toBe(24.25);
    expect(value[0]).toEqual(baseColumns[0]);
  });

  it('optional tri-state controls distinguish explicit false/left from unset and delete only edited keys', () => {
    const { author } = tableHarness();
    changeControl(columnSelect(1, '排序'), 'false');
    changeControl(columnSelect(1, '对齐'), 'left');
    changeControl(columnSelect(2, '排序'), '');
    changeControl(columnSelect(2, '对齐'), '');
    fireEvent.click(applyColumns());
    const value = acceptedColumns(author) as Record<string, Json>[];
    expect(value[0]).toEqual({ key: 'name', title: 'Name', sortable: false, align: 'left' });
    expect(Object.hasOwn(value[0], 'width')).toBe(false);
    expect(value[1]).toEqual({ key: 'amount', title: 'Amount', width: 80.5 });
  });

  it('new rows suggest a collision-free key,omit optional fields and never reuse a removed session id', () => {
    const { author } = tableHarness({
      columns: [
        { key: 'column1', title: 'One' },
        { key: 'column2', title: 'Two' },
      ],
    });
    fireEvent.click(button('添加列'));
    const id = rows()[2].dataset.tableColumnRow;
    const key = columnInput(3, '字段路径').value;
    expect(key).toMatch(/^column\d+$/);
    expect(['column1', 'column2']).not.toContain(key);
    fireEvent.click(button('删除列 3'));
    act(() => author.select('a', 'alpha'));
    act(() => author.select('a', 'table'));
    fireEvent.click(button('添加列'));
    expect(rows()[2].dataset.tableColumnRow).not.toBe(id);
    fireEvent.click(applyColumns());
    const added = (acceptedColumns(author) as Record<string, Json>[])[2];
    expect(Object.keys(added).sort()).toEqual(['key', 'title']);
  });
});

describe('one explicit Apply owns one whole-array history entry', () => {
  it('two Applies plus adjacent immediate edits remain four independent Undo entries', () => {
    const { author, session, props } = tableHarness();
    const before = author.getSnapshot();
    const rowKey = screen.getByRole('textbox', { name: '行唯一标识' });
    rowKey.focus();
    fireEvent.change(rowKey, { target: { value: 'alternate' } });
    const columnsCommand = vi.spyOn(author, 'setProp');
    columnInput(1, '标题').focus();
    edit(1, '标题', 'First apply');
    const precommitPermission = props().canEdit!;
    expect(precommitPermission()).toBe(true);
    fireEvent.click(applyColumns());
    expect(precommitPermission()).toBe(false);
    expect(
      session().drafts.read(
        'table-columns:a/table/columns',
        JSON.stringify(acceptedColumns(author)),
        {},
      ).dirty,
    ).toBe(false);
    edit(1, '标题', 'Second apply');
    fireEvent.click(applyColumns());
    expect(columnsCommand.mock.calls.filter((call) => call[2] === 'columns')).toHaveLength(2);
    expect(
      session().drafts.read(
        'table-columns:a/table/columns',
        JSON.stringify(acceptedColumns(author)),
        {},
      ).dirty,
    ).toBe(false);
    fireEvent.change(screen.getByRole('textbox', { name: '行唯一标识' }), {
      target: { value: 'final' },
    });
    act(() => author.undo());
    expect((acceptedColumns(author) as Record<string, Json>[])[0].title).toBe('Second apply');
    act(() => author.undo());
    expect((acceptedColumns(author) as Record<string, Json>[])[0].title).toBe('First apply');
    act(() => author.undo());
    expect(acceptedColumns(author)).toEqual(baseColumns);
    expect(author.getSnapshot().canUndo).toBe(true);
    act(() => author.undo());
    expect(author.getSnapshot().plan).toBe(before.plan);
    expect(author.getSnapshot().canUndo).toBe(false);
  });

  it('equal-value dirty Apply clears only its own draft without publication or history', () => {
    const { author, session } = tableHarness();
    const before = author.getSnapshot();
    const publish = vi.fn();
    const unsubscribe = author.subscribe(publish);
    edit(1, '标题', 'Temporary');
    edit(1, '标题', 'Name');
    try {
      fireEvent.click(applyColumns());
      expect(author.getSnapshot()).toBe(before);
      expect(publish).not.toHaveBeenCalled();
      expect(
        session().drafts.read(
          'table-columns:a/table/columns',
          JSON.stringify(acceptedColumns(author)),
          {},
        ).dirty,
      ).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it.each(['false', 'throw', 'truthy-nonboolean'] as const)(
    '%s host rejection retains the dedicated draft and accepted source',
    (kind) => {
      const { commit, session } = literalColumnsHarness({
        onChange: () => {
          if (kind === 'throw') throw new Error('Host rejected columns');
          return kind === 'truthy-nonboolean' ? ('yes' as unknown as boolean) : false;
        },
      });
      edit(1, '标题', 'Retained draft');
      const before = session().drafts.read(
        'table-columns:independent/columns',
        JSON.stringify(baseColumns),
        {},
      );
      fireEvent.click(applyColumns());
      expect(commit).toHaveBeenCalledOnce();
      expect(columnInput(1, '标题').value).toBe('Retained draft');
      expect(
        session().drafts.read('table-columns:independent/columns', JSON.stringify(baseColumns), {})
          .dirty,
      ).toBe(true);
      expect(before.dirty).toBe(true);
      expect(applyColumns().hasAttribute('disabled')).toBe(false);
    },
  );

  it('older hosts omitting optional canEdit retain the existing editable contract', () => {
    const { commit, session } = literalColumnsHarness();
    edit(1, '标题', 'Older host edit');
    fireEvent.click(applyColumns());
    expect(commit).toHaveBeenCalledOnce();
    expect(
      session().drafts.read('table-columns:independent/columns', JSON.stringify(baseColumns), {})
        .dirty,
    ).toBe(false);
  });

  it('a true commit may finish its own expired canEdit guard lease but permits no later edit', () => {
    let allowed = true;
    const { commit, session } = literalColumnsHarness({
      canEdit: () => allowed,
      onChange: () => {
        allowed = false;
        return true;
      },
    });
    edit(1, '标题', 'Accepted once');
    fireEvent.click(applyColumns());
    expect(commit).toHaveBeenCalledOnce();
    expect(
      session().drafts.read('table-columns:independent/columns', JSON.stringify(baseColumns), {})
        .dirty,
    ).toBe(false);
    edit(1, '标题', 'Forbidden later');
    expect(columnInput(1, '标题').value).toBe('Name');
  });
});

describe('invalid rows stay as editable drafts until existing validation succeeds', () => {
  it.each([
    { field: '字段路径' as const, value: '' },
    { field: '字段路径' as const, value: '   ' },
    { field: '字段路径' as const, value: 'amount' },
    { field: '字段路径' as const, value: 'a..b' },
    { field: '字段路径' as const, value: '__proto__.name' },
    { field: '字段路径' as const, value: 'a.constructor.b' },
    { field: '字段路径' as const, value: 'prototype' },
    { field: '标题' as const, value: '' },
    { field: '标题' as const, value: '   ' },
    { field: '宽度' as const, value: '23.99' },
    { field: '宽度' as const, value: 'bad-number' },
    { field: '宽度' as const, value: 'Infinity' },
    { field: '宽度' as const, value: '1e309' },
  ])(
    '$field=$value rejects whole Apply without a partial publication or input loss',
    ({ field, value }) => {
      const { author } = tableHarness();
      const before = author.getSnapshot();
      const command = vi.spyOn(author, 'setProp');
      edit(1, field, value);
      fireEvent.click(applyColumns());
      expect(author.getSnapshot()).toBe(before);
      expect(command).not.toHaveBeenCalled();
      expect(columnInput(1, field).value).toBe(value);
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
      edit(
        1,
        field,
        field === '字段路径' ? 'fixed.name' : field === '标题' ? 'Fixed title' : '24.5',
      );
      fireEvent.click(applyColumns());
      expect(command).toHaveBeenCalledOnce();
    },
  );

  it('deleting all columns leaves an empty draft and existing nonempty rule rejects Apply', () => {
    const { author } = tableHarness();
    const before = author.getSnapshot();
    fireEvent.click(button('删除列 2'));
    fireEvent.click(button('删除列 1'));
    expect(rows()).toHaveLength(0);
    fireEvent.click(applyColumns());
    expect(rows()).toHaveLength(0);
    expect(author.getSnapshot()).toBe(before);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});

describe('rows and advanced JSON share one explicit-Apply draft', () => {
  it('conversions carry current unsaved content and extras without ever publishing', () => {
    const { author } = tableHarness();
    const before = author.getSnapshot();
    edit(1, '标题', 'Rows draft');
    fireEvent.click(button('JSON 编辑列'));
    expect(JSON.parse(jsonColumns().value)[0].title).toBe('Rows draft');
    fireEvent.change(jsonColumns(), {
      target: { value: '[{"key":"raw","title":"JSON draft","future":{"keep":[1,null]}}]' },
    });
    fireEvent.click(button('结构化编辑列'));
    expect(columnInput(1, '标题').value).toBe('JSON draft');
    expect(author.getSnapshot()).toBe(before);
    edit(1, '标题', 'Final draft');
    fireEvent.click(applyColumns());
    expect(acceptedColumns(author)).toEqual([
      { key: 'raw', title: 'Final draft', future: { keep: [1, null] } },
    ]);
  });

  it('incomplete JSON cannot switch to rows or Apply and retains its exact text/error', () => {
    const { author } = tableHarness();
    const before = author.getSnapshot();
    fireEvent.click(button('JSON 编辑列'));
    const text = '[{"key": "unfinished';
    fireEvent.change(jsonColumns(), { target: { value: text } });
    fireEvent.click(button('结构化编辑列'));
    expect(jsonColumns().value).toBe(text);
    expect(screen.queryByRole('textbox', { name: '列 1 字段路径' })).toBeNull();
    fireEvent.click(applyColumns());
    expect(jsonColumns().value).toBe(text);
    expect(author.getSnapshot()).toBe(before);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it.each([
    { value: [{ key: 'name', title: 'Name', width: null }] },
    { value: [{ key: 'name', title: 'Name', sortable: 'false' }] },
    { value: [{ key: 'name', title: 'Name', align: 'diagonal' }] },
  ])('invalid known-field JSON $value keeps raw bytes and publishes nothing', ({ value }) => {
    const { author } = tableHarness();
    const before = author.getSnapshot();
    fireEvent.click(button('JSON 编辑列'));
    const raw = JSON.stringify(value);
    fireEvent.change(jsonColumns(), { target: { value: raw } });
    fireEvent.click(applyColumns());
    expect(author.getSnapshot()).toBe(before);
    expect(jsonColumns().value).toBe(raw);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('invalid nonempty raw width refuses rows-to-JSON conversion without losing inputs', () => {
    const { author } = tableHarness();
    const before = author.getSnapshot();
    edit(1, '宽度', 'not yet a number');
    fireEvent.click(button('JSON 编辑列'));
    expect(columnInput(1, '宽度').value).toBe('not yet a number');
    expect(screen.queryByRole('textbox', { name: '表格列 JSON' })).toBeNull();
    expect(author.getSnapshot()).toBe(before);
  });

  it('noncanonical but runtime-accepted align arrays stay raw and Apply without coercion', () => {
    const { author } = tableHarness({
      columns: [{ key: 'name', title: 'Name', align: ['left'], future: { retained: true } }],
    });
    expect(JSON.parse(jsonColumns().value)[0].align).toEqual(['left']);
    fireEvent.click(button('结构化编辑列'));
    expect(JSON.parse(jsonColumns().value)[0].align).toEqual(['left']);
    const next = JSON.parse(jsonColumns().value);
    next[0].title = 'Raw accepted edit';
    fireEvent.change(jsonColumns(), { target: { value: JSON.stringify(next) } });
    fireEvent.click(applyColumns());
    expect(acceptedColumns(author)).toEqual(next);
  });

  it.each([
    { value: null },
    { value: { unexpected: 'not an array' } },
    { value: [{ key: 'missing-title' }] },
  ])(
    'incoming unrepresentable $value is shown intact as raw JSON,never an empty row projection',
    ({ value }) => {
      const { commit } = literalColumnsHarness({ value: value as Json });
      expect(JSON.parse(jsonColumns().value)).toEqual(value);
      expect(screen.queryByRole('textbox', { name: '列 1 字段路径' })).toBeNull();
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it('dirty JSON survives selection return and unrelated plan changes', () => {
    const { author } = tableHarness();
    fireEvent.click(button('JSON 编辑列'));
    fireEvent.change(jsonColumns(), { target: { value: '[{"raw":' } });
    act(() => author.select('a', 'alpha'));
    act(() => author.select('a', 'table'));
    expect(jsonColumns().value).toBe('[{"raw":');
    act(() => author.renamePage('b', 'Unrelated page change'));
    expect(jsonColumns().value).toBe('[{"raw":');
    expect(screen.queryByText(/当前定义已变化/)).toBeNull();
  });
});

describe('explicit source conflict and keyed focus behavior', () => {
  it('conflict rebase publishes nothing and next Apply intentionally replaces the entire latest array', () => {
    const { author } = tableHarness();
    edit(1, '标题', 'Local draft');
    act(() =>
      author.setProp(
        'a',
        'table',
        'columns',
        lit([{ key: 'remote', title: 'Remote', future: 'must not silently merge' }]),
      ),
    );
    const changed = author.getSnapshot();
    expect(columnInput(1, '标题').value).toBe('Local draft');
    expect(applyColumns().hasAttribute('disabled')).toBe(true);
    fireEvent.click(button('确认使用草稿'));
    expect(author.getSnapshot()).toBe(changed);
    fireEvent.click(applyColumns());
    expect(acceptedColumns(author)).toEqual([
      { key: 'name', title: 'Local draft' },
      baseColumns[1],
    ]);
  });

  it('explicit discard uses latest accepted source and removes dirty conflict', () => {
    const { author } = tableHarness();
    edit(1, '标题', 'Discard me');
    act(() => author.setProp('a', 'table', 'columns', lit([{ key: 'remote', title: 'Latest' }])));
    fireEvent.click(within(columnsGroup()).getByRole('button', { name: '放弃草稿' }));
    expect(columnInput(1, '字段路径').value).toBe('remote');
    expect(columnInput(1, '标题').value).toBe('Latest');
    expect(applyColumns().hasAttribute('disabled')).toBe(true);
  });

  it('editing key and keyed reorder keep the same physical inputs and focused move control', () => {
    tableHarness();
    const input = columnInput(1, '字段路径');
    const row = rows()[0];
    input.focus();
    edit(1, '字段路径', 'renamed.path');
    expect(columnInput(1, '字段路径')).toBe(input);
    expect(rows()[0]).toBe(row);
    expect(document.activeElement).toBe(input);
    const down = button('下移列 1');
    down.focus();
    fireEvent.click(down);
    expect(columnInput(2, '字段路径')).toBe(input);
    expect(rows()[1]).toBe(row);
    expect(document.activeElement).toBe(down);
  });

  it('visible boundary move controls are exact draft no-ops and preserve focused control identity', () => {
    const h = tableHarness();
    edit(1, '标题', 'Boundary dirty draft');
    const before = h
      .session()
      .drafts.read('table-columns:a/table/columns', JSON.stringify(baseColumns), {});
    for (const name of ['上移列 1', '下移列 2']) {
      const control = button(name);
      control.focus();
      fireEvent.click(control);
      expect(
        h.session().drafts.read('table-columns:a/table/columns', JSON.stringify(baseColumns), {}),
      ).toBe(before);
      expect(document.activeElement).toBe(control);
    }
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('removing the focused row hands focus to a surviving key then Add without timers', () => {
    tableHarness();
    const remove = button('删除列 1');
    remove.focus();
    fireEvent.click(remove);
    expect(document.activeElement).toBe(columnInput(1, '字段路径'));
    const last = button('删除列 1');
    last.focus();
    fireEvent.click(last);
    expect(document.activeElement).toBe(button('添加列'));
  });
});
