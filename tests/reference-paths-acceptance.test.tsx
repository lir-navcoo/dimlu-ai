import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValueInput, bindingDraft } from '../src/editor/ValueEditor';
import { TipProvider } from '../src/ui/primitives';
import {
  acceptedReference,
  exactPath,
  pathText,
  referenceHarness,
  referenceAuthor,
} from './reference-paths-fixture';

type Handler = (...arguments_: any[]) => unknown;
const held = vi.hoisted(() => ({
  serial: 0,
  items: new Map<string, Handler>(),
  roots: [] as Handler[],
}));
// Capture callbacks from real Base UI controls; permission and menu behavior remain production code.
vi.mock('@base-ui/react/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/menu')>();
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
        const token = String(++held.serial);
        if (props.onClick) held.items.set(token, props.onClick as Handler);
        return <actual.Menu.Item {...props} data-reference-held={token} />;
      },
    },
  };
});
beforeEach(() => {
  held.items.clear();
  held.roots.length = 0;
  held.serial = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const trigger = (label = '文本内容') => screen.getByRole('button', { name: `${label}初始值路径` });
const menu = (label = '文本内容') => screen.getByRole('menu', { name: `${label}初始值路径选项` });
const item = (path = pathText) =>
  screen.getAllByRole('menuitem').find((element) => element.textContent === path)!;
const captureItem = (path = pathText) => {
  const option = item(path);
  expect(option).toBeTruthy();
  return held.items.get(option.dataset.referenceHeld!)!;
};
const pathInput = () => screen.getByRole('textbox', { name: '文本内容数据路径' });

describe('property initial path chooser independent acceptance', () => {
  it('opens and cancels without draft/document/request writes, then commits one exact saved path with Undo/Redo', () => {
    const h = referenceHarness();
    const before = h.author.getSnapshot();
    const entry = h.propertyEntry();
    const write = vi.spyOn(h.session().drafts, 'write');
    fireEvent.click(trigger());
    expect(menu()).toBeTruthy();
    expect(screen.queryByText('["runtimeOnly"]')).toBeNull();
    expect(screen.queryByText('["list","0"]')).toBeNull();
    fireEvent.keyDown(menu(), { key: 'Escape' });
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.propertyEntry()).toBe(entry);
    expect(write).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
    fireEvent.click(trigger());
    fireEvent.click(item());
    const after = h.author.getSnapshot();
    expect(after.revision).toBe(before.revision + 1);
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
    act(() => {
      h.author.undo();
    });
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: ['before'],
    });
    act(() => {
      h.author.redo();
    });
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
    expect(h.request).not.toHaveBeenCalled();
  });

  it('preserves invalid and future manual paths across chooser cancellation', () => {
    const h = referenceHarness();
    for (const path of ['[', '["future", "notSaved"]']) {
      fireEvent.change(pathInput(), { target: { value: path } });
      const displayed = (pathInput() as HTMLInputElement).value;
      const entry = h.propertyEntry();
      const snapshot = h.author.getSnapshot();
      const write = vi.spyOn(h.session().drafts, 'write');
      fireEvent.click(trigger());
      expect(menu()).toBeTruthy();
      fireEvent.keyDown(menu(), { key: 'Escape' });
      expect((pathInput() as HTMLInputElement).value).toBe(displayed);
      expect(h.propertyEntry()).toBe(entry);
      expect(h.author.getSnapshot()).toBe(snapshot);
      expect(write).not.toHaveBeenCalled();
      write.mockRestore();
    }
  });

  it('retires old option and close callbacks without closing or writing through a newer popup', () => {
    const h = referenceHarness();
    fireEvent.click(trigger());
    const oldOption = captureItem();
    const oldClose = held.roots.at(-1)!;
    fireEvent.keyDown(menu(), { key: 'Escape' });
    fireEvent.click(trigger());
    const before = h.author.getSnapshot();
    const draft = h.propertyEntry();
    act(() => {
      oldClose(false);
      oldOption();
    });
    expect(menu()).toBeTruthy();
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.propertyEntry()).toBe(draft);
    fireEvent.click(item());
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
  });

  it('observed node ABA and unrendered document publication refuse before the first property draft write', () => {
    const h = referenceHarness();
    fireEvent.click(trigger());
    const old = captureItem();
    const original = h.propertyEntry();
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => {
      h.author.select('a', 'tail');
      old();
      h.author.select('a', 'bound');
      old();
    });
    expect(write).not.toHaveBeenCalled();
    expect(h.propertyEntry()).toBe(original);
    expect(h.author.getSnapshot().canUndo).toBe(false);
    fireEvent.click(trigger());
    fireEvent.click(item());
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
  });

  it('checks pending live drag before render and keeps its old callback retired after return', () => {
    const h = referenceHarness();
    fireEvent.click(trigger());
    const old = captureItem();
    const entry = h.propertyEntry();
    h.duringPending(() => old());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Prepare reference pointer' }), {
      pointerId: 91,
      pointerType: 'mouse',
      button: 0,
      clientX: 1,
      clientY: 1,
    });
    expect(h.propertyEntry()).toBe(entry);
    expect(h.author.getSnapshot().canUndo).toBe(false);
    act(() => {
      h.drag().cancel();
    });
    act(() => {
      old();
    });
    expect(h.propertyEntry()).toBe(entry);
    fireEvent.click(trigger());
    fireEvent.click(item());
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
  });

  it('requires a parent draft ACK after write/reset/rebase, even with preserved draft value identity', () => {
    const h = referenceHarness({ isolated: true });
    const store = h.session().drafts;
    for (const publication of ['write', 'reset', 'rebase']) {
      fireEvent.click(trigger('独立'));
      const old = captureItem();
      const entry = h.isolatedEntry();
      act(() => {
        if (publication === 'reset') store.clear('reference-owner');
        else
          store.write('reference-owner', {
            ...entry,
            source: publication === 'rebase' ? 'rebased' : entry.source,
            dirty: true,
          });
        old();
      });
      expect(h.chosen).not.toHaveBeenCalled();
      fireEvent.click(trigger('独立'));
      expect(screen.queryByRole('menu', { name: '独立初始值路径选项' })).toBeNull();
      h.view.rerender(h.tree());
      fireEvent.click(trigger('独立'));
      expect(menu('独立')).toBeTruthy();
      fireEvent.keyDown(menu('独立'), { key: 'Escape' });
    }
    fireEvent.click(trigger('独立'));
    fireEvent.click(item());
    expect(h.chosen).toHaveBeenCalledExactlyOnceWith(pathText);
  });

  it('survives initial StrictMode setup while retiring callbacks across disabled mode and unmount', () => {
    const h = referenceHarness({ strict: true });
    fireEvent.click(trigger());
    const old = captureItem();
    h.view.rerender(h.tree(false));
    h.view.rerender(h.tree());
    const before = h.propertyEntry();
    act(() => {
      old();
    });
    expect(h.propertyEntry()).toBe(before);
    fireEvent.click(trigger());
    const current = captureItem();
    fireEvent.click(item());
    expect(acceptedReference(h.author)).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: exactPath,
    });
    h.view.unmount();
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => {
      current();
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps shared ValueInput callers manual when no explicit property owner is provided', () => {
    const { author, request } = referenceAuthor();
    const page = author.getSnapshot().plan.pages.get('a')!.schema;
    const change = vi.fn();
    const view = render(
      <TipProvider>
        <ValueInput
          label="共享"
          field={{ type: 'json' }}
          page={page}
          draft={bindingDraft({ kind: 'dataRef', sourceId: 'people' }, { type: 'json' })}
          onChange={change}
        />
      </TipProvider>,
    );
    expect(screen.queryByRole('button', { name: '共享初始值路径' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '共享数据路径' }), {
      target: { value: '[]' },
    });
    expect(change.mock.calls[0][0].path).toBe('[]');
    view.rerender(
      <TipProvider>
        <ValueInput
          label="共享"
          field={{ type: 'json' }}
          page={page}
          draft={bindingDraft({ kind: 'stateRef', stateId: 'caption' }, { type: 'json' })}
          onChange={change}
        />
      </TipProvider>,
    );
    expect(screen.queryByRole('button', { name: '共享初始值路径' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});
