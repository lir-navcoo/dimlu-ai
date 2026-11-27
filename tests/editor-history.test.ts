import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { registry } from '../src/materials';
const literal = (value: string) => ({ kind: 'literal' as const, value });

const make = () => new EditorDocument(structuredClone(purchaseManagementExample), registry);
const setTitle = (doc: EditorDocument, value: string, group?: string) =>
  doc.setProp('purchases', 'purchase-heading', 'value', { kind: 'literal', value }, group);

describe('document history timeline', () => {
  it('records operation descriptions in chronological order', () => {
    const doc = make();
    expect(doc.getHistory().past).toHaveLength(0);
    setTitle(doc, 'A');
    setTitle(doc, 'B');
    const history = doc.getHistory();
    expect(history.past.map((entry) => entry.change)).toEqual([
      expect.stringContaining('修改属性 value'),
      expect.stringContaining('修改属性 value'),
    ]);
    expect(history.current).toContain('修改属性 value');
    expect(history.future).toHaveLength(0);
  });

  it('moves descriptions to the future on undo and back on redo', () => {
    const doc = make();
    setTitle(doc, 'A');
    doc.undo();
    let history = doc.getHistory();
    expect(history.past).toHaveLength(0);
    expect(history.future).toHaveLength(1);
    expect(history.future[0].change).toContain('修改属性 value');
    doc.redo();
    history = doc.getHistory();
    expect(history.past).toHaveLength(1);
    expect(history.future).toHaveLength(0);
  });

  it('jumps to an arbitrary point in time through undo/redo', () => {
    const doc = make();
    setTitle(doc, 'A');
    setTitle(doc, 'B');
    setTitle(doc, 'C');
    expect(findNode(doc.getSnapshot().plan.schema.pages[0], 'purchase-heading')!.node.props.value).toEqual({
      kind: 'literal',
      value: 'C',
    });
    doc.jumpTo(1);
    expect(findNode(doc.getSnapshot().plan.schema.pages[0], 'purchase-heading')!.node.props.value).toEqual({
      kind: 'literal',
      value: 'A',
    });
    expect(doc.getHistory().past).toHaveLength(1);
    expect(doc.getHistory().future).toHaveLength(2);
    doc.jumpTo(3);
    expect(findNode(doc.getSnapshot().plan.schema.pages[0], 'purchase-heading')!.node.props.value).toEqual({
      kind: 'literal',
      value: 'C',
    });
    doc.jumpTo(0);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });

  it('rejects out-of-range jumps without mutating anything', () => {
    const doc = make();
    setTitle(doc, 'A');
    const before = doc.getSnapshot();
    expect(() => doc.jumpTo(-1)).toThrow();
    expect(() => doc.jumpTo(2)).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });
});
