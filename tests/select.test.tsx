import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SelectMaterial } from '../src/SelectMaterial';
import { selectOptionErrors } from '../src/select-options';
import { registry, materials } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { Json, Value } from '../packages/schema/types';
import { formEditorApplication } from './form-editor-fixture';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl, insertMaterial, showStructure } from './ui-helpers';
import { selectExample as selectExample } from './fixtures/example-json';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const numeric = [
  { label: '零', value: 0 },
  { label: '二', value: 2 },
];
function fixture(type: 'number' | 'string' = 'number') {
  const app = structuredClone(formEditorApplication);
  app.dependencies.components['ui.select'] = '1.0.0';
  const page = app.pages[0];
  page.forms = [
    {
      id: 'model',
      fields: [
        {
          id: 'choice',
          path: ['choice'],
          label: '类别',
          type,
          initial: type === 'number' ? null : '',
          rules: [{ kind: 'required', message: '请选择类别' }],
        },
      ],
    },
  ];
  const form = page.children[0];
  form.formId = 'model';
  form.children = [
    {
      id: 'choice',
      component: 'ui.select',
      props: { options: literal(type === 'number' ? numeric : [{ label: '文本零', value: '0' }]) },
      field: { formId: 'model', fieldId: 'choice' },
    },
  ];
  return app;
}
function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name }));
  const item = screen.getByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse', button: 0 });
  fireEvent.click(item);
}
function setupEditor(app = fixture()) {
  seedLegacyProject();
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  changeControl(screen.getByLabelText('应用定义 · JSON'), JSON.stringify(app));
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
  showStructure();
  fireEvent.click(screen.getByRole('button', { name: '选中 选择器 choice' }));
}

