import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { selectedNodeIds } from '../packages/editor/selection';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorCanvas } from '../src/editor/Canvas';
import { ComponentTree } from '../src/editor/ComponentTree';
import { EditorToolbar, PropertyPanel } from '../src/editor/Editor';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import {
  selectionApplication,
  selectionRegistry,
  selectionText,
  lit,
} from './multiselection-fixture';

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
beforeEach(() => {
  frames.clear();
  frameId = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frames.clear();
});
async function measure() {
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
function setup(repeated = false) {
  const schema = selectionApplication();
  if (repeated)
    schema.pages[0].children.push({
      id: 'repeated',
      component: 'ui.layout',
      props: {},
      repeat: {
        items: lit([{ id: 'row-a' }, { id: 'row-b' }]),
        item: 'row',
        key: { kind: 'expression', language: 'javascript', source: 'scope.row.id' },
      },
      children: [
        {
          ...selectionText('repeated-text'),
          props: { value: { kind: 'expression', language: 'javascript', source: 'scope.row.id' } },
        },
      ],
    });
  const document = new EditorDocument(schema, selectionRegistry());
  document.select('a', 'alpha');
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <button onPointerDown={(event) => drag.begin({ kind: 'node', nodeId: 'alpha' }, event)}>
        Pending gesture
      </button>
    );
  }
  function Host({ mode }: { mode: 'edit' | 'preview' }) {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot),
      runtime = useMemo(
        () =>
          new PageRuntime(snapshot.plan, snapshot.selection.pageId, {
            designMode: mode === 'edit',
          }),
        [snapshot.plan, snapshot.selection.pageId],
      );
    useEffect(() => () => runtime.dispose(), [runtime]);
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={mode === 'edit'}>
        <Probe />
        <ComponentTree document={document} snapshot={snapshot} />
        <EditorToolbar document={document} snapshot={snapshot} authoringAllowed={mode === 'edit'} />
        <EditorCanvas document={document} snapshot={snapshot} runtime={runtime} mode={mode} />
        <PropertyPanel document={document} snapshot={snapshot} />
        <input aria-label="Ordinary input" />
        <textarea aria-label="Code draft" />
      </DragDropProvider>
    );
  }
  const tree = (mode: 'edit' | 'preview' = 'edit') => (
      <EditorSessionProvider>
        <TipProvider>
          <Host mode={mode} />
        </TipProvider>
      </EditorSessionProvider>
    ),
    view = render(tree());
  return { document, view, tree, getDrag: () => drag };
}
const treeButton = (id: string, type = '文本') =>
  screen.getByRole('button', { name: `选中 ${type} ${id}` });
