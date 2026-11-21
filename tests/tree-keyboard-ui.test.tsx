import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lit } from './multiselection-fixture';
import * as canvasHost from '../src/editor/CanvasHost';
import {
  treeAuthor,
  treeHarness,
  treeHost,
  treeOrder,
  treePointer,
  treeRow,
  treeRows,
  treeRuntimes,
  treeSearch,
  pressTree,
} from './tree-keyboard-fixture';
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 20, 240, 30));
});
afterEach(() => {
  cleanup();
  treeRuntimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
});
const collapse = (id: string) =>
  fireEvent.click(screen.getByRole('button', { name: `折叠 ${id}` }));
const search = (value: string) => fireEvent.change(treeSearch(), { target: { value } });
const focusKey = (id: string, key: string, init?: KeyboardEventInit) => {
  const row = treeRow(id);
  row.focus();
  return pressTree(row, key, init);
};

describe('real tree rendering and six-key selection/focus policy', () => {
  it('keeps native region/list/buttons and exact definition order without adding tree roles or roving Tab', () => {
    treeHarness();
    expect(treeRows()).toEqual(treeOrder);
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryAllByRole('treeitem')).toEqual([]);
    expect(treeHost().tabIndex).toBe(-1);
    for (const id of treeOrder) expect(treeRow(id).tabIndex).toBe(0);
  });
  it('self-matching parent query filters each child list and preserves real slot headings/drop zones', () => {
    treeHarness();
    search('card');
    expect(treeRows()).toEqual(['root', 'card']);
    expect(treeHost().textContent).toContain('header');
    expect(treeHost().textContent).toContain('footer');
    expect(screen.queryByText('空容器 · 拖入组件')).toBeNull();
    search('Slot text');
    expect(treeRows()).toEqual(['root', 'card', 'slot-wrap', 'slot-leaf']);
    focusKey('card', 'ArrowRight');
    expect(document.activeElement).toBe(treeRow('slot-wrap'));
  });
  it('raw-space query forces open but never trims into empty-query behavior', () => {
    treeHarness();
    collapse('root');
    search(' ');
    expect(treeRows()).toEqual(treeOrder);
    expect(treeSearch().value).toBe(' ');
    const toggle = screen.getByRole('button', { name: '折叠 root' });
    const before = toggle.getAttribute('aria-expanded');
    focusKey('root', 'ArrowLeft');
    expect(toggle.getAttribute('aria-expanded')).toBe(before);
    search('   ');
    expect(treeRows()).toEqual([]);
    expect(screen.getByText('没有匹配的组件')).toBeTruthy();
  });
  it.each([
    ['alpha', 'ArrowDown', 'card'],
    ['card', 'ArrowUp', 'alpha'],
    ['header', 'ArrowLeft', 'card'],
    ['slot-leaf', 'ArrowLeft', 'slot-wrap'],
    ['shared', 'Home', 'root'],
    ['root', 'End', 'repeated'],
  ])('focused %s %s selects and synchronously focuses %s', (from, key, destination) => {
    const h = treeHarness();
    const before = h.author.getSnapshot(),
      select = vi.spyOn(h.author, 'select');
    expect(focusKey(from, key).defaultPrevented).toBe(true);
    expect(select).toHaveBeenCalledExactlyOnceWith('a', destination);
    expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: destination });
    expect(document.activeElement).toBe(treeRow(destination));
    expect(h.author.getSnapshot().plan).toBe(before.plan);
    expect(h.author.getSnapshot().revision).toBe(before.revision);
    expect(h.author.getSnapshot().canUndo).toBe(before.canUndo);
  });
  it('focused A to already-selected singleton B is genuine zero-publication move and still focuses B', () => {
    const h = treeHarness();
    const before = h.author.getSnapshot(),
      notify = vi.fn(),
      select = vi.spyOn(h.author, 'select');
    h.author.subscribe(notify);
    const destination = treeRow('alpha'),
      focus = vi.spyOn(destination, 'focus');
    expect(focusKey('root', 'ArrowDown').defaultPrevented).toBe(true);
    expect(select).toHaveBeenCalledExactlyOnceWith('a', 'alpha');
    expect(notify).not.toHaveBeenCalled();
    expect(h.author.getSnapshot()).toBe(before);
    expect(document.activeElement).toBe(destination);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });
  it('multi with target as primary must publish once, collapse to single and focus it', () => {
    const h = treeHarness();
    act(() => h.author.selectMany('a', ['alpha', 'tail'], 'alpha'));
    const notify = vi.fn();
    h.author.subscribe(notify);
    focusKey('root', 'ArrowDown');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'alpha' });
    expect(document.activeElement).toBe(treeRow('alpha'));
  });
  it.each([
    ['root', 'ArrowUp'],
    ['root', 'Home'],
    ['repeated', 'ArrowDown'],
    ['repeated', 'End'],
    ['shared', 'ArrowLeft'],
    ['alpha', 'ArrowRight'],
    ['empty', 'ArrowRight'],
  ])('eligible %s %s boundary consumes without state/focus/group writes', (id, key) => {
    const h = treeHarness();
    act(() => h.author.selectMany('a', ['alpha', 'tail'], 'tail'));
    const before = h.author.getSnapshot();
    const select = vi.spyOn(h.author, 'select'),
      end = vi.spyOn(h.author, 'endGroup'),
      write = vi.spyOn(h.session().drafts, 'write');
    const row = treeRow(id);
    row.focus();
    const focus = vi.spyOn(row, 'focus');
    const propagate = vi.fn();
    document.body.addEventListener('keydown', propagate);
    const event = pressTree(row, key);
    document.body.removeEventListener('keydown', propagate);
    expect(event.defaultPrevented).toBe(true);
    expect(propagate).not.toHaveBeenCalled();
    expect(h.author.getSnapshot()).toBe(before);
    expect(select).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
  });
  it('Right expansion only preserves raw multi/focus; subsequent fresh Right enters first child; Left collapses only', () => {
    const h = treeHarness();
    act(() => h.author.selectMany('a', ['alpha', 'tail'], 'tail'));
    collapse('root');
    const before = h.author.getSnapshot();
    treeRow('root').focus();
    pressTree(treeRow('root'), 'ArrowRight');
    expect(h.author.getSnapshot()).toBe(before);
    expect(document.activeElement).toBe(treeRow('root'));
    expect(treeRow('alpha')).not.toBeNull();
    pressTree(treeRow('root'), 'ArrowRight');
    expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'alpha' });
    expect(document.activeElement).toBe(treeRow('alpha'));
    act(() => h.author.selectMany('a', ['alpha', 'tail'], 'tail'));
    const multi = h.author.getSnapshot();
    focusKey('root', 'ArrowLeft');
    expect(h.author.getSnapshot()).toBe(multi);
    expect(treeRow('alpha')).toBeNull();
    expect(document.activeElement).toBe(treeRow('root'));
  });
  it('search Left moves to component parent without fake collapse or clearing query', () => {
    const h = treeHarness();
    collapse('root');
    search('Slot text');
    const before = h.author.getSnapshot();
    focusKey('slot-leaf', 'ArrowLeft');
    expect(h.author.getSnapshot().selection.nodeId).toBe('slot-wrap');
    expect(treeSearch().value).toBe('Slot text');
    expect(treeRows()).toEqual(['root', 'card', 'slot-wrap', 'slot-leaf']);
    expect(h.author.getSnapshot().plan).toBe(before.plan);
  });
  it.each(['preview', 'code'] as const)(
    'fresh tree navigation remains usable for %s read-only inspection',
    (kind) => {
      const h = treeHarness();
      if (kind === 'preview') h.view.rerender(h.tree(h.author, false));
      else
        act(() =>
          h.author.setPageCode('a', {
            ...h.author.getSnapshot().plan.pages.get('a')!.schema.code!,
            enabled: true,
          }),
        );
      const before = h.author.getSnapshot();
      expect(focusKey('alpha', 'ArrowDown').defaultPrevented).toBe(true);
      expect(h.author.getSnapshot().selection.nodeId).toBe('card');
      expect(document.activeElement).toBe(treeRow('card'));
      expect(h.author.getSnapshot().plan).toBe(before.plan);
      const toggle = vi.spyOn(h.author, 'toggleSelect');
      pressTree(treeRow('card'), ' ', { ctrlKey: true });
      expect(toggle).not.toHaveBeenCalled();
    },
  );
  it('ordinary repeat runs fresh checks and moves from each currently focused row', () => {
    const h = treeHarness();
    treeRow('alpha').focus();
    pressTree(treeRow('alpha'), 'ArrowDown', { repeat: true });
    pressTree(treeRow('card'), 'ArrowDown', { repeat: true });
    expect(h.author.getSnapshot().selection.nodeId).toBe('body');
    expect(document.activeElement).toBe(treeRow('body'));
  });
  it('selection navigation preserves business runtime/native DOM/history/drafts and only reveals local tree scroll', () => {
    const reveal = vi.spyOn(canvasHost, 'revealRect');
    const h = treeHarness({ canvas: true });
    const before = h.author.getSnapshot(),
      runtime = h.runtime(),
      business = screen.getByText('Alpha text', { selector: 'p' });
    const draft = { value: 'retained', source: 'source', dirty: true };
    h.session().drafts.write('independent-dirty', draft);
    const scroll = screen.getByLabelText('Independent tree scroll'),
      canvas = screen.getByLabelText('Independent canvas scroll');
    canvas.scrollTop = 123;
    const targetRow = treeRow('tail').closest<HTMLElement>('[data-editor-tree-node]')!;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return this === scroll
        ? new DOMRect(0, 0, 240, 100)
        : this === targetRow
          ? new DOMRect(0, 500, 220, 30)
          : new DOMRect(0, 20, 240, 30);
    });
    const locate = vi.spyOn(h.session().navigation, 'requestLocate');
    treeRow('slot-leaf').focus();
    pressTree(treeRow('slot-leaf'), 'ArrowDown');
    expect(reveal.mock.calls.some(([owner, rect]) => owner === scroll && rect.top === 500)).toBe(
      true,
    );
    expect(document.activeElement).toBe(treeRow('tail'));
    expect(scroll.scrollTop).toBeGreaterThan(0);
    expect(canvas.scrollTop).toBe(123);
    expect(locate).not.toHaveBeenCalled();
    expect(h.session().navigation.getSnapshot().selectedInstance).toEqual({
      pageId: 'a',
      nodeId: 'tail',
    });
    expect(h.author.getSnapshot().plan).toBe(before.plan);
    expect(h.author.getSnapshot().revision).toBe(before.revision);
    expect(h.runtime()).toBe(runtime);
    expect(runtime.disposed).toBe(false);
    expect(screen.getByText('Alpha text', { selector: 'p' })).toBe(business);
    expect(h.session().drafts.read('independent-dirty', 'source', '')).toBe(draft);
  });
});

