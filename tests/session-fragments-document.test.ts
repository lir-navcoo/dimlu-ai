import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode, type InsertTarget } from '../packages/editor/document';
import {
  normalizeSavedFragmentName,
  SAVED_FRAGMENT_LIMIT,
  SAVED_FRAGMENT_NAME_LIMIT,
} from '../packages/editor/saved-fragments';
import * as engine from '../packages/runtime/engine';
import type { NodeSchema } from '../packages/schema/types';
import { NODE_NAME_EXTENSION } from '../packages/schema/node-name';
import { ProjectStorage, PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import {
  clipboardApplication,
  fixtureRegistry,
  literal,
  nodeIds,
  staticLeaf,
  staticTree,
} from './clipboard-fixture';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function setup(nodes = [staticTree(), staticLeaf('last')]) {
  const registry = fixtureRegistry(),
    schema = clipboardApplication(nodes, registry);
  return { registry, schema, doc: new EditorDocument(schema, registry) };
}
const page = (doc: EditorDocument, id = 'target') => doc.getSnapshot().plan.pages.get(id)!.schema;
const node = (doc: EditorDocument, id: string, pageId = 'target') =>
  findNode(page(doc, pageId), id)!.node;
const strip = (root: NodeSchema): unknown => ({
  ...root,
  id: '',
  ...(root.children && { children: root.children.map(strip) }),
  ...(root.slots && {
    slots: Object.fromEntries(
      Object.entries(root.slots).map(([name, slot]) => [
        name,
        { ...slot, children: slot.children.map(strip) },
      ]),
    ),
  }),
});
function observe(doc: EditorDocument) {
  const document = vi.fn(),
    fragments = vi.fn(),
    clipboard = vi.fn();
  doc.subscribe(document);
  doc.subscribeSavedFragments(fragments);
  doc.subscribeClipboard(clipboard);
  return { document, fragments, clipboard };
}
function identity(doc: EditorDocument) {
  return {
    document: doc.getSnapshot(),
    fragments: doc.getSavedFragmentsSnapshot(),
    clipboard: doc.getClipboardSnapshot(),
  };
}
function unchanged(doc: EditorDocument, initial: ReturnType<typeof identity>) {
  expect(doc.getSnapshot()).toBe(initial.document);
  expect(doc.getSavedFragmentsSnapshot()).toBe(initial.fragments);
  expect(doc.getClipboardSnapshot()).toBe(initial.clipboard);
}
describe('session fragment names have their exact independent metadata policy', () => {
  it('exports40CP and20active limits and trims without case or Unicode normalization', () => {
    expect(SAVED_FRAGMENT_NAME_LIMIT).toBe(40);
    expect(SAVED_FRAGMENT_LIMIT).toBe(20);
    expect(normalizeSavedFragmentName('  Name  ')).toBe('Name');
    expect(normalizeSavedFragmentName('e\u0301')).toBe('e\u0301');
    expect(normalizeSavedFragmentName('\u00e9')).toBe('\u00e9');
    expect(normalizeSavedFragmentName('zero\u200bwidth')).toBe('zero\u200bwidth');
  });
  it('accepts40emoji codepoints without UTF16 truncation and rejects41', () => {
    expect(normalizeSavedFragmentName('😀'.repeat(40))).toBe('😀'.repeat(40));
    expect(() => normalizeSavedFragmentName('😀'.repeat(41))).toThrow();
  });
  it.each(['', '   ', null, undefined, 42, false, { toString: () => 'coerced' }])(
    'rejects invalid raw name %j without coercion',
    (name) => {
      expect(() => normalizeSavedFragmentName(name as string)).toThrow();
    },
  );
  it.each(
    ['\u0000', '\u0009', '\u000a', '\u001f', '\u007f', '\u0085', '\u2028', '\u2029'].flatMap(
      (control) => ['start', 'middle', 'end'].map((position) => ({ control, position })),
    ),
  )('rejects raw $control at $position before trimming', ({ control, position }) => {
    const text =
      position === 'start'
        ? control + 'name'
        : position === 'end'
          ? 'name' + control
          : 'na' + control + 'me';
    expect(() => normalizeSavedFragmentName(text)).toThrow();
  });
});

describe('named immutable forest collection is separate from clipboard and author history', () => {
  it('real ProjectStorage never autosaves metadata and reset/restore construct empty collections', () => {
    vi.useFakeTimers();
    const registry = fixtureRegistry(),
      schema = clipboardApplication();
    const data = new Map([
      [PROJECT_STORAGE_KEY, JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema })],
    ]);
    const writes = vi.fn((key: string, value: string) => data.set(key, value));
    const adapter = { getItem: (key: string) => data.get(key) ?? null, setItem: writes };
    const storage = new ProjectStorage(adapter, registry, schema, { debounceMs: 10 });
    storage.start();
    try {
      const owner = storage.getSnapshot().document,
        before = storage.getSnapshot();
      const removed = owner.saveFragment('source', ['frame'], 'Removed');
      owner.removeSavedFragment(removed);
      const item = owner.saveFragment('source', ['frame'], 'Private only');
      owner.checkInsertSavedFragment('target', item);
      vi.advanceTimersByTime(20);
      storage.flush();
      expect(writes).not.toHaveBeenCalled();
      expect(storage.getSnapshot()).toBe(before);
      owner.insertSavedFragment('target', item);
      vi.advanceTimersByTime(10);
      expect(writes).toHaveBeenCalledTimes(1);
      expect(data.get(PROJECT_STORAGE_KEY)).not.toContain('Private only');
      const restored = new ProjectStorage(adapter, registry, schema);
      expect(restored.getSnapshot().document.getSavedFragmentsSnapshot()).toEqual({ items: [] });
      storage.reset();
      expect(storage.getSnapshot().document).not.toBe(owner);
      expect(storage.getSnapshot().document.getSavedFragmentsSnapshot()).toEqual({ items: [] });
      expect(owner.getSavedFragmentsSnapshot().items).toHaveLength(1);
    } finally {
      storage.stop();
    }
  });
  it('missing item lookup check and insertion preserve all state and future node allocation', () => {
    const { doc } = setup(),
      { doc: control } = setup();
    const a = doc.saveFragment('source', ['frame'], 'One'),
      b = control.saveFragment('source', ['frame'], 'One');
    const before = identity(doc),
      notices = observe(doc);
    expect(() => doc.checkInsertSavedFragment('target', 'missing')).toThrow();
    expect(() => doc.insertSavedFragment('target', 'missing')).toThrow();
    unchanged(doc, before);
    for (const callback of Object.values(notices)) expect(callback).not.toHaveBeenCalled();
    expect(doc.insertSavedFragment('target', a)).toEqual(control.insertSavedFragment('target', b));
  });
  it('empty snapshot is stable deeply frozen and successful summaries preserve survivor identity/order', () => {
    const { doc } = setup(),
      empty = doc.getSavedFragmentsSnapshot();
    expect(empty).toEqual({ items: [] });
    expect(doc.getSavedFragmentsSnapshot()).toBe(empty);
    expect(Object.isFrozen(empty)).toBe(true);
    expect(Object.isFrozen(empty.items)).toBe(true);
    const first = doc.saveFragment('source', ['leaf', 'frame'], '  First 😀  '),
      firstSummary = doc.getSavedFragmentsSnapshot().items[0];
    expect(firstSummary).toEqual({
      id: first,
      name: 'First 😀',
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
      rootCount: 1,
      nodeCount: 3,
      component: 'test.frame',
    });
    expect(Object.isFrozen(firstSummary)).toBe(true);
    const second = doc.saveFragment('source', ['last', 'leaf', 'slot-leaf'], 'Second'),
      snapshot = doc.getSavedFragmentsSnapshot();
    expect(snapshot.items[0]).toBe(firstSummary);
    expect(snapshot.items[1]).toEqual({
      id: second,
      name: 'Second',
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
      rootCount: 3,
      nodeCount: 3,
    });
    expect(snapshot.items[1]).not.toHaveProperty('nodes');
    expect(snapshot.items[1]).not.toHaveProperty('components');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
    expect(Object.isFrozen(snapshot.items[1])).toBe(true);
    doc.removeSavedFragment(first);
    expect(doc.getSavedFragmentsSnapshot().items[0]).toBe(snapshot.items[1]);
  });
  it('save and remove publish only fragment channel, insert only document, check and invalid removal neither', () => {
    const { doc } = setup();
    doc.copyNodeToClipboard('source', 'last');
    const original = identity(doc),
      notices = observe(doc);
    const id = doc.saveFragment('source', ['frame', 'last'], 'Forest');
    expect(doc.getSnapshot()).toBe(original.document);
    expect(doc.getClipboardSnapshot()).toBe(original.clipboard);
    expect(notices.fragments).toHaveBeenCalledTimes(1);
    expect(notices.document).not.toHaveBeenCalled();
    expect(notices.clipboard).not.toHaveBeenCalled();
    const saved = identity(doc);
    doc.checkInsertSavedFragment('target', id);
    unchanged(doc, saved);
    expect(notices.fragments).toHaveBeenCalledTimes(1);
    expect(notices.document).not.toHaveBeenCalled();
    doc.insertSavedFragment('target', id);
    expect(notices.document).toHaveBeenCalledTimes(1);
    expect(notices.fragments).toHaveBeenCalledTimes(1);
    expect(notices.clipboard).not.toHaveBeenCalled();
    const inserted = doc.getSnapshot();
    doc.removeSavedFragment(id);
    expect(doc.getSnapshot()).toBe(inserted);
    expect(notices.fragments).toHaveBeenCalledTimes(2);
    expect(notices.document).toHaveBeenCalledTimes(1);
    expect(notices.clipboard).not.toHaveBeenCalled();
    const removed = identity(doc);
    expect(() => doc.removeSavedFragment(id)).toThrow();
    unchanged(doc, removed);
    expect(notices.fragments).toHaveBeenCalledTimes(2);
  });
  it('never calls clipboard public commands or changes the actual old clipboard forest', () => {
    const { doc } = setup();
    doc.copyNodeToClipboard('source', 'last');
    const summary = doc.getClipboardSnapshot();
    const copy = vi.spyOn(doc, 'copyNodesToClipboard'),
      paste = vi.spyOn(doc, 'pasteClipboardNodes'),
      check = vi.spyOn(doc, 'checkPasteClipboardNodes'),
      clear = vi.spyOn(doc, 'clearClipboard');
    const id = doc.saveFragment('source', ['frame'], 'Saved');
    doc.checkInsertSavedFragment('target', id);
    const inserted = doc.insertSavedFragment('target', id);
    doc.removeSavedFragment(id);
    expect(copy).not.toHaveBeenCalled();
    expect(paste).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(doc.getClipboardSnapshot()).toBe(summary);
    const clipboardId = doc.pasteClipboard('target');
    expect(strip(node(doc, clipboardId))).toEqual(strip(staticLeaf('last')));
    expect(strip(node(doc, inserted[0]))).toEqual(strip(staticTree()));
  });
  it('trim duplicates reject atomically; case and Unicode-distinct names coexist', () => {
    const { doc } = setup();
    const id = doc.saveFragment('source', ['frame'], 'Name');
    const before = identity(doc);
    expect(() => doc.saveFragment('source', ['last'], ' Name ')).toThrow();
    unchanged(doc, before);
    for (const name of ['name', 'é', 'e\u0301']) doc.saveFragment('source', ['last'], name);
    expect(doc.getSavedFragmentsSnapshot().items.map((item) => item.name)).toEqual([
      'Name',
      'name',
      'é',
      'e\u0301',
    ]);
    doc.removeSavedFragment(id);
    const newId = doc.saveFragment('source', ['last'], 'Name');
    expect(newId).not.toBe(id);
  });
  it('capacity20 rejects without eviction or ID consumption; removing frees capacity but never reuses ID', () => {
    const { doc } = setup(),
      { doc: control } = setup();
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) {
      ids.push(doc.saveFragment('source', ['last'], 'Name' + i));
      control.saveFragment('source', ['last'], 'Name' + i);
    }
    const before = identity(doc);
    expect(() => doc.saveFragment('source', ['frame'], 'Overflow')).toThrow();
    unchanged(doc, before);
    expect(doc.getSavedFragmentsSnapshot().items.map((item) => item.id)).toEqual(ids);
    for (const current of [doc, control]) current.removeSavedFragment(ids[0]);
    const next = doc.saveFragment('source', ['frame'], 'Name0');
    expect(next).toBe(control.saveFragment('source', ['frame'], 'Name0'));
    expect(ids).not.toContain(next);
    expect(doc.getSavedFragmentsSnapshot().items).toHaveLength(20);
  });
  it.each([
    'bad-name',
    'empty',
    'unknown',
    'covered-missing',
    'sparse',
    'mixed-sparse',
    'dynamic-child',
    'unknown-extension',
  ] as const)(
    'failed save %s preserves all channels, both allocators and exact prior snapshots',
    (kind) => {
      const roots = [staticTree(), staticLeaf('last')];
      if (kind === 'dynamic-child')
        roots[0].children![0].props.text = {
          kind: 'expression',
          language: 'javascript',
          source: '"bound"',
        };
      if (kind === 'unknown-extension')
        roots[0].slots!.footer.children[0].extensions = { 'unknown:value': { id: 'leaf' } };
      const { doc } = setup(roots),
        { doc: control } = setup(roots);
      for (const current of [doc, control]) {
        current.copyNodeToClipboard('source', 'last');
        current.saveFragment('source', ['last'], 'Good');
      }
      const ids =
        kind === 'empty'
          ? []
          : kind === 'unknown'
            ? ['missing']
            : kind === 'covered-missing'
              ? ['frame', 'leaf', 'missing']
              : kind === 'sparse'
                ? new Array<string>(1)
                : ['last', 'frame'];
      if (kind === 'mixed-sparse') {
        ids.splice(1);
        ids.length = 2;
      }
      const before = identity(doc),
        notices = observe(doc);
      expect(() =>
        doc.saveFragment('source', ids, kind === 'bad-name' ? 'raw\n' : 'Rejected'),
      ).toThrow();
      unchanged(doc, before);
      for (const notify of Object.values(notices)) expect(notify).not.toHaveBeenCalled();
      const next = doc.saveFragment('source', ['last'], 'Next');
      expect(next).toBe(control.saveFragment('source', ['last'], 'Next'));
      expect(doc.insertSavedFragment('target', next)).toEqual(
        control.insertSavedFragment('target', next),
      );
      expect(doc.exportJson()).toBe(control.exportJson());
    },
  );
  it('metadata save/remove/check/failure preserve an existing edit group and redo', () => {
    const { doc } = setup(),
      original = doc.exportJson();
    doc.setProp('source', 'last', 'text', literal('first'), 'group');
    const id = doc.saveFragment('source', ['frame'], 'Saved');
    doc.checkInsertSavedFragment('target', id);
    expect(() => doc.insertSavedFragment('target', id, { index: -1 })).toThrow();
    doc.removeSavedFragment(id);
    doc.setProp('source', 'last', 'text', literal('second'), 'group');
    doc.undo();
    expect(doc.exportJson()).toBe(original);
    expect(doc.getSnapshot().canUndo).toBe(false);
    expect(doc.getSavedFragmentsSnapshot().items).toHaveLength(0);
    const before = doc.getSnapshot();
    const next = doc.saveFragment('source', ['last'], 'New');
    doc.removeSavedFragment(next);
    expect(doc.getSnapshot()).toBe(before);
    expect(doc.getSnapshot().canRedo).toBe(true);
  });
  it('same-instance import and page Undo preserve snapshots; a new document is empty and exports no items', () => {
    const { doc, registry, schema } = setup();
    doc.copyNodeToClipboard('source', 'last');
    const id = doc.saveFragment('source', ['frame', 'last'], 'Retained');
    const saved = doc.getSavedFragmentsSnapshot();
    doc.importJson(doc.exportJson());
    expect(doc.getSavedFragmentsSnapshot()).toBe(saved);
    expect(doc.getClipboardSnapshot()).toEqual({ available: false, nodeCount: 0 });
    const replacement = structuredClone(schema);
    replacement.entryPageId = 'target';
    replacement.pages = replacement.pages.filter((item) => item.id === 'target');
    doc.replace(replacement);
    expect(doc.getSavedFragmentsSnapshot()).toBe(saved);
    expect(doc.getSnapshot().plan.pages.has('source')).toBe(false);
    expect(doc.insertSavedFragment('target', id)).toHaveLength(2);
    doc.undo();
    doc.undo();
    expect(doc.getSavedFragmentsSnapshot()).toBe(saved);
    expect(() => doc.importJson('{')).toThrow();
    expect(doc.getSavedFragmentsSnapshot()).toBe(saved);
    const fresh = new EditorDocument(JSON.parse(doc.exportJson()), registry);
    expect(fresh.getSavedFragmentsSnapshot()).toEqual({ items: [] });
    expect(doc.exportJson()).not.toContain('Retained');
    expect(JSON.parse(doc.exportJson())).not.toHaveProperty('savedFragments');
  });
  it('source and inserted-copy changes never alter a saved named forest, inline style or literal strings', () => {
    const roots = [staticTree(), staticLeaf('last')];
    roots[0].extensions = { [NODE_NAME_EXTENSION]: 'Opaque frame last' };
    const { doc } = setup(roots),
      id = doc.saveFragment('source', ['last', 'frame'], 'Frozen');
    const saved = doc.getSavedFragmentsSnapshot();
    doc.setProp('source', 'leaf', 'text', literal('source changed'));
    doc.renamePage('source', 'Later title');
    doc.setNodeName('source', 'frame', 'Later name');
    const first = doc.insertSavedFragment('target', id);
    doc.setProp('target', node(doc, first[0]).children![0].id, 'text', literal('copy changed'));
    const second = doc.insertSavedFragment('target', id);
    expect(second.map((key) => strip(node(doc, key)))).toEqual(roots.map(strip));
    expect(doc.getSavedFragmentsSnapshot()).toBe(saved);
    expect(saved.items[0].sourcePageTitle).toBe('源页面');
    doc.removeSavedFragment(id);
    expect(node(doc, first[0]).children![0].props.text).toEqual(literal('copy changed'));
    expect(node(doc, second[0]).children![0].props.text).toEqual(roots[0].children![0].props.text);
  });
});

