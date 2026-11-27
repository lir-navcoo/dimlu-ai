import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { validateCatalog, type MaterialCatalog } from '../packages/editor/metadata';
import type { MaterialTemplate } from '../packages/editor/material-template';
import type { ApplicationSchema, Json, NodeSchema } from '../packages/schema/types';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import { catalog } from '../src/editor/catalog';
import {
  DragDropProvider,
  DropZone,
  materialNode,
  materialTemplate,
  useDragDrop,
} from '../src/editor/DragDrop';
import { TipProvider } from '../src/ui/primitives';

const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalElementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
const app = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'defaults-test',
  title: 'Defaults',
  entryPageId: 'page',
  dependencies: { components: {}, actions: {} },
  pages: [{ id: 'page', title: 'Page', state: [], children: [] }],
});
const make = () => new EditorDocument(app(), registry);
const page = (doc: EditorDocument) => doc.getSnapshot().plan.pages.get('page')!.schema;
const allIds = (node: NodeSchema): string[] => [
  node.id,
  ...(node.children ?? []).flatMap(allIds),
  ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children.flatMap(allIds)),
];
function Controls() {
  const drag = useDragDrop()!;
  return (
    <>
      <button
        onKeyDown={(event) => {
          if (event.key === ' ') drag.begin({ kind: 'material', component: 'ui.tabs' });
        }}
        onPointerDown={(event) => drag.begin({ kind: 'material', component: 'ui.tabs' }, event)}
      >
        Tabs source
      </button>
      <button onClick={() => drag.choose({ kind: 'inside', parentId: 'missing' })}>
        Invalid target
      </button>
      <button onClick={() => drag.finish()}>Force finish</button>
      <DropZone intent={{ kind: 'inside' }} label="Drop at page" />
    </>
  );
}
function Harness({ doc }: { doc: EditorDocument }) {
  const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  return (
    <TipProvider>
      <DragDropProvider document={doc} snapshot={snapshot} enabled>
        <Controls />
      </DragDropProvider>
    </TipProvider>
  );
}
function pointer(target: Element | Window, type: string, x = 10, y = 10) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(target, event);
}

