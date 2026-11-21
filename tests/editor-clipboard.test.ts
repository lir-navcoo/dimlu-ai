import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode, type InsertTarget } from '../packages/editor/document';
import type { NodeSchema, Value } from '../packages/schema/types';
import {
  clipboardApplication,
  expression,
  fixtureRegistry,
  literal,
  nodeIds,
  staticLeaf,
  staticTree,
} from './clipboard-fixture';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, '__clipboardCommandExecuted');
});
function setup(nodes?: NodeSchema[]) {
  const registry = fixtureRegistry(),
    schema = clipboardApplication(nodes, registry),
    document = new EditorDocument(schema, registry);
  return { document, registry, schema };
}
const page = (doc: EditorDocument, pageId = 'target') =>
  doc.getSnapshot().plan.pages.get(pageId)!.schema;
const node = (doc: EditorDocument, id: string, pageId = 'target') =>
  findNode(page(doc, pageId), id)!.node;
function withoutIds(root: NodeSchema): unknown {
  const { id: _id, children, slots, ...rest } = root;
  return {
    ...rest,
    ...(children ? { children: children.map(withoutIds) } : {}),
    ...(slots
      ? {
          slots: Object.fromEntries(
            Object.entries(slots).map(([name, slot]) => [
              name,
              { params: slot.params, children: slot.children.map(withoutIds) },
            ]),
          ),
        }
      : {}),
  };
}

