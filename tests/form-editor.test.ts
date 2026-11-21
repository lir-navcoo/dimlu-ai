import { describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { formReferences } from '../packages/editor/forms';
import { registry } from '../src/materials';
import { amountField, formEditorApplication, nameField } from './form-editor-fixture';

function make() {
  const doc = new EditorDocument(formEditorApplication, registry);
  doc.createForm('page', 'form', { id: 'model', fields: [nameField] });
  return doc;
}
const page = (doc: EditorDocument) => doc.getSnapshot().plan.pages.get('page')!.schema;
const node = (doc: EditorDocument, id = 'name-input') => findNode(page(doc), id)!.node;

describe('form authoring commands', () => {
  it('creates and binds a form atomically, including its first field, with one undo', () => {
    const doc = make();
    expect(node(doc, 'form').formId).toBe('model');
    expect(page(doc).forms![0].fields).toEqual([nameField]);
    doc.undo();
    expect(page(doc).forms).toBeUndefined();
    expect(node(doc, 'form').formId).toBeUndefined();
    doc.redo();
    expect(node(doc, 'form').formId).toBe('model');
    const before = doc.getSnapshot();
    expect(() => doc.createForm('page', 'form', { id: 'bad', fields: [] })).toThrow();
    expect(() => doc.createForm('page', 'form', { id: 'model', fields: [nameField] })).toThrow();
    expect(doc.getSnapshot()).toBe(before);
  });
  it('binds matching fields, removes managed literals, and restores static defaults on unbind', () => {
    const doc = make();
    doc.bindField('page', 'name-input', { formId: 'model', fieldId: 'name' });
    expect(node(doc).props).toEqual({});
    expect(node(doc).field).toEqual({ formId: 'model', fieldId: 'name' });
    doc.bindField('page', 'name-input');
    expect(node(doc).field).toBeUndefined();
    expect(node(doc).props).toMatchObject({
      label: { value: '姓名' },
      value: { value: '' },
      required: { value: true },
    });
    doc.undo();
    expect(node(doc).field?.fieldId).toBe('name');
    doc.undo();
    expect(node(doc).props.label).toMatchObject({ value: '文本输入' });
  });
  it('rejects incompatible types, events and dynamic prop replacement without losing history', () => {
    const doc = make();
    const binding = { formId: 'model', fieldId: 'name' };
    expect(() => doc.bindField('page', 'amount-input', binding)).toThrow(/类型/);
    doc.setProp('page', 'name-input', 'value', {
      kind: 'expression',
      language: 'javascript',
      source: '"dynamic"',
    });
    const before = doc.getSnapshot();
    expect(() => doc.bindField('page', 'name-input', binding)).toThrow(/动态绑定/);
    expect(doc.getSnapshot()).toBe(before);
    doc.undo();
    const input = JSON.parse(doc.exportJson());
    input.pages[0].children[0].children[0].on = { onChange: [] };
    doc.replace(input);
    const events = doc.getSnapshot();
    expect(() => doc.bindField('page', 'name-input', binding)).toThrow(/change\/blur/);
    expect(doc.getSnapshot()).toBe(events);
  });
  it('creates and binds a field as a single command and rolls back duplicate paths or IDs', () => {
    const doc = make();
    doc.createField('page', 'model', amountField, 'amount-input');
    expect(node(doc, 'amount-input').field?.fieldId).toBe('amount');
    doc.undo();
    const before = doc.getSnapshot();
    expect(page(doc).forms![0].fields).toHaveLength(1);
    expect(() =>
      doc.createField('page', 'model', { ...amountField, path: ['applicant'] }, 'amount-input'),
    ).toThrow(/路径/);
    expect(() =>
      doc.createField('page', 'model', { ...amountField, id: 'name' }, 'amount-input'),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    doc.redo();
    expect(page(doc).forms![0].fields).toHaveLength(2);
  });
  it('preserves advanced conditions and rules, rejects invalid bounds and patterns, and roundtrips', () => {
    const doc = make();
    const advanced = {
      ...amountField,
      disabled: { kind: 'literal' as const, value: false },
      rules: [
        ...amountField.rules!,
        {
          kind: 'expression' as const,
          test: { kind: 'literal' as const, value: true },
          message: '高级规则',
        },
      ],
    };
    doc.createField('page', 'model', advanced, 'amount-input');
    doc.updateField('page', 'model', 'amount', {
      label: '预算',
      initial: 10,
      rules: advanced.rules,
    });
    expect(page(doc).forms![0].fields[1]).toMatchObject({
      id: 'amount',
      path: ['amount'],
      disabled: { value: false },
      label: '预算',
    });
    const before = doc.getSnapshot();
    expect(() =>
      doc.updateField('page', 'model', 'amount', {
        label: '预算',
        initial: 10,
        rules: [
          { kind: 'min', value: 5, message: 'min' },
          { kind: 'max', value: 2, message: 'max' },
        ],
      }),
    ).toThrow(/最小值/);
    expect(() =>
      doc.updateField('page', 'model', 'name', {
        label: '姓名',
        initial: '',
        rules: [{ kind: 'pattern', value: '[', message: 'pattern' }],
      }),
    ).toThrow(/正则/);
    expect(doc.getSnapshot()).toBe(before);
    const restored = make();
    restored.importJson(doc.exportJson());
    expect(restored.exportJson()).toBe(doc.exportJson());
  });
  it('rejects deleting bound fields and forms, allows unused deletion and protects the final field', () => {
    const doc = make();
    doc.bindField('page', 'name-input', { formId: 'model', fieldId: 'name' });
    expect(() => doc.removeField('page', 'model', 'name')).toThrow(/name-input/);
    expect(() => doc.removeForm('page', 'model')).toThrow(/仍被引用/);
    doc.createField('page', 'model', amountField);
    doc.removeField('page', 'model', 'amount');
    doc.bindField('page', 'name-input');
    expect(() => doc.removeField('page', 'model', 'name')).toThrow(/至少需要/);
    doc.bindForm('page', 'form');
    doc.removeForm('page', 'model');
    expect(page(doc).forms).toEqual([]);
    doc.undo();
    expect(page(doc).forms).toHaveLength(1);
  });
  it.each([
    { kind: 'fieldRef', formId: 'model', fieldId: 'name' },
    { kind: 'formValues', formId: 'model' },
    { kind: 'expression', language: 'javascript', source: 'forms.model.values.applicant.name' },
    { kind: 'expression', language: 'javascript', source: 'forms["model"].values.applicant.name' },
    { kind: 'expression', language: 'javascript', source: 'forms[state.key].values' },
  ])('protects fields read through schema values: %j', (value) => {
    const doc = make();
    const input = JSON.parse(doc.exportJson());
    input.pages[0].state = [{ id: 'key', type: 'string', initial: 'model' }];
    input.pages[0].children[0].children.push({
      id: 'read',
      component: 'ui.text',
      props: { value },
    });
    doc.replace(input);
    const before = doc.getSnapshot();
    expect(() => doc.removeField('page', 'model', 'name')).toThrow(/仍被引用/);
    expect(doc.getSnapshot()).toBe(before);
  });
  it('does not mistake literal JSON or extensions for executable references', () => {
    const doc = make();
    const input = JSON.parse(doc.exportJson());
    input.pages[0].children[0].children.push({
      id: 'literal',
      component: 'ui.text',
      props: {
        value: { kind: 'literal', value: { kind: 'fieldRef', formId: 'model', fieldId: 'name' } },
      },
      extensions: { 'test:ref': { kind: 'fieldRef', formId: 'model', fieldId: 'name' } },
    });
    doc.replace(input);
    expect(formReferences(page(doc), 'model', 'name')).toEqual([]);
  });
  it('finds references inside expression validation rules without treating rules as value expressions', () => {
    const doc = make();
    doc.createField('page', 'model', {
      ...amountField,
      rules: [
        {
          kind: 'expression',
          test: {
            kind: 'expression',
            language: 'javascript',
            source: 'forms.model.values.applicant.name !== ""',
          },
          message: '请先填写姓名',
        },
      ],
    });
    const before = doc.getSnapshot();
    expect(() => doc.removeField('page', 'model', 'name')).toThrow(/字段 model\/amount/);
    expect(doc.getSnapshot()).toBe(before);
    doc.removeField('page', 'model', 'amount'); // Its own reads disappear with the definition.
    expect(page(doc).forms![0].fields).toHaveLength(1);
  });
  it('protects code materials and opaque computation dependencies', () => {
    const doc = make();
    doc.insertNode('page', {
      component: 'ui.formStatus',
      props: { formId: { kind: 'literal', value: 'model' } },
    });
    expect(() => doc.removeField('page', 'model', 'name')).toThrow(/代码物料/);
    const definition = structuredClone(page(doc));
    definition.children = [];
    definition.forms![0].computed = [{ id: 'derived', compute: 'opaque' }];
    expect(formReferences(definition, 'model', 'name')).toContain(
      '表单计算函数（字段依赖由 TypeScript 管理）',
    );
  });
});
