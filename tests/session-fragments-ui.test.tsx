import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  savedAction,
  savedAuthor,
  savedHarness,
  savedInput,
  savedRow,
  savedSave,
  savedType,
} from './session-fragments-fixture';
import { expression } from './clipboard-fixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function save(name: string) {
  savedType(name);
  fireEvent.click(savedSave());
}
describe('named session fragments use the actual material panel and BaseUI confirmation', () => {
  it('materials renderer supplies real context, saves two snapshots and alternates cross-page insertion without replacing clipboard', () => {
    const doc = savedAuthor();
    doc.copyNodeToClipboard('source', 'source-text');
    const clip = doc.getClipboardSnapshot(),
      initial = doc.getSnapshot();
    const h = savedHarness(doc, { throughRenderer: true });
    save('One');
    expect(doc.getSnapshot()).toBe(initial);
    expect(savedInput().value).toBe('');
    expect(screen.getByRole('status').textContent).toContain('已保存');
    act(() => doc.select('source', 'source-frame'));
    save('Two');
    expect(doc.getSavedFragmentsSnapshot().items.map((item) => item.name)).toEqual(['One', 'Two']);
    act(() => doc.selectPage('target'));
    const before = doc.exportJson(),
      selection = doc.getSnapshot().selection;
    fireEvent.click(savedAction('One', 'insert'));
    const first = doc.getSnapshot().selection;
    expect(first.nodeIds).toHaveLength(2);
    expect(first.nodeId).toBe(first.nodeIds![0]);
    expect(screen.getByRole('status').textContent).toContain('已插入');
    act(() => doc.undo());
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().selection).toEqual(selection);
    act(() => doc.redo());
    fireEvent.click(savedAction('Two', 'insert'));
    expect(doc.getSnapshot().selection).not.toHaveProperty('nodeIds');
    expect(doc.getClipboardSnapshot()).toBe(clip);
    const clipId = doc.pasteClipboard('target');
    expect(doc.getSnapshot().selection.nodeId).toBe(clipId);
    expect(doc.getSnapshot().plan.pages.get('target')!.schema.children.at(-1)!.props.value).toEqual(
      { kind: 'literal', value: 'Copied content' },
    );
    expect(h.author).toBe(doc);
  });
  it.each(['no-props', 'partial-context'] as const)(
    'compatible %s InsertPanel retains palette/search without granting fragment mutation',
    (kind) => {
      const h = savedHarness(
        undefined,
        kind === 'no-props' ? { noProps: true } : { partial: true },
      );
      expect(screen.getByRole('textbox', { name: '搜索物料' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '拖入 文本' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '保存所选' })).toBeNull();
      fireEvent.change(screen.getByRole('textbox', { name: '搜索物料' }), {
        target: { value: '不存在物料' },
      });
      expect(screen.getByText('没有匹配的物料')).toBeTruthy();
      expect(h.author.getSavedFragmentsSnapshot()).toEqual({ items: [] });
    },
  );
  it('catalog search does not hide saved snapshots and no native title or new saved drag source is introduced', () => {
    const doc = savedAuthor();
    doc.saveFragment('source', ['source-text'], 'Named');
    savedHarness(doc);
    fireEvent.change(screen.getByRole('textbox', { name: '搜索物料' }), {
      target: { value: '不存在物料' },
    });
    expect(savedRow('Named')).toBeTruthy();
    expect(savedAction('Named', 'insert')).toBeTruthy();
    expect(savedRow('Named').querySelector('[title]')).toBeNull();
    expect(savedRow('Named').querySelector('.drag-handle')).toBeNull();
    expect(screen.getByText(/导入应用文件会保留会话片段/)).toBeTruthy();
  });
  it('forty supplementary characters save intact without HTML UTF16 limit', () => {
    const h = savedHarness(),
      name = '😀'.repeat(40);
    expect(savedInput().maxLength).not.toBe(40);
    save(name);
    expect(h.author.getSavedFragmentsSnapshot().items[0].name).toBe(name);
    expect(savedInput().value).toBe('');
  });
  it('duplicate and mixed-invalid save keep the draft and prior snapshots with owned error feedback', () => {
    const h = savedHarness();
    save('Good');
    const initial = h.author.getSavedFragmentsSnapshot();
    savedType(' Good ');
    fireEvent.click(savedSave());
    expect(h.author.getSavedFragmentsSnapshot()).toBe(initial);
    expect(savedInput().value).toBe(' Good ');
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => h.author.setProp('source', 'source-text', 'value', expression('"bound"')));
    savedType('Mixed');
    fireEvent.click(savedSave());
    expect(h.author.getSavedFragmentsSnapshot()).toBe(initial);
    expect(savedInput().value).toBe('Mixed');
    expect(screen.getByRole('alert').textContent).toMatch(/绑定|静态/);
  });
  it('draft survives selection, page, mode, panel remount and document roundtrips with per-document isolation', () => {
    const h = savedHarness(),
      other = savedAuthor();
    savedType('First draft');
    act(() => h.author.selectPage('target'));
    expect(savedInput().value).toBe('First draft');
    h.view.rerender(h.tree(h.author, false));
    h.view.rerender(h.tree());
    expect(savedInput().value).toBe('First draft');
    h.view.rerender(h.tree(h.author, true, true, false));
    h.view.rerender(h.tree());
    expect(savedInput().value).toBe('First draft');
    h.view.rerender(h.tree(other));
    expect(savedInput().value).toBe('');
    savedType('Second draft');
    h.view.rerender(h.tree());
    expect(savedInput().value).toBe('First draft');
    h.view.rerender(h.tree(other));
    expect(savedInput().value).toBe('Second draft');
  });
  it.each(['fresh', 'ABA'] as const)(
    'save observer replacing name with %s text keeps the newer draft',
    (kind) => {
      const h = savedHarness();
      savedType('Submitted');
      let observed = false;
      const stop = h.author.subscribeSavedFragments(() => {
        if (observed) return;
        observed = true;
        flushSync(() => savedType('Changed'));
        if (kind === 'ABA') flushSync(() => savedType('Submitted'));
      });
      fireEvent.click(savedSave());
      stop();
      expect(observed).toBe(true);
      expect(h.author.getSavedFragmentsSnapshot().items).toHaveLength(1);
      expect(savedInput().value).toBe(kind === 'ABA' ? 'Submitted' : 'Changed');
    },
  );
  it('actual AlertDialog Cancel is initially focused, cancel preserves collection and confirm never deletes inserted copies', async () => {
    const h = savedHarness();
    save('Delete me');
    fireEvent.click(savedAction('Delete me', 'insert'));
    const inserted = h.author.exportJson(),
      before = h.author.getSavedFragmentsSnapshot();
    savedType('Keep draft');
    fireEvent.click(savedAction('Delete me', 'remove'));
    let dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/撤销|Undo/);
    expect(dialog.textContent).toMatch(/插入/);
    const cancel = within(dialog).getByRole('button', { name: /取消/ });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    expect(h.author.getSavedFragmentsSnapshot()).toBe(before);
    expect(savedInput().value).toBe('Keep draft');
    fireEvent.click(savedAction('Delete me', 'remove'));
    dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /删除|确认/ }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(h.author.getSavedFragmentsSnapshot().items).toHaveLength(0);
    expect(h.author.exportJson()).toBe(inserted);
    expect(savedInput().value).toBe('Keep draft');
    expect(screen.getByRole('status').textContent).toContain('已删除');
  });
  it.each(['preview', 'code', 'active', 'disabled-provider'] as const)(
    'author controls refuse %s and retain draft/item',
    (kind) => {
      const doc = savedAuthor();
      doc.saveFragment('source', ['source-text'], 'Existing');
      const h = savedHarness(doc);
      savedType('Draft');
      if (kind === 'preview') h.view.rerender(h.tree(doc, false));
      else if (kind === 'disabled-provider') h.view.rerender(h.tree(doc, true, false));
      else if (kind === 'code')
        act(() =>
          doc.setPageCode('source', {
            ...doc.getSnapshot().plan.pages.get('source')!.schema.code!,
            enabled: true,
          }),
        );
      else act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
      const initial = doc.getSavedFragmentsSnapshot(),
        before = doc.getSnapshot();
      fireEvent.click(savedSave());
      fireEvent.click(savedAction('Existing', 'insert'));
      fireEvent.click(savedAction('Existing', 'remove'));
      expect(doc.getSavedFragmentsSnapshot()).toBe(initial);
      expect(doc.getSnapshot()).toBe(before);
      expect(savedInput().value).toBe('Draft');
      expect(screen.queryByRole('alertdialog')).toBeNull();
    },
  );
  it('native inputs retain C/V and arrow keys without a new author keyboard owner', () => {
    const h = savedHarness(),
      before = h.author.getSnapshot();
    for (const control of [
      savedInput(),
      screen.getByLabelText('Saved external input'),
      screen.getByLabelText('Saved external code'),
    ])
      for (const key of ['c', 'v', 'ArrowLeft', 'Home']) {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: key.length === 1,
          bubbles: true,
          cancelable: true,
        });
        fireEvent(control, event);
        expect(event.defaultPrevented).toBe(false);
      }
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.getSavedFragmentsSnapshot().items).toHaveLength(0);
  });
});
