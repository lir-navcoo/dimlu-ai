import {
  cloneElement,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
} from 'react';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logAuthor, logButton, logHarness, logRuntime, logSchema } from './log-definition-fixture';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorDocument } from '../packages/editor/document';
import { registry } from '../src/materials';
import type { LocateRequest } from '../src/editor/navigation';

type Click = (event: ReactMouseEvent<HTMLButtonElement>) => void;
const captures = vi.hoisted(() => ({ sequence: 0, callbacks: new Map<string, Click>() }));
vi.mock('../src/ui/primitives', async (original) => {
  const actual = await original<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Tip: (props: ComponentProps<typeof actual.Tip>) => {
      const child = props.children as ReactElement<Record<string, unknown>>;
      const token = String(++captures.sequence);
      if (typeof child.props.onClick === 'function')
        captures.callbacks.set(token, child.props.onClick as Click);
      return (
        <actual.Tip {...props}>
          {cloneElement(child, { 'data-log-owned-source': token })}
        </actual.Tip>
      );
    },
  };
});
const frames = new Map<number, FrameRequestCallback>();
let frameSequence = 0;
const runtimes: PageRuntime[] = [];
beforeEach(() => {
  captures.sequence = 0;
  captures.callbacks.clear();
  frames.clear();
  frameSequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameSequence, callback);
    return frameSequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 100, 240, 300),
  );
});
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  frames.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const h = logHarness();
  runtimes.push(h.runtime);
  return h;
}
function retained(button = logButton()) {
  const callback = captures.callbacks.get(button.dataset.logOwnedSource!);
  if (!callback) throw new Error('Independent fixture failed to capture actual source onClick');
  return () =>
    callback({
      currentTarget: button,
      target: button,
      nativeEvent: new MouseEvent('click', { bubbles: true }),
      preventDefault() {},
      stopPropagation() {},
    } as unknown as ReactMouseEvent<HTMLButtonElement>);
}
function call(callback: () => void) {
  act(callback);
}
function refused(h: ReturnType<typeof setup>, callback: () => void) {
  const snapshot = h.doc.getSnapshot(),
    clipboard = h.doc.getClipboardSnapshot(),
    fragments = h.doc.getSavedFragmentsSnapshot(),
    count = h.prepareCount(),
    request = h.session().navigation.getSnapshot().request;
  call(callback);
  expect(h.doc.getSnapshot()).toBe(snapshot);
  expect(h.doc.getClipboardSnapshot()).toBe(clipboard);
  expect(h.doc.getSavedFragmentsSnapshot()).toBe(fragments);
  expect(h.prepareCount()).toBe(count);
  expect(h.session().navigation.getSnapshot().request).toBe(request);
}
async function frame() {
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
  await act(async () => {
    await Promise.resolve();
  });
}
async function finish() {
  await frame();
  await frame();
  await frame();
}
async function accepted(h: ReturnType<typeof setup>, callback = retained()) {
  call(callback);
  await finish();
  expect(h.doc.getSnapshot().selection).toEqual({ pageId: 'page', nodeId: 'target' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '选中 文本 target' }));
  expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
}
function pointer() {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 100,
    clientY: 100,
  });
  Object.defineProperty(event, 'pointerId', { value: 31 });
  return event;
}

