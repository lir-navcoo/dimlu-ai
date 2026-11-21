import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { registry } from '../src/materials';
import { actionExample } from '../src/action-example';
import type { ActionCall } from '../packages/schema/types';

const notify = (id = 'authored-notify'): ActionCall => ({
  id,
  action: 'ui.notify',
  input: { title: { kind: 'literal', value: '已完成' } },
});
describe('atomic event commands', () => {
  it('validates literal form patches during import and blocks incompatible field edits atomically', () => {
    const schema = structuredClone(actionExample);
    schema.pages[0].children = [
      {
        id: 'external-submit',
        component: 'ui.button',
        props: { label: { kind: 'literal', value: '回填' } },
      },
    ];
    schema.pages[0].forms![0].fields.push({
      id: 'amount',
      path: ['order', 'amount'],
      label: '金额',
      type: 'number',
      initial: 0,
    });
    const doc = new EditorDocument(schema, registry);
    doc.setEventActions('records', 'external-submit', 'onClick', [
      {
        id: 'prefill-amount',
        action: 'form.setValues',
        input: {
          formId: { kind: 'literal', value: 'edit' },
          values: { kind: 'literal', value: { order: { amount: 2 } } },
        },
      },
    ]);
    const before = doc.getSnapshot();
    expect(() => doc.removeField('records', 'edit', 'amount')).toThrow('未知或非法字段 order');
    expect(doc.getSnapshot()).toBe(before);
    const incompatible = structuredClone(before.plan.schema);
    incompatible.pages[0].forms![0].fields.find((f) => f.id === 'amount')!.type = 'string';
    incompatible.pages[0].forms![0].fields.find((f) => f.id === 'amount')!.initial = '';
    expect(() => doc.replace(incompatible)).toThrow('order.amount');
    expect(doc.getSnapshot()).toBe(before);
  });
  it('saves a whole chain with dependencies and a single undo/redo entry', () => {
    const doc = new EditorDocument(actionExample, registry);
    const before = doc.getSnapshot().plan.schema;
    const calls = [notify(), notify('second-notify')];
    doc.setEventActions('records', 'edit-record', 'onClick', calls);
    expect(
      findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'edit-record')!.node.on!
        .onClick,
    ).toEqual(calls);
    doc.undo();
    expect(doc.getSnapshot().plan.schema).toEqual(before);
    doc.redo();
    expect(
      findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'edit-record')!.node.on!
        .onClick,
    ).toEqual(calls);
  });
  it('rejects unavailable row scope and duplicate IDs without changing the document or history', () => {
    const doc = new EditorDocument(actionExample, registry);
    const before = doc.getSnapshot();
    expect(() =>
      doc.setEventActions('records', 'external-submit', 'onClick', [
        {
          ...notify(),
          input: {
            title: { kind: 'expression', language: 'javascript', source: 'scope.row.name' },
          },
        },
      ]),
    ).toThrow('scope.row');
    expect(() =>
      doc.setEventActions('records', 'external-submit', 'onClick', [notify('save-record')]),
    ).toThrow('重复动作');
    expect(doc.getSnapshot()).toBe(before);
    doc.setEventActions('records', 'edit-record', 'onClick', [
      {
        ...notify(),
        input: { title: { kind: 'expression', language: 'javascript', source: 'scope.row.name' } },
      },
    ]);
    expect(doc.getSnapshot().canUndo).toBe(true);
  });
});