describe('private static clipboard capture', () => {
  it('copies to stable summary without publishing document state or retaining mutable source payload', () => {
    const { document } = setup(),
      before = document.getSnapshot(),
      exported = document.exportJson(),
      main = vi.fn(),
      clipboard = vi.fn();
    document.subscribe(main);
    const stop = document.subscribeClipboard(clipboard);
    const empty = document.getClipboardSnapshot();
    expect(empty).toMatchObject({ available: false, nodeCount: 0 });
    expect(document.getClipboardSnapshot()).toBe(empty);
    document.copyNodeToClipboard('source', 'frame');
    const summary = document.getClipboardSnapshot();
    expect(summary).toMatchObject({
      available: true,
      sourcePageId: 'source',
      sourcePageTitle: '源页面',
      component: 'test.frame',
      nodeCount: 3,
    });
    expect(Object.keys(summary).sort()).toEqual(
      ['available', 'component', 'nodeCount', 'sourcePageId', 'sourcePageTitle'].sort(),
    );
    expect(document.getClipboardSnapshot()).toBe(summary);
    expect(document.getSnapshot()).toBe(before);
    expect(document.exportJson()).toBe(exported);
    expect(main).not.toHaveBeenCalled();
    expect(clipboard).toHaveBeenCalledTimes(1);
    stop();
    document.clearClipboard();
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toMatchObject({ available: false, nodeCount: 0 });
  });
  it('does not consume IDs,clear redo,end document history or change selection during copy', () => {
    const { document } = setup(),
      { document: control } = setup();
    for (const doc of [document, control]) {
      doc.setProp('source', 'leaf', 'text', literal('changed'));
      doc.undo();
    }
    const before = document.getSnapshot();
    document.copyNodeToClipboard('source', 'frame');
    expect(document.getSnapshot()).toBe(before);
    expect(document.getSnapshot().canRedo).toBe(true);
    control.copyNodeToClipboard('source', 'frame');
    expect(document.pasteClipboard('target')).toBe(control.pasteClipboard('target'));
    expect(document.exportJson()).toBe(control.exportJson());
  });
  it.each(['missing-page', 'missing-node', 'wrong-page'])(
    'failed capture %s preserves last valid clipboard and all document state',
    (kind) => {
      const { document } = setup();
      document.copyNodeToClipboard('source', 'frame');
      const before = document.getSnapshot(),
        clipboard = document.getClipboardSnapshot(),
        notify = vi.fn();
      document.subscribeClipboard(notify);
      expect(() =>
        document.copyNodeToClipboard(
          kind === 'missing-page' ? 'missing' : kind === 'wrong-page' ? 'target' : 'source',
          kind === 'missing-node' ? 'missing' : 'frame',
        ),
      ).toThrow();
      expect(document.getClipboardSnapshot()).toBe(clipboard);
      expect(document.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
    },
  );
  it.each(['expression', 'stateRef', 'dataRef', 'fieldRef', 'formValues'] as const)(
    'rejects %s Value in children and retains prior clipboard',
    (kind) => {
      const bad = staticTree(),
        values: Record<typeof kind, Value> = {
          expression: expression('"constant"'),
          stateRef: { kind: 'stateRef', stateId: 'caption' },
          dataRef: { kind: 'dataRef', sourceId: 'records' },
          fieldRef: { kind: 'fieldRef', formId: 'model', fieldId: 'name' },
          formValues: { kind: 'formValues', formId: 'model' },
        };
      bad.children![0].props.payload = values[kind];
      const { document } = setup([staticLeaf('good'), bad]);
      document.copyNodeToClipboard('source', 'good');
      const before = document.getSnapshot(),
        clipboard = document.getClipboardSnapshot();
      expect(() => document.copyNodeToClipboard('source', 'frame')).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(clipboard);
    },
  );
  it.each(['child', 'slot'] as const)(
    'rejects dynamic style,when,repeat,action,extension and model conventions in %s descendants',
    (placement) => {
      const patches: ((n: NodeSchema) => void)[] = [
        (n) => {
          n.style = { color: { kind: 'stateRef', stateId: 'color' } };
        },
        (n) => {
          n.when = literal(true);
        },
        (n) => {
          n.repeat = {
            items: literal([{ id: 'x' }]),
            item: 'item',
            key: expression('scope.item.id'),
          };
        },
        (n) => {
          n.on = { onClick: [{ id: 'effect-call', action: 'test.effect', input: {} }] };
        },
        (n) => {
          n.extensions = { 'test:opaque': { nodeId: 'leaf' } };
        },
        (n) => {
          n.props.formId = literal('model');
        },
        (n) => {
          n.props.arrayId = literal('rows');
        },
      ];
      for (const patch of patches) {
        const tree = staticTree(),
          candidate = staticLeaf('bad');
        patch(candidate);
        if (placement === 'child') tree.children = [candidate];
        else tree.slots!.footer.children = [candidate];
        const { document } = setup([staticLeaf('good'), tree]);
        document.copyNodeToClipboard('source', 'good');
        const before = document.getSnapshot(),
          captured = document.getClipboardSnapshot();
        expect(() => document.copyNodeToClipboard('source', 'frame')).toThrow();
        expect(document.getSnapshot()).toBe(before);
        expect(document.getClipboardSnapshot()).toBe(captured);
      }
    },
  );
  it.each(['test.form', 'test.array', 'ui.form'])(
    'rejects unbound contract-owned context component %s recursively',
    (component) => {
      const tree = staticTree();
      tree.slots!.footer.children = [{ id: 'context', component, props: {} }];
      const { document } = setup([tree]);
      expect(() => document.copyNodeToClipboard('source', 'frame')).toThrow();
    },
  );
  it('rejects formId and bound fields but permits ordinary unbound field-capable input', () => {
    const bound: NodeSchema = {
        id: 'bound',
        component: 'ui.input',
        props: {},
        field: { formId: 'model', fieldId: 'name' },
      },
      wrap: NodeSchema = {
        id: 'outer-form',
        component: 'ui.form',
        formId: 'model',
        props: {},
        children: [{ id: 'bound-wrap', component: 'ui.layout', props: {}, children: [bound] }],
      };
    const { document } = setup([
      wrap,
      {
        id: 'unbound',
        component: 'ui.input',
        props: { label: literal('Static input'), value: literal('static input') },
      },
    ]);
    for (const id of ['outer-form', 'bound-wrap', 'bound'])
      expect(() => document.copyNodeToClipboard('source', id)).toThrow();
    expect(() => document.copyNodeToClipboard('source', 'unbound')).not.toThrow();
    expect(document.getClipboardSnapshot().component).toBe('ui.input');
  });
  it('permits empty actions/extensions without treating opaque JSON as references', () => {
    const tree = staticTree();
    tree.children![0].on = { onClick: [] };
    tree.children![0].extensions = {};
    const { document } = setup([tree]);
    document.copyNodeToClipboard('source', 'frame');
    const id = document.pasteClipboard('target'),
      copied = node(document, id);
    expect(copied.props.payload).toEqual(tree.props.payload);
    expect(copied.children![0].props).toEqual(tree.children![0].props);
    expect(copied.style).toEqual(tree.style);
    expect(copied.children![0].style).toEqual(tree.children![0].style);
    expect(Object.values(copied.children![0].on ?? {}).flat()).toEqual([]);
    expect(Object.keys(copied.children![0].extensions ?? {})).toEqual([]);
  });
  it('rejects source enabled code but captured snapshot survives source code later enabling', () => {
    const { document } = setup(),
      code = page(document, 'source').code!;
    document.setPageCode('source', { ...code, enabled: true });
    expect(() => document.copyNodeToClipboard('source', 'frame')).toThrow();
    document.setPageCode('source', code);
    document.copyNodeToClipboard('source', 'frame');
    const captured = document.getClipboardSnapshot();
    document.setPageCode('source', { ...code, enabled: true });
    expect(() => document.pasteClipboard('target')).not.toThrow();
    expect(document.getClipboardSnapshot()).toBe(captured);
    expect((globalThis as Record<string, unknown>).__clipboardCommandExecuted).toBeUndefined();
  });
});

describe('clipboard lifetime outside Schema/history', () => {
  it('retains copy-time tree across source edit,selection,page removal and Undo/Redo', () => {
    const { document } = setup(),
      original = staticTree();
    document.copyNodeToClipboard('source', 'frame');
    const captured = document.getClipboardSnapshot();
    document.setProp('source', 'leaf', 'text', literal('later source change'));
    document.selectPage('target');
    document.removePage('source', 'target');
    document.undo();
    document.redo();
    expect(document.getClipboardSnapshot()).toBe(captured);
    const id = document.pasteClipboard('target');
    expect(withoutIds(node(document, id))).toEqual(withoutIds(original));
    expect(document.getSnapshot().plan.pages.has('source')).toBe(false);
  });
  it('Undo does not revert the clipboard and copy alone never adds history', () => {
    const { document } = setup();
    document.copyNodeToClipboard('source', 'frame');
    document.pasteClipboard('target');
    document.copyNodeToClipboard('source', 'leaf');
    const later = document.getClipboardSnapshot();
    document.undo();
    expect(document.getClipboardSnapshot()).toBe(later);
    document.redo();
    expect(document.getClipboardSnapshot()).toBe(later);
    const fresh = setup().document;
    fresh.copyNodeToClipboard('source', 'frame');
    expect(fresh.getSnapshot().canUndo).toBe(false);
    fresh.undo();
    expect(fresh.getClipboardSnapshot().available).toBe(true);
  });
  it.each(['replace', 'importJson'] as const)(
    'successful equal-content %s clears without publishing a document change',
    (method) => {
      const { document } = setup();
      document.copyNodeToClipboard('source', 'frame');
      const before = document.getSnapshot(),
        notify = vi.fn();
      document.subscribeClipboard(notify);
      const result =
        method === 'replace'
          ? document.replace(JSON.parse(document.exportJson()))
          : document.importJson(document.exportJson());
      expect(result).toBe(false);
      expect(document.getClipboardSnapshot().available).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      expect(notify).toHaveBeenCalledTimes(1);
    },
  );
  it('changed import clears and Undo does not restore old capture;failed imports preserve capture/redo', () => {
    const { document, schema } = setup();
    document.copyNodeToClipboard('source', 'frame');
    const replacement = structuredClone(schema);
    replacement.title = 'new application';
    document.replace(replacement);
    expect(document.getClipboardSnapshot().available).toBe(false);
    document.undo();
    expect(document.getClipboardSnapshot().available).toBe(false);
    document.copyNodeToClipboard('source', 'frame');
    const before = document.getSnapshot(),
      captured = document.getClipboardSnapshot();
    for (const source of ['{', JSON.stringify({ ...schema, entryPageId: 'missing' })]) {
      expect(() => document.importJson(source)).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(captured);
    }
    expect(document.getSnapshot().canRedo).toBe(true);
  });
  it('does not export,persist or transfer clipboard to a new/reloaded Document', () => {
    const { document, registry } = setup();
    document.copyNodeToClipboard('source', 'frame');
    const exported = document.exportJson();
    expect(exported).not.toContain('sourcePageId');
    expect(JSON.parse(exported)).not.toHaveProperty('clipboard');
    const next = new EditorDocument(JSON.parse(exported), registry);
    expect(next.getClipboardSnapshot()).toMatchObject({ available: false, nodeCount: 0 });
    expect(() => next.pasteClipboard('target')).toThrow();
    document.clearClipboard();
    expect(() => document.checkPasteClipboard('target')).toThrow();
    expect(() => document.pasteClipboard('target')).toThrow();
  });
});

describe('clipboard pure preparation and atomic paste', () => {
  it.each(['form', 'fieldArray'] as const)(
    'rechecks captured current contract %s ownership before paste',
    (flag) => {
      const { document, registry } = setup();
      document.copyNodeToClipboard('source', 'frame');
      const before = document.getSnapshot(),
        clipboard = document.getClipboardSnapshot();
      registry.components['test.slotLeaf'] = {
        ...registry.components['test.slotLeaf'],
        [flag]: true,
      };
      expect(() => document.checkPasteClipboard('target')).toThrow();
      expect(() => document.pasteClipboard('target')).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(clipboard);
    },
  );
  it('pastes same/cross-page with fresh recursive IDs,deep detached data,registered slots and no page data migration', () => {
    const { document } = setup(),
      sourceBefore = page(document, 'source'),
      targetBefore = structuredClone(page(document));
    document.copyNodeToClipboard('source', 'frame');
    const captured = document.getClipboardSnapshot();
    const a = document.pasteClipboard('source'),
      b = document.pasteClipboard('target'),
      c = document.pasteClipboard('target');
    const trees = [node(document, a, 'source'), node(document, b), node(document, c)],
      all = ['frame', 'leaf', 'slot-leaf', ...trees.flatMap(nodeIds)];
    expect(new Set(all).size).toBe(all.length);
    for (const copy of trees) {
      expect(withoutIds(copy)).toEqual(withoutIds(staticTree()));
      expect(copy.props.payload).not.toBe(sourceBefore.children[0].props.payload);
      expect(copy.slots!.footer.params).toEqual(['record']);
    }
    expect(trees[0].children![0].props.payload).not.toBe(trees[1].children![0].props.payload);
    expect(trees[1].style).not.toBe(trees[2].style);
    const { children: _children, ...targetData } = page(document),
      { children: _oldChildren, ...originalTargetData } = targetBefore;
    expect(targetData).toEqual(originalTargetData);
    expect(document.getClipboardSnapshot()).toBe(captured);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'target', nodeId: c });
    expect((globalThis as Record<string, unknown>).__clipboardCommandExecuted).toBeUndefined();
  });
  it('one Undo/Redo restores full tree,prior selection and exact export', () => {
    const { document } = setup();
    document.select('target', 'target-leaf');
    document.copyNodeToClipboard('source', 'frame');
    const before = document.exportJson(),
      oldSelection = document.getSnapshot().selection,
      captured = document.getClipboardSnapshot(),
      revision = document.getSnapshot().revision;
    const id = document.pasteClipboard('target'),
      pasted = document.exportJson();
    expect(document.getSnapshot().revision).toBe(revision + 1);
    expect(nodeIds(node(document, id))).toHaveLength(3);
    document.undo();
    expect(document.exportJson()).toBe(before);
    expect(document.getSnapshot().selection).toEqual(oldSelection);
    expect(document.getSnapshot().canUndo).toBe(false);
    expect(document.getClipboardSnapshot()).toBe(captured);
    document.redo();
    expect(document.exportJson()).toBe(pasted);
    expect(document.getSnapshot().selection.nodeId).toBe(id);
  });
  it('repeated preflights and all failed targets preserve snapshot,redo,clipboard and eventual IDs', () => {
    const { document } = setup(),
      { document: control } = setup();
    for (const doc of [document, control]) {
      doc.setProp('source', 'leaf', 'text', literal('edited'));
      doc.undo();
      doc.copyNodeToClipboard('source', 'frame');
    }
    const before = document.getSnapshot(),
      captured = document.getClipboardSnapshot();
    const targets: InsertTarget[] = [
      { parentId: 'missing' },
      { parentId: 'target-leaf' },
      { parentId: 'target-frame', slot: 'missing' },
      { slot: 'footer' },
      { index: -1 },
      { index: 0.5 },
      { index: 3 },
    ];
    for (let i = 0; i < 3; i++) document.checkPasteClipboard('target');
    for (const target of targets) {
      expect(() => document.checkPasteClipboard('target', target)).toThrow();
      expect(() => document.pasteClipboard('target', target)).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(captured);
    }
    expect(() => document.pasteClipboard('missing')).toThrow();
    expect(document.getSnapshot().canRedo).toBe(true);
    expect(document.pasteClipboard('target')).toBe(control.pasteClipboard('target'));
    expect(document.exportJson()).toBe(control.exportJson());
  });
  it.each([
    { parentId: 'target-frame', index: 0 },
    { parentId: 'target-frame', slot: 'footer', index: 0 },
    { index: 0 },
  ])('supports exact target %j with matching check/paste semantics', (target) => {
    const { document } = setup();
    document.copyNodeToClipboard('source', 'frame');
    document.checkPasteClipboard('target', target);
    const id = document.pasteClipboard('target', target);
    expect(findNode(page(document), id)).toMatchObject({
      index: 0,
      ...(target.parentId ? { parentId: target.parentId } : {}),
      ...('slot' in target ? { slot: target.slot } : {}),
    });
  });
  it('rejects code-enabled destination without consuming IDs or changing redo', () => {
    const { document } = setup(),
      { document: control } = setup();
    for (const doc of [document, control]) {
      doc.copyNodeToClipboard('source', 'frame');
      const code = page(doc).code!;
      doc.setPageCode('target', { ...code, enabled: true });
    }
    const before = document.getSnapshot(),
      captured = document.getClipboardSnapshot();
    expect(() => document.checkPasteClipboard('target')).toThrow();
    expect(() => document.pasteClipboard('target')).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toBe(captured);
    for (const doc of [document, control]) doc.undo();
    expect(document.pasteClipboard('target')).toBe(control.pasteClipboard('target'));
    expect(document.exportJson()).toBe(control.exportJson());
  });
  it.each(['test.frame', 'test.leaf', 'test.slotLeaf'])(
    'rechecks captured dependency %s and preserves pure failures',
    (component) => {
      const { document, registry } = setup(),
        { document: control } = setup();
      document.copyNodeToClipboard('source', 'frame');
      control.copyNodeToClipboard('source', 'frame');
      const before = document.getSnapshot(),
        captured = document.getClipboardSnapshot(),
        original = registry.components[component].version;
      registry.components[component].version = '9.9.9';
      expect(() => document.checkPasteClipboard('target')).toThrow();
      expect(() => document.pasteClipboard('target')).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(document.getClipboardSnapshot()).toBe(captured);
      registry.components[component].version = original;
      expect(document.pasteClipboard('target')).toBe(control.pasteClipboard('target'));
      expect(document.exportJson()).toBe(control.exportJson());
    },
  );
  it('retains captured dependency requirements even if old insertNode publishes a newer matching registry pin', () => {
    const { document, registry } = setup();
    document.copyNodeToClipboard('source', 'frame');
    registry.components['test.leaf'].version = '9.9.9';
    document.insertNode('target', {
      id: 'new-version-leaf',
      component: 'test.leaf',
      props: { text: literal('new version') },
    });
    expect(document.getSnapshot().plan.schema.dependencies.components['test.leaf']).toBe('9.9.9');
    const before = document.getSnapshot();
    expect(() => document.pasteClipboard('target')).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });
  it('rejects missing registered captured component and compile-contract changes atomically', () => {
    const { document, registry } = setup();
    document.copyNodeToClipboard('source', 'frame');
    const before = document.getSnapshot(),
      captured = document.getClipboardSnapshot(),
      old = registry.components['test.slotLeaf'];
    delete registry.components['test.slotLeaf'];
    expect(() => document.pasteClipboard('target')).toThrow();
    expect(document.getSnapshot()).toBe(before);
    registry.components['test.slotLeaf'] = old;
    registry.components['test.slotLeaf'] = { ...old, validateProps: () => ['contract changed'] };
    expect(() => document.checkPasteClipboard('target')).toThrow();
    expect(() => document.pasteClipboard('target')).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toBe(captured);
  });
  it('allocates against existing destination node,action and page-entry IDs', () => {
    const { schema, registry } = setup();
    const candidateIds = Array.from({ length: 18 }, (_, index) =>
      ['test-frame', 'test-leaf', 'test-slotLeaf'].map((name) => `${name}-${index + 1}`),
    ).flat();
    schema.pages[1].onEnter = candidateIds
      .filter((_, index) => index % 2 === 0)
      .map((id) => ({ id, action: 'test.effect', input: {} }));
    schema.pages[1].children[1].on = {
      onClick: candidateIds
        .filter((_, index) => index % 2 !== 0)
        .map((id) => ({ id, action: 'test.effect', input: {} })),
    };
    const document = new EditorDocument(schema, registry);
    document.copyNodeToClipboard('source', 'frame');
    const id = document.pasteClipboard('target'),
      pastedIds = nodeIds(node(document, id));
    expect(pastedIds.some((value) => candidateIds.includes(value))).toBe(false);
    expect(new Set(page(document).children.flatMap(nodeIds)).size).toBe(
      page(document).children.flatMap(nodeIds).length,
    );
  });
});
