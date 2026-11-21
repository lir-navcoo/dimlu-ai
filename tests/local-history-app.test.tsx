import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorDocument } from '../packages/editor/document';
import { canvasRoot, keyboardSchema, sendDelete, treeRow } from './keyboard-delete-fixture';
import { historyCallbackHarness, pressHistory } from './local-history-fixture';
import { lit, selectionRegistry } from './multiselection-fixture';

const originalWidth = window.innerWidth;
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});
function mountApp() {
  localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify({
      storageVersion: 1,
      savedAt: '2026-11-10T00:00:00.000Z',
      schema: keyboardSchema(),
      selection: { pageId: 'a', nodeId: 'alpha' },
    }),
  );
  return render(<App saveDelayMs={1} />);
}

describe('genuine App history runtime replacement and focus ownership', () => {
  it('local Undo and Redo focus genuinely new roots across real no-Canvas loading gaps', async () => {
    mountApp();
    canvasRoot().focus();
    sendDelete(canvasRoot());
    const realDispose = PageRuntime.prototype.dispose;
    let previous = canvasRoot();
    const gaps: boolean[] = [];
    vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
      realDispose.call(this);
      gaps.push(!previous.isConnected && !screen.queryByLabelText('页面编辑画布'));
    });
    previous.focus();
    expect(pressHistory(previous).defaultPrevented).toBe(true);
    const restored = canvasRoot();
    expect(previous.isConnected).toBe(false);
    expect(restored).not.toBe(previous);
    await waitFor(() => expect(document.activeElement).toBe(restored));
    expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
    expect(treeRow('alpha').getAttribute('aria-pressed')).toBe('true');
    previous = restored;
    expect(pressHistory(restored, 'Z', { metaKey: true, shiftKey: true }).defaultPrevented).toBe(
      true,
    );
    const redone = canvasRoot();
    expect(restored.isConnected).toBe(false);
    expect(redone).not.toBe(restored);
    await waitFor(() => expect(document.activeElement).toBe(redone));
    expect(screen.queryByText('Alpha text', { selector: 'p' })).toBeNull();
    expect(treeRow('root').getAttribute('aria-pressed')).toBe('true');
    expect(gaps).toEqual([true, true]);
  });

  it.each(['focus', 'pointer', 'selection', 'page', 'plan', 'mode'] as const)(
    'history handoff expires during the genuine disposal gap after %s',
    async (kind) => {
      mountApp();
      canvasRoot().focus();
      sendDelete(canvasRoot());
      if (kind === 'page') fireEvent.click(screen.getByRole('tab', { name: '页面' }));
      const outside = document.createElement('input');
      document.body.append(outside);
      const previous = canvasRoot();
      const realDispose = PageRuntime.prototype.dispose;
      let once = false;
      let gapObserved = false;
      vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
        realDispose.call(this);
        if (once) return;
        once = true;
        gapObserved = !previous.isConnected && !screen.queryByLabelText('页面编辑画布');
        if (kind === 'focus') outside.focus();
        else if (kind === 'pointer') fireEvent.pointerDown(outside);
        else if (kind === 'selection') fireEvent.click(treeRow('tail'));
        else if (kind === 'page')
          fireEvent.click(screen.getByRole('button', { name: '切换到页面 页面 B (b)' }));
        else if (kind === 'mode') fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
        else fireEvent.click(screen.getByRole('button', { name: /重做/ }));
      });
      try {
        previous.focus();
        expect(pressHistory(previous).defaultPrevented).toBe(true);
        expect(gapObserved).toBe(true);
        const next = kind === 'mode' ? screen.getByLabelText('页面交互预览') : canvasRoot();
        expect(next).not.toBe(previous);
        await waitFor(() => expect(document.activeElement).not.toBe(next));
        if (kind === 'focus') expect(document.activeElement).toBe(outside);
        else if (kind === 'selection')
          expect(treeRow('tail').getAttribute('aria-pressed')).toBe('true');
        else if (kind === 'page') expect(screen.getByText('B one', { selector: 'p' })).toBeTruthy();
        else if (kind === 'plan')
          expect(screen.queryByText('Alpha text', { selector: 'p' })).toBeNull();
      } finally {
        outside.remove();
      }
    },
  );

  it.each([390, 760])(
    '%ipx actual Sidebar tree host recovers complete bulk-deleted selection',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      mountApp();
      fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
      const dialog = screen.getByRole('dialog', { name: '页面设计' });
      fireEvent.click(treeRow('tail'), { ctrlKey: true });
      expect(treeRow('alpha').getAttribute('aria-pressed')).toBe('true');
      expect(treeRow('tail').getAttribute('aria-pressed')).toBe('true');
      treeRow('tail').focus();
      expect(sendDelete(treeRow('tail')).defaultPrevented).toBe(true);
      const host = within(dialog).getByRole('region', { name: '组件树' });
      expect(document.activeElement).toBe(host);
      expect(pressHistory(host).defaultPrevented).toBe(true);
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(dialog);
      expect(treeRow('alpha').getAttribute('aria-pressed')).toBe('true');
      expect(treeRow('tail').getAttribute('aria-pressed')).toBe('true');
      await waitFor(() => expect(document.activeElement).toBe(treeRow('tail')));
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭页面设计' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull());
    },
  );

  it('toolbar Undo/Redo retain user toolbar focus across actual runtime replacements', async () => {
    mountApp();
    canvasRoot().focus();
    sendDelete(canvasRoot());
    const undo = screen.getByRole('button', { name: /撤销/ });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => expect(document.activeElement).toBe(undo));
    const redo = screen.getByRole('button', { name: /重做/ });
    redo.focus();
    fireEvent.click(redo);
    await waitFor(() => expect(document.activeElement).toBe(redo));
  });
});

