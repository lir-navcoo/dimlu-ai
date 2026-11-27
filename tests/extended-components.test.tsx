import { act, StrictMode, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { componentsExample as componentExample } from './fixtures/example-json';
import { registry, materials } from '../src/materials';
import { catalog } from '../src/editor/catalog';
import { defaultArrayFields } from '../src/editor/extended-catalog';
import { EditorDocument, findNode } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { validateApplication } from '../packages/schema/validate';
import { validTemporal, temporalError } from '../packages/schema/formats';
import { FormRuntime } from '../packages/runtime/form';
import type {
  ApplicationSchema,
  FieldDefinition,
  Json,
  NodeSchema,
  Value,
} from '../packages/schema/types';
import { RadioGroupMaterial, CheckboxGroupMaterial } from '../src/materials/groups';
import { RateMaterial } from '../src/materials/rate';
import { SliderMaterial } from '../src/materials/slider';
import { ColorPickerMaterial } from '../src/materials/color-picker';
import { CascaderMaterial } from '../src/materials/cascader';
import { UploadMaterial, readFiles } from '../src/materials/upload';
import { RichTextMaterial } from '../src/materials/rich-text';
import { DateMaterial } from '../src/materials/temporal';
import { FieldArrayMaterial } from '../src/materials/field-array';
import { TableMaterial, safeHref, ImageMaterial, DataStatus } from '../src/materials/data';
import { DialogMaterial, LoadingMaterial, MaterialEffects } from '../src/materials/feedback';
import { TabsMaterial, TabPanelMaterial, FormMaterial } from '../src/materials/containers';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
function app(children: NodeSchema[] = []): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'components',
    title: '组件验收',
    entryPageId: 'page',
    dependencies: {
      components: Object.fromEntries(
        Object.entries(registry.components).map(([key, value]) => [key, value.version]),
      ),
      actions: { 'ui.notify': '1.0.0' },
    },
    pages: [{ id: 'page', title: '组件', state: [], children }],
  };
}
function node(component: string, id = component): NodeSchema {
  return {
    id,
    component,
    props: Object.fromEntries(
      Object.entries(catalog[component].defaultProps).map(([key, value]) => [key, literal(value)]),
    ),
  };
}
function runtime(schema: ApplicationSchema) {
  return new PageRuntime(compileApplication(schema, registry), 'page');
}
const fields = defaultArrayFields as FieldDefinition[];

describe('extended material contracts', () => {
  it('compiles and renders every page of the published component example', () => {
    const plan = compileApplication(componentExample, registry);
    for (const page of plan.schema.pages) {
      const rt = new PageRuntime(plan, page.id);
      const view = render(<RuntimeRenderer runtime={rt} materials={materials} designMode />);
      expect(rt.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
      view.unmount();
      rt.dispose();
    }
  });
  it('inserts and renders every palette default in both design and preview without runtime errors', () => {
    const document = new EditorDocument(app(), registry);
    for (const [component, metadata] of Object.entries(catalog))
      if (metadata.palette !== false && metadata.insertable !== false)
        document.insertNode('page', node(component));
    const rt = new PageRuntime(document.getSnapshot().plan, 'page');
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} designMode />);
    expect(screen.queryByText(/无法显示/)).toBeNull();
    view.rerender(<RuntimeRenderer runtime={rt} materials={materials} />);
    expect(rt.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    rt.dispose();
  });
  it('creates, binds, unbinds and undoes a detail model atomically and rejects a cross-form move', () => {
    const form = node('ui.form', 'form');
    form.formId = 'model';
    form.children = [node('ui.fieldArray', 'detail')];
    const schema = app([form]);
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [{ id: 'name', path: ['name'], label: '名称', type: 'string', initial: '' }],
      },
    ];
    const document = new EditorDocument(schema, registry);
    document.configureFieldArray('page', 'detail', {
      id: 'items',
      path: ['order', 'items'],
      label: '明细',
      fields,
      initial: [{ name: 'A', quantity: 2 }],
      maxItems: 3,
    });
    expect(() => document.moveNode('page', 'detail', {})).toThrow(/所属|表单|绑定/);
    document.bindFieldArray('page', 'detail');
    expect(
      findNode(document.getSnapshot().plan.schema.pages[0], 'detail')!.node.props.value,
    ).toEqual(literal([{ name: 'A', quantity: 2 }]));
    document.undo();
    expect(
      findNode(document.getSnapshot().plan.schema.pages[0], 'detail')!.node.props.arrayId,
    ).toEqual(literal('items'));
    document.undo();
    expect(document.getSnapshot().plan.schema.pages[0].forms![0].arrays).toBeUndefined();
  });
});

