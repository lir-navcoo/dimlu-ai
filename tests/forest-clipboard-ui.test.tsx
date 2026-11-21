import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  forestAuthor,
  forestCopy,
  forestHarness,
  forestItem,
  forestPaste,
} from './forest-clipboard-fixture';
import { expression } from './clipboard-fixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function activate(name: string) {
  fireEvent.click(await forestItem(name));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}
describe('forest clipboard existing BaseUI menu', () => {
  it('copies raw multi, shows roots and total, pastes page-end once and restores full selection with Undo/Redo', async () => {
    const h = forestHarness(),
      initial = h.author.getSnapshot(),
      main = vi.fn(),
      clip = vi.fn();
    h.author.subscribe(main);
    h.author.subscribeClipboard(clip);
    expect((await forestItem(forestCopy)).getAttribute('aria-disabled')).not.toBe('true');
    await activate(forestCopy);
    expect(h.author.getSnapshot()).toBe(initial);
    expect(main).not.toHaveBeenCalled();
    expect(clip).toHaveBeenCalledTimes(1);
    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0].error).toBe(false);
    expect(h.author.getClipboardSnapshot()).toEqual({
      available: true,
      nodeCount: 3,
      rootCount: 2,
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
    });
    act(() => h.author.selectPage('target'));
    const before = h.author.exportJson(),
      prior = h.author.getSnapshot().selection;
    await forestItem(forestPaste);
    expect(screen.getByText(/源页面.*2.*3.*组件/)).toBeTruthy();
    await activate(forestPaste);
    const roots = h.author.getSnapshot().plan.pages.get('target')!.schema.children;
    expect(roots.map((root) => root.component)).toEqual(['ui.text', 'ui.text', 'ui.card']);
    const ids = roots.slice(1).map((root) => root.id);
    expect(h.author.getSnapshot().selection).toEqual({
      pageId: 'target',
      nodeId: ids[0],
      nodeIds: ids,
    });
    expect(h.feedback).toHaveLength(2);
    expect(h.feedback[1].error).toBe(false);
    act(() => h.author.undo());
    expect(h.author.exportJson()).toBe(before);
    expect(h.author.getSnapshot().selection).toEqual(prior);
    act(() => h.author.redo());
    expect(h.author.getSnapshot().selection.nodeId).toBe(ids[0]);
  });
  it('ancestor-descendant multi reduces to legacy singleton summary and feedback', async () => {
    const doc = forestAuthor();
    doc.selectMany('source', ['source-frame', 'source-text'], 'source-text');
    const h = forestHarness(doc);
    await activate(forestCopy);
    expect(doc.getClipboardSnapshot()).toEqual({
      available: true,
      nodeCount: 4,
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
      component: 'ui.layout',
    });
    expect(h.feedback[0].message).toContain('已复制组件到当前会话剪贴板');
    await forestItem(forestPaste);
    expect(screen.getByText(/源页面.*布局容器.*4 个组件/)).toBeTruthy();
  });
  it('mixed-invalid raw selection emits a visible owned error while retaining prior copy and source selection', async () => {
    const doc = forestAuthor();
    doc.copyNodeToClipboard('source', 'source-frame');
    doc.setProp('source', 'source-text', 'value', expression('"bound"'));
    const h = forestHarness(doc),
      before = doc.getSnapshot(),
      summary = doc.getClipboardSnapshot();
    await activate(forestCopy);
    expect(h.feedback).toHaveLength(1);
    expect(h.feedback[0].error).toBe(true);
    expect(h.feedback[0].message).toMatch(/绑定|静态/);
    expect(doc.getSnapshot()).toBe(before);
    expect(doc.getClipboardSnapshot()).toBe(summary);
  });
  it('empty selection disables copy but a preexisting forest pastes into an empty page', async () => {
    const doc = forestAuthor();
    doc.copyNodesToClipboard('source', ['source-text', 'source-card']);
    doc.removeNode('target', 'target-existing');
    doc.selectPage('target');
    const h = forestHarness(doc);
    expect((await forestItem(forestCopy)).getAttribute('aria-disabled')).toBe('true');
    expect((await forestItem(forestPaste)).getAttribute('aria-disabled')).not.toBe('true');
    await activate(forestPaste);
    expect(doc.getSnapshot().plan.pages.get('target')!.schema.children).toHaveLength(2);
    expect(h.feedback[0].error).toBe(false);
  });
  it.each(['preview', 'code', 'active', 'disabled-provider'] as const)(
    'denies author clipboard in %s',
    async (kind) => {
      const h = forestHarness();
      act(() => h.author.copyNodesToClipboard('source', ['source-text', 'source-card']));
      if (kind === 'preview') h.view.rerender(h.tree(h.author, false));
      else if (kind === 'disabled-provider') h.view.rerender(h.tree(h.author, true, false));
      else if (kind === 'code')
        act(() =>
          h.author.setPageCode('source', {
            ...h.author.getSnapshot().plan.pages.get('source')!.schema.code!,
            enabled: true,
          }),
        );
      else act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
      const before = h.author.getSnapshot(),
        summary = h.author.getClipboardSnapshot();
      expect((await forestItem(forestCopy)).getAttribute('aria-disabled')).toBe('true');
      expect((await forestItem(forestPaste)).getAttribute('aria-disabled')).toBe('true');
      expect(h.author.getSnapshot()).toBe(before);
      expect(h.author.getClipboardSnapshot()).toBe(summary);
      expect(h.feedback).toHaveLength(0);
    },
  );
  it('uses no native title and leaves input/code draft keyboard and content untouched', async () => {
    const h = forestHarness(),
      before = h.author.getSnapshot();
    for (const label of ['Forest native input', 'Forest native code'])
      for (const key of ['c', 'v'])
        for (const modifier of ['ctrlKey', 'metaKey']) {
          const target = screen.getByLabelText(label) as HTMLInputElement;
          const value = target.value,
            event = new KeyboardEvent('keydown', {
              key,
              [modifier]: true,
              bubbles: true,
              cancelable: true,
            });
          fireEvent(target, event);
          expect(event.defaultPrevented).toBe(false);
          expect(target.value).toBe(value);
        }
    await forestItem(forestCopy);
    expect(screen.getByRole('menu').querySelectorAll('[title]')).toHaveLength(0);
    await activate(forestCopy);
    expect(h.author.getSnapshot()).toBe(before);
    expect((screen.getByLabelText('Forest native code') as HTMLTextAreaElement).value).toBe(
      'const dirty = 1;',
    );
  });
});
