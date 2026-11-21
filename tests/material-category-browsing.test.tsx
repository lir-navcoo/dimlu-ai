import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog } from '../src/editor/catalog';
import type { MaterialMetadata } from '../packages/editor/metadata';
import {
  savedAuthor,
  savedHarness,
  savedInput,
  savedPointer,
  savedRow,
  savedSave,
  savedType,
} from './session-fragments-fixture';

const originals = new Map<string, MaterialMetadata>();
function metadata(id: string, patch: Partial<MaterialMetadata>) {
  if (!originals.has(id)) originals.set(id, catalog[id]);
  catalog[id] = { ...catalog[id], ...patch };
}
afterEach(() => {
  cleanup();
  for (const [id, original] of originals) catalog[id] = original;
  originals.clear();
  vi.restoreAllMocks();
});

const searchInput = () => screen.getByRole('textbox', { name: '搜索物料' }) as HTMLInputElement;
const search = (value: string) => fireEvent.change(searchInput(), { target: { value } });
const categoryGroup = () => screen.getByRole('group', { name: '物料分类' });
const all = () => within(categoryGroup()).getByRole('button', { name: '查看全部物料' });
const category = (name: string) =>
  within(categoryGroup()).getByRole('button', { name: `筛选分类：${name}` });
const tileNames = () =>
  screen
    .queryAllByRole('button', { name: /^拖入 / })
    .map((tile) => tile.getAttribute('aria-label'));
const selected = () =>
  within(categoryGroup())
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true');

