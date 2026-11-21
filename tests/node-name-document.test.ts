import { describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { inspectClipboardTree } from '../packages/editor/node-clipboard';
import { selectionApplication, selectionRegistry, lit } from './multiselection-fixture';
import { clipboardApplication, fixtureRegistry, staticLeaf, staticTree } from './clipboard-fixture';
const key = 'dimlu:node-name';
const node = (doc: EditorDocument, id = 'alpha', page = 'a') =>
  findNode(doc.getSnapshot().plan.pages.get(page)!.schema, id)!.node;
const author = () => new EditorDocument(selectionApplication(), selectionRegistry());

describe('atomic author name command, full raw selection and history', () => {
  it('changes only owned extension and preserves full raw ancestor selection through Undo/Redo', () => {
    const doc = author();
    doc.selectMany('a', ['tail', 'alpha', 'root', 'slot-leaf'], 'slot-leaf');
    const before = doc.getSnapshot();
    const schema = structuredClone(before.plan.schema);
    expect(doc.setNodeName('a', 'alpha', ' \r\n采购 😀\t')).toBe(true);
    const expected = structuredClone(schema);
    expected.pages[0].children[0].children![0].extensions = { [key]: '采购 😀' };
    expect(doc.getSnapshot().plan.schema).toEqual(expected);
    expect(doc.getSnapshot().selection).toEqual(before.selection);
    doc.undo();
    expect(doc.getSnapshot().plan.schema).toEqual(schema);
    expect(doc.getSnapshot().selection).toEqual(before.selection);
    doc.redo();
    expect(doc.getSnapshot().plan.schema).toEqual(expected);
    expect(doc.getSnapshot().selection).toEqual(before.selection);
  });
  it('isolates each Apply and neighboring property groups', () => {
    const doc = author();
    doc.setProp('a', 'alpha', 'value', lit('before 1'), 'continuous');
    doc.setProp('a', 'alpha', 'value', lit('before 2'), 'continuous');
    doc.setNodeName('a', 'alpha', 'First');
    doc.setNodeName('a', 'alpha', 'Second');
    doc.setProp('a', 'alpha', 'value', lit('after'), 'continuous');
    doc.undo();
    expect(node(doc).props.value).toEqual(lit('before 2'));
    expect(node(doc).extensions?.[key]).toBe('Second');
    doc.undo();
    expect(node(doc).extensions?.[key]).toBe('First');
    doc.undo();
    expect(node(doc).extensions).toBeUndefined();
    expect(node(doc).props.value).toEqual(lit('before 2'));
    doc.undo();
    expect(node(doc).props.value).toEqual(lit('Alpha text'));
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it.each(['absent', 'empty', 'equal'] as const)(
    'true %s no-op preserves snapshot identity, empty bag, redo and notifications',
    (kind) => {
      const schema = selectionApplication();
      if (kind === 'empty') schema.pages[0].children[0].children![0].extensions = {};
      if (kind === 'equal') schema.pages[0].children[0].children![0].extensions = { [key]: 'Name' };
      const doc = new EditorDocument(schema, selectionRegistry());
      doc.setProp('a', 'alpha', 'value', lit('temporary'));
      doc.undo();
      const snapshot = doc.getSnapshot(),
        notify = vi.fn();
      doc.subscribe(notify);
      expect(doc.setNodeName('a', 'alpha', kind === 'equal' ? ' Name ' : ' \r\n')).toBe(false);
      expect(doc.getSnapshot()).toBe(snapshot);
      expect(notify).not.toHaveBeenCalled();
      expect(snapshot.canRedo).toBe(true);
      expect(node(doc).extensions).toEqual(
        kind === 'empty' ? {} : kind === 'equal' ? { [key]: 'Name' } : undefined,
      );
      doc.redo();
      expect(node(doc).props.value).toEqual(lit('temporary'));
    },
  );
  it.each([false, true])(
    'clear removes only owned key; opaque siblings retained=%s',
    (siblings) => {
      const schema = selectionApplication();
      schema.pages[0].children[0].children![0].extensions = {
        [key]: 'Name',
        ...(siblings ? { 'test:other': { id: 'alpha', nested: ['Name'] } } : {}),
      };
      const doc = new EditorDocument(schema, selectionRegistry());
      expect(doc.setNodeName('a', 'alpha', '')).toBe(true);
      expect(node(doc).extensions).toEqual(
        siblings ? { 'test:other': { id: 'alpha', nested: ['Name'] } } : undefined,
      );
      doc.undo();
      expect(node(doc).extensions?.[key]).toBe('Name');
    },
  );
  it.each(['missing-page', 'missing-node', 'control', 'length', 'non-string'] as const)(
    '%s failure is atomic with prior clipboard and redo',
    (kind) => {
      const doc = author();
      doc.copyNodeToClipboard('a', 'tail');
      doc.setNodeName('a', 'alpha', 'temporary');
      doc.undo();
      const before = doc.getSnapshot(),
        clipboard = doc.getClipboardSnapshot(),
        notify = vi.fn();
      doc.subscribe(notify);
      const input =
        kind === 'control'
          ? 'a\nb'
          : kind === 'length'
            ? '😀'.repeat(81)
            : kind === 'non-string'
              ? (12 as never)
              : 'Name';
      expect(() =>
        doc.setNodeName(
          kind === 'missing-page' ? 'missing' : 'a',
          kind === 'missing-node' ? 'missing' : 'alpha',
          input,
        ),
      ).toThrow();
      expect(doc.getSnapshot()).toBe(before);
      expect(doc.getClipboardSnapshot()).toBe(clipboard);
      expect(notify).not.toHaveBeenCalled();
    },
  );
  it('invalid import rejects before adoption and retains clipboard/history/selection', () => {
    const doc = author();
    doc.selectMany('a', ['alpha', 'tail'], 'tail');
    doc.copyNodeToClipboard('a', 'tail');
    const bad = structuredClone(doc.getSnapshot().plan.schema);
    bad.pages[0].children[0].extensions = { [key]: ' bad' };
    const before = doc.getSnapshot(),
      clipboard = doc.getClipboardSnapshot();
    expect(() => doc.importJson(JSON.stringify(bad))).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    expect(doc.getClipboardSnapshot()).toBe(clipboard);
  });
  it('same-page bulk and whole-page clones preserve names and unknown extension payloads', () => {
    const schema = selectionApplication();
    const extensions = {
      [key]: 'Duplicate allowed',
      'test:opaque': { id: 'alpha', name: 'Duplicate allowed' },
    };
    schema.pages[0].children[0].children![0].extensions = extensions;
    const doc = new EditorDocument(schema, selectionRegistry());
    const one = doc.duplicateNode('a', 'alpha');
    expect(node(doc, one).extensions).toEqual(extensions);
    const many = doc.duplicateNodes('a', ['alpha', 'tail']);
    expect(node(doc, many[0]).extensions).toEqual(extensions);
    const page = doc.duplicatePage('a');
    expect(node(doc, 'alpha', page).extensions).toEqual(extensions);
    expect(() => doc.copyNodeToClipboard('a', 'alpha')).toThrow();
  });
});

describe('portable static clipboard exact author-name whitelist', () => {
  it('captures names recursively, freezes the capture and reidentifies repeat pastes without rewriting names', () => {
    const tree = staticTree();
    tree.extensions = { [key]: 'frame' };
    tree.children![0].extensions = { [key]: 'leaf' };
    tree.slots!.footer.children[0].extensions = { [key]: 'slot-leaf' };
    const registry = fixtureRegistry(),
      doc = new EditorDocument(clipboardApplication([tree], registry), registry);
    doc.copyNodeToClipboard('source', 'frame');
    doc.setNodeName('source', 'frame', 'Later name');
    const first = doc.pasteClipboard('target'),
      second = doc.pasteClipboard('target');
    expect(first).not.toBe(second);
    for (const id of [first, second]) {
      const pasted = node(doc, id, 'target');
      expect(pasted.extensions).toEqual({ [key]: 'frame' });
      expect(pasted.children![0].extensions?.[key]).toBe('leaf');
      expect(pasted.slots!.footer.children[0].extensions?.[key]).toBe('slot-leaf');
    }
  });
  it.each(['root', 'child', 'slot'] as const)(
    'rejects any unknown sibling on %s recursively, retaining earlier good capture',
    (placement) => {
      const tree = staticTree();
      const target =
        placement === 'root'
          ? tree
          : placement === 'child'
            ? tree.children![0]
            : tree.slots!.footer.children[0];
      target.extensions = { [key]: 'Safe name', 'test:opaque': { preserve: true } };
      const registry = fixtureRegistry(),
        doc = new EditorDocument(
          clipboardApplication([staticLeaf('good'), tree], registry),
          registry,
        );
      doc.copyNodeToClipboard('source', 'good');
      const before = doc.getSnapshot(),
        clipboard = doc.getClipboardSnapshot();
      expect(() => doc.copyNodeToClipboard('source', 'frame')).toThrow();
      expect(doc.getSnapshot()).toBe(before);
      expect(doc.getClipboardSnapshot()).toBe(clipboard);
    },
  );
  it.each(['', ' bad', 'a\nb', null, 80, {}])(
    'inspection independently rejects malformed raw author metadata %j',
    (value) => {
      const tree = staticTree();
      tree.slots!.footer.children[0].extensions = { [key]: value };
      expect(() => inspectClipboardTree(tree, fixtureRegistry())).toThrow();
    },
  );
  it.each([undefined, {}])('continues accepting absent or empty extension bag %j', (extensions) => {
    const tree = staticTree();
    tree.extensions = extensions;
    expect(() => inspectClipboardTree(tree, fixtureRegistry())).not.toThrow();
  });
});