describe('rate material', () => {
  it('updates full and half ratings while exposing the grade', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, setValue] = useState(0);
      return (
        <RateMaterial
          label="满意度"
          value={value}
          allowHalf
          showGrade
          onValueChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: '3 分' }));
    expect(changed).toHaveBeenLastCalledWith(3);
    expect(screen.getByText('3/5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '3.5 分' }));
    expect(changed).toHaveBeenLastCalledWith(3.5);
    expect(screen.getByText('3.5/5')).toBeTruthy();
  });
  it('honors count and disabled state', () => {
    render(<RateMaterial label="评分" value={2} count={3} disabled showGrade />);
    expect(screen.getByText('2/3')).toBeTruthy();
    expect(
      screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
  });
  it('clears the current rating when allowClear is on', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, setValue] = useState(3);
      return (
        <RateMaterial
          label="评分"
          value={value}
          allowClear
          onValueChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Demo />);
    fireEvent.click(screen.getByRole('button', { name: '3 分' }));
    expect(changed).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: '3 分' }));
    expect(changed).toHaveBeenLastCalledWith(3);
  });
});

describe('slider material', () => {
  it('updates the value and keeps it within min/max, snapped to step', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, setValue] = useState(30);
      return (
        <SliderMaterial
          label="进度"
          value={value}
          min={0}
          max={10}
          step={2}
          onValueChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Demo />);
    const range = screen.getByRole('slider') as HTMLInputElement;
    expect(range.min).toBe('0');
    expect(range.max).toBe('10');
    expect(range.step).toBe('2');
    fireEvent.change(range, { target: { value: '7' } });
    expect(changed).toHaveBeenLastCalledWith(8);
    expect(screen.getByText('8')).toBeTruthy();
  });
  it('honors disabled and hides the value output on demand', () => {
    render(<SliderMaterial label="音量" value={5} disabled showValue={false} />);
    const range = screen.getByRole('slider') as HTMLInputElement;
    expect(range.disabled).toBe(true);
    expect(screen.queryByText('5')).toBeNull();
  });
});

