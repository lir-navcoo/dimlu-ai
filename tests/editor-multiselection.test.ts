import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import {
  canonicalSelection,
  pageNodeOrder,
  selectedNodeIds,
  topSelectedNodeIds,
} from '../packages/editor/selection';
import { selectionApplication, selectionRegistry, lit } from './multiselection-fixture';

afterEach(() => vi.restoreAllMocks());
const setup = () => {
  const schema = selectionApplication(),
    registry = selectionRegistry();
  return { schema, registry, document: new EditorDocument(schema, registry) };
};
const page = (document: EditorDocument, id = 'a') =>
  document.getSnapshot().plan.pages.get(id)!.schema;
const selection = (document: EditorDocument) => document.getSnapshot().selection;

describe('canonical one-page definition selection', () => {
  it('retains exact old single/empty shape and deeply freezes true multi state', () => {
    const { document } = setup();
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'root' });
    document.selectMany('a', []);
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: null });
    expect(Object.keys(selection(document)).sort()).toEqual(['nodeId', 'pageId']);
    document.selectMany('a', ['alpha', 'alpha']);
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'alpha' });
    expect(selection(document)).not.toHaveProperty('nodeIds');
    document.selectMany('a', ['tail', 'alpha']);
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'alpha',
      nodeIds: ['alpha', 'tail'],
    });
    expect(Object.isFrozen(selection(document))).toBe(true);
    expect(Object.isFrozen(selection(document).nodeIds)).toBe(true);
    const mutable = ['tail', 'alpha'];
    document.selectMany('a', mutable, 'tail');
    mutable.push('shared');
    expect(selectedNodeIds(selection(document))).toEqual(['alpha', 'tail']);
  });
  it('uses structural preorder across nested children and every named slot,independent of click order', () => {
    const { document } = setup(),
      expected = [
        'root',
        'alpha',
        'card',
        'body',
        'header',
        'slot-wrap',
        'slot-leaf',
        'tail',
        'shared',
      ];
    expect(pageNodeOrder(page(document))).toEqual(expected);
    document.selectMany('a', [...expected].reverse());
    expect(selection(document).nodeIds).toEqual(expected);
    expect(selection(document).nodeId).toBe('root');
    document.selectMany('a', ['slot-leaf', 'header', 'alpha'], 'slot-leaf');
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'slot-leaf',
      nodeIds: ['alpha', 'header', 'slot-leaf'],
    });
    const canonical = canonicalSelection(page(document), ['tail', 'header', 'header']);
    expect(canonical).toEqual({ pageId: 'a', nodeId: 'header', nodeIds: ['header', 'tail'] });
  });
  it('keeps ancestor+descendant raw intent but returns top roots through slots in canonical order', () => {
    const { document } = setup(),
      requested = ['slot-leaf', 'tail', 'card', 'alpha', 'header'];
    document.selectMany('a', requested, 'header');
    expect(selection(document).nodeIds).toEqual(['alpha', 'card', 'header', 'slot-leaf', 'tail']);
    expect(topSelectedNodeIds(page(document), requested)).toEqual(['alpha', 'card', 'tail']);
    expect(topSelectedNodeIds(page(document), [...requested].reverse())).toEqual([
      'alpha',
      'card',
      'tail',
    ]);
    expect(topSelectedNodeIds(page(document), ['slot-leaf', 'root', 'tail'])).toEqual([
      'root',
      'tail',
    ]);
  });
  it.each([
    { pageId: 'missing', ids: ['alpha'], primary: undefined },
    { pageId: 'a', ids: ['alpha', 'missing'], primary: undefined },
    { pageId: 'a', ids: ['b-one'], primary: undefined },
    { pageId: 'a', ids: ['alpha', 'tail'], primary: 'card' },
    { pageId: 'a', ids: [], primary: 'alpha' },
    { pageId: 'a', ids: ['alpha'], primary: '' },
  ])('validates whole explicit selection atomically: %j', ({ pageId, ids, primary }) => {
    const { document } = setup();
    document.selectMany('a', ['card', 'tail'], 'tail');
    const before = document.getSnapshot();
    expect(() => document.selectMany(pageId, ids, primary)).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });
  it('toggle makes added item primary,retains a nonremoved primary and falls back to first preorder after primary removal', () => {
    const { document } = setup();
    document.select('a', 'tail');
    document.toggleSelect('a', 'slot-leaf');
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'slot-leaf',
      nodeIds: ['slot-leaf', 'tail'],
    });
    document.toggleSelect('a', 'alpha');
    expect(selection(document).nodeId).toBe('alpha');
    document.toggleSelect('a', 'tail');
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'alpha',
      nodeIds: ['alpha', 'slot-leaf'],
    });
    document.toggleSelect('a', 'alpha');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'slot-leaf' });
    document.toggleSelect('a', 'slot-leaf');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: null });
  });
  it.each([
    { pageId: 'b', id: 'shared' },
    { pageId: 'a', id: 'missing' },
    { pageId: 'missing', id: 'alpha' },
  ])('toggle rejects other page or unknown definition %j atomically', ({ pageId, id }) => {
    const { document } = setup();
    document.selectMany('a', ['alpha', 'tail']);
    const before = document.getSnapshot();
    expect(() => document.toggleSelect(pageId, id)).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });
  it('selection-only publishes preserve plan,revision,change,history and redo;semantic duplicates are exact no-ops', () => {
    const { document } = setup();
    document.setProp('a', 'alpha', 'value', lit('changed'));
    document.undo();
    const before = document.getSnapshot(),
      notify = vi.fn();
    document.subscribe(notify);
    document.selectMany('a', ['tail', 'alpha'], 'tail');
    const after = document.getSnapshot();
    expect(after.plan).toBe(before.plan);
    expect(after.revision).toBe(before.revision);
    expect(after.change).toBe(before.change);
    expect(after.canUndo).toBe(before.canUndo);
    expect(after.canRedo).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    document.selectMany('a', ['alpha', 'tail', 'tail'], 'tail');
    expect(document.getSnapshot()).toBe(after);
    expect(notify).toHaveBeenCalledTimes(1);
    document.select('a', 'tail');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'tail' });
    const single = document.getSnapshot();
    document.select('a', 'tail');
    expect(document.getSnapshot()).toBe(single);
    document.redo();
    expect(findNode(page(document), 'alpha')!.node.props.value).toEqual(lit('changed'));
  });
  it('plain select collapses even the existing primary and page change never carries same-named nodes', () => {
    const { document } = setup();
    document.selectMany('a', ['shared', 'tail'], 'shared');
    document.select('a', 'shared');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'shared' });
    document.selectMany('a', ['shared', 'tail'], 'shared');
    document.selectMany('b', []);
    expect(selection(document)).toEqual({ pageId: 'b', nodeId: null });
    document.selectPage('a');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'root' });
    document.selectMany('a', ['alpha', 'tail']);
    document.selectPage('b');
    expect(selection(document)).toEqual({ pageId: 'b', nodeId: 'b-root' });
  });
  it('removed selected page normalizes to entry empty instead of matching shared IDs', () => {
    const { document, schema } = setup();
    document.selectMany('a', ['shared', 'tail'], 'shared');
    const next = structuredClone(schema);
    next.pages = [next.pages[1]];
    next.entryPageId = 'b';
    document.replace(next);
    expect(selection(document)).toEqual({ pageId: 'b', nodeId: null });
    document.undo();
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'shared',
      nodeIds: ['tail', 'shared'],
    });
  });
  it('normalizes removed IDs and primary after ordinary structural commits and preserves remaining multi intent', () => {
    const { document } = setup();
    document.selectMany('a', ['alpha', 'header', 'tail'], 'header');
    const replacement = JSON.parse(document.exportJson());
    replacement.pages[0].children[0].children = replacement.pages[0].children[0].children.filter(
      (node: { id: string }) => node.id !== 'card',
    );
    document.replace(replacement);
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'alpha',
      nodeIds: ['alpha', 'tail'],
    });
    document.undo();
    expect(selection(document)).toEqual({
      pageId: 'a',
      nodeId: 'header',
      nodeIds: ['alpha', 'header', 'tail'],
    });
  });
  it.each(['insert', 'fragment', 'duplicate', 'paste'] as const)(
    'successful %s explicitly collapses to its new single root',
    (command) => {
      const { document } = setup();
      document.copyNodeToClipboard('a', 'card');
      document.selectMany('a', ['alpha', 'tail']);
      const id =
        command === 'insert'
          ? document.insertNode('a', { component: 'ui.text', props: { value: lit('inserted') } })
          : command === 'fragment'
            ? document.insertFragment('a', { component: 'ui.text', props: { value: 'fragment' } })
            : command === 'duplicate'
              ? document.duplicateNode('a', 'card')
              : document.pasteClipboard('a');
      expect(selection(document)).toEqual({ pageId: 'a', nodeId: id });
      document.undo();
      expect(selection(document)).toEqual({
        pageId: 'a',
        nodeId: 'alpha',
        nodeIds: ['alpha', 'tail'],
      });
    },
  );
});

