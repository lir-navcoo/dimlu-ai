import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { pageNodeOrder } from '../packages/editor/selection';
import { PageRuntime } from '../packages/runtime/engine';
import { EditorNavigation, type ClipboardPasteReservation } from '../src/editor/navigation';
import { keyboardSchema } from './keyboard-delete-fixture';
import { selectionRegistry } from './multiselection-fixture';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean());
  vi.restoreAllMocks();
});
function fixture(domain: 'tree' | 'canvas' = 'tree') {
  const author = new EditorDocument(keyboardSchema(), selectionRegistry());
  author.selectMany('a', ['alpha', 'tail'], 'alpha');
  author.copyNodesToClipboard('a', ['alpha', 'tail']);
  const initial = author.getSnapshot(),
    clipboard = author.getClipboardSnapshot();
  const navigation = new EditorNavigation();
  navigation.bind({
    document: author,
    plan: initial.plan,
    pageId: 'a',
    enabled: true,
    dragging: false,
  });
  const origin = document.createElement('div');
  origin.tabIndex = 0;
  origin.className = domain === 'tree' ? 'component-tree' : 'editor-canvas edit';
  const target = document.createElement(domain === 'tree' ? 'button' : 'div');
  target.tabIndex = 0;
  target.className = domain === 'tree' ? 'tree-select' : 'editor-canvas edit';
  const row = document.createElement('div');
  const outside = document.createElement('input');
  if (domain === 'tree') {
    row.append(target);
    origin.append(row);
    document.body.append(origin, outside);
  } else document.body.append(origin, target, outside);
  origin.focus();
  const oldRuntime = new PageRuntime(initial.plan, 'a', { designMode: true });
  const closed: string[] = [];
  const reservation: ClipboardPasteReservation = {
    operationOwner: {},
    document: author,
    domain,
    host: origin,
    originFocus: origin,
    initial,
    clipboard,
    rootCount: 2,
    pageTitle: initial.plan.pages.get('a')!.schema.title,
    oldNodeIds: new Set(pageNodeOrder(initial.plan.pages.get('a')!.schema)),
    canvasRuntime: domain === 'canvas' ? oldRuntime : undefined,
    treeQuery: '',
    treeClosed: closed,
    treeContext: domain === 'tree' ? { active: true, query: '', closed, host: origin } : undefined,
    active: true,
    executing: true,
    documents: 0,
    clipboards: 0,
  };
  cleanups.push(() => {
    navigation.resetKeyboardInteraction();
    oldRuntime.dispose();
    origin.remove();
    target.remove();
    outside.remove();
  });
  function execute(early?: () => void) {
    const stopEarly = early ? author.subscribe(early) : () => {};
    const stopDoc = author.subscribe(() => {
      reservation.documents++;
      reservation.candidate = author.getSnapshot();
    });
    const stopClip = author.subscribeClipboard(() => {
      reservation.clipboards++;
    });
    expect(navigation.reserveClipboardPastePresentation(reservation)).toBe(true);
    const ids = author.pasteClipboardNodes('a'),
      snapshot = author.getSnapshot();
    row.dataset.editorTreeNode = snapshot.selection.nodeId!;
    stopEarly();
    stopDoc();
    stopClip();
    return { ids, snapshot };
  }
  const treeContext = { treeQuery: '', treeClosed: closed, treeHost: origin };
  return {
    author,
    navigation,
    initial,
    reservation,
    origin,
    target,
    outside,
    oldRuntime,
    closed,
    execute,
    treeContext,
  };
}

