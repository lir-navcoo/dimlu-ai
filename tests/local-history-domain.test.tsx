import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortal } from 'react-dom';
import { findNode } from '../packages/editor/document';
import { CodeEditor } from '../src/ui/CodeEditor';
import { Select, TipProvider } from '../src/ui/primitives';
import {
  canvasRoot,
  keyboardHarness,
  keyboardSchema,
  sendDelete,
  treeRow,
} from './keyboard-delete-fixture';
import { pressHistory, standaloneHistory } from './local-history-fixture';
import { lit } from './multiselection-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

function change(author: ReturnType<typeof keyboardHarness>['document']) {
  act(() => author.setProp('a', 'tail', 'value', lit('Changed tail')));
}
function expectUnconsumed(target: Element, key: string, init: KeyboardEventInit) {
  const bubble = vi.fn();
  window.addEventListener('keydown', bubble);
  try {
    const event = pressHistory(target, key, init);
    expect(event.defaultPrevented).toBe(false);
    expect(bubble).toHaveBeenCalledExactlyOnceWith(event);
    return event;
  } finally {
    window.removeEventListener('keydown', bubble);
  }
}

describe('local history executes one existing step and preserves historical complete selection', () => {
  it.each([
    { name: 'Ctrl Z', key: 'z', init: { ctrlKey: true }, redo: false },
    { name: 'Meta uppercase Z', key: 'Z', init: { metaKey: true }, redo: false },
    { name: 'Ctrl Y', key: 'y', init: { ctrlKey: true }, redo: true },
    { name: 'Meta Y', key: 'Y', init: { metaKey: true }, redo: true },
    { name: 'Ctrl Shift Z', key: 'Z', init: { ctrlKey: true, shiftKey: true }, redo: true },
    { name: 'Meta Shift Z', key: 'z', init: { metaKey: true, shiftKey: true }, redo: true },
  ])(
    '$name calls precisely one command and no compensating selection write',
    ({ key, init, redo }) => {
      const { document: author } = keyboardHarness({
        ids: ['card', 'header', 'slot-leaf'],
        primary: 'header',
      });
      const historical = author.getSnapshot();
      act(() => author.removeNodes('a', ['card', 'header', 'slot-leaf']));
      const edited = author.getSnapshot();
      if (redo) act(() => author.undo());
      const undoCommand = vi.spyOn(author, 'undo');
      const redoCommand = vi.spyOn(author, 'redo');
      const select = vi.spyOn(author, 'select');
      const selectMany = vi.spyOn(author, 'selectMany');
      const publish = vi.fn();
      const unsubscribe = author.subscribe(publish);
      canvasRoot().focus();
      try {
        const event = pressHistory(canvasRoot(), key, init);
        expect(event.defaultPrevented).toBe(true);
        expect(undoCommand).toHaveBeenCalledTimes(redo ? 0 : 1);
        expect(redoCommand).toHaveBeenCalledTimes(redo ? 1 : 0);
        expect(publish).toHaveBeenCalledOnce();
        expect(author.getSnapshot().plan).toBe((redo ? edited : historical).plan);
        expect(author.getSnapshot().selection).toEqual((redo ? edited : historical).selection);
        expect(select).not.toHaveBeenCalled();
        expect(selectMany).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    },
  );

  it('one native event delivered twice cannot consume two history steps', () => {
    const { document: author } = keyboardHarness();
    change(author);
    act(() => author.renamePage('b', 'Changed B'));
    const undo = vi.spyOn(author, 'undo');
    canvasRoot().focus();
    const event = pressHistory(canvasRoot());
    fireEvent(canvasRoot(), event);
    expect(undo).toHaveBeenCalledOnce();
    expect(author.getSnapshot().canUndo).toBe(true);
  });

  it.each(['undo', 'redo'] as const)(
    'empty %s is a real propagation-preserving no-op',
    (operation) => {
      const { document: author, session } = keyboardHarness();
      const undo = vi.spyOn(author, 'undo');
      const redo = vi.spyOn(author, 'redo');
      const before = author.getSnapshot();
      const navigation = session().navigation.getSnapshot();
      const publish = vi.fn();
      const unsubscribe = author.subscribe(publish);
      canvasRoot().focus();
      try {
        expectUnconsumed(canvasRoot(), operation === 'undo' ? 'z' : 'y', { ctrlKey: true });
        expect(author.getSnapshot()).toBe(before);
        expect(session().navigation.getSnapshot()).toBe(navigation);
        expect(globalThis.document.activeElement).toBe(canvasRoot());
        expect(undo).not.toHaveBeenCalled();
        expect(redo).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
      } finally {
        unsubscribe();
      }
    },
  );

  it('selected tree row restores the visible historical primary without expanding or scrolling', () => {
    const { document: author, session } = keyboardHarness({
      ids: ['tail', 'shared'],
      primary: 'tail',
    });
    const historical = author.getSnapshot();
    change(author);
    fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
    fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: 'tail' } });
    const scroll = screen.getByLabelText('Keyboard tree scroll');
    scroll.scrollTop = 93;
    const viewport = session().viewport.getSnapshot();
    treeRow('tail').focus();
    expect(pressHistory(treeRow('tail')).defaultPrevented).toBe(true);
    expect(author.getSnapshot().selection).toEqual(historical.selection);
    expect(globalThis.document.activeElement).toBe(treeRow('tail'));
    expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('tail');
    expect(scroll.scrollTop).toBe(93);
    expect(session().viewport.getSnapshot()).toBe(viewport);
    fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: '展开 root' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('empty selected tree host recovers raw multi deletion; Delete remains refused on that same host', () => {
    const { document: author } = keyboardHarness({
      ids: ['card', 'header', 'slot-leaf'],
      primary: 'header',
    });
    const before = author.getSnapshot();
    const host = screen.getByRole('region', { name: '组件树' });
    treeRow('header').focus();
    sendDelete(treeRow('header'));
    expect(author.getSnapshot().selection.nodeId).toBeNull();
    expect(globalThis.document.activeElement).toBe(host);
    const deleted = author.getSnapshot();
    expect(sendDelete(host).defaultPrevented).toBe(false);
    expect(author.getSnapshot()).toBe(deleted);
    expect(pressHistory(host).defaultPrevented).toBe(true);
    expect(author.getSnapshot().plan).toBe(before.plan);
    expect(author.getSnapshot().selection).toEqual(before.selection);
    expect(globalThis.document.activeElement).toBe(treeRow('header'));
  });

  it.each(['filtered', 'closed'] as const)(
    'host recovers a %s historical primary without clearing query or revealing hidden rows',
    (kind) => {
      const { document: author } = keyboardHarness({ ids: ['alpha', 'tail'], primary: 'alpha' });
      const before = author.getSnapshot();
      change(author);
      act(() => author.select('a', 'tail'));
      if (kind === 'filtered')
        fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: 'tail' } });
      else fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
      const host = screen.getByRole('region', { name: '组件树' });
      const scroll = screen.getByLabelText('Keyboard tree scroll');
      scroll.scrollTop = 68;
      host.focus();
      expect(pressHistory(host).defaultPrevented).toBe(true);
      expect(author.getSnapshot().selection).toEqual(before.selection);
      expect(globalThis.document.activeElement).toBe(host);
      expect(treeRow('alpha')).toBeUndefined();
      expect(scroll.scrollTop).toBe(68);
      if (kind === 'filtered')
        expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('tail');
      else
        expect(
          screen.getByRole('button', { name: '展开 root' }).getAttribute('aria-expanded'),
        ).toBe('false');
    },
  );

  it('existing grouped setters undo together and preserve dirty conflict drafts without saving', () => {
    const { document: author, session } = keyboardHarness();
    const before = author.getSnapshot();
    const draft = {
      source: 'old-source',
      dirty: true,
      value: { text: 'invalid.', error: 'draft syntax' },
    };
    act(() => {
      session().drafts.write('history:dirty', draft);
      author.setProp('a', 'tail', 'value', lit('first'), 'existing-group');
      author.setProp('a', 'tail', 'value', lit('second'), 'existing-group');
    });
    canvasRoot().focus();
    expect(pressHistory(canvasRoot()).defaultPrevented).toBe(true);
    expect(author.getSnapshot().plan).toBe(before.plan);
    expect(author.getSnapshot().canUndo).toBe(false);
    expect(session().drafts.read('history:dirty', 'changed-source', {})).toBe(draft);
    expect(draft.dirty).toBe(true);
    expect(pressHistory(canvasRoot(), 'y').defaultPrevented).toBe(true);
    expect(
      findNode(author.getSnapshot().plan.pages.get('a')!.schema, 'tail')!.node.props.value,
    ).toEqual(lit('second'));
    expect(session().drafts.read('history:dirty', 'changed-again', {})).toBe(draft);
  });

  it('document-wide Undo may restore another page without old-page reselection or delayed focus', () => {
    const { document: author, session } = keyboardHarness();
    const historical = author.getSnapshot();
    change(author);
    act(() => author.select('b', 'b-one'));
    canvasRoot().focus();
    const request = vi.spyOn(session().navigation, 'requestHistoryFocus');
    expect(pressHistory(canvasRoot()).defaultPrevented).toBe(true);
    expect(author.getSnapshot().selection).toEqual(historical.selection);
    expect(request).not.toHaveBeenCalled();
    const outside = screen.getByLabelText('Outside editor input');
    outside.focus();
    act(() => author.selectPage('b'));
    expect(globalThis.document.activeElement).toBe(outside);
  });

  it('redo may restore a code-enabled history entry without scheduling a visual focus return', () => {
    const { document: author, session } = keyboardHarness();
    act(() =>
      author.setPageCode('a', {
        enabled: true,
        language: 'jsx',
        source: 'export default () => <div />;',
        css: '',
      }),
    );
    const coded = author.getSnapshot();
    act(() => author.undo());
    canvasRoot().focus();
    const request = vi.spyOn(session().navigation, 'requestHistoryFocus');
    expect(pressHistory(canvasRoot(), 'y').defaultPrevented).toBe(true);
    expect(author.getSnapshot().plan).toBe(coded.plan);
    expect(request).not.toHaveBeenCalled();
  });

  it('standalone Canvas without a DragDropProvider has local Undo/Redo', () => {
    const { author } = standaloneHistory();
    const before = author.getSnapshot();
    change(author);
    canvasRoot().focus();
    expect(pressHistory(canvasRoot()).defaultPrevented).toBe(true);
    expect(author.getSnapshot().plan).toBe(before.plan);
    expect(pressHistory(canvasRoot(), 'y').defaultPrevented).toBe(true);
    expect(screen.getByText('Changed tail', { selector: 'p' })).toBeTruthy();
  });
});