describe('only eligible exact focused row events are consumed', () => {
  it('legitimate outer ResponsiveSide BaseUI Dialog preserves exact tree-region navigation', () => {
    const h = treeHarness({ outerDialog: true });
    expect(treeHost().closest('#left-panel[role="dialog"]')).not.toBeNull();
    expect(focusKey('alpha', 'ArrowDown').defaultPrevented).toBe(true);
    expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'card' });
    expect(document.activeElement).toBe(treeRow('card'));
  });
  it.each(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip', 'popover'])(
    'foreign inner %s wrapping the current row refuses without consumption',
    (kind) => {
      const h = treeHarness(),
        row = treeRow('alpha').closest<HTMLElement>('[data-editor-tree-node]')!,
        parent = row.parentNode!;
      const wrapper = document.createElement('div');
      if (kind === 'popover') {
        wrapper.setAttribute('popover', 'auto');
        wrapper.style.display = 'block';
      } else wrapper.setAttribute('role', kind);
      parent.insertBefore(wrapper, row);
      wrapper.append(row);
      treeRow('alpha').focus();
      const before = h.author.getSnapshot();
      const event = pressTree(treeRow('alpha'), 'ArrowDown');
      const focusAfter = document.activeElement;
      parent.insertBefore(row, wrapper);
      wrapper.remove();
      expect(event.defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
      expect(focusAfter).toBe(treeRow('alpha'));
    },
  );
  it.each(['ctrlKey', 'metaKey', 'shiftKey', 'altKey'] as const)(
    '%s navigation is unowned',
    (modifier) => {
      const h = treeHarness();
      const before = h.author.getSnapshot();
      const event = focusKey('alpha', 'ArrowDown', { [modifier]: true });
      expect(event.defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
      expect(document.activeElement).toBe(treeRow('alpha'));
    },
  );
  it.each([
    'hidden',
    'inert',
    'display',
    'visibility',
    'collapse',
    'contenteditable',
    'monaco',
    'textbox',
    'combobox',
    'popup',
  ] as const)('%s origin ancestry refuses without consumption', (kind) => {
    const h = treeHarness();
    const row = treeRow('alpha');
    row.focus();
    const host = treeHost();
    if (kind === 'hidden') host.hidden = true;
    else if (kind === 'inert') host.setAttribute('inert', '');
    else if (kind === 'display') host.style.display = 'none';
    else if (kind === 'visibility' || kind === 'collapse')
      host.style.visibility = kind === 'collapse' ? 'collapse' : 'hidden';
    else if (kind === 'contenteditable') host.setAttribute('contenteditable', 'true');
    else if (kind === 'monaco') host.classList.add('monaco-editor');
    else host.setAttribute('role', kind === 'popup' ? 'dialog' : kind);
    const before = h.author.getSnapshot();
    const event = pressTree(row, 'ArrowDown');
    expect(event.defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
  });
  it.each(['hidden', 'inert', 'display', 'detached', 'disabled'] as const)(
    '%s destination refuses before select and consumption',
    (kind) => {
      const h = treeHarness();
      const origin = treeRow('alpha'),
        target = treeRow('card'),
        parent = target.parentElement!,
        next = target.nextSibling;
      origin.focus();
      if (kind === 'hidden') target.hidden = true;
      else if (kind === 'inert') target.setAttribute('inert', '');
      else if (kind === 'display') target.style.display = 'none';
      else if (kind === 'disabled') target.disabled = true;
      else target.remove();
      const before = h.author.getSnapshot();
      const event = pressTree(origin, 'ArrowDown');
      if (kind === 'detached') parent.insertBefore(target, next);
      expect(event.defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
      expect(document.activeElement).toBe(origin);
    },
  );
  it.each(['isComposing', 'keyCode229', 'tracked-composition', 'defaultPrevented'] as const)(
    '%s row key remains unowned',
    (kind) => {
      const h = treeHarness();
      const row = treeRow('alpha');
      row.focus();
      const before = h.author.getSnapshot();
      if (kind === 'tracked-composition') fireEvent.compositionStart(row);
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
        isComposing: kind === 'isComposing',
      });
      if (kind === 'keyCode229') Object.defineProperty(event, 'keyCode', { value: 229 });
      if (kind === 'defaultPrevented') event.preventDefault();
      const propagate = vi.fn();
      document.body.addEventListener('keydown', propagate);
      fireEvent(row, event);
      document.body.removeEventListener('keydown', propagate);
      expect(h.author.getSnapshot()).toBe(before);
      expect(propagate).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(kind === 'defaultPrevented');
      if (kind === 'tracked-composition') {
        fireEvent.compositionEnd(row);
        expect(pressTree(row, 'ArrowDown').defaultPrevented).toBe(true);
      }
    },
  );
  it.each(['search', 'host', 'toggle', 'drag', 'outside', 'unfocused'] as const)(
    '%s is not an exact focused select-row owner',
    (kind) => {
      const h = treeHarness();
      const target =
        kind === 'search'
          ? treeSearch()
          : kind === 'host'
            ? treeHost()
            : kind === 'toggle'
              ? screen.getByRole('button', { name: '折叠 root' })
              : kind === 'drag'
                ? screen.getByRole('button', { name: '拖动 文本 alpha' })
                : kind === 'outside'
                  ? screen.getByLabelText('Independent external input')
                  : treeRow('alpha');
      if (kind === 'unfocused') screen.getByLabelText('Independent external input').focus();
      else target.focus();
      const before = h.author.getSnapshot();
      expect(pressTree(target, 'ArrowDown').defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
    },
  );
  it.each(['active', 'pending'] as const)('%s drag refuses before a later render', (kind) => {
    const h = treeHarness();
    const before = h.author.getSnapshot();
    let result: KeyboardEvent | undefined;
    if (kind === 'active') {
      act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
      result = focusKey('alpha', 'ArrowDown');
    } else {
      treeRow('alpha').focus();
      h.duringPending(() => {
        result = pressTree(treeRow('alpha'), 'ArrowDown');
      });
      fireEvent(screen.getByRole('button', { name: 'Prepare tree pointer' }), treePointer());
    }
    expect(result?.defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
  });
});