describe('one-transaction bulk removal', () => {
  it('removes canonical top roots across owners/slots without index shifts and undoes once', () => {
    const { document } = setup(),
      removeOne = vi.spyOn(document, 'removeNode');
    document.selectMany('a', ['slot-leaf', 'alpha', 'header', 'tail'], 'header');
    const before = document.exportJson(),
      oldSelection = selection(document),
      revision = document.getSnapshot().revision;
    expect(document.removeNodes('a', ['tail', 'header', 'alpha', 'slot-leaf', 'header'])).toBe(
      true,
    );
    expect(removeOne).not.toHaveBeenCalled();
    expect(pageNodeOrder(page(document))).toEqual(['root', 'card', 'body', 'slot-wrap', 'shared']);
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: null });
    expect(document.getSnapshot().revision).toBe(revision + 1);
    const removed = document.exportJson();
    document.undo();
    expect(document.exportJson()).toBe(before);
    expect(selection(document)).toEqual(oldSelection);
    expect(document.getSnapshot().canUndo).toBe(false);
    document.redo();
    expect(document.exportJson()).toBe(removed);
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: null });
  });
  it('parent+descendant removes a single complete subtree and leaves independent page data untouched', () => {
    const { document } = setup(),
      before = structuredClone(page(document)),
      deps = document.getSnapshot().plan.schema.dependencies;
    document.selectMany('a', ['card', 'slot-leaf', 'alpha'], 'slot-leaf');
    document.removeNodes('a', ['card', 'slot-leaf']);
    expect(pageNodeOrder(page(document))).toEqual(['root', 'alpha', 'tail', 'shared']);
    const { children: _old, ...oldData } = before,
      { children: _new, ...newData } = page(document);
    expect(newData).toEqual(oldData);
    expect(document.getSnapshot().plan.schema.dependencies).toEqual(deps);
  });
  it.each([
    { pageId: 'a', ids: ['alpha', 'missing'] },
    { pageId: 'missing', ids: [] },
    { pageId: 'a', ids: ['alpha', 'b-one'] },
  ])('rejects all-or-nothing bad target %j with redo preserved', ({ pageId, ids }) => {
    const { document } = setup();
    document.setProp('a', 'alpha', 'value', lit('changed'));
    document.undo();
    document.selectMany('a', ['header', 'tail'], 'tail');
    const before = document.getSnapshot();
    expect(() => document.removeNodes(pageId, ids)).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(document.getSnapshot().canRedo).toBe(true);
  });
  it.each(['a', 'b'])(
    'empty remove on %s does not switch page,clear selection,redo or publish',
    (pageId) => {
      const { document } = setup();
      document.setProp('a', 'alpha', 'value', lit('changed'));
      document.undo();
      document.selectMany('a', ['alpha', 'tail'], 'tail');
      const before = document.getSnapshot(),
        notify = vi.fn();
      document.subscribe(notify);
      expect(document.removeNodes(pageId, [])).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
    },
  );
  it('programmatic noncurrent-page remove switches to target empty;Undo restores actual old-page multi', () => {
    const { document } = setup();
    document.selectMany('a', ['header', 'tail'], 'tail');
    const old = selection(document);
    document.removeNodes('b', ['b-one', 'shared']);
    expect(selection(document)).toEqual({ pageId: 'b', nodeId: null });
    expect(pageNodeOrder(page(document, 'b'))).toEqual(['b-root', 'b-two']);
    document.undo();
    expect(selection(document)).toEqual(old);
    expect(pageNodeOrder(page(document, 'b'))).toEqual(['b-root', 'b-one', 'b-two', 'shared']);
    document.redo();
    expect(selection(document)).toEqual({ pageId: 'b', nodeId: null });
  });
  it('compile rejection leaves all candidates,selection,redo,revision and plan untouched', () => {
    const { document, registry } = setup();
    document.setProp('a', 'alpha', 'value', lit('changed'));
    document.undo();
    document.selectMany('a', ['alpha', 'header']);
    const before = document.getSnapshot(),
      original = registry.components['ui.text'];
    registry.components['ui.text'] = {
      ...original,
      validateProps: () => ['bulk candidate rejected'],
    };
    expect(() => document.removeNodes('a', ['alpha', 'header'])).toThrow();
    expect(document.getSnapshot()).toBe(before);
    registry.components['ui.text'] = original;
    expect(document.removeNodes('a', ['alpha', 'header'])).toBe(true);
  });
  it('single removeNode retains established neighbor/parent behavior rather than bulk-empty selection', () => {
    const { document } = setup();
    document.select('a', 'alpha');
    document.removeNode('a', 'alpha');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'root' });
    document.undo();
    document.select('a', 'tail');
    document.removeNode('a', 'tail');
    expect(selection(document)).toEqual({ pageId: 'a', nodeId: 'shared' });
  });
});
