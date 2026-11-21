import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import type { ApplicationSchema, PageSchema } from '../packages/schema/types';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { PagePanel } from '../src/editor/PagePanel';
import App from '../src/App';
import { EditorSessionProvider } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

type RetainedHandler = (event: any) => void;
const retained = vi.hoisted(() => ({
  menu: new Map<string, RetainedHandler>(),
  submit: undefined as RetainedHandler | undefined,
  pageSwitch: undefined as RetainedHandler | undefined,
}));
vi.mock('@base-ui/react/combobox', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/combobox')>();
  return {
    ...actual,
    Combobox: {
      ...actual.Combobox,
      Root: (props: ComponentProps<typeof actual.Combobox.Root>) => {
        if (props.onValueChange) retained.pageSwitch = props.onValueChange as RetainedHandler;
        return <actual.Combobox.Root {...props} />;
      },
    },
  };
});
vi.mock('@base-ui/react/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/menu')>();
  return {
    ...actual,
    Menu: {
      ...actual.Menu,
      Item: (props: ComponentProps<typeof actual.Menu.Item>) => {
        if (typeof props.children === 'string' && props.onClick)
          retained.menu.set(props.children, props.onClick as RetainedHandler);
        return <actual.Menu.Item {...props} />;
      },
    },
  };
});
vi.mock('@base-ui/react/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/dialog')>();
  const { Children, isValidElement } = await import('react');
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Popup: (props: ComponentProps<typeof actual.Dialog.Popup>) => {
        // Capture the public React form callback while rendering the original popup.
        // Calling it directly models a callback retained after the environment changes.
        Children.forEach(props.children, (child) => {
          if (isValidElement<{ onSubmit?: RetainedHandler }>(child) && child.type === 'form')
            retained.submit = child.props.onSubmit;
        });
        return <actual.Dialog.Popup {...props} />;
      },
    },
  };
});

