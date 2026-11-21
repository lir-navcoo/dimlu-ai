import { type ComponentProps } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  treeAuthor,
  treeHarness,
  treeHost,
  treePointer,
  treeRow,
  treeRuntimes,
  treeSearch,
  pressTree,
} from './tree-keyboard-fixture';
type Handler = (...args: any[]) => unknown;
const held = vi.hoisted(() => ({
  keys: new Map<string, Handler>(),
  clicks: new Map<string, Handler>(),
  query: undefined as Handler | undefined,
}));
// Observe original authored row callbacks before Tooltip composes its own DOM handlers.
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Tip: (props: ComponentProps<typeof actual.Tip>) => {
      const child = props.children.props as {
        className?: string;
        'aria-label'?: string;
        onKeyDown?: Handler;
      };
      if (child.className?.split(' ').includes('tree-select') && child.onKeyDown)
        held.keys.set(child['aria-label']!.split(' ').at(-1)!, child.onKeyDown);
      return <actual.Tip {...props} />;
    },
    Button: (props: ComponentProps<typeof actual.Button>) => {
      if (props['aria-label']?.startsWith('折叠 ') || props['aria-label']?.startsWith('展开 '))
        held.clicks.set(props['aria-label'], props.onClick as Handler);
      return <actual.Button {...props} />;
    },
    Input: (props: ComponentProps<typeof actual.Input>) => {
      if (props['aria-label'] === '搜索组件树') held.query = props.onChange as Handler;
      return <actual.Input {...props} />;
    },
  };
});
beforeEach(() => {
  held.keys.clear();
  held.clicks.clear();
  held.query = undefined;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 20, 240, 30));
});
afterEach(() => {
  cleanup();
  treeRuntimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
});

function callKey(
  callback: Handler,
  row: HTMLElement,
  key = 'ArrowDown',
  options: { target?: EventTarget; currentTarget?: EventTarget; path?: EventTarget[] } = {},
) {
  const native = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  const path: EventTarget[] = [];
  for (let item: Node | null = row; item; item = item.parentNode) path.push(item);
  path.push(window);
  Object.defineProperty(native, 'composedPath', { value: () => options.path ?? path });
  const event = {
    key,
    target: options.target ?? row,
    currentTarget: options.currentTarget ?? row,
    nativeEvent: native,
    defaultPrevented: false,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => native.preventDefault(),
    stopPropagation: vi.fn(),
  };
  callback(event);
  return { native, event };
}
const search = (value: string) => fireEvent.change(treeSearch(), { target: { value } });
const queryEntry = (h: ReturnType<typeof treeHarness>) =>
  h.session().drafts.read('ui:tree:a/query', 'ui', '');
const closedEntry = (h: ReturnType<typeof treeHarness>) =>
  h.session().drafts.read('ui:tree:a/closed', 'ui', []);

