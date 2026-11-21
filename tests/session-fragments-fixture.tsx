import { useSyncExternalStore } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument, type EditorSnapshot } from '../packages/editor/document';
import { InsertPanel } from '../src/editor/InsertPanel';
import { designPanels } from '../src/editor/panels';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { clipboardUiApplication } from './clipboard-fixture';

export function savedAuthor() {
  const doc = new EditorDocument(clipboardUiApplication(), registry);
  doc.selectMany('source', ['source-text', 'source-card'], 'source-card');
  return doc;
}
export function savedHarness(
  author = savedAuthor(),
  options: { noProps?: boolean; throughRenderer?: boolean; partial?: boolean } = {},
) {
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>,
    session!: ReturnType<typeof useEditorSession>,
    duringPending: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    session = useEditorSession();
    return (
      <>
        <button
          onPointerDown={(event) => {
            drag.begin({ kind: 'material', component: 'ui.text' }, event);
            duringPending?.();
          }}
        >
          Prepare saved pointer
        </button>
        <span data-testid="saved-interaction">{String(drag.isInteracting)}</span>
      </>
    );
  }
  function Scene({
    document,
    allowed,
    enabled,
    visible,
    override,
  }: {
    document: EditorDocument;
    allowed: boolean;
    enabled: boolean;
    visible: boolean;
    override?: EditorSnapshot;
  }) {
    const live = useSyncExternalStore(document.subscribe, document.getSnapshot),
      snapshot = override ?? live;
    const panel = options.noProps ? (
      <InsertPanel />
    ) : options.partial ? (
      <InsertPanel document={document} />
    ) : options.throughRenderer ? (
      <InsertPanel document={document} snapshot={snapshot} authoringAllowed={allowed} />
    ) : (
      <InsertPanel document={document} snapshot={snapshot} authoringAllowed={allowed} />
    );
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={enabled}>
        <Probe />
        <div className="sidebar-content" aria-label="Saved independent sidebar">
          {visible && panel}
        </div>
        <input aria-label="Saved external input" defaultValue="native" />
        <textarea aria-label="Saved external code" defaultValue="const dirty = 1;" />
      </DragDropProvider>
    );
  }
  const tree = (
    document = author,
    allowed = true,
    enabled = true,
    visible = true,
    override?: EditorSnapshot,
  ) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene
          document={document}
          allowed={allowed}
          enabled={enabled}
          visible={visible}
          override={override}
        />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    author,
    view,
    tree,
    drag: () => drag,
    session: () => session,
    duringPending: (callback: () => void) => {
      duringPending = callback;
    },
  };
}
export const savedInput = () =>
  screen.getByRole('textbox', { name: /片段名称/ }) as HTMLInputElement;
export const savedSave = () => screen.getByRole('button', { name: '保存所选' });
export function savedRow(name: string) {
  return screen.getByText(name, { exact: true }).closest<HTMLElement>('.fragment-row')!;
}
export function savedAction(name: string, action: 'insert' | 'remove') {
  return within(savedRow(name)).getByRole('button', {
    name: action === 'insert' ? /插入/ : /删除/,
  });
}
export function savedType(value: string) {
  fireEvent.change(savedInput(), { target: { value } });
}
export function savedPointer() {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 12,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
