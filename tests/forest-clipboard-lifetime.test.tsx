import { Children, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forestAuthor,
  forestCopy,
  forestHarness,
  forestItem,
  forestPaste,
  forestPointer,
} from './forest-clipboard-fixture';
import { literal } from './clipboard-fixture';

type Handler = () => void;
const retained = vi.hoisted(() => new Map<string, Handler>());
vi.mock('@base-ui/react/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/menu')>();
  return {
    ...actual,
    Menu: {
      ...actual.Menu,
      Item: (props: ComponentProps<typeof actual.Menu.Item>) => {
        const label = Children.toArray(props.children)
          .filter((child) => typeof child === 'string')
          .join('')
          .trim();
        if (props.onClick) retained.set(label, props.onClick as Handler);
        return <actual.Menu.Item {...props} />;
      },
    },
  };
});
beforeEach(() => retained.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const label = (action: 'copy' | 'paste') => (action === 'copy' ? forestCopy : forestPaste);
async function setup(action: 'copy' | 'paste') {
  const doc = forestAuthor();
  if (action === 'paste') doc.copyNodesToClipboard('source', ['source-text', 'source-card']);
  const h = forestHarness(doc);
  await forestItem(label(action));
  const old = retained.get(label(action))!;
  expect(old).toBeTypeOf('function');
  return { ...h, old };
}
function call(handler: Handler) {
  act(() => handler());
}
function refused(h: Awaited<ReturnType<typeof setup>>, handler: Handler) {
  const snapshot = h.author.getSnapshot(),
    summary = h.author.getClipboardSnapshot(),
    count = h.feedback.length;
  call(handler);
  expect(h.author.getSnapshot()).toBe(snapshot);
  expect(h.author.getClipboardSnapshot()).toBe(summary);
  expect(h.feedback).toHaveLength(count);
}
function accepted(
  h: Awaited<ReturnType<typeof setup>>,
  handler: Handler,
  action: 'copy' | 'paste',
) {
  const before = h.author.getSnapshot(),
    count = h.feedback.length;
  call(handler);
  expect(h.feedback).toHaveLength(count + 1);
  expect(h.feedback.at(-1)!.error).toBe(false);
  if (action === 'copy') {
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.getClipboardSnapshot().rootCount).toBe(2);
  } else {
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    expect(h.author.getSnapshot().selection.nodeIds).toHaveLength(2);
  }
}

