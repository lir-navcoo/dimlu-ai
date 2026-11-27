import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { NodeSchema } from '../packages/schema/types';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';

const make = () => new EditorDocument(exampleApplication, registry);
const page = (doc: EditorDocument, id = 'purchase') => doc.getSnapshot().plan.pages.get(id)!.schema;
describe('structure commands', () => {
  it('moves by final index within one list, detects no-ops and restores selection with undo', () => {
    const doc = make();
    doc.select('purchase', 'purchase-name');
    const original = doc.exportJson();
    doc.moveNode('purchase', 'purchase-heading', { index: 1 });
    expect(page(doc).children.map((n) => n.id)).toEqual([
      'purchase-heading-note',
      'purchase-heading',
      'purchase-form',
    ]);
    expect(doc.getSnapshot().selection.nodeId).toBe('purchase-heading');
    const moved = doc.getSnapshot();
    expect(doc.moveNode('purchase', 'purchase-heading', { index: 1 })).toBe(false);
    expect(doc.getSnapshot()).toBe(moved);
    doc.undo();
    expect(doc.exportJson()).toBe(original);
    expect(doc.getSnapshot().selection.nodeId).toBe('purchase-name');
    doc.redo();
    expect(page(doc).children[1].id).toBe('purchase-heading');
  });
  it('reparents into containers and named slots without changing identity, bindings or actions', () => {
    const doc = make(),
      original = findNode(page(doc), 'purchase-submit')!.node;
    doc.moveNode('purchase', 'purchase-submit', { parentId: 'purchase-note' });
    const moved = findNode(page(doc), 'purchase-submit')!;
    expect(moved.parentId).toBe('purchase-note');
    expect(moved.node).toEqual(original);
    doc.moveNode('composition', 'composition-heading', {
      parentId: 'person-card',
      slot: 'footer',
      index: 0,
    });
    expect(findNode(page(doc, 'composition'), 'composition-heading')).toMatchObject({
      parentId: 'person-card',
      slot: 'footer',
      index: 0,
    });
    doc.undo();
    expect(findNode(page(doc, 'composition'), 'composition-heading')!.parentId).toBeUndefined();
  });
  it('rejects cycles, invalid destinations and invalid indexes atomically', () => {
    const doc = make(),
      before = doc.getSnapshot();
    for (const target of [
      { parentId: 'purchase-form' },
      { parentId: 'purchase-note' },
      { parentId: 'purchase-submit' },
    ])
      expect(() => doc.moveNode('purchase', 'purchase-form', target)).toThrow('不能移动到自身');
    for (const target of [
      { parentId: 'missing' },
      { parentId: 'purchase-heading' },
      { parentId: 'purchase-note', slot: 'missing' },
      { slot: 'header' },
      { index: 3 },
      { index: -1 },
      { index: 0.5 },
    ])
      expect(() => doc.moveNode('purchase', 'purchase-heading', target)).toThrow();
    expect(() => doc.moveNode('purchase', 'missing')).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });
  it('copies entire subtrees including slot children and regenerates page-wide node and action IDs', () => {
    const doc = make();
    const id = doc.duplicateNode('purchase', 'purchase-form');
    const source = findNode(page(doc), 'purchase-form')!.node,
      copy = findNode(page(doc), id)!.node;
    expect(page(doc).children.map((n) => n.id)).toEqual([
      'purchase-heading',
      'purchase-heading-note',
      'purchase-form',
      id,
    ]);
    const ids = (node: NodeSchema): string[] => [
      node.id,
      ...Object.values(node.on ?? {}).flatMap((calls) => calls.map((call) => call.id)),
      ...(node.children ?? []).flatMap(ids),
      ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children.flatMap(ids)),
    ];
    const originalIds = ids(source),
      copiedIds = ids(copy);
    expect(copiedIds).toHaveLength(originalIds.length);
    expect(copiedIds.some((id) => originalIds.includes(id))).toBe(false);
    expect(new Set([...originalIds, ...copiedIds]).size).toBe(
      originalIds.length + copiedIds.length,
    );
    expect(copy.formId).toBe(source.formId);
    const copiedField = copy.children!.find((n) => n.field);
    expect(copiedField?.field).toEqual({ formId: 'purchase', fieldId: 'name' });
    expect(copy.on?.onSubmit?.[0].action).toBe(source.on?.onSubmit?.[0].action);
    expect(doc.getSnapshot().selection.nodeId).toBe(id);
    doc.undo();
    expect(findNode(page(doc), id)).toBeUndefined();
    doc.redo();
    expect(findNode(page(doc), id)).toBeDefined();
    const card = doc.duplicateNode('composition', 'person-card');
    const copiedCard = findNode(page(doc, 'composition'), card)!.node;
    expect(copiedCard.slots?.header.params).toEqual(['record']);
    expect(copiedCard.slots?.header.children[0].id).not.toBe('card-heading');
  });
  it('avoids imported copy ID collisions, supports explicit copy targets and exports complete results', () => {
    const app = structuredClone(exampleApplication);
    app.pages[0].children.push({
      id: 'purchase-heading-copy-1',
      component: 'ui.empty',
      props: { title: { kind: 'literal', value: 'existing' } },
    });
    app.pages[0].children[0].extensions = { 'test:opaque': { nodeId: 'purchase-heading' } };
    const doc = new EditorDocument(app, registry);
    const copy = doc.duplicateNode('purchase', 'purchase-heading', {
      parentId: 'purchase-note',
      index: 0,
    });
    expect(copy).not.toBe('purchase-heading-copy-1');
    expect(findNode(page(doc), copy)!.node.extensions).toEqual(app.pages[0].children[0].extensions);
    const exported = doc.exportJson(),
      restored = make();
    restored.importJson(exported);
    expect(restored.exportJson()).toBe(exported);
    const before = doc.getSnapshot();
    expect(() =>
      doc.duplicateNode('purchase', 'purchase-heading', { parentId: 'purchase-name' }),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });
  it('protects external slot and repeat scopes and permits moving self-contained scoped subtrees', () => {
    const doc = make(),
      before = doc.getSnapshot();
    expect(() => doc.moveNode('composition', 'card-heading')).toThrow('scope.record');
    expect(() => doc.duplicateNode('composition', 'card-heading', {})).toThrow('scope.record');
    expect(doc.getSnapshot()).toBe(before);
    doc.moveNode('composition', 'card-heading', { parentId: 'person-card', slot: 'footer' });
    expect(findNode(page(doc, 'composition'), 'card-heading')!.slot).toBe('footer');
    doc.moveNode('composition', 'person-card', { index: 0 });
    expect(page(doc, 'composition').children[0].id).toBe('person-card');
    const peoplePage = page(doc, 'people');
    const repeated =
      peoplePage.children.find((n) => n.repeat) ??
      peoplePage.children.flatMap((n) => n.children ?? []).find((n) => n.repeat);
    expect(repeated).toBeDefined();
    const id = doc.duplicateNode('people', repeated!.id);
    expect(findNode(page(doc, 'people'), id)!.node.repeat).toEqual(repeated!.repeat);
  });
  it('checks computed scope references without confusing literal text or unrelated property names', () => {
    const app = structuredClone(exampleApplication);
    app.pages[2].children[2].slots!.body.children.push({
      id: 'dynamic-scope',
      component: 'ui.text',
      props: {
        value: { kind: 'expression', language: 'javascript', source: 'scope[String("record")]' },
      },
    });
    const doc = new EditorDocument(app, registry);
    expect(() => doc.moveNode('composition', 'dynamic-scope')).toThrow('scope.record');
    doc.setProp('composition', 'dynamic-scope', 'value', {
      kind: 'expression',
      language: 'javascript',
      source: '"scope.record"',
    });
    doc.moveNode('composition', 'dynamic-scope');
    expect(findNode(page(doc, 'composition'), 'dynamic-scope')!.parentId).toBeUndefined();
  });
  it('keeps a repeated parent self-contained while preventing its child from losing ancestor scope', () => {
    const app = structuredClone(exampleApplication);
    app.pages[1].children.push({
      id: 'repeated-layout',
      component: 'ui.layout',
      props: {},
      repeat: {
        items: { kind: 'stateRef', stateId: 'people' },
        item: 'person',
        key: { kind: 'expression', language: 'javascript', source: 'scope.person.id' },
      },
      children: [
        {
          id: 'repeated-title',
          component: 'ui.text',
          props: {
            value: { kind: 'expression', language: 'javascript', source: 'scope.person.name' },
          },
        },
      ],
    });
    const doc = new EditorDocument(app, registry),
      before = doc.getSnapshot();
    expect(() => doc.moveNode('people', 'repeated-title')).toThrow('scope.person');
    expect(doc.getSnapshot()).toBe(before);
    doc.moveNode('people', 'repeated-layout', { index: 0 });
    expect(page(doc, 'people').children[0].id).toBe('repeated-layout');
  });
});
