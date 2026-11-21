import { cloneElement, type ComponentProps, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  savedAction,
  savedAuthor,
  savedHarness,
  savedInput,
  savedPointer,
  savedSave,
  savedType,
} from './session-fragments-fixture';
import { literal } from './clipboard-fixture';

type Handler = () => void;
type InputChange = NonNullable<
  ComponentProps<typeof import('../src/ui/primitives').Input>['onChange']
>;
type NameInputEvent = Parameters<InputChange>[0];
const captures = vi.hoisted(() => ({
  sequence: 0,
  buttons: new Map<string, Handler>(),
  inputs: new Map<string, InputChange>(),
  close: [] as ((open: boolean) => void)[],
}));
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Tip: (props: ComponentProps<typeof actual.Tip>) => {
      const child = props.children as ReactElement<Record<string, unknown>>;
      const id = String(++captures.sequence);
      if (typeof child.props.onClick === 'function')
        captures.buttons.set(id, child.props.onClick as Handler);
      return (
        <actual.Tip {...props}>{cloneElement(child, { 'data-validation-source': id })}</actual.Tip>
      );
    },
    Button: (props: ComponentProps<typeof actual.Button>) => {
      const id = String(++captures.sequence);
      if (props.onClick) captures.buttons.set(id, props.onClick as Handler);
      return <actual.Button {...props} data-validation-button={id} />;
    },
    Input: (props: ComponentProps<typeof actual.Input>) => {
      const id = String(++captures.sequence);
      if (props.onChange) captures.inputs.set(id, props.onChange);
      return <actual.Input {...props} data-validation-input={id} />;
    },
  };
});
vi.mock('@base-ui/react/alert-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/alert-dialog')>();
  return {
    ...actual,
    AlertDialog: {
      ...actual.AlertDialog,
      Root: (props: ComponentProps<typeof actual.AlertDialog.Root>) => {
        if (props.onOpenChange) captures.close.push(props.onOpenChange as (open: boolean) => void);
        return <actual.AlertDialog.Root {...props} />;
      },
    },
  };
});
beforeEach(() => {
  captures.sequence = 0;
  captures.buttons.clear();
  captures.inputs.clear();
  captures.close.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
type Action = 'save' | 'insert' | 'remove';
const handler = (element: HTMLElement) =>
  captures.buttons.get(element.dataset.validationSource ?? element.dataset.validationButton!)!;
const call = (callback: Handler) => act(() => callback());
const currentFeedback = () => document.querySelector('.fragment-feedback')?.textContent ?? '';
function next(h: ReturnType<typeof savedHarness>, action: Action): Handler {
  if (action === 'save') return handler(savedSave());
  if (action === 'insert') return handler(savedAction('One', 'insert'));
  fireEvent.click(savedAction('One', 'remove'));
  return handler(within(screen.getByRole('alertdialog')).getByRole('button', { name: '确认删除' }));
}
function setup(action: Action) {
  const author = savedAuthor();
  author.copyNodeToClipboard('source', 'source-text');
  author.saveFragment('source', ['source-text', 'source-card'], 'One');
  const h = savedHarness(author);
  savedType('Draft');
  const old = next(h, action);
  return { ...h, old };
}
function refused(h: ReturnType<typeof setup>, callback: Handler) {
  const before = h.author.getSnapshot(),
    fragments = h.author.getSavedFragmentsSnapshot(),
    clipboard = h.author.getClipboardSnapshot(),
    input = document.querySelector<HTMLInputElement>('.fragment-save input'),
    draft = input?.value,
    feedback = currentFeedback();
  call(callback);
  expect(h.author.getSnapshot()).toBe(before);
  expect(h.author.getSavedFragmentsSnapshot()).toBe(fragments);
  expect(h.author.getClipboardSnapshot()).toBe(clipboard);
  if (input) expect(input.value).toBe(draft);
  expect(currentFeedback()).toBe(feedback);
}
function accepted(h: ReturnType<typeof setup>, callback: Handler, action: Action) {
  const before = h.author.getSnapshot(),
    previous = h.author.getSavedFragmentsSnapshot();
  call(callback);
  expect(screen.getByRole('status').textContent).toContain(
    action === 'save' ? '已保存' : action === 'insert' ? '已插入' : '已删除',
  );
  if (action === 'save') {
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.getSavedFragmentsSnapshot().items).toHaveLength(previous.items.length + 1);
    expect(savedInput().value).toBe('');
  } else if (action === 'insert') {
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    expect(h.author.getSnapshot().selection.nodeIds).toHaveLength(2);
    expect(savedInput().value).toBe('Draft');
  } else {
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.getSavedFragmentsSnapshot().items).toHaveLength(previous.items.length - 1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(savedInput().value).toBe('Draft');
  }
}

describe('saved author callbacks and prompt lifetime never revive after observed authority changes', () => {
  it('code publication roundtrip without any intervening input invocation permanently retires its old input owner', () => {
    const h = setup('save'),
      input = savedInput(),
      old = captures.inputs.get(input.dataset.validationInput!)!;
    const write = vi.spyOn(h.session().drafts, 'write');
    act(() => {
      h.author.setPageCode('source', {
        ...h.author.getSnapshot().plan.pages.get('source')!.schema.code!,
        enabled: true,
      });
      h.author.undo();
      old({ target: { value: 'Old after observed return' } } as NameInputEvent);
    });
    expect(write).not.toHaveBeenCalled();
    expect(savedInput().value).toBe('Draft');
    savedType('Fresh after return');
    expect(savedInput().value).toBe('Fresh after return');
    expect(write).toHaveBeenCalledTimes(1);
  });
  it.each(['pending', 'code'] as const)(
    'retained name input refuses live %s before render, remains expired after return and fresh typing works',
    (kind) => {
      const h = setup('save'),
        input = savedInput(),
        old = captures.inputs.get(input.dataset.validationInput!)!;
      const write = vi.spyOn(h.session().drafts, 'write');
      const send = (text: string) => old({ target: { value: text } } as NameInputEvent);
      let blockedWrites = -1;
      act(() => {
        if (kind === 'pending') {
          h.duringPending(() => {
            expect(h.drag().isInteracting).toBe(true);
            send('Forbidden');
            blockedWrites = write.mock.calls.length;
          });
          fireEvent(screen.getByText('Prepare saved pointer', { exact: true }), savedPointer());
        } else {
          h.author.setPageCode('source', {
            ...h.author.getSnapshot().plan.pages.get('source')!.schema.code!,
            enabled: true,
          });
          expect(h.author.getSnapshot().plan.pages.get('source')!.schema.code?.enabled).toBe(true);
          send('Forbidden');
          blockedWrites = write.mock.calls.length;
        }
      });
      act(() => {
        if (kind === 'pending') h.drag().cancel();
        else h.author.undo();
      });
      const beforeReturn = savedInput().value;
      const writesBeforeReturn = write.mock.calls.length;
      act(() => send('Old after return'));
      const writesAfterOld = write.mock.calls.length;
      const valueAfterOld = savedInput().value;
      savedType('Fresh input');
      expect(blockedWrites).toBe(0);
      expect(beforeReturn).toBe('Draft');
      expect(writesAfterOld).toBe(writesBeforeReturn);
      expect(valueAfterOld).toBe('Draft');
      expect(savedInput().value).toBe('Fresh input');
      expect(write.mock.calls.length).toBe(writesAfterOld + 1);
    },
  );
  it.each(['selection', 'plan'] as const)(
    'ordinary same-page %s publication before render does not discard valid typing',
    (kind) => {
      const h = setup('save'),
        input = savedInput(),
        old = captures.inputs.get(input.dataset.validationInput!)!;
      act(() => {
        if (kind === 'selection') h.author.select('source', 'source-frame');
        else h.author.setProp('source', 'source-text', 'value', literal('ordinary update'));
        old({ target: { value: 'Accepted typing' } } as NameInputEvent);
      });
      expect(savedInput().value).toBe('Accepted typing');
    },
  );
  it.each(
    (['save', 'insert', 'remove'] as const).flatMap((action) =>
      [
        'document-return',
        'preview-return',
        'enabled-return',
        'code-return',
        'plan-undo',
        'rawmulti-return',
        'page-return',
        'fragment-publication',
        'clipboard-publication',
        'rendered-drag-return',
        'unmount',
      ].map((change) => ({ action, change })),
    ),
  )(
    '$action old callback refuses $change while a fresh valid return works',
    ({ action, change }) => {
      const h = setup(action),
        doc = h.author;
      if (change === 'document-return') {
        h.view.rerender(h.tree(savedAuthor()));
        h.view.rerender(h.tree());
      } else if (change === 'preview-return') {
        h.view.rerender(h.tree(doc, false));
        h.view.rerender(h.tree());
      } else if (change === 'enabled-return') {
        h.view.rerender(h.tree(doc, true, false));
        h.view.rerender(h.tree());
      } else if (change === 'code-return')
        act(() => {
          doc.setPageCode('source', {
            ...doc.getSnapshot().plan.pages.get('source')!.schema.code!,
            enabled: true,
          });
          doc.undo();
        });
      else if (change === 'plan-undo')
        act(() => {
          doc.setProp('source', 'source-text', 'value', literal('temp'));
          doc.undo();
        });
      else if (change === 'rawmulti-return')
        act(() => {
          doc.select('source', 'source-card');
          doc.selectMany('source', ['source-text', 'source-card'], 'source-card');
        });
      else if (change === 'page-return')
        act(() => {
          doc.selectPage('target');
          doc.selectMany('source', ['source-text', 'source-card'], 'source-card');
        });
      else if (change === 'fragment-publication')
        act(() => doc.saveFragment('source', ['source-text'], 'Extra'));
      else if (change === 'clipboard-publication')
        act(() => doc.copyNodeToClipboard('source', 'source-text'));
      else if (change === 'unmount') h.view.unmount();
      else {
        act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        expect(screen.getByTestId('saved-interaction').textContent).toBe('true');
        act(() => h.drag().cancel());
      }
      refused(h, h.old);
      if (change === 'unmount') return;
      accepted(h, next(h, action), action);
    },
  );
  it.each(['save', 'insert', 'remove'] as const)(
    'same context render/function identities preserve valid %s',
    (action) => {
      const h = setup(action);
      h.view.rerender(h.tree());
      h.view.rerender(h.tree());
      accepted(h, h.old, action);
    },
  );
  it.each(['save', 'insert', 'remove'] as const)(
    'before-render publication expires %s permanently despite Undo return',
    (action) => {
      const h = setup(action),
        plan = h.author.getSnapshot().plan;
      act(() => {
        h.author.setProp('source', 'source-text', 'value', literal('temp'));
        refused(h, h.old);
        h.author.undo();
        expect(h.author.getSnapshot().plan).toBe(plan);
        refused(h, h.old);
      });
      accepted(h, next(h, action), action);
    },
  );
  it.each(['save', 'insert', 'remove'] as const)(
    'same-event pending %s observes interaction and cannot revive after cancel',
    (action) => {
      const h = setup(action);
      h.duringPending(() => refused(h, h.old));
      fireEvent(screen.getByText('Prepare saved pointer', { exact: true }), savedPointer());
      expect(h.drag().isInteracting).toBe(true);
      act(() => h.drag().cancel());
      refused(h, h.old);
      accepted(h, next(h, action), action);
    },
  );
  it('old save and input captures reject draft text ABA while fresh save accepts the new record', () => {
    const h = setup('save');
    savedType('A');
    const old = handler(savedSave()),
      input = savedInput(),
      edit = captures.inputs.get(input.dataset.validationInput!)!;
    savedType('B');
    savedType('A');
    refused(h, old);
    act(() => edit({ target: { value: 'stale overwrite' } } as NameInputEvent));
    expect(savedInput().value).toBe('A');
    call(handler(savedSave()));
    expect(h.author.getSavedFragmentsSnapshot().items.at(-1)!.name).toBe('A');
    expect(savedInput().value).toBe('');
  });
  it('old Cancel and onOpenChange cannot close a newer confirmation; removed summary cannot be confirmed', () => {
    const h = setup('remove'),
      oldConfirm = h.old,
      oldCancel = handler(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: '取消' }),
      ),
      oldClose = captures.close.at(-1)!;
    call(oldCancel);
    next(h, 'remove');
    call(oldCancel);
    act(() => oldClose(false));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    const id = h.author.getSavedFragmentsSnapshot().items[0].id;
    act(() => h.author.removeSavedFragment(id));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    refused(h, oldConfirm);
    act(() => h.author.saveFragment('source', ['source-text', 'source-card'], 'One'));
    accepted(h, next(h, 'remove'), 'remove');
  });
});

