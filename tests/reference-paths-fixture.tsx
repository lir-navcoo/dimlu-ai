import { StrictMode, useSyncExternalStore } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { catalog } from '../src/editor/catalog';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { PropertyPanel } from '../src/editor/Editor';
import { ReferencePaths } from '../src/editor/ReferencePaths';
import { bindingDraft } from '../src/editor/ValueEditor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';

export const exactPath = ['first.name', '', 'quote"[]/汉'];
export const pathText = JSON.stringify(exactPath);
export function referenceAuthor() {
  const schema = selectionApplication();
  schema.dependencies.transports = { 'test.reference': '1.0.0' };
  schema.pages[0].dataSources = [
    {
      id: 'people',
      kind: 'query',
      transport: 'test.reference',
      input: {},
      initial: {
        before: 'Before',
        'first.name': { '': { 'quote"[]/汉': 'Chosen' } },
        list: [{ hiddenIndex: true }],
      },
    },
  ];
  schema.pages[0].children.push({
    id: 'bound',
    component: 'ui.text',
    props: { value: { kind: 'dataRef', sourceId: 'people', path: ['before'] } },
  });
  const registry = selectionRegistry();
  const request = vi.fn(() => ({ runtimeOnly: 'not saved' }));
  registry.transports!['test.reference'] = {
    version: '1.0.0',
    input: {},
    output: 'object',
    execute: request,
  };
  const author = new EditorDocument(schema, registry);
  author.select('a', 'bound');
  return { author, request };
}
export function acceptedReference(author: EditorDocument) {
  return findNode(author.getSnapshot().plan.pages.get('a')!.schema, 'bound')!.node.props.value;
}

export function referenceHarness(options: { isolated?: boolean; strict?: boolean } = {}) {
  const { author, request } = referenceAuthor();
  const metadata = structuredClone(catalog);
  metadata['ui.text'].properties = metadata['ui.text'].properties.filter(
    (entry) => entry.name === 'value',
  );
  let session!: ReturnType<typeof useEditorSession>;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let pending: (() => void) | undefined;
  const chosen = vi.fn();
  const isolatedInitial = bindingDraft(acceptedReference(author), { type: 'string' });
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
        Prepare reference pointer
      </button>
    );
  }
  // Deliberately does not subscribe to drafts: helper self-renders cannot ACK this host.
  function Isolated({ enabled }: { enabled: boolean }) {
    const snapshot = author.getSnapshot();
    const page = snapshot.plan.pages.get('a')!.schema;
    const entry = session.drafts.read('reference-owner', 'canonical', isolatedInitial);
    return (
      <ReferencePaths
        label="独立"
        owner={{
          document: author,
          snapshot,
          nodeId: 'bound',
          property: 'value',
          draftIdentity: entry.value,
          subscribeDraft: session.drafts.subscribe,
          canChoose: () => enabled,
        }}
        page={page}
        source={page.dataSources![0]}
        binding={entry.value}
        onChoose={chosen}
      />
    );
  }
  function Scene({ enabled }: { enabled: boolean }) {
    const snapshot = useSyncExternalStore(author.subscribe, author.getSnapshot);
    return (
      <DragDropProvider document={author} snapshot={snapshot} enabled={enabled}>
        <Probe />
        {options.isolated ? (
          <Isolated enabled={enabled} />
        ) : (
          <PropertyPanel document={author} snapshot={snapshot} materialCatalog={metadata} />
        )}
        <input aria-label="Reference external input" />
      </DragDropProvider>
    );
  }
  const tree = (enabled = true) => {
    const content = (
      <EditorSessionProvider>
        <TipProvider>
          <Scene enabled={enabled} />
        </TipProvider>
      </EditorSessionProvider>
    );
    return options.strict ? <StrictMode>{content}</StrictMode> : content;
  };
  const view = render(tree());
  return {
    author,
    request,
    view,
    tree,
    chosen,
    session: () => session,
    drag: () => drag,
    duringPending: (callback: () => void) => {
      pending = callback;
    },
    isolatedEntry: () => session.drafts.read('reference-owner', 'canonical', isolatedInitial),
    propertyEntry: () =>
      session.drafts.read('prop:a/bound/value', JSON.stringify(acceptedReference(author)), {}),
  };
}