describe('retained local history callbacks do not inherit current authority', () => {
  it('native cancelBubble is owned by the target and cannot be converted into history consumption', () => {
    const { author, callback, route } = historyCallbackHarness();
    actChange(author);
    const current = callback();
    route((event) => {
      event.nativeEvent.stopPropagation();
      current(event);
    });
    const host = screen.getByLabelText('History retained hook host');
    host.focus();
    const before = author.getSnapshot();
    const undo = vi.spyOn(author, 'undo');
    expect(pressHistory(host).defaultPrevented).toBe(false);
    expect(author.getSnapshot()).toBe(before);
    expect(undo).not.toHaveBeenCalled();
  });

  it.each(['full-selection', 'plan', 'page', 'document', 'enabled'] as const)(
    'old callback rejects after committed %s change',
    (kind) => {
      const { author, callback, route, view, tree } = historyCallbackHarness();
      const initial = callback();
      actChange(author);
      const old = kind === 'plan' ? initial : callback();
      route(old);
      if (kind === 'full-selection') {
        // Change only raw secondary IDs while preserving the primary and plan.
        fireEventHistorySelection(author);
      } else {
        if (kind === 'page') fireEventHistoryPage(author);
        else if (kind === 'document')
          view.rerender(tree(new EditorDocument(keyboardSchema(), selectionRegistry())));
        else if (kind === 'enabled') view.rerender(tree(author, false));
      }
      const host = screen.getByLabelText('History retained hook host');
      host.focus();
      const before = author.getSnapshot();
      const undo = vi.spyOn(author, 'undo');
      expect(pressHistory(host).defaultPrevented).toBe(false);
      expect(author.getSnapshot()).toBe(before);
      expect(undo).not.toHaveBeenCalled();
    },
  );
});

// These updates deliberately commit through the real external store before delivering an old callback.
function actChange(author: EditorDocument) {
  act(() => author.setProp('a', 'tail', 'value', lit('Changed')));
}
function fireEventHistorySelection(author: EditorDocument) {
  act(() => author.selectMany('a', ['alpha', 'header'], 'alpha'));
}
function fireEventHistoryPage(author: EditorDocument) {
  act(() => author.selectPage('b'));
}
