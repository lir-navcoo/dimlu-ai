import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../packages/editor/document';
import App from '../src/App';
import {
  PROJECT_STORAGE_KEY,
  type ProjectStorageAdapter,
} from '../packages/editor/project-storage';
import { PageRuntime } from '../packages/runtime/engine';
import { CanvasHost } from '../src/editor/CanvasHost';
import { canvasRoot, keyboardSchema, treeRow } from './keyboard-delete-fixture';
import { pressClipboard } from './local-clipboard-fixture';
import { pressHistory } from './local-history-fixture';

const captured = vi.hoisted(() => ({
  author: undefined as EditorDocument | undefined,
  early: undefined as ((author: EditorDocument) => void) | undefined,
}));
// Capture only the real document after the unchanged real constructor. No author/runtime/navigation method is replaced.
vi.mock('../packages/editor/project-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../packages/editor/project-storage')>();
  return {
    ...actual,
    ProjectStorage: class extends actual.ProjectStorage {
      constructor(...args: ConstructorParameters<typeof actual.ProjectStorage>) {
        super(...args);
        captured.author = this.getSnapshot().document;
        captured.early?.(captured.author);
      }
    },
  };
});

const width = window.innerWidth;
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  captured.author = undefined;
  captured.early = undefined;
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
});
function mountApp() {
  const saved = JSON.stringify({
    storageVersion: 1,
    savedAt: '2026-11-11T00:00:00.000Z',
    schema: keyboardSchema(),
    selection: { pageId: 'a', nodeId: 'alpha' },
  });
  const values = new Map([[PROJECT_STORAGE_KEY, saved]]);
  const adapter: ProjectStorageAdapter = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  const tree = () => <App projectStorage={adapter} saveDelayMs={1} />;
  const view = render(tree());
  return { author: captured.author!, view, tree };
}