describe('043 independent locator ordinary ownership', () => {
  it('locates the real defining button from an actual local runtime action.error without rerunning its chain', async () => {
    const schema = structuredClone(logSchema);
    schema.dependencies.components['ui.button'] = '1.0.0';
    schema.dependencies.actions['ui.notify'] = '1.0.0';
    schema.pages[0].children[1].children![0] = {
      id: 'target',
      component: 'ui.button',
      props: { label: { kind: 'literal', value: 'Target button' } },
      on: {
        onClick: [
          {
            id: 'notify',
            action: 'ui.notify',
            input: { title: { kind: 'expression', language: 'javascript', source: 'event' } },
          },
        ],
      },
    };
    const doc = new EditorDocument(schema, registry);
    doc.select('page', 'other');
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    runtimes.push(runtime);
    const chain = runtime.page.children[1].children[0].on.onClick;
    expect(await runtime.run(chain, {}, 42, 'local-invalid-title', 'target')).toBe(false);
    expect(runtime.getRecords()).toHaveLength(1);
    expect(runtime.getRecords()[0]).toMatchObject({
      kind: 'action.error',
      level: 'error',
      nodeId: 'target',
    });
    runtime.setDesignMode(true);
    const records = runtime.getRecords();
    const h = logHarness(doc, runtime);
    fireEvent.click(logButton());
    await finish();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '选中 按钮 target' }));
    expect(doc.getSnapshot().selection.nodeId).toBe('target');
    expect(runtime.getRecords()).toBe(records);
    expect(h.prepareCount()).toBe(1);
  });
  it.each(['different', 'singleton', 'multi'] as const)(
    'accepts exact own0/1 selection domain for %s and leaves plan/history/runtime/clipboard/fragments unchanged',
    async (kind) => {
      const doc = logAuthor();
      if (kind === 'singleton') doc.select('page', 'target');
      if (kind === 'multi') doc.selectMany('page', ['other', 'target'], 'target');
      doc.copyNodeToClipboard('page', 'other');
      doc.saveFragment('page', ['other'], 'Saved');
      const runtime = logRuntime(doc);
      runtimes.push(runtime);
      const h = logHarness(doc, runtime);
      const snapshot = doc.getSnapshot(),
        clipboard = doc.getClipboardSnapshot(),
        fragments = doc.getSavedFragmentsSnapshot(),
        state = runtime.getState(),
        records = runtime.getRecords();
      let publications = 0;
      const stop = doc.subscribe(() => publications++);
      await accepted(h);
      stop();
      expect(publications).toBe(kind === 'singleton' ? 0 : 1);
      const next = doc.getSnapshot();
      expect(next.plan).toBe(snapshot.plan);
      expect(next.revision).toBe(snapshot.revision);
      expect(next.change).toBe(snapshot.change);
      expect([next.canUndo, next.canRedo]).toEqual([snapshot.canUndo, snapshot.canRedo]);
      expect(doc.getClipboardSnapshot()).toBe(clipboard);
      expect(doc.getSavedFragmentsSnapshot()).toBe(fragments);
      expect(runtime.getState()).toBe(state);
      expect(runtime.getRecords()).toBe(records);
    },
  );

  it('unrelated retained records stay usable when another real log appends', async () => {
    const h = setup(),
      old = retained();
    act(() => h.runtime.report('another', 'New metadata only'));
    await accepted(h, old);
  });

  it('omitting optional parent context preserves readable logs without an executable locator', () => {
    const doc = logAuthor(),
      runtime = logRuntime(doc);
    runtimes.push(runtime);
    logHarness(doc, runtime, true);
    const row = document.querySelector('.logs article')!;
    expect(row.textContent).toContain('Read me');
    expect(within(row as HTMLElement).queryByRole('button')).toBeNull();
  });

  it.each(['preview', 'disabled-drag', 'unmount'] as const)(
    'permanently retires observed %s roundtrip while a fresh source remains usable',
    async (reason) => {
      const h = setup(),
        old = retained();
      if (reason === 'preview') h.view.rerender(h.tree(h.doc, h.runtime, false));
      if (reason === 'disabled-drag') h.view.rerender(h.tree(h.doc, h.runtime, true, false));
      if (reason === 'unmount') h.view.rerender(h.tree(h.doc, h.runtime, true, true, false));
      refused(h, old);
      h.view.rerender(h.tree());
      refused(h, old);
      await accepted(h);
    },
  );

  it('selection publication and return before render retire old callback without banning a fresh locator', async () => {
    const h = setup(),
      old = retained();
    act(() => {
      h.doc.select('page', 'root');
      h.doc.select('page', 'other');
      old();
    });
    expect(h.prepareCount()).toBe(0);
    expect(h.doc.getSnapshot().selection.nodeId).toBe('other');
    refused(h, old);
    await accepted(h);
  });

  it('plan/code publication and Undo return before render cannot revive a captured callback', async () => {
    const h = setup(),
      old = retained(),
      plan = h.doc.getSnapshot().plan;
    act(() => {
      h.doc.setPageCode('page', {
        enabled: true,
        language: 'jsx',
        source: 'export default function Page(){return null}',
        css: '',
      });
      old();
      h.doc.undo();
      old();
    });
    expect(h.doc.getSnapshot().plan).toBe(plan);
    expect(h.prepareCount()).toBe(0);
    refused(h, old);
    await accepted(h);
  });

  it('document/page/runtime roundtrips do not accept equal node IDs and sequence as source identity', async () => {
    const h = setup(),
      old = retained();
    const replacement = logAuthor(),
      otherRuntime = logRuntime(replacement);
    runtimes.push(otherRuntime);
    expect(otherRuntime.getRecords()[0].sequence).toBe(h.runtime.getRecords()[0].sequence);
    h.view.rerender(h.tree(replacement, otherRuntime));
    refused(h, old);
    h.view.rerender(h.tree());
    refused(h, old);
    await accepted(h);
  });

  it('a different current page with the same definition ID cannot borrow a record from the previous page', async () => {
    const h = setup(),
      old = retained();
    act(() => h.doc.select('second', 'target'));
    refused(h, old);
    expect(document.querySelectorAll('.logs article button')).toHaveLength(0);
    act(() => h.doc.select('page', 'other'));
    refused(h, old);
    await accepted(h);
  });

  it('same-document runtime identity replacement and return permanently retires the old source despite equal sequence', async () => {
    const h = setup(),
      old = retained(),
      replacement = logRuntime(h.doc);
    runtimes.push(replacement);
    expect(replacement.getRecords()[0].sequence).toBe(h.runtime.getRecords()[0].sequence);
    h.view.rerender(h.tree(h.doc, replacement));
    refused(h, old);
    h.view.rerender(h.tree());
    refused(h, old);
    await accepted(h);
  });

  it('a current new plan temporarily paired with old runtime exposes no executable locator; returning never revives old callback', async () => {
    const h = setup(),
      old = retained();
    act(() => h.doc.setProp('page', 'other', 'value', { kind: 'literal', value: 'New plan' }));
    expect(document.querySelectorAll('.logs article button')).toHaveLength(0);
    refused(h, old);
    act(() => h.doc.undo());
    refused(h, old);
    await accepted(h);
  });

  it('unknown/no-node records stay readable and never guess from a message containing target', () => {
    const h = setup();
    act(() => {
      h.runtime.report('no-node', 'target');
      h.runtime.report('unknown', 'target', 'unknown');
    });
    for (const kind of ['no-node', 'unknown']) {
      const row = [...document.querySelectorAll<HTMLElement>('.logs article')].find((item) =>
        item.textContent?.includes(kind),
      )!;
      expect(row.textContent).toContain('target');
      expect(within(row).queryByRole('button')).toBeNull();
    }
  });

  it('eviction retires exact record callbacks, surviving records and new fresh callbacks remain distinct', async () => {
    const h = setup(),
      old = retained(),
      original = h.runtime.getRecords()[0];
    act(() => {
      for (let index = 0; index < 101; index++) h.runtime.report('filler', `row${index}`);
    });
    expect(h.runtime.getRecords()).not.toContain(original);
    refused(h, old);
    act(() => h.runtime.report('fresh', 'new exact object', 'target'));
    await accepted(h);
  });

  it('observing altered immutable record fields retires that source even after the fields return', async () => {
    const h = setup(),
      old = retained(),
      record = h.runtime.getRecords()[0],
      original = record.message;
    record.message = 'Changed in place';
    refused(h, old);
    record.message = original;
    refused(h, old);
    act(() => h.runtime.report('fresh', 'separate target record', 'target'));
    await accepted(h);
  });

  it('disposed runtime refuses a retained source without mutation', () => {
    const h = setup(),
      old = retained();
    h.runtime.dispose();
    refused(h, old);
  });

  it('same-event pending pointer observation permanently retires source, cancel permits only fresh locator', async () => {
    const h = setup(),
      old = retained();
    h.duringPending(() => refused(h, old));
    fireEvent(screen.getByRole('button', { name: 'Local pending drag' }), pointer());
    expect(h.drag().isInteracting).toBe(true);
    act(() => h.drag().cancel());
    refused(h, old);
    await accepted(h);
  });

  it('active keyboard drag disables location and old callback remains retired after cancel', async () => {
    const h = setup(),
      old = retained();
    act(() => h.drag().begin({ kind: 'node', nodeId: 'other' }));
    expect(h.drag().session).not.toBeNull();
    refused(h, old);
    act(() => h.drag().cancel());
    refused(h, old);
    await accepted(h);
  });
});

