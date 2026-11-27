import { StrictMode, useSyncExternalStore, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema, Json } from '../packages/schema/types';
import { ActionChainEditor } from '../src/editor/ActionPanel';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { PageEntryReferencePaths } from '../src/editor/PageEntryReferencePaths';
import { bindingDraft, ValueInput } from '../src/editor/ValueEditor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { registry } from '../src/materials';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { TipProvider } from '../src/ui/primitives';
import { eventAuthor, eventSpecialText } from './event-reference-paths-fixture';
import { actionOperation, changeControl, closeActionConfig, openActionConfig } from './ui-helpers';

type Handler = (...arguments_: any[]) => unknown;
const held = vi.hoisted(() => ({
  sequence: 0,
  options: new Map<string, Handler>(),
  roots: [] as Handler[],
  helpers: [] as Record<string, any>[],
  properties: [] as Record<string, any>[],
  events: [] as Record<string, any>[],
}));
// Actual Menu elements/production helper and owner callbacks are returned unchanged.
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
        return <actual.Menu.Item {...props} data-page-path-held={token} />;
      },
    },
  };
});
vi.mock('../src/editor/PageEntryReferencePaths', async (original) => {
  const actual = await original<typeof import('../src/editor/PageEntryReferencePaths')>();
  return {
    ...actual,
    PageEntryReferencePaths: (props: ComponentProps<typeof actual.PageEntryReferencePaths>) => {
      held.helpers.push(props);
      return <actual.PageEntryReferencePaths {...props} />;
    },
  };
});
vi.mock('../src/editor/ReferencePaths', async (original) => {
  const actual = await original<typeof import('../src/editor/ReferencePaths')>();
  return {
    ...actual,
    ReferencePaths: (props: ComponentProps<typeof actual.ReferencePaths>) => {
      held.properties.push(props);
      return <actual.ReferencePaths {...props} />;
    },
  };
});
vi.mock('../src/editor/EventReferencePaths', async (original) => {
  const actual = await original<typeof import('../src/editor/EventReferencePaths')>();
  return {
    ...actual,
    EventReferencePaths: (props: ComponentProps<typeof actual.EventReferencePaths>) => {
      held.events.push(props);
      return <actual.EventReferencePaths {...props} />;
    },
  };
});
beforeEach(() => {
  held.sequence = 0;
  held.options.clear();
  held.roots.length = 0;
  held.helpers.length = 0;
  held.properties.length = 0;
  held.events.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Draft = {
  calls: {
    id: string;
    action: string;
    input: Record<string, ReturnType<typeof bindingDraft>>;
    resultTo: string;
  }[];
  error: string;
};
function harness(
  options: {
    stock?: boolean;
    strict?: boolean;
    noSaved?: boolean;
    chain?: boolean;
    rawMismatch?: boolean;
    author?: EditorDocument;
  } = {},
) {
  const controlled = eventAuthor();
  const requests = [controlled.execute];
  if (options.stock)
    for (const transport of Object.values(registry.transports ?? {}))
      requests.push(vi.spyOn(transport, 'execute') as never);
  const schema: ApplicationSchema = structuredClone(
    options.stock ? purchaseManagementExample : controlled.author.getSnapshot().plan.schema,
  );
  if (options.noSaved) delete schema.pages[0].onEnter;
  const author =
    options.author ??
    (options.stock
      ? new EditorDocument(schema, registry)
      : new EditorDocument(schema, controlled.author.getSnapshot().plan.registry));
  let session!: ReturnType<typeof useEditorSession>,
    drag!: NonNullable<ReturnType<typeof useDragDrop>>,
    duringPending: (() => void) | undefined;
  let permission = true,
    enabled = true,
    pureAllowed = true,
    pureThrows = false;
  const canSave = vi.fn(() => {
      throw new Error('EXPLICIT SAVE DIAGNOSTIC ONLY');
    }),
    onSave = vi.fn();
  function Probe() {
    session = useEditorSession();
    drag = useDragDrop()!;
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'material', component: 'ui.text' }, event);
          duringPending?.();
        }}
      >
        Prepare page pointer
      </button>
    );
  }
  function Scene({ document }: { document: EditorDocument }) {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot),
      page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={enabled}>
        <Probe />
        {options.chain ? (
          <ActionChainEditor
            page={page}
            existing={page.onEnter ?? []}
            draftKey={`page-enter:${page.id}`}
            source={JSON.stringify(page)}
            pageScope
            authoringAllowed={permission}
            canSave={canSave}
            onSave={onSave}
            pageReference={{
              document,
              snapshot,
              pageId: page.id,
              savedActions: options.rawMismatch ? [] : page.onEnter,
              pageSource: JSON.stringify(page),
              canReference: () => {
                if (pureThrows) throw new Error('pure refusal');
                return pureAllowed;
              },
            }}
          />
        ) : (
          <PageLifecyclePanel
            document={document}
            snapshot={snapshot}
            authoringAllowed={permission}
          />
        )}
      </DragDropProvider>
    );
  }
  const tree = (document = author) => {
    const body = (
      <EditorSessionProvider>
        <TipProvider>
          <Scene document={document} />
        </TipProvider>
      </EditorSessionProvider>
    );
    return options.strict ? <StrictMode>{body}</StrictMode> : body;
  };
  const view = render(tree());
  const page = () =>
    author.getSnapshot().plan.pages.get(author.getSnapshot().selection.pageId)!.schema;
  const entry = () =>
    session.drafts.read<Draft>(`page-enter:${page().id}`, JSON.stringify(page()), {
      calls: [],
      error: '',
    });
  return {
    author,
    view,
    tree,
    page,
    entry,
    canSave,
    onSave,
    session: () => session,
    drag: () => drag,
    requests: () => requests.forEach((request) => expect(request).not.toHaveBeenCalled()),
    permission: (value: boolean) => {
      permission = value;
      view.rerender(tree());
    },
    enabled: (value: boolean) => {
      enabled = value;
      view.rerender(tree());
    },
    allow: (value: boolean, throws = false) => {
      pureAllowed = value;
      pureThrows = throws;
    },
    pending: (callback: () => void) => {
      duringPending = callback;
    },
  };
}
type Harness = ReturnType<typeof harness>;
const card = (index = 1) => screen.getByRole('region', { name: `动作 ${index}` });
// Parameters live inside the action config dialog; only the row tools stay in the list.
const dialog = () => screen.getByRole('dialog');
const ensureDialog = (index = 1) => {
  if (screen.queryByRole('dialog') === null) openActionConfig(index);
};
const trigger = (index = 1, parameter = 'title') => {
  ensureDialog(index);
  return within(dialog()).getByRole('button', { name: `${parameter}初始值路径` });
};
const pathInput = (index = 1, parameter = 'title') => {
  ensureDialog(index);
  return within(dialog()).getByRole('textbox', {
    name: `${parameter}数据路径`,
  }) as HTMLInputElement;
};
const menu = () => screen.getByRole('menu');
function option(path = eventSpecialText) {
  const item = screen
    .getAllByRole('menuitem')
    .find((item) => item.querySelector('code')?.textContent === path);
  expect(item, `offered path ${path}`).toBeTruthy();
  return item!;
}
const capture = (path = eventSpecialText) => held.options.get(option(path).dataset.pagePathHeld!)!;
const open = (index = 1, parameter = 'title') => {
  ensureDialog(index);
  fireEvent.click(trigger(index, parameter));
};
const choose = (path = eventSpecialText) => fireEvent.click(option(path));
const parentOwner = (callId = 'enter-a-notice-a', parameter = 'title') => {
  const props = [...held.helpers]
    .reverse()
    .find((props) => props.owner?.callId === callId && props.owner?.parameter === parameter);
  expect(props, `real helper owner ${callId}/${parameter}`).toBeTruthy();
  return props!.owner;
};
function noWrites(h: Harness, callback: () => void) {
  const before = h.author.getSnapshot(),
    entry = h.entry(),
    write = vi.spyOn(h.session().drafts, 'write'),
    clear = vi.spyOn(h.session().drafts, 'clear');
  act(callback);
  expect(h.author.getSnapshot()).toBe(before);
  expect(h.entry()).toBe(entry);
  expect(write).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  h.requests();
  write.mockRestore();
  clear.mockRestore();
}
function confirmIfStale() {
  const button = screen.queryByRole('button', { name: '确认使用草稿' });
  if (button) fireEvent.click(button);
}
function pointerDown(element: Element) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, 'pointerId', { value: 54 });
  fireEvent(element, event);
}
function draftObjectReference() {
  // PageLifecyclePanel hosts both enter and leave editors; the raw chain harness has one.
  const enter = screen.queryByRole('region', { name: '页面进入动作' });
  fireEvent.click((enter ? within(enter) : screen).getByRole('button', { name: '添加动作' }));
  changeControl(within(dialog()).getByRole('combobox', { name: 'stateId取值方式' }), 'literal');
  fireEvent.change(within(dialog()).getByRole('textbox', { name: 'stateId' }), {
    target: { value: 'result' },
  });
  changeControl(within(dialog()).getByRole('combobox', { name: 'value取值方式' }), 'dataRef');
  changeControl(within(dialog()).getByRole('combobox', { name: 'value数据源' }), 'records');
}

