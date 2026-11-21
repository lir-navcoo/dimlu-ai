import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { validateCatalog } from '../packages/editor/metadata';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
import { catalog } from '../src/editor/catalog';

const literal = (value: string) => ({ kind: 'literal' as const, value });
const make = (limit = 100) => new EditorDocument(exampleApplication, registry, limit);
const title = (doc: EditorDocument) =>
  findNode(doc.getSnapshot().plan.pages.get('purchase')!.schema, 'purchase-heading')!.node.props
    .title;
describe('validated editor document', () => {
  it('keeps selection changes outside document history and runtime plans', () => {
    const doc = make(),
      plan = doc.getSnapshot().plan;
    let notifications = 0;
    const unsubscribe = doc.subscribe(() => notifications++);
    doc.select('purchase', 'purchase-name');
    expect(doc.getSnapshot().plan).toBe(plan);
    expect(doc.getSnapshot().canUndo).toBe(false);
    expect(doc.getSnapshot().revision).toBe(0);
    unsubscribe();
    doc.selectPage('people');
    expect(notifications).toBe(1);
    expect(() => doc.select('purchase', 'missing')).toThrow();
  });
  it('rejects invalid edits atomically and preserves redo through failures and no-ops', () => {
    const doc = make();
    doc.setProp('purchase', 'purchase-heading', 'title', literal('changed'));
    doc.undo();
    const snapshot = doc.getSnapshot();
    expect(() => doc.setProp('purchase', 'purchase-heading', 'title', undefined)).toThrow();
    expect(() =>
      doc.setProp('purchase', 'purchase-heading', 'title', {
        kind: 'expression',
        language: 'javascript',
        source: 'state.',
      }),
    ).toThrow();
    expect(() => doc.importJson('{')).toThrow();
    expect(doc.replace(exampleApplication)).toBe(false);
    expect(doc.getSnapshot()).toBe(snapshot);
    doc.redo();
    expect(title(doc)).toEqual(literal('changed'));
  });
  it('coalesces a focus session, bounds history and discards redo after branching', () => {
    const doc = make(2);
    doc.setProp('purchase', 'purchase-heading', 'title', literal('A'), 'focus1');
    doc.setProp('purchase', 'purchase-heading', 'title', literal('AB'), 'focus1');
    doc.undo();
    expect(title(doc)).toEqual(literal('创建采购申请'));
    doc.redo();
    doc.endGroup();
    doc.setProp('purchase', 'purchase-heading', 'title', literal('B'), 'focus1');
    doc.setProp('purchase', 'purchase-heading', 'title', literal('C'), 'focus2');
    doc.undo();
    doc.undo();
    expect(title(doc)).toEqual(literal('AB'));
    expect(doc.getSnapshot().canUndo).toBe(false);
    doc.setProp('purchase', 'purchase-heading', 'title', literal('branch'));
    expect(doc.getSnapshot().canRedo).toBe(false);
  });
  it('inserts unique IDs, dependencies and slot children, and restores deleted subtree selection', () => {
    const doc = make();
    const a = doc.insertNode('composition', {
      component: 'ui.recordCard',
      props: { record: { kind: 'literal', value: { name: 'A' } } },
    });
    const b = doc.insertNode(
      'composition',
      { component: 'ui.heading', props: { title: literal('inside') } },
      { parentId: a, slot: 'header' },
    );
    expect(findNode(doc.getSnapshot().plan.pages.get('composition')!.schema, b)?.slot).toBe(
      'header',
    );
    doc.removeNode('composition', a);
    expect(doc.getSnapshot().selection.nodeId).not.toBe(b);
    doc.undo();
    expect(doc.getSnapshot().selection.nodeId).toBe(b);
    expect(
      findNode(doc.getSnapshot().plan.pages.get('composition')!.schema, b)?.node.props.title,
    ).toEqual(literal('inside'));
    const c = doc.insertNode('composition', {
      component: 'ui.heading',
      props: { title: literal('sibling') },
    });
    expect(c).not.toBe(b);
    expect(doc.getSnapshot().plan.schema.dependencies.components['ui.heading']).toBe('1.0.0');
  });
  it('validates insertion capabilities and duplicate IDs before publishing', () => {
    const doc = make(),
      snapshot = doc.getSnapshot(),
      node = { component: 'ui.heading', props: { title: literal('x') } };
    for (const target of [
      { parentId: 'purchase-heading' },
      { parentId: 'purchase-heading', slot: 'body' },
      { slot: 'body' },
      { index: -1 },
    ])
      expect(() => doc.insertNode('purchase', node, target)).toThrow();
    expect(() => doc.insertNode('purchase', { ...node, id: 'purchase-heading' })).toThrow();
    expect(doc.getSnapshot()).toBe(snapshot);
    expect(() => doc.setProp('purchase', 'purchase-name', 'value', literal('conflict'))).toThrow();
    expect(() =>
      doc.setProp('purchase', 'purchase-heading', 'constructor', literal('unsafe')),
    ).toThrow();
  });
  it('roundtrips complete definitions, references and namespaced extensions through JSON and undo', () => {
    const input = structuredClone(exampleApplication);
    input.extensions = { 'test:editor': { enabled: true } };
    const doc = new EditorDocument(input, registry);
    doc.setProp('purchase', 'purchase-heading', 'title', {
      kind: 'expression',
      language: 'javascript',
      source: '"标题：" + forms.purchase.values.name',
    });
    const exported = doc.exportJson(),
      restored = make();
    restored.importJson(exported);
    expect(restored.exportJson()).toBe(exported);
    expect(restored.getSnapshot().plan.schema.extensions).toEqual(input.extensions);
    restored.undo();
    expect(restored.exportJson()).toBe(make().exportJson());
    restored.redo();
    expect(restored.exportJson()).toBe(exported);
  });
  it('checks host metadata against runtime contracts', () => {
    expect(validateCatalog(catalog, registry)).toEqual([]);
    const invalid = structuredClone(catalog);
    invalid['ui.heading'].properties[0].setter = { kind: 'number' };
    delete invalid['ui.heading'].defaultProps.title;
    expect(validateCatalog(invalid, registry)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('类型不匹配'),
        expect.stringContaining('缺少默认属性'),
      ]),
    );
    invalid['ui.heading'].defaultProps.title = 5;
    expect(validateCatalog(invalid, registry).some((e) => e.includes('默认属性无效'))).toBe(true);
  });
});
