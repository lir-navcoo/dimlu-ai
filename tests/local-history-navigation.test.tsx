import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { EditorNavigation } from '../src/editor/navigation';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { keyboardSchema } from './keyboard-delete-fixture';
import { lit, selectionRegistry } from './multiselection-fixture';

const navigations: EditorNavigation[] = [];
const owned: HTMLElement[] = [];
afterEach(() => {
  cleanup();
  navigations.forEach((navigation) => navigation.resetKeyboardInteraction());
  navigations.length = 0;
  owned.forEach((element) => element.remove());
  owned.length = 0;
  vi.restoreAllMocks();
});
function fixture() {
  const author = new EditorDocument(keyboardSchema(), selectionRegistry());
  author.selectMany('a', ['alpha', 'tail'], 'alpha');
  const navigation = new EditorNavigation();
  navigations.push(navigation);
  const origin = document.createElement('button');
  const replacement = document.createElement('button');
  const outside = document.createElement('input');
  document.body.append(origin, replacement, outside);
  owned.push(origin, replacement, outside);
  origin.focus();
  const snapshot = author.getSnapshot();
  const environment = {
    document: author,
    plan: snapshot.plan,
    pageId: 'a',
    enabled: true,
    dragging: false,
  };
  navigation.bind(environment);
  return { author, snapshot, navigation, origin, replacement, outside, environment };
}

