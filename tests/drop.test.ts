import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { resolveDrop } from '../packages/editor/drop';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
describe('drop resolution and read-only validation', () => {
  it('normalizes gaps for moves in both directions without shifting insertion gaps', () => {
    const page = exampleApplication.pages[0],
      source = { kind: 'node' as const, nodeId: 'purchase-name' };
    expect(resolveDrop(page, source, { kind: 'after', nodeId: 'purchase-items' })).toEqual({
      parentId: 'purchase-form',
      slot: undefined,
      index: 1,
    });
    expect(
      resolveDrop(
        page,
        { kind: 'node', nodeId: 'purchase-items' },
        { kind: 'before', nodeId: 'purchase-name' },
      ).index,
    ).toBe(0);
    expect(
      resolveDrop(
        page,
        { kind: 'material', component: 'ui.heading' },
        { kind: 'after', nodeId: 'purchase-items' },
      ).index,
    ).toBe(2);
    expect(resolveDrop(page, source, { kind: 'before', nodeId: 'purchase-name' }).index).toBe(0);
    expect(resolveDrop(page, source, { kind: 'after', nodeId: 'purchase-name' }).index).toBe(0);
    expect(resolveDrop(page, source, { kind: 'inside', parentId: 'purchase-note' })).toEqual({
      parentId: 'purchase-note',
      slot: undefined,
    });
  });
  it('handles sibling positions within named slots and unknown anchors', () => {
    const page = exampleApplication.pages[2];
    expect(
      resolveDrop(
        page,
        { kind: 'node', nodeId: 'card-description' },
        { kind: 'after', nodeId: 'card-email' },
      ),
    ).toEqual({ parentId: 'person-card', slot: 'body', index: 1 });
    expect(() =>
      resolveDrop(
        page,
        { kind: 'material', component: 'ui.heading' },
        { kind: 'after', nodeId: 'missing' },
      ),
    ).toThrow();
  });
  it('preflights the actual command path without modifying selection, listeners, IDs or redo', () => {
    const doc = new EditorDocument(exampleApplication, registry);
    const input = {
      component: 'ui.heading',
      props: { title: { kind: 'literal' as const, value: 'drop' } },
    };
    doc.insertNode('composition', input);
    doc.undo();
    const before = doc.getSnapshot(),
      exported = doc.exportJson();
    let notifications = 0;
    doc.subscribe(() => notifications++);
    for (let i = 0; i < 3; i++) {
      doc.checkInsert('composition', input, { parentId: 'person-card', slot: 'footer' });
      doc.checkMove('composition', 'composition-heading', {
        parentId: 'person-card',
        slot: 'footer',
      });
    }
    expect(() => doc.checkMove('composition', 'card-heading')).toThrow('scope.record');
    expect(() =>
      doc.checkMove('composition', 'person-card', { parentId: 'card-heading' }),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    expect(doc.exportJson()).toBe(exported);
    expect(notifications).toBe(0);
    expect(doc.insertNode('composition', input)).toBe('ui-heading-2');
    expect(doc.getSnapshot().canRedo).toBe(false);
  });
  it('commits one normalized drop as one undo step and preserves the subtree', () => {
    const doc = new EditorDocument(exampleApplication, registry),
      before = doc.exportJson();
    const original = findNode(
      doc.getSnapshot().plan.pages.get('purchase')!.schema,
      'purchase-name',
    )!.node;
    const target = resolveDrop(
      doc.getSnapshot().plan.pages.get('purchase')!.schema,
      { kind: 'node', nodeId: 'purchase-name' },
      { kind: 'after', nodeId: 'purchase-items' },
    );
    doc.checkMove('purchase', 'purchase-name', target);
    doc.moveNode('purchase', 'purchase-name', target);
    expect(
      findNode(doc.getSnapshot().plan.pages.get('purchase')!.schema, 'purchase-name')!.node,
    ).toEqual(original);
    doc.undo();
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
});
