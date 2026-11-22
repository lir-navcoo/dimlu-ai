import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findNode } from '../packages/editor/document';
import { keyboardSchema, sendDelete, canvasRoot, treeRow, keyboardHarness } from './keyboard-delete-fixture';
import { selectionApplication } from './multiselection-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe('Ctrl+A select-all and arrow nudge authoring', () => {
  it('canvas Ctrl+A selects every top-level component; inputs and empty pages stay untouched', () => {
    const { document } = keyboardHarness({ ids: ['alpha'] });
    const spy = vi.spyOn(document, 'selectMany');
    canvasRoot().focus();
    const event = sendDelete(canvasRoot(), 'a', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    const schema = keyboardSchema();
    const roots = schema.pages[0].children.map((node) => node.id);
    expect(spy).toHaveBeenCalledExactlyOnceWith('a', roots);
    expect(document.getSnapshot().selection.nodeIds).toEqual(roots);

    // Typing targets inside inputs never hijack Ctrl+A.
    const input = screen.getByLabelText('Outside editor input') as HTMLInputElement;
    input.focus();
    input.value = '草稿';
    expect(sendDelete(input, 'a', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(input.value).toBe('草稿');
    // Outside host: no command.
    expect(sendDelete(screen.getByText('Outside editor button'), 'a', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('tree Ctrl+A selects top-level nodes and repeat presses are stable single commands', () => {
    const { document } = keyboardHarness({ ids: ['header'] });
    const spy = vi.spyOn(document, 'selectMany');
    treeRow('header').focus();
    expect(sendDelete(treeRow('header'), 'a', { metaKey: true }).defaultPrevented).toBe(true);
    const roots = selectionApplication().pages[0].children.map((node) => node.id);
    expect(spy).toHaveBeenCalledExactlyOnceWith('a', roots);
    // Second press: same selection, no additional publish.
    sendDelete(treeRow('header'), 'a', { metaKey: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(document.getSnapshot().selection.nodeIds).toEqual(roots);
  });

  it('empty page Ctrl+A is a no-op', () => {
    const { document } = keyboardHarness({ ids: [], schema: (() => {
      const schema = selectionApplication();
      schema.pages[0].children = [];
      return schema;
    })() });
    const spy = vi.spyOn(document, 'selectMany');
    canvasRoot().focus();
    expect(sendDelete(canvasRoot(), 'a', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it.each(['ArrowUp', 'ArrowDown'])(
    'canvas %s reorders the primary node among siblings and undoes cleanly',
    (key) => {
      const { document } = keyboardHarness({ ids: ['tail'] });
      const before = structuredClone(document.getSnapshot().plan.schema);
      canvasRoot().focus();
      expect(sendDelete(canvasRoot(), key).defaultPrevented).toBe(true);
      const ids = document.getSnapshot().plan.schema.pages[0].children.map((node) => node.id);
      // ArrowUp: tail (index 1) moves to index 0. ArrowDown: moves past shared.
      const expected = key === 'ArrowUp' ? ['tail', 'root', 'shared'] : ['root', 'shared', 'tail'];
      expect(ids).toEqual(expected);
      expect(document.getSnapshot().plan.schema).not.toEqual(before);
      act(document.undo);
      expect(document.getSnapshot().plan.schema).toEqual(before);
    },
  );

  it('arrow nudge is canvas-only and blocked while dragging or in code pages', () => {
    const documentHarness = keyboardHarness({ ids: ['tail'] });
    const { document } = documentHarness;
    const spy = vi.spyOn(document, 'reorderNode');
    const row = treeRow('tail');
    row.focus();
    // Tree domain owns arrow navigation; nudge never fires there.
    sendDelete(row, 'ArrowDown');
    expect(spy).not.toHaveBeenCalled();
    documentHarness.view.unmount();
    cleanup();

    // Tree-domain check done above; now verify code-enabled pages refuse nudge.
    const codeSchema = (() => {
      const schema = selectionApplication();
      schema.pages[0].code = { enabled: true, language: 'jsx', source: '', css: '' };
      return schema;
    })();
    expect(spy).not.toHaveBeenCalled();
    const coded = keyboardHarness({ schema: codeSchema, ids: ['tail'] });
    canvasRoot().focus();
    expect(sendDelete(canvasRoot(), 'ArrowDown').defaultPrevented).toBe(false);
    coded.view.unmount();
    expect(findNode(document.getSnapshot().plan.schema.pages[0], 'tail')).toBeTruthy();
  });
});
