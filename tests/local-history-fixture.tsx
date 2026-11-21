import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { fireEvent, render } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorCanvas } from '../src/editor/Canvas';
import { TipProvider } from '../src/ui/primitives';
import { useKeyboardHistory } from '../src/editor/keyboard-authoring';
import { EditorSessionProvider } from '../src/editor/session';
import { keyboardSchema } from './keyboard-delete-fixture';
import { selectionRegistry } from './multiselection-fixture';

export function pressHistory(
  target: Element,
  key = 'z',
  init: KeyboardEventInit = { ctrlKey: true },
) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}

/** A local Canvas, intentionally without either author Provider or a global shortcut. */
export function standaloneHistory() {
  const author = new EditorDocument(keyboardSchema(), selectionRegistry());
  author.select('a', 'alpha');
  function Scene() {
    const snapshot = useSyncExternalStore(author.subscribe, author.getSnapshot);
    const runtime = useMemo(
      () => new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true }),
      [snapshot.plan, snapshot.selection.pageId],
    );
    useEffect(() => () => runtime.dispose(), [runtime]);
    return (
      <TipProvider>
        <div className="canvas-scroll">
          <EditorCanvas document={author} snapshot={snapshot} runtime={runtime} mode="edit" />
        </div>
      </TipProvider>
    );
  }
  return { author, view: render(<Scene />) };
}

/** Captures real hook callbacks, delivered through the same actual native React event route. */
export function historyCallbackHarness() {
  const author = new EditorDocument(keyboardSchema(), selectionRegistry());
  author.select('a', 'alpha');
  let latest!: ReturnType<typeof useKeyboardHistory>;
  let route: ((event: ReactKeyboardEvent<HTMLDivElement>) => void) | undefined;
  function Scene({ target, enabled }: { target: EditorDocument; enabled: boolean }) {
    const snapshot = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const host = useRef<HTMLDivElement>(null);
    latest = useKeyboardHistory({ document: target, snapshot, host, domain: 'canvas', enabled });
    return (
      <div
        ref={host}
        tabIndex={0}
        aria-label="History retained hook host"
        onKeyDown={(event) => {
          if (route) route(event);
          else latest.onKeyDown(event);
        }}
      />
    );
  }
  const tree = (target = author, enabled = true) => (
    <EditorSessionProvider>
      <Scene target={target} enabled={enabled} />
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    author,
    view,
    tree,
    callback: () => latest.onKeyDown,
    route: (next: typeof route) => {
      route = next;
    },
  };
}
