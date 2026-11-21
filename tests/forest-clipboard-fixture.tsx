import { useSyncExternalStore } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '@base-ui/react/menu';
import { EditorDocument } from '../packages/editor/document';
import { ClipboardMenuGroup } from '../src/editor/ClipboardMenu';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { clipboardUiApplication } from './clipboard-fixture';

export const forestCopy = '复制组件到剪贴板',
  forestPaste = '粘贴组件到页面末尾';
export function forestAuthor() {
  const doc = new EditorDocument(clipboardUiApplication(), registry);
  doc.selectMany('source', ['source-card', 'source-text'], 'source-card');
  return doc;
}
export function forestHarness(author = forestAuthor()) {
  const feedback: {
    message: string;
    error: boolean;
    document: EditorDocument;
    allowed: boolean;
  }[] = [];
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>, duringPending: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    return (
      <>
        <button
          onPointerDown={(event) => {
            drag.begin({ kind: 'material', component: 'ui.text' }, event);
            duringPending?.();
          }}
        >
          Prepare forest pointer
        </button>
        <output data-testid="forest-interaction">{String(drag.isInteracting)}</output>
      </>
    );
  }
  function Scene({
    document,
    allowed,
    enabled,
  }: {
    document: EditorDocument;
    allowed: boolean;
    enabled: boolean;
  }) {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    return (
      <DragDropProvider document={document} snapshot={snapshot} enabled={enabled}>
        <Probe />
        <Menu.Root>
          <Menu.Trigger>文件菜单</Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup>
                <ClipboardMenuGroup
                  document={document}
                  snapshot={snapshot}
                  authoringAllowed={allowed}
                  onFeedback={(message, error) =>
                    feedback.push({ message, error, document, allowed })
                  }
                />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        <input aria-label="Forest native input" defaultValue="native input draft" />
        <textarea aria-label="Forest native code" defaultValue="const dirty = 1;" />
      </DragDropProvider>
    );
  }
  const tree = (document = author, allowed = true, enabled = true) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene document={document} allowed={allowed} enabled={enabled} />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    author,
    feedback,
    view,
    tree,
    drag: () => drag,
    duringPending: (callback: () => void) => {
      duringPending = callback;
    },
  };
}
export async function forestItem(name: string) {
  if (!screen.queryByRole('menu'))
    fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
  return screen.findByRole('menuitem', { name });
}
export function forestPointer() {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 12,
    clientY: 14,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
