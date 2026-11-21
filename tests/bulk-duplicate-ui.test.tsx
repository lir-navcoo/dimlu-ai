import { type ComponentProps, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PropertyPanel } from '../src/editor/Editor';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { SelectionControls } from '../src/editor/SelectionControls';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { bulkNode, bulkPage, bulkPanel, bulkSetup, bulkTabs } from './bulk-duplicate-fixture';
import { selectionRegistry } from './multiselection-fixture';

const held = vi.hoisted(() => ({ copy: undefined as undefined | (() => void) }));
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      if (props['aria-label'] === '创建所选组件副本' && props.onClick) {
        const handler = props.onClick;
        held.copy = () =>
          handler({
            nativeEvent: new MouseEvent('click'),
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
          } as unknown as Parameters<typeof handler>[0]);
      }
      return <actual.Button {...props} />;
    },
  };
});
beforeEach(() => {
  held.copy = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup(source?: EditorDocument) {
  const document = source ?? bulkSetup().document;
  if (!source) document.selectMany('a', ['alpha', 'tail'], 'alpha');
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let duringPending: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'material', component: 'ui.text' }, event);
          duringPending?.();
        }}
      >
        Pending material
      </button>
    );
  }
  function Host({ target, allowed }: { target: EditorDocument; allowed: boolean }) {
    const snapshot = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
    return (
      <DragDropProvider
        document={target}
        snapshot={snapshot}
        enabled={allowed && !page.code?.enabled}
      >
        <Probe />
        <SelectionControls document={target} snapshot={snapshot} />
        <PropertyPanel document={target} snapshot={snapshot} />
      </DragDropProvider>
    );
  }
  const tree = (target = document, allowed = true) => (
    <EditorSessionProvider>
      <TipProvider>
        <Host target={target} allowed={allowed} />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    document,
    tree,
    view,
    getDrag: () => drag,
    setDuringPending: (handler: () => void) => {
      duringPending = handler;
    },
  };
}

describe('compact bulk copy author action', () => {
  it('copies all roots once,shows new multi/read-only state and supports one actual command Undo/Redo', () => {
    const { document } = setup();
    const before = document.getSnapshot();
    const duplicate = vi.spyOn(document, 'duplicateNodes');
    expect(screen.getByText('已选 2 项')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '创建所选组件副本' }).getAttribute('title'),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建所选组件副本' }));
    expect(duplicate).toHaveBeenCalledExactlyOnceWith('a', ['alpha', 'tail']);
    const copied = duplicate.mock.results[0].value as string[];
    expect(document.getSnapshot().selection.nodeIds).toEqual(copied);
    expect(screen.getByText('已选 2 项，选择一个组件编辑属性。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制选中组件' })).toBeNull();
    act(() => document.undo());
    expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
    expect(document.getSnapshot().selection).toEqual(before.selection);
    act(() => document.redo());
    expect(document.getSnapshot().selection.nodeIds).toEqual(copied);
  });

  it('ancestor-plus-descendant multi creates one copied root and returns to ordinary single inspector', () => {
    const { document } = bulkSetup();
    document.selectMany('a', ['card', 'header'], 'header');
    setup(document);
    expect(screen.getByText('已选 2 项 · 1 个顶层组件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '创建所选组件副本' }));
    const selection = document.getSnapshot().selection;
    expect(selection.nodeIds).toBeUndefined();
    expect(bulkNode(document, selection.nodeId!).component).toBe('ui.card');
    expect(screen.queryByRole('button', { name: '创建所选组件副本' })).toBeNull();
    expect(screen.queryByText(/选择一个组件编辑属性/)).toBeNull();
  });

  it('invalid external Panel displays actionable error while preserving full snapshot and selection', () => {
    const { document } = bulkSetup([
      bulkTabs('owner', [bulkPanel('first', 'a'), bulkPanel('second', 'b')]),
    ]);
    document.selectMany('a', ['first', 'second'], 'first');
    setup(document);
    const before = document.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '创建所选组件副本' }));
    expect(screen.getByRole('alert').textContent).toContain('请复制完整标签页容器');
    expect(document.getSnapshot()).toBe(before);
    expect(bulkPage(document).children).toHaveLength(1);
  });

  it.each(['preview', 'code', 'active-drag'] as const)(
    'disables the actual compact button in %s',
    (change) => {
      const { document, view, tree, getDrag } = setup();
      if (change === 'preview') view.rerender(tree(document, false));
      else if (change === 'code')
        act(() => document.setPageCode('a', { ...bulkPage(document).code!, enabled: true }));
      else act(() => getDrag().begin({ kind: 'material', component: 'ui.text' }));
      expect(
        (screen.getByRole('button', { name: '创建所选组件副本' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    },
  );
});

describe('retained bulk copy callback invocation guards', () => {
  it.each([
    'same-primary-set',
    'preview',
    'document',
    'unmount',
    'plan',
    'page',
    'code',
    'active-drag',
  ] as const)('rejects captured author callback after %s', (change) => {
    const { document, view, tree, getDrag } = setup();
    const old = held.copy!;
    const publish = vi.spyOn(document, 'duplicateNodes');
    expect(old).toBeTypeOf('function');
    if (change === 'same-primary-set')
      act(() => document.selectMany('a', ['alpha', 'header'], 'alpha'));
    else if (change === 'preview') view.rerender(tree(document, false));
    else if (change === 'document')
      view.rerender(tree(new EditorDocument(bulkSetup().schema, selectionRegistry())));
    else if (change === 'unmount') view.unmount();
    else if (change === 'plan') act(() => document.renamePage('b', 'new title'));
    else if (change === 'page') act(() => document.selectPage('b'));
    else if (change === 'code')
      act(() => document.setPageCode('a', { ...bulkPage(document).code!, enabled: true }));
    else act(() => getDrag().begin({ kind: 'material', component: 'ui.text' }));
    const before = document.getSnapshot();
    act(() => old());
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });

  it('same-event selection replacement invalidates old copy before host rerender', () => {
    const { document } = setup();
    const old = held.copy!;
    const publish = vi.spyOn(document, 'duplicateNodes');
    act(() => {
      document.selectMany('a', ['alpha', 'header'], 'alpha');
      const before = document.getSnapshot();
      old();
      expect(document.getSnapshot()).toBe(before);
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('same-event pending pointer getter blocks a retained bulk copy without a rerender', () => {
    const { document, getDrag, setDuringPending } = setup();
    const old = held.copy!;
    const before = document.getSnapshot();
    const publish = vi.spyOn(document, 'duplicateNodes');
    setDuringPending(old);
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(screen.getByRole('button', { name: 'Pending material' }), event);
    expect(getDrag().isInteracting).toBe(true);
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });

  it('old callback cannot revive when multi changes and later returns to the same IDs', () => {
    const { document } = setup();
    const old = held.copy!;
    act(() => document.selectMany('a', ['alpha', 'header'], 'alpha'));
    act(() => document.selectMany('a', ['alpha', 'tail'], 'alpha'));
    const before = document.getSnapshot();
    act(() => old());
    expect(document.getSnapshot()).toBe(before);
  });
});
