import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortal } from 'react-dom';
import { CodeEditor } from '../src/ui/CodeEditor';
import { TipProvider } from '../src/ui/primitives';
import { selectedNodeIds } from '../packages/editor/selection';
import { findNode } from '../packages/editor/document';
import { canvasRoot, keyboardHarness, keyboardSchema, treeRow } from './keyboard-delete-fixture';
import { pressHistory } from './local-history-fixture';
import { pressClipboard } from './local-clipboard-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

function unconsumed(target: Element, key = 'c', init: KeyboardEventInit = { ctrlKey: true }) {
  const bubble = vi.fn();
  window.addEventListener('keydown', bubble);
  try {
    const event = pressClipboard(target, key, init);
    expect(event.defaultPrevented).toBe(false);
    expect(bubble).toHaveBeenCalledExactlyOnceWith(event);
    return event;
  } finally {
    window.removeEventListener('keydown', bubble);
  }
}

describe('focused author clipboard uses the real static forest command', () => {
  it('Ctrl copy and Meta uppercase paste retain ordered forest, exact publications and one Undo across pages', () => {
    const h = keyboardHarness({ ids: ['tail', 'card', 'header'], primary: 'header' });
    const author = h.document;
    const initial = author.getSnapshot();
    const copy = vi.spyOn(author, 'copyNodesToClipboard');
    const paste = vi.spyOn(author, 'pasteClipboardNodes');
    const single = vi.spyOn(author, 'copyNodeToClipboard');
    const docPub = vi.fn(),
      clipPub = vi.fn();
    const stopDoc = author.subscribe(docPub),
      stopClip = author.subscribeClipboard(clipPub);
    const navigation = h.session().navigation;
    const request = vi.spyOn(navigation, 'requestLocate');
    canvasRoot().focus();
    expect(pressClipboard(canvasRoot()).defaultPrevented).toBe(true);
    expect(copy).toHaveBeenCalledExactlyOnceWith('a', ['card', 'header', 'tail']);
    expect(single).not.toHaveBeenCalled();
    expect(docPub).not.toHaveBeenCalled();
    expect(clipPub).toHaveBeenCalledOnce();
    expect(author.getSnapshot()).toBe(initial);
    const clipboard = author.getClipboardSnapshot();
    expect(clipboard.rootCount).toBe(2);
    expect(document.activeElement).toBe(canvasRoot());
    act(() => author.selectPage('b'));
    docPub.mockClear();
    clipPub.mockClear();
    const before = author.getSnapshot();
    const sourceCard = findNode(initial.plan.pages.get('a')!.schema, 'card')!.node;
    canvasRoot().focus();
    expect(pressClipboard(canvasRoot(), 'V', { metaKey: true }).defaultPrevented).toBe(true);
    const after = author.getSnapshot(),
      page = after.plan.pages.get('b')!.schema;
    const appended = page.children.slice(-2),
      ids = appended.map((n) => n.id);
    expect(paste).toHaveBeenCalledExactlyOnceWith('b');
    expect(docPub).toHaveBeenCalledOnce();
    expect(clipPub).not.toHaveBeenCalled();
    expect(author.getClipboardSnapshot()).toBe(clipboard);
    expect(page.children.slice(0, -2)).toEqual(before.plan.pages.get('b')!.schema.children);
    expect(appended.map((n) => n.component)).toEqual(['ui.card', 'ui.text']);
    expect(appended[0].props).toEqual(sourceCard.props);
    expect(appended[0].slots!.header.children[0].props).toEqual(
      sourceCard.slots!.header.children[0].props,
    );
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => !findNode(initial.plan.pages.get('a')!.schema, id))).toBe(true);
    expect(selectedNodeIds(after.selection)).toEqual(ids);
    expect(after.selection.nodeId).toBe(ids[0]);
    expect(after.revision).toBe(before.revision + 1);
    expect(request).not.toHaveBeenCalled();
    act(() => author.undo());
    expect(author.getSnapshot().plan).toBe(before.plan);
    expect(author.getSnapshot().selection).toEqual(before.selection);
    expect(author.getClipboardSnapshot()).toBe(clipboard);
    stopDoc();
    stopClip();
  });

  it('ancestor and descendant copy produces one root, then filtered tree host supports V/V/Z without reveal or scroll', () => {
    const h = keyboardHarness({ ids: ['card', 'header'], primary: 'card' });
    treeRow('card').focus();
    expect(pressClipboard(treeRow('card'), 'C', { metaKey: true }).defaultPrevented).toBe(true);
    expect(h.document.getClipboardSnapshot().rootCount).toBeUndefined();
    expect(h.document.getClipboardSnapshot().component).toBe('ui.card');
    fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
    fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: 'tail' } });
    const host = screen.getByRole('region', { name: '组件树' });
    const treeScroll = screen.getByLabelText('Keyboard tree scroll');
    const canvasScroll = screen.getByLabelText('Keyboard canvas scroll');
    treeScroll.scrollTop = 93;
    canvasScroll.scrollTop = 71;
    canvasScroll.scrollLeft = 24;
    const viewport = h.session().viewport.getSnapshot(),
      before = h.document.getSnapshot();
    const locate = vi.spyOn(h.session().navigation, 'requestLocate');
    host.focus();
    expect(pressClipboard(host, 'v').defaultPrevented).toBe(true);
    const once = h.document.getSnapshot();
    expect(treeRow(once.selection.nodeId!)).toBeUndefined();
    expect(document.activeElement).toBe(host);
    expect(pressClipboard(host, 'v').defaultPrevented).toBe(true);
    expect(h.document.getSnapshot().revision).toBe(before.revision + 2);
    expect(document.activeElement).toBe(host);
    expect(pressHistory(host).defaultPrevented).toBe(true);
    expect(h.document.getSnapshot().plan).toBe(once.plan);
    expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('tail');
    expect(treeScroll.scrollTop).toBe(93);
    expect(canvasScroll.scrollTop).toBe(71);
    expect(canvasScroll.scrollLeft).toBe(24);
    expect(h.session().viewport.getSnapshot()).toBe(viewport);
    expect(locate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '展开 root' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('mixed nonstatic selection is an owned error preserving prior clipboard, state and history', () => {
    const schema = keyboardSchema();
    schema.pages[0].children[1].props.value = { kind: 'stateRef', stateId: 'caption' };
    const h = keyboardHarness({ schema });
    canvasRoot().focus();
    pressClipboard(canvasRoot());
    const prior = h.document.getClipboardSnapshot();
    act(() => h.document.selectMany('a', ['alpha', 'tail'], 'alpha'));
    const before = h.document.getSnapshot();
    const copy = vi.spyOn(h.document, 'copyNodesToClipboard');
    canvasRoot().focus();
    expect(pressClipboard(canvasRoot()).defaultPrevented).toBe(true);
    expect(copy).toHaveBeenCalledOnce();
    expect(h.document.getSnapshot()).toBe(before);
    expect(h.document.getClipboardSnapshot()).toBe(prior);
    expect(screen.getByRole('alert').textContent).toMatch(/静态|stateRef|状态|动态/);
    expect(document.activeElement).toBe(canvasRoot());
  });

  it('empty commands are untouched no-ops and native event re-delivery never executes twice', () => {
    const h = keyboardHarness();
    act(() => h.document.select('a', null));
    canvasRoot().focus();
    const before = h.document.getSnapshot(),
      navigation = h.session().navigation.getSnapshot();
    unconsumed(canvasRoot());
    unconsumed(canvasRoot(), 'v');
    expect(h.document.getSnapshot()).toBe(before);
    expect(h.session().navigation.getSnapshot()).toBe(navigation);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => h.document.select('a', 'alpha'));
    const copy = vi.spyOn(h.document, 'copyNodesToClipboard');
    const event = pressClipboard(canvasRoot());
    fireEvent(canvasRoot(), event);
    expect(copy).toHaveBeenCalledOnce();
  });
});

