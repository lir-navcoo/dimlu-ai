import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@base-ui/react/dialog';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorCanvas } from '../src/editor/Canvas';
import { DragDropProvider } from '../src/editor/DragDrop';
import { TipProvider } from '../src/ui/primitives';
import { selectionRegistry } from './multiselection-fixture';
import { canvasRoot, keyboardSchema } from './keyboard-delete-fixture';
import { flushEscape, pressEscape } from './escape-priority-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Deliberately no DragDropProvider or EditorSessionProvider, and no fake drag API. */
function standalone(children?: ReactNode, ids: string[] = ['alpha']) {
  const document = new EditorDocument(keyboardSchema(), selectionRegistry());
  document.selectMany('a', ids, ids[0]);
  const runtime = new PageRuntime(document.getSnapshot().plan, 'a', { designMode: true });
  function Scene({ mode, provided }: { mode: 'edit' | 'preview'; provided: boolean }) {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    useEffect(() => () => runtime.dispose(), []);
    const content = (
      <TipProvider>
        <div className="canvas-scroll">
          <EditorCanvas document={document} snapshot={snapshot} runtime={runtime} mode={mode}>
            {children}
          </EditorCanvas>
        </div>
        <input aria-label="Standalone external input" />
      </TipProvider>
    );
    return provided ? (
      <DragDropProvider document={document} snapshot={snapshot} enabled={mode === 'edit'}>
        {content}
      </DragDropProvider>
    ) : (
      content
    );
  }
  const tree = (mode: 'edit' | 'preview' = 'edit', provided = false) => (
    <Scene mode={mode} provided={provided} />
  );
  return { document, view: render(tree()), tree };
}

