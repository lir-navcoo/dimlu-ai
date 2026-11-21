import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { registry } from '../src/materials';
import { changeControl } from './ui-helpers';
import {
  savedAuthor,
  savedHarness,
  savedInput,
  savedRow,
  savedType,
} from './session-fragments-fixture';

afterEach(cleanup);
const input = () => screen.getByRole('textbox', { name: '搜索物料' }) as HTMLInputElement;
const search = (query: string) => fireEvent.change(input(), { target: { value: query } });
const tiles = () => screen.queryAllByRole('button', { name: /^拖入 / });
const tileNames = () => tiles().map((tile) => tile.getAttribute('aria-label'));

describe('material identifier search through the actual palette', () => {
  it('discovers technical IDs while preserving Chinese discovery, legacy exclusions and original empty-query order', () => {
    const h = savedHarness();
    const snapshot = h.author.getSnapshot();
    const original = tileNames();
    expect(original).toContain('拖入 数据表格');
    expect(original).toContain('拖入 文本输入');
    for (const query of ['ui.table', 'table', 'TABLE', '  Ui.TaBlE  ', '数据表格']) {
      search(query);
      expect(tileNames()).toEqual(['拖入 数据表格']);
      expect(input().value).toBe(query);
    }
    search('输入');
    expect(tileNames()).toContain('拖入 文本输入');
    expect(tileNames()).toContain('拖入 数字输入');
    expect(tileNames()).not.toContain('拖入 数据表格');
    search('布局');
    expect(tileNames()).toContain('拖入 布局容器');
    expect(tileNames()).toContain('拖入 表单容器');
    for (const component of [
      'ui.summary',
      'ui.record',
      'react.counter',
      'react.purchaseItems',
      'ui.formStatus',
    ]) {
      expect(registry.components[component]).toBeTruthy();
      search(component);
      expect(tiles()).toHaveLength(0);
      expect(screen.getByText('没有匹配的物料')).toBeTruthy();
    }
    search('.*');
    expect(tiles()).toHaveLength(0);
    expect(screen.getByText('没有匹配的物料')).toBeTruthy();
    for (const query of ['', '   ']) {
      search(query);
      expect(tileNames()).toEqual(original);
      expect(input().value).toBe(query);
    }
    expect(h.author.getSnapshot()).toBe(snapshot);
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('retains verbatim session search and independent fragment name/library across real panel returns', () => {
    const author = savedAuthor();
    author.saveFragment('source', ['source-text'], 'Kept fragment');
    author.copyNodeToClipboard('source', 'source-text');
    const h = savedHarness(author);
    savedType('Unapplied fragment name');
    const library = author.getSavedFragmentsSnapshot();
    const clipboard = author.getClipboardSnapshot();
    const snapshot = author.getSnapshot();
    const draft = '  Ui.TaBlE  ';
    search(draft);
    h.view.rerender(h.tree(author, true, true, false));
    h.view.rerender(h.tree());
    expect(input().value).toBe(draft);
    expect(tileNames()).toEqual(['拖入 数据表格']);
    expect(savedInput().value).toBe('Unapplied fragment name');
    expect(savedRow('Kept fragment')).toBeTruthy();
    search('no material with this name');
    expect(screen.getByText('没有匹配的物料')).toBeTruthy();
    expect(savedRow('Kept fragment')).toBeTruthy();
    search('');
    expect(savedInput().value).toBe('Unapplied fragment name');
    expect(author.getSavedFragmentsSnapshot()).toBe(library);
    expect(author.getClipboardSnapshot()).toBe(clipboard);
    expect(author.getSnapshot()).toBe(snapshot);
    expect(author.getSnapshot().canUndo).toBe(false);
  });

  it('inserts the actual filtered DragHandle material through keyboard placement and undoes once without clearing drafts', () => {
    const author = savedAuthor();
    author.saveFragment('source', ['source-text'], 'Kept fragment');
    const h = savedHarness(author);
    savedType('Kept name draft');
    const library = author.getSavedFragmentsSnapshot();
    const before = author.getSnapshot();
    const exported = author.exportJson();
    search(' UI.TABLE ');
    fireEvent.keyDown(screen.getByRole('button', { name: '拖入 数据表格' }), { key: ' ' });
    expect(h.drag().session?.source).toEqual({ kind: 'material', component: 'ui.table' });
    expect(author.getSnapshot()).toBe(before);
    changeControl(
      screen.getByRole('combobox', { name: '拖放位置' }),
      JSON.stringify({ kind: 'inside' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
    expect(author.getSnapshot().revision).toBe(before.revision + 1);
    const inserted = author.getSnapshot().plan.pages.get('source')!.schema.children.at(-1)!;
    expect(inserted.component).toBe('ui.table');
    expect(inserted.props.columns.kind).toBe('literal');
    expect(author.getSnapshot().canUndo).toBe(true);
    expect(input().value).toBe(' UI.TABLE ');
    expect(savedInput().value).toBe('Kept name draft');
    act(() => author.undo());
    expect(author.exportJson()).toBe(exported);
    expect(author.getSnapshot().selection).toEqual(before.selection);
    expect(author.getSnapshot().canUndo).toBe(false);
    expect(author.getSavedFragmentsSnapshot()).toBe(library);
    expect(input().value).toBe(' UI.TABLE ');
    expect(savedInput().value).toBe('Kept name draft');
    expect(savedRow('Kept fragment')).toBeTruthy();
  });
});
