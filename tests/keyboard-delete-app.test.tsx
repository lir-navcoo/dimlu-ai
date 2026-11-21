import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { PageRuntime } from '../packages/runtime/engine';
import { canvasRoot, keyboardSchema, sendDelete, treeRow } from './keyboard-delete-fixture';

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
function mountApp(nodeId = 'alpha') {
  localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify({
      storageVersion: 1,
      savedAt: '2026-11-10T00:00:00.000Z',
      schema: keyboardSchema(),
      selection: { pageId: 'a', nodeId },
    }),
  );
  return render(<App saveDelayMs={1} />);
}

describe('real App plan/runtime remount and local keyboard focus', () => {
  it.each(['Delete', 'Backspace'])(
    '%s focuses the genuinely new App canvas after runtime mismatch',
    async (key) => {
      mountApp();
      const old = canvasRoot();
      old.focus();
      expect(sendDelete(old, key).defaultPrevented).toBe(true);
      expect(old.isConnected).toBe(false);
      const replacement = canvasRoot();
      expect(replacement).not.toBe(old);
      await waitFor(() => expect(document.activeElement).toBe(replacement));
      expect(screen.queryByText('Alpha text', { selector: 'p' })).toBeNull();
      expect(treeRow('root').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByRole('button', { name: /撤销/ }).hasAttribute('disabled')).toBe(false);
    },
  );

  it('toolbar Undo and Redo retain user focus while restoring the complete deleted definition', async () => {
    mountApp();
    canvasRoot().focus();
    sendDelete(canvasRoot());
    const undo = screen.getByRole('button', { name: /撤销/ });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => expect(document.activeElement).toBe(undo));
    expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
    expect(treeRow('alpha').getAttribute('aria-pressed')).toBe('true');
    const redo = screen.getByRole('button', { name: /重做/ });
    redo.focus();
    fireEvent.click(redo);
    await waitFor(() => expect(document.activeElement).toBe(redo));
    expect(screen.queryByText('Alpha text', { selector: 'p' })).toBeNull();
  });

  it.each(['external-focus', 'selection', 'page', 'plan', 'mode'] as const)(
    'actual runtime disposal gap cancels stale intent after %s',
    async (change) => {
      // Instrument the existing disposal boundary; keep the real runtime and its actual dispose.
      mountApp();
      if (change === 'page') fireEvent.click(screen.getByRole('tab', { name: '页面' }));
      const outside = document.createElement('input');
      outside.setAttribute('aria-label', 'Disposal-gap user input');
      document.body.append(outside);
      const old = canvasRoot();
      const realDispose = PageRuntime.prototype.dispose;
      let gapObserved = false;
      let once = false;
      vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
        realDispose.call(this);
        if (once) return;
        once = true;
        gapObserved = !old.isConnected && !screen.queryByLabelText('页面编辑画布');
        if (change === 'external-focus') outside.focus();
        else if (change === 'selection') fireEvent.click(treeRow('tail'));
        else if (change === 'page')
          fireEvent.click(screen.getByRole('button', { name: '切换到页面 页面 B (b)' }));
        else if (change === 'mode')
          fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
        else fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
      });
      try {
        old.focus();
        sendDelete(old);
        expect(gapObserved).toBe(true);
        const replacement =
          change === 'mode' ? screen.getByLabelText('页面交互预览') : canvasRoot();
        expect(replacement).not.toBe(old);
        await waitFor(() => expect(document.activeElement).not.toBe(replacement));
        if (change === 'external-focus') expect(document.activeElement).toBe(outside);
        else if (change === 'selection')
          expect(treeRow('tail').getAttribute('aria-pressed')).toBe('true');
        else if (change === 'page')
          expect(screen.getByText('B one', { selector: 'p' })).toBeTruthy();
        else if (change === 'mode')
          expect(
            screen.getByRole('button', { name: '预览模式' }).getAttribute('aria-pressed'),
          ).toBe('true');
        else expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
      } finally {
        outside.remove();
      }
    },
  );

  it.each([390, 760])(
    '%ipx selected tree inside the real ResponsiveSide Dialog owns Backspace',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      mountApp('tail');
      fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
      const dialog = screen.getByRole('dialog', { name: '页面设计' });
      expect(within(dialog).getByRole('tabpanel', { name: '结构' })).toBeTruthy();
      const selected = treeRow('tail');
      expect(dialog.contains(selected)).toBe(true);
      selected.focus();
      expect(sendDelete(selected, 'Backspace').defaultPrevented).toBe(true);
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(dialog);
      expect(screen.queryByText('Tail text', { selector: 'p' })).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(treeRow('shared')));
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭页面设计' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull());
    },
  );

  it('tree filter native Backspace neither deletes a definition nor steals focus', () => {
    mountApp();
    fireEvent.click(screen.getByRole('tab', { name: '结构' }));
    const search = screen.getByLabelText('搜索组件树');
    fireEvent.change(search, { target: { value: 'Alpha' } });
    search.focus();
    const undo = screen.getByRole('button', { name: /撤销/ });
    expect(sendDelete(search, 'Backspace').defaultPrevented).toBe(false);
    expect(undo.hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(search);
    expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
  });
});
