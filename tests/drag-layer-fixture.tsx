import { StrictMode, useSyncExternalStore, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { keyboardSchema } from './keyboard-delete-fixture';
import { selectionRegistry } from './multiselection-fixture';

export function layerHarness(
  options: { strict?: boolean; frozenSnapshot?: boolean; children?: ReactNode } = {},
) {
  const author = new EditorDocument(keyboardSchema(), selectionRegistry());
  author.select('a', 'alpha');
  const initial = author.getSnapshot();
  const root = document.createElement('div');
  root.id = 'root';
  root.style.isolation = 'isolate';
  document.body.append(root);
  let api!: NonNullable<ReturnType<typeof useDragDrop>>;
  let session!: ReturnType<typeof useEditorSession>;
  const logicalClicks: EventTarget[] = [];
  function Probe() {
    api = useDragDrop()!;
    session = useEditorSession();
    return (
      <>
        <button onClick={() => api.begin({ kind: 'node', nodeId: 'alpha' })}>
          Start node keyboard drag
        </button>
        <button onClick={() => api.begin({ kind: 'material', component: 'ui.text' })}>
          Start material keyboard drag
        </button>
        <button
          onPointerDown={(event) => api.begin({ kind: 'material', component: 'ui.text' }, event)}
        >
          Start material pointer
        </button>
        <input aria-label="Layer external draft" />
      </>
    );
  }
  function Scene({ target, enabled }: { target: EditorDocument; enabled: boolean }) {
    const live = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const snapshot = options.frozenSnapshot && target === author ? initial : live;
    return (
      <div aria-label="Logical layer owner" onClick={(event) => logicalClicks.push(event.target)}>
        <DragDropProvider document={target} snapshot={snapshot} enabled={enabled}>
          <Probe />
          {options.children}
        </DragDropProvider>
      </div>
    );
  }
  const tree = (target = author, enabled = true) => {
    const content = (
      <EditorSessionProvider>
        <TipProvider>
          <Scene target={target} enabled={enabled} />
        </TipProvider>
      </EditorSessionProvider>
    );
    return options.strict ? <StrictMode>{content}</StrictMode> : content;
  };
  const view = render(tree(), { container: root });
  return { author, root, view, tree, api: () => api, session: () => session, logicalClicks };
}
export function layerBegin(kind: 'node' | 'material' = 'node') {
  fireEvent.click(screen.getByRole('button', { name: `Start ${kind} keyboard drag` }));
  return screen.getByRole('combobox', { name: '拖放位置' });
}
export function layerPointer(
  type: 'pointerdown' | 'pointermove' | 'pointercancel' | 'pointerup',
  target: Element | Window,
  x = 100,
  y = 200,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}