function pointer(
  target: Element | Window,
  type: string,
  modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {},
  x = 10,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: x,
    ...modifiers,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

describe('actual tree and canvas multi-selection gestures', () => {
  it.each(['ctrlKey', 'metaKey'] as const)(
    'tree %s click toggles one definition,canonical order and primary;plain click collapses',
    (modifier) => {
      const { document } = setup(),
        toggle = vi.spyOn(document, 'toggleSelect');
      pointer(treeButton('tail'), 'pointerdown', { [modifier]: true });
      fireEvent.click(treeButton('tail'), { [modifier]: true, detail: 1 });
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(document.getSnapshot().selection).toEqual({
        pageId: 'a',
        nodeId: 'tail',
        nodeIds: ['alpha', 'tail'],
      });
      expect(treeButton('alpha').getAttribute('aria-pressed')).toBe('true');
      expect(treeButton('tail').getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(treeButton('tail'));
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'tail' });
    },
  );
  it.each(['ctrlKey', 'metaKey'] as const)(
    'canvas %s pointerdown plus click changes selection exactly once and never creates drag',
    (modifier) => {
      const { document, getDrag } = setup(),
        target = screen.getByText('Tail text', { selector: 'p' }),
        toggle = vi.spyOn(document, 'toggleSelect');
      pointer(target, 'pointerdown', { [modifier]: true });
      pointer(window, 'pointermove', { [modifier]: true }, 100);
      pointer(window, 'pointerup', { [modifier]: true }, 100);
      fireEvent.click(target, { [modifier]: true, detail: 1 });
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(document.getSnapshot().selection).toEqual({
        pageId: 'a',
        nodeId: 'tail',
        nodeIds: ['alpha', 'tail'],
      });
      expect(getDrag().isInteracting).toBe(false);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
    },
  );
  it.each(['ctrlKey', 'metaKey'] as const)(
    'focused tree %s+Space toggles locally once and ignores key repeat',
    (modifier) => {
      const { document } = setup(),
        toggle = vi.spyOn(document, 'toggleSelect'),
        target = treeButton('tail');
      target.focus();
      fireEvent.keyDown(target, { key: ' ', [modifier]: true });
      fireEvent.keyDown(target, { key: ' ', [modifier]: true, repeat: true });
      fireEvent.keyUp(target, { key: ' ', [modifier]: true });
      expect(toggle).toHaveBeenCalledTimes(1);
      expect(selectedNodeIds(document.getSnapshot().selection)).toEqual(['alpha', 'tail']);
    },
  );
  it('multi first plain canvas gesture collapses without dragging;the next ordinary gesture can drag', () => {
    const { document, getDrag } = setup();
    act(() => document.selectMany('a', ['alpha', 'tail'], 'alpha'));
    const alpha = screen.getByText('Alpha text', { selector: 'p' });
    pointer(alpha, 'pointerdown');
    pointer(window, 'pointermove', {}, 100);
    pointer(window, 'pointerup', {}, 100);
    fireEvent.click(alpha, { detail: 1 });
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'alpha' });
    expect(getDrag().isInteracting).toBe(false);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    pointer(alpha, 'pointerdown');
    pointer(window, 'pointermove', {}, 100);
    expect(screen.getByLabelText('拖放操作')).toBeTruthy();
    pointer(window, 'pointercancel');
  });
  it('multi tree drag handles and canvas Space refuse group drag while palette insertion remains normal', () => {
    const { document, getDrag } = setup();
    act(() => document.selectMany('a', ['alpha', 'tail']));
    expect(screen.getByRole('button', { name: '拖动 文本 alpha' })).toHaveProperty(
      'disabled',
      true,
    );
    fireEvent.keyDown(screen.getByLabelText('页面编辑画布'), { key: ' ' });
    expect(getDrag().isInteracting).toBe(false);
    act(() => getDrag().begin({ kind: 'material', component: 'ui.text' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
    expect(document.getSnapshot().selection).not.toHaveProperty('nodeIds');
    expect(document.getSnapshot().selection.nodeId).not.toBe('alpha');
  });
  it('shows selected count/effective roots,secondary outline and at most one primary toolbar', async () => {
    const { document, view } = setup();
    act(() => document.selectMany('a', ['root', 'alpha', 'tail'], 'alpha'));
    await measure();
    expect(screen.getAllByText('已选 3 项 · 2 个顶层组件').length).toBeGreaterThan(0);
    expect(
      view.container
        .querySelector('[data-editor-node="tail"]')
        ?.getAttribute('data-editor-selected'),
    ).toBe('true');
    expect(view.container.querySelector('[data-editor-outline="tail"]')?.className).toContain(
      'secondary',
    );
    expect(view.container.querySelectorAll('.canvas-selection-toolbar').length).toBeLessThanOrEqual(
      1,
    );
    for (const name of ['复制选中组件', '选择父级组件', '删除选中组件']) {
      const action = screen.queryByRole('button', { name });
      if (action) expect(action).toHaveProperty('disabled', true);
    }
  });
  it('explicit bulk delete removes all definitions once and actual toolbar Undo/Redo restores full multi', () => {
    const { document } = setup();
    act(() => document.selectMany('a', ['alpha', 'header', 'tail'], 'header'));
    const before = document.exportJson(),
      remove = vi.spyOn(document, 'removeNodes');
    fireEvent.click(screen.getAllByRole('button', { name: '删除所选组件' })[0]);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: null });
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(document.exportJson()).toBe(before);
    expect(document.getSnapshot().selection).toEqual({
      pageId: 'a',
      nodeId: 'header',
      nodeIds: ['alpha', 'header', 'tail'],
    });
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: null });
  });
  it('multi inspector unmounts primary editors and clipboard copy enables while page-end paste remains enabled', async () => {
    const { document } = setup();
    document.copyNodeToClipboard('a', 'card');
    act(() => document.selectMany('a', ['alpha', 'tail'], 'alpha'));
    expect(screen.queryByRole('tab', { name: '属性' })).toBeNull();
    expect(screen.queryByLabelText('文本内容')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
    const copy = await screen.findByRole('menuitem', { name: '复制组件到剪贴板' });
    expect(copy.getAttribute('aria-disabled')).not.toBe('true');
    const paste = screen.getByRole('menuitem', { name: '粘贴组件到页面末尾' });
    expect(paste.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(paste);
    expect(document.getSnapshot().selection).not.toHaveProperty('nodeIds');
  });
  it('two repeated runtime instances toggle the same Schema definition rather than selecting business rows', () => {
    const { document } = setup(true),
      first = screen.getByText('row-a'),
      second = screen.getByText('row-b');
    fireEvent.click(first, { ctrlKey: true });
    expect(selectedNodeIds(document.getSnapshot().selection)).toEqual(['alpha', 'repeated-text']);
    fireEvent.click(second, { ctrlKey: true });
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'alpha' });
  });
  it('preview retains selection for edit return but has no canvas selection/action feedback', async () => {
    const { document, view, tree } = setup();
    act(() => document.selectMany('a', ['alpha', 'tail'], 'tail'));
    view.rerender(tree('preview'));
    await measure();
    expect(document.getSnapshot().selection.nodeIds).toEqual(['alpha', 'tail']);
    expect(view.container.querySelectorAll('.canvas-outline.selected')).toHaveLength(0);
    expect(
      within(screen.getByLabelText('页面交互预览')).queryByRole('button', { name: '删除所选组件' }),
    ).toBeNull();
    fireEvent.click(screen.getByText('Alpha text', { selector: 'p' }), { ctrlKey: true });
    expect(document.getSnapshot().selection.nodeIds).toEqual(['alpha', 'tail']);
    view.rerender(tree('edit'));
    expect(treeButton('alpha').getAttribute('aria-pressed')).toBe('true');
  });
  it('local explicit selection does not globally intercept native input/textarea shortcuts', () => {
    const { document } = setup();
    const before = document.getSnapshot();
    for (const label of ['Ordinary input', 'Code draft'])
      for (const key of ['Delete', 'Backspace', 'a']) {
        const event = new KeyboardEvent('keydown', {
          key,
          ctrlKey: key === 'a',
          bubbles: true,
          cancelable: true,
        });
        fireEvent(screen.getByLabelText(label), event);
        expect(event.defaultPrevented).toBe(false);
      }
    expect(document.getSnapshot()).toBe(before);
  });
});
