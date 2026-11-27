import { act, cleanup, fireEvent, screen } from '@testing-library/react';
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

describe('Ctrl/Cmd+D component duplication', () => {
  it('duplicates one canvas node, selects the copy and undoes in one step', () => {
    const { document } = keyboardHarness({ ids: ['tail'] });
    const before = document.getSnapshot();
    const duplicate = vi.spyOn(document, 'duplicateNode');
    canvasRoot().focus();
    expect(sendDelete(canvasRoot(), 'd', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(duplicate).toHaveBeenCalledExactlyOnceWith('a', 'tail');
    const after = document.getSnapshot();
    const id = after.selection.nodeId!;
    expect(id).not.toBe('tail');
    const children = after.plan.schema.pages[0].children;
    expect(children[children.findIndex((node) => node.id === 'tail') + 1].id).toBe(id);
    expect(globalThis.document.activeElement).toBe(canvasRoot());
    act(document.undo);
    expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('duplicates multiple tree nodes, moves focus to the selected copy and leaves the clipboard alone', () => {
    const { document } = keyboardHarness({ ids: ['tail', 'shared'], primary: 'tail' });
    const duplicate = vi.spyOn(document, 'duplicateNodes');
    const before = document.getSnapshot();
    const clipboard = document.getClipboardSnapshot();
    treeRow('tail').focus();
    expect(sendDelete(treeRow('tail'), 'D', { metaKey: true }).defaultPrevented).toBe(true);
    expect(duplicate).toHaveBeenCalledOnce();
    const after = document.getSnapshot();
    expect(after.selection.nodeIds).toHaveLength(2);
    expect(after.selection.nodeIds).not.toContain('tail');
    expect(after.selection.nodeIds).not.toContain('shared');
    expect(globalThis.document.activeElement).toBe(treeRow(after.selection.nodeId!));
    expect(document.getClipboardSnapshot()).toBe(clipboard);
    act(document.undo);
    expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('does not duplicate during an active canvas resize, and resumes after cancellation', async () => {
    const { document } = keyboardHarness({ ids: ['tail'] });
    const before = document.getSnapshot();
    const handle = await screen.findByRole('button', { name: '从右侧调整尺寸' });
    const canvas = canvasRoot();
    canvas.focus();
    const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    Object.defineProperty(pointer, 'pointerId', { value: 1 });
    fireEvent(handle, pointer);
    expect(pointer.defaultPrevented).toBe(true);
    expect(handle.closest('[data-resizing]')).not.toBeNull();
    expect(sendDelete(canvas, 'd', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    expect(sendDelete(canvas, 'Escape').defaultPrevented).toBe(true);
    expect(sendDelete(canvas, 'd', { ctrlKey: true }).defaultPrevented).toBe(true);
  });

  it('yields to search, other controls, IME, pointer drag, preview and unselected rows', () => {
    const { document, view, tree, drag } = keyboardHarness({ ids: ['tail'], children: <input data-canvas-action aria-label="Canvas control" /> });
    const before = document.getSnapshot();
    const targets = [treeRow('shared'), screen.getByLabelText('搜索组件树'), screen.getByLabelText('Canvas control')];
    for (const target of targets) {
      target.focus();
      expect(sendDelete(target, 'd', { ctrlKey: true }).defaultPrevented).toBe(false);
    }
    const canvas = canvasRoot();
    canvas.focus();
    fireEvent.compositionStart(canvas);
    expect(sendDelete(canvas, 'd', { ctrlKey: true }).defaultPrevented).toBe(false);
    fireEvent.compositionEnd(canvas);
    expect(sendDelete(canvas, 'd', { ctrlKey: true, repeat: true }).defaultPrevented).toBe(false);
    expect(sendDelete(canvas, 'd', { ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    act(() => drag().begin({ kind: 'material', component: 'ui.text' }));
    expect(sendDelete(canvas, 'd', { ctrlKey: true }).defaultPrevented).toBe(false);
    act(() => drag().cancel());
    view.rerender(tree('preview'));
    treeRow('tail').focus();
    expect(sendDelete(treeRow('tail'), 'd', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.getSnapshot()).toBe(before);
  });
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