describe('saved-fragment own synchronous operation receipts preserve feedback and draft authority', () => {
  it('remove error belongs only to its exact prompt and cannot leak through Cancel or a new confirmation', () => {
    const h = setup('remove'),
      original = h.old;
    const remove = vi.spyOn(h.author, 'removeSavedFragment').mockImplementation(() => {
      throw new Error('only current prompt');
    });
    call(original);
    const first = screen.getByRole('alertdialog');
    expect(within(first).getByRole('alert').textContent).toContain('only current prompt');
    call(handler(within(first).getByRole('button', { name: '取消' })));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    const fresh = next(h, 'remove');
    expect(within(screen.getByRole('alertdialog')).queryByRole('alert')).toBeNull();
    refused(h, original);
    remove.mockRestore();
    accepted(h, fresh, 'remove');
  });
  it.each(['save', 'insert'] as const)(
    'previous %s error cannot be shown as a new removal prompt error',
    (action) => {
      const h = setup(action);
      if (action === 'save')
        vi.spyOn(h.author, 'saveFragment').mockImplementation(() => {
          throw new Error('prior ordinary error');
        });
      else
        vi.spyOn(h.author, 'insertSavedFragment').mockImplementation(() => {
          throw new Error('prior ordinary error');
        });
      call(h.old);
      expect(screen.getByRole('alert').textContent).toContain('prior ordinary error');
      next(h, 'remove');
      expect(within(screen.getByRole('alertdialog')).queryByRole('alert')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.querySelector<HTMLInputElement>('.fragment-save input')!.value).toBe('Draft');
    },
  );
  it('a removal prompt error cannot reappear after document owner departure and return', () => {
    const h = setup('remove');
    vi.spyOn(h.author, 'removeSavedFragment').mockImplementation(() => {
      throw new Error('old owner error');
    });
    call(h.old);
    expect(screen.getByRole('alert').textContent).toContain('old owner error');
    h.view.rerender(h.tree(savedAuthor()));
    h.view.rerender(h.tree());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    next(h, 'remove');
    expect(within(screen.getByRole('alertdialog')).queryByRole('alert')).toBeNull();
  });
  it.each(['save', 'insert', 'remove'] as const)(
    'own %s gives feedback under synchronous compatible parent render and old capture cannot replay',
    (action) => {
      const h = setup(action);
      let observed = false;
      const listener = () => {
        if (observed) return;
        observed = true;
        flushSync(() => h.view.rerender(h.tree()));
      };
      const stop =
        action === 'insert'
          ? h.author.subscribe(listener)
          : h.author.subscribeSavedFragments(listener);
      accepted(h, h.old, action);
      stop();
      expect(observed).toBe(true);
      refused(h, h.old);
    },
  );
  it.each(
    (['save', 'insert', 'remove'] as const).flatMap((action) =>
      ['document-return', 'preview-return', 'enabled-return', 'unmount'].map((kind) => ({
        action,
        kind,
      })),
    ),
  )('own $action suppresses completion after $kind', ({ action, kind }) => {
    const h = setup(action);
    let observed = false;
    const listener = () => {
      if (observed) return;
      observed = true;
      if (kind === 'document-return') {
        flushSync(() => h.view.rerender(h.tree(savedAuthor())));
        flushSync(() => h.view.rerender(h.tree()));
      } else if (kind === 'preview-return') {
        flushSync(() => h.view.rerender(h.tree(h.author, false)));
        flushSync(() => h.view.rerender(h.tree()));
      } else if (kind === 'enabled-return') {
        flushSync(() => h.view.rerender(h.tree(h.author, true, false)));
        flushSync(() => h.view.rerender(h.tree()));
      } else flushSync(() => h.view.unmount());
    };
    const stop =
      action === 'insert'
        ? h.author.subscribe(listener)
        : h.author.subscribeSavedFragments(listener);
    call(h.old);
    stop();
    expect(observed).toBe(true);
    expect(currentFeedback()).toBe('');
    if (kind !== 'unmount') expect(savedInput().value).toBe('Draft');
  });
  it.each(['save', 'insert', 'remove'] as const)(
    'no-op %s cannot show success or clear draft',
    (action) => {
      const h = setup(action);
      if (action === 'save') vi.spyOn(h.author, 'saveFragment').mockReturnValue('nonexistent');
      else if (action === 'insert') vi.spyOn(h.author, 'insertSavedFragment').mockReturnValue([]);
      else vi.spyOn(h.author, 'removeSavedFragment').mockImplementation(() => undefined);
      refused(h, h.old);
    },
  );
  it.each(['save', 'insert', 'remove'] as const)(
    'unchanged owned %s validation error remains visible and keeps draft/clipboard',
    (action) => {
      const h = setup(action),
        error = new Error('deliberate unchanged refusal'),
        before = h.author.getSnapshot(),
        fragments = h.author.getSavedFragmentsSnapshot(),
        clip = h.author.getClipboardSnapshot();
      if (action === 'save')
        vi.spyOn(h.author, 'saveFragment').mockImplementation(() => {
          throw error;
        });
      else if (action === 'insert')
        vi.spyOn(h.author, 'insertSavedFragment').mockImplementation(() => {
          throw error;
        });
      else
        vi.spyOn(h.author, 'removeSavedFragment').mockImplementation(() => {
          throw error;
        });
      call(h.old);
      expect(screen.getByRole('alert').textContent).toContain('deliberate unchanged refusal');
      expect(h.author.getSnapshot()).toBe(before);
      expect(h.author.getSavedFragmentsSnapshot()).toBe(fragments);
      expect(h.author.getClipboardSnapshot()).toBe(clip);
      expect(document.querySelector<HTMLInputElement>('.fragment-save input')!.value).toBe('Draft');
    },
  );
  it.each(['save', 'insert', 'remove'] as const)(
    'extra foreign clipboard publication during %s suppresses feedback and draft clear',
    (action) => {
      const h = setup(action);
      let observed = false;
      const listener = () => {
        if (observed) return;
        observed = true;
        h.author.copyNodeToClipboard('source', 'source-text');
      };
      const stop =
        action === 'insert'
          ? h.author.subscribe(listener)
          : h.author.subscribeSavedFragments(listener);
      call(h.old);
      stop();
      expect(observed).toBe(true);
      expect(currentFeedback()).toBe('');
      expect(savedInput().value).toBe('Draft');
    },
  );
  it.each(['save', 'insert', 'remove'] as const)(
    'throw after partial %s mutation suppresses misleading error completion',
    (action) => {
      const h = setup(action),
        error = new Error('after mutation');
      if (action === 'save') {
        const original = h.author.saveFragment;
        vi.spyOn(h.author, 'saveFragment').mockImplementation((...args) => {
          original(...args);
          throw error;
        });
      } else if (action === 'insert') {
        const original = h.author.insertSavedFragment;
        vi.spyOn(h.author, 'insertSavedFragment').mockImplementation((...args) => {
          original(...args);
          throw error;
        });
      } else {
        const original = h.author.removeSavedFragment;
        vi.spyOn(h.author, 'removeSavedFragment').mockImplementation((...args) => {
          original(...args);
          throw error;
        });
      }
      call(h.old);
      expect(currentFeedback()).toBe('');
      expect(savedInput().value).toBe('Draft');
    },
  );
});