describe('standalone Canvas preserves idle Escape without an author provider', () => {
  it.each(['multi', 'empty'] as const)(
    'standalone %s selection follows existing clear semantics without history',
    async (kind) => {
      const { document } = standalone(undefined, kind === 'multi' ? ['alpha', 'tail'] : []);
      const before = document.getSnapshot();
      canvasRoot().focus();
      await pressEscape(canvasRoot());
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: null });
      expect(document.getSnapshot().plan).toBe(before.plan);
      expect(document.getSnapshot().canUndo).toBe(false);
    },
  );
  it('clears focused idle selection once after real target/document dismissal opportunity', async () => {
    const { document } = standalone();
    const before = document.getSnapshot();
    const select = vi.spyOn(document, 'select');
    const target = canvasRoot();
    const order: string[] = [];
    const onTarget = () => {
      order.push('target');
      expect(document.getSnapshot()).toBe(before);
    };
    const onDocument = () => {
      order.push('document');
      expect(document.getSnapshot()).toBe(before);
    };
    target.addEventListener('keydown', onTarget);
    globalThis.document.addEventListener('keydown', onDocument);
    target.focus();
    try {
      await pressEscape(target);
      expect(order).toEqual(['target', 'document']);
      expect(select).toHaveBeenCalledExactlyOnceWith('a', null);
      expect(document.getSnapshot().selection.nodeId).toBeNull();
      expect(document.getSnapshot().plan).toBe(before.plan);
      expect(document.getSnapshot().canUndo).toBe(false);
      expect(globalThis.document.activeElement).toBe(target);
    } finally {
      target.removeEventListener('keydown', onTarget);
      globalThis.document.removeEventListener('keydown', onDocument);
    }
  });

  it.each(['target', 'document'] as const)(
    '%s stopPropagation with no preventDefault protects standalone selection',
    async (stage) => {
      const { document } = standalone();
      const before = document.getSnapshot();
      const target = canvasRoot();
      const owner = stage === 'target' ? target : globalThis.document;
      const consume = (event: Event) => event.stopPropagation();
      owner.addEventListener('keydown', consume);
      target.focus();
      try {
        expect((await pressEscape(target)).defaultPrevented).toBe(false);
        expect(document.getSnapshot()).toBe(before);
        await flushEscape();
        expect(document.getSnapshot()).toBe(before);
      } finally {
        owner.removeEventListener('keydown', consume);
      }
    },
  );

  it('real canceled-close Popup consumes Escape without defaultPrevented or standalone clear', async () => {
    const close = vi.fn();
    const { document } = standalone(
      <div data-canvas-action="true">
        <Dialog.Root
          open
          modal={false}
          onOpenChange={(_open, details) => {
            close(details.reason);
            details.cancel();
          }}
        >
          <Dialog.Portal>
            <Dialog.Popup initialFocus={false} finalFocus={false}>
              <Dialog.Title>Standalone runtime refusal</Dialog.Title>
              <button>Refused close action</button>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>,
    );
    const before = document.getSnapshot();
    canvasRoot().focus();
    expect((await pressEscape(canvasRoot())).defaultPrevented).toBe(false);
    expect(close).toHaveBeenCalledWith('escape-key');
    expect(screen.getByRole('dialog', { name: 'Standalone runtime refusal' })).toBeTruthy();
    expect(document.getSnapshot()).toBe(before);
  });

  it.each(['focus', 'selection', 'unmount'] as const)(
    'standalone pending clear expires after same-event %s change',
    async (kind) => {
      const { document, view } = standalone();
      let expected = document.getSnapshot();
      const target = canvasRoot();
      const select = vi.spyOn(document, 'select');
      target.addEventListener(
        'keydown',
        () => {
          if (kind === 'focus') screen.getByLabelText('Standalone external input').focus();
          else if (kind === 'selection') document.select('a', 'tail');
          else view.unmount();
          expected = document.getSnapshot();
        },
        { once: true },
      );
      target.focus();
      await pressEscape(target);
      expect(document.getSnapshot()).toBe(expected);
      expect(select.mock.calls.filter(([, id]) => id === null)).toHaveLength(0);
      if (kind === 'focus')
        expect(globalThis.document.activeElement).toBe(
          screen.getByLabelText('Standalone external input'),
        );
    },
  );

  it('standalone preview and protected native text Escape never clear author selection', async () => {
    const { document, view, tree } = standalone(
      <div data-canvas-action="true">
        <input aria-label="Standalone text draft" defaultValue="draft" />
      </div>,
    );
    const before = document.getSnapshot();
    const input = screen.getByLabelText('Standalone text draft');
    input.focus();
    await pressEscape(input);
    expect(document.getSnapshot()).toBe(before);
    expect(globalThis.document.activeElement).toBe(input);
    view.rerender(tree('preview'));
    const preview = screen.getByLabelText('页面交互预览');
    await pressEscape(preview);
    expect(document.getSnapshot()).toBe(before);
    expect((screen.getByLabelText('Standalone text draft') as HTMLInputElement).value).toBe(
      'draft',
    );
  });

  it('Provider/mode switches and unmount leave one eligible endpoint with no duplicate clear or leaked listener', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const activeKeyListeners = () => {
      const counts = new Map<unknown, number>();
      for (const [name, listener, options] of add.mock.calls) {
        if (
          name === 'keydown' &&
          options !== true &&
          !(typeof options === 'object' && options?.capture)
        )
          counts.set(listener, (counts.get(listener) ?? 0) + 1);
      }
      for (const [name, listener, options] of remove.mock.calls) {
        if (
          name === 'keydown' &&
          options !== true &&
          !(typeof options === 'object' && options?.capture)
        )
          counts.set(listener, (counts.get(listener) ?? 0) - 1);
      }
      return [...counts.values()].reduce((sum, count) => sum + count, 0);
    };
    const { document, view, tree } = standalone();
    const select = vi.spyOn(document, 'select');
    expect(activeKeyListeners()).toBe(1);
    view.rerender(tree('edit', true));
    expect(activeKeyListeners()).toBe(1);
    canvasRoot().focus();
    await pressEscape(canvasRoot());
    expect(select).toHaveBeenCalledExactlyOnceWith('a', null);
    act(() => document.select('a', 'alpha'));
    select.mockClear();
    view.rerender(tree());
    expect(activeKeyListeners()).toBe(1);
    canvasRoot().focus();
    await pressEscape(canvasRoot());
    expect(select).toHaveBeenCalledExactlyOnceWith('a', null);
    act(() => document.select('a', 'alpha'));
    select.mockClear();
    const before = document.getSnapshot();
    view.rerender(tree('preview'));
    expect(activeKeyListeners()).toBe(0);
    await pressEscape(screen.getByLabelText('页面交互预览'));
    expect(document.getSnapshot()).toBe(before);
    view.rerender(tree());
    expect(activeKeyListeners()).toBe(1);
    view.unmount();
    expect(activeKeyListeners()).toBe(0);
    await pressEscape(window);
    expect(select).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });
});