describe('material category browsing through the actual retained palette', () => {
  it('derives ordered visible categories and preserves distinct raw unknown, All-named and whitespace identities without author mutations', () => {
    const h = savedHarness();
    const before = h.author.getSnapshot();
    const exported = h.author.exportJson();
    const library = h.author.getSavedFragmentsSnapshot();
    const clipboard = h.author.getClipboardSnapshot();
    const originalTiles = tileNames();
    expect(selected()).toEqual([all()]);
    expect(
      within(categoryGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['全部', '布局', '基础', '输入', '展示', '表单', '数据', '反馈']);
    fireEvent.click(category('输入'));
    expect(selected()).toEqual([category('输入')]);
    expect(tileNames()).toContain('拖入 文本输入');
    expect(tileNames()).toContain('拖入 数字输入');
    expect(tileNames()).not.toContain('拖入 标题');
    expect(tileNames()).not.toContain('拖入 数据表格');
    expect(tileNames()).toEqual(originalTiles.filter((name) => tileNames().includes(name)));
    fireEvent.click(all());
    expect(tileNames()).toEqual(originalTiles);

    metadata('ui.heading', { category: '全部' });
    metadata('ui.text', { category: 'null' });
    metadata('ui.button', { category: ' ' });
    metadata('ui.badge', { category: '  ' });
    metadata('ui.link', { category: '未来未知分类' });
    metadata('ui.summary', { category: '仅隐藏展示分类' });
    metadata('ui.formStatus', { category: '仅不可插入分类' });
    h.view.rerender(h.tree());
    expect([...tileNames()].sort()).toEqual([...originalTiles].sort());
    expect(
      within(categoryGroup())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      '全部',
      '布局',
      '全部',
      'null',
      '输入',
      '未命名分类',
      '未命名分类',
      '展示',
      '表单',
      '未来未知分类',
      '数据',
      '反馈',
    ]);
    expect(screen.queryByRole('button', { name: /仅隐藏展示分类|仅不可插入分类/ })).toBeNull();
    expect(screen.queryByRole('button', { name: '拖入 摘要' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拖入 表单状态' })).toBeNull();
    fireEvent.click(category('全部'));
    expect(tileNames()).toEqual(['拖入 标题']);
    expect(selected()).toEqual([category('全部')]);
    expect(all().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(category('null'));
    expect(tileNames()).toEqual(['拖入 文本']);
    expect(h.session().drafts.read('ui:materials/category', 'ui', null).value).toBe('null');
    const unnamed = within(categoryGroup()).getAllByRole('button', {
      name: '筛选分类：未命名分类',
    });
    for (const [index, raw, tile] of [
      [0, ' ', '拖入 按钮'],
      [1, '  ', '拖入 标签'],
    ] as const) {
      fireEvent.click(unnamed[index]);
      expect(tileNames()).toEqual([tile]);
      expect(h.session().drafts.read('ui:materials/category', 'ui', null).value).toBe(raw);
    }
    fireEvent.click(category('未来未知分类'));
    expect(tileNames()).toEqual(['拖入 链接']);
    expect(h.session().drafts.read('ui:materials/category', 'ui', null).value).toBe('未来未知分类');
    expect(categoryGroup().querySelector('[title]')).toBeNull();
    fireEvent.click(all());
    expect([...tileNames()].sort()).toEqual([...originalTiles].sort());
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.exportJson()).toBe(exported);
    expect(h.author.getSavedFragmentsSnapshot()).toBe(library);
    expect(h.author.getClipboardSnapshot()).toBe(clipboard);
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('intersects raw ID search with categories and resets only the category while retaining actual search and FragmentPanel DOM and local feedback', () => {
    const author = savedAuthor();
    author.saveFragment('source', ['source-text'], 'Kept fragment');
    author.copyNodeToClipboard('source', 'source-text');
    const h = savedHarness(author);
    savedType('Kept fragment');
    fireEvent.click(savedSave());
    const feedback = screen.getByRole('alert');
    const feedbackText = feedback.textContent;
    savedType('Unapplied fragment draft');
    const fragmentInput = savedInput();
    const fragmentId = fragmentInput.id;
    const fragmentPanel = screen.getByRole('region', { name: '会话片段' });
    const input = searchInput();
    const before = author.getSnapshot();
    const library = author.getSavedFragmentsSnapshot();
    const clipboard = author.getClipboardSnapshot();
    const buttonLabels = within(categoryGroup())
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    fireEvent.click(category('数据'));
    search('  Ui.TaBlE  ');
    input.focus();
    input.setSelectionRange(3, 7);
    expect(tileNames()).toEqual(['拖入 数据表格']);
    fireEvent.click(category('输入'));
    expect(tileNames()).toEqual([]);
    expect(screen.getByText('当前分类没有匹配的物料')).toBeTruthy();
    expect(selected()).toEqual([category('输入')]);
    expect(
      within(categoryGroup())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(buttonLabels);
    expect(savedRow('Kept fragment')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '查看全部分类' }));
    expect(selected()).toEqual([all()]);
    expect(tileNames()).toEqual(['拖入 数据表格']);
    expect(searchInput()).toBe(input);
    expect(input.value).toBe('  Ui.TaBlE  ');
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 7]);
    expect(savedInput()).toBe(fragmentInput);
    expect(fragmentInput.id).toBe(fragmentId);
    expect(fragmentInput.value).toBe('Unapplied fragment draft');
    expect(screen.getByRole('region', { name: '会话片段' })).toBe(fragmentPanel);
    expect(screen.getByRole('alert')).toBe(feedback);
    expect(feedback.textContent).toBe(feedbackText);
    fireEvent.click(category('数据'));
    const retainedTable = screen.getByRole('button', { name: '拖入 数据表格' });
    fireEvent.click(all());
    expect(screen.getByRole('button', { name: '拖入 数据表格' })).toBe(retainedTable);
    expect(author.getSnapshot()).toBe(before);
    expect(author.getSavedFragmentsSnapshot()).toBe(library);
    expect(author.getClipboardSnapshot()).toBe(clipboard);
  });

  it('retains session browsing across panel returns, projects stale values without repair writes and refuses category/reset changes during pending or active drag', () => {
    const author = savedAuthor();
    author.saveFragment('source', ['source-text'], 'Kept fragment');
    const h = savedHarness(author);
    savedType('Kept name draft');
    fireEvent.click(category('输入'));
    search('  Ui.TaBlE  ');
    h.view.rerender(h.tree(author, true, true, false));
    h.view.rerender(h.tree());
    expect(selected()).toEqual([category('输入')]);
    expect(searchInput().value).toBe('  Ui.TaBlE  ');
    expect(tileNames()).toEqual([]);
    expect(savedInput().value).toBe('Kept name draft');
    const before = author.getSnapshot();
    const library = author.getSavedFragmentsSnapshot();
    const clipboard = author.getClipboardSnapshot();
    const seed = (value: unknown) => {
      act(() =>
        h.session().drafts.write('ui:materials/category', { value, source: 'ui', dirty: true }),
      );
    };
    for (const stale of ['不存在分类', { category: '输入' }]) {
      seed(stale);
      const write = vi.spyOn(h.session().drafts, 'write');
      h.view.rerender(h.tree());
      expect(selected()).toEqual([all()]);
      expect(tileNames()).toEqual(['拖入 数据表格']);
      expect(searchInput().value).toBe('  Ui.TaBlE  ');
      expect(h.session().drafts.read('ui:materials/category', 'ui', null).value).toBe(stale);
      expect(write).not.toHaveBeenCalled();
      write.mockRestore();
    }
    fireEvent.click(category('输入'));
    const reset = screen.getByRole('button', { name: '查看全部分类' });
    h.duringPending(() => {
      expect(h.drag().isInteracting).toBe(true);
      fireEvent.click(category('数据'));
      fireEvent.click(all());
      fireEvent.click(reset);
      expect(selected()).toEqual([category('输入')]);
    });
    fireEvent(screen.getByRole('button', { name: 'Prepare saved pointer' }), savedPointer());
    act(() => h.drag().cancel());
    act(() => h.drag().begin({ kind: 'material', component: 'ui.input' }));
    expect(category('数据').hasAttribute('disabled')).toBe(true);
    fireEvent.click(category('数据'));
    fireEvent.click(reset);
    expect(selected()).toEqual([category('输入')]);
    act(() => h.drag().cancel());
    fireEvent.click(reset);
    expect(selected()).toEqual([all()]);
    expect(tileNames()).toEqual(['拖入 数据表格']);
    expect(searchInput().value).toBe('  Ui.TaBlE  ');
    expect(savedInput().value).toBe('Kept name draft');
    expect(savedRow('Kept fragment')).toBeTruthy();
    expect(author.getSnapshot()).toBe(before);
    expect(author.getSavedFragmentsSnapshot()).toBe(library);
    expect(author.getClipboardSnapshot()).toBe(clipboard);
  });
});
