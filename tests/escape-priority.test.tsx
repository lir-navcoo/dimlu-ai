import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasRoot, sendDelete, treeRow } from './keyboard-delete-fixture';
import {
  escapeEvent,
  escapeHarness,
  flushEscape,
  materialPointer,
  pressEscape,
  startKeyboardDrag,
} from './escape-priority-fixture';
import { changeControl } from './ui-helpers';
import { CodeEditor } from '../src/ui/CodeEditor';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe('actual drag destination Escape precedence', () => {
  it('first real option Escape closes only the destination popup;next closed-trigger Escape cancels drag once', async () => {
    const { document, drag, session } = escapeHarness();
    const before = document.getSnapshot();
    const draft = { source: 'base', dirty: true, value: 'state.' };
    act(() => session().drafts.write('escape:retained', draft));
    const destination = startKeyboardDrag();
    changeControl(destination, JSON.stringify({ kind: 'after', nodeId: 'tail' }));
    const candidate = drag().session!.candidate;
    fireEvent.click(destination);
    const option = screen.getByRole('option', { name: '文本 · tail之后' });
    option.focus();
    expect(canvasRoot().contains(option)).toBe(false);
    await pressEscape(option);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    expect(drag().isInteracting).toBe(true);
    expect(drag().session!.candidate).toBe(candidate);
    expect(document.getSnapshot()).toBe(before);
    expect(session().drafts.read('escape:retained', 'base', '')).toBe(draft);
    await waitFor(() => expect(globalThis.document.activeElement).toBe(destination));
    expect(destination.getAttribute('aria-expanded')).toBe('false');
    await pressEscape(destination);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(drag().isInteracting).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    expect(session().drafts.read('escape:retained', 'base', '')).toBe(draft);
    await flushEscape();
    expect(document.getSnapshot()).toBe(before);
  });

  it.each(['canvas', 'tree', 'window'] as const)(
    '%s Escape cancels one active keyboard drag without cascading to selection clear',
    async (domain) => {
      const { document, drag } = escapeHarness();
      const before = document.getSnapshot();
      startKeyboardDrag();
      const target =
        domain === 'canvas' ? canvasRoot() : domain === 'tree' ? treeRow('alpha') : window;
      if (target instanceof HTMLElement) target.focus();
      await pressEscape(target);
      expect(drag().isInteracting).toBe(false);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(document.getSnapshot()).toBe(before);
      await flushEscape();
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it.each(['pending', 'active'] as const)(
    'eligible Escape cancels %s pointer gesture and preserves exact document state',
    async (phase) => {
      const { document, drag } = escapeHarness();
      const before = document.getSnapshot();
      materialPointer(
        'pointerdown',
        screen.getByRole('button', { name: 'Prepare material pointer' }),
      );
      if (phase === 'active') materialPointer('pointermove', window, 28);
      expect(drag().isInteracting).toBe(true);
      expect(!!drag().session).toBe(phase === 'active');
      canvasRoot().focus();
      await pressEscape(canvasRoot());
      expect(drag().isInteracting).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      materialPointer('pointermove', window, 50);
      expect(drag().isInteracting).toBe(false);
    },
  );

  it('033 Delete still refuses during drag,then deletes normally after a separate Escape cancellation', async () => {
    const { document } = escapeHarness();
    const before = document.getSnapshot();
    startKeyboardDrag();
    canvasRoot().focus();
    expect(sendDelete(canvasRoot()).defaultPrevented).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    await pressEscape(canvasRoot());
    expect(document.getSnapshot()).toBe(before);
    canvasRoot().focus();
    expect(sendDelete(canvasRoot(), 'Backspace').defaultPrevented).toBe(true);
    expect(document.getSnapshot().selection.nodeId).toBe('root');
    expect(document.getSnapshot().canUndo).toBe(true);
  });
});

describe('author Escape guards preserve drag and selection', () => {
  it.each([
    { name: 'repeat', init: { repeat: true } },
    { name: 'Control', init: { ctrlKey: true } },
    { name: 'Meta', init: { metaKey: true } },
    { name: 'Alt', init: { altKey: true } },
    { name: 'Shift', init: { shiftKey: true } },
    { name: 'isComposing', init: { isComposing: true } },
    { name: '229', init: { keyCode: 229 } },
  ])('$name cannot author-cancel or clear even from the focused canvas', async ({ init }) => {
    const { document, drag } = escapeHarness();
    const before = document.getSnapshot();
    canvasRoot().focus();
    await pressEscape(canvasRoot(), init);
    expect(document.getSnapshot()).toBe(before);
    startKeyboardDrag();
    canvasRoot().focus();
    const dragBefore = drag().session;
    await pressEscape(canvasRoot(), init);
    expect(drag().session).toBe(dragBefore);
    expect(drag().isInteracting).toBe(true);
    expect(document.getSnapshot()).toBe(before);
  });

  it('defaultPrevented Escape passes through without author cancel or clear', async () => {
    const { document, drag } = escapeHarness();
    const before = document.getSnapshot();
    startKeyboardDrag();
    canvasRoot().focus();
    const event = escapeEvent();
    event.preventDefault();
    fireEvent(canvasRoot(), event);
    await flushEscape();
    expect(drag().isInteracting).toBe(true);
    expect(document.getSnapshot()).toBe(before);
  });

  it('active native composition session blocks author Escape until compositionend', async () => {
    const { document, drag } = escapeHarness();
    const before = document.getSnapshot();
    startKeyboardDrag();
    const target = canvasRoot();
    target.focus();
    fireEvent.compositionStart(target, { data: '中' });
    await pressEscape(target);
    expect(drag().isInteracting).toBe(true);
    expect(document.getSnapshot()).toBe(before);
    fireEvent.compositionEnd(target, { data: '中' });
    await pressEscape(target);
    expect(drag().isInteracting).toBe(false);
    expect(document.getSnapshot()).toBe(before);
  });

  it('native text/textarea/select/editable and real code fallback keep Escape outside author mutation', async () => {
    const { document, drag } = escapeHarness(
      <div data-canvas-action="true">
        <input aria-label="Protected text" />
        <textarea aria-label="Protected textarea" />
        <select aria-label="Protected native select">
          <option>One</option>
        </select>
        <div
          tabIndex={0}
          contentEditable
          suppressContentEditableWarning
          aria-label="Protected editable"
        >
          Draft
        </div>
        <CodeEditor
          label="Protected Monaco fallback"
          language="javascript"
          value="state."
          onChange={() => {}}
        />
      </div>,
    );
    const before = document.getSnapshot();
    startKeyboardDrag();
    for (const label of [
      'Protected text',
      'Protected textarea',
      'Protected native select',
      'Protected editable',
      'Protected Monaco fallback',
      'Outside editor input',
    ]) {
      const target = screen.getByLabelText(label);
      target.focus();
      await pressEscape(target);
      expect(drag().isInteracting).toBe(true);
      expect(document.getSnapshot()).toBe(before);
      expect(globalThis.document.activeElement).toBe(target);
    }
  });
});