describe('Canvas history family routing precedes blanket capture but does not grant execution', () => {
  it.each([
    { name: 'repeat', key: 'z', init: { ctrlKey: true, repeat: true } },
    { name: 'Alt Z', key: 'z', init: { ctrlKey: true, altKey: true } },
    { name: 'dual modifiers', key: 'Z', init: { ctrlKey: true, metaKey: true } },
    { name: 'Shift Y', key: 'y', init: { metaKey: true, shiftKey: true } },
    { name: 'composing Z', key: 'z', init: { ctrlKey: true, isComposing: true } },
    { name: '229 Z', key: 'z', init: { metaKey: true, keyCode: 229 } },
    { name: 'Alt repeat Y', key: 'Y', init: { metaKey: true, altKey: true, repeat: true } },
  ])('refused $name propagates without history, focus or draft mutation', ({ key, init }) => {
    const { document: author } = keyboardHarness();
    change(author);
    const before = author.getSnapshot();
    const undo = vi.spyOn(author, 'undo');
    canvasRoot().focus();
    expectUnconsumed(canvasRoot(), key, init);
    expect(author.getSnapshot()).toBe(before);
    expect(undo).not.toHaveBeenCalled();
    expect(globalThis.document.activeElement).toBe(canvasRoot());
  });

  it('already defaultPrevented family is propagated without another author command', () => {
    const { document: author } = keyboardHarness();
    change(author);
    const before = author.getSnapshot();
    canvasRoot().focus();
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble);
    try {
      fireEvent(canvasRoot(), event);
      expect(bubble).toHaveBeenCalledOnce();
      expect(author.getSnapshot()).toBe(before);
    } finally {
      window.removeEventListener('keydown', bubble);
    }
  });

  it.each(['canvas', 'tree'] as const)(
    '%s composition lifetime rejects until actual compositionend',
    (domain) => {
      const { document: author } = keyboardHarness();
      change(author);
      const target = domain === 'canvas' ? canvasRoot() : treeRow('tail');
      target.focus();
      fireEvent.compositionStart(target, { data: '中' });
      const before = author.getSnapshot();
      expectUnconsumed(target, 'z', { ctrlKey: true });
      expect(author.getSnapshot()).toBe(before);
      fireEvent.compositionEnd(target, { data: '中' });
      expect(pressHistory(target).defaultPrevented).toBe(true);
      expect(author.getSnapshot()).not.toBe(before);
    },
  );

  it.each(['canvas', 'tree'] as const)(
    '%s selected native text retains local text-history ownership',
    (domain) => {
      const { document: author } = keyboardHarness();
      change(author);
      const target = domain === 'canvas' ? canvasRoot() : treeRow('alpha');
      target.focus();
      const range = globalThis.document.createRange();
      range.selectNodeContents(
        domain === 'canvas' ? screen.getByText('Alpha text', { selector: 'p' }) : target,
      );
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      expect(window.getSelection()!.isCollapsed).toBe(false);
      const before = author.getSnapshot();
      expectUnconsumed(target, 'z', { ctrlKey: true });
      expect(author.getSnapshot()).toBe(before);
    },
  );

  it.each(['contenteditable', 'monaco', 'iframe', 'shadow'] as const)(
    'uncertain %s focus cannot inherit Canvas permission',
    (kind) => {
      const { document: author } = keyboardHarness();
      change(author);
      const root = canvasRoot();
      const before = author.getSnapshot();
      let target: Element = root;
      let iframe: HTMLIFrameElement | undefined;
      if (kind === 'contenteditable') root.parentElement!.setAttribute('contenteditable', 'true');
      else if (kind === 'monaco') root.parentElement!.classList.add('monaco-editor');
      else if (kind === 'iframe') {
        iframe = globalThis.document.createElement('iframe');
        globalThis.document.body.append(iframe);
        iframe.contentDocument!.body.innerHTML = '<input />';
      } else {
        const child = globalThis.document.createElement('button');
        root.attachShadow({ mode: 'open' }).append(child);
        target = child;
      }
      (target as HTMLElement).focus();
      if (iframe) iframe.contentDocument!.querySelector('input')!.focus();
      try {
        expectUnconsumed(target, 'z', { ctrlKey: true, composed: true });
        expect(author.getSnapshot()).toBe(before);
      } finally {
        iframe?.remove();
      }
    },
  );

  it('unselected tree row, search, actions and outside controls do not own document history', () => {
    const { document: author } = keyboardHarness();
    change(author);
    const before = author.getSnapshot();
    for (const target of [
      treeRow('alpha'),
      screen.getByLabelText('搜索组件树'),
      screen.getByRole('button', { name: '定位当前节点' }),
      screen.getByLabelText('Outside editor input'),
      screen.getByRole('button', { name: 'Outside editor button' }),
    ]) {
      target.focus();
      expectUnconsumed(target, 'z', { ctrlKey: true });
      expect(author.getSnapshot()).toBe(before);
    }
  });

  it('native controls and actual CodeEditor fallback draft stay outside Canvas history', () => {
    const { document: author } = keyboardHarness({
      children: (
        <div data-canvas-action="true">
          <input aria-label="History input" defaultValue="Text" />
          <textarea aria-label="History textarea" defaultValue="Text" />
          <div
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
            aria-label="History editable"
          >
            Text
          </div>
          <CodeEditor
            label="History JS draft"
            language="javascript"
            value="const n = 1;"
            onChange={() => {}}
          />
        </div>
      ),
    });
    change(author);
    const before = author.getSnapshot();
    for (const label of [
      'History input',
      'History textarea',
      'History editable',
      'History JS draft',
    ]) {
      const target = screen.getByLabelText(label);
      target.focus();
      expectUnconsumed(target, 'z', { ctrlKey: true });
      expectUnconsumed(target, 'y', { metaKey: true });
    }
    expect(author.getSnapshot()).toBe(before);
  });

  it('actual expanded CodeEditor Dialog keeps its fallback model history outside author history', async () => {
    const { document: author } = keyboardHarness();
    // The product inspector is a sibling of Canvas, not its logical React child.
    render(
      <TipProvider>
        <CodeEditor
          label="Expanded history JS"
          language="javascript"
          value="const n = 1;"
          onChange={() => {}}
        />
      </TipProvider>,
    );
    change(author);
    const before = author.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '展开Expanded history JS' }));
    const dialog = await screen.findByRole('dialog', { name: 'Expanded history JS' });
    const code = within(dialog).getByRole('textbox', { name: 'Expanded history JS' });
    code.focus();
    expect(canvasRoot().contains(code)).toBe(false);
    expectUnconsumed(code, 'z', { ctrlKey: true });
    expectUnconsumed(code, 'Z', { metaKey: true, shiftKey: true });
    expect(author.getSnapshot()).toBe(before);
    expect(globalThis.document.activeElement).toBe(code);
  });

  it('physical Portal control and real BaseUI Select option cannot inherit logical Canvas ownership', () => {
    const portalHost = globalThis.document.createElement('div');
    globalThis.document.body.append(portalHost);
    try {
      const { document: author } = keyboardHarness({
        children: (
          <div data-canvas-action="true">
            {createPortal(<button>History portal action</button>, portalHost)}
            <Select aria-label="History popup" value="one" onValueChange={() => {}}>
              <option value="one">History one</option>
              <option value="two">History two</option>
            </Select>
          </div>
        ),
      });
      change(author);
      const before = author.getSnapshot();
      const external = screen.getByRole('button', { name: 'History portal action' });
      external.focus();
      expectUnconsumed(external, 'z', { ctrlKey: true });
      fireEvent.click(screen.getByRole('combobox', { name: 'History popup' }));
      const option = screen.getByRole('option', { name: 'History two' });
      option.focus();
      expect(canvasRoot().contains(option)).toBe(false);
      expectUnconsumed(option, 'z', { ctrlKey: true });
      expect(author.getSnapshot()).toBe(before);
    } finally {
      portalHost.remove();
    }
  });
});