describe('clipboard family routing preserves native ownership', () => {
  it('all denied modifier and composition branches bubble through the real Canvas generic capture', () => {
    const h = keyboardHarness(),
      before = h.document.getSnapshot();
    canvasRoot().focus();
    for (const init of [
      { ctrlKey: true, shiftKey: true },
      { metaKey: true, altKey: true },
      { ctrlKey: true, metaKey: true },
      { ctrlKey: true, repeat: true },
      { ctrlKey: true, isComposing: true },
      { metaKey: true, keyCode: 229 },
    ])
      unconsumed(canvasRoot(), 'C', init);
    fireEvent.compositionStart(canvasRoot(), { data: '中' });
    unconsumed(canvasRoot());
    fireEvent.compositionEnd(canvasRoot(), { data: '中' });
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('Alpha text', { selector: 'p' }));
    window.getSelection()!.addRange(range);
    unconsumed(canvasRoot(), 'v');
    window.getSelection()!.removeAllRanges();
    const prevented = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    prevented.preventDefault();
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble);
    try {
      fireEvent(canvasRoot(), prevented);
      expect(bubble).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', bubble);
    }
    expect(h.document.getSnapshot()).toBe(before);
    expect(h.document.getClipboardSnapshot().available).toBe(false);
    expect(pressClipboard(canvasRoot()).defaultPrevented).toBe(true);
  });

  it('native inputs, actual CodeEditor draft and expanded dialog keep C/V and contents', async () => {
    const h = keyboardHarness({
      children: (
        <div data-canvas-action="true">
          <input aria-label="Clipboard native input" defaultValue="input draft" />
          <textarea aria-label="Clipboard native textarea" defaultValue="textarea draft" />
          <select aria-label="Clipboard native select">
            <option>one</option>
          </select>
          <div
            tabIndex={0}
            contentEditable
            suppressContentEditableWarning
            aria-label="Clipboard native editable"
          >
            text draft
          </div>
          <div className="monaco-editor">
            <input aria-label="Clipboard Monaco marked input" defaultValue="model draft" />
          </div>
          <div tabIndex={0} role="textbox" aria-label="Clipboard textbox">
            text draft
          </div>
          <CodeEditor
            label="Clipboard JS draft"
            language="javascript"
            value="const dirty = 1;"
            onChange={() => {}}
          />
        </div>
      ),
    });
    const before = h.document.getSnapshot(),
      clip = h.document.getClipboardSnapshot();
    for (const label of [
      'Clipboard native input',
      'Clipboard native textarea',
      'Clipboard native select',
      'Clipboard native editable',
      'Clipboard Monaco marked input',
      'Clipboard textbox',
      'Clipboard JS draft',
    ]) {
      const target = screen.getByLabelText(label);
      target.focus();
      unconsumed(target);
      unconsumed(target, 'V', { metaKey: true });
      expect(document.activeElement).toBe(target);
    }
    render(
      <TipProvider>
        <CodeEditor
          label="Clipboard expanded JS"
          language="javascript"
          value="let native = 2;"
          onChange={() => {}}
        />
      </TipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开Clipboard expanded JS' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clipboard expanded JS' });
    const draft = within(dialog).getByRole('textbox', { name: 'Clipboard expanded JS' });
    draft.focus();
    unconsumed(draft);
    unconsumed(draft, 'v');
    expect((draft as HTMLTextAreaElement).value).toBe('let native = 2;');
    expect(h.document.getSnapshot()).toBe(before);
    expect(h.document.getClipboardSnapshot()).toBe(clip);
  });

  it('physical Portal, ShadowRoot and selected-looking arbitrary tree buttons acquire no authority', () => {
    const portal = document.createElement('div');
    document.body.append(portal);
    try {
      const h = keyboardHarness({
        children: createPortal(<button>Clipboard portal</button>, portal),
      });
      const before = h.document.getSnapshot();
      const external = screen.getByRole('button', { name: 'Clipboard portal' });
      external.focus();
      unconsumed(external);
      const host = screen.getByRole('region', { name: '组件树' });
      const fake = document.createElement('button');
      fake.className = 'tree-select';
      fake.textContent = 'Fake row';
      host.append(fake);
      fake.focus();
      unconsumed(fake);
      fake.remove();
      const root = canvasRoot();
      const inner = document.createElement('button');
      root.attachShadow({ mode: 'open' }).append(inner);
      inner.focus();
      unconsumed(inner, 'c', { ctrlKey: true, composed: true });
      expect(h.document.getSnapshot()).toBe(before);
      expect(h.document.getClipboardSnapshot().available).toBe(false);
    } finally {
      portal.remove();
    }
  });

  it('unselected row/search/actions, hidden/inert host, preview and pending drag refuse without blanket interception', () => {
    const h = keyboardHarness();
    const before = h.document.getSnapshot();
    for (const target of [
      treeRow('tail'),
      screen.getByLabelText('搜索组件树'),
      screen.getByRole('button', { name: '定位当前节点' }),
      screen.getByLabelText('Outside editor input'),
    ]) {
      target.focus();
      unconsumed(target);
      unconsumed(target, 'v');
    }
    canvasRoot().focus();
    canvasRoot().setAttribute('inert', '');
    unconsumed(canvasRoot());
    canvasRoot().removeAttribute('inert');
    canvasRoot().style.visibility = 'hidden';
    unconsumed(canvasRoot());
    canvasRoot().style.visibility = '';
    h.duringPending(() => unconsumed(canvasRoot()));
    const pointer = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 12,
      clientY: 14,
    });
    Object.defineProperty(pointer, 'pointerId', { value: 1 });
    fireEvent(screen.getByRole('button', { name: 'Prepare material pointer' }), pointer);
    act(() => h.drag().cancel());
    h.view.rerender(h.tree('preview'));
    const preview = screen.getByLabelText('页面交互预览');
    preview.focus();
    unconsumed(preview);
    expect(h.document.getSnapshot()).toBe(before);
    expect(h.document.getClipboardSnapshot().available).toBe(false);
  });
});