describe('043 independent bounded receipt and fresh-owner cancellation', () => {
  it('an explicitly registered opening lifecycle remains live until its one fresh ready commit', async () => {
    const h = setup();
    h.view.rerender(h.tree(h.doc, h.runtime, true, true, true, undefined, true, true));
    fireEvent.click(logButton());
    expect(h.prepareCount()).toBe(1);
    expect(h.releaseCount()).toBe(0);
    expect(h.session().navigation.getSnapshot().request).toBeNull();
    h.view.rerender(h.tree());
    await finish();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '选中 文本 target' }));
    expect(h.releaseCount()).toBe(1);
  });

  it('a not-ready bridge without an explicit opening lifecycle cancels after its own commit and cannot resume later', async () => {
    const h = setup();
    h.view.rerender(h.tree(h.doc, h.runtime, true, true, true, undefined, true, false));
    fireEvent.click(logButton());
    expect(h.prepareCount()).toBe(1);
    expect(h.releaseCount()).toBe(1);
    h.view.rerender(h.tree());
    await finish();
    expect(h.session().navigation.getSnapshot().request).toBeNull();
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: '选中 文本 target' }),
    );
  });

  it('fresh input focus while waiting a registered opening cancels and its late ready event never acquires focus', async () => {
    const h = setup();
    h.view.rerender(h.tree(h.doc, h.runtime, true, true, true, undefined, true, true));
    fireEvent.click(logButton());
    expect(h.releaseCount()).toBe(0);
    const field = screen.getByRole('textbox', { name: 'Unrelated focus' });
    act(() => field.focus());
    expect(h.releaseCount()).toBe(1);
    h.view.rerender(h.tree());
    await finish();
    expect(document.activeElement).toBe(field);
  });

  it.each(['panel', 'left-closed'] as const)(
    'foreign programmatic %s during presenting retires immediately and cannot resume after return',
    async (kind) => {
      const h = setup();
      h.view.rerender(h.tree(h.doc, h.runtime, true, true, true, undefined, true));
      fireEvent.click(logButton());
      expect(h.prepareCount()).toBe(1);
      expect(h.session().navigation.getSnapshot().request).toBeNull();
      act(() => {
        if (kind === 'panel') h.session().activatePanel('data');
        else h.session().setLeftOpen(false);
      });
      const retiredBeforeReturn = h.releaseCount();
      act(() => {
        if (kind === 'panel') h.session().activatePanel('structure');
        else h.session().setLeftOpen(true);
      });
      h.view.rerender(h.tree());
      await finish();
      expect(retiredBeforeReturn).toBe(1);
      expect(h.session().navigation.getSnapshot().request).toBeNull();
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: '选中 文本 target' }),
      );
    },
  );

  it.each(['foreign-selection', 'selection-return', 'plan-return'] as const)(
    'refuses synchronous document observer takeover %s before presentation',
    async (kind) => {
      const h = setup();
      let once = false;
      const stop = h.doc.subscribe(() => {
        if (once) return;
        once = true;
        if (kind === 'foreign-selection') h.doc.select('page', 'root');
        if (kind === 'selection-return') {
          h.doc.select('page', 'other');
          h.doc.select('page', 'target');
        }
        if (kind === 'plan-return') {
          h.doc.setProp('page', 'other', 'value', { kind: 'literal', value: 'Foreign' });
          h.doc.undo();
        }
      });
      fireEvent.click(logButton());
      stop();
      await finish();
      expect(h.prepareCount()).toBe(0);
      expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(true);
      expect(h.session().navigation.getSnapshot().request).toBeNull();
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: '选中 文本 target' }),
      );
    },
  );

  it('foreign navigation request replaces own request and old cancellation cannot clear or execute it', async () => {
    const h = setup();
    let replaced = false;
    let foreignSequence: number | undefined;
    const stop = h.session().navigation.subscribe(() => {
      const current = h.session().navigation.getSnapshot().request;
      if (!replaced && current?.nodeId === 'target') {
        replaced = true;
        h.session().navigation.requestLocate('tree', 'other');
        foreignSequence = h.session().navigation.getSnapshot().request?.sequence;
      }
    });
    fireEvent.click(logButton());
    expect(replaced).toBe(true);
    expect(h.session().navigation.getSnapshot().request?.sequence).toBe(foreignSequence);
    await finish();
    stop();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '选中 文本 other' }));
  });

  it('an early observer same-target replacement remains foreign even when all target fields match', async () => {
    const h = setup();
    let replaced = false;
    let foreign: LocateRequest | null = null;
    const stop = h.session().navigation.subscribe(() => {
      const current = h.session().navigation.getSnapshot().request;
      if (!replaced && current?.nodeId === 'target') {
        replaced = true;
        h.session().navigation.requestLocate('tree', 'target');
        foreign = h.session().navigation.getSnapshot().request;
      }
    });
    fireEvent.click(logButton());
    expect(replaced).toBe(true);
    expect(foreign).not.toBeNull();
    expect(h.session().navigation.getSnapshot().request).toBe(foreign);
    await finish();
    stop();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '选中 文本 target' }));
  });

  it('an early observer hover retaining the original request cancels exact own request before its old tree RAF', async () => {
    const h = setup();
    let nested = false;
    const stop = h.session().navigation.subscribe(() => {
      const current = h.session().navigation.getSnapshot().request;
      if (!nested && current?.nodeId === 'target') {
        nested = true;
        h.session().navigation.setHover({ pageId: 'page', nodeId: 'root' }, 'tree');
      }
    });
    fireEvent.click(logButton());
    expect(nested).toBe(true);
    expect(h.session().navigation.getSnapshot().request).toBeNull();
    await finish();
    stop();
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: '选中 文本 target' }),
    );
  });

  it.each(['pointer', 'keyboard', 'focus'] as const)(
    'new %s ownership before tree RAF cancels exact own request and prevents late target focus',
    async (kind) => {
      const h = setup();
      fireEvent.click(logButton());
      const request = h.session().navigation.getSnapshot().request;
      expect(request?.nodeId).toBe('target');
      const field = screen.getByRole('textbox', { name: 'Unrelated focus' });
      if (kind === 'pointer') fireEvent(field, pointer());
      if (kind === 'keyboard') fireEvent.keyDown(field, { key: 'a' });
      act(() => field.focus());
      await finish();
      expect(document.activeElement).toBe(field);
      expect(h.session().navigation.getSnapshot().request).toBeNull();
    },
  );

  it('reopened dock owns its new focus and pending old request cannot later close or focus it away', async () => {
    const h = setup();
    fireEvent.click(logButton());
    h.reopen();
    await finish();
    expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(true);
    expect(document.activeElement).not.toBe(
      screen.getByRole('button', { name: '选中 文本 target' }),
    );
  });
});