describe('history invocation respects complete live author context', () => {
  it.each(['canvas', 'tree'] as const)(
    'hidden %s host cannot retain author history permission',
    (domain) => {
      const { document: author } = keyboardHarness();
      change(author);
      const target = domain === 'canvas' ? canvasRoot() : treeRow('alpha');
      target.focus();
      const host =
        domain === 'canvas' ? canvasRoot() : screen.getByRole('region', { name: '组件树' });
      host.hidden = true;
      const before = author.getSnapshot();
      expectUnconsumed(target, 'z', { ctrlKey: true });
      expect(author.getSnapshot()).toBe(before);
    },
  );

  it.each(['selection', 'plan', 'page'] as const)(
    'stale full snapshot rejects live %s on Canvas and tree',
    (kind) => {
      const { document: author } = keyboardHarness({
        frozenSnapshot: true,
        ids: ['alpha', 'tail'],
        primary: 'alpha',
      });
      act(() => {
        if (kind === 'selection') author.selectMany('a', ['alpha', 'header'], 'alpha');
        else if (kind === 'plan') author.renamePage('b', 'Changed');
        else author.selectPage('b');
      });
      const before = author.getSnapshot();
      const undo = vi.spyOn(author, 'undo');
      for (const target of [canvasRoot(), treeRow('alpha')]) {
        target.focus();
        expectUnconsumed(target, 'z', { ctrlKey: true });
      }
      expect(author.getSnapshot()).toBe(before);
      expect(undo).not.toHaveBeenCalled();
    },
  );

  it.each(['preview', 'code', 'active-drag'] as const)(
    'local %s rejects Undo and preserves toolbar availability',
    (kind) => {
      const schema = keyboardSchema();
      if (kind === 'code') schema.pages[0].code!.enabled = true;
      const { document: author, view, tree, drag } = keyboardHarness({ schema });
      change(author);
      if (kind === 'preview') view.rerender(tree('preview'));
      else if (kind === 'active-drag')
        act(() => drag().begin({ kind: 'material', component: 'ui.text' }));
      const root = kind === 'preview' ? screen.getByLabelText('页面交互预览') : canvasRoot();
      root.focus();
      const before = author.getSnapshot();
      expectUnconsumed(root, 'z', { ctrlKey: true });
      expect(author.getSnapshot()).toBe(before);
      expect(screen.getByRole('button', { name: /撤销/ }).hasAttribute('disabled')).toBe(false);
    },
  );

  it('same-event pending pointer getter rejects before the next render', () => {
    const { document: author, duringPending, drag } = keyboardHarness();
    change(author);
    const before = author.getSnapshot();
    let event: KeyboardEvent | undefined;
    duringPending(() => {
      canvasRoot().focus();
      event = pressHistory(canvasRoot());
    });
    const pointer = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperty(pointer, 'pointerId', { value: 1 });
    fireEvent(screen.getByRole('button', { name: 'Prepare material pointer' }), pointer);
    expect(drag().isInteracting).toBe(true);
    expect(event?.defaultPrevented).toBe(false);
    expect(author.getSnapshot()).toBe(before);
  });
});