describe('typed select material', () => {
  it('keeps 0 distinct from "0" and emits actual values rather than DOM events', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, setValue] = useState<string | number | null>(null);
      return (
        <SelectMaterial
          label="类型"
          value={value}
          options={[
            { label: '数字零', value: 0 },
            { label: '文本零', value: '0' },
          ]}
          onValueChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Demo />);
    choose('类型', '数字零');
    expect(changed).toHaveBeenLastCalledWith(0);
    expect(screen.getByRole('combobox', { name: '类型' }).textContent).toBe('数字零');
    choose('类型', '文本零');
    expect(changed).toHaveBeenLastCalledWith('0');
    fireEvent.click(screen.getByRole('button', { name: '清空类型' }));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: '类型' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it.each(['number', 'string'] as const)(
    'binds %s values, validates clear and resets without coercion',
    async (type) => {
      const runtime = new PageRuntime(compileApplication(fixture(type), registry), 'page');
      const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
      const store = runtime.getForm('model');
      choose('类别', type === 'number' ? '零' : '文本零');
      expect(store.getSnapshot().values.choice).toBe(type === 'number' ? 0 : '0');
      expect(store.getSnapshot().fields.choice.touched).toBe(false);
      act(() => store.validate());
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '清空类别' }));
      fireEvent.blur(screen.getByRole('combobox', { name: '类别' }));
      expect(store.getSnapshot().values.choice).toBe(type === 'number' ? null : '');
      expect(screen.getByRole('alert').textContent).toBe('请选择类别');
      choose('类别', type === 'number' ? '二' : '文本零');
      let submitted: unknown;
      await act(async () => {
        await store.handleSubmit(async (values) => {
          submitted = values;
        })({ preventDefault() {} });
      });
      expect(submitted).toEqual({ choice: type === 'number' ? 2 : '0' });
      fireEvent.reset(view.container.querySelector('form')!);
      expect(screen.getByRole('combobox', { name: '类别' }).textContent).toBe('请选择');
      expect(store.getSnapshot().isDirty).toBe(false);
      runtime.dispose();
    },
  );

  it('respects disabled items and controls, and lets an unbound control select and clear', () => {
    const changed = vi.fn();
    const view = render(
      <SelectMaterial
        label="选项"
        options={[{ label: '禁用项', value: 1, disabled: true }, ...numeric]}
        value={null}
        onValueChange={changed}
      />,
    );
    choose('选项', '禁用项');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    view.rerender(
      <SelectMaterial label="选项" options={numeric} value={0} disabled onValueChange={changed} />,
    );
    expect((screen.getByRole('combobox') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '清空选项' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    view.rerender(<SelectMaterial label="选项" options={numeric} value={0} />);
    choose('选项', '二');
    expect(screen.getByRole('combobox').textContent).toBe('二');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '清空选项' }));
    expect(screen.getByRole('combobox').textContent).toBe('请选择');
    view.rerender(<SelectMaterial label="选项" options={numeric} value={2} />);
    expect(screen.getByRole('combobox').textContent).toBe('二');
    view.rerender(
      <SelectMaterial label="选项" options={numeric} value={0} onValueChange={changed} />,
    );
    choose('选项', '二');
    expect(changed.mock.calls.at(-1)?.[0]).toBe(2);
    expect(screen.getByRole('combobox').textContent).toBe('零');
  });

  it('previews a freshly inserted select without binding, preserves local selection across modes and keeps Schema unchanged', () => {
    seedLegacyProject();
    render(<App />);
    insertMaterial('选择器');
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    const before = (screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    choose('选择器', '选项二');
    expect(screen.getByRole('combobox', { name: '选择器' }).textContent).toBe('选项二');
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    fireEvent.click(screen.getByRole('combobox', { name: '选择器' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(screen.getByRole('combobox', { name: '选择器' }).textContent).toBe('选项二');
    expect((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '重置页面' }));
    expect(screen.getByRole('combobox', { name: '选择器' }).textContent).toBe('请选择');
  });

  it('updates expression options, preserves unavailable values and recovers after invalid data', () => {
    const app = fixture();
    app.pages[0].state = [{ id: 'options', type: 'array', initial: numeric }];
    app.pages[0].children[0].children![0].props.options = {
      kind: 'expression',
      language: 'javascript',
      source: 'state.options',
    };
    const runtime = new PageRuntime(compileApplication(app, registry), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    choose('类别', '零');
    act(() => runtime.setState('options', [{ label: '新选项', value: 3 }]));
    expect(screen.getByText('当前值已不在选项中，请重新选择。')).toBeTruthy();
    expect(runtime.getForm('model').getSnapshot().values.choice).toBe(0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => runtime.setState('options', [{ label: '类型错误', value: '3' }]));
    expect(screen.getByRole('alert').textContent).toContain('选项实际值类型必须与绑定字段一致');
    act(() => runtime.setState('options', numeric));
    expect(screen.getByRole('combobox', { name: '类别' }).textContent).toBe('零');
    error.mockRestore();
    runtime.dispose();
  });

  it('runs native value callbacks as event expressions on unbound selects', async () => {
    const app = fixture();
    app.dependencies.actions['state.set'] = '1.0.0';
    app.pages[0].state = [{ id: 'choice', type: 'number', initial: 1 }];
    const node = app.pages[0].children[0].children![0];
    delete node.field;
    node.props.label = literal('独立选择');
    node.props.value = { kind: 'stateRef', stateId: 'choice' };
    node.on = {
      onValueChange: [
        {
          id: 'set',
          action: 'state.set',
          input: {
            stateId: literal('choice'),
            value: { kind: 'expression', language: 'javascript', source: 'event' },
          },
        },
      ],
    };
    const runtime = new PageRuntime(compileApplication(app, registry), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    choose('独立选择', '零');
    await waitFor(() => expect(runtime.getState().choice).toBe(0));
    runtime.dispose();
  });
});

describe('select authoring guards', () => {
  it('compiles the standalone example and preserves its numeric model definition', () => {
    const plan = compileApplication(selectExample, registry);
    const runtime = new PageRuntime(plan, 'select-demo');
    expect(runtime.getForm('model').getSnapshot().values).toEqual({ category: '', priority: null });
    runtime.dispose();
  });

  it('adds numeric options and treats each apply as a separate undo step', () => {
    setupEditor();
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加选项' }));
    expect(screen.getByLabelText('选项 3 类型').getAttribute('data-value')).toBe('number');
    fireEvent.click(screen.getByRole('button', { name: '应用选项' }));
    changeControl(screen.getByLabelText('选项 3 名称'), '第三项');
    fireEvent.click(screen.getByRole('button', { name: '应用选项' }));
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect((screen.getByLabelText('选项 3 名称') as HTMLInputElement).value).toBe('选项 3');
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(screen.queryByLabelText('选项 3 名称')).toBeNull();
  });

  it('rejects malformed and duplicate options and field type mismatches atomically', () => {
    expect(
      selectOptionErrors([
        { label: 'a', value: 0 },
        { label: 'b', value: '0' },
      ]),
    ).toEqual([]);
    for (const options of [
      [{ label: '', value: 1 }],
      [{ label: 'a', value: '' }],
      [{ label: 'a', value: Infinity }],
      [{ label: 'a', value: 1, disabled: 'yes' }],
      [
        { label: 'a', value: 1 },
        { label: 'b', value: 1 },
      ],
    ])
      expect(selectOptionErrors(options).length).toBeGreaterThan(0);
    const doc = new EditorDocument(fixture(), registry);
    const before = doc.getSnapshot();
    expect(() =>
      doc.setProp('page', 'choice', 'options', literal([{ label: '错误', value: '0' }])),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    const app = fixture();
    app.pages[0].children[0].children![0].on = { onValueChange: [] };
    expect(() => compileApplication(app, registry)).toThrow();
    doc.bindField('page', 'choice');
    expect(
      findNode(doc.getSnapshot().plan.pages.get('page')!.schema, 'choice')!.node.props.value,
    ).toEqual(literal(null));
    doc.undo();
    expect(
      findNode(doc.getSnapshot().plan.pages.get('page')!.schema, 'choice')!.node.field,
    ).toEqual({ formId: 'model', fieldId: 'choice' });
  });

  it('edits options atomically, retains invalid drafts and supports undo', () => {
    setupEditor();
    const change = (label: string, value: string) =>
      changeControl(screen.getByLabelText(label), value);
    change('选项 2 值', '0');
    fireEvent.click(screen.getByRole('button', { name: '应用选项' }));
    expect(screen.getByRole('alert').textContent).toContain('值重复');
    expect((screen.getByLabelText('选项 2 值') as HTMLInputElement).value).toBe('0');
    change('选项 2 值', '3');
    change('选项 2 名称', '三');
    fireEvent.click(screen.getByRole('button', { name: '应用选项' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: '应用选项' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect((screen.getByLabelText('选项 2 值') as HTMLInputElement).value).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    expect((screen.getByLabelText('选项 2 值') as HTMLInputElement).value).toBe('3');
    fireEvent.click(screen.getByRole('combobox', { name: '类别' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    choose('类别', '三');
    expect(screen.getByRole('combobox', { name: '类别' }).textContent).toBe('三');
  });

  it('inserts from palette and creates a numeric field from numeric options', () => {
    const app = fixture();
    delete app.pages[0].children[0].children![0].field;
    Object.assign(app.pages[0].children[0].children![0].props, {
      label: literal('独立'),
      value: literal(null),
    });
    setupEditor(app);
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建并绑定字段' }));
    expect(screen.queryByLabelText('字段类型')).toBeNull();
    changeControl(screen.getByLabelText('字段 ID'), 'numeric');
    changeControl(screen.getByLabelText('字段名称'), '数字类别');
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定字段' }));
    expect(screen.getByRole('combobox', { name: '数字类别' }).textContent).toBe('请选择');
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(
      JSON.stringify(['model', 'numeric']),
    );
    insertMaterial('选择器');
    expect(screen.getByRole('combobox', { name: '选择器' })).toBeTruthy();
    expect(screen.queryByLabelText('绑定字段')).toBeNull();
  });
});
