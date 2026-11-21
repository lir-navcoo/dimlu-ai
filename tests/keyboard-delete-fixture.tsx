import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type { ApplicationSchema, NodeSchema } from '../packages/schema/types';
import { EditorCanvas, type CanvasMode } from '../src/editor/Canvas';
import { ComponentTree } from '../src/editor/ComponentTree';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorToolbar } from '../src/editor/Editor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';

export const keyEvent = (key = 'Delete', init: KeyboardEventInit = {}) =>
  new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
export function sendDelete(target: Element, key = 'Delete', init: KeyboardEventInit = {}) {
  const event = keyEvent(key, init);
  fireEvent(target, event);
  return event;
}
export const canvasRoot = () => screen.getByLabelText('页面编辑画布');
export const treeRow = (id: string) =>
  screen
    .getAllByRole('button')
    .find(
      (button) =>
        button.classList.contains('tree-select') &&
        button.getAttribute('aria-label')?.endsWith(` ${id}`),
    )!;
export function keyboardSchema(roots?: NodeSchema[]): ApplicationSchema {
  const schema = selectionApplication();
  if (roots) schema.pages[0].children = roots;
  return schema;
}

/** Real Canvas/Tree/Runtime and controls; frozenSnapshot models publication before React receives it. */
export function keyboardHarness(
  options: {
    schema?: ApplicationSchema;
    ids?: string[];
    primary?: string;
    frozenSnapshot?: boolean;
    children?: ReactNode;
  } = {},
) {
  const registry = selectionRegistry();
  const document = new EditorDocument(options.schema ?? keyboardSchema(), registry);
  document.selectMany('a', options.ids ?? ['alpha'], options.primary);
  const initial = document.getSnapshot();
  let session!: ReturnType<typeof useEditorSession>;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let duringPending: (() => void) | undefined;
  const runtimes: PageRuntime[] = [];
  function Probe() {
    drag = useDragDrop()!;
    session = useEditorSession();
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'material', component: 'ui.text' }, event);
          duringPending?.();
        }}
      >
        Prepare material pointer
      </button>
    );
  }
  function Scene({ mode, target }: { mode: CanvasMode; target: EditorDocument }) {
    const live = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const snapshot = options.frozenSnapshot && target === document ? initial : live;
    const runtime = useMemo(() => {
      const next = new PageRuntime(snapshot.plan, snapshot.selection.pageId, {
        designMode: mode === 'edit',
      });
      runtimes.push(next);
      return next;
    }, [snapshot.plan, snapshot.selection.pageId]);
    useEffect(() => () => runtime.dispose(), [runtime]);
    return (
      <DragDropProvider
        document={target}
        snapshot={snapshot}
        enabled={
          mode === 'edit' &&
          !snapshot.plan.pages.get(snapshot.selection.pageId)!.schema.code?.enabled
        }
      >
        <Probe />
        <div className="sidebar-content" aria-label="Keyboard tree scroll">
          <ComponentTree document={target} snapshot={snapshot} />
        </div>
        <div className="canvas-scroll" aria-label="Keyboard canvas scroll">
          <EditorCanvas document={target} snapshot={snapshot} runtime={runtime} mode={mode}>
            {options.children}
          </EditorCanvas>
        </div>
        <EditorToolbar document={target} snapshot={snapshot} authoringAllowed={mode === 'edit'} />
        <input aria-label="Outside editor input" />
        <button>Outside editor button</button>
      </DragDropProvider>
    );
  }
  const tree = (mode: CanvasMode = 'edit', target = document) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene mode={mode} target={target} />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    document,
    registry,
    view,
    tree,
    session: () => session,
    drag: () => drag,
    runtimes,
    duringPending: (callback: () => void) => {
      duringPending = callback;
    },
  };
}
