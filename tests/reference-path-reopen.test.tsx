import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptedReference,
  exactPath,
  pathText,
  referenceHarness,
} from './reference-paths-fixture';
import { reopenHarness } from './reference-path-reopen-fixture';

type Handler = (...arguments_: any[]) => unknown;
const held = vi.hoisted(() => ({
  roots: [] as Handler[],
  option: undefined as Handler | undefined,
}));
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
        if (props.label === pathText) held.option = () => props.onClick?.({} as never);
        return <actual.Menu.Item {...props} />;
      },
    },
  };
});
beforeEach(() => {
  held.roots.length = 0;
  held.option = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const trigger = (label = '文本内容') => screen.getByRole('button', { name: `${label}初始值路径` });
const menu = (label = '文本内容') => screen.queryByRole('menu', { name: `${label}初始值路径选项` });
const exactItem = () =>
  screen.getAllByRole('menuitem').find((item) => item.textContent === pathText)!;

describe('current reference-path opening after retired permission', () => {
  it('actual StrictMode PropertyInput reopens after unrelated UI publication without changing its entry or document', () => {
    const h = referenceHarness({ strict: true });
    const oldOpen = held.roots.at(-1)!;
    fireEvent.click(trigger());
    const oldOption = held.option!;
    const oldClose = held.roots.at(-1)!;
    fireEvent.keyDown(menu()!, { key: 'Escape' });
    const entry = h.propertyEntry();
    const snapshot = h.author.getSnapshot();
    const write = vi.spyOn(h.session().drafts, 'write');
    const clear = vi.spyOn(h.session().drafts, 'clear');
    act(() => {
      h.session().drafts.write('ui:debug/open', { value: false, source: 'ui', dirty: false });
      oldOpen(true);
      oldOption();
    });
    expect(h.propertyEntry()).toBe(entry);
    expect(h.author.getSnapshot()).toBe(snapshot);
    expect(write).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    fireEvent.click(trigger());
    expect(menu()).not.toBeNull();
    act(() => {
      oldOpen(true);
      oldClose(false);
      oldOption();
    });
    expect(menu()).not.toBeNull();
    expect(h.propertyEntry()).toBe(entry);
    expect(write).toHaveBeenCalledTimes(1);
    fireEvent.click(exactItem());
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
    expect(h.author.getSnapshot().revision).toBe(snapshot.revision + 1);
    expect(h.request).not.toHaveBeenCalled();
  });

  it('actual owning same-value writes, reset and rebase reject old callbacks before parent commit while fresh controls recover', () => {
    const h = referenceHarness();
    const store = h.session().drafts;
    const snapshot = h.author.getSnapshot();
    for (const publication of ['write', 'reset', 'rebase']) {
      const oldOpen = held.roots.at(-1)!;
      fireEvent.click(trigger());
      const oldOption = held.option!;
      const entry = h.propertyEntry();
      const write = vi.spyOn(store, 'write');
      act(() => {
        if (publication === 'reset') store.clear('prop:a/bound/value');
        else
          store.write('prop:a/bound/value', {
            ...entry,
            source: entry.source,
            dirty: entry.dirty,
          });
        oldOption();
        oldOpen(true);
      });
      expect(write.mock.calls.length).toBe(publication === 'reset' ? 0 : 1);
      expect(h.author.getSnapshot()).toBe(snapshot);
      fireEvent.click(trigger());
      expect(menu()).not.toBeNull();
      const current = h.propertyEntry();
      act(() => oldOption());
      expect(h.propertyEntry()).toBe(current);
      expect(menu()).not.toBeNull();
      fireEvent.keyDown(menu()!, { key: 'Escape' });
      write.mockRestore();
    }
  });

  it('withheld genuine parent ACK stays blocked after same-value own publication, reset and rebase', () => {
    const h = reopenHarness();
    const store = h.session().drafts;
    for (const publication of ['write', 'reset', 'rebase']) {
      const oldOpen = held.roots.at(-1)!;
      fireEvent.click(trigger('续开'));
      const oldOption = held.option!;
      const oldClose = held.roots.at(-1)!;
      const entry = h.entry();
      const calls = h.observation.mock.calls.length;
      h.hold(true);
      act(() => {
        if (publication === 'reset') store.clear('reopen-owner');
        else
          store.write('reopen-owner', {
            ...entry,
            source: publication === 'rebase' ? 'rebased' : entry.source,
            dirty: true,
          });
        oldOption();
        oldOpen(true);
        oldClose(false);
      });
      expect(h.observation).toHaveBeenCalledTimes(calls + 1);
      expect(h.chosen).not.toHaveBeenCalled();
      fireEvent.click(trigger('续开'));
      expect(menu('续开')).toBeNull();
      expect(h.observation).toHaveBeenCalledTimes(calls + 1);
      h.hold(false);
      act(() => h.acknowledge());
      fireEvent.click(trigger('续开'));
      expect(menu('续开')).not.toBeNull();
      act(() => {
        oldOption();
        oldOpen(true);
        oldClose(false);
      });
      expect(menu('续开')).not.toBeNull();
      expect(h.chosen).not.toHaveBeenCalled();
      fireEvent.keyDown(menu('续开')!, { key: 'Escape' });
    }
    fireEvent.click(trigger('续开'));
    fireEvent.click(exactItem());
    expect(h.chosen).toHaveBeenCalledExactlyOnceWith(pathText);
  });

  it('first live refusal requests real observation once; retired opening cannot request or revive after validity returns', () => {
    const h = reopenHarness();
    const oldOpen = held.roots.at(-1)!;
    h.allow(false);
    fireEvent.click(trigger('续开'));
    expect(menu('续开')).toBeNull();
    expect(h.observation).toHaveBeenCalledTimes(1);
    h.allow(true);
    act(() => {
      oldOpen(true);
      oldOpen(true);
    });
    expect(h.observation).toHaveBeenCalledTimes(1);
    expect(menu('续开')).toBeNull();
    fireEvent.click(trigger('续开'));
    expect(menu('续开')).not.toBeNull();
    expect(h.chosen).not.toHaveBeenCalled();
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('current denied option retires before callback and observes once; StrictMode and unmount do not request in a loop', () => {
    const h = reopenHarness({ strict: true });
    expect(h.observation).not.toHaveBeenCalled();
    const oldOpen = held.roots.at(-1)!;
    fireEvent.click(trigger('续开'));
    const oldOption = held.option!;
    const oldClose = held.roots.at(-1)!;
    h.allow(false);
    act(() => oldOption());
    expect(h.observation).toHaveBeenCalledTimes(1);
    expect(h.chosen).not.toHaveBeenCalled();
    h.allow(true);
    fireEvent.click(trigger('续开'));
    expect(menu('续开')).not.toBeNull();
    act(() => {
      oldOpen(true);
      oldOption();
      oldClose(false);
    });
    expect(menu('续开')).not.toBeNull();
    expect(h.observation).toHaveBeenCalledTimes(1);
    const renders = h.renders();
    expect(renders).toBeLessThan(30);
    h.view.unmount();
    act(() => {
      oldOpen(true);
      oldOption();
      oldClose(false);
      h.session().drafts.write('unmounted-publication', {
        value: false,
        source: 'ui',
        dirty: false,
      });
    });
    expect(h.observation).toHaveBeenCalledTimes(1);
    expect(h.renders()).toBe(renders);
    expect(h.chosen).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });
});
