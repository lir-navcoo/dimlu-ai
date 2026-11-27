import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SelectMaterial } from '../src/SelectMaterial';
import { validateSelectProps } from '../src/select-options';
import { registry, materials } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { ApplicationSchema, Json, Value } from '../packages/schema/types';
import { FormRuntime } from '../packages/runtime/form';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl, showStructure } from './ui-helpers';
import { multiSelectExample as example } from './fixtures/example-json';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const fixture = () => structuredClone(compileApplication(example, registry).schema);
function clickOption(name: string) {
  const item = screen.getByRole('option', { name });
  fireEvent.pointerDown(item, { pointerType: 'mouse', button: 0 });
  fireEvent.click(item);
}
function setupEditor(app = fixture(), id = 'independent') {
  seedLegacyProject();
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  changeControl(screen.getByLabelText('应用定义 · JSON'), JSON.stringify(app));
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
  showStructure();
  fireEvent.click(screen.getByRole('button', { name: `选中 选择器 ${id}` }));
}
function readSchema(): ApplicationSchema {
  return JSON.parse((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value);
}

describe('multiple select', () => {
  it('keeps typed values, toggles in an open popup, skips disabled items and clears inside the control', () => {
    render(
      <SelectMaterial
        multiple
        label="类型"
        value={[]}
        options={[
          { label: '数字零', value: 0 },
          { label: '文本零', value: '0' },
          { label: '禁用项', value: 'x', disabled: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('combobox', { name: '类型' }));
    expect(screen.getByRole('listbox').getAttribute('aria-multiselectable')).toBe('true');
    clickOption('数字零');
    clickOption('文本零');
    clickOption('禁用项');
    expect(screen.getByRole('combobox').textContent).toBe('数字零、文本零');
    expect(screen.getByRole('option', { name: '数字零' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    clickOption('数字零');
    expect(screen.getByRole('combobox').textContent).toBe('文本零');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    const clear = screen.getByRole('button', { name: '清空类型' });
    expect(clear.closest('.material-select-controls')).toBeTruthy();
    fireEvent.click(clear);
    expect(screen.getByRole('combobox').textContent).toBe('请选择');
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
  });

  it('uses the native array callback and accepts controlled updates', () => {
    const changed = vi.fn();
    const view = render(
      <SelectMaterial
        multiple
        label="受控"
        value={[0]}
        options={[
          { label: '零', value: 0 },
          { label: '文本', value: '0' },
        ]}
        onValueChange={changed}
      />,
    );
    fireEvent.click(screen.getByRole('combobox'));
    clickOption('文本');
    expect(changed).toHaveBeenLastCalledWith([0, '0']);
    expect(screen.getByRole('combobox').textContent).toBe('零');
    view.rerender(
      <SelectMaterial
        multiple
        label="受控"
        value={[0, '0']}
        options={[
          { label: '零', value: 0 },
          { label: '文本', value: '0' },
        ]}
        onValueChange={changed}
      />,
    );
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '清空受控' }));
    expect(changed).toHaveBeenLastCalledWith([]);
  });

  it('binds typed arrays, validates selection count, submits and resets', async () => {
    const runtime = new PageRuntime(compileApplication(fixture(), registry), 'multi-select-demo');
    const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const store = runtime.getForm('model');
    fireEvent.click(screen.getByRole('combobox', { name: '采购类别' }));
    clickOption('办公用品');
    expect(store.getSnapshot().values.category).toEqual(['office']);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    act(() => store.validate());
    expect(screen.getByRole('alert').textContent).toBe('至少选择两个类别');
    fireEvent.click(screen.getByRole('combobox', { name: '采购类别' }));
    clickOption('设备采购');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    let submitted: unknown;
    await act(async () => {
      await store.handleSubmit(async (values) => {
        submitted = values;
      })({ preventDefault() {} });
    });
    expect(submitted).toEqual({ category: ['office', 'equipment'], priority: [0] });
    fireEvent.click(screen.getByRole('button', { name: '清空采购类别' }));
    expect(store.getSnapshot().values.category).toEqual([]);
    expect(screen.getByRole('alert').textContent).toBe('请选择采购类别');
    fireEvent.reset(view.container.querySelector('form')!);
    expect(store.getSnapshot().isDirty).toBe(false);
    expect(screen.getByRole('combobox', { name: '优先级' }).textContent).toBe('低');
    runtime.dispose();
  });

  it('rejects invalid lists atomically, clones inputs and compares array defaults by value', () => {
    const runtime = new PageRuntime(compileApplication(fixture(), registry), 'multi-select-demo');
    const store = runtime.getForm('model');
    const values = [1, 2];
    store.setValue('priority', values);
    values.push(3);
    expect(store.getSnapshot().values.priority).toEqual([1, 2]);
    for (const invalid of [[0, '0'], [0, 0], [Infinity], null, 0, [true], [{}]]) {
      const before = store.getSnapshot();
      expect(() => store.setValue('priority', invalid)).toThrow();
      expect(store.getSnapshot()).toBe(before);
    }
    store.setValue('priority', [0]);
    expect(store.getSnapshot().fields.priority.dirty).toBe(false);
    expect(store.getSnapshot().isDirty).toBe(false);
    runtime.dispose();
  });

  it('checks maximum counts and locks both selection and clearing on disabled fields', () => {
    const app = fixture();
    app.pages[0].state = [{ id: 'locked', type: 'boolean', initial: false }];
    app.pages[0].forms![0].fields[1].disabled = { kind: 'stateRef', stateId: 'locked' };
    const runtime = new PageRuntime(compileApplication(app, registry), 'multi-select-demo');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const store = runtime.getForm('model');
    act(() => {
      store.setValue('category', ['office', 'equipment']);
      store.setValue('priority', [0, 1, 2]);
      store.validate();
    });
    expect(screen.getByRole('alert').textContent).toBe('最多选择两个优先级');
    act(() => runtime.setState('locked', true));
    expect((screen.getByRole('combobox', { name: '优先级' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: '清空优先级' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    act(() => store.setValue('priority', []));
    expect(store.getSnapshot().values.priority).toEqual([0, 1, 2]);
    runtime.dispose();
  });

  it('checks dynamic option element types and recovers without dropping selections', () => {
    const app = fixture();
    app.pages[0].state = [{ id: 'options', type: 'array', initial: [{ label: '零', value: 0 }] }];
    app.pages[0].children[2].children![1].props.options = { kind: 'stateRef', stateId: 'options' };
    const runtime = new PageRuntime(compileApplication(app, registry), 'multi-select-demo');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    act(() => runtime.setState('options', [{ label: '一', value: 1 }]));
    expect(screen.getByText('当前值已不在选项中，请重新选择。')).toBeTruthy();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => runtime.setState('options', [{ label: '文本', value: '0' }]));
    expect(screen.getByRole('alert').textContent).toContain('选项实际值类型必须与绑定字段一致');
    act(() => runtime.setState('options', [{ label: '零', value: 0 }]));
    expect(screen.getByRole('combobox', { name: '优先级' }).textContent).toBe('零');
    expect(runtime.getForm('model').getSnapshot().values.priority).toEqual([0]);
    error.mockRestore();
    runtime.dispose();
  });

  it('passes native array events into authored state actions', async () => {
    const app = fixture();
    app.dependencies.actions['state.set'] = '1.0.0';
    app.pages[0].state = [{ id: 'selection', type: 'array', initial: [] }];
    const node = app.pages[0].children.at(-1)!;
    node.props.value = { kind: 'stateRef', stateId: 'selection' };
    node.on = {
      onValueChange: [
        {
          id: 'save',
          action: 'state.set',
          input: {
            stateId: literal('selection'),
            value: { kind: 'expression', language: 'javascript', source: 'event' },
          },
        },
      ],
    };
    const runtime = new PageRuntime(compileApplication(app, registry), 'multi-select-demo');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    fireEvent.click(screen.getByRole('combobox', { name: '独立多选' }));
    clickOption('数字零');
    await waitFor(() => expect(runtime.getState().selection).toEqual([0]));
    clickOption('文本零');
    await waitFor(() => expect(runtime.getState().selection).toEqual([0, '0']));
    runtime.dispose();
  });

  it('validates typed lists within dynamic rows independently', () => {
    const field = fixture().pages[0].forms![0].fields[1];
    const store = new FormRuntime({
      id: 'rows',
      fields: [],
      arrays: [
        {
          id: 'items',
          path: ['items'],
          label: '明细',
          fields: [field],
          initial: [{ priority: [0] }],
        },
      ],
    });
    const row = store.getSnapshot().arrays.items.rows[0];
    const target = { arrayId: 'items', rowId: row.id, fieldId: 'priority' };
    store.setValue(target, [1]);
    store.setValue(target, [0]);
    expect(store.getFieldState(target)!.dirty).toBe(false);
    expect(() => store.append('items', { priority: ['0'] })).toThrow();
    expect(store.getSnapshot().arrays.items.rows).toHaveLength(1);
    store.dispose();
  });

  it('checks mode, field element types and defaults at import and binding', () => {
    expect(
      validateSelectProps({ multiple: true, options: [null] }, { fieldType: 'array' }),
    ).toEqual(['选项 1 必须包含名称和实际值']);
    expect(validateSelectProps({ multiple: true, value: [0, '0'] }, {})).toEqual([]);
    for (const props of [
      { multiple: true, value: null },
      { value: [] },
      { multiple: true, value: [0, 0] },
    ])
      expect(validateSelectProps(props, {}).length).toBeGreaterThan(0);
    const doc = new EditorDocument(fixture(), registry);
    const before = doc.getSnapshot();
    expect(() =>
      doc.setProp('multi-select-demo', 'priority', 'multiple', literal(false)),
    ).toThrow();
    expect(() =>
      doc.setProp(
        'multi-select-demo',
        'priority',
        'options',
        literal([{ label: '文本', value: '0' }]),
      ),
    ).toThrow();
    expect(doc.getSnapshot()).toBe(before);
    for (const patch of [{ itemType: undefined }, { initial: ['0'] }, { initial: [0, 0] }]) {
      const app = fixture();
      Object.assign(app.pages[0].forms![0].fields[1], patch);
      expect(() => compileApplication(app, registry)).toThrow();
    }
    doc.bindField('multi-select-demo', 'priority');
    expect(
      findNode(doc.getSnapshot().plan.pages.get('multi-select-demo')!.schema, 'priority')!.node
        .props.value,
    ).toEqual(literal([0]));
    doc.undo();
    expect(
      findNode(doc.getSnapshot().plan.pages.get('multi-select-demo')!.schema, 'priority')!.node
        .field,
    ).toBeTruthy();
  });

  it('switches scalar/list values in one undo step and blocks incompatible bound mode changes', () => {
    const app = fixture();
    const node = app.pages[0].children.at(-1)!;
    node.props.multiple = literal(false);
    node.props.value = literal(0);
    setupEditor(app);
    changeControl(screen.getByLabelText('选择模式'), 'true');
    expect(readSchema().pages[0].children.at(-1)!.props.value).toEqual(literal([0]));
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(readSchema().pages[0].children.at(-1)!.props.value).toEqual(literal(0));
    expect(readSchema().pages[0].children.at(-1)!.props.multiple).toEqual(literal(false));
    fireEvent.click(screen.getByRole('button', { name: /重做/ }));
    changeControl(screen.getByLabelText('选择模式'), 'false');
    expect(readSchema().pages[0].children.at(-1)!.props.value).toEqual(literal(0));
    fireEvent.click(screen.getByRole('button', { name: '选中 选择器 priority' }));
    changeControl(screen.getByLabelText('选择模式'), 'false');
    expect(screen.getByRole('alert').textContent).toContain('请先解除字段绑定');
    expect(readSchema().pages[0].children[2].children![1].props.multiple).toEqual(literal(true));
  });

  it('creates and binds a numeric array field from the data panel', () => {
    const app = fixture();
    const node = app.pages[0].children[2].children![1];
    delete node.field;
    node.props.label = literal('独立数字');
    node.props.value = literal([]);
    setupEditor(app, 'priority');
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建并绑定字段' }));
    expect(screen.getByLabelText('数组元素类型').getAttribute('data-value')).toBe('number');
    changeControl(screen.getByLabelText('字段 ID'), 'levels');
    changeControl(screen.getByLabelText('字段名称'), '多选等级');
    changeControl(screen.getByLabelText('字段默认值'), '[0, 1]');
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定字段' }));
    const field = readSchema().pages[0].forms![0].fields.at(-1)!;
    expect(field).toMatchObject({ type: 'array', itemType: 'number', initial: [0, 1] });
    expect(screen.getByRole('combobox', { name: '多选等级' }).textContent).toBe('低、普通');
  });

  it('retains a dynamic value when a mode change would overwrite it', () => {
    const app = fixture();
    app.pages[0].state = [{ id: 'selection', type: 'number', initial: 0 }];
    const node = app.pages[0].children.at(-1)!;
    node.props.multiple = literal(false);
    node.props.value = { kind: 'stateRef', stateId: 'selection' };
    setupEditor(app);
    changeControl(screen.getByLabelText('选择模式'), 'true');
    expect(screen.getByRole('alert').textContent).toContain('请先处理选中值的动态绑定');
    expect(readSchema().pages[0].children.at(-1)!.props.value).toEqual(node.props.value);
    expect(readSchema().pages[0].children.at(-1)!.props.multiple).toEqual(literal(false));
  });
});
