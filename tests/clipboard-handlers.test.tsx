import { Children, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorToolbar } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { clipboardUiApplication, literal } from './clipboard-fixture';

type Handler = (event?: any) => void;
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
const label = (action: 'copy' | 'paste') =>
  action === 'copy' ? '复制组件到剪贴板' : '粘贴组件到页面末尾';
function setup(hasClipboard = false) {
  const document = new EditorDocument(clipboardUiApplication(), registry);
  if (hasClipboard) document.copyNodeToClipboard('source', 'source-frame');
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>, duringPending: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'node', nodeId: 'source-frame' }, event);
          duringPending?.();
        }}
      >
        Start pending pointer
      </button>
    );
  }
  const tree = (target = document, allowed = true) => (
    <EditorSessionProvider>
      <TipProvider>
        <DragDropProvider document={target} snapshot={target.getSnapshot()} enabled={allowed}>
          <Probe />
          <EditorToolbar
            document={target}
            snapshot={target.getSnapshot()}
            authoringAllowed={allowed}
          />
        </DragDropProvider>
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    document,
    view,
    tree,
    getDrag: () => drag,
    setDuringPending: (handler: () => void) => {
      duringPending = handler;
    },
  };
}
async function capture(action: 'copy' | 'paste') {
  fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
  await screen.findByRole('menuitem', { name: label(action) });
  const handler = retained.get(label(action));
  expect(handler).toBeTypeOf('function');
  return handler!;
}
function pointerDown(target: Element) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

describe('retained real clipboard menu callbacks', () => {
  it.each(
    (['copy', 'paste'] as const).flatMap((action) =>
      [
        'preview',
        'document',
        'unmount',
        'live-plan',
        'page',
        'selection',
        'keyboard-drag',
        'clipboard-replacement',
        'clipboard-clear',
      ].map((change) => ({ action, change })),
    ),
  )('blocks retained $action after $change', async ({ action, change }) => {
    const { document, view, tree, getDrag } = setup(action === 'paste'),
      handler = await capture(action),
      next = new EditorDocument(clipboardUiApplication(), registry);
    if (change === 'preview') view.rerender(tree(document, false));
    else if (change === 'document') view.rerender(tree(next));
    else if (change === 'unmount') view.unmount();
    else if (change === 'live-plan')
      act(() => document.setProp('source', 'source-text', 'value', literal('changed')));
    else if (change === 'page') act(() => document.selectPage('target'));
    else if (change === 'selection') act(() => document.select('source', 'source-text'));
    else if (change === 'keyboard-drag')
      act(() => getDrag().begin({ kind: 'node', nodeId: 'source-frame' }));
    else if (change === 'clipboard-replacement')
      act(() => document.copyNodeToClipboard('source', 'source-text'));
    else act(() => document.clearClipboard());
    const before = document.getSnapshot(),
      clipboard = document.getClipboardSnapshot(),
      nextBefore = next.getSnapshot(),
      nextClipboard = next.getClipboardSnapshot();
    act(() => handler());
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toBe(clipboard);
    expect(next.getSnapshot()).toBe(nextBefore);
    expect(next.getClipboardSnapshot()).toBe(nextClipboard);
  });
  it.each([
    { hasClipboard: false, action: 'copy' as const },
    { hasClipboard: true, action: 'copy' as const },
    { hasClipboard: true, action: 'paste' as const },
  ])(
    'invalidates $action after equal import even if initial clipboard is $hasClipboard',
    async ({ hasClipboard, action }) => {
      const { document } = setup(hasClipboard),
        handler = await capture(action),
        before = document.getSnapshot(),
        oldClipboard = document.getClipboardSnapshot();
      act(() => document.importJson(document.exportJson()));
      expect(document.getSnapshot()).toBe(before);
      const cleared = document.getClipboardSnapshot();
      expect(cleared).not.toBe(oldClipboard);
      expect(cleared.available).toBe(false);
      act(() => handler());
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(cleared);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'preserves retained $action validity after failed import',
    async (action) => {
      const { document } = setup(action === 'paste'),
        handler = await capture(action),
        before = document.getSnapshot(),
        clipboard = document.getClipboardSnapshot();
      expect(() => document.importJson('{')).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(clipboard);
      act(() => handler());
      if (action === 'copy') {
        expect(document.getSnapshot()).toBe(before);
        expect(document.getClipboardSnapshot().available).toBe(true);
      } else
        expect(document.getSnapshot().plan.pages.get('source')!.schema.children).toHaveLength(2);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'blocks retained $action within same event immediately after pending pointer begin',
    async (action) => {
      const { document, setDuringPending, getDrag } = setup(action === 'paste'),
        handler = await capture(action),
        before = document.getSnapshot(),
        clipboard = document.getClipboardSnapshot();
      setDuringPending(() => handler());
      pointerDown(screen.getByRole('button', { name: 'Start pending pointer' }));
      expect(getDrag().isInteracting).toBe(true);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(clipboard);
    },
  );
  it.each(['copy', 'paste'] as const)(
    'does not revive a callback originally captured in preview after edit becomes allowed: %s',
    async (action) => {
      const { document, view, tree } = setup(action === 'paste');
      view.rerender(tree(document, false));
      const handler = await capture(action);
      view.rerender(tree(document, true));
      const before = document.getSnapshot(),
        clipboard = document.getClipboardSnapshot();
      act(() => handler());
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(clipboard);
    },
  );
});