describe('registered composite material defaults', () => {
  it('keeps the complete production catalog valid', () => {
    expect(validateCatalog(catalog, registry)).toEqual([]);
  });
  it('exposes text placeholders for date and time materials', () => {
    for (const component of ['ui.date', 'ui.time']) {
      const placeholder = catalog[component].properties.find(
        (property) => property.name === 'placeholder',
      );
      expect(placeholder).toMatchObject({ label: '占位提示', setter: { kind: 'text' } });
      expect(registry.components[component].props).toHaveProperty('placeholder');
    }
  });
  it('aligns input interaction props and readOnly across field materials', () => {
    const inputProps = registry.components['ui.input'].props!;
    for (const name of ['clearable', 'showCount', 'autoSize'])
      expect(inputProps, name).toHaveProperty(name);
    expect(
      catalog['ui.input'].properties.find((property) => property.name === 'autoSize')?.visibleWhen,
    ).toEqual({ prop: 'multiline', equals: true });
    for (const component of [
      'ui.input',
      'ui.number',
      'ui.select',
      'ui.checkbox',
      'ui.switch',
      'ui.radioGroup',
      'ui.checkboxGroup',
      'ui.date',
      'ui.time',
      'ui.rate',
      'ui.slider',
      'ui.colorPicker',
      'ui.cascader',
      'ui.upload',
      'ui.richText',
      'ui.fieldArray',
    ]) {
      expect(registry.components[component].props, component).toHaveProperty('readOnly');
      const property = (catalog[component]?.properties ?? []).find(
        (item) => item.name === 'readOnly',
      );
      expect(property, `${component} catalog readOnly`).toBeTruthy();
    }
  });
  it('renders clearable/showCount and honors readOnly on the input material', async () => {
    const lit = (value: Json) => ({ kind: 'literal', value }) as const;
    const stateRef = (stateId: string) => ({ kind: 'stateRef', stateId }) as const;
    const schema = app();
    schema.dependencies.components = { 'ui.input': '1.0.0' };
    schema.dependencies.actions = { 'state.set': '1.0.0' };
    schema.pages[0].state = [{ id: 'name', type: 'string', initial: '林知远' }];
    schema.pages[0].children = [
      {
        id: 'inp',
        component: 'ui.input',
        props: {
          label: lit('姓名'),
          value: stateRef('name'),
          clearable: lit(true),
          showCount: lit(true),
        },
        on: {
          onChange: [
            {
              id: 'set-name',
              action: 'state.set',
              input: { stateId: lit('name'), value: { kind: 'expression', language: 'javascript', source: 'event.target.value' } },
            },
          ],
        },
      },
      {
        id: 'locked',
        component: 'ui.input',
        props: {
          label: lit('工号'),
          value: stateRef('name'),
          clearable: lit(true),
          readOnly: lit(true),
        },
        on: {
          onChange: [
            {
              id: 'set-name-2',
              action: 'state.set',
              input: { stateId: lit('name'), value: { kind: 'expression', language: 'javascript', source: 'event.target.value' } },
            },
          ],
        },
      },
    ];
    const doc = new EditorDocument(schema, registry);
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    try {
      render(<RuntimeRenderer runtime={runtime} materials={materials} />);
      const textbox = screen.getByLabelText('姓名');
      expect(textbox.getAttribute('readonly')).toBeNull();
      expect(screen.getByLabelText('工号').getAttribute('readonly')).not.toBeNull();
      // showCount renders the current length
      expect(screen.getByText('3')).toBeTruthy();
      // clearable clears through the state action
      fireEvent.click(screen.getByRole('button', { name: '清空姓名' }));
      expect(runtime.getState().name).toBe('');
      expect(screen.queryByRole('button', { name: '清空姓名' })).toBeNull();
    } finally {
      runtime.dispose();
    }
  });
  it('registers the generic container with defaults, validation and events', () => {
    expect(catalog['ui.container']).toMatchObject({ title: '容器', category: '布局' });
    expect(catalog['ui.container'].properties).toEqual([
      expect.objectContaining({ name: 'minHeight', setter: { kind: 'number' } }),
    ]);
    const contract = registry.components['ui.container'];
    expect(contract.children).toBe(true);
    expect(contract.events).toContain('onClick');
    expect(contract.validateProps?.({ minHeight: 3000 }, {})).toContain(
      '最小高度必须在 0 到 2000 之间',
    );
    expect(contract.validateProps?.({ minHeight: 120 }, {})).toEqual([]);
  });
  it('renders container children with minHeight and click actions, and a design placeholder when empty', () => {
    const lit = (value: Json) => ({ kind: 'literal', value }) as const;
    const schema = app();
    schema.dependencies.components = {
      'ui.container': '1.0.0',
      'ui.text': '1.0.0',
      'ui.button': '1.0.0',
    };
    schema.dependencies.actions = { 'state.set': '1.0.0' };
    schema.pages[0].state = [{ id: 'count', type: 'number', initial: 0 }];
    schema.pages[0].children = [
      {
        id: 'box',
        component: 'ui.container',
        props: { minHeight: lit(120) },
        style: { backgroundColor: lit('#f0f0f0') },
        on: {
          onClick: [
            {
              id: 'bump',
              action: 'state.set',
              input: {
                stateId: lit('count'),
                value: { kind: 'expression', language: 'javascript', source: 'state.count + 1' },
              },
            },
          ],
        },
        children: [{ id: 'box-text', component: 'ui.text', props: { value: lit('容器内容') } }],
      },
      { id: 'blank', component: 'ui.container', props: {} },
    ];
    const doc = new EditorDocument(schema, registry);
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    try {
      render(
        <TipProvider>
          <RuntimeRenderer runtime={runtime} materials={materials} />
        </TipProvider>,
      );
      const container = screen.getByText('容器内容').closest<HTMLElement>('.material-container')!;
      expect(container.style.minHeight).toBe('120px');
      expect(container.style.backgroundColor).toBe('rgb(240, 240, 240)');
      fireEvent.click(screen.getByText('容器内容'));
      expect(runtime.getState().count).toBe(1);
      // Runtime empty containers stay silent; the drop hint is design-only.
      expect(screen.queryByText('容器 · 从左侧拖入组件')).toBeNull();
    } finally {
      runtime.dispose();
    }
    cleanup();
    const design = new PageRuntime(doc.getSnapshot().plan, 'page', { designMode: true });
    try {
      render(
        <TipProvider>
          <RuntimeRenderer runtime={design} materials={materials} designMode />
        </TipProvider>,
      );
      expect(screen.getByText('容器 · 从左侧拖入组件')).toBeTruthy();
      expect(
        screen.getByText('容器内容').closest('.material-container')!.className,
      ).not.toContain('empty');
    } finally {
      design.dispose();
    }
  });
  it('registers the rate material with aligned defaults and setters', () => {
    expect(catalog['ui.rate']).toMatchObject({
      title: '评分',
      defaultProps: { label: '评分', value: 0, count: 5, allowHalf: false, showGrade: true },
    });
    expect(registry.components['ui.rate'].field).toMatchObject({
      type: 'number',
      valueProp: 'value',
      changeEvent: 'onValueChange',
    });
    expect(catalog['ui.rate'].properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'allowHalf', setter: { kind: 'boolean' } }),
        expect.objectContaining({ name: 'count', setter: { kind: 'number' } }),
        expect.objectContaining({ name: 'allowClear', setter: { kind: 'boolean' } }),
      ]),
    );
  });
  it('exposes ellipsis on text and block on button with boolean setters', () => {
    expect(catalog['ui.text'].properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'ellipsis', setter: { kind: 'boolean' } }),
      ]),
    );
    expect(catalog['ui.button'].properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'block', setter: { kind: 'boolean' } }),
      ]),
    );
    expect(registry.components['ui.text'].props.ellipsis).toBeDefined();
    expect(registry.components['ui.button'].props.block).toBeDefined();
  });
  it('registers the slider material with aligned defaults and setters', () => {
    expect(catalog['ui.slider']).toMatchObject({
      title: '滑块',
      defaultProps: { label: '滑块', value: 0, min: 0, max: 100, step: 1, showValue: true },
    });
    expect(registry.components['ui.slider'].field).toMatchObject({
      type: 'number',
      valueProp: 'value',
      changeEvent: 'onValueChange',
    });
    expect(catalog['ui.slider'].properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'min', setter: { kind: 'number' } }),
        expect.objectContaining({ name: 'max', setter: { kind: 'number' } }),
        expect.objectContaining({ name: 'step', setter: { kind: 'number' } }),
        expect.objectContaining({ name: 'showValue', setter: { kind: 'boolean' } }),
      ]),
    );
  });
  it('registers the number input with aligned props and validation', () => {
    expect(catalog['ui.number'].properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'step', setter: { kind: 'json' } }),
        expect.objectContaining({ name: 'readOnly', setter: { kind: 'boolean' } }),
        expect.objectContaining({ name: 'placeholder', setter: { kind: 'text' } }),
        expect.objectContaining({ name: 'precision', setter: { kind: 'number' } }),
        expect.objectContaining({ name: 'unit', setter: { kind: 'text' } }),
      ]),
    );
    const contract = registry.components['ui.number'];
    expect(Object.keys(contract.props)).toEqual(
      expect.arrayContaining([
        'step',
        'precision',
        'unit',
        'disabled',
        'readOnly',
        'required',
        'hint',
        'placeholder',
      ]),
    );
    expect(contract.validateProps?.({ step: 0 }, {})).toContain('step 必须大于 0');
    expect(contract.validateProps?.({ min: 10, max: 1 }, {})).toContain('min 不能大于 max');
    expect(contract.validateProps?.({ step: 'any', min: 0, max: 10 }, {})).toEqual([]);
    expect(contract.validateProps?.({ precision: 3 }, {})).toEqual([]);
    expect(contract.validateProps?.({ precision: 9 }, {})).toContain(
      'precision 必须为 0 到 8 的整数',
    );
  });
  it('renders the number unit suffix and the radio group button style', () => {
    const lit = (value: Json) => ({ kind: 'literal', value }) as const;
    const schema = app();
    schema.dependencies.components = {
      'ui.number': '1.0.0',
      'ui.radioGroup': '1.0.0',
      'ui.text': '1.0.0',
    };
    schema.pages[0].children = [
      {
        id: 'price',
        component: 'ui.number',
        props: { label: lit('单价'), value: lit(0), unit: lit('元'), precision: lit(2) },
      },
      {
        id: 'dept',
        component: 'ui.radioGroup',
        props: {
          label: lit('部门'),
          value: lit('rd'),
          optionType: lit('button'),
          options: lit([
            { label: '研发', value: 'rd' },
            { label: '设计', value: 'des' },
          ]),
        },
      },
    ];
    const doc = new EditorDocument(schema, registry);
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    try {
      render(
        <TipProvider>
          <RuntimeRenderer runtime={runtime} materials={materials} />
        </TipProvider>,
      );
      expect(
        screen.getByRole('spinbutton', { name: '单价' }).closest('.material-number-unit'),
      ).toBeNull();
      expect(screen.getByText('元')).toBeTruthy();
      const group = screen
        .getByText('研发')
        .closest('.material-choice-group') as HTMLElement;
      expect(group.className).toContain('as-buttons');
      fireEvent.click(screen.getByText('设计'));
      const checked = group.querySelectorAll('input:checked');
      expect(checked).toHaveLength(1);
      expect(checked[0].getAttribute('value')).toBe('des');
    } finally {
      runtime.dispose();
    }
  });
  it.each([
    {
      id: 'ui.colorPicker',
      title: '颜色选择',
      field: { type: 'string', valueProp: 'value', changeEvent: 'onValueChange' },
      setters: [
        { name: 'value', setter: { kind: 'color' } },
        { name: 'showText', setter: { kind: 'boolean' } },
      ],
    },
    {
      id: 'ui.cascader',
      title: '级联选择',
      field: { type: 'array', valueProp: 'value', changeEvent: 'onValueChange' },
      setters: [{ name: 'options', setter: { kind: 'json' } }],
    },
    {
      id: 'ui.upload',
      title: '附件上传',
      field: { type: 'array', valueProp: 'value', changeEvent: 'onValueChange' },
      setters: [
        { name: 'multiple', setter: { kind: 'boolean' } },
        { name: 'maxCount', setter: { kind: 'number' } },
      ],
    },
    {
      id: 'ui.richText',
      title: '富文本',
      field: { type: 'string', valueProp: 'value', changeEvent: 'onValueChange' },
      setters: [
        { name: 'value', setter: { kind: 'richText' } },
        { name: 'placeholder', setter: { kind: 'text' } },
      ],
    },
  ])('registers $id with aligned defaults and setters', ({ id, title, field, setters }) => {
    expect(catalog[id]?.title).toBe(title);
    expect(registry.components[id].field).toMatchObject(field);
    expect(catalog[id].properties).toEqual(
      expect.arrayContaining(setters.map((item) => expect.objectContaining(item))),
    );
  });
  it.each([
    { component: 'missing', props: {} },
    { component: 'ui.text', props: { unknownProp: 4 } },
    { component: 'ui.tabPanel', props: { label: 'X' }, unexpected: true },
    { component: 'ui.text', props: { value: 'X' }, slots: { missing: { children: [] } } },
  ])('reports invalid initialChildren rather than throwing %#', (child) => {
    const broken = structuredClone(catalog);
    broken['ui.tabs'].initialChildren = [child as MaterialTemplate];
    let errors: string[] = [];
    expect(() => {
      errors = validateCatalog(broken, registry);
    }).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
  });
  it('reports cycles in defaults or initialChildren safely', () => {
    const child: MaterialTemplate = {
      component: 'ui.tabPanel',
      props: { label: 'Loop', value: 'loop' },
    };
    child.children = [child];
    const broken = structuredClone(catalog);
    broken['ui.tabs'].initialChildren = [child];
    expect(validateCatalog(broken, registry).some((error) => error.includes('循环'))).toBe(true);
    const payload: Record<string, unknown> = {};
    payload.self = payload;
    const defaults = structuredClone(catalog) as MaterialCatalog;
    defaults['ui.tabs'].defaultProps.bad = payload as never;
    expect(() => validateCatalog(defaults, registry)).not.toThrow();
    expect(validateCatalog(defaults, registry).length).toBeGreaterThan(0);
  });
  it('builds two neutral panels and independent copies while retaining materialNode compatibility', () => {
    const first = materialTemplate('ui.tabs'),
      second = materialTemplate('ui.tabs');
    expect(first.children).toHaveLength(2);
    expect(
      first.children!.map((child) => [child.component, child.props.label, child.props.value]),
    ).toEqual([
      ['ui.tabPanel', '标签一', 'tab-1'],
      ['ui.tabPanel', '标签二', 'tab-2'],
    ]);
    expect(first.children!.map((child) => child.children!.map((text) => text.component))).toEqual([
      ['ui.text'],
      ['ui.text'],
    ]);
    expect(
      first.children!.every((child) => child.children![0].props.value === '在此添加内容'),
    ).toBe(true);
    first.children![0].props.label = 'Mutated';
    expect(second.children![0].props.label).toBe('标签一');
    expect(catalog['ui.tabs'].initialChildren![0].props.label).toBe('标签一');
    expect(materialNode('ui.text')).toEqual({
      component: 'ui.text',
      props: Object.fromEntries(
        Object.entries(catalog['ui.text'].defaultProps).map(([name, value]) => [
          name,
          { kind: 'literal', value },
        ]),
      ),
    });
    expect(() => materialTemplate('not-registered')).toThrow();
    const unavailable = Object.entries(catalog).find(([, entry]) => entry.insertable === false)!;
    expect(unavailable).toBeDefined();
    expect(() => materialTemplate(unavailable[0])).toThrow();
  });
  it('inserts two independent contexts with unique IDs and functional panel switching', () => {
    const doc = make(),
      first = doc.insertFragment('page', materialTemplate('ui.tabs')),
      second = doc.insertFragment('page', materialTemplate('ui.tabs'));
    expect(first).not.toBe(second);
    const ids = page(doc).children.flatMap(allIds);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    for (const node of page(doc).children)
      expect(node.children!.map((panel) => panel.props.value)).toEqual([
        { kind: 'literal', value: 'tab-1' },
        { kind: 'literal', value: 'tab-2' },
      ]);
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    try {
      render(<RuntimeRenderer runtime={runtime} materials={materials} />);
      const lists = screen.getAllByRole('tablist');
      expect(lists).toHaveLength(2);
      const tabs = lists.map((list) => within(list).getAllByRole('tab'));
      expect(tabs[0].map((tab) => tab.textContent)).toEqual(['标签一', '标签二']);
      expect(tabs[0][0].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1][0].getAttribute('aria-selected')).toBe('true');
      fireEvent.click(tabs[0][1]);
      expect(tabs[0][1].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1][0].getAttribute('aria-selected')).toBe('true');
      expect(screen.getAllByText('在此添加内容').length).toBeGreaterThanOrEqual(2);
      expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
  it('preserves imported empty Tabs without applying palette defaults', () => {
    const doc = make(),
      legacy = { id: 'legacy-tabs', ...materialNode('ui.tabs'), children: [] };
    doc.insertNode('page', legacy);
    const exported = doc.exportJson(),
      restored = make();
    restored.importJson(exported);
    expect(restored.exportJson()).toBe(exported);
    expect(findNode(page(restored), 'legacy-tabs')!.node.children).toEqual([]);
    const runtime = new PageRuntime(restored.getSnapshot().plan, 'page');
    try {
      render(<RuntimeRenderer runtime={runtime} materials={materials} />);
      expect(screen.queryAllByRole('tab')).toHaveLength(0);
      expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
});

describe('composite material drag command routing', () => {
  it('preflights keyboard Tabs, commits the same complete tree and undoes once', () => {
    const doc = make(),
      before = doc.exportJson(),
      check = vi.spyOn(doc, 'checkInsertFragment'),
      insert = vi.spyOn(doc, 'insertFragment'),
      oldInsert = vi.spyOn(doc, 'insertNode');
    render(<Harness doc={doc} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Tabs source' }), { key: ' ' });
    expect(check).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().canUndo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
    expect(insert).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(oldInsert).not.toHaveBeenCalled();
    expect(page(doc).children[0].children).toHaveLength(2);
    expect(page(doc).children[0].children![0].children).toHaveLength(1);
    act(() => doc.undo());
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it('preflights pointer Tabs and inserts its full tree only on valid release', () => {
    const doc = make(),
      before = doc.getSnapshot(),
      check = vi.spyOn(doc, 'checkInsertFragment'),
      insert = vi.spyOn(doc, 'insertFragment');
    render(<Harness doc={doc} />);
    const target = screen.getByText('Drop at page');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });
    pointer(screen.getByRole('button', { name: 'Tabs source' }), 'pointerdown');
    pointer(window, 'pointermove', 100, 100);
    expect(check).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(doc.getSnapshot()).toBe(before);
    pointer(window, 'pointerup', 100, 100);
    expect(insert).toHaveBeenCalledWith('page', materialTemplate('ui.tabs'), {});
    expect(page(doc).children.flatMap(allIds)).toHaveLength(5);
    act(() => doc.undo());
    expect(page(doc).children).toEqual([]);
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it('exposes invalid preflight feedback and leaves invalid finish atomic', () => {
    const doc = make(),
      before = doc.getSnapshot(),
      insert = vi.spyOn(doc, 'insertFragment');
    render(<Harness doc={doc} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Tabs source' }), { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'Invalid target' }));
    expect(screen.getByRole('button', { name: '确认放置' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('拖放操作').textContent).toContain('不可放入');
    fireEvent.click(screen.getByRole('button', { name: 'Force finish' }));
    expect(insert).not.toHaveBeenCalled();
    expect(doc.getSnapshot()).toBe(before);
  });
});
