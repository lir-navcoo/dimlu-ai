import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@base-ui/react/dialog';
import { flushSync } from 'react-dom';
import { EditorDocument } from '../packages/editor/document';
import { selectionRegistry } from './multiselection-fixture';
import { canvasRoot, keyboardSchema, treeRow } from './keyboard-delete-fixture';
import {
  escapeEvent,
  escapeHarness,
  flushEscape,
  pressEscape,
  startKeyboardDrag,
} from './escape-priority-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe('Canvas Escape resolves after the actual event path', () => {
  it('idle root clear happens once only after target and document popup handlers have had their turn', async () => {
    const { document } = escapeHarness();
    const before = document.getSnapshot();
    const select = vi.spyOn(document, 'select');
    const order: string[] = [];
    const target = canvasRoot();
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
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: null });
      expect(document.getSnapshot().plan).toBe(before.plan);
      expect(document.getSnapshot().canUndo).toBe(false);
      expect(globalThis.document.activeElement).toBe(target);
    } finally {
      target.removeEventListener('keydown', onTarget);
      globalThis.document.removeEventListener('keydown', onDocument);
    }
  });

  it.each(['target', 'document'] as const)(
    '%s consumes propagation without defaultPrevented;Canvas must not clear later',
    async (stage) => {
      const { document } = escapeHarness();
      const before = document.getSnapshot();
      const target = canvasRoot();
      const owner = stage === 'target' ? target : globalThis.document;
      const consume = (event: Event) => event.stopPropagation();
      owner.addEventListener('keydown', consume);
      target.focus();
      try {
        const event = await pressEscape(target);
        expect(event.defaultPrevented).toBe(false);
        expect(document.getSnapshot()).toBe(before);
        await flushEscape();
        expect(document.getSnapshot()).toBe(before);
      } finally {
        owner.removeEventListener('keydown', consume);
      }
    },
  );

  it('real BaseUI controlled runtime refusal owns Escape even when cancellation leaves defaultPrevented false', async () => {
    const close = vi.fn();
    const { document } = escapeHarness(
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
              <Dialog.Title>Runtime controlled refusal</Dialog.Title>
              <button>Runtime dialog action</button>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>,
    );
    const before = document.getSnapshot();
    canvasRoot().focus();
    const event = await pressEscape(canvasRoot());
    expect(close).toHaveBeenCalledWith('escape-key');
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Runtime controlled refusal' })).toBeTruthy();
    expect(document.getSnapshot()).toBe(before);
  });

  it('tree Escape remains a true selection no-op outside its own popup handling', async () => {
    const { document } = escapeHarness();
    const before = document.getSnapshot();
    treeRow('alpha').focus();
    await pressEscape(treeRow('alpha'));
    expect(document.getSnapshot()).toBe(before);
  });
});

describe('same-event author changes expire prospective Canvas clear', () => {
  it.each([
    'selection',
    'secondary',
    'plan',
    'page',
    'document',
    'mode',
    'focus',
    'drag',
    'unmount',
  ] as const)(
    'rejects %s change between Canvas capture and window without stale replay',
    async (kind) => {
      const { document, view, tree, drag } = escapeHarness();
      if (kind === 'secondary') act(() => document.selectMany('a', ['alpha', 'tail'], 'alpha'));
      const target = canvasRoot();
      const select = vi.spyOn(document, 'select');
      let expected = document.getSnapshot();
      let nextDocument: EditorDocument | undefined;
      let nextSnapshot: ReturnType<EditorDocument['getSnapshot']> | undefined;
      const interpose = () => {
        if (kind === 'selection') document.select('a', 'tail');
        else if (kind === 'secondary') document.selectMany('a', ['alpha', 'header'], 'alpha');
        else if (kind === 'plan') document.renamePage('b', 'Changed while dispatching');
        else if (kind === 'page') document.selectPage('b');
        else if (kind === 'document') {
          nextDocument = new EditorDocument(keyboardSchema(), selectionRegistry());
          nextSnapshot = nextDocument.getSnapshot();
          flushSync(() => view.rerender(tree('edit', nextDocument)));
          expect(screen.getByLabelText('页面编辑画布')).toBeTruthy();
        } else if (kind === 'mode') {
          flushSync(() => view.rerender(tree('preview')));
          expect(screen.getByLabelText('页面交互预览')).toBeTruthy();
        } else if (kind === 'focus') screen.getByLabelText('Outside editor input').focus();
        else if (kind === 'drag') drag().begin({ kind: 'material', component: 'ui.text' });
        else view.unmount();
        expected = document.getSnapshot();
      };
      target.addEventListener('keydown', interpose, { once: true });
      target.focus();
      const event = escapeEvent();
      fireEvent(target, event);
      await flushEscape();
      expect(document.getSnapshot()).toBe(expected);
      expect(select.mock.calls.filter(([, id]) => id === null)).toHaveLength(0);
      if (kind === 'secondary')
        expect(document.getSnapshot().selection).toEqual({
          pageId: 'a',
          nodeId: 'alpha',
          nodeIds: ['alpha', 'header'],
        });
      if (kind === 'focus')
        expect(globalThis.document.activeElement).toBe(
          screen.getByLabelText('Outside editor input'),
        );
      if (kind === 'document') expect(nextDocument!.getSnapshot()).toBe(nextSnapshot);
      await flushEscape();
      expect(document.getSnapshot()).toBe(expected);
    },
  );

  it('Escape that started with drag can never clear selection when a target listener already cancels that drag', async () => {
    const { document, drag } = escapeHarness();
    const before = document.getSnapshot();
    startKeyboardDrag();
    const target = canvasRoot();
    target.focus();
    target.addEventListener('keydown', () => drag().cancel(), { once: true });
    await pressEscape(target);
    expect(drag().isInteracting).toBe(false);
    expect(document.getSnapshot()).toBe(before);
  });
});