describe('actual App local clipboard continuation and real runtime replacement', () => {
  it('C/V/V/Z continues on distinct new exact canvases through real no-Canvas disposal gaps', async () => {
    const h = mountApp(),
      before = h.author.getSnapshot();
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard'),
      paste = vi.spyOn(h.author, 'pasteClipboardNodes');
    const undo = vi.spyOn(h.author, 'undo');
    let previous = canvasRoot();
    previous.focus();
    expect(pressClipboard(previous).defaultPrevented).toBe(true);
    expect(canvasRoot()).toBe(previous);
    expect(document.activeElement).toBe(previous);
    const clipboard = h.author.getClipboardSnapshot();
    const gaps: boolean[] = [];
    const realDispose = PageRuntime.prototype.dispose;
    vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
      realDispose.call(this);
      gaps.push(!previous.isConnected && !screen.queryByLabelText('页面编辑画布'));
    });
    expect(pressClipboard(previous, 'v').defaultPrevented).toBe(true);
    const first = canvasRoot();
    expect(first).not.toBe(previous);
    expect(previous.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(first));
    const once = h.author.getSnapshot();
    previous = first;
    expect(pressClipboard(document.activeElement!, 'V', { metaKey: true }).defaultPrevented).toBe(
      true,
    );
    const second = canvasRoot();
    expect(second).not.toBe(first);
    await waitFor(() => expect(document.activeElement).toBe(second));
    expect(h.author.getSnapshot().revision).toBe(before.revision + 2);
    expect(h.author.getSnapshot().plan.pages.get('a')!.schema.children).toHaveLength(
      before.plan.pages.get('a')!.schema.children.length + 2,
    );
    previous = second;
    expect(pressHistory(document.activeElement!).defaultPrevented).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(canvasRoot()));
    expect(h.author.getSnapshot().plan).toBe(once.plan);
    expect(h.author.getSnapshot().selection).toEqual(once.selection);
    expect(h.author.getClipboardSnapshot()).toBe(clipboard);
    expect(copy).toHaveBeenCalledOnce();
    expect(paste).toHaveBeenCalledTimes(2);
    expect(undo).toHaveBeenCalledOnce();
    expect(gaps).toEqual([true, true, true]);
  });

  it('earliest observer mounts the own candidate before operation counter/core return without premature Canvas reveal', async () => {
    let h!: ReturnType<typeof mountApp>,
      old!: HTMLElement,
      coreReturned = false,
      observed = false;
    let mountedInside = false,
      oldDisposedInside = false;
    let oldRuntime: PageRuntime | undefined;
    const realDispose = PageRuntime.prototype.dispose;
    vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
      oldRuntime ??= this;
      realDispose.call(this);
    });
    let stop: (() => void) | undefined;
    captured.early = (author) => {
      stop = author.subscribe(() => {
        if (observed) return;
        observed = true;
        expect(coreReturned).toBe(false);
        flushSync(() => h.view.rerender(h.tree()));
        mountedInside =
          !!screen.queryByLabelText('页面编辑画布') && !old.isConnected && canvasRoot() !== old;
        oldDisposedInside = !!oldRuntime?.disposed;
      });
    };
    h = mountApp();
    old = canvasRoot();
    old.focus();
    pressClipboard(old);
    const locate = vi.spyOn(CanvasHost.prototype, 'locate');
    const original = h.author.pasteClipboardNodes;
    vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation((...args) => {
      const ids = original(...args);
      coreReturned = true;
      return ids;
    });
    const scroller = screen.getByLabelText('页面画布');
    scroller.scrollTop = 89;
    scroller.scrollLeft = 21;
    try {
      expect(pressClipboard(old, 'v').defaultPrevented).toBe(true);
      expect(observed).toBe(true);
      expect(mountedInside).toBe(true);
      expect(oldDisposedInside).toBe(true);
      expect(coreReturned).toBe(true);
      expect(locate).not.toHaveBeenCalled();
      expect(scroller.scrollTop).toBe(89);
      expect(scroller.scrollLeft).toBe(21);
      await waitFor(() => expect(document.activeElement).toBe(canvasRoot()));
      expect(pressClipboard(canvasRoot(), 'v').defaultPrevented).toBe(true);
    } finally {
      stop?.();
    }
  });

  it.each(['foreign-focus', 'clipboard-aba', 'undo'] as const)(
    'real disposal gap %s permanently refuses old paste focus despite successful core mutation',
    async (kind) => {
      const h = mountApp();
      canvasRoot().focus();
      pressClipboard(canvasRoot());
      const old = canvasRoot(),
        before = h.author.getSnapshot();
      const outside = document.createElement('input');
      document.body.append(outside);
      const realDispose = PageRuntime.prototype.dispose;
      let once = false,
        gap = false;
      vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
        realDispose.call(this);
        if (once) return;
        once = true;
        gap = !old.isConnected && !screen.queryByLabelText('页面编辑画布');
        if (kind === 'foreign-focus') {
          outside.focus();
          document.body.focus();
        } else if (kind === 'clipboard-aba') h.author.copyNodesToClipboard('a', ['alpha']);
        else h.author.undo();
      });
      try {
        expect(pressClipboard(old, 'v').defaultPrevented).toBe(true);
        expect(gap).toBe(true);
        await waitFor(() => expect(document.activeElement).not.toBe(canvasRoot()));
        expect(h.author.getSnapshot().revision).toBeGreaterThan(before.revision);
        if (kind === 'undo') expect(h.author.getSnapshot().plan).toBe(before.plan);
        else
          expect(h.author.getSnapshot().plan.pages.get('a')!.schema.children.length).toBe(
            before.plan.pages.get('a')!.schema.children.length + 1,
          );
      } finally {
        outside.remove();
      }
    },
  );

  it.each([390, 760])(
    '%ipx actual Sidebar selected tree/host C/V/V/Z stays modal and preserves its filter',
    async (narrow) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: narrow });
      const h = mountApp();
      fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
      const dialog = screen.getByRole('dialog', { name: '页面设计' });
      treeRow('alpha').focus();
      expect(pressClipboard(treeRow('alpha')).defaultPrevented).toBe(true);
      const query = within(dialog).getByLabelText('搜索组件树');
      fireEvent.change(query, { target: { value: 'alpha' } });
      // Copy id is alpha; generated id must not borrow an unfiltered row's focus authority.
      fireEvent.change(query, { target: { value: 'root' } });
      const host = within(dialog).getByRole('region', { name: '组件树' });
      host.focus();
      const before = h.author.getSnapshot();
      expect(pressClipboard(host, 'v').defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(host);
      expect(pressClipboard(host, 'v').defaultPrevented).toBe(true);
      expect(pressHistory(host).defaultPrevented).toBe(true);
      expect(h.author.getSnapshot().revision).toBe(before.revision + 3);
      expect((query as HTMLInputElement).value).toBe('root');
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(dialog);
      expect(document.activeElement).toBe(host);
      fireEvent.click(within(dialog).getByRole('button', { name: '关闭页面设计' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull());
    },
  );
});
