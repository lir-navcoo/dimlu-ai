import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { clipboardCallbackHarness, pressClipboard } from './local-clipboard-fixture';
import { keyboardSchema } from './keyboard-delete-fixture';
import { lit, selectionRegistry } from './multiselection-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe('clipboard callback permission and operation ownership are separate', () => {
  it('before-first-publication reentry and instrumented consumption cannot execute a second or stale core command', () => {
    const h = clipboardCallbackHarness(),
      initial = h.callback();
    h.host().focus();
    const original = h.author.copyNodesToClipboard;
    let nested: KeyboardEvent | undefined;
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard').mockImplementation((...args) => {
      h.route(initial);
      nested = pressClipboard(h.host());
      original(...args);
    });
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    expect(nested?.defaultPrevented).toBe(false);
    expect(copy).toHaveBeenCalledOnce();
    expect(h.feedback()?.error).toBe(false);
    h.route(undefined);
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const nativePrevent = event.preventDefault.bind(event);
    vi.spyOn(event, 'preventDefault').mockImplementation(() => {
      nativePrevent();
      h.author.select('a', 'tail');
    });
    fireEvent(h.host(), event);
    expect(copy).toHaveBeenCalledOnce();
    expect(h.author.getSnapshot().selection.nodeId).toBe('tail');
  });

  it('raw-selection/plan/clipboard publication ABA before React render permanently retires a retained callback; fresh current gesture works', () => {
    const h = clipboardCallbackHarness();
    const old = h.callback();
    h.route(old);
    h.host().focus();
    const initial = h.author.getSnapshot(),
      clip = h.author.getClipboardSnapshot();
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard');
    act(() => {
      h.author.selectMany('a', ['alpha', 'shared'], 'alpha');
      expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
      h.author.selectMany('a', ['alpha', 'tail'], 'alpha');
      expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    });
    expect(copy).not.toHaveBeenCalled();
    expect(h.author.getClipboardSnapshot()).toBe(clip);
    h.route(undefined);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    const published = h.callback();
    h.route(published);
    act(() => {
      h.author.setProp('a', 'tail', 'value', lit('temporary'));
      h.author.undo();
      expect(h.author.getSnapshot().plan).toBe(initial.plan);
      expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    });
    h.route(undefined);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    const beforeReplace = h.callback();
    h.route(beforeReplace);
    act(() => h.author.copyNodesToClipboard('a', ['alpha', 'tail']));
    expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    h.route(undefined);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
  });

  it('same context rerenders preserve ordinary permission, observed document/enable/query return do not revive it', () => {
    const h = clipboardCallbackHarness();
    const same = h.callback();
    h.route(same);
    h.view.rerender(h.tree());
    h.host().focus();
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    const old = h.callback();
    h.route(old);
    h.view.rerender(h.tree(new EditorDocument(keyboardSchema(), selectionRegistry())));
    h.view.rerender(h.tree());
    h.host().focus();
    expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    h.route(undefined);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    const disabled = h.callback();
    h.route(disabled);
    h.view.rerender(h.tree(h.author, false));
    h.view.rerender(h.tree());
    h.host().focus();
    expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    h.route(undefined);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    const query = h.callback();
    h.route(query);
    h.view.rerender(h.tree(h.author, true, 'other'));
    h.view.rerender(h.tree());
    h.host().focus();
    expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
  });

  it.each(['copy', 'paste'] as const)(
    'own %s compatible synchronous parent render succeeds once without replay',
    (action) => {
      const h = clipboardCallbackHarness();
      if (action === 'paste') act(() => h.author.copyNodesToClipboard('a', ['alpha', 'tail']));
      h.host().focus();
      const old = h.callback();
      h.route(old);
      let observed = false;
      const observer = () => {
        if (!observed) {
          observed = true;
          flushSync(() => h.view.rerender(h.tree()));
        }
      };
      const stop =
        action === 'copy' ? h.author.subscribeClipboard(observer) : h.author.subscribe(observer);
      const operation = vi.spyOn(
        h.author,
        action === 'copy' ? 'copyNodesToClipboard' : 'pasteClipboardNodes',
      );
      expect(pressClipboard(h.host(), action === 'copy' ? 'c' : 'v').defaultPrevented).toBe(true);
      expect(observed).toBe(true);
      expect(operation).toHaveBeenCalledOnce();
      expect(h.feedback()?.error).toBe(false);
      expect(pressClipboard(h.host(), action === 'copy' ? 'c' : 'v').defaultPrevented).toBe(false);
      expect(operation).toHaveBeenCalledOnce();
      stop();
    },
  );

  it.each(['selection-aba', 'clipboard-replace', 'owner-return', 'focus-aba'] as const)(
    'own paste cannot announce or retain presentation after synchronous %s',
    (kind) => {
      const h = clipboardCallbackHarness();
      act(() => h.author.copyNodesToClipboard('a', ['alpha', 'tail']));
      const original = h.author.getSnapshot();
      h.host().focus();
      let observed = false;
      const stop = h.author.subscribe(() => {
        if (observed) return;
        observed = true;
        const own = h.author.getSnapshot().selection;
        if (kind === 'selection-aba') {
          h.author.select('a', 'shared');
          h.author.selectMany('a', own.nodeIds!, own.nodeId!);
        } else if (kind === 'clipboard-replace')
          h.author.copyNodesToClipboard('a', ['alpha', 'tail']);
        else if (kind === 'owner-return') {
          flushSync(() => h.view.rerender(h.tree(h.author, false)));
          flushSync(() => h.view.rerender(h.tree()));
        } else {
          screen.getByLabelText('Clipboard foreign input').focus();
          h.host().focus();
        }
      });
      expect(pressClipboard(h.host(), 'v').defaultPrevented).toBe(true);
      stop();
      expect(observed).toBe(true);
      expect(h.author.getSnapshot().revision).toBe(original.revision + 1);
      expect(h.feedback()).toBeNull();
      expect(h.session().navigation.isKeyboardPresentation(h.author, h.author.getSnapshot())).toBe(
        false,
      );
      expect(
        h.session().navigation.clipboardPasteFocusOwner(h.author, h.author.getSnapshot(), 'tree'),
      ).toBeNull();
    },
  );

  it.each(['noop', 'reversed', 'throw-after'] as const)(
    'paste %s cannot borrow valid-looking mutation for feedback/focus and releases tentative suppression',
    (kind) => {
      const h = clipboardCallbackHarness();
      act(() => h.author.copyNodesToClipboard('a', ['alpha', 'tail']));
      h.host().focus();
      const original = h.author.pasteClipboardNodes;
      vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation((...args) => {
        if (kind === 'noop') return [];
        const ids = original(...args);
        if (kind === 'throw-after') throw new Error('throw after real commit');
        return [...ids].reverse();
      });
      expect(pressClipboard(h.host(), 'v').defaultPrevented).toBe(true);
      expect(h.feedback()).toBeNull();
      expect(h.session().navigation.isKeyboardPresentation(h.author, h.author.getSnapshot())).toBe(
        false,
      );
    },
  );

  it('genuine unchanged error recovers only with fresh gesture, feedback retires on foreign focus after finally', () => {
    const h = clipboardCallbackHarness();
    const old = h.callback();
    h.route(old);
    h.host().focus();
    const before = h.author.getSnapshot(),
      clipboard = h.author.getClipboardSnapshot();
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard').mockImplementationOnce(() => {
      throw new Error('honest static refusal');
    });
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    expect(h.feedback()).toMatchObject({ message: 'honest static refusal', error: true });
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.getClipboardSnapshot()).toBe(clipboard);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    h.route(undefined);
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    expect(copy).toHaveBeenCalledTimes(2);
    expect(h.feedback()?.error).toBe(false);
    act(() => screen.getByLabelText('Clipboard foreign input').focus());
    expect(h.feedback()).toBeNull();
    act(() => h.host().focus());
    expect(h.feedback()).toBeNull();
  });

  it('native cancelBubble and text range are never converted into owned copy attempts', () => {
    const h = clipboardCallbackHarness();
    const current = h.callback();
    h.route((event) => {
      event.nativeEvent.stopPropagation();
      current(event);
    });
    h.host().focus();
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard');
    expect(pressClipboard(h.host()).defaultPrevented).toBe(false);
    expect(copy).not.toHaveBeenCalled();
  });

  it.each(['query', 'unmount'] as const)(
    'request publication %s retires tree pending owner before restore and cannot retain suppression',
    (kind) => {
      const h = clipboardCallbackHarness();
      act(() => h.author.copyNodesToClipboard('a', ['alpha', 'tail']));
      const navigation = h.session().navigation;
      h.host().focus();
      let once = false;
      const stop = navigation.subscribe(() => {
        if (once) return;
        once = true;
        flushSync(() => {
          if (kind === 'query') h.view.rerender(h.tree(h.author, true, 'changed'));
          else h.view.unmount();
        });
      });
      expect(pressClipboard(h.host(), 'v').defaultPrevented).toBe(true);
      stop();
      expect(once).toBe(true);
      expect(navigation.isKeyboardPresentation(h.author, h.author.getSnapshot())).toBe(false);
      expect(
        navigation.clipboardPasteFocusOwner(h.author, h.author.getSnapshot(), 'tree'),
      ).toBeNull();
    },
  );

  it('copy observer extra document publication and competing copy reject old feedback after completed core effect', () => {
    const h = clipboardCallbackHarness();
    h.host().focus();
    let once = false;
    const stop = h.author.subscribeClipboard(() => {
      if (once) return;
      once = true;
      h.author.select('a', 'shared');
      h.author.selectMany('a', ['alpha', 'tail'], 'alpha');
      h.author.copyNodesToClipboard('a', ['alpha']);
    });
    expect(pressClipboard(h.host()).defaultPrevented).toBe(true);
    stop();
    expect(h.author.getClipboardSnapshot().component).toBe('ui.text');
    expect(h.feedback()).toBeNull();
  });

  it('same ref object with a replaced real host cannot lend its new DOM identity to old permission', () => {
    const h = clipboardCallbackHarness();
    const originalHost = h.host(),
      old = h.callback();
    h.route(old);
    h.view.rerender(h.tree(h.author, true, '', 'replacement'));
    const replacement = h.host();
    expect(replacement).not.toBe(originalHost);
    expect(originalHost.isConnected).toBe(false);
    replacement.focus();
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard');
    expect(pressClipboard(replacement).defaultPrevented).toBe(false);
    expect(copy).not.toHaveBeenCalled();
    h.route(undefined);
    expect(pressClipboard(replacement).defaultPrevented).toBe(true);
    expect(copy).toHaveBeenCalledOnce();
  });
});
