import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode, type InsertTarget } from '../packages/editor/document';
import type { NodeSchema } from '../packages/schema/types';
import { NODE_NAME_EXTENSION } from '../packages/schema/node-name';
import * as engine from '../packages/runtime/engine';
import {
  clipboardApplication,
  fixtureRegistry,
  literal,
  nodeIds,
  staticLeaf,
  staticTree,
} from './clipboard-fixture';

afterEach(() => vi.restoreAllMocks());
function setup(nodes = [staticTree(), staticLeaf('last')]) {
  const registry = fixtureRegistry(),
    schema = clipboardApplication(nodes, registry);
  return { registry, schema, document: new EditorDocument(schema, registry) };
}
const page = (doc: EditorDocument, id = 'target') => doc.getSnapshot().plan.pages.get(id)!.schema;
const node = (doc: EditorDocument, id: string, pageId = 'target') =>
  findNode(page(doc, pageId), id)!.node;
const stripIds = (root: NodeSchema): unknown => ({
  ...root,
  id: '',
  ...(root.children && { children: root.children.map(stripIds) }),
  ...(root.slots && {
    slots: Object.fromEntries(
      Object.entries(root.slots).map(([name, slot]) => [
        name,
        { ...slot, children: slot.children.map(stripIds) },
      ]),
    ),
  }),
});
function assertUnchanged(
  doc: EditorDocument,
  before: ReturnType<EditorDocument['getSnapshot']>,
  summary: ReturnType<EditorDocument['getClipboardSnapshot']>,
) {
  expect(doc.getSnapshot()).toBe(before);
  expect(doc.getClipboardSnapshot()).toBe(summary);
}
const panel = (id: string): NodeSchema => ({
  id,
  component: 'ui.tabPanel',
  props: { label: literal(id), value: literal(id) },
  children: [],
});
const tabs = (id: string): NodeSchema => ({
  id,
  component: 'ui.tabs',
  props: { label: literal(id), value: literal('') },
  children: [panel(id + '-panel')],
});

