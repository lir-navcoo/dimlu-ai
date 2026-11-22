import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { registry } from '../src/materials';

const make = () => new EditorDocument(structuredClone(purchaseManagementExample), registry);
const buttons = (doc: EditorDocument) =>
  findNode(doc.getSnapshot().plan.schema.pages[0], 'purchase-toolbar-buttons')!.node.children!.map(
    (node) => node.id,
  );

describe('reorderNode sibling commands', () => {
  it('moves a node up and down one sibling at a time', () => {
    const doc = make();
    expect(buttons(doc)).toEqual(['search-purchases', 'clear-purchases', 'new-purchase']);
    expect(doc.reorderNode('purchases', 'clear-purchases', 'up')).toBe(true);
    expect(buttons(doc)).toEqual(['clear-purchases', 'search-purchases', 'new-purchase']);
    expect(doc.getSnapshot().canUndo).toBe(true);
    doc.undo();
    expect(buttons(doc)).toEqual(['search-purchases', 'clear-purchases', 'new-purchase']);
    expect(doc.reorderNode('purchases', 'search-purchases', 'down')).toBe(true);
    expect(buttons(doc)).toEqual(['clear-purchases', 'search-purchases', 'new-purchase']);
  });

  it('moves a node to the top and bottom of its sibling list', () => {
    const doc = make();
    expect(doc.reorderNode('purchases', 'new-purchase', 'top')).toBe(true);
    expect(buttons(doc)).toEqual(['new-purchase', 'search-purchases', 'clear-purchases']);
    expect(doc.reorderNode('purchases', 'new-purchase', 'bottom')).toBe(true);
    expect(buttons(doc)).toEqual(['search-purchases', 'clear-purchases', 'new-purchase']);
    expect(doc.reorderNode('purchases', 'new-purchase', 'bottom')).toBe(false);
    expect(doc.reorderNode('purchases', 'new-purchase', 'down')).toBe(false);
  });

  it('reports false for single-child lists and unknown nodes instead of committing', () => {
    const doc = make();
    const before = doc.getSnapshot();
    expect(doc.reorderNode('purchases', 'purchase-heading', 'up')).toBe(false);
    expect(() => doc.reorderNode('purchases', 'missing', 'top')).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });

  it('keeps the selection on the reordered node', () => {
    const doc = make();
    doc.select('purchases', 'clear-purchases');
    doc.reorderNode('purchases', 'clear-purchases', 'top');
    expect(doc.getSnapshot().selection.nodeId).toBe('clear-purchases');
  });
});
