import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CheckboxMaterial, SwitchMaterial } from '../src/BooleanMaterial';
import { registry, materials } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer, useField } from '../packages/react-runtime/Renderer';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { Json, Value } from '../packages/schema/types';
import { formEditorApplication } from './form-editor-fixture';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl, insertMaterial, showStructure } from './ui-helpers';
import { booleanExample as booleanExample } from './fixtures/example-json';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
function fixture() {
  const app = structuredClone(formEditorApplication);
  Object.assign(app.dependencies.components, { 'ui.checkbox': '1.0.0', 'ui.switch': '1.0.0' });
  const page = app.pages[0];
  page.state = [
    { id: 'locked', type: 'boolean', initial: false },
    { id: 'shown', type: 'boolean', initial: true },
  ];
  page.forms = [
    {
      id: 'model',
      fields: [
        {
          id: 'agree',
          path: ['agree'],
          type: 'boolean',
          label: '同意条款',
          initial: false,
          rules: [{ kind: 'mustBeTrue', message: '请先同意条款' }],
          disabled: { kind: 'stateRef', stateId: 'locked' },
          when: { kind: 'stateRef', stateId: 'shown' },
        },
        {
          id: 'notify',
          path: ['notify'],
          type: 'boolean',
          label: '接收通知',
          initial: false,
          rules: [{ kind: 'required', message: '通知不能缺失' }],
        },
      ],
    },
  ];
  page.children[0].formId = 'model';
  page.children[0].children = [
    {
      id: 'agree',
      component: 'ui.checkbox',
      props: { hint: literal('提交前请确认') },
      field: { formId: 'model', fieldId: 'agree' },
    },
    {
      id: 'notify',
      component: 'ui.switch',
      props: {},
      field: { formId: 'model', fieldId: 'notify' },
    },
  ];
  return app;
}
function editor(app = fixture()) {
  seedLegacyProject();
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  changeControl(screen.getByLabelText('应用定义 · JSON'), JSON.stringify(app));
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
  showStructure();
  fireEvent.click(screen.getByRole('button', { name: '选中 勾选框 agree' }));
}