describe('color picker material', () => {
  it('emits hex colors from the swatch and keeps the text field in sync', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, setValue] = useState('#4f46e5');
      return (
        <ColorPickerMaterial
          label="主题色"
          value={value}
          onValueChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Demo />);
    fireEvent.change(screen.getByLabelText('主题色颜色选择器'), { target: { value: '#ff0000' } });
    expect(changed).toHaveBeenLastCalledWith('#ff0000');
    expect((screen.getByLabelText('主题色颜色值') as HTMLInputElement).value).toBe('#ff0000');
  });
  it('ignores invalid hex typed into the text field', () => {
    const changed = vi.fn();
    render(<ColorPickerMaterial label="颜色" value="#123456" onValueChange={changed} />);
    fireEvent.change(screen.getByLabelText('颜色颜色值'), { target: { value: 'not-a-color' } });
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('cascader material', () => {
  const options = [
    {
      label: '华东',
      value: 'east',
      children: [
        { label: '上海', value: 'shanghai' },
        { label: '杭州', value: 'hangzhou' },
      ],
    },
    { label: '华北', value: 'north', children: [{ label: '北京', value: 'beijing' }] },
  ];
  it('walks columns and commits a leaf path', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <CascaderMaterial
          label="地区"
          options={options}
          value={value}
          onValueChange={(next) => {
            changed(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Demo />);
    fireEvent.click(screen.getByText('请选择'));
    expect(screen.getByText('华北')).toBeTruthy();
    fireEvent.click(screen.getByText('华东'));
    fireEvent.click(screen.getByText('杭州'));
    expect(changed).toHaveBeenLastCalledWith(['east', 'hangzhou']);
    expect(screen.getByText('华东 / 杭州')).toBeTruthy();
  });
  it('shows selected labels for a controlled path', () => {
    render(
      <CascaderMaterial label="地区" options={options} value={['north', 'beijing']} disabled />,
    );
    const trigger = screen.getByText('华北 / 北京').closest('button')!;
    expect(trigger.disabled).toBe(true);
  });
});

describe('upload material', () => {
  it('renders existing attachments and removes one', () => {
    const changed = vi.fn();
    render(
      <UploadMaterial
        label="附件"
        value={['data:image/png;base64,aGk=', 'https://example.com/a.pdf']}
        onValueChange={changed}
        multiple
      />,
    );
    expect(screen.getByAltText('附件 1')).toBeTruthy();
    expect(screen.getByText('附件 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '移除附件 2' }));
    expect(changed).toHaveBeenLastCalledWith(['data:image/png;base64,aGk=']);
  });
  it('disables the picker at maxCount', () => {
    render(<UploadMaterial label="附件" value={['a', 'b']} maxCount={2} multiple />);
    expect((screen.getByLabelText('附件选择文件') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('rich text material', () => {
  it('renders initial HTML and accepts external value changes without publishing edits', async () => {
    const changed = vi.fn();
    const view = render(<RichTextMaterial label="正文" value="<p>hello</p>" onValueChange={changed} />);
    expect(screen.getByRole('textbox', { name: '正文' }).textContent).toBe('hello');
    view.rerender(<RichTextMaterial label="正文" value="<p>world</p>" onValueChange={changed} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '正文' }).textContent).toBe('world'));
    expect(changed).not.toHaveBeenCalled();
  });
  it('exposes format tools and honors disabled', () => {
    render(<RichTextMaterial label="正文" value="" disabled />);
    expect(screen.getByRole('button', { name: '粗体' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '粗体' }) as HTMLButtonElement).disabled).toBe(true);
    const editor = screen.getByRole('textbox', { name: '正文' });
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(editor.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('typed option groups', () => {
  it('keeps numeric zero distinct from text zero and supports standalone local selection', () => {
    render(
      <RadioGroupMaterial
        label="单选"
        value={null}
        options={[
          { label: '数字零', value: 0 },
          { label: '文本零', value: '0' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '数字零' }));
    expect(screen.getByRole('radio', { name: '数字零' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '文本零' }));
    expect(screen.getByRole('radio', { name: '文本零' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: '数字零' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });
  it('emits actual typed arrays and honors disabled options', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, set] = useState<(string | number)[]>([]);
      return (
        <CheckboxGroupMaterial
          label="多选"
          value={value}
          onValueChange={(next) => {
            changed(next);
            set(next);
          }}
          options={[
            { label: '数字零', value: 0 },
            { label: '文本零', value: '0' },
            { label: '禁用', value: 2, disabled: true },
          ]}
        />
      );
    }
    render(<Demo />);
    fireEvent.click(screen.getByRole('checkbox', { name: '数字零' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '文本零' }));
    expect(changed).toHaveBeenLastCalledWith([0, '0']);
    fireEvent.click(screen.getByRole('checkbox', { name: '禁用' }));
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe('temporal values', () => {
  it.each([
    ['2024-02-29', 'date', true],
    ['2023-02-29', 'date', false],
    ['1900-02-29', 'date', false],
    ['2000-02-29', 'date', true],
    ['2026-13', 'month', false],
    ['23:59:59', 'time', true],
    ['24:00', 'time', false],
    ['2026-11-08T10:20', 'datetime-local', true],
  ] as const)('validates %s as %s', (value, format, valid) => {
    expect(validTemporal(value, format)).toBe(valid);
  });
  it('permits equal boundaries and compares times with and without seconds consistently', () => {
    expect(temporalError(['12:00:00', '12:00'], { format: 'time', range: true })).toBeUndefined();
    expect(temporalError(['12:00:01', '12:00'], { format: 'time', range: true })).toContain('晚于');
    expect(
      temporalError(['2026-11-08', '2026-11-08'], { format: 'date', range: true }),
    ).toBeUndefined();
  });
  it('retains partial input but blocks submission until the range is complete and ordered, then resets', async () => {
    const field: FieldDefinition = {
      id: 'dates',
      path: ['dates'],
      label: '日期范围',
      type: 'array',
      itemType: 'string',
      uniqueItems: false,
      format: 'date',
      range: true,
      initial: [],
      rules: [{ kind: 'required', message: '请选择日期' }],
    };
    const store = new FormRuntime({ id: 'model', fields: [field] });
    const submit = vi.fn();
    store.setValue('dates', ['2026-11-08', '']);
    expect(await store.submit(submit)).toBe(false);
    store.setValue('dates', ['2026-11-08', '2026-11-07']);
    expect(await store.submit(submit)).toBe(false);
    store.setValue('dates', ['2026-11-08', '2026-11-08']);
    expect(await store.submit(submit)).toBe(true);
    expect(submit.mock.calls[0][0]).toEqual({ dates: ['2026-11-08', '2026-11-08'] });
    store.reset();
    expect(store.getSnapshot().values.dates).toEqual([]);
    store.dispose();
  });
  it('gives each range boundary a distinct accessible name and clears inside the control', () => {
    render(<DateMaterial label="行程" range value={[]} />);
    fireEvent.input(screen.getByLabelText('行程开始'), { target: { value: '2026-11-08' } });
    expect((screen.getByLabelText('行程开始') as HTMLInputElement).value).toBe('2026-11-08');
    expect(screen.getByLabelText('行程结束')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清空行程' }));
    expect((screen.getByLabelText('行程开始') as HTMLInputElement).value).toBe('');
  });
  it('creates a compatible date range field and rejects binding an ordinary text array atomically', () => {
    const form = node('ui.form', 'form');
    form.formId = 'model';
    const date = node('ui.date', 'date');
    date.props.range = literal(true);
    date.props.value = literal([]);
    form.children = [date];
    const schema = app([form]);
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [
          {
            id: 'ordinary',
            path: ['ordinary'],
            label: '普通数组',
            type: 'array',
            itemType: 'string',
            initial: [],
          },
        ],
      },
    ];
    const document = new EditorDocument(schema, registry);
    const before = document.exportJson();
    expect(() =>
      document.bindField('page', 'date', { formId: 'model', fieldId: 'ordinary' }),
    ).toThrow();
    expect(document.exportJson()).toBe(before);
    document.createField(
      'page',
      'model',
      {
        id: 'dates',
        path: ['dates'],
        label: '日期',
        type: 'array',
        itemType: 'string',
        initial: [],
        ...registry.components['ui.date'].field!.defaults!({ range: true }),
      },
      'date',
    );
    expect(findNode(document.getSnapshot().plan.schema.pages[0], 'date')!.node.field).toEqual({
      formId: 'model',
      fieldId: 'dates',
    });
    document.undo();
    expect(document.exportJson()).toBe(before);
  });
  it('rejects malformed temporal values in authored detail rows', () => {
    const schema = app();
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [],
        arrays: [
          {
            id: 'rows',
            path: ['rows'],
            label: '明细',
            fields: [
              {
                id: 'date',
                path: ['date'],
                type: 'string',
                label: '日期',
                format: 'date',
                initial: '',
              },
            ],
            initial: [{ date: '2026-02-30' }],
          },
        ],
      },
    ];
    expect(
      validateApplication(schema, registry).some((issue) => issue.code === 'field.format'),
    ).toBe(true);
  });
});

describe('generic detail interaction', () => {
  it('rejects options with the wrong field value type in both standalone and bound details', () => {
    const detail = node('ui.fieldArray', 'detail');
    detail.props.options = literal({ quantity: [{ label: '一', value: '1' }] });
    expect(
      validateApplication(app([detail]), registry).some((issue) =>
        issue.message.includes('选项实际值类型'),
      ),
    ).toBe(true);
    const form = node('ui.form', 'form');
    form.formId = 'model';
    form.children = [
      {
        id: 'detail',
        component: 'ui.fieldArray',
        props: {
          formId: literal('model'),
          arrayId: literal('items'),
          options: detail.props.options,
        },
      },
    ];
    const schema = app([form]);
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [],
        arrays: [{ id: 'items', path: ['items'], label: '明细', fields, initial: [] }],
      },
    ];
    expect(
      validateApplication(schema, registry).some((issue) =>
        issue.message.includes('选项实际值类型'),
      ),
    ).toBe(true);
  });
  it('keeps a standalone detail store usable after StrictMode effect replay', () => {
    render(
      <StrictMode>
        <FieldArrayMaterial fields={fields} value={[]} />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: '新增一行' }));
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), {
      target: { value: '有效明细' },
    });
    expect((screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement).value).toBe(
      '有效明细',
    );
  });
  it('retains row elements and focus through controlled updates, reorder and delete', () => {
    const changed = vi.fn();
    function Demo() {
      const [value, set] = useState([
        { name: 'A', quantity: 1 },
        { name: 'B', quantity: 2 },
      ]);
      return (
        <FieldArrayMaterial
          fields={fields}
          value={value}
          maxItems={3}
          onValueChange={(next) => {
            changed(next);
            set(next as typeof value);
          }}
        />
      );
    }
    render(<Demo />);
    const first = screen.getAllByRole('textbox', { name: '名称' })[0];
    first.focus();
    fireEvent.change(first, { target: { value: 'AA' } });
    expect(screen.getAllByRole('textbox', { name: '名称' })[0]).toBe(first);
    expect(document.activeElement).toBe(first);
    fireEvent.click(screen.getByRole('button', { name: '下移第 1 行' }));
    expect(screen.getAllByRole('textbox', { name: '名称' })[1]).toBe(first);
    fireEvent.click(screen.getByRole('button', { name: '删除第 1 行' }));
    expect(screen.getAllByRole('textbox', { name: '名称' })[0]).toBe(first);
    expect(changed).toHaveBeenLastCalledWith([{ name: 'AA', quantity: 1 }]);
  });
  it('uses the form store for nested payloads, validation, limits and reset', async () => {
    const form = node('ui.form', 'form');
    form.formId = 'model';
    form.children = [
      {
        id: 'detail',
        component: 'ui.fieldArray',
        props: { formId: literal('model'), arrayId: literal('items') },
      },
    ];
    const schema = app([form]);
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [],
        arrays: [
          {
            id: 'items',
            path: ['order', 'items'],
            label: '明细',
            fields,
            initial: [],
            minItems: 1,
            maxItems: 1,
          },
        ],
      },
    ];
    const rt = runtime(schema);
    render(<RuntimeRenderer runtime={rt} materials={materials} />);
    fireEvent.click(screen.getByRole('button', { name: '新增一行' }));
    expect((screen.getByRole('button', { name: '新增一行' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: '删除第 1 行' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const store = rt.getForm('model'),
      submit = vi.fn();
    await act(async () => {
      expect(await store.submit(submit)).toBe(false);
    });
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '零件' } });
    await act(async () => {
      expect(await store.submit(submit)).toBe(true);
    });
    expect(submit.mock.calls[0][0]).toEqual({ order: { items: [{ name: '零件', quantity: 1 }] } });
    act(() => store.reset());
    expect(screen.queryByRole('textbox', { name: '名称' })).toBeNull();
    rt.dispose();
  });
});

describe('data presentation', () => {
  const data = [
    { id: 0, name: 'B', amount: 20 },
    { id: '0', name: 'A', amount: 10 },
    { id: 3, name: 'C', amount: 30 },
  ];
  const columns = [
    { key: 'name', title: '名称', sortable: false },
    { key: 'amount', title: '金额', sortable: true },
  ];
  it('sorts, pages and selects only current-page typed keys without losing other selections', () => {
    const selected = vi.fn();
    function Demo() {
      const [keys, set] = useState<(string | number)[]>([]);
      return (
        <TableMaterial
          data={data}
          columns={columns}
          pageSize={2}
          selectionMode="multiple"
          selectedKeys={keys}
          onSelectionChange={(next) => {
            selected(next);
            set(next);
          }}
        />
      );
    }
    render(<Demo />);
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页全部行' }));
    expect(selected).toHaveBeenLastCalledWith([0, '0']);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页全部行' }));
    expect(selected).toHaveBeenLastCalledWith([0, '0', 3]);
    fireEvent.click(screen.getByRole('button', { name: '排序金额' }));
    expect(screen.getAllByRole('row')[1].textContent).toContain('A');
    fireEvent.click(screen.getByRole('button', { name: '排序金额' }));
    expect(screen.getAllByRole('row')[1].textContent).toContain('C');
  });
  it('supports uncontrolled selection when optional selectedKeys is omitted', () => {
    render(<TableMaterial data={data} columns={columns} selectionMode="multiple" />);
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(screen.getAllByRole('checkbox')[1].getAttribute('aria-checked')).toBe('true');
  });
  it('rejects duplicate keys and unsafe links and displays loading/error/retry states', () => {
    const table = node('ui.table');
    table.props.data = literal([{ id: 'a' }, { id: 'a' }]);
    expect(
      validateApplication(app([table]), registry).some((issue) => issue.message.includes('rowKey')),
    ).toBe(true);
    expect(safeHref('javascript:alert(1)')).toBe(false);
    expect(safeHref('/details?id=1')).toBe(true);
    const retry = vi.fn(),
      view = render(<DataStatus loading />);
    expect(screen.getByRole('status').textContent).toContain('加载');
    view.rerender(<DataStatus error="请求失败" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledOnce();
    view.rerender(<ImageMaterial src="/broken.png" alt="附件" />);
    fireEvent.error(screen.getByRole('img', { name: '附件' }));
    expect(screen.getByText('图片加载失败')).toBeTruthy();
  });
  it('passes slot row scope through expressions and renders fallback cells for empty slots', () => {
    const table = node('ui.table');
    table.props.data = literal(data);
    table.props.columns = literal(columns);
    table.slots = {
      cell: {
        params: ['row', 'column', 'value', 'index'],
        children: [
          { id: 'cell-text', component: 'ui.text', props: { value: expression('scope.value') } },
        ],
      },
      actions: { params: ['row', 'index'], children: [] },
    };
    const rt = runtime(app([table]));
    render(<RuntimeRenderer runtime={rt} materials={materials} />);
    expect(screen.getByRole('cell', { name: 'B' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull();
    rt.dispose();
  });
  it('runs actions from separate slot row instances concurrently without canceling each other', async () => {
    const pending: { key: Json; signal: AbortSignal; resolve: () => void }[] = [];
    const custom = {
      ...registry,
      actions: {
        ...registry.actions,
        'test.row': {
          version: '1.0.0',
          input: { key: { type: 'json' as const, required: true } },
          execute(input: Record<string, Json>, context: { signal: AbortSignal }) {
            return new Promise<void>((resolve) =>
              pending.push({ key: input.key, signal: context.signal, resolve }),
            );
          },
        },
      },
    };
    const table = node('ui.table');
    table.props.data = literal(data);
    table.slots = {
      actions: {
        params: ['row', 'index'],
        children: [
          {
            id: 'action',
            component: 'ui.button',
            props: { label: literal('处理行') },
            on: {
              onClick: [
                {
                  id: 'row-action',
                  action: 'test.row',
                  input: { key: expression('scope.row.id') },
                },
              ],
            },
          },
        ],
      },
    };
    const schema = app([table]);
    schema.dependencies.actions['test.row'] = '1.0.0';
    const rt = new PageRuntime(compileApplication(schema, custom), 'page');
    render(<RuntimeRenderer runtime={rt} materials={materials} />);
    fireEvent.click(screen.getAllByRole('button', { name: '处理行' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '处理行' })[1]);
    expect(pending.map((entry) => entry.key)).toEqual([0, '0']);
    expect(pending.every((entry) => !entry.signal.aborted)).toBe(true);
    await act(async () => {
      pending.forEach((entry) => entry.resolve());
    });
    rt.dispose();
  });
});

describe('containers and feedback', () => {
  it('switches tabs without remounting their native input state', () => {
    render(
      <TabsMaterial>
        <TabPanelMaterial value="a" label="页签甲">
          <input aria-label="草稿" defaultValue="" />
        </TabPanelMaterial>
        <TabPanelMaterial value="b" label="页签乙">
          其他内容
        </TabPanelMaterial>
      </TabsMaterial>,
    );
    const input = screen.getByRole('textbox', { name: '草稿' });
    fireEvent.change(input, { target: { value: '保留' } });
    fireEvent.click(screen.getByRole('tab', { name: '页签乙' }));
    fireEvent.click(screen.getByRole('tab', { name: '页签甲' }));
    expect(screen.getByRole('textbox', { name: '草稿' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('保留');
  });
  it('keeps tab header order in sync with schema order', () => {
    const tabs = node('ui.tabs', 'tabs');
    const a = node('ui.tabPanel', 'a'),
      b = node('ui.tabPanel', 'b');
    a.props.label = literal('甲');
    b.props.label = literal('乙');
    tabs.children = [b, a];
    const rt = runtime(app([tabs]));
    render(<RuntimeRenderer runtime={rt} materials={materials} />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['乙', '甲']);
    rt.dispose();
  });
  it('keeps a schema dialog open when its confirmation action fails', async () => {
    const dialog = node('ui.dialog');
    dialog.on = {
      onConfirm: [
        {
          id: 'invalid-notice',
          action: 'ui.notify',
          input: { title: literal(''), tone: literal('info') },
        },
      ],
    };
    const rt = runtime(app([dialog]));
    render(<RuntimeRenderer runtime={rt} materials={materials} />);
    fireEvent.click(screen.getByRole('button', { name: '打开对话框' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '通知标题不能为空');
    expect(screen.getByRole('dialog', { name: '对话框标题' })).toBeTruthy();
    rt.dispose();
  });
  it('keeps dialog content mounted across close and surfaces async confirmation failures', async () => {
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('保存失败'))
      .mockResolvedValueOnce(undefined);
    render(
      <DialogMaterial title="编辑" triggerLabel="打开编辑" onConfirm={confirm}>
        <input aria-label="草稿" />
      </DialogMaterial>,
    );
    fireEvent.click(screen.getByRole('button', { name: '打开编辑' }));
    const dialog = await screen.findByRole('dialog', { name: '编辑' });
    const input = within(dialog).getByRole('textbox', { name: '草稿' });
    fireEvent.change(input, { target: { value: '保留' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    await screen.findByText('保存失败');
    expect(screen.getByRole('dialog', { name: '编辑' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '打开编辑' }));
    expect(screen.getByRole('textbox', { name: '草稿' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('保留');
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑' })).toBeNull());
  });
  it('keeps dialog child state across switching between authoring and preview', async () => {
    const dialog = node('ui.dialog');
    dialog.children = [
      {
        id: 'input',
        component: 'ui.input',
        props: { label: literal('弹层草稿'), value: literal('') },
      },
    ];
    function Draft({ label }: { label: string }) {
      const [value, set] = useState('');
      return (
        <input aria-label={label} value={value} onChange={(event) => set(event.target.value)} />
      );
    }
    const nativeMaterials = { ...materials, 'ui.input': Draft };
    const rt = runtime(app([dialog]));
    const view = render(<RuntimeRenderer runtime={rt} materials={nativeMaterials} designMode />);
    const input = screen.getByRole('textbox', { name: '弹层草稿' });
    fireEvent.change(input, { target: { value: '保留' } });
    view.rerender(<RuntimeRenderer runtime={rt} materials={nativeMaterials} />);
    fireEvent.click(screen.getByRole('button', { name: '打开对话框' }));
    expect(await screen.findByRole('textbox', { name: '弹层草稿' })).toBe(input);
    expect((input as HTMLInputElement).value).toBe('保留');
    rt.dispose();
  });
  it('summarizes errors and focuses their field, with blocking loading and read-only support', async () => {
    render(
      <FormMaterial readOnly>
        <div className="material-field">
          <label htmlFor="test-name">姓名</label>
          <input id="test-name" />
          <small className="field-error" role="alert">
            请填写姓名
          </small>
        </div>
      </FormMaterial>,
    );
    expect((document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    expect(await screen.findByRole('region', { name: '表单错误汇总' })).toBeTruthy();
    cleanup();
    render(
      <LoadingMaterial>
        <button>内容操作</button>
      </LoadingMaterial>,
    );
    expect(document.querySelector('.material-loading-content')!.hasAttribute('inert')).toBe(true);
  });
  it('isolates notifications per runtime and stops effects after disposal', async () => {
    const schema = app([
      {
        id: 'notify',
        component: 'ui.button',
        props: { label: literal('通知') },
        on: {
          onClick: [
            {
              id: 'notice',
              action: 'ui.notify',
              input: { title: literal('已保存'), tone: literal('success') },
            },
          ],
        },
      },
    ]);
    const first = runtime(schema),
      second = runtime(schema),
      other = vi.fn();
    second.subscribeEffects(other);
    render(
      <>
        <MaterialEffects runtime={first} />
        <RuntimeRenderer runtime={first} materials={materials} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    expect(await screen.findByText('已保存')).toBeTruthy();
    expect(other).not.toHaveBeenCalled();
    first.dispose();
    const late = vi.fn();
    first.subscribeEffects(late);
    first.emitEffect({ type: 'ui.notify', data: { title: '迟到' } });
    expect(late).not.toHaveBeenCalled();
    second.dispose();
  });
});
