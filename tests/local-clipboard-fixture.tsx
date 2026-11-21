import {
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { useKeyboardClipboard } from '../src/editor/keyboard-authoring';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { keyboardSchema } from './keyboard-delete-fixture';
import { selectionRegistry } from './multiselection-fixture';

export function pressClipboard(
  target: Element,
  key = 'c',
  init: KeyboardEventInit = { ctrlKey: true },
) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  fireEvent(target, event);
  return event;
}

/** Real hook and real native React route; only capture callbacks to challenge their lifetime. */
export function clipboardCallbackHarness() {
  const author = new EditorDocument(keyboardSchema(), selectionRegistry());
  author.selectMany('a', ['alpha', 'tail'], 'alpha');
  const closed: string[] = [];
  let latest!: ReturnType<typeof useKeyboardClipboard>;
  let session!: ReturnType<typeof useEditorSession>;
  let route: ((event: ReactKeyboardEvent<HTMLDivElement>) => void) | undefined;
  function Scene({
    target,
    enabled,
    query,
    hostKey,
  }: {
    target: EditorDocument;
    enabled: boolean;
    query: string;
    hostKey: string;
  }) {
    const snapshot = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const host = useRef<HTMLDivElement>(null);
    session = useEditorSession();
    latest = useKeyboardClipboard({
      document: target,
      snapshot,
      host,
      domain: 'tree',
      enabled,
      treeQuery: query,
      treeClosed: closed,
    });
    useLayoutEffect(() => {
      session.navigation.bind({
        document: target,
        plan: snapshot.plan,
        pageId: snapshot.selection.pageId,
        enabled,
        dragging: false,
      });
    }, [target, snapshot, enabled]);
    return (
      <>
        <div
          key={hostKey}
          ref={host}
          tabIndex={0}
          role="region"
          aria-label="Clipboard retained tree host"
          onKeyDown={(event) => (route ? route(event) : latest.onKeyDown(event))}
        />
        <input aria-label="Clipboard foreign input" />
        {latest.feedback && (
          <output role={latest.feedback.error ? 'alert' : 'status'}>
            {latest.feedback.message}
          </output>
        )}
      </>
    );
  }
  const tree = (target = author, enabled = true, query = '', hostKey = 'original') => (
    <EditorSessionProvider>
      <Scene target={target} enabled={enabled} query={query} hostKey={hostKey} />
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    author,
    view,
    tree,
    callback: () => latest.onKeyDown,
    feedback: () => latest.feedback,
    session: () => session,
    host: () => screen.getByRole('region', { name: 'Clipboard retained tree host' }),
    route: (next: typeof route) => {
      route = next;
    },
  };
}