describe('boolean materials', () => {
  it('compiles the importable example and keeps mustBeTrue validation in repeated rows', () => {
    expect(() => compileApplication(booleanExample, registry)).not.toThrow();
    const app = fixture();
    app.pages[0].forms![0].arrays = [
      {
        id: 'rows',
        path: ['rows'],
        label: '确认项',
        initial: [{ confirmed: false }],
        fields: [
          {
            id: 'confirmed',
            path: ['confirmed'],
            label: '确认',
            type: 'boolean',
            initial: false,
            rules: [{ kind: 'mustBeTrue', message: '该行尚未确认' }],
          },
        ],
      },
    ];
    const runtime = new PageRuntime(compileApplication(app, registry), 'page');
    const form = runtime.getForm('model');
    const rowId = form.getSnapshot().arrays.rows.rows[0].id;
    form.validate();
    expect(form.getSnapshot().arrays.rows.rows[0].fields.confirmed.error).toBe('该行尚未确认');
    form.setValue({ arrayId: 'rows', rowId, fieldId: 'confirmed' }, true);
    expect(form.getSnapshot().arrays.rows.rows[0].fields.confirmed.error).toBeUndefined();
    runtime.dispose();
  });
  it('distinguishes required false from mustBeTrue, submits booleans and resets shared model state', async () => {
    const runtime = new PageRuntime(compileApplication(fixture(), registry), 'page');
    const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const store = runtime.getForm('model');
    const checkbox = screen.getByRole('checkbox', { name: '同意条款' });
    const toggle = screen.getByRole('switch', { name: '接收通知' });
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    const native = view.container.querySelectorAll('input');
    expect([...native].find((input) => input.name === 'agree')?.required).toBe(true);
    expect([...native].find((input) => input.name === 'notify')?.required).toBe(false);
    act(() => store.validate());
    expect(screen.getByRole('alert').textContent).toBe('请先同意条款');
    expect(store.getSnapshot().errors.notify).toBeUndefined();
    fireEvent.click(checkbox);
    expect(store.getSnapshot().values.agree).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    let submitted: unknown;
    await act(async () => {
      await store.handleSubmit(async (values) => {
        submitted = values;
      })({ preventDefault() {} });
    });
    expect(submitted).toEqual({ agree: true, notify: false });
    fireEvent.click(toggle);
    expect(store.getSnapshot().values.notify).toBe(true);
    fireEvent.reset(view.container.querySelector('form')!);
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(store.getSnapshot().isDirty).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    runtime.dispose();
  });

  it.each([
    ['checkbox', CheckboxMaterial],
    ['switch', SwitchMaterial],
  ] as const)(
    'supports independent %s state, labels, disabled state and native controlled callbacks',
    (role, Control) => {
      const view = render(<Control label="选项" checked={false} />);
      fireEvent.click(screen.getByText('选项'));
      expect(screen.getByRole(role).getAttribute('aria-checked')).toBe('true');
      view.rerender(<Control label="选项" checked={false} disabled />);
      fireEvent.click(screen.getByRole(role));
      expect(screen.getByRole(role).getAttribute('aria-checked')).toBe('true');
      view.rerender(<Control label="选项" checked={true} />);
      fireEvent.click(screen.getByRole(role));
      expect(screen.getByRole(role).getAttribute('aria-checked')).toBe('false');
      const changed = vi.fn();
      function Demo() {
        const [checked, setChecked] = useState(false);
        return (
          <Control
            label="受控"
            checked={checked}
            onCheckedChange={(value) => {
              changed(value);
              setChecked(value);
            }}
          />
        );
      }
      view.rerender(<Demo />);
      fireEvent.click(screen.getByRole(role));
      expect(changed).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByRole(role));
      expect(changed).toHaveBeenLastCalledWith(false);
    },
  );

  it('shares native React checkbox bindings and enforces disabled, hidden and submit locks', async () => {
    const runtime = new PageRuntime(compileApplication(fixture(), registry), 'page');
    const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const store = runtime.getForm('model');
    act(() => runtime.setState('locked', true));
    fireEvent.click(screen.getByRole('checkbox', { name: '同意条款' }));
    expect(store.getSnapshot().values.agree).toBe(false);
    act(() => runtime.setState('locked', false));
    fireEvent.click(screen.getByRole('checkbox', { name: '同意条款' }));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submitted!: Promise<boolean>;
    act(() => {
      submitted = store.submit(() => pending);
    });
    fireEvent.click(screen.getByRole('switch', { name: '接收通知' }));
    expect(store.getSnapshot().values.notify).toBe(false);
    await act(async () => {
      release();
      await submitted;
    });
    act(() => runtime.setState('shown', false));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(store.getSubmitValues()).toEqual({ notify: false });
    act(() => runtime.setState('shown', true));
    function NativeCheckbox() {
      const field = useField('model', 'agree');
      return (
        <label>
          原生
          <input type="checkbox" {...field.input} />
        </label>
      );
    }
    view.rerender(
      <RuntimeRenderer
        runtime={runtime}
        materials={{ ...materials, 'ui.checkbox': NativeCheckbox }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '原生' }));
    expect(store.getSnapshot().values.agree).toBe(false);
    runtime.dispose();
  });

  it('delivers boolean values directly to authored state actions', async () => {
    const app = fixture();
    app.dependencies.actions['state.set'] = '1.0.0';
    const node = app.pages[0].children[0].children![1];
    delete node.field;
    node.props = { label: literal('独立开关'), checked: { kind: 'stateRef', stateId: 'locked' } };
    node.on = {
      onCheckedChange: [
        {
          id: 'set',
          action: 'state.set',
          input: {
            stateId: literal('locked'),
            value: { kind: 'expression', language: 'javascript', source: 'event' },
          },
        },
      ],
    };
    const runtime = new PageRuntime(compileApplication(app, registry), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    fireEvent.click(screen.getByRole('switch', { name: '独立开关' }));
    await waitFor(() => expect(runtime.getState().locked).toBe(true));
    expect(runtime.getForm('model').getSnapshot().fields.agree.disabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: '独立开关' }));
    await waitFor(() => expect(runtime.getState().locked).toBe(false));
    runtime.dispose();
  });
});

