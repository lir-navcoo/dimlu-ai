import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { purchaseManagementExample } from '../src/purchase-management-example';
import {
  PROJECT_STORAGE_KEY,
  type ProjectStorageAdapter,
} from '../packages/editor/project-storage';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});
const root = () => screen.getByLabelText('页面编辑画布');
const heading = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.tree-select')].find((button) =>
    button.getAttribute('aria-label')?.endsWith(' purchase-heading'),
  )!;
const nodes = () => document.querySelectorAll('.tree-select').length;
const enabled = (element: HTMLElement) =>
  !element.hasAttribute('disabled') &&
  !element.hasAttribute('data-disabled') &&
  element.getAttribute('aria-disabled') !== 'true';
function key(target: Element, value: 'c' | 'v' | 'z') {
  const event = new KeyboardEvent('keydown', {
    key: value,
    code: `Key${value.toUpperCase()}`,
    keyCode: value.toUpperCase().charCodeAt(0),
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  fireEvent(target, event);
  return event.defaultPrevented;
}
async function menu() {
  if (!screen.queryByRole('menu'))
    fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
  await screen.findByRole('menu');
  return {
    copy: screen.getByRole('menuitem', { name: '复制组件到剪贴板' }),
    paste: screen.getByRole('menuitem', { name: '粘贴组件到页面末尾' }),
  };
}
async function closeMenu() {
  const item = screen.queryByRole('menuitem', { name: '复制组件到剪贴板' });
  if (item) fireEvent.keyDown(item, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
}

describe('052 real default App StrictMode diagnostic, no production or subject mocks', () => {
  it('empty adapter bootstrap selects workspace then real tree publication enables focused canvas C/V', async () => {
    const values = new Map<string, string>();
    const adapter: ProjectStorageAdapter = {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        values.set(k, v);
      },
    };
    expect(values.has(PROJECT_STORAGE_KEY)).toBe(false);
    render(
      <StrictMode>
        <App projectStorage={adapter} saveDelayMs={1} />
      </StrictMode>,
    );
    const workspace = [...document.querySelectorAll<HTMLButtonElement>('.tree-select')].find(
      (button) => button.getAttribute('aria-label')?.endsWith(' purchase-workspace'),
    )!;
    await waitFor(() => expect(workspace.getAttribute('aria-pressed')).toBe('true'));
    expect(heading().getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(heading());
    await waitFor(() => expect(heading().getAttribute('aria-pressed')).toBe('true'));
    expect(workspace.getAttribute('aria-pressed')).toBe('false');
    const initialNodes = nodes();
    root().focus();
    expect(document.activeElement).toBe(root());
    expect(window.getSelection()?.isCollapsed).not.toBe(false);
    expect(key(root(), 'c')).toBe(true);
    const afterCopy = await menu();
    expect(enabled(afterCopy.paste)).toBe(true);
    await closeMenu();
    root().focus();
    expect(key(root(), 'v')).toBe(true);
    expect(nodes()).toBe(initialNodes + 1);
    expect(
      [...document.querySelectorAll<HTMLButtonElement>('.tree-select')]
        .find((button) => button.getAttribute('aria-pressed') === 'true')
        ?.getAttribute('aria-label'),
    ).toMatch(/ui-heading-\d+$/);
  });

  it.each([
    { strict: false, domain: 'canvas' },
    { strict: true, domain: 'canvas' },
    { strict: true, domain: 'tree' },
  ] as const)(
    '$domain strict=$strict focused C/V versus original menu and Canvas Z',
    async ({ strict, domain }) => {
      const saved = JSON.stringify({
        storageVersion: 1,
        savedAt: '2026-11-11T00:00:00.000Z',
        schema: purchaseManagementExample,
        selection: { pageId: 'purchases', nodeId: 'purchase-heading' },
      });
      const values = new Map([[PROJECT_STORAGE_KEY, saved]]);
      const adapter: ProjectStorageAdapter = {
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => {
          values.set(k, v);
        },
      };
      const app = <App projectStorage={adapter} saveDelayMs={1} />;
      render(strict ? <StrictMode>{app}</StrictMode> : app);
      await waitFor(() => expect(heading().getAttribute('aria-pressed')).toBe('true'));
      const target = () => (domain === 'canvas' ? root() : heading());
      target().focus();
      const exactFocus = document.activeElement === target();
      const initialNodes = nodes();
      const copyConsumed = key(target(), 'c');
      const afterCopy = await menu();
      const keyboardCopyAvailable = enabled(afterCopy.paste);
      const originalCopyEnabled = enabled(afterCopy.copy);
      fireEvent.click(afterCopy.copy);
      const afterMenuCopy = await menu();
      const originalCopyAvailable = enabled(afterMenuCopy.paste);
      await closeMenu();
      target().focus();
      const pasteConsumed = key(target(), 'v');
      const afterKeyPaste = nodes();
      const beforeMenuPaste = await menu();
      fireEvent.click(beforeMenuPaste.paste);
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      const afterMenuPaste = nodes();
      root().focus();
      const undoConsumed = key(root(), 'z');
      const afterUndo = nodes();
      const observed = {
        strict,
        domain,
        exactFocus,
        initialNodes,
        copyConsumed,
        keyboardCopyAvailable,
        originalCopyEnabled,
        originalCopyAvailable,
        pasteConsumed,
        keyboardPasteDelta: afterKeyPaste - initialNodes,
        originalMenuPasteDelta: afterMenuPaste - afterKeyPaste,
        undoConsumed,
        undoDelta: afterUndo - afterMenuPaste,
      };
      console.info('052-default-app-diagnostic', JSON.stringify(observed));
      expect(observed).toMatchObject({
        exactFocus: true,
        copyConsumed: true,
        keyboardCopyAvailable: true,
        originalCopyEnabled: true,
        originalCopyAvailable: true,
        pasteConsumed: true,
        keyboardPasteDelta: 1,
        originalMenuPasteDelta: 1,
        undoConsumed: true,
        undoDelta: -1,
      });
    },
  );
});