describe('saved fragment insertion shares the tested static forest transaction', () => {
  it.each([
    { index: 0 },
    { index: 1 },
    { index: 2 },
    { parentId: 'target-frame', index: 0 },
    { parentId: 'target-frame', slot: 'footer', index: 0 },
  ] satisfies InsertTarget[])(
    'one contiguous ordered block at %j and full raw selection Undo/Redo',
    (target) => {
      const { doc } = setup();
      doc.selectMany('source', ['last', 'leaf', 'frame'], 'last');
      const item = doc.saveFragment('source', ['last', 'frame'], 'Forest');
      const before = doc.exportJson(),
        oldSelection = doc.getSnapshot().selection,
        metadata = doc.getSavedFragmentsSnapshot(),
        notices = observe(doc);
      doc.checkInsertSavedFragment('target', item, target);
      expect(notices.document).not.toHaveBeenCalled();
      const ids = doc.insertSavedFragment('target', item, target),
        pasted = doc.exportJson();
      expect(ids.map((key) => node(doc, key).component)).toEqual(['test.frame', 'test.leaf']);
      expect(ids.map((key) => findNode(page(doc), key)!.index)).toEqual([
        target.index,
        target.index! + 1,
      ]);
      expect(doc.getSnapshot().selection).toEqual({
        pageId: 'target',
        nodeId: ids[0],
        nodeIds: ids,
      });
      expect(notices.document).toHaveBeenCalledTimes(1);
      expect(notices.fragments).not.toHaveBeenCalled();
      expect(notices.clipboard).not.toHaveBeenCalled();
      doc.undo();
      expect(doc.exportJson()).toBe(before);
      expect(doc.getSnapshot().selection).toEqual(oldSelection);
      doc.redo();
      expect(doc.exportJson()).toBe(pasted);
      expect(doc.getSavedFragmentsSnapshot()).toBe(metadata);
    },
  );
  it.each([
    { index: -1 },
    { index: 0.5 },
    { index: 3 },
    { index: null },
    { parentId: 'missing' },
    { parentId: 'target-leaf' },
    { parentId: 'target-frame', slot: 'missing' },
    { slot: 'footer' },
  ])('bad target %j preserves all identities, IDs and grouping', (bad) => {
    const { doc } = setup(),
      { doc: control } = setup();
    const a = doc.saveFragment('source', ['frame', 'last'], 'Saved'),
      b = control.saveFragment('source', ['frame', 'last'], 'Saved');
    const before = identity(doc);
    const target = bad as InsertTarget;
    expect(() => doc.checkInsertSavedFragment('target', a, target)).toThrow();
    expect(() => doc.insertSavedFragment('target', a, target)).toThrow();
    unchanged(doc, before);
    expect(doc.insertSavedFragment('target', a)).toEqual(control.insertSavedFragment('target', b));
    expect(doc.exportJson()).toBe(control.exportJson());
  });
  it('alternates two saved items and clipboard with disjoint node/action/onEnter identity union, no check allocation', () => {
    const { doc, schema, registry } = setup();
    const blocked = Array.from({ length: 16 }, (_, i) =>
      ['test-frame', 'test-leaf', 'test-slotLeaf'].map((name) => `${name}-${i + 1}`),
    ).flat();
    schema.pages[1].children.push(staticLeaf('test-frame-17'));
    schema.pages[1].onEnter = blocked
      .filter((_, i) => i % 2 === 0)
      .map((id) => ({ id, action: 'test.effect', input: {} }));
    schema.pages[1].children.find((root) => root.id === 'target-leaf')!.on = {
      onClick: blocked
        .filter((_, i) => i % 2)
        .map((id) => ({ id, action: 'test.effect', input: {} })),
    };
    const current = new EditorDocument(schema, registry),
      control = new EditorDocument(schema, fixtureRegistry());
    const prepare = (owner: EditorDocument) => {
      owner.copyNodeToClipboard('source', 'last');
      return [
        owner.saveFragment('source', ['frame'], 'One'),
        owner.saveFragment('source', ['last', 'leaf'], 'Two'),
      ];
    };
    const items = prepare(current),
      other = prepare(control),
      before = identity(current);
    for (let i = 0; i < 3; i++) current.checkInsertSavedFragment('target', items[0]);
    unchanged(current, before);
    const ids = [
      ...current.insertSavedFragment('target', items[0]),
      current.pasteClipboard('target'),
      ...current.insertSavedFragment('target', items[1]),
      ...current.insertSavedFragment('source', items[0]),
    ];
    const expected = [
      ...control.insertSavedFragment('target', other[0]),
      control.pasteClipboard('target'),
      ...control.insertSavedFragment('target', other[1]),
      ...control.insertSavedFragment('source', other[0]),
    ];
    expect(ids).toEqual(expected);
    const all = [...page(current).children, ...page(current, 'source').children].flatMap(nodeIds);
    const created = ids.flatMap((id) =>
      nodeIds(node(current, id, findNode(page(current), id) ? 'target' : 'source')),
    );
    expect(new Set(created).size).toBe(created.length);
    expect(created.some((id) => blocked.includes(id))).toBe(false);
    expect(all).toContain('test-frame-17');
    expect(doc.getSavedFragmentsSnapshot()).toEqual({ items: [] });
  });
  it.each(['missing', 'version', 'form', 'compile'] as const)(
    'changed second-root contract %s rejects without consuming item or node sequences',
    (kind) => {
      const roots = [
        staticLeaf('first'),
        {
          id: 'second',
          component: 'test.slotLeaf',
          props: { payload: literal({ nodeId: 'first' }) },
        },
      ];
      const { doc, registry } = setup(roots),
        { doc: control } = setup(roots),
        item = doc.saveFragment('source', ['first', 'second'], 'Saved'),
        other = control.saveFragment('source', ['first', 'second'], 'Saved');
      const before = identity(doc),
        old = registry.components['test.slotLeaf'];
      if (kind === 'missing') delete registry.components['test.slotLeaf'];
      else if (kind === 'version')
        registry.components['test.slotLeaf'] = { ...old, version: '9.9.9' };
      else if (kind === 'form') registry.components['test.slotLeaf'] = { ...old, form: true };
      else
        registry.components['test.slotLeaf'] = {
          ...old,
          validateProps: () => ['late compile refusal'],
        };
      expect(() => doc.checkInsertSavedFragment('target', item)).toThrow();
      expect(() => doc.insertSavedFragment('target', item)).toThrow();
      unchanged(doc, before);
      registry.components['test.slotLeaf'] = old;
      expect(doc.insertSavedFragment('target', item)).toEqual(
        control.insertSavedFragment('target', other),
      );
      expect(doc.saveFragment('source', ['first'], 'Next')).toBe(
        control.saveFragment('source', ['first'], 'Next'),
      );
    },
  );
  it('compile exactly once per check/actual insertion and isolate successful insertion from adjacent edit groups', () => {
    const { doc } = setup(),
      original = doc.exportJson();
    doc.setProp('source', 'last', 'text', literal('first'), 'group');
    const item = doc.saveFragment('source', ['frame'], 'Saved'),
      edited = doc.exportJson();
    const compile = vi.spyOn(engine, 'compileApplication');
    doc.checkInsertSavedFragment('target', item);
    expect(compile).toHaveBeenCalledTimes(1);
    compile.mockClear();
    doc.insertSavedFragment('target', item);
    expect(compile).toHaveBeenCalledTimes(1);
    const inserted = doc.exportJson();
    doc.setProp('source', 'last', 'text', literal('second'), 'group');
    doc.undo();
    expect(doc.exportJson()).toBe(inserted);
    doc.undo();
    expect(doc.exportJson()).toBe(edited);
    doc.undo();
    expect(doc.exportJson()).toBe(original);
  });
  it('an orphan Tabs root cannot borrow another saved root context', () => {
    const panel: NodeSchema = {
      id: 'orphan',
      component: 'ui.tabPanel',
      props: { label: literal('orphan'), value: literal('one') },
      children: [],
    };
    const owner: NodeSchema = {
      id: 'tabs',
      component: 'ui.tabs',
      props: { label: literal('tabs'), value: literal('') },
      children: [{ ...structuredClone(panel), id: 'owned' }],
    };
    const { doc } = setup([owner, panel, staticLeaf('last')]);
    doc.saveFragment('source', ['last'], 'Good');
    const before = identity(doc);
    expect(() => doc.saveFragment('source', ['tabs', 'orphan'], 'Bad')).toThrow(/完整标签页/);
    unchanged(doc, before);
  });
});