describe('old tree traversal permission never revives after observed domain returns', () => {
  it.each([
    'query',
    'closed',
    'selection',
    'full-selection',
    'page',
    'plan',
    'document',
    'preview',
    'code',
    'active-drag',
    'pending-drag',
    'unmount',
  ] as const)(
    '%s return permanently refuses retained row callback, while fresh callback remains usable',
    (kind) => {
      const h = treeHarness();
      const old = held.keys.get('alpha')!;
      if (kind === 'query') {
        search('alpha');
        search('');
      } else if (kind === 'closed') {
        fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
        fireEvent.click(screen.getByRole('button', { name: '展开 root' }));
      } else if (kind === 'selection') {
        act(() => h.author.select('a', 'tail'));
        act(() => h.author.select('a', 'alpha'));
      } else if (kind === 'full-selection') {
        act(() => h.author.selectMany('a', ['root', 'alpha', 'tail'], 'alpha'));
        act(() => h.author.select('a', 'alpha'));
      } else if (kind === 'page') {
        act(() => h.author.select('b', 'shared'));
        act(() => h.author.select('a', 'alpha'));
      } else if (kind === 'plan') {
        act(() => h.author.renamePage('b', 'Changed'));
        act(() => h.author.undo());
      } else if (kind === 'document') {
        h.view.rerender(h.tree(treeAuthor()));
        h.view.rerender(h.tree());
      } else if (kind === 'preview') {
        h.view.rerender(h.tree(h.author, false));
        h.view.rerender(h.tree());
      } else if (kind === 'code') {
        act(() =>
          h.author.setPageCode('a', {
            ...h.author.getSnapshot().plan.pages.get('a')!.schema.code!,
            enabled: true,
          }),
        );
        act(() => h.author.undo());
      } else if (kind === 'active-drag') {
        act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        act(() => h.drag().cancel());
      } else if (kind === 'pending-drag') {
        fireEvent(screen.getByRole('button', { name: 'Prepare tree pointer' }), treePointer());
        act(() => h.drag().cancel());
      } else {
        h.view.rerender(h.tree(h.author, true, false));
        h.view.rerender(h.tree());
      }
      const row = treeRow('alpha');
      row.focus();
      const before = h.author.getSnapshot(),
        query = queryEntry(h),
        closed = closedEntry(h),
        select = vi.spyOn(h.author, 'select');
      let result!: ReturnType<typeof callKey>;
      act(() => {
        result = callKey(old, row);
      });
      expect(result.native.defaultPrevented).toBe(false);
      expect(select).not.toHaveBeenCalled();
      expect(h.author.getSnapshot()).toBe(before);
      expect(document.activeElement).toBe(row);
      expect(queryEntry(h)).toBe(query);
      expect(closedEntry(h)).toBe(closed);
      expect(pressTree(row, 'ArrowDown').defaultPrevented).toBe(true);
      expect(h.author.getSnapshot().selection.nodeId).toBe('card');
      expect(document.activeElement).toBe(treeRow('card'));
    },
  );
  it.each(['query', 'closed'] as const)(
    '%s write expires known-old model synchronously before React publication',
    (kind) => {
      const h = treeHarness();
      const row = treeRow('alpha'),
        old = held.keys.get('alpha')!;
      row.focus();
      const before = h.author.getSnapshot();
      let result!: ReturnType<typeof callKey>;
      act(() => {
        if (kind === 'query') held.query!({ target: { value: 'alpha' } });
        else held.clicks.get('折叠 root')!();
        result = callKey(old, row);
      });
      expect(result.native.defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
    },
  );
  it.each(['selection', 'plan'] as const)(
    'unrendered %s publication roundtrip invalidates permanently via document subscription',
    (kind) => {
      const h = treeHarness({ frozen: true });
      const row = treeRow('alpha'),
        old = held.keys.get('alpha')!;
      row.focus();
      let result!: ReturnType<typeof callKey>;
      act(() => {
        if (kind === 'selection') {
          h.author.select('a', 'tail');
          h.author.select('a', 'alpha');
        } else {
          h.author.renamePage('b', 'Changed');
          h.author.undo();
        }
        result = callKey(old, row);
      });
      expect(result.native.defaultPrevented).toBe(false);
      expect(h.author.getSnapshot().selection.nodeId).toBe('alpha');
    },
  );
  it('live pending interaction observed before cancel permanently expires retained permission', () => {
    const h = treeHarness();
    const old = held.keys.get('alpha')!;
    treeRow('alpha').focus();
    let during!: ReturnType<typeof callKey>;
    h.duringPending(() => {
      during = callKey(old, treeRow('alpha'));
    });
    fireEvent(screen.getByRole('button', { name: 'Prepare tree pointer' }), treePointer());
    act(() => h.drag().cancel());
    treeRow('alpha').focus();
    let after!: ReturnType<typeof callKey>;
    act(() => {
      after = callKey(old, treeRow('alpha'));
    });
    expect(during.native.defaultPrevented).toBe(false);
    expect(after.native.defaultPrevented).toBe(false);
    expect(h.author.getSnapshot().selection.nodeId).toBe('alpha');
  });
  it('same context rerenders and initial pre-layout false do not invent permission transitions', () => {
    const h = treeHarness();
    const old = held.keys.get('alpha')!;
    h.view.rerender(h.tree());
    h.view.rerender(h.tree());
    treeRow('alpha').focus();
    let result!: ReturnType<typeof callKey>;
    act(() => {
      result = callKey(old, treeRow('alpha'));
    });
    expect(result.native.defaultPrevented).toBe(true);
    expect(h.author.getSnapshot().selection.nodeId).toBe('card');
    expect(document.activeElement).toBe(treeRow('card'));
  });
  it.each([
    'different-currentTarget',
    'nested-target',
    'foreign-origin',
    'shadow-path',
    'same-id-new-DOM',
  ] as const)('%s callback cannot borrow real focused row ownership', (kind) => {
    const h = treeHarness();
    const row = treeRow('alpha'),
      old = held.keys.get('alpha')!;
    row.focus();
    const before = h.author.getSnapshot();
    let options: Parameters<typeof callKey>[3] = {};
    const foreign = document.createElement('button');
    const shadowHost = document.createElement('div'),
      shadow = shadowHost.attachShadow({ mode: 'open' });
    if (kind === 'different-currentTarget') options = { currentTarget: treeHost() };
    else if (kind === 'nested-target') options = { target: row.querySelector('span')! };
    else if (kind === 'foreign-origin')
      options = { path: [foreign, row, treeHost(), document, window] };
    else if (kind === 'shadow-path')
      options = { path: [row, shadow, treeHost(), document, window] };
    else {
      const clone = row.cloneNode(true) as HTMLButtonElement;
      row.replaceWith(clone);
      clone.focus();
      options = { target: clone, currentTarget: clone };
    }
    let result!: ReturnType<typeof callKey>;
    act(() => {
      result = callKey(old, row, 'ArrowDown', options);
    });
    if (kind === 'same-id-new-DOM')
      document.querySelector('[data-editor-tree-node="alpha"]')!.append(row);
    expect(result.native.defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
  });
});

describe('only same-call accepted move may complete focus and local reveal', () => {
  it.each(['document', 'preview'] as const)(
    'same-call %s domain roundtrip permanently expires the in-flight receipt',
    (kind) => {
      const h = treeHarness();
      const origin = treeRow('alpha'),
        target = treeRow('card');
      origin.focus();
      const focus = vi.spyOn(target, 'focus'),
        original = h.author.select,
        other = treeAuthor();
      vi.spyOn(h.author, 'select').mockImplementation((...args) => {
        original(...args);
        if (kind === 'document') {
          flushSync(() => h.view.rerender(h.tree(other)));
          flushSync(() => h.view.rerender(h.tree()));
        } else {
          flushSync(() => h.view.rerender(h.tree(h.author, false)));
          flushSync(() => h.view.rerender(h.tree()));
        }
      });
      pressTree(origin, 'ArrowDown');
      expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'card' });
      expect(focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(origin);
      expect(pressTree(origin, 'ArrowDown').defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(origin);
    },
  );
  it.each(['active-drag', 'pending-drag'] as const)(
    'same-call %s observed rendered roundtrip expires receipt and preserves drag focus ownership',
    (kind) => {
      const h = treeHarness();
      const origin = treeRow('alpha'),
        target = treeRow('card');
      origin.focus();
      const focus = vi.spyOn(target, 'focus'),
        original = h.author.select;
      let dragFocus: Element | null = null;
      const select = vi.spyOn(h.author, 'select').mockImplementation((...args) => {
        flushSync(() => original(...args));
        if (kind === 'active-drag') {
          flushSync(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        } else {
          flushSync(() =>
            fireEvent(screen.getByRole('button', { name: 'Prepare tree pointer' }), treePointer()),
          );
        }
        expect(h.drag().isInteracting).toBe(true);
        // The actual ComponentTree has consumed the provider's intermediate render.
        expect(origin.disabled).toBe(true);
        expect(target.disabled).toBe(true);
        flushSync(() => h.drag().cancel());
        expect(h.drag().isInteracting).toBe(false);
        expect(origin.disabled).toBe(false);
        dragFocus = document.activeElement;
      });
      expect(pressTree(origin, 'ArrowDown').defaultPrevented).toBe(true);
      expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'card' });
      expect(focus).not.toHaveBeenCalled();
      expect(dragFocus).not.toBe(target);
      expect(document.activeElement).toBe(dragFocus);
      select.mockRestore();
      origin.focus();
      expect(pressTree(origin, 'ArrowDown').defaultPrevented).toBe(true);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(target);
    },
  );
  it.each([
    'focus-away',
    'focus-away-back',
    'blur-body',
    'selection-away',
    'selection-away-back',
    'plan-away-back',
    'page-away-back',
  ] as const)('synchronous %s observer takeover abandons completion without refocus', (kind) => {
    const h = treeHarness();
    const origin = treeRow('alpha'),
      target = treeRow('card'),
      outside = screen.getByLabelText('Independent external input');
    origin.focus();
    const focus = vi.spyOn(target, 'focus');
    let observerRan = false;
    const stop = h.author.subscribe(() => {
      if (observerRan) return;
      observerRan = true;
      if (kind === 'focus-away' || kind === 'focus-away-back') {
        outside.focus();
        if (kind === 'focus-away-back') origin.focus();
      } else if (kind === 'blur-body') origin.blur();
      else if (kind === 'selection-away' || kind === 'selection-away-back') {
        h.author.select('a', 'tail');
        if (kind === 'selection-away-back') h.author.select('a', 'card');
      } else if (kind === 'plan-away-back') {
        h.author.renamePage('b', 'Other');
        h.author.undo();
      } else {
        h.author.select('b', 'shared');
        h.author.select('a', 'card');
      }
    });
    const event = pressTree(origin, 'ArrowDown');
    stop();
    expect(event.defaultPrevented).toBe(true);
    expect(observerRan).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(target);
  });
  it('zero-publication destination cannot accept an unexpected observer publication and roundtrip', () => {
    const h = treeHarness();
    const origin = treeRow('root'),
      target = treeRow('alpha');
    origin.focus();
    const original = h.author.select;
    const focus = vi.spyOn(target, 'focus');
    vi.spyOn(h.author, 'select').mockImplementation((page, id) => {
      original(page, id);
      original('a', 'tail');
      original('a', 'alpha');
    });
    pressTree(origin, 'ArrowDown');
    expect(h.author.getSnapshot().selection.nodeId).toBe('alpha');
    expect(document.activeElement).toBe(origin);
    expect(focus).not.toHaveBeenCalled();
  });
  it.each(['missing-publication', 'throw'] as const)(
    '%s core select refusal leaves focus at origin',
    (kind) => {
      const h = treeHarness();
      const origin = treeRow('alpha'),
        target = treeRow('card');
      origin.focus();
      const before = h.author.getSnapshot(),
        focus = vi.spyOn(target, 'focus');
      vi.spyOn(h.author, 'select').mockImplementation(() => {
        if (kind === 'throw') throw new Error('Independent select refusal');
      });
      pressTree(origin, 'ArrowDown');
      expect(h.author.getSnapshot()).toBe(before);
      expect(document.activeElement).toBe(origin);
      expect(focus).not.toHaveBeenCalled();
    },
  );
  it('navigation subscriber focus takeover after selectedInstance update is respected', () => {
    const h = treeHarness();
    act(() =>
      h.session().navigation.bind({
        document: h.author,
        plan: h.author.getSnapshot().plan,
        pageId: 'a',
        enabled: true,
        dragging: false,
      }),
    );
    const origin = treeRow('alpha'),
      target = treeRow('card'),
      outside = screen.getByLabelText('Independent external input');
    origin.focus();
    const focus = vi.spyOn(target, 'focus');
    let changed = false;
    const stop = h.session().navigation.subscribe(() => {
      if (!changed && h.session().navigation.getSnapshot().selectedInstance?.nodeId === 'card') {
        changed = true;
        outside.focus();
      }
    });
    pressTree(origin, 'ArrowDown');
    stop();
    expect(changed).toBe(true);
    expect(document.activeElement).toBe(outside);
    expect(focus).not.toHaveBeenCalled();
  });
  it('focus-induced observer selection prevents local scroll and never retries focus', () => {
    const h = treeHarness();
    const origin = treeRow('alpha'),
      target = treeRow('card'),
      scroll = screen.getByLabelText('Independent tree scroll');
    origin.focus();
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 100));
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 500, 220, 30));
    const focus = vi.spyOn(target, 'focus'),
      takeover = () => h.author.select('a', 'tail');
    target.addEventListener('focus', takeover);
    pressTree(origin, 'ArrowDown');
    target.removeEventListener('focus', takeover);
    expect(h.author.getSnapshot().selection.nodeId).toBe('tail');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(scroll.scrollTop).toBe(0);
  });
  it('own search selected-effect ancestor cleanup is accepted provenance and still completes synchronous focus', () => {
    const h = treeHarness();
    act(() => h.author.select('a', 'tail'));
    fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
    search(' ');
    const origin = treeRow('root'),
      target = treeRow('alpha');
    origin.focus();
    const before = closedEntry(h);
    expect(before.value).toContain('root');
    const original = h.author.select;
    vi.spyOn(h.author, 'select').mockImplementation((...args) => {
      flushSync(() => original(...args));
    });
    pressTree(origin, 'ArrowDown');
    expect(h.author.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'alpha' });
    expect(closedEntry(h).value).not.toContain('root');
    expect(document.activeElement).toBe(target);
    expect(treeSearch().value).toBe(' ');
  });
  it('lookalike observer toggle cleanup cannot borrow inherited selected-effect receipt', () => {
    const h = treeHarness();
    act(() => h.author.select('a', 'tail'));
    fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
    const ordinaryExpand = held.clicks.get('展开 root')!;
    search(' ');
    const origin = treeRow('root'),
      target = treeRow('alpha');
    origin.focus();
    const focus = vi.spyOn(target, 'focus');
    let ran = false;
    const stop = h.author.subscribe(() => {
      if (ran) return;
      ran = true;
      ordinaryExpand();
    });
    pressTree(origin, 'ArrowDown');
    stop();
    expect(ran).toBe(true);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(origin);
  });
});