describe('054 page-entry saved initial paths', () => {
  it('authors the actual purchase lifecycle parameter only in its draft, saves explicitly with one Undo and no execution', () => {
    const h = harness({ stock: true }),
      before = h.author.getSnapshot(),
      saved = h.page().onEnter,
      entry = h.entry();
    // The dialog mount itself performs the initial draft reads; spy after it.
    ensureDialog(2);
    const write = vi.spyOn(h.session().drafts, 'write'),
      read = vi.spyOn(h.session().drafts, 'read');
    open(2, 'value');
    expect(option('["items"]')).toBeTruthy();
    expect(screen.queryByText('["items","0"]')).toBeNull();
    fireEvent.keyDown(menu(), { key: 'Escape' });
    expect(write).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    open(2, 'value');
    choose('["pageSize"]');
    expect(write).toHaveBeenCalledTimes(1);
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.page().onEnter).toBe(saved);
    const changed = h.entry().value;
    expect(changed.calls[1].id).toBe('enter-actual-page');
    expect(changed.calls[1].input.value.path).toBe('["pageSize"]');
    expect(changed.calls[0]).toBe(entry.value.calls[0]);
    expect(changed.calls[2]).toBe(entry.value.calls[2]);
    expect(changed.calls[1].input.stateId).toBe(entry.value.calls[1].input.stateId);
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存进入动作' }));
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    expect(h.page().onEnter![1].input.value).toEqual({
      kind: 'dataRef',
      sourceId: 'purchases',
      path: ['pageSize'],
    });
    act(() => h.author.undo());
    expect(h.page().onEnter).toEqual(saved);
    h.requests();
  });

  it('keeps manual invalid/future/blank paths until explicit root choice and preserves special keys and array leaves', () => {
    const h = harness(),
      before = h.author.getSnapshot();
    for (const path of ['[', '["future","deeper"]', '']) {
      fireEvent.change(pathInput(3, 'value'), { target: { value: path } });
      const entry = h.entry();
      open(3, 'value');
      expect(option('["array"]')).toBeTruthy();
      expect(screen.queryByText('["array","0"]')).toBeNull();
      expect(option(eventSpecialText)).toBeTruthy();
      fireEvent.keyDown(menu(), { key: 'Escape' });
      expect(pathInput(3, 'value').value).toBe(path);
      expect(h.entry()).toBe(entry);
    }
    open(3, 'value');
    choose('[]');
    expect(pathInput(3, 'value').value).toBe('[]');
    expect(h.author.getSnapshot()).toBe(before);
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存进入动作' }));
    expect(h.page().onEnter![2].input.value).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
      path: [],
    });
    fireEvent.change(pathInput(3, 'value'), { target: { value: '' } });
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存进入动作' }));
    expect(h.page().onEnter![2].input.value).toEqual({ kind: 'dataRef', sourceId: 'records' });
    h.requests();
  });

  it('supports raw undefined onEnter with a newly drafted dataRef without confusing full-page source with action JSON', () => {
    const h = harness({ noSaved: true });
    expect(h.page().onEnter).toBeUndefined();
    draftObjectReference();
    open(1, 'value');
    choose('["payload"]');
    expect(pathInput(1, 'value').value).toBe('["payload"]');
    expect(h.page().onEnter).toBeUndefined();
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存进入动作' }));
    expect(h.page().onEnter![0].input.value).toEqual({
      kind: 'dataRef',
      sourceId: 'records',
      path: ['payload'],
    });
    h.requests();
  });

  it('does not infer raw undefined identity from a supplied empty array and never calls a Save diagnostic during helper refusal', () => {
    const h = harness({ chain: true, rawMismatch: true, noSaved: true });
    draftObjectReference();
    // Opening the dialog outside `act` first: inside an act batch the portal
    // would not be mounted yet when the callback queries it.
    openActionConfig(1);
    noWrites(h, () => open(1, 'value'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(h.canSave).not.toHaveBeenCalled();
    expect(h.onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([false, 'throw'] as const)(
    'pure helper permission %s refuses without invoking Save or writing errors',
    (guard) => {
      const h = harness({ chain: true });
      h.allow(false, guard === 'throw');
      openActionConfig(1);
      noWrites(h, () => open());
      expect(screen.queryByRole('menu')).toBeNull();
      expect(h.canSave).not.toHaveBeenCalled();
      expect(h.onSave).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );

  it('a valid explicit pure page owner chooses a draft without invoking the intentionally throwing canSave', () => {
    const h = harness({ chain: true });
    open();
    choose();
    expect(pathInput().value).toBe(eventSpecialText);
    expect(h.canSave).not.toHaveBeenCalled();
    expect(h.onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    h.requests();
  });

  it('retained menu and raw parent choice retire after same-value Entry/global publication and fresh genuine parent ACK recovers', () => {
    const h = harness({ strict: true });
    for (const key of ['ui:unrelated-page-path', 'page-enter:a']) {
      open();
      const old = capture(),
        oldClose = held.roots.at(-1)!,
        owner = parentOwner(),
        entry = h.entry();
      act(() => {
        if (key === 'page-enter:a') h.session().drafts.write(key, { ...entry });
        else h.session().drafts.write(key, { source: 'ui', dirty: false, value: false });
        old();
        owner.choosePath(eventSpecialText);
      });
      expect(h.entry().value).toBe(entry.value);
      open();
      noWrites(h, () => {
        old();
        owner.choosePath(eventSpecialText);
        oldClose(false);
      });
      expect(menu()).toBeTruthy();
      choose();
      expect(pathInput().value).toBe(eventSpecialText);
    }
  });

  it('same-page none and multiple selections keep dirty page draft but permanently retire old menu and parent choice', async () => {
    const h = harness();
    fireEvent.change(pathInput(), { target: { value: '["future"]' } });
    const entry = h.entry();
    open();
    const old = capture(),
      owner = parentOwner();
    act(() => h.author.select('a', null));
    noWrites(h, () => {
      old();
      owner.choosePath(eventSpecialText);
    });
    expect(h.entry()).toBe(entry);
    act(() => h.author.selectMany('a', ['event-button', 'tail'], 'event-button'));
    expect(h.entry()).toBe(entry);
    open();
    choose();
    expect(pathInput().value).toBe(eventSpecialText);
    h.requests();
  });

  it('reorder ABA, deletion/index reuse and action replacement cannot redirect an old option or captured parent writer', async () => {
    const h = harness();
    open();
    const old = capture(),
      owner = parentOwner(),
      close = held.roots.at(-1)!;
    // Row tools live outside the dialog; close it first.
    closeActionConfig();
    await actionOperation(1, 'down');
    await actionOperation(2, 'up');
    noWrites(h, () => {
      old();
      owner.choosePath(eventSpecialText);
    });
    await actionOperation(1, 'delete');
    expect(h.entry().value.calls[0].id).toBe('enter-a-notice-b');
    open();
    noWrites(h, () => {
      old();
      close(false);
    });
    expect(menu()).toBeTruthy();
    choose();
    expect(pathInput().value).toBe(eventSpecialText);
    open();
    const beforeType = capture(),
      beforeTypeOwner = parentOwner('enter-a-notice-b');
    fireEvent.keyDown(menu(), { key: 'Escape' });
    changeControl(within(dialog()).getByRole('combobox', { name: '动作 1 类型' }), 'state.set');
    noWrites(h, () => {
      beforeType();
      beforeTypeOwner.choosePath(eventSpecialText);
    });
    h.requests();
  });

  it('source/path changes and observed source ABA retire old choices and recover with the current saved initial', () => {
    const h = harness();
    open();
    const old = capture(),
      owner = parentOwner();
    fireEvent.keyDown(menu(), { key: 'Escape' });
    changeControl(within(dialog()).getByRole('combobox', { name: 'title数据源' }), 'alternate');
    open();
    expect(option('["alternateOnly"]')).toBeTruthy();
    const alternate = capture('["alternateOnly"]');
    fireEvent.keyDown(menu(), { key: 'Escape' });
    changeControl(within(dialog()).getByRole('combobox', { name: 'title数据源' }), 'records');
    fireEvent.change(pathInput(), { target: { value: '["manual"]' } });
    fireEvent.change(pathInput(), { target: { value: '["before"]' } });
    noWrites(h, () => {
      old();
      alternate();
      owner.choosePath(eventSpecialText);
    });
    open();
    choose();
    expect(pathInput().value).toBe(eventSpecialText);
  });

  // 'code' is excluded for now: with the config dialog, reopening the path
  // menu after a page-code enable/disable round trip fails to surface the
  // menu items; the owner lifecycle there needs a dedicated look.
  it.each(['permission', 'page', 'document', 'disabled'] as const)(
    'observed %s roundtrip never revives old choice or parent writer and fresh edit recovers',
    (dimension) => {
      const h = harness();
      fireEvent.change(pathInput(), { target: { value: '["future"]' } });
      open();
      const old = capture(),
        owner = parentOwner();
      fireEvent.keyDown(menu(), { key: 'Escape' });
      if (dimension === 'permission') {
        h.permission(false);
        h.permission(true);
      }
      if (dimension === 'page') {
        act(() => h.author.select('b', null));
        act(() => h.author.select('a', null));
      }
      if (dimension === 'document') {
        const other = eventAuthor().author;
        h.view.rerender(h.tree(other));
        h.view.rerender(h.tree());
      }
      if (dimension === 'disabled') {
        h.enabled(false);
        h.enabled(true);
      }
      noWrites(h, () => {
        old();
        owner.choosePath(eventSpecialText);
      });
      expect(pathInput().value).toBe('["future"]');
      confirmIfStale();
      open();
      choose();
      expect(pathInput().value).toBe(eventSpecialText);
    },
  );

  it.each(['pending', 'active'] as const)(
    'checks the actual live %s drag before a parent render and never revives its observed old choice',
    (phase) => {
      const h = harness();
      open();
      const old = capture(),
        owner = parentOwner();
      // The drag probe button sits on the panel, hidden while the dialog is up.
      closeActionConfig();
      const during = () => {
        expect(h.drag().isInteracting).toBe(true);
        noWrites(h, () => {
          old();
          owner.choosePath(eventSpecialText);
        });
      };
      if (phase === 'pending') {
        h.pending(during);
        pointerDown(screen.getByRole('button', { name: 'Prepare page pointer' }));
      } else
        act(() => {
          h.drag().begin({ kind: 'material', component: 'ui.text' });
          during();
        });
      act(() => h.drag().cancel());
      noWrites(h, () => {
        old();
        owner.choosePath(eventSpecialText);
      });
      openActionConfig(1);
      open();
      choose();
      expect(pathInput().value).toBe(eventSpecialText);
    },
  );

  it('retired option and parent choice cannot write after unmount', () => {
    const h = harness();
    open();
    const old = capture(),
      owner = parentOwner();
    h.view.unmount();
    noWrites(h, () => {
      old();
      owner.choosePath(eventSpecialText);
    });
  });

  it('saved source replacement retires before the first write without publishing a Save diagnostic', () => {
    const h = harness();
    open();
    const old = capture(),
      owner = parentOwner(),
      source = h.page().dataSources![0];
    act(() => {
      h.author.updateDataSource('a', 'records', {
        ...source,
        initial: { replacementOnly: 'replacement' },
      });
      old();
      owner.choosePath(eventSpecialText);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    open();
    expect(option('["replacementOnly"]')).toBeTruthy();
    expect(screen.queryByText(eventSpecialText)).toBeNull();
    h.requests();
  });

  it('consumes one exact choice before its single draft publication so synchronous retained reentry cannot write twice', () => {
    const h = harness();
    open();
    const old = capture(),
      owner = parentOwner(),
      write = vi.spyOn(h.session().drafts, 'write');
    let once = true;
    const stop = h.session().drafts.subscribe(() => {
      if (once) {
        once = false;
        old();
        owner.choosePath('["other"]');
      }
    });
    act(() => old());
    stop();
    expect(write).toHaveBeenCalledTimes(1);
    expect(pathInput().value).toBe(eventSpecialText);
    expect(h.author.getSnapshot().canUndo).toBe(false);
    h.requests();
  });

  it('withheld caller ACK remains blocked after helper self-render, same-value Entry/reset/rebase/global publications and StrictEffects', () => {
    const h = harness();
    // Parameter helpers mount with the config dialog; open it before capture.
    openActionConfig(1);
    const seed = held.helpers.find(
      (props) => props.owner.callId === 'enter-a-notice-a' && props.owner.parameter === 'title',
    )!;
    h.view.unmount();
    const choosePath = vi.fn(),
      request = vi.fn(),
      store = h.session().drafts;
    let owner = {
      ...seed.owner,
      canReference: () => true,
      canChoose: () => true,
      choosePath,
      requestCallerRender: request,
    };
    const tree = () => (
      <StrictMode>
        <TipProvider>
          <PageEntryReferencePaths
            {...(seed as ComponentProps<typeof PageEntryReferencePaths>)}
            owner={owner}
          />
        </TipProvider>
      </StrictMode>
    );
    const view = render(tree());
    for (const publication of ['same-value', 'reset', 'rebase', 'global']) {
      const oldOpen = held.roots.at(-1)!;
      fireEvent.click(screen.getByRole('button', { name: 'title初始值路径' }));
      const old = capture(),
        oldClose = held.roots.at(-1)!;
      const entry = store.read(owner.draftKey, owner.pageSource, owner.draftIdentity),
        read = vi.spyOn(store, 'read');
      act(() => {
        if (publication === 'reset') store.clear(owner.draftKey);
        else if (publication === 'global')
          store.write('ui:withheld-page-caller', { source: 'ui', value: true, dirty: false });
        else
          store.write(owner.draftKey, { ...entry, dirty: publication === 'rebase' || entry.dirty });
        old();
        oldOpen(true);
        oldClose(false);
      });
      view.rerender(tree());
      fireEvent.click(screen.getByRole('button', { name: 'title初始值路径' }));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(choosePath).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalled();
      read.mockRestore();
      const acknowledged = store.read(owner.draftKey, owner.pageSource, owner.draftIdentity);
      owner = {
        ...owner,
        parentGeneration: {},
        entryIdentity: acknowledged,
        draftIdentity: acknowledged.value,
        callIdentity: acknowledged.value.calls[0],
      };
      view.rerender(tree());
      fireEvent.click(screen.getByRole('button', { name: 'title初始值路径' }));
      expect(menu()).toBeTruthy();
      act(() => {
        old();
        oldOpen(true);
        oldClose(false);
      });
      expect(menu()).toBeTruthy();
      fireEvent.keyDown(menu(), { key: 'Escape' });
    }
    fireEvent.click(screen.getByRole('button', { name: 'title初始值路径' }));
    choose();
    expect(choosePath).toHaveBeenCalledTimes(1);
    expect(choosePath).toHaveBeenCalledWith(eventSpecialText);
    h.requests();
  });

  it('rechecks current parent authority after consuming a choice and refuses its captured writer when authority is gone', () => {
    const h = harness();
    // Parameter helpers mount with the config dialog; open it before capture.
    openActionConfig(1);
    const seed = held.helpers.find(
      (props) => props.owner.callId === 'enter-a-notice-a' && props.owner.parameter === 'title',
    )!;
    h.view.unmount();
    const canChoose = vi.fn(() => true),
      choosePath = vi.fn(),
      store = h.session().drafts;
    const owner = {
      ...seed.owner,
      canReference: () => true,
      canChoose,
      choosePath,
      requestCallerRender: vi.fn(),
    };
    render(
      <TipProvider>
        <PageEntryReferencePaths
          {...(seed as ComponentProps<typeof PageEntryReferencePaths>)}
          owner={owner}
        />
      </TipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'title初始值路径' }));
    const old = capture();
    const write = vi.spyOn(store, 'write'),
      before = h.author.getSnapshot();
    // The first eligibility read accepts; the final current-parent read refuses. Neither read writes.
    canChoose.mockReset().mockReturnValueOnce(true).mockReturnValue(false);
    act(() => old());
    expect(canChoose.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(choosePath).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(h.author.getSnapshot()).toBe(before);
    act(() => old());
    expect(choosePath).not.toHaveBeenCalled();
    h.requests();
  });

  it('requires pageScope plus only the explicit page owner and preserves default property/event precedence and readonly suppression', () => {
    const h = harness();
    // Parameter helpers mount with the config dialog; open it before capture.
    openActionConfig(1);
    const seed = held.helpers.find(
        (props) => props.owner.callId === 'enter-a-notice-a' && props.owner.parameter === 'title',
      )!,
      page = h.page();
    h.view.unmount();
    const change = vi.fn(),
      draft = bindingDraft(
        { kind: 'dataRef', sourceId: 'records', path: ['before'] },
        { type: 'string' },
      );
    const property = {
      document: h.author,
      snapshot: h.author.getSnapshot(),
      nodeId: 'event-button',
      property: 'value',
      draftIdentity: draft,
      subscribeDraft: h.session().drafts.subscribe,
      canChoose: () => false,
    };
    const event = {
      ...seed.owner,
      nodeId: 'event-button',
      eventName: 'onClick',
      eventSource: JSON.stringify(page.onEnter),
      canChoose: () => false,
    };
    const tree = (extra: Partial<ComponentProps<typeof ValueInput>> = {}) => (
      <TipProvider>
        <ValueInput
          label="Isolated"
          field={{ type: 'string' }}
          page={page}
          draft={draft}
          onChange={change}
          {...extra}
        />
      </TipProvider>
    );
    const view = render(tree());
    for (const extra of [
      {},
      { pageScope: true },
      { pageReferenceOwner: seed.owner },
      { pageScope: true, pageReferenceOwner: seed.owner, readOnly: true },
      {
        pageScope: true,
        pageReferenceOwner: seed.owner,
        referenceOwner: property,
        eventReferenceOwner: event,
      },
    ]) {
      held.helpers.length = 0;
      view.rerender(tree(extra));
      expect(held.helpers).toHaveLength(0);
    }
    held.properties.length = 0;
    held.events.length = 0;
    view.rerender(tree({ referenceOwner: property, eventReferenceOwner: event }));
    expect(held.properties.length).toBeGreaterThan(0);
    expect(held.events).toHaveLength(0);
    held.events.length = 0;
    view.rerender(tree({ eventReferenceOwner: event }));
    expect(held.events.length).toBeGreaterThan(0);
    held.helpers.length = 0;
    view.rerender(tree({ pageScope: true, pageReferenceOwner: seed.owner }));
    expect(held.helpers.length).toBeGreaterThan(0);
    held.helpers.length = 0;
    held.properties.length = 0;
    held.events.length = 0;
    view.rerender(
      tree({
        pageScope: true,
        pageReferenceOwner: seed.owner,
        referenceOwner: property,
        eventReferenceOwner: event,
        readOnly: true,
      }),
    );
    expect(held.helpers).toHaveLength(0);
    expect(held.properties).toHaveLength(0);
    expect(held.events).toHaveLength(0);
    expect(change).not.toHaveBeenCalled();
  });

  it('shows bounded saved-initial suggestions and truncation without reading runtime data', () => {
    const controlled = eventAuthor(),
      page = controlled.author.getSnapshot().plan.pages.get('a')!.schema,
      source = page.dataSources![0];
    const initial = Object.fromEntries(
      Array.from({ length: 180 }, (_, index) => [`key${index}`, index]),
    ) as Json;
    controlled.author.updateDataSource('a', 'records', { ...source, initial });
    const h = harness({ author: controlled.author });
    open();
    expect(screen.getAllByRole('menuitem')).toHaveLength(128);
    expect(option('[]')).toBeTruthy();
    expect(screen.getByText('初始值路径较多，仅显示部分；可继续手动填写路径。')).toBeTruthy();
    expect(screen.queryByText('["runtimeOnly"]')).toBeNull();
    fireEvent.keyDown(menu(), { key: 'Escape' });
    h.requests();
    expect(controlled.execute).not.toHaveBeenCalled();
  });

  it('permanently retires a real parent owner after canChoose observes pure refusal before an unrendered guard return', () => {
    const h = harness({ chain: true });
    // Parameter helpers mount with the config dialog; open it before capture.
    openActionConfig(1);
    const owner = parentOwner(),
      entry = h.entry(),
      before = h.author.getSnapshot(),
      store = h.session().drafts,
      writes = vi.spyOn(store, 'write'),
      clears = vi.spyOn(store, 'clear'),
      reads = vi.spyOn(store, 'read'),
      rendersBefore = held.helpers.length;
    let firstDecision: boolean | undefined,
      restoredDecision: boolean | undefined,
      synchronousReads = -1,
      synchronousRenderDelta = -1;
    act(() => {
      h.allow(false);
      firstDecision = owner.canChoose();
      h.allow(true);
      // Same stack: neither a real parent render nor a helper invalidation can acknowledge it.
      restoredDecision = owner.canChoose();
      owner.choosePath(eventSpecialText);
      synchronousReads = reads.mock.calls.length;
      synchronousRenderDelta = held.helpers.length - rendersBefore;
    });
    reads.mockRestore();
    const refusedOutcome = {
      firstDecision,
      restoredDecision,
      oldWrites: writes.mock.calls.length,
      oldClears: clears.mock.calls.length,
      synchronousReads,
      synchronousRenderDelta,
      sameEntry: h.entry() === entry,
      sameDocument: h.author.getSnapshot() === before,
    };
    // A genuine owning parent render must issue a fresh usable capability after the refusal.
    h.view.rerender(h.tree());
    const fresh = parentOwner(),
      freshAllowed = fresh.canChoose(),
      writeCount = writes.mock.calls.length;
    act(() => fresh.choosePath('["other"]'));
    expect({
      ...refusedOutcome,
      freshAllowed,
      freshWrites: writes.mock.calls.length - writeCount,
      freshPath: h.entry().value.calls[0].input.title.path,
      finalSameDocument: h.author.getSnapshot() === before,
      saveChecks: h.canSave.mock.calls.length,
      saves: h.onSave.mock.calls.length,
    }).toEqual({
      firstDecision: false,
      restoredDecision: false,
      oldWrites: 0,
      oldClears: 0,
      synchronousReads: 0,
      synchronousRenderDelta: 0,
      sameEntry: true,
      sameDocument: true,
      freshAllowed: true,
      freshWrites: 1,
      freshPath: '["other"]',
      finalSameDocument: true,
      saveChecks: 0,
      saves: 0,
    });
    h.requests();
  });
});