describe('forest capture is one portable session transaction', () => {
  it.each(['all-holes', 'valid-then-hole'] as const)(
    'rejects sparse explicit input %s and retains previous payload identity',
    (kind) => {
      const { document: doc } = setup();
      doc.copyNodeToClipboard('source', 'last');
      const before = doc.getSnapshot(),
        summary = doc.getClipboardSnapshot(),
        notify = vi.fn();
      doc.subscribeClipboard(notify);
      const ids = kind === 'all-holes' ? new Array<string>(1) : ['frame'];
      if (kind === 'valid-then-hole') ids.length = 2;
      expect(() => doc.copyNodesToClipboard('source', ids)).toThrow();
      assertUnchanged(doc, before, summary);
      expect(notify).not.toHaveBeenCalled();
      const id = doc.pasteClipboard('target');
      expect(node(doc, id).component).toBe('test.leaf');
      expect(stripIds(node(doc, id))).toEqual(stripIds(staticLeaf('last')));
    },
  );
  it('keeps exact empty, reduced singleton and multi summary shapes', () => {
    const { document: doc } = setup();
    expect(doc.getClipboardSnapshot()).toEqual({ available: false, nodeCount: 0 });
    doc.copyNodesToClipboard('source', ['slot-leaf', 'leaf', 'frame', 'frame']);
    expect(doc.getClipboardSnapshot()).toEqual({
      available: true,
      nodeCount: 3,
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
      component: 'test.frame',
    });
    doc.copyNodesToClipboard('source', ['last', 'frame']);
    expect(doc.getClipboardSnapshot()).toEqual({
      available: true,
      nodeCount: 4,
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
      rootCount: 2,
    });
    expect(Object.isFrozen(doc.getClipboardSnapshot())).toBe(true);
    doc.clearClipboard();
    expect(doc.getClipboardSnapshot()).toEqual({ available: false, nodeCount: 0 });
  });
  it('different child and slot owners become roots in page preorder, not caller order', () => {
    const { document: doc } = setup();
    doc.copyNodesToClipboard('source', ['last', 'slot-leaf', 'leaf', 'slot-leaf']);
    const ids = doc.pasteClipboardNodes('target');
    expect(ids).toHaveLength(3);
    expect(ids.map((id) => node(doc, id).component)).toEqual([
      'test.leaf',
      'test.slotLeaf',
      'test.leaf',
    ]);
    expect(ids.map((id) => node(doc, id).props)).toEqual([
      staticLeaf().props,
      staticTree().slots!.footer.children[0].props,
      staticLeaf('last').props,
    ]);
    expect(
      page(doc)
        .children.slice(-3)
        .map((root) => root.id),
    ).toEqual(ids);
  });
  it.each([
    { pageId: 'source', ids: [] },
    { pageId: 'missing', ids: ['frame'] },
    { pageId: 'source', ids: ['frame', 'missing'] },
    { pageId: 'source', ids: ['missing', 'frame', 'leaf'] },
    { pageId: 'source', ids: ['frame', 'target-leaf'] },
    { pageId: 'target', ids: ['target-frame', 'frame'] },
  ])('invalid explicit capture %j preserves all prior state and old payload', ({ pageId, ids }) => {
    const { document: doc } = setup();
    doc.copyNodeToClipboard('source', 'last');
    const before = doc.getSnapshot(),
      summary = doc.getClipboardSnapshot(),
      changed = vi.fn(),
      clip = vi.fn();
    doc.subscribe(changed);
    doc.subscribeClipboard(clip);
    expect(() => doc.copyNodesToClipboard(pageId, ids)).toThrow();
    assertUnchanged(doc, before, summary);
    expect(changed).not.toHaveBeenCalled();
    expect(clip).not.toHaveBeenCalled();
    expect(doc.pasteClipboard('target')).toEqual(expect.any(String));
  });
  it.each(['child', 'slot', 'root'] as const)(
    'invalid %s in later root rejects entire capture',
    (kind) => {
      const bad = staticTree();
      const invalid =
        kind === 'root' ? bad : kind === 'child' ? bad.children![0] : bad.slots!.footer.children[0];
      invalid.extensions = { 'unportable:opaque': { id: 'leaf' } };
      const { document: doc } = setup([staticLeaf('good'), bad]);
      doc.copyNodeToClipboard('source', 'good');
      const before = doc.getSnapshot(),
        summary = doc.getClipboardSnapshot();
      expect(() => doc.copyNodesToClipboard('source', ['good', 'frame'])).toThrow();
      assertUnchanged(doc, before, summary);
      const id = doc.pasteClipboard('target');
      expect(node(doc, id).component).toBe('test.leaf');
    },
  );
  it('capture publishes only clipboard once and preserves redo, selection and source edits isolation', () => {
    const { document: doc } = setup();
    doc.setProp('source', 'leaf', 'text', literal('temporary'));
    doc.undo();
    doc.selectMany('source', ['last', 'leaf', 'slot-leaf'], 'last');
    const before = doc.getSnapshot(),
      exported = doc.exportJson(),
      main = vi.fn(),
      clip = vi.fn();
    doc.subscribe(main);
    doc.subscribeClipboard(clip);
    doc.copyNodesToClipboard('source', ['last', 'frame']);
    expect(doc.getSnapshot()).toBe(before);
    expect(doc.exportJson()).toBe(exported);
    expect(before.canRedo).toBe(true);
    expect(main).not.toHaveBeenCalled();
    expect(clip).toHaveBeenCalledTimes(1);
    const summary = doc.getClipboardSnapshot();
    doc.setProp('source', 'leaf', 'text', literal('later'));
    doc.setNodeName('source', 'frame', 'Later source name');
    doc.selectPage('target');
    doc.removePage('source', 'target');
    doc.undo();
    doc.redo();
    const ids = doc.pasteClipboardNodes('target');
    expect(ids.map((id) => stripIds(node(doc, id)))).toEqual(
      [staticTree(), staticLeaf('last')].map(stripIds),
    );
    expect(doc.getClipboardSnapshot()).toBe(summary);
  });
  it('canonical names, inline style and literal apparent references remain opaque across all roots', () => {
    const roots = [staticTree(), staticLeaf('last')];
    roots[0].extensions = { [NODE_NAME_EXTENSION]: 'frame / last 😀' };
    roots[1].extensions = { [NODE_NAME_EXTENSION]: 'last / frame' };
    const { document: doc } = setup(roots);
    doc.copyNodesToClipboard('source', ['last', 'frame']);
    const ids = doc.pasteClipboardNodes('target');
    expect(ids.map((id) => stripIds(node(doc, id)))).toEqual(roots.map(stripIds));
    expect(node(doc, ids[0]).children![0].props.text).toEqual(
      literal('source leaf / scope.record / forms.model / leaf'),
    );
  });
  it('each root needs its own Tabs closure; a separate complete root cannot cure an orphan', () => {
    const { document: doc } = setup([tabs('owner'), panel('orphan'), staticLeaf('good')]);
    doc.copyNodeToClipboard('source', 'good');
    const before = doc.getSnapshot(),
      summary = doc.getClipboardSnapshot();
    expect(() => doc.copyNodesToClipboard('source', ['owner', 'orphan'])).toThrow(/完整标签页/);
    assertUnchanged(doc, before, summary);
  });
  it('two independent complete Tabs with equal panel values capture and paste together', () => {
    const first = tabs('one'),
      second = tabs('two');
    second.children![0].props.value = first.children![0].props.value;
    const { document: doc } = setup([first, second]);
    doc.copyNodesToClipboard('source', ['two', 'one']);
    const ids = doc.pasteClipboardNodes('target');
    expect(ids.map((id) => stripIds(node(doc, id)))).toEqual([first, second].map(stripIds));
  });
  it('forest and singleton APIs share a one-root payload without mandatory rootCount', () => {
    const { document: doc } = setup();
    doc.copyNodesToClipboard('source', ['leaf', 'leaf']);
    expect(doc.getClipboardSnapshot()).not.toHaveProperty('rootCount');
    doc.checkPasteClipboardNodes('target');
    doc.checkPasteClipboard('target');
    const first = doc.pasteClipboard('target'),
      second = doc.pasteClipboardNodes('target');
    expect(typeof first).toBe('string');
    expect(second).toHaveLength(1);
    expect(doc.getSnapshot().selection).toEqual({ pageId: 'target', nodeId: second[0] });
  });
});

