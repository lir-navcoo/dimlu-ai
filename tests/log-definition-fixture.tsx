import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, type EditorSnapshot } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type { ApplicationSchema } from '../packages/schema/types';
import { DebugDock } from '../src/editor/DebugDock';
import { ComponentTree } from '../src/editor/ComponentTree';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import type { LogPresentation } from '../src/editor/LogNodeLocator';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';

export const logSchema: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'locator-lifetime',
  title: 'Local',
  entryPageId: 'page',
  dependencies: { components: { 'ui.layout': '1.0.0', 'ui.text': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: 'Page',
      state: [],
      children: [
        {
          id: 'other',
          component: 'ui.text',
          props: { value: { kind: 'literal', value: 'Other' } },
        },
        {
          id: 'root',
          component: 'ui.layout',
          props: {},
          children: [
            {
              id: 'target',
              component: 'ui.text',
              props: { value: { kind: 'literal', value: 'Target' } },
            },
          ],
        },
      ],
    },
    {
      id: 'second',
      title: 'Second',
      state: [],
      children: [
        {
          id: 'target',
          component: 'ui.text',
          props: { value: { kind: 'literal', value: 'Second target' } },
        },
      ],
    },
  ],
};
export function logAuthor() {
  const doc = new EditorDocument(logSchema, registry);
  doc.select('page', 'other');
  return doc;
}
export function logRuntime(doc: EditorDocument, node = 'target') {
  const runtime = new PageRuntime(doc.getSnapshot().plan, doc.getSnapshot().selection.pageId, {
    designMode: true,
  });
  runtime.report('local.info', 'Read me; not an instance address', node);
  return runtime;
}
export function logHarness(doc = logAuthor(), firstRuntime = logRuntime(doc), noContext = false) {
  let session!: ReturnType<typeof useEditorSession>;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let prepareCount = 0,
    releaseCount = 0;
  let duringPrepare: (() => void) | undefined;
  let duringPending: (() => void) | undefined;
  let reopen!: () => void;
  function Probe({
    author,
    snapshot,
    allowed,
    enabled,
  }: {
    author: EditorDocument;
    snapshot: EditorSnapshot;
    allowed: boolean;
    enabled: boolean;
  }) {
    session = useEditorSession();
    drag = useDragDrop()!;
    useLayoutEffect(() => {
      session.navigation.bind({
        document: author,
        plan: snapshot.plan,
        pageId: snapshot.selection.pageId,
        enabled:
          allowed &&
          enabled &&
          !snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled,
        dragging: !!drag?.isInteracting,
      });
    }, [author, snapshot, allowed, enabled, drag?.isInteracting]);
    return (
      <>
        <button
          onPointerDown={(event) => {
            drag.begin({ kind: 'material', component: 'ui.text' }, event);
            duringPending?.();
          }}
        >
          Local pending drag
        </button>
        <input aria-label="Unrelated focus" />
      </>
    );
  }
  function Scene({
    document: author,
    runtime,
    allowed,
    enabled,
    show,
    override,
    holdReady,
    awaitingHost,
  }: {
    document: EditorDocument;
    runtime: PageRuntime;
    allowed: boolean;
    enabled: boolean;
    show: boolean;
    override?: EditorSnapshot;
    holdReady: boolean;
    awaitingHost: boolean;
  }) {
    const live = useSyncExternalStore(author.subscribe, author.getSnapshot);
    const snapshot = override ?? live;
    const [open, setOpen] = useState(true);
    const [presentation, setPresentation] = useState<LogPresentation | null>(null);
    const owner = useRef<LogPresentation | null>(null);
    reopen = () => setOpen(true);
    return (
      <DragDropProvider document={author} snapshot={snapshot} enabled={enabled}>
        <Probe author={author} snapshot={snapshot} allowed={allowed} enabled={enabled} />
        <div id="left-panel">
          <div className="sidebar-content">
            <ComponentTree document={author} snapshot={snapshot} />
          </div>
        </div>
        {show && (
          <DebugDock
            runtime={runtime}
            plan={snapshot.plan}
            document={author}
            open={open}
            setOpen={setOpen}
            mobile={false}
            height={200}
            maxHeight={300}
            setHeight={() => {}}
            {...(!noContext
              ? {
                  authorSnapshot: snapshot,
                  authoringAllowed: allowed,
                  logPresentation: {
                    current: presentation,
                    ready: !holdReady && !!presentation?.active && !open,
                    awaitingHost,
                    read: () => owner.current,
                    prepare: (next: LogPresentation) => {
                      prepareCount++;
                      owner.current = next;
                      setPresentation(next);
                      setOpen(false);
                      session.activatePanel('outline');
                      duringPrepare?.();
                      return next.active && owner.current === next;
                    },
                    release: (next: LogPresentation) => {
                      releaseCount++;
                      if (owner.current !== next) return;
                      next.active = false;
                      owner.current = null;
                      setPresentation(null);
                    },
                  },
                }
              : {})}
          />
        )}
      </DragDropProvider>
    );
  }
  const tree = (
    document = doc,
    runtime = firstRuntime,
    allowed = true,
    enabled = true,
    show = true,
    override?: EditorSnapshot,
    holdReady = false,
    awaitingHost = holdReady,
  ) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene
          document={document}
          runtime={runtime}
          allowed={allowed}
          enabled={enabled}
          show={show}
          override={override}
          holdReady={holdReady}
          awaitingHost={awaitingHost}
        />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
  return {
    doc,
    runtime: firstRuntime,
    view,
    tree,
    session: () => session,
    drag: () => drag,
    prepareCount: () => prepareCount,
    releaseCount: () => releaseCount,
    duringPrepare: (callback: (() => void) | undefined) => {
      duringPrepare = callback;
    },
    duringPending: (callback: (() => void) | undefined) => {
      duringPending = callback;
    },
    reopen: () => act(() => reopen()),
  };
}
export function logButton(node = 'target') {
  const row = [...document.querySelectorAll<HTMLElement>('.logs article')].find((entry) =>
    entry.textContent?.includes(`node · ${node}`),
  );
  if (!row) throw new Error(`Missing log row for ${node}`);
  const button = row.querySelector<HTMLButtonElement>('button');
  if (!button) throw new Error(`Missing locator for ${node}`);
  return button;
}