describe('forest menu permanent ordinary callback permission', () => {
  it.each(
    (['copy', 'paste'] as const).flatMap((action) =>
      [
        'document-return',
        'preview-return',
        'enabled-return',
        'code-return',
        'plan-undo',
        'rawmulti-return',
        'page-return',
        'clipboard-replace',
        'clipboard-clear',
        'unmount',
        'rendered-drag-return',
      ].map((change) => ({ action, change })),
    ),
  )(
    'old $action never revives after $change; fresh returned context works',
    async ({ action, change }) => {
      const h = await setup(action),
        doc = h.author;
      if (change === 'document-return') {
        h.view.rerender(h.tree(forestAuthor()));
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
          doc.setProp('source', 'source-text', 'value', literal('temporary'));
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
      else if (change === 'clipboard-replace')
        act(() => doc.copyNodesToClipboard('source', ['source-text', 'source-card']));
      else if (change === 'clipboard-clear') act(() => doc.clearClipboard());
      else if (change === 'unmount') h.view.unmount();
      else {
        act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        expect(screen.getByTestId('forest-interaction').textContent).toBe('true');
        act(() => h.drag().cancel());
      }
      refused(h, h.old);
      if (change === 'unmount') return;
      if (action === 'paste' && change === 'clipboard-clear')
        act(() => doc.copyNodesToClipboard('source', ['source-text', 'source-card']));
      await forestItem(label(action));
      accepted(h, retained.get(label(action))!, action);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'same-context rerender/function feedback identity preserves valid %s',
    async (action) => {
      const h = await setup(action);
      h.view.rerender(h.tree());
      h.view.rerender(h.tree());
      accepted(h, h.old, action);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'live pending %s refusal permanently expires after cancel, fresh invocation works',
    async (action) => {
      const h = await setup(action);
      h.duringPending(() => refused(h, h.old));
      fireEvent(screen.getByRole('button', { name: 'Prepare forest pointer' }), forestPointer());
      expect(h.drag().isInteracting).toBe(true);
      act(() => h.drag().cancel());
      refused(h, h.old);
      await forestItem(label(action));
      accepted(h, retained.get(label(action))!, action);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'publication expires %s before parent React publication and stays expired after Undo',
    async (action) => {
      const h = await setup(action),
        before = h.author.getSnapshot();
      act(() => {
        h.author.setProp('source', 'source-text', 'value', literal('temporary'));
        refused(h, h.old);
        h.author.undo();
        expect(h.author.getSnapshot().plan).toBe(before.plan);
        refused(h, h.old);
      });
      await forestItem(label(action));
      accepted(h, retained.get(label(action))!, action);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'own successful %s emits one feedback and its ordinary callback cannot replay',
    async (action) => {
      const h = await setup(action);
      accepted(h, h.old, action);
      refused(h, h.old);
    },
  );
});

describe('same-stack accepted operation feedback has a separate permanent owner', () => {
  it.each(['copy', 'paste'] as const)(
    'throwing %s after a real mutation suppresses misleading error feedback',
    async (action) => {
      const h = await setup(action);
      if (action === 'copy') {
        const original = h.author.copyNodesToClipboard;
        vi.spyOn(h.author, 'copyNodesToClipboard').mockImplementation((...args) => {
          original(...args);
          throw new Error('after mutation');
        });
      } else {
        const original = h.author.pasteClipboardNodes;
        vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation((...args) => {
          original(...args);
          throw new Error('after mutation');
        });
      }
      call(h.old);
      expect(h.feedback).toHaveLength(0);
    },
  );
  it.each(['empty', 'duplicate', 'reversed'] as const)(
    'paste returned %s roots cannot borrow a valid commit for feedback',
    async (kind) => {
      const h = await setup('paste'),
        original = h.author.pasteClipboardNodes;
      vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation((...args) => {
        const ids = original(...args);
        return kind === 'empty' ? [] : kind === 'duplicate' ? [ids[0], ids[0]] : [...ids].reverse();
      });
      const before = h.author.getSnapshot();
      call(h.old);
      expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
      expect(h.feedback).toHaveLength(0);
    },
  );
  it.each(
    (['copy', 'paste'] as const).flatMap((action) =>
      ['document-return', 'preview-return', 'enabled-return', 'unmount'].map((kind) => ({
        action,
        kind,
      })),
    ),
  )('own $action cannot emit feedback after synchronous $kind', async ({ action, kind }) => {
    const h = await setup(action),
      source = h.author;
    let observed = false;
    const observe = () => {
      if (observed) return;
      observed = true;
      if (kind === 'document-return') {
        flushSync(() => h.view.rerender(h.tree(forestAuthor())));
        flushSync(() => h.view.rerender(h.tree()));
      } else if (kind === 'preview-return') {
        flushSync(() => h.view.rerender(h.tree(source, false)));
        flushSync(() => h.view.rerender(h.tree()));
      } else if (kind === 'enabled-return') {
        flushSync(() => h.view.rerender(h.tree(source, true, false)));
        flushSync(() => h.view.rerender(h.tree()));
      } else flushSync(() => h.view.unmount());
    };
    const stop = action === 'copy' ? source.subscribeClipboard(observe) : source.subscribe(observe);
    call(h.old);
    stop();
    expect(observed).toBe(true);
    expect(h.feedback).toHaveLength(0);
    if (action === 'copy') expect(source.getClipboardSnapshot().rootCount).toBe(2);
    else expect(source.getSnapshot().selection.nodeIds).toHaveLength(2);
    if (kind !== 'unmount') {
      await forestItem(label(action));
      accepted(h, retained.get(label(action))!, action);
    }
  });
  it.each(['copy', 'paste'] as const)(
    'own %s with synchronous compatible parent rerender uses latest feedback once',
    async (action) => {
      const h = await setup(action);
      let observed = false;
      const listener = () => {
        if (observed) return;
        observed = true;
        flushSync(() => h.view.rerender(h.tree()));
      };
      const stop =
        action === 'copy' ? h.author.subscribeClipboard(listener) : h.author.subscribe(listener);
      accepted(h, h.old, action);
      stop();
      expect(observed).toBe(true);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'no-op mocked %s cannot announce false success',
    async (action) => {
      const h = await setup(action);
      if (action === 'copy')
        vi.spyOn(h.author, 'copyNodesToClipboard').mockImplementation(() => undefined);
      else vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation(() => []);
      refused(h, h.old);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'extra reentrant %s publication cannot borrow own feedback',
    async (action) => {
      const h = await setup(action);
      let observed = false;
      const listener = () => {
        if (observed) return;
        observed = true;
        if (action === 'copy') h.author.copyNodeToClipboard('source', 'source-text');
        else {
          const own = h.author.getSnapshot().selection;
          h.author.select('source', 'source-frame');
          h.author.selectMany('source', own.nodeIds!, own.nodeId!);
        }
      };
      const stop =
        action === 'copy' ? h.author.subscribeClipboard(listener) : h.author.subscribe(listener);
      call(h.old);
      stop();
      expect(observed).toBe(true);
      expect(h.feedback).toHaveLength(0);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'legitimate static %s error stays visible without side effects',
    async (action) => {
      const h = await setup(action),
        error = new Error('deliberate static refusal');
      if (action === 'copy')
        vi.spyOn(h.author, 'copyNodesToClipboard').mockImplementation(() => {
          throw error;
        });
      else
        vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation(() => {
          throw error;
        });
      const before = h.author.getSnapshot(),
        summary = h.author.getClipboardSnapshot();
      call(h.old);
      expect(h.author.getSnapshot()).toBe(before);
      expect(h.author.getClipboardSnapshot()).toBe(summary);
      expect(h.feedback).toHaveLength(1);
      expect(h.feedback[0]).toMatchObject({ error: true, message: 'deliberate static refusal' });
    },
  );
  it.each(['copy', 'paste'] as const)(
    'throwing %s after owner return suppresses foreign error feedback',
    async (action) => {
      const h = await setup(action);
      const refuse = () => {
        flushSync(() => h.view.rerender(h.tree(h.author, false)));
        flushSync(() => h.view.rerender(h.tree()));
        throw new Error('stale error');
      };
      if (action === 'copy') vi.spyOn(h.author, 'copyNodesToClipboard').mockImplementation(refuse);
      else vi.spyOn(h.author, 'pasteClipboardNodes').mockImplementation(refuse);
      refused(h, h.old);
    },
  );
});
