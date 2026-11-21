import { useSyncExternalStore } from 'react';
import { render, screen } from '@testing-library/react';
import { EditorDocument, findNode, type EditorSnapshot } from '../packages/editor/document';
import { NodeNameEditor } from '../src/editor/NodeNameEditor';
import { PropertyPanel } from '../src/editor/Editor';
import { ComponentTree } from '../src/editor/ComponentTree';
import { CanvasBreadcrumb } from '../src/editor/CanvasBreadcrumb';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';
export const nameKey = 'dimlu:node-name';
export function nameAuthor(name?: string) {
  const schema = selectionApplication();
  if (name !== undefined) schema.pages[0].children[0].children![0].extensions = { [nameKey]: name };
  const author = new EditorDocument(schema, selectionRegistry());
  author.select('a', 'alpha');
  return author;
}
export const acceptedName = (author: EditorDocument, id = 'alpha', page = 'a') =>
  findNode(author.getSnapshot().plan.pages.get(page)!.schema, id)!.node.extensions?.[nameKey];
export const nameInput = () =>
  screen.getByRole('textbox', { name: '编辑器名称' }) as HTMLInputElement;
export const nameApply = () => screen.getByRole('button', { name: '应用编辑器名称' });
export function nameHarness(
  options: {
    document?: EditorDocument;
    name?: string;
    panel?: boolean;
    display?: boolean;
    frozen?: boolean;
  } = {},
) {
  const author = options.document ?? nameAuthor(options.name);
  const initial = author.getSnapshot();
  let session!: ReturnType<typeof useEditorSession>;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
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
        Prepare name pointer
      </button>
    );
  }
  function Scene({
    target,
    enabled,
    visible,
    snapshotOverride,
  }: {
    target: EditorDocument;
    enabled: boolean;
    visible: boolean;
    snapshotOverride?: EditorSnapshot;
  }) {
    const live = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const snapshot = snapshotOverride ?? (options.frozen && target === author ? initial : live);
    const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
    const node = snapshot.selection.nodeId
      ? findNode(page, snapshot.selection.nodeId)?.node
      : undefined;
    return (
      <DragDropProvider
        document={target}
        snapshot={snapshot}
        enabled={enabled && !page.code?.enabled}
      >
        <Probe />
        {visible &&
          (options.panel ? (
            <PropertyPanel document={target} snapshot={snapshot} />
          ) : (
            node && (
              <NodeNameEditor
                document={target}
                snapshot={snapshot}
                node={node}
                fallback="Legacy fallback"
              />
            )
          ))}
        {options.display && (
          <>
            <ComponentTree document={target} snapshot={snapshot} />
            <CanvasBreadcrumb document={target} snapshot={snapshot} />
          </>
        )}
        <input aria-label="Name external input" />
      </DragDropProvider>
    );
  }
  const tree = (
    target = author,
    enabled = true,
    visible = true,
    snapshotOverride?: EditorSnapshot,
  ) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene
          target={target}
          enabled={enabled}
          visible={visible}
          snapshotOverride={snapshotOverride}
        />
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
    duringPending: (next: () => void) => {
      pending = next;
    },
  };
}