describe('one focus intent filters explicit command origin', () => {
  it.each(['history', 'delete'] as const)(
    '%s cannot be restored,consumed or canceled by the other local hook',
    (originKind) => {
      const { author, snapshot, navigation, origin, replacement } = fixture();
      const history = originKind === 'history';
      if (history) navigation.requestHistoryFocus(author, snapshot, 'canvas', origin);
      else navigation.requestDeletionFocus(author, snapshot, 'canvas', origin);
      const focus = vi.spyOn(replacement, 'focus');
      expect(navigation.isKeyboardPresentation(author, snapshot)).toBe(true);
      expect(navigation.isDeletionPresentation(author, snapshot)).toBe(!history);
      if (history) {
        navigation.restoreDeletionFocus(author, snapshot, 'canvas', replacement);
        navigation.cancelDeletionFocus('canvas', author);
        navigation.cancelDeletionFocus();
      } else {
        navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
        navigation.cancelHistoryFocus('canvas', author);
        navigation.cancelHistoryFocus();
      }
      expect(focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(origin);
      if (history) navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
      else navigation.restoreDeletionFocus(author, snapshot, 'canvas', replacement);
      expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      expect(document.activeElement).toBe(replacement);
      navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
      navigation.restoreDeletionFocus(author, snapshot, 'canvas', replacement);
      expect(focus).toHaveBeenCalledOnce();
    },
  );

  it('history-specific cancellation additionally filters domain and document', () => {
    const { author, snapshot, navigation, origin, replacement } = fixture();
    const other = new EditorDocument(keyboardSchema(), selectionRegistry());
    navigation.requestHistoryFocus(author, snapshot, 'canvas', origin);
    navigation.cancelHistoryFocus('tree', author);
    navigation.cancelHistoryFocus('canvas', other);
    navigation.restoreHistoryFocus(author, snapshot, 'tree', replacement);
    expect(document.activeElement).toBe(origin);
    navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
    expect(document.activeElement).toBe(replacement);
  });

  it.each(['resetKeyboardInteraction', 'resetDeletionInteraction'] as const)(
    'full cleanup %s clears history intent and exact presentation marker',
    (method) => {
      const { author, snapshot, navigation, origin, replacement } = fixture();
      navigation.requestHistoryFocus(author, snapshot, 'canvas', origin);
      navigation[method]();
      expect(navigation.isKeyboardPresentation(author, snapshot)).toBe(false);
      const focus = vi.spyOn(replacement, 'focus');
      navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
      expect(focus).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(origin);
    },
  );

  it('later history intent replaces deletion observers rather than creating two pending owners', () => {
    const { author, snapshot, navigation, origin, replacement } = fixture();
    navigation.requestDeletionFocus(author, snapshot, 'canvas', origin);
    navigation.requestHistoryFocus(author, snapshot, 'tree', origin);
    const focus = vi.spyOn(replacement, 'focus');
    navigation.restoreDeletionFocus(author, snapshot, 'canvas', replacement);
    expect(focus).not.toHaveBeenCalled();
    navigation.restoreHistoryFocus(author, snapshot, 'tree', replacement);
    expect(focus).toHaveBeenCalledOnce();
    expect(navigation.isDeletionPresentation(author, snapshot)).toBe(false);
  });
});

describe('history focus only survives the matching unclaimed result', () => {
  it.each([
    'focus',
    'pointer',
    'plan',
    'full-selection',
    'page',
    'document',
    'preview',
    'drag',
  ] as const)('%s invalidates pending result and cannot steal later focus', (kind) => {
    const { author, snapshot, navigation, origin, replacement, outside, environment } = fixture();
    navigation.requestHistoryFocus(author, snapshot, 'canvas', origin);
    if (kind === 'focus') outside.focus();
    else if (kind === 'pointer') fireEvent.pointerDown(outside);
    else if (kind === 'plan') author.setProp('a', 'tail', 'value', lit('Later edit'));
    else if (kind === 'full-selection') author.selectMany('a', ['alpha', 'header'], 'alpha');
    else if (kind === 'page') author.selectPage('b');
    else if (kind === 'document') {
      const next = new EditorDocument(keyboardSchema(), selectionRegistry());
      navigation.bind({ ...environment, document: next, plan: next.getSnapshot().plan });
    } else if (kind === 'preview') navigation.bind({ ...environment, enabled: false });
    else navigation.bind({ ...environment, dragging: true });
    const focus = vi.spyOn(replacement, 'focus');
    navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
    expect(focus).not.toHaveBeenCalled();
    if (kind === 'focus') expect(document.activeElement).toBe(outside);
  });

  it('matching result survives origin DOM removal and restores once to the mounted replacement', () => {
    const { author, snapshot, navigation, origin, replacement } = fixture();
    navigation.requestHistoryFocus(author, snapshot, 'canvas', origin);
    origin.remove();
    expect(document.activeElement).toBe(document.body);
    const focus = vi.spyOn(replacement, 'focus');
    navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
    expect(document.activeElement).toBe(replacement);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('presentation stops matching a later full selection with the same primary and plan', () => {
    const { author, snapshot, navigation, origin } = fixture();
    navigation.requestHistoryFocus(author, snapshot, 'tree', origin);
    author.selectMany('a', ['alpha', 'header'], 'alpha');
    expect(author.getSnapshot().plan).toBe(snapshot.plan);
    expect(author.getSnapshot().selection.nodeId).toBe(snapshot.selection.nodeId);
    expect(navigation.isKeyboardPresentation(author, author.getSnapshot())).toBe(false);
  });

  it('actual whole EditorSessionProvider disposal removes both intent and presentation', () => {
    const { author, snapshot, origin, replacement } = fixture();
    let session!: ReturnType<typeof useEditorSession>;
    function Probe() {
      session = useEditorSession();
      return <div />;
    }
    const view = render(
      <EditorSessionProvider>
        <Probe />
      </EditorSessionProvider>,
    );
    const navigation = session.navigation;
    navigation.requestHistoryFocus(author, snapshot, 'canvas', origin);
    expect(navigation.isKeyboardPresentation(author, snapshot)).toBe(true);
    view.unmount();
    expect(navigation.isKeyboardPresentation(author, snapshot)).toBe(false);
    const focus = vi.spyOn(replacement, 'focus');
    navigation.restoreHistoryFocus(author, snapshot, 'canvas', replacement);
    expect(focus).not.toHaveBeenCalled();
  });
});
