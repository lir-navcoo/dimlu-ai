import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { ComponentTree } from '../src/editor/ComponentTree';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorCanvas } from '../src/editor/Canvas';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { Dialog } from '@base-ui/react/dialog';
import {
  lit,
  selectionApplication,
  selectionRegistry,
  selectionText,
} from './multiselection-fixture';

export const treeOrder = [
  'root',
  'alpha',
  'card',
  'body',
  'header',
  'slot-wrap',
  'slot-leaf',
  'tail',
  'shared',
  'empty',
  'inactive',
  'repeated',
];
export function treeSchema() {
  const schema = selectionApplication();
  schema.pages[0].children.push(
    { id: 'empty', component: 'ui.layout', props: {} },
    { ...selectionText('inactive', 'Condition definition'), when: lit(false) },
    {
      ...selectionText('repeated', 'Repeated business'),
      repeat: {
        items: lit([{ id: 'one' }, { id: 'two' }]),
        item: 'item',
        key: { kind: 'expression', language: 'javascript', source: 'scope.item.id' },
      },
    },
  );
  return schema;
}
export function treeAuthor() {
  const author = new EditorDocument(treeSchema(), selectionRegistry());
  author.select('a', 'alpha');
  return author;
}
export const treeRow = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-editor-tree-node="${id}"] > .tree-select`)!;
export const treeRows = () =>
  [...document.querySelectorAll<HTMLElement>('[data-editor-tree-node]')].map(
    (row) => row.dataset.editorTreeNode,
  );
export const treeHost = () => screen.getByRole('region', { name: '组件树' });
export const treeSearch = () =>
  screen.getByRole('textbox', { name: '搜索组件树' }) as HTMLInputElement;
export const pressTree = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  fireEvent(target, event);
  return event;
};
export const treeRuntimes: PageRuntime[] = [];
export function treeHarness(
  options: {
    author?: EditorDocument;
    frozen?: boolean;
    canvas?: boolean;
    outerDialog?: boolean;
  } = {},
) {
  const author = options.author ?? treeAuthor(),
    initial = author.getSnapshot();
  let session!: ReturnType<typeof useEditorSession>,
    drag!: NonNullable<ReturnType<typeof useDragDrop>>,
    runtime!: PageRuntime;
  let pending: (() => void) | undefined;
  function Probe() {
    session = useEditorSession();
    drag = useDragDrop()!;
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'material', component: 'ui.text' }, event);
          pending?.();
        }}
      >
        Prepare tree pointer
      </button>
    );
  }
  function Scene({
    target,
    enabled,
    visible,
  }: {
    target: EditorDocument;
    enabled: boolean;
    visible: boolean;
  }) {
    const live = useSyncExternalStore(target.subscribe, target.getSnapshot),
      snapshot = options.frozen && target === author ? initial : live;
    const current = useMemo(() => {
      const next = new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true });
      treeRuntimes.push(next);
      return next;
    }, [snapshot.plan, snapshot.selection.pageId]);
    runtime = current;
    useEffect(() => () => current.dispose(), [current]);
    return (
      <DragDropProvider
        document={target}
        snapshot={snapshot}
        enabled={
          enabled && !snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled
        }
      >
        <Probe />
        <div className="sidebar-content" aria-label="Independent tree scroll">
          {visible && <ComponentTree document={target} snapshot={snapshot} />}
        </div>
        {options.canvas && (
          <div className="canvas-scroll" aria-label="Independent canvas scroll">
            <EditorCanvas document={target} snapshot={snapshot} runtime={current} mode="edit" />
          </div>
        )}
        <input aria-label="Independent external input" />
        <button>Independent external button</button>
      </DragDropProvider>
    );
  }
  const tree = (target = author, enabled = true, visible = true) => (
    <EditorSessionProvider>
      <TipProvider>
        {options.outerDialog ? (
          <Dialog.Root open modal={false}>
            <Dialog.Portal>
              <Dialog.Popup id="left-panel" className="side-drawer left" initialFocus={false}>
                <Dialog.Title>Independent responsive structure</Dialog.Title>
                <Scene target={target} enabled={enabled} visible={visible} />
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        ) : (
          <Scene target={target} enabled={enabled} visible={visible} />
        )}
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    author,
    initial,
    view,
    tree,
    session: () => session,
    drag: () => drag,
    runtime: () => runtime,
    duringPending: (callback: () => void) => {
      pending = callback;
    },
  };
}
export const treePointer = () => {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
};