describe('clipboard paste presentation reservation is provisional and atomically consumed', () => {
  it('tentative candidate before its real counter suppresses presentation only; exact handoff publishes one final owner and never replays', () => {
    const h = fixture();
    const publish = vi.fn();
    h.navigation.subscribe(publish);
    const result = h.execute(() => {
      expect(h.reservation.documents).toBe(0);
      expect(h.navigation.isKeyboardPresentation(h.author, h.author.getSnapshot())).toBe(true);
      expect(
        h.navigation.clipboardPasteFocusOwner(h.author, h.author.getSnapshot(), 'tree'),
      ).toBeNull();
      expect(document.activeElement).toBe(h.origin);
      expect(publish).not.toHaveBeenCalled();
    });
    const observeTransfer = vi.fn(() => {
      expect(h.reservation.active).toBe(false);
      expect(h.navigation.isKeyboardPresentation(h.author, result.snapshot)).toBe(true);
      expect(h.navigation.clipboardPasteFocusOwner(h.author, result.snapshot, 'tree')).toBe(
        h.reservation.operationOwner,
      );
    });
    const stop = h.navigation.subscribe(observeTransfer);
    expect(h.navigation.requestClipboardPasteFocus(h.reservation, result)).toBe(true);
    expect(observeTransfer).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();
    stop();
    expect(h.navigation.requestClipboardPasteFocus(h.reservation, result)).toBe(false);
    h.navigation.releaseClipboardPastePresentation(h.reservation.operationOwner);
    expect(h.navigation.clipboardPasteFocusOwner(h.author, result.snapshot, 'tree')).toBe(
      h.reservation.operationOwner,
    );
    const focus = vi.spyOn(h.target, 'focus');
    expect(
      h.navigation.restoreClipboardPasteFocus(
        h.author,
        result.snapshot,
        'tree',
        h.target,
        h.treeContext,
      ),
    ).toBe(h.reservation.operationOwner);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    h.navigation.restoreClipboardPasteFocus(
      h.author,
      result.snapshot,
      'tree',
      h.target,
      h.treeContext,
    );
    expect(focus).toHaveBeenCalledOnce();
  });

  it('released unfinished reservation cannot mint final authority or suppress later candidate', () => {
    const h = fixture();
    const result = h.execute();
    h.navigation.releaseClipboardPastePresentation(h.reservation.operationOwner);
    expect(h.navigation.requestClipboardPasteFocus(h.reservation, result)).toBe(false);
    expect(h.navigation.isKeyboardPresentation(h.author, result.snapshot)).toBe(false);
  });

  it('canvas cannot restore before real original disposal and distinct matching live runtime', () => {
    const h = fixture('canvas');
    const result = h.execute();
    expect(h.navigation.requestClipboardPasteFocus(h.reservation, result)).toBe(true);
    const replacement = new PageRuntime(result.snapshot.plan, 'a', { designMode: true });
    cleanups.push(() => replacement.dispose());
    const focus = vi.spyOn(h.target, 'focus');
    expect(
      h.navigation.restoreClipboardPasteFocus(h.author, result.snapshot, 'canvas', h.target, {
        canvasRuntime: replacement,
      }),
    ).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    h.oldRuntime.dispose();
    h.origin.remove();
    expect(
      h.navigation.restoreClipboardPasteFocus(h.author, result.snapshot, 'canvas', h.target, {
        canvasRuntime: replacement,
      }),
    ).toBe(h.reservation.operationOwner);
    expect(focus).toHaveBeenCalledOnce();
  });

  it.each(['throw', 'silent-failure', 'focus-aba'] as const)(
    'focus %s permanently retires exact marker, supplies no token and never retries',
    (kind) => {
      const h = fixture();
      const result = h.execute();
      h.navigation.requestClipboardPasteFocus(h.reservation, result);
      const realFocus = h.target.focus.bind(h.target);
      const focus = vi.spyOn(h.target, 'focus').mockImplementation(() => {
        if (kind === 'throw') throw new Error('focus refused');
        if (kind === 'focus-aba') {
          realFocus();
          h.outside.focus();
          realFocus();
        }
      });
      expect(
        h.navigation.restoreClipboardPasteFocus(
          h.author,
          result.snapshot,
          'tree',
          h.target,
          h.treeContext,
        ),
      ).toBeNull();
      expect(h.navigation.isKeyboardPresentation(h.author, result.snapshot)).toBe(false);
      expect(h.navigation.clipboardPasteFocusOwner(h.author, result.snapshot, 'tree')).toBeNull();
      h.navigation.restoreClipboardPasteFocus(
        h.author,
        result.snapshot,
        'tree',
        h.target,
        h.treeContext,
      );
      expect(focus).toHaveBeenCalledOnce();
    },
  );

  it.each(['query', 'closed', 'host'] as const)(
    'pending tree %s change retires old owner even when its original context returns',
    (kind) => {
      const h = fixture();
      const result = h.execute();
      h.navigation.requestClipboardPasteFocus(h.reservation, result);
      const context = {
        ...h.treeContext,
        ...(kind === 'query'
          ? { treeQuery: 'new' }
          : kind === 'closed'
            ? { treeClosed: ['root'] }
            : { treeHost: h.target }),
      };
      expect(
        h.navigation.restoreClipboardPasteFocus(
          h.author,
          result.snapshot,
          'tree',
          h.target,
          context,
        ),
      ).toBeNull();
      expect(
        h.navigation.restoreClipboardPasteFocus(
          h.author,
          result.snapshot,
          'tree',
          h.target,
          h.treeContext,
        ),
      ).toBeNull();
      expect(document.activeElement).toBe(h.origin);
      expect(h.navigation.isKeyboardPresentation(h.author, result.snapshot)).toBe(false);
    },
  );

  it('post-restore clipboard publication removes presentation while no old cleanup may erase history/delete', () => {
    const h = fixture();
    const result = h.execute();
    h.navigation.requestClipboardPasteFocus(h.reservation, result);
    h.navigation.restoreClipboardPasteFocus(
      h.author,
      result.snapshot,
      'tree',
      h.target,
      h.treeContext,
    );
    h.author.copyNodesToClipboard('a', ['alpha', 'tail']);
    expect(h.navigation.isKeyboardPresentation(h.author, result.snapshot)).toBe(false);
    h.navigation.requestHistoryFocus(h.author, result.snapshot, 'tree', h.target);
    h.navigation.cancelClipboardPasteFocus(h.reservation.operationOwner, 'tree', h.author);
    h.navigation.releaseClipboardPastePresentation(h.reservation.operationOwner);
    h.navigation.retireClipboardPasteForCommand(h.author, 'tree');
    h.navigation.restoreHistoryFocus(h.author, result.snapshot, 'tree', h.origin);
    expect(document.activeElement).toBe(h.origin);
    h.navigation.requestDeletionFocus(h.author, result.snapshot, 'tree', h.origin);
    h.navigation.cancelClipboardPasteFocus(h.reservation.operationOwner, 'tree', h.author);
    h.navigation.restoreDeletionFocus(h.author, result.snapshot, 'tree', h.target);
    expect(document.activeElement).toBe(h.target);
  });

  it('delete/history/wrong-owner cleanup cannot consume paste; exact command retirement never publishes or changes editor/focus', () => {
    const h = fixture();
    const result = h.execute();
    h.navigation.requestClipboardPasteFocus(h.reservation, result);
    h.navigation.cancelDeletionFocus();
    h.navigation.cancelHistoryFocus();
    h.navigation.cancelClipboardPasteFocus({}, 'tree', h.author);
    h.navigation.cancelClipboardPasteFocus(h.reservation.operationOwner, 'canvas', h.author);
    const other = new EditorDocument(keyboardSchema(), selectionRegistry());
    h.navigation.cancelClipboardPasteFocus(h.reservation.operationOwner, 'tree', other);
    expect(h.navigation.clipboardPasteFocusOwner(h.author, result.snapshot, 'tree')).toBe(
      h.reservation.operationOwner,
    );
    const before = h.author.getSnapshot(),
      clipboard = h.author.getClipboardSnapshot();
    const publish = vi.fn();
    h.navigation.subscribe(publish);
    h.navigation.retireClipboardPasteForCommand(h.author, 'tree');
    expect(publish).not.toHaveBeenCalled();
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.author.getClipboardSnapshot()).toBe(clipboard);
    expect(document.activeElement).toBe(h.origin);
    expect(h.navigation.isKeyboardPresentation(h.author, result.snapshot)).toBe(false);
  });
});
