import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { nearestForm } from '../packages/editor/forms';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { registry } from '../src/materials';
import { formEditorApplication, nameField } from './form-editor-fixture';
import { changeControl, showStructure } from './ui-helpers';

afterEach(cleanup);

function definition() {
  const app = structuredClone(formEditorApplication);
  const page = app.pages[0];
  page.forms = [
    { id: 'model', fields: [structuredClone(nameField)] },
    { id: 'other', fields: [{ ...structuredClone(nameField), label: '其他姓名' }] },
  ];
  page.children[0].formId = 'model';
  page.children.push(
    {
      id: 'other-form',
      component: 'ui.form',
      props: {},
      formId: 'other',
      children: [
        {
          id: 'other-input',
          component: 'ui.input',
          props: {
            label: { kind: 'literal', value: '其他输入' },
            value: { kind: 'literal', value: '' },
          },
        },
      ],
    },
    {
      id: 'outside',
      component: 'ui.input',
      props: {
        label: { kind: 'literal', value: '容器外输入' },
        value: { kind: 'literal', value: '' },
      },
    },
  );
  return app;
}
const pageOf = (doc: EditorDocument) => doc.getSnapshot().plan.pages.get('page')!.schema;
const nodeOf = (doc: EditorDocument, id: string) => findNode(pageOf(doc), id)!.node;
const binding = { formId: 'model', fieldId: 'name' };

