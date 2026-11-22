import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeControl, closeActionConfig, openActionConfig } from './ui-helpers';
import {
  eventHarness,
  eventSpecialPath,
  eventSpecialText,
  isolatedEventHarness,
  savedEventCalls,
} from './event-reference-paths-fixture';

type Handler = (...arguments_: any[]) => unknown;
const held = vi.hoisted(() => ({
  sequence: 0,
  options: new Map<string, Handler>(),
  roots: [] as Handler[],
}));
// Observe real BaseUI callback closures while rendering its original controls and production guards.
vi.mock('@base-ui/react/menu', async (original) => {
  const actual = await original<typeof import('@base-ui/react/menu')>();
  return {
    ...actual,
    Menu: {
      ...actual.Menu,
      Root: (props: ComponentProps<typeof actual.Menu.Root>) => {
        if (props.open !== undefined && props.onOpenChange)
          held.roots.push((open: boolean) => props.onOpenChange!(open, {} as never));
        return <actual.Menu.Root {...props} />;
      },
      Item: (props: ComponentProps<typeof actual.Menu.Item>) => {
        const token = String(++held.sequence);
        if (props.onClick) held.options.set(token, props.onClick as Handler);
        return <actual.Menu.Item {...props} data-event-held={token} />;
      },
    },
  };
});
beforeEach(() => {
  held.sequence = 0;
  held.options.clear();
  held.roots.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const card = (index = 1) => screen.getByRole('region', { name: `动作 ${index}` });
// Parameters live inside the action config dialog; only the row tools stay in the list.
const dialog = () => screen.getByRole('dialog');
// Open the dialog only when it is not already up: reopening would remount the
// parameter owners that these ownership tests observe.
const ensureDialog = (index = 1) => {
  if (screen.queryByRole('dialog') === null) openActionConfig(index);
};
const trigger = (index = 1, name = 'title') => {
  ensureDialog(index);
  return within(dialog()).getByRole('button', { name: `${name}初始值路径` });
};
const pathInput = (index = 1, name = 'title') => {
  ensureDialog(index);
  return within(dialog()).getByRole('textbox', { name: `${name}数据路径` }) as HTMLInputElement;
};
const menu = () => screen.getByRole('menu');
const option = (path = eventSpecialText) =>
  screen.getAllByRole('menuitem').find((item) => item.querySelector('code')?.textContent === path)!;
const capture = (path = eventSpecialText) => held.options.get(option(path).dataset.eventHeld!)!;
const save = () => {
  closeActionConfig();
  fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
};
const open = (index = 1, name = 'title') => {
  ensureDialog(index);
  fireEvent.click(trigger(index, name));
};

describe('node-event saved initial path ownership and draft integration', () => {
  it('opens/cancels without writes and chooses only one parameter draft until original explicit Save and Undo/Redo', () => {
    const h = eventHarness();
    const before = h.author.getSnapshot();
    const saved = savedEventCalls(h.author);
    const entry = h.entry();
    // The dialog mount itself performs the initial draft reads; spy after it.
    ensureDialog(1);
    const write = vi.spyOn(h.session().drafts, 'write');
    const read = vi.spyOn(h.session().drafts, 'read');
    open();
    expect(screen.queryByText('["runtimeOnly"]')).toBeNull();
    expect(screen.queryByText('["array","0"]')).toBeNull();
    fireEvent.keyDown(menu(), { key: 'Escape' });
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(h.author.getSnapshot()).toBe(before);
    read.mockRestore();
    open();
    fireEvent.click(option());
    expect(write).toHaveBeenCalledTimes(1);
    expect(h.entry().value.calls[0].input.title.path).toBe(eventSpecialText);
    expect(h.entry().value.calls[0].input.tone).toBe(entry.value.calls[0].input.tone);
    expect(h.entry().value.calls[1]).toBe(entry.value.calls[1]);
    expect(h.author.getSnapshot()).toBe(before);
    expect(savedEventCalls(h.author)).toBe(saved);
    save();
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    expect(savedEventCalls(h.author)[0].input.title).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
      path: eventSpecialPath,
    });
    expect(savedEventCalls(h.author)[1]).toEqual(saved[1]);
    act(() => h.author.undo());
    expect(savedEventCalls(h.author)).toEqual(saved);
    act(() => h.author.redo());
    expect(savedEventCalls(h.author)[0].input.title).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
      path: eventSpecialPath,
    });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('keeps invalid/future manual paths on cancel and preserves explicit root versus unspecified through Save', () => {
    const h = eventHarness();
    const before = h.author.getSnapshot();
    for (const path of ['[', '["future","deeper"]']) {
      fireEvent.change(pathInput(3, 'value'), { target: { value: path } });
      const entry = h.entry();
      open(3, 'value');
      fireEvent.keyDown(menu(), { key: 'Escape' });
      expect(pathInput(3, 'value').value).toBe(path);
      expect(h.entry()).toBe(entry);
      expect(h.author.getSnapshot()).toBe(before);
    }
    open(3, 'value');
    fireEvent.click(option('[]'));
    expect(pathInput(3, 'value').value).toBe('[]');
    expect(savedEventCalls(h.author)[2].input.value).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
      path: ['payload'],
    });
    save();
    expect(savedEventCalls(h.author)[2].input.value).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
      path: [],
    });
    fireEvent.change(pathInput(3, 'value'), { target: { value: '' } });
    save();
    expect(savedEventCalls(h.author)[2].input.value).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
    });
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('reorder ABA and deletion/index reuse permanently retire old call callbacks while fresh exact-call choice works', () => {
    const h = eventHarness();
    open();
    const old = capture();
    const oldClose = held.roots.at(-1)!;
    closeActionConfig();
    fireEvent.click(within(card(1)).getByRole('button', { name: '下移动作 1' }));
    fireEvent.click(within(card(2)).getByRole('button', { name: '上移动作 2' }));
    let entry = h.entry();
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => old());
    expect(h.entry()).toBe(entry);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(within(card(1)).getByRole('button', { name: '删除动作 1' }));
    entry = h.entry();
    expect(entry.value.calls[0].id).toBe('a-notice-b');
    write.mockClear();
    open();
    act(() => {
      old();
      oldClose(false);
    });
    expect(menu()).toBeTruthy();
    expect(h.entry()).toBe(entry);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(option());
    expect(h.entry().value.calls[0].id).toBe('a-notice-b');
    expect(h.entry().value.calls[0].input.title.path).toBe(eventSpecialText);
    expect(savedEventCalls(h.author)[0].id).toBe('a-notice-a');
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('same call ID after action type replacement cannot revive the previous parameter owner', () => {
    const h = eventHarness();
    open();
    const old = capture();
    changeControl(within(dialog()).getByRole('combobox', { name: '动作 1 类型' }), 'state.set');
    const id = h.entry().value.calls[0].id;
    const entry = h.entry();
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => old());
    expect(h.entry()).toBe(entry);
    expect(write).not.toHaveBeenCalled();
    changeControl(within(dialog()).getByRole('combobox', { name: '动作 1 类型' }), 'ui.notify');
    changeControl(within(dialog()).getByRole('combobox', { name: 'title取值方式' }), 'dataRef');
    changeControl(within(dialog()).getByRole('combobox', { name: 'title数据源' }), 'records');
    expect(h.entry().value.calls[0].id).toBe(id);
    const fresh = h.entry();
    write.mockClear();
    open();
    act(() => old());
    expect(h.entry()).toBe(fresh);
    expect(menu()).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(option());
    expect(h.entry().value.calls[0].input.title.path).toBe(eventSpecialText);
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('source definition and observed node ABA replace choices and deny old option before any draft write', () => {
    const h = eventHarness();
    open();
    const old = capture();
    changeControl(within(dialog()).getByRole('combobox', { name: 'title数据源' }), 'alternate');
    open();
    expect(option('["alternateOnly"]')).toBeTruthy();
    expect(screen.queryByText(eventSpecialText)).toBeNull();
    const alternateOld = capture('["alternateOnly"]');
    const definition = h.author.getSnapshot().plan.pages.get('a')!.schema.dataSources![1];
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => {
      h.author.updateDataSource('a', 'alternate', {
        ...definition,
        initial: { replacementOnly: 'Replacement' },
      });
      alternateOld();
      old();
    });
    expect(write).not.toHaveBeenCalled();
    act(() => h.author.select('a', 'tail'));
    act(() => h.author.select('a', 'event-button'));
    const entry = h.entry();
    open();
    expect(option('["replacementOnly"]')).toBeTruthy();
    expect(screen.queryByText('["alternateOnly"]')).toBeNull();
    act(() => {
      alternateOld();
      old();
    });
    expect(h.entry()).toBe(entry);
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(option('["replacementOnly"]'));
    expect(h.entry().value.calls[0].input.title.path).toBe('["replacementOnly"]');
  });

  it('actual ActionChain parent ACK keeps fresh controls usable after global publication, same-value entry and pending drag', () => {
    const h = eventHarness({ strict: true });
    open();
    const old = capture();
    const oldClose = held.roots.at(-1)!;
    const entry = h.entry();
    const before = h.author.getSnapshot();
    act(() => {
      h.session().drafts.write('ui:debug/open', { value: false, source: 'ui', dirty: false });
      old();
    });
    expect(h.entry()).toBe(entry);
    open();
    expect(menu()).toBeTruthy();
    act(() => {
      old();
      oldClose(false);
    });
    expect(menu()).toBeTruthy();
    const sameValueOld = capture();
    act(() => {
      h.session().drafts.write('event:a/event-button/onClick', { ...h.entry() });
      sameValueOld();
    });
    expect(h.entry().value).toBe(entry.value);
    open();
    const pendingOld = capture();
    h.duringPending(() => pendingOld());
    closeActionConfig();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Prepare event path pointer' }), {
      pointerId: 83,
      pointerType: 'mouse',
      button: 0,
      clientX: 2,
      clientY: 2,
    });
    expect(h.entry().value).toBe(entry.value);
    expect(h.author.getSnapshot()).toBe(before);
    act(() => h.drag().cancel());
    h.view.rerender(h.tree(false));
    h.view.rerender(h.tree());
    open();
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => {
      pendingOld();
      old();
    });
    expect(write).not.toHaveBeenCalled();
    expect(menu()).toBeTruthy();
    fireEvent.click(option());
    expect(h.entry().value.calls[0].input.title.path).toBe(eventSpecialText);
    h.view.unmount();
    write.mockClear();
    act(() => pendingOld());
    expect(write).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('withheld genuine caller ACK cannot be replaced by helper render, same-value entry/reset/rebase or retired callbacks', () => {
    const h = isolatedEventHarness({ strict: true });
    const trigger = () => screen.getByRole('button', { name: '独立事件初始值路径' });
    const store = h.session().drafts;
    expect(h.observe).not.toHaveBeenCalled();
    for (const publication of ['write', 'reset', 'rebase']) {
      const oldOpen = held.roots.at(-1)!;
      fireEvent.click(trigger());
      const old = capture();
      const oldClose = held.roots.at(-1)!;
      const entry = h.entry();
      const requests = h.observe.mock.calls.length;
      h.hold(true);
      const read = vi.spyOn(store, 'read');
      act(() => {
        if (publication === 'reset') store.clear('event-isolated');
        else
          store.write('event-isolated', {
            ...entry,
            dirty: publication === 'rebase' || entry.dirty,
          });
        old();
        oldOpen(true);
        oldClose(false);
      });
      fireEvent.click(trigger());
      expect(screen.queryByRole('menu')).toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(h.observe).toHaveBeenCalledTimes(requests + 1);
      expect(h.choose).not.toHaveBeenCalled();
      read.mockRestore();
      h.hold(false);
      act(() => h.acknowledge());
      fireEvent.click(trigger());
      expect(menu()).toBeTruthy();
      act(() => {
        old();
        oldOpen(true);
        oldClose(false);
      });
      expect(menu()).toBeTruthy();
      expect(h.observe).toHaveBeenCalledTimes(requests + 1);
      fireEvent.keyDown(menu(), { key: 'Escape' });
    }
    const rejectedOpen = held.roots.at(-1)!;
    const requests = h.observe.mock.calls.length;
    h.allow(false);
    fireEvent.click(trigger());
    expect(h.observe).toHaveBeenCalledTimes(requests + 1);
    h.allow(true);
    act(() => rejectedOpen(true));
    expect(h.observe).toHaveBeenCalledTimes(requests + 1);
    fireEvent.click(trigger());
    const oldOption = capture();
    h.view.unmount();
    const renders = h.renders();
    act(() => {
      oldOption();
      rejectedOpen(true);
      store.write('unmounted-event', { value: false, source: 'ui', dirty: false });
    });
    expect(h.observe).toHaveBeenCalledTimes(requests + 1);
    expect(h.renders()).toBe(renders);
    expect(h.choose).not.toHaveBeenCalled();
  });

  it('PageLifecycle exposes page initial paths; standalone without owner and event stateRef remain manual', () => {
    const lifecycle = eventHarness({ lifecycle: true });
    openActionConfig(1);
    expect(within(dialog()).getByRole('button', { name: 'title初始值路径' })).toBeTruthy();
    expect(within(dialog()).getByRole('textbox', { name: 'title数据路径' })).toBeTruthy();
    expect(lifecycle.execute).not.toHaveBeenCalled();
    lifecycle.view.unmount();
    const standalone = eventHarness({ standalone: true });
    expect(screen.queryByRole('button', { name: /初始值路径/ })).toBeNull();
    standalone.view.unmount();
    eventHarness();
    openActionConfig(1);
    changeControl(within(dialog()).getByRole('combobox', { name: 'title取值方式' }), 'stateRef');
    expect(within(dialog()).queryByRole('button', { name: /初始值路径/ })).toBeNull();
  });
});
