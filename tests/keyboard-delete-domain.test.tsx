import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortal } from 'react-dom';
import { CodeEditor } from '../src/ui/CodeEditor';
import { EditorDocument } from '../packages/editor/document';
import { findNode } from '../packages/editor/document';
import { selectionRegistry } from './multiselection-fixture';
import { bulkText } from './bulk-duplicate-fixture';
import {
  canvasRoot,
  keyEvent,
  keyboardHarness,
  keyboardSchema,
  sendDelete,
  treeRow,
} from './keyboard-delete-fixture';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe('local Delete/Backspace command and history ownership', () => {
  it.each(['Delete', 'Backspace'])(
    'focused canvas %s invokes one single remove and preserves parent fallback',
    (key) => {
      const { document } = keyboardHarness();
      const single = vi.spyOn(document, 'removeNode');
      const multi = vi.spyOn(document, 'removeNodes');
      canvasRoot().focus();
      const event = sendDelete(canvasRoot(), key);
      expect(event.defaultPrevented).toBe(true);
      expect(single).toHaveBeenCalledExactlyOnceWith('a', 'alpha');
      expect(multi).not.toHaveBeenCalled();
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'root' });
      expect(findNode(document.getSnapshot().plan.pages.get('a')!.schema, 'alpha')).toBeUndefined();
      act(() => document.undo());
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'alpha' });
      expect(document.getSnapshot().canUndo).toBe(false);
      act(() => document.redo());
      expect(document.getSnapshot().selection.nodeId).toBe('root');
    },
  );

  it.each(['canvas', 'tree'] as const)(
    '%s raw ancestor multi uses one atomic removeNodes even with one effective root',
    (domain) => {
      const { document } = keyboardHarness({
        ids: ['card', 'header', 'slot-leaf'],
        primary: 'header',
      });
      const before = document.getSnapshot();
      const single = vi.spyOn(document, 'removeNode');
      const multi = vi.spyOn(document, 'removeNodes');
      const target = domain === 'canvas' ? canvasRoot() : treeRow('header');
      target.focus();
      expect(sendDelete(target).defaultPrevented).toBe(true);
      expect(single).not.toHaveBeenCalled();
      expect(multi).toHaveBeenCalledExactlyOnceWith('a', ['card', 'header', 'slot-leaf']);
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: null });
      act(() => document.undo());
      expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
      expect(document.getSnapshot().selection).toEqual(before.selection);
      expect(document.getSnapshot().canUndo).toBe(false);
    },
  );

  it('focused selected tree row removes once,focuses visible fallback and preserves search/closed rows/viewport', () => {
    const { document, session } = keyboardHarness({ ids: ['tail'] });
    fireEvent.click(screen.getByRole('button', { name: '折叠 root' }));
    const scroll = screen.getByLabelText('Keyboard tree scroll');
    scroll.scrollTop = 73;
    act(() => {
      session().viewport.setScale(1.25);
      session().viewport.setCustomWidth(760);
    });
    const settings = session().viewport.getSnapshot();
    const selected = treeRow('tail');
    selected.focus();
    expect(sendDelete(selected, 'Backspace').defaultPrevented).toBe(true);
    expect(document.getSnapshot().selection.nodeId).toBe('shared');
    expect(globalThis.document.activeElement).toBe(treeRow('shared'));
    expect(screen.getByRole('button', { name: '展开 root' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('');
    expect(scroll.scrollTop).toBe(73);
    expect(session().viewport.getSnapshot()).toBe(settings);
  });

  it.each(['last-node', 'hidden-fallback', 'multi'] as const)(
    'tree %s focuses programmatic host fallback without a new permanent Tab stop',
    (kind) => {
      const options =
        kind === 'last-node'
          ? { schema: keyboardSchema([bulkText('only')]), ids: ['only'] }
          : kind === 'multi'
            ? { ids: ['alpha', 'tail'] }
            : { ids: ['alpha'] };
      const { document } = keyboardHarness(options);
      if (kind === 'hidden-fallback')
        fireEvent.change(screen.getByLabelText('搜索组件树'), { target: { value: 'Alpha text' } });
      const target = treeRow(kind === 'last-node' ? 'only' : 'alpha');
      const host = target.closest('.component-tree') as HTMLElement;
      target.focus();
      sendDelete(target);
      expect(globalThis.document.activeElement).toBe(host);
      expect(host.tabIndex).toBe(-1);
      expect(host.isConnected).toBe(true);
      if (kind === 'hidden-fallback') {
        expect(document.getSnapshot().selection.nodeId).toBe('root');
        expect((screen.getByLabelText('搜索组件树') as HTMLInputElement).value).toBe('Alpha text');
      } else expect(document.getSnapshot().selection.nodeId).toBeNull();
      const after = document.getSnapshot();
      expect(sendDelete(host).defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(after);
    },
  );

  it('empty canvas and focused unselected tree row are unconsumed exact no-ops', () => {
    const { document } = keyboardHarness({ ids: [] });
    canvasRoot().focus();
    const empty = document.getSnapshot();
    expect(sendDelete(canvasRoot()).defaultPrevented).toBe(false);
    expect(document.getSnapshot()).toBe(empty);
    act(() => document.select('a', 'alpha'));
    treeRow('tail').focus();
    const selected = document.getSnapshot();
    expect(sendDelete(treeRow('tail')).defaultPrevented).toBe(false);
    expect(document.getSnapshot()).toBe(selected);
  });

  it('late compile failure consumes attempt once,shows error and preserves focus/schema/history/redo', () => {
    const { document, registry, session } = keyboardHarness();
    act(() => {
      document.setProp('a', 'tail', 'value', { kind: 'literal', value: 'temporary' });
      document.undo();
    });
    canvasRoot().focus();
    const before = document.getSnapshot();
    const root = canvasRoot();
    const draft = {
      source: 'accepted',
      dirty: true,
      value: { text: 'state.', error: 'pending syntax' },
    };
    act(() => session().drafts.write('keyboard:retained-draft', draft));
    const prior = registry.components['ui.text'];
    registry.components['ui.text'] = {
      ...prior,
      validateProps: () => ['delete candidate rejected'],
    };
    const command = vi.spyOn(document, 'removeNode');
    const event = sendDelete(root, 'Backspace');
    expect(event.defaultPrevented).toBe(true);
    expect(command).toHaveBeenCalledOnce();
    expect(document.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('delete candidate rejected');
    expect(globalThis.document.activeElement).toBe(root);
    expect(session().drafts.read('keyboard:retained-draft', 'accepted', {})).toBe(draft);
    registry.components['ui.text'] = prior;
  });
});

describe('protected deletion keys are not consumed by old canvas capture isolation', () => {
  it.each([
    { name: 'repeat', init: { repeat: true } },
    { name: 'Ctrl', init: { ctrlKey: true } },
    { name: 'Meta', init: { metaKey: true } },
    { name: 'Alt', init: { altKey: true } },
    { name: 'Shift', init: { shiftKey: true } },
    { name: 'isComposing', init: { isComposing: true } },
    { name: '229', init: { keyCode: 229 } },
  ])('canvas refuses $name with state and propagation untouched', ({ init }) => {
    const { document } = keyboardHarness();
    const before = document.getSnapshot();
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble);
    try {
      canvasRoot().focus();
      expect(sendDelete(canvasRoot(), 'Delete', init).defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      expect(bubble).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', bubble);
    }
  });

  it('already prevented native event is not stopped or used for an author command', () => {
    const { document } = keyboardHarness();
    const before = document.getSnapshot();
    canvasRoot().focus();
    const event = keyEvent();
    event.preventDefault();
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble);
    try {
      fireEvent(canvasRoot(), event);
      expect(document.getSnapshot()).toBe(before);
      expect(bubble).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('keydown', bubble);
    }
  });

  it.each(['canvas', 'tree'] as const)(
    '%s active composition session blocks deletion until compositionend',
    (domain) => {
      const { document } = keyboardHarness();
      const target = domain === 'canvas' ? canvasRoot() : treeRow('alpha');
      target.focus();
      fireEvent.compositionStart(target, { data: '中' });
      const before = document.getSnapshot();
      expect(sendDelete(target).defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      fireEvent.compositionEnd(target, { data: '中' });
      expect(sendDelete(target).defaultPrevented).toBe(true);
      expect(document.getSnapshot()).not.toBe(before);
    },
  );

  it.each(['canvas', 'tree'] as const)(
    '%s noncollapsed real native text selection blocks deletion',
    (domain) => {
      const { document } = keyboardHarness();
      const target = domain === 'canvas' ? canvasRoot() : treeRow('alpha');
      target.focus();
      const text = domain === 'canvas' ? screen.getByText('Alpha text', { selector: 'p' }) : target;
      const range = globalThis.document.createRange();
      range.selectNodeContents(text);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      expect(window.getSelection()!.isCollapsed).toBe(false);
      const before = document.getSnapshot();
      expect(sendDelete(target).defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it.each(['contenteditable', 'monaco', 'iframe', 'shadow'] as const)(
    'canvas refuses inherited/uncertain %s focus',
    (kind) => {
      const { document } = keyboardHarness();
      const root = canvasRoot();
      const before = document.getSnapshot();
      let event: KeyboardEvent;
      if (kind === 'contenteditable') {
        root.parentElement!.setAttribute('contenteditable', 'true');
        root.focus();
        event = sendDelete(root);
      } else if (kind === 'monaco') {
        root.parentElement!.classList.add('monaco-editor');
        root.focus();
        event = sendDelete(root);
      } else if (kind === 'iframe') {
        const iframe = globalThis.document.createElement('iframe');
        globalThis.document.body.append(iframe);
        iframe.contentDocument!.body.innerHTML = '<input />';
        iframe.contentDocument!.querySelector('input')!.focus();
        event = sendDelete(root);
        iframe.remove();
      } else {
        const shadow = root.attachShadow({ mode: 'open' });
        const button = globalThis.document.createElement('button');
        shadow.append(button);
        button.focus();
        event = sendDelete(button, 'Delete', { composed: true });
      }
      expect(event.defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it('native input/textarea/select/contenteditable and actual CodeEditor fallback keys stay native', () => {
    const { document } = keyboardHarness({
      children: (
        <div data-canvas-action="true">
          <input aria-label="Native input" defaultValue="text" />
          <textarea aria-label="Native textarea" defaultValue="text" />
          <select aria-label="Native select">
            <option>One</option>
          </select>
          <div
            contentEditable
            suppressContentEditableWarning
            tabIndex={0}
            aria-label="Native editable"
          >
            Text
          </div>
          <CodeEditor
            label="Native code draft"
            language="javascript"
            value="const n = 1;"
            onChange={() => {}}
          />
        </div>
      ),
    });
    const before = document.getSnapshot();
    for (const label of [
      'Native input',
      'Native textarea',
      'Native select',
      'Native editable',
      'Native code draft',
    ]) {
      const control = screen.getByLabelText(label);
      control.focus();
      for (const key of ['Delete', 'Backspace'])
        expect(sendDelete(control, key).defaultPrevented).toBe(false);
    }
    expect(document.getSnapshot()).toBe(before);
  });

  it('React Portal logical bubbling from outside canvas DOM does not authorize or consume Delete', () => {
    const portalHost = globalThis.document.createElement('div');
    globalThis.document.body.append(portalHost);
    try {
      const { document } = keyboardHarness({
        children: createPortal(
          <div data-canvas-action="true">
            <button>Portal option</button>
          </div>,
          portalHost,
        ),
      });
      const option = screen.getByRole('button', { name: 'Portal option' });
      option.focus();
      expect(canvasRoot().contains(option)).toBe(false);
      const before = document.getSnapshot();
      expect(sendDelete(option).defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      expect(globalThis.document.activeElement).toBe(option);
    } finally {
      portalHost.remove();
    }
  });
});

describe('invocation guards still use live complete author state', () => {
  it.each(['selection', 'plan', 'page'] as const)(
    'stale Canvas/Tree snapshot rejects live %s before rerender',
    (kind) => {
      const { document } = keyboardHarness({
        frozenSnapshot: true,
        ids: ['alpha', 'tail'],
        primary: 'alpha',
      });
      act(() => {
        if (kind === 'selection') document.selectMany('a', ['alpha', 'header'], 'alpha');
        else if (kind === 'plan') document.renamePage('b', 'Changed page');
        else document.selectPage('b');
      });
      const before = document.getSnapshot();
      for (const target of [canvasRoot(), treeRow('alpha')]) {
        target.focus();
        expect(sendDelete(target).defaultPrevented).toBe(false);
      }
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it.each(['preview', 'code', 'active-drag'] as const)(
    'refuses %s and leaves Delete unconsumed',
    (kind) => {
      const schema = keyboardSchema();
      if (kind === 'code') schema.pages[0].code!.enabled = true;
      const { document, view, tree, drag } = keyboardHarness({ schema });
      if (kind === 'preview') view.rerender(tree('preview'));
      else if (kind === 'active-drag')
        act(() => drag().begin({ kind: 'material', component: 'ui.text' }));
      const target = kind === 'preview' ? screen.getByLabelText('页面交互预览') : canvasRoot();
      const before = document.getSnapshot();
      target.focus();
      expect(sendDelete(target).defaultPrevented).toBe(false);
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it('pending pointer live getter refuses the same-event keyboard deletion', () => {
    const { document, drag, duringPending } = keyboardHarness();
    const before = document.getSnapshot();
    let event: KeyboardEvent | undefined;
    duringPending(() => {
      canvasRoot().focus();
      event = sendDelete(canvasRoot());
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
    expect(document.getSnapshot()).toBe(before);
  });

  it('document replacement keeps an externally focused native input outside deletion ownership', () => {
    const { document, view, tree } = keyboardHarness();
    const old = canvasRoot();
    const next = new EditorDocument(keyboardSchema(), selectionRegistry());
    view.rerender(tree('edit', next));
    const oldState = document.getSnapshot();
    const newState = next.getSnapshot();
    const outside = screen.getByRole('textbox', { name: 'Outside editor input' });
    outside.focus();
    expect(sendDelete(old).defaultPrevented).toBe(false);
    expect(document.getSnapshot()).toBe(oldState);
    expect(next.getSnapshot()).toBe(newState);
    expect(globalThis.document.activeElement).toBe(outside);
  });
});