describe('form authoring scope', () => {
  it('rejects outside and foreign binding and rolls back field creation atomically', () => {
    const doc = new EditorDocument(definition(), registry);
    const before = doc.getSnapshot();
    expect(() => doc.bindField('page', 'outside', binding)).toThrow(/表单容器/);
    expect(() => doc.bindField('page', 'other-input', binding)).toThrow(/所属表单 other/);
    expect(() =>
      doc.createField('page', 'model', { ...nameField, id: 'new', path: ['new'] }, 'outside'),
    ).toThrow(/表单容器/);
    expect(() =>
      doc.createField('page', 'other', { ...nameField, id: 'new', path: ['new'] }, 'name-input'),
    ).toThrow(/所属表单 model/);
    expect(doc.getSnapshot()).toBe(before);
    expect(pageOf(doc).forms!.every((model) => model.fields.length === 1)).toBe(true);
    doc.bindField('page', 'name-input', binding);
    expect(nodeOf(doc, 'name-input').field).toEqual(binding);
    doc.undo();
    expect(nodeOf(doc, 'name-input').field).toBeUndefined();
  });

  it('blocks moving or copying bound subtrees across scopes and preserves undo and redo', () => {
    const doc = new EditorDocument(definition(), registry);
    doc.bindField('page', 'name-input', binding);
    const layout = doc.insertNode(
      'page',
      { component: 'ui.layout', props: {} },
      { parentId: 'form' },
    );
    doc.moveNode('page', 'name-input', { parentId: layout });
    const exported = doc.exportJson();
    for (const target of [{}, { parentId: 'other-form' }]) {
      const before = doc.getSnapshot();
      expect(() => doc.checkMove('page', layout, target)).toThrow(/解除字段绑定/);
      expect(() => doc.moveNode('page', layout, target)).toThrow(/解除字段绑定/);
      expect(() => doc.duplicateNode('page', 'name-input', target)).toThrow(/解除字段绑定/);
      expect(doc.getSnapshot()).toBe(before);
    }
    expect(doc.exportJson()).toBe(exported);
    doc.undo();
    const before = doc.getSnapshot();
    expect(() => doc.moveNode('page', 'name-input')).toThrow(/解除字段绑定/);
    expect(doc.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    doc.redo();
    expect(findNode(pageOf(doc), 'name-input')!.parentId).toBe(layout);
    doc.bindField('page', 'name-input');
    doc.moveNode('page', layout);
    expect(findNode(pageOf(doc), layout)!.parentId).toBeUndefined();
    doc.undo();
    doc.undo();
    expect(nodeOf(doc, 'name-input').field).toEqual(binding);
  });

  it('supports slot ancestry, treats unbound forms as boundaries, and keeps complete forms movable', () => {
    const doc = new EditorDocument(definition(), registry);
    const card = doc.insertNode(
      'page',
      {
        component: 'ui.recordCard',
        props: {
          record: { kind: 'literal', value: {} },
        },
      },
      { parentId: 'form' },
    );
    doc.moveNode('page', 'name-input', { parentId: card, slot: 'footer' });
    expect(nearestForm(pageOf(doc), 'name-input', registry)?.id).toBe('form');
    doc.bindField('page', 'name-input', binding);
    const nested = doc.insertNode(
      'page',
      { component: 'ui.form', props: {} },
      { parentId: 'form' },
    );
    expect(() => doc.moveNode('page', card, { parentId: nested })).toThrow(/解除字段绑定/);
    doc.bindField('page', 'name-input');
    doc.moveNode('page', card, { parentId: nested });
    expect(nearestForm(pageOf(doc), 'name-input', registry)?.id).toBe(nested);
    expect(() => doc.bindField('page', 'name-input', binding)).toThrow(/已绑定模型/);
    doc.bindForm('page', nested, 'model');
    doc.bindField('page', 'name-input', binding);
    doc.moveNode('page', 'form', { index: 2 });
    const copy = doc.duplicateNode('page', 'form');
    expect(nodeOf(doc, copy).formId).toBe('model');
    expect(nodeOf(doc, 'name-input').field).toEqual(binding);
  });

  it('rejects model changes until affected descendant bindings are explicitly removed', () => {
    const doc = new EditorDocument(definition(), registry);
    doc.bindField('page', 'name-input', binding);
    const before = doc.getSnapshot();
    expect(() => doc.bindForm('page', 'form', 'other')).toThrow(/解除字段绑定/);
    expect(() => doc.bindForm('page', 'form')).toThrow(/解除字段绑定/);
    expect(() => doc.createForm('page', 'form', { id: 'new', fields: [nameField] })).toThrow(
      /解除字段绑定/,
    );
    expect(doc.getSnapshot()).toBe(before);
    doc.bindField('page', 'name-input');
    doc.bindForm('page', 'form', 'other');
    expect(nodeOf(doc, 'name-input').field).toBeUndefined();
    doc.bindField('page', 'name-input', { formId: 'other', fieldId: 'name' });
    expect(nodeOf(doc, 'name-input').field?.formId).toBe('other');
  });

  it('preserves explicit imported runtime bindings but requires local scope for new insertion', () => {
    const app = definition();
    app.pages[0].children.at(-1)!.props = {};
    app.pages[0].children.at(-1)!.field = binding;
    const doc = new EditorDocument(app, registry);
    expect(nodeOf(doc, 'outside').field).toEqual(binding);
    doc.setProp('page', 'outside', 'multiline', { kind: 'literal', value: true });
    expect(() =>
      doc.checkInsert('page', { component: 'ui.input', props: {}, field: binding }),
    ).toThrow(/解除字段绑定/);
    doc.bindField('page', 'outside');
    expect(nodeOf(doc, 'outside').props.label).toEqual({ kind: 'literal', value: '姓名' });
  });
});

function workbench(app = definition()) {
  seedLegacyProject();
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  changeControl(screen.getByLabelText('应用定义 · JSON'), JSON.stringify(app));
  fireEvent.click(screen.getByRole('button', { name: '校验并应用' }));
  showStructure();
}
const select = (id: string) =>
  fireEvent.click(screen.getByRole('button', { name: `选中 文本输入 ${id}` }));

describe('scoped field binding controls', () => {
  it('marks an outside keyboard drop invalid and keeps the current binding unchanged', () => {
    const app = definition();
    const input = app.pages[0].children[0].children![0];
    input.props = {};
    input.field = binding;
    workbench(app);
    fireEvent.keyDown(screen.getByRole('button', { name: '拖动 文本输入 name-input' }), {
      key: ' ',
    });
    changeControl(screen.getByLabelText('拖放位置'), JSON.stringify({ kind: 'inside' }));
    expect(screen.getByText(/请先解除字段绑定/, { selector: '.drag-feedback small' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '确认放置' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('拖放位置')).toBeNull();
    select('name-input');
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(
      JSON.stringify(['model', 'name']),
    );
  });

  it('offers no field picker outside a form, and only compatible owner fields inside', () => {
    workbench();
    select('outside');
    expect(screen.queryByLabelText('绑定字段')).toBeNull();
    expect(screen.queryByRole('button', { name: '＋ 新建并绑定字段' })).toBeNull();
    expect(screen.getByText('请先将输入组件放入表单容器，再绑定字段。')).toBeTruthy();
    select('name-input');
    fireEvent.click(screen.getByLabelText('绑定字段'));
    const values = screen.getAllByRole('option').map((option) => option.getAttribute('data-value'));
    expect(values).toContain(JSON.stringify(['model', 'name']));
    expect(values).not.toContain(JSON.stringify(['other', 'name']));
  });

  it('creates a field in the owner model without leaving the selected component', () => {
    workbench();
    select('other-input');
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建并绑定字段' }));
    const dialog = screen.getByRole('dialog', { name: '新建并绑定字段' });
    expect(dialog.textContent).toContain('所属表单 · other');
    expect(screen.queryByLabelText('管理表单')).toBeNull();
    changeControl(screen.getByLabelText('字段 ID'), 'extra');
    changeControl(screen.getByLabelText('字段名称'), '新增说明');
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定字段' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(
      JSON.stringify(['other', 'extra']),
    );
    expect(screen.getByRole('textbox', { name: '新增说明' })).toBeTruthy();
  });

  it('shows imported outside bindings explicitly and supports clearing them without deleting fields', () => {
    const app = definition();
    app.pages[0].children.at(-1)!.props = {};
    app.pages[0].children.at(-1)!.field = binding;
    workbench(app);
    select('outside');
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(
      JSON.stringify(['model', 'name']),
    );
    expect(screen.getByText(/当前绑定来自容器外/)).toBeTruthy();
    changeControl(screen.getByLabelText('绑定字段'), '');
    expect(screen.queryByLabelText('绑定字段')).toBeNull();
    expect(screen.getByRole('textbox', { name: '姓名' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(
      JSON.stringify(['model', 'name']),
    );
  });
});
