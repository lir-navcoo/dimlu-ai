import { StrictMode, useCallback, useReducer, useSyncExternalStore } from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { ActionCall, Json, Value } from '../packages/schema/types';
import { ActionChainEditor, ActionPanel } from '../src/editor/ActionPanel';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EventReferencePaths, type EventReferenceOwner } from '../src/editor/EventReferencePaths';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { bindingDraft } from '../src/editor/ValueEditor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';

export const eventSpecialPath = ['first.name', '', 'quote"[]/汉'];
export const eventSpecialText = JSON.stringify(eventSpecialPath);
type EventReferenceCall = EventReferenceOwner['callIdentity'];
const literal = (value: Json): Value => ({ kind: 'literal', value });
const ref = (path: string[]): Value => ({ kind: 'dataRef', sourceId: 'records', path });
export type EventDraft = { calls: (EventReferenceCall & { resultTo: string })[]; error: string };

export function eventAuthor() {
  const schema = selectionApplication();
  schema.dependencies.components['ui.button'] = '1.0.0';
  schema.dependencies.actions['ui.notify'] = '1.0.0';
  schema.dependencies.transports = { 'test.event-reference': '1.0.0' };
  for (const page of schema.pages) {
    page.state.push({ id: 'result', type: 'object', initial: {} });
    page.dataSources = [
      {
        id: 'records',
        kind: 'query',
        transport: 'test.event-reference',
        input: {},
        initial: {
          before: 'Before',
          other: 'Other',
          payload: { enabled: false },
          'first.name': { '': { 'quote"[]/汉': 'Chosen' } },
          array: [{ guessed: 'must not list indices' }],
        },
      },
      {
        id: 'alternate',
        kind: 'query',
        transport: 'test.event-reference',
        input: {},
        initial: { alternateOnly: 'Alternate' },
      },
    ];
    const calls: ActionCall[] = [
      {
        id: `${page.id}-notice-a`,
        action: 'ui.notify',
        input: { title: ref(['before']), tone: literal('info') },
      },
      {
        id: `${page.id}-notice-b`,
        action: 'ui.notify',
        input: { title: ref(['other']), tone: literal('success') },
      },
      {
        id: `${page.id}-object`,
        action: 'state.set',
        input: { stateId: literal('result'), value: ref(['payload']) },
      },
    ];
    page.children.push({
      id: 'event-button',
      component: 'ui.button',
      props: { label: literal('Events') },
      on: { onClick: calls },
    });
    page.onEnter = structuredClone(calls).map((call) => ({ ...call, id: `enter-${call.id}` }));
  }
  const registry = selectionRegistry();
  const execute = vi.fn(() => ({ runtimeOnly: 'not saved' }));
  registry.transports!['test.event-reference'] = {
    version: '1.0.0',
    input: {},
    output: 'object',
    execute,
  };
  const author = new EditorDocument(schema, registry);
  author.select('a', 'event-button');
  return { author, execute };
}
export function savedEventCalls(author: EditorDocument, pageId = 'a') {
  return findNode(author.getSnapshot().plan.pages.get(pageId)!.schema, 'event-button')!.node.on!
    .onClick;
}
export function eventHarness(
  options: { strict?: boolean; lifecycle?: boolean; standalone?: boolean } = {},
) {
  const { author, execute } = eventAuthor();
  let session!: ReturnType<typeof useEditorSession>;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let pending: (() => void) | undefined;
  const standaloneSave = vi.fn();
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
        Prepare event path pointer
      </button>
    );
  }
  function Scene({ enabled }: { enabled: boolean }) {
    const snapshot = useSyncExternalStore(author.subscribe, author.getSnapshot);
    const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
    const node = snapshot.selection.nodeId && findNode(page, snapshot.selection.nodeId)?.node;
    return (
      <DragDropProvider document={author} snapshot={snapshot} enabled={enabled}>
        <Probe />
        {options.lifecycle ? (
          <PageLifecyclePanel document={author} snapshot={snapshot} authoringAllowed={enabled} />
        ) : options.standalone ? (
          <ActionChainEditor
            page={page}
            existing={savedEventCalls(author)}
            draftKey="standalone-event-negative"
            onSave={standaloneSave}
          />
        ) : (
          node && <ActionPanel document={author} snapshot={snapshot} node={node} />
        )}
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
    execute,
    view,
    tree,
    standaloneSave,
    session: () => session,
    drag: () => drag,
    duringPending: (callback: () => void) => {
      pending = callback;
    },
    entry: () =>
      session.drafts.read<EventDraft>(
        'event:a/event-button/onClick',
        JSON.stringify(savedEventCalls(author)),
        { calls: [], error: '' },
      ),
  };
}

/** Parent observation is deliberately withheld; only the helper subscribes to the actual store. */
export function isolatedEventHarness(options: { strict?: boolean } = {}) {
  const { author, execute } = eventAuthor();
  const saved = savedEventCalls(author);
  const source = JSON.stringify(saved);
  const initial: EventDraft = {
    calls: [
      {
        id: saved[0].id,
        action: 'ui.notify',
        input: {
          title: bindingDraft(saved[0].input.title, { type: 'string' }),
        },
        resultTo: '',
      },
    ],
    error: '',
  };
  let session!: ReturnType<typeof useEditorSession>;
  let refresh!: () => void;
  let hold = false;
  let allowed = true;
  let renders = 0;
  const observe = vi.fn();
  const choose = vi.fn();
  function Owner() {
    session = useEditorSession();
    const [, dispatch] = useReducer((value: number) => value + 1, 0);
    refresh = dispatch;
    const requestCallerRender = useCallback(() => {
      observe();
      if (!hold) dispatch();
    }, []);
    renders++;
    const entry = session.drafts.read('event-isolated', source, initial);
    const snapshot = author.getSnapshot();
    const page = snapshot.plan.pages.get('a')!.schema;
    const call = entry.value.calls[0];
    const owner: EventReferenceOwner = {
      document: author,
      snapshot,
      nodeId: 'event-button',
      eventName: 'onClick',
      savedActions: saved,
      draftKey: 'event-isolated',
      eventSource: source,
      entryIdentity: entry,
      draftIdentity: entry.value,
      callIdentity: call,
      index: 0,
      callId: call.id,
      action: call.action,
      parameter: 'title',
      subscribeDraft: session.drafts.subscribe,
      requestCallerRender,
      canChoose: () => allowed,
    };
    return (
      <EventReferencePaths
        owner={owner}
        page={page}
        source={page.dataSources![0]}
        binding={call.input.title}
        onChoose={choose}
        label="独立事件"
      />
    );
  }
  const content = (
    <EditorSessionProvider>
      <TipProvider>
        <Owner />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(options.strict ? <StrictMode>{content}</StrictMode> : content);
  return {
    author,
    execute,
    view,
    choose,
    observe,
    session: () => session,
    entry: () => session.drafts.read('event-isolated', source, initial),
    hold: (next: boolean) => {
      hold = next;
    },
    allow: (next: boolean) => {
      allowed = next;
    },
    acknowledge: () => refresh(),
    renders: () => renders,
  };
}