describe('boolean authoring', () => {
  it('rejects incompatible rules and callbacks atomically and preserves defaults on unbind and undo', () => {
    const app = fixture();
    const doc = new EditorDocument(app, registry);
    const before = doc.getSnapshot();
    expect(() =>
      doc.updateField('page', 'model', 'agree', { label: '同意条款', initial: 'true' }),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    const invalid = structuredClone(app);
    invalid.pages[0].forms![0].fields[0].type = 'string';
    invalid.pages[0].forms![0].fields[0].initial = '';
    expect(() => compileApplication(invalid, registry)).toThrow(/必须为 true/);
    app.pages[0].children[0].children![0].on = { onCheckedChange: [] };
    expect(() => compileApplication(app, registry)).toThrow();
    doc.bindField('page', 'agree');
    const node = () => findNode(doc.getSnapshot().plan.pages.get('page')!.schema, 'agree')!.node;
    expect(node().props).toMatchObject({ checked: literal(false), required: literal(true) });
    const unbound = structuredClone(doc.getSnapshot().plan.schema);
    unbound.pages[0].children[0].children![0].on = { onCheckedChange: [] };
    const conflict = new EditorDocument(unbound, registry);
    expect(() =>
      conflict.bindField('page', 'agree', { formId: 'model', fieldId: 'agree' }),
    ).toThrow();
    doc.undo();
    expect(node().field).toEqual({ formId: 'model', fieldId: 'agree' });
    expect(() => doc.moveNode('page', 'agree', {})).toThrow(/所属表单/);
  });

  it('creates a boolean field and mustBeTrue rule through the UI, retains edits and validates in preview', () => {
    const app = fixture();
    const node = app.pages[0].children[0].children![0];
    delete node.field;
    node.props = { label: literal('勾选框'), checked: literal(false) };
    editor(app);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建并绑定字段' }));
    expect(screen.queryByLabelText('字段类型')).toBeNull();
    changeControl(screen.getByLabelText('字段 ID'), 'confirm');
    changeControl(screen.getByLabelText('字段名称'), '确认信息');
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加校验规则' }));
    expect(screen.getByLabelText('规则 1 类型').getAttribute('data-value')).toBe('mustBeTrue');
    expect(screen.queryByLabelText('规则 1 校验值')).toBeNull();
    changeControl(screen.getByLabelText('规则 1 错误提示'), '请确认信息');
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定字段' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '确认信息' }));
    expect(screen.getByRole('checkbox', { name: '确认信息' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    fireEvent.blur(screen.getByRole('checkbox', { name: '确认信息' }));
    expect(screen.getByRole('alert').textContent).toBe('请确认信息');
    fireEvent.click(screen.getByRole('checkbox', { name: '确认信息' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    changeControl(screen.getByLabelText('规则 1 类型'), 'required');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    expect(screen.getByLabelText('规则 1 类型').getAttribute('data-value')).toBe('mustBeTrue');
  });

  it.each([
    ['勾选框', 'checkbox'],
    ['开关', 'switch'],
  ] as const)(
    'inserts an independent %s with mode isolation and stable local state',
    (title, role) => {
      seedLegacyProject();
      render(<App />);
      insertMaterial(title);
      expect(screen.queryByLabelText('绑定字段')).toBeNull();
      fireEvent.click(screen.getByRole(role, { name: title }));
      expect(screen.getByRole(role, { name: title }).getAttribute('aria-checked')).toBe('false');
      fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
      fireEvent.click(screen.getByRole(role, { name: title }));
      expect(screen.getByRole(role, { name: title }).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
      fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
      expect(screen.getByRole(role, { name: title }).getAttribute('aria-checked')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: '重置页面' }));
      expect(screen.getByRole(role, { name: title }).getAttribute('aria-checked')).toBe('false');
    },
  );
});