beforeEach(() => {
  retained.menu.clear();
  retained.submit = undefined;
  retained.pageSwitch = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function application(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'page-handler-acceptance',
    title: '页面保留回调',
    entryPageId: 'a',
    dependencies: { components: { 'ui.text': '1.0.0' }, actions: {} },
    pages: ['a', 'b'].map((id): PageSchema => ({
      id,
      title: id,
      state: [],
      children: [
        {
          id: `${id}-text`,
          component: 'ui.text',
          props: { value: { kind: 'literal', value: id } },
        },
      ],
    })),
  };
}
function setup() {
  const document = new EditorDocument(application(), registry);
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let afterBegin: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'node', nodeId: 'a-text' }, event);
          afterBegin?.();
        }}
      >
        测试同步候选拖拽
      </button>
    );
  }
  const tree = (target = document, allowed = true) => (
    <EditorSessionProvider>
      <TipProvider>
        <DragDropProvider document={target} snapshot={target.getSnapshot()} enabled={allowed}>
          <Probe />
          <PagePanel document={target} snapshot={target.getSnapshot()} authoringAllowed={allowed} />
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
    setAfterBegin: (callback: () => void) => {
      afterBegin = callback;
    },
  };
}
async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: '页面操作 a (a)' }));
  await screen.findByRole('menuitem', { name: '复制页面' });
  const duplicate = retained.menu.get('复制页面')!;
  expect(duplicate).toBeTypeOf('function');
  return duplicate;
}
async function openRename() {
  await openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }));
  await screen.findByRole('dialog', { name: '重命名页面' });
  changeControl(screen.getByLabelText('页面名称'), '保留名称');
  const submit = retained.submit!;
  expect(submit).toBeTypeOf('function');
  return submit;
}
const submitEvent = () => ({ preventDefault: vi.fn() });
function pointerDown(target: HTMLElement) {
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

describe('retained page management callbacks', () => {
  it('blocks the retained actual App quick-switch callback while pointer drag is pending', () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        storageVersion: 1,
        savedAt: 'fixture',
        schema: application(),
        selection: { pageId: 'a', nodeId: 'a-text' },
      }),
    );
    render(<App saveDelayMs={1} />);
    const choose = retained.pageSwitch!;
    expect(choose).toBeTypeOf('function');
    const text = screen.getByText('a', { selector: '[data-editor-node="a-text"] p' });
    pointerDown(text);
    act(() => choose({ value: 'b', label: 'b', title: 'b' }));
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('a');
    fireEvent.keyDown(window, { key: 'Escape' });
    const currentChoose = retained.pageSwitch!;
    act(() => currentChoose({ value: 'b', label: 'b', title: 'b' }));
    expect(screen.getByRole('combobox', { name: '切换页面' }).getAttribute('data-value')).toBe('b');
  });

  it.each(['preview', 'replacement', 'unmount', 'live-plan'] as const)(
    'blocks retained menu mutation after %s',
    async (change) => {
      const { document, view, tree } = setup();
      const duplicate = await openMenu();
      const next = new EditorDocument(application(), registry);
      if (change === 'preview') view.rerender(tree(document, false));
      else if (change === 'replacement') view.rerender(tree(next));
      else if (change === 'unmount') view.unmount();
      else document.renamePage('b', 'live-plan-change');
      const before = document.getSnapshot();
      const nextBefore = next.getSnapshot();
      act(() => duplicate({}));
      expect(document.getSnapshot()).toBe(before);
      expect(next.getSnapshot()).toBe(nextBefore);
    },
  );

  it('blocks a retained menu callback in the same event that begins a pending drag', async () => {
    const { document, getDrag, setAfterBegin } = setup();
    const duplicate = await openMenu();
    const cachedApi = getDrag();
    const before = document.getSnapshot();
    setAfterBegin(() => {
      expect(cachedApi.session).toBeNull();
      expect(cachedApi.isInteracting).toBe(true);
      duplicate({});
    });
    pointerDown(screen.getByText('测试同步候选拖拽'));
    expect(document.getSnapshot()).toBe(before);
    act(() => getDrag().cancel());
  });

  it.each(['preview', 'replacement', 'unmount', 'live-plan'] as const)(
    'blocks retained dialog submit after %s',
    async (change) => {
      const { document, view, tree } = setup();
      const submit = await openRename();
      const next = new EditorDocument(application(), registry);
      if (change === 'preview') view.rerender(tree(document, false));
      else if (change === 'replacement') view.rerender(tree(next));
      else if (change === 'unmount') view.unmount();
      else document.renamePage('b', 'live-plan-change');
      const before = document.getSnapshot();
      const nextBefore = next.getSnapshot();
      act(() => submit(submitEvent()));
      expect(document.getSnapshot()).toBe(before);
      expect(next.getSnapshot()).toBe(nextBefore);
    },
  );

  it('blocks a retained dialog callback during pending drag before any rerender', async () => {
    const { document, getDrag, setAfterBegin } = setup();
    const submit = await openRename();
    const before = document.getSnapshot();
    setAfterBegin(() => {
      expect(getDrag().isInteracting).toBe(true);
      submit(submitEvent());
    });
    pointerDown(screen.getByText('测试同步候选拖拽'));
    expect(document.getSnapshot()).toBe(before);
    act(() => getDrag().cancel());
    act(() => submit(submitEvent()));
    expect(document.getSnapshot()).toBe(before);
  });

  it('does not apply a closed dialog callback to a different newly opened dialog', async () => {
    const { document } = setup();
    const oldSubmit = await openRename();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
    await screen.findByRole('dialog', { name: '新建页面' });
    changeControl(screen.getByLabelText('页面名称'), '新对话框');
    const before = document.getSnapshot();
    act(() => oldSubmit(submitEvent()));
    expect(document.getSnapshot()).toBe(before);
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(document.getSnapshot().plan.schema.pages.at(-1)?.title).toBe('新对话框');
  });
});