describe('forest paste is one atomic contiguous block', () => {
  it('check and actual paste each perform one real full compile rather than per-root or double compilation', () => {
    const { document: doc } = setup();
    doc.copyNodesToClipboard('source', ['frame', 'last']);
    const compile = vi.spyOn(engine, 'compileApplication');
    doc.checkPasteClipboardNodes('target');
    expect(compile).toHaveBeenCalledTimes(1);
    compile.mockClear();
    doc.pasteClipboardNodes('target');
    expect(compile).toHaveBeenCalledTimes(1);
  });
  it('successful forest paste separates grouped edits on both sides into three Undo steps', () => {
    const { document: doc } = setup();
    const initial = doc.exportJson();
    doc.setProp('source', 'last', 'text', literal('first'), 'group');
    doc.copyNodesToClipboard('source', ['frame', 'last']);
    const edited = doc.exportJson();
    doc.pasteClipboardNodes('target');
    const pasted = doc.exportJson();
    doc.setProp('source', 'last', 'text', literal('second'), 'group');
    doc.undo();
    expect(doc.exportJson()).toBe(pasted);
    doc.undo();
    expect(doc.exportJson()).toBe(edited);
    doc.undo();
    expect(doc.exportJson()).toBe(initial);
  });
  it('runtime null index stays invalid rather than silently appending', () => {
    const { document: doc } = setup();
    doc.copyNodesToClipboard('source', ['frame', 'last']);
    const before = doc.getSnapshot(),
      summary = doc.getClipboardSnapshot();
    const malformed = { index: null } as unknown as InsertTarget;
    expect(() => doc.checkPasteClipboardNodes('target', malformed)).toThrow();
    expect(() => doc.pasteClipboardNodes('target', malformed)).toThrow();
    assertUnchanged(doc, before, summary);
  });
  it.each([
    { index: 0 },
    { index: 1 },
    { index: 2 },
    { parentId: 'target-frame', index: 0 },
    { parentId: 'target-frame', slot: 'footer', index: 0 },
  ] satisfies InsertTarget[])('inserts in capture order once at %j', (target) => {
    const { document: doc } = setup();
    doc.copyNodesToClipboard('source', ['last', 'frame']);
    const before = doc.getSnapshot(),
      notify = vi.fn();
    doc.subscribe(notify);
    doc.checkPasteClipboardNodes('target', target);
    expect(doc.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    const ids = doc.pasteClipboardNodes('target', target);
    expect(ids.map((id) => node(doc, id).component)).toEqual(['test.frame', 'test.leaf']);
    expect(ids.map((id) => findNode(page(doc), id)!.index)).toEqual([
      target.index,
      target.index! + 1,
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(doc.getSnapshot().selection).toEqual({ pageId: 'target', nodeId: ids[0], nodeIds: ids });
    expect(doc.getSnapshot().revision).toBe(before.revision + 1);
  });
  it.each([
    { index: -1 },
    { index: 0.5 },
    { index: 3 },
    { index: Number.NaN },
    { parentId: 'missing' },
    { parentId: 'target-leaf' },
    { parentId: 'target-frame', slot: 'missing' },
    { slot: 'footer' },
  ] satisfies InsertTarget[])(
    'rejects target %j with no allocator, summary or redo mutation',
    (target) => {
      const { document: doc } = setup(),
        { document: control } = setup();
      for (const current of [doc, control]) {
        current.setProp('source', 'last', 'text', literal('temp'));
        current.undo();
        current.copyNodesToClipboard('source', ['frame', 'last']);
      }
      const before = doc.getSnapshot(),
        summary = doc.getClipboardSnapshot();
      expect(() => doc.checkPasteClipboardNodes('target', target)).toThrow();
      expect(() => doc.pasteClipboardNodes('target', target)).toThrow();
      assertUnchanged(doc, before, summary);
      expect(doc.pasteClipboardNodes('target')).toEqual(control.pasteClipboardNodes('target'));
      expect(doc.exportJson()).toBe(control.exportJson());
    },
  );
  it('legacy paste/check reject forests explicitly before even an invalid target is drafted', () => {
    const { document: doc } = setup(),
      { document: control } = setup();
    for (const current of [doc, control]) current.copyNodesToClipboard('source', ['frame', 'last']);
    const before = doc.getSnapshot(),
      summary = doc.getClipboardSnapshot();
    expect(() => doc.checkPasteClipboard('missing')).toThrow(/多|多个|checkPasteClipboardNodes/);
    expect(() => doc.pasteClipboard('missing')).toThrow(/多|多个|pasteClipboardNodes/);
    assertUnchanged(doc, before, summary);
    expect(doc.pasteClipboardNodes('target')).toEqual(control.pasteClipboardNodes('target'));
  });
  it('check-only, copy and rejected paste preserve an existing grouped edit transaction', () => {
    const { document: doc } = setup();
    const original = doc.exportJson();
    doc.setProp('source', 'last', 'text', literal('first'), 'same-group');
    doc.copyNodesToClipboard('source', ['frame', 'last']);
    doc.checkPasteClipboardNodes('target');
    expect(() => doc.pasteClipboardNodes('target', { index: -1 })).toThrow();
    doc.setProp('source', 'last', 'text', literal('second'), 'same-group');
    doc.undo();
    expect(doc.exportJson()).toBe(original);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it('first captured root is primary regardless of source primary; one Undo restores complete prior multi', () => {
    const { document: doc } = setup();
    doc.selectMany('source', ['frame', 'last', 'leaf'], 'last');
    doc.copyNodesToClipboard('source', ['last', 'leaf', 'frame']);
    const before = doc.exportJson(),
      selection = doc.getSnapshot().selection;
    const ids = doc.pasteClipboardNodes('target'),
      pasted = doc.exportJson();
    expect(doc.getSnapshot().selection).toEqual({ pageId: 'target', nodeId: ids[0], nodeIds: ids });
    doc.undo();
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().selection).toEqual(selection);
    expect(doc.getSnapshot().canUndo).toBe(false);
    doc.redo();
    expect(doc.exportJson()).toBe(pasted);
    expect(doc.getSnapshot().selection).toEqual({ pageId: 'target', nodeId: ids[0], nodeIds: ids });
  });
  it('consecutive pastes are distinct Undo steps and repeated preflight consumes no IDs', () => {
    const { document: doc } = setup(),
      { document: control } = setup();
    for (const current of [doc, control]) current.copyNodesToClipboard('source', ['frame', 'last']);
    const before = doc.getSnapshot();
    for (let i = 0; i < 3; i++) doc.checkPasteClipboardNodes('target');
    expect(doc.getSnapshot()).toBe(before);
    const first = doc.pasteClipboardNodes('target'),
      firstExport = doc.exportJson();
    expect(first).toEqual(control.pasteClipboardNodes('target'));
    const second = doc.pasteClipboardNodes('target');
    const allIds = [...first, ...second].flatMap((id) => nodeIds(node(doc, id)));
    expect(new Set(allIds).size).toBe(allIds.length);
    doc.undo();
    expect(doc.exportJson()).toBe(firstExport);
    doc.undo();
    expect(doc.exportJson()).toBe(JSON.stringify(before.plan.schema, null, 2) + '\n');
  });
  it.each(['missing', 'version', 'form', 'compile'] as const)(
    'second-root %s failure is atomic and does not consume IDs',
    (kind) => {
      const second: NodeSchema = {
        id: 'second',
        component: 'test.slotLeaf',
        props: { payload: literal({ id: 'frame' }) },
      };
      const { document: doc, registry } = setup([staticLeaf('first'), second]),
        { document: control } = setup([staticLeaf('first'), second]);
      for (const current of [doc, control])
        current.copyNodesToClipboard('source', ['first', 'second']);
      const before = doc.getSnapshot(),
        summary = doc.getClipboardSnapshot(),
        old = registry.components['test.slotLeaf'];
      if (kind === 'missing') delete registry.components['test.slotLeaf'];
      else if (kind === 'version')
        registry.components['test.slotLeaf'] = { ...old, version: '9.9.9' };
      else if (kind === 'form') registry.components['test.slotLeaf'] = { ...old, form: true };
      else
        registry.components['test.slotLeaf'] = {
          ...old,
          validateProps: () => ['second root compilation refusal'],
        };
      expect(() => doc.checkPasteClipboardNodes('target')).toThrow();
      expect(() => doc.pasteClipboardNodes('target')).toThrow();
      assertUnchanged(doc, before, summary);
      registry.components['test.slotLeaf'] = old;
      expect(doc.pasteClipboardNodes('target')).toEqual(control.pasteClipboardNodes('target'));
      expect(doc.exportJson()).toBe(control.exportJson());
    },
  );
  it('uses one target-wide node/action/onEnter ID union across every root and slot descendant', () => {
    const { schema, registry } = setup();
    const blocked = Array.from({ length: 20 }, (_, i) =>
      ['test-frame', 'test-leaf', 'test-slotLeaf'].map((name) => `${name}-${i + 1}`),
    ).flat();
    schema.pages[1].children.unshift(staticLeaf('test-frame-21'));
    schema.pages[1].onEnter = blocked
      .filter((_, i) => i % 2 === 0)
      .map((id) => ({ id, action: 'test.effect', input: {} }));
    schema.pages[1].children.find((root) => root.id === 'target-leaf')!.on = {
      onClick: blocked
        .filter((_, i) => i % 2)
        .map((id) => ({ id, action: 'test.effect', input: {} })),
    };
    const doc = new EditorDocument(schema, registry);
    doc.copyNodesToClipboard('source', ['frame', 'last']);
    const roots = doc.pasteClipboardNodes('target'),
      ids = roots.flatMap((id) => nodeIds(node(doc, id)));
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids.some((id) => blocked.includes(id))).toBe(false);
    expect(new Set(page(doc).children.flatMap(nodeIds)).size).toBe(
      page(doc).children.flatMap(nodeIds).length,
    );
  });
});
