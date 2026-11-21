import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { compileApplication } from '../packages/runtime/engine';
import { registry as materialsRegistry } from '../src/materials';
import type { Registry } from '../packages/runtime/registry';
import type {
  ApplicationSchema,
  DataSourceDefinition,
  Json,
  PageSchema,
  Value,
} from '../packages/schema/types';
import { DataPanel } from '../src/editor/DataPanel';
import { PropertyPanel } from '../src/editor/Editor';
import { ActionPanel } from '../src/editor/ActionPanel';
import { bindingDraft, parseBinding } from '../src/editor/ValueEditor';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
function fixtureRegistry() {
  const query = vi.fn(() => ({ rows: [], total: 0 })),
    alternate = vi.fn(() => ({})),
    echo = vi.fn(() => ({}));
  const registry: Registry = {
    ...materialsRegistry,
    transports: {
      'test.query': {
        version: '1.2.3',
        input: { query: { type: 'string', required: true } },
        output: 'object',
        execute: query,
      },
      'test.alt': {
        version: '2.0.0',
        input: { filter: { type: 'string', required: true } },
        output: 'object',
        execute: alternate,
      },
      'test.echo': {
        version: '1.0.0',
        input: { value: { type: 'json', required: true } },
        output: 'object',
        execute: echo,
      },
    },
  };
  return { registry, query, alternate, echo };
}
function source(id = 'people', tag = 'a'): DataSourceDefinition {
  return {
    id,
    kind: 'query',
    transport: 'test.query',
    input: { query: literal(tag) },
    initial: { tag, 'first.name': { '': '原样路径' }, rows: [], total: 0 },
  };
}
function application(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'data-editor-acceptance',
    title: '数据配置独立验收',
    entryPageId: 'a',
    dependencies: {
      components: { 'ui.text': '1.0.0', 'ui.button': '1.0.0', 'ui.layout': '1.0.0' },
      actions: { 'state.set': '1.0.0', 'data.execute': '1.0.0', 'ui.notify': '1.0.0' },
      transports: { 'test.query': '1.2.3' },
    },
    pages: ['a', 'b'].map((id): PageSchema => ({
      id,
      title: id,
      state: [
        { id: 'query', type: 'string', initial: '' },
        { id: 'result', type: 'object', initial: {} },
      ],
      dataSources: [source('people', id), source('other', id + '-other')],
      children: [
        { id: 'text', component: 'ui.text', props: { value: literal('示例') } },
        { id: 'button', component: 'ui.button', props: { label: literal('查询') } },
      ],
    })),
  };
}
const page = (document: EditorDocument, id = 'a') =>
  document.getSnapshot().plan.pages.get(id)!.schema;
function oneUndo(document: EditorDocument, command: () => unknown) {
  const before = document.getSnapshot();
  command();
  const after = document.getSnapshot();
  expect(after.revision).toBe(before.revision + 1);
  expect(after.plan.schema).not.toEqual(before.plan.schema);
  document.undo();
  expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
  document.redo();
  expect(document.getSnapshot().plan.schema).toEqual(after.plan.schema);
}
function withRedo(document: EditorDocument) {
  document.setProp('a', 'text', 'value', literal('临时修改'));
  document.undo();
  const before = document.getSnapshot();
  expect(before.canRedo).toBe(true);
  return before;
}
function Harness({
  document,
  mode = 'data',
}: {
  document: EditorDocument;
  mode?: 'data' | 'property' | 'actions';
}) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  if (mode === 'data') return <DataPanel document={document} snapshot={snapshot} />;
  if (mode === 'property') return <PropertyPanel document={document} snapshot={snapshot} />;
  const node = findNode(
    snapshot.plan.pages.get(snapshot.selection.pageId)!.schema,
    snapshot.selection.nodeId!,
  )!.node;
  return <ActionPanel document={document} snapshot={snapshot} node={node} />;
}
function mount(document: EditorDocument, mode: 'data' | 'property' | 'actions' = 'data') {
  return render(
    <TipProvider>
      <EditorSessionProvider>
        <Harness document={document} mode={mode} />
      </EditorSessionProvider>
    </TipProvider>,
  );
}
function show(kind: 'states' | 'sources' | 'forms') {
  const tabs = within(screen.getByRole('tablist', { name: '数据配置类型' }));
  fireEvent.click(
    tabs.getByRole('tab', {
      name: kind === 'states' ? /页面状态/ : kind === 'sources' ? '数据源' : '表单模型',
    }),
  );
}

describe('independent data editor acceptance', () => {
  it.each(['target', 'query'])(
    'rejects a known state.set reference mismatch when updating state %s',
    (id) => {
      const { registry } = fixtureRegistry(),
        schema = application();
      schema.pages[0].state.push({ id: 'target', type: 'string', initial: '' });
      schema.pages[0].children[1].on = {
        onClick: [
          {
            id: 'copy',
            action: 'state.set',
            input: { stateId: literal('target'), value: { kind: 'stateRef', stateId: 'query' } },
          },
        ],
      };
      const document = new EditorDocument(schema, registry),
        before = withRedo(document);
      expect(() => document.updateState('a', id, { type: 'number', initial: 0 })).toThrow();
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it('rejects changing source transport output when a state.set target requires its known root dataRef type', () => {
    const { registry } = fixtureRegistry(),
      schema = application();
    registry.transports!['test.string'] = {
      version: '1.0.0',
      input: {},
      output: 'string',
      execute: () => '',
    };
    registry.transports!['test.number'] = {
      version: '1.0.0',
      input: {},
      output: 'number',
      execute: () => 0,
    };
    schema.dependencies.transports!['test.string'] = '1.0.0';
    schema.pages[0].dataSources![0] = {
      id: 'people',
      kind: 'query',
      transport: 'test.string',
      input: {},
      initial: '',
    };
    schema.pages[0].children[1].on = {
      onClick: [
        {
          id: 'copy',
          action: 'state.set',
          input: { stateId: literal('query'), value: { kind: 'dataRef', sourceId: 'people' } },
        },
      ],
    };
    const document = new EditorDocument(schema, registry),
      before = withRedo(document);
    expect(() =>
      document.updateDataSource('a', 'people', {
        kind: 'query',
        transport: 'test.number',
        input: {},
        initial: 0,
      }),
    ).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(before.plan.schema.dependencies.transports!['test.number']).toBeUndefined();
  });

  it.each(['fieldRef', 'formValues'] as const)(
    'preserves known %s type safety for state.set targets',
    (kind) => {
      const { registry } = fixtureRegistry(),
        schema = application();
      schema.pages[0].forms = [
        {
          id: 'model',
          fields: [{ id: 'name', path: ['name'], label: '姓名', type: 'string', initial: '' }],
        },
      ];
      const value: Value =
        kind === 'fieldRef'
          ? { kind: 'fieldRef', formId: 'model', fieldId: 'name' }
          : { kind: 'formValues', formId: 'model' };
      schema.pages[0].children[1].on = {
        onClick: [
          {
            id: 'copy',
            action: 'state.set',
            input: { stateId: literal(kind === 'fieldRef' ? 'query' : 'result'), value },
          },
        ],
      };
      const document = new EditorDocument(schema, registry),
        before = withRedo(document);
      expect(() =>
        document.updateState('a', kind === 'fieldRef' ? 'query' : 'result', {
          type: 'number',
          initial: 0,
        }),
      ).toThrow();
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it.each(['nested', 'expression'])(
    'defers unknown %s state.set value types to runtime without false static rejection',
    (kind) => {
      const { registry } = fixtureRegistry(),
        schema = application();
      const value: Value =
        kind === 'nested'
          ? { kind: 'dataRef', sourceId: 'people', path: ['first.name', ''] }
          : expression('event');
      schema.pages[0].children[1].on = {
        onClick: [{ id: 'copy', action: 'state.set', input: { stateId: literal('query'), value } }],
      };
      const document = new EditorDocument(schema, registry);
      expect(() =>
        document.updateState('a', 'query', { type: 'number', initial: 0 }),
      ).not.toThrow();
    },
  );

  it('implements all six data CRUD commands as atomic single undo entries with dependency synchronization', () => {
    const { registry, query, alternate } = fixtureRegistry(),
      document = new EditorDocument(application(), registry);
    oneUndo(document, () => document.createState('a', { id: 'extra', type: 'number', initial: 1 }));
    oneUndo(document, () => document.updateState('a', 'extra', { type: 'number', initial: 2 }));
    oneUndo(document, () => document.removeState('a', 'extra'));
    oneUndo(document, () =>
      document.createDataSource('a', {
        ...source('created'),
        transport: 'test.alt',
        input: { filter: literal('新参数') },
      }),
    );
    expect(document.getSnapshot().plan.schema.dependencies.transports!['test.alt']).toBe('2.0.0');
    oneUndo(document, () =>
      document.updateDataSource('a', 'created', { ...source('created'), kind: 'mutation' }),
    );
    expect(page(document).dataSources!.find((item) => item.id === 'created')!.id).toBe('created');
    oneUndo(document, () => document.removeDataSource('a', 'created'));
    expect(query).not.toHaveBeenCalled();
    expect(alternate).not.toHaveBeenCalled();
    expect(() => compileApplication(JSON.parse(document.exportJson()), registry)).not.toThrow();
  });

  it('keeps accepted schema, transport dependencies and redo unchanged for invalid edits in all six commands', () => {
    const { registry } = fixtureRegistry(),
      document = new EditorDocument(application(), registry),
      before = withRedo(document);
    const failures = [
      () => document.createState('a', { id: 'query', type: 'string', initial: '' }),
      () => document.updateState('a', 'query', { type: 'number', initial: '不是数字' }),
      () => document.removeState('a', 'missing'),
      () =>
        document.createDataSource('a', {
          ...source('invalid'),
          transport: 'test.alt',
          input: { query: literal('遗留参数') },
        }),
      () =>
        document.updateDataSource('a', 'people', {
          ...source(),
          transport: 'test.alt',
          input: { filter: literal(123) },
        }),
      () => document.removeDataSource('a', 'missing'),
    ];
    for (const fail of failures) {
      expect(fail).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
    expect(before.plan.schema.dependencies.transports).toEqual({ 'test.query': '1.2.3' });
  });

  it('protects state and source references in values, expressions, default inputs and action result destinations', () => {
    const { registry } = fixtureRegistry();
    const cases: {
      modify: (schema: ApplicationSchema) => void;
      remove: (document: EditorDocument) => void;
    }[] = [
      {
        modify: (s) => {
          s.pages[0].children[0].props.value = { kind: 'stateRef', stateId: 'query' };
        },
        remove: (d) => d.removeState('a', 'query'),
      },
      {
        modify: (s) => {
          s.pages[0].children[0].props.value = expression('state.query');
        },
        remove: (d) => d.removeState('a', 'query'),
      },
      {
        modify: (s) => {
          s.pages[0].dataSources![0].input.query = { kind: 'stateRef', stateId: 'query' };
        },
        remove: (d) => d.removeState('a', 'query'),
      },
      {
        modify: (s) => {
          s.pages[0].children[0].props.value = { kind: 'dataRef', sourceId: 'people' };
        },
        remove: (d) => d.removeDataSource('a', 'people'),
      },
      {
        modify: (s) => {
          s.pages[0].children[0].props.value = expression('sources.people.status');
        },
        remove: (d) => d.removeDataSource('a', 'people'),
      },
      {
        modify: (s) => {
          s.pages[0].dataSources![1] = {
            id: 'other',
            kind: 'query',
            transport: 'test.echo',
            input: { value: { kind: 'dataRef', sourceId: 'people' } },
            initial: {},
          };
          s.dependencies.transports!['test.echo'] = '1.0.0';
        },
        remove: (d) => d.removeDataSource('a', 'people'),
      },
      {
        modify: (s) => {
          s.pages[0].children[1].on = {
            onClick: [
              {
                id: 'load',
                action: 'data.execute',
                input: { sourceId: literal('people') },
                resultTo: 'result',
              },
            ],
          };
        },
        remove: (d) => d.removeState('a', 'result'),
      },
    ];
    for (const scenario of cases) {
      const schema = application();
      scenario.modify(schema);
      const document = new EditorDocument(schema, registry),
        before = withRedo(document);
      expect(() => scenario.remove(document)).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
  });

  it('conservatively protects dynamic action targets and ignores schema-like literal business data', () => {
    const { registry } = fixtureRegistry();
    for (const name of ['state.set', 'data.execute']) {
      const schema = application();
      schema.pages[0].children[1].on = {
        onClick: [
          {
            id: 'dynamic',
            action: name,
            input:
              name === 'state.set'
                ? { stateId: expression('event'), value: literal('新值') }
                : { sourceId: expression('event') },
          },
        ],
      };
      const document = new EditorDocument(schema, registry),
        before = document.getSnapshot();
      expect(() =>
        name === 'state.set'
          ? document.removeState('a', 'query')
          : document.removeDataSource('a', 'people'),
      ).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
    const schema = application();
    schema.pages[0].children[0].props.value = literal({
      kind: 'stateRef',
      stateId: 'query',
      sourceId: 'people',
      nested: { kind: 'dataRef', sourceId: 'people' },
    });
    schema.pages[0].children[1].props.label = expression("'state.query sources.people.data'");
    const document = new EditorDocument(schema, registry);
    expect(() => document.removeState('a', 'query')).not.toThrow();
    expect(() => document.removeDataSource('a', 'people')).not.toThrow();
  });

  it('creates a state through the real panel with one undo and no transport calls', () => {
    const { registry, query, alternate, echo } = fixtureRegistry(),
      document = new EditorDocument(application(), registry);
    mount(document);
    show('states');
    fireEvent.click(screen.getByRole('button', { name: '新建状态' }));
    changeControl(screen.getByRole('textbox', { name: '状态 ID' }), 'created');
    changeControl(screen.getByRole('textbox', { name: '状态初始值' }), '"创建的状态"');
    const before = document.getSnapshot().plan.schema;
    fireEvent.click(screen.getByRole('button', { name: '创建状态' }));
    expect(page(document).state.find((item) => item.id === 'created')!.initial).toBe('创建的状态');
    act(() => document.undo());
    expect(document.getSnapshot().plan.schema).toEqual(before);
    expect(query).not.toHaveBeenCalled();
    expect(alternate).not.toHaveBeenCalled();
    expect(echo).not.toHaveBeenCalled();
  });

  it('isolates invalid source drafts by page and source, preserves them across tabs and requires stale confirmation', () => {
    const { registry } = fixtureRegistry(),
      document = new EditorDocument(application(), registry);
    mount(document);
    show('sources');
    const before = document.getSnapshot();
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{');
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.getSnapshot()).toBe(before);
    changeControl(screen.getByLabelText('管理数据源'), 'other');
    expect(
      (screen.getByRole('textbox', { name: '数据源初始值' }) as HTMLTextAreaElement).value,
    ).toContain('a-other');
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{"tag":"other draft"}');
    act(() => document.select('b', 'text'));
    show('sources');
    expect(
      (screen.getByRole('textbox', { name: '数据源初始值' }) as HTMLTextAreaElement).value,
    ).toContain('"b"');
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{"tag":"B draft"}');
    act(() => document.select('a', 'text'));
    show('states');
    show('sources');
    changeControl(screen.getByLabelText('管理数据源'), 'people');
    expect(
      (screen.getByRole('textbox', { name: '数据源初始值' }) as HTMLTextAreaElement).value,
    ).toBe('{');
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{"tag":"A draft"}');
    act(() =>
      document.updateDataSource('a', 'people', { ...source(), initial: { tag: 'external' } }),
    );
    expect((screen.getByRole('button', { name: '保存数据源' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(page(document).dataSources![0].initial).toEqual({ tag: 'A draft' });
    expect(page(document, 'b').dataSources![0].initial).toMatchObject({ tag: 'b' });
    changeControl(screen.getByLabelText('管理数据源'), 'other');
    expect(
      (screen.getByRole('textbox', { name: '数据源初始值' }) as HTMLTextAreaElement).value,
    ).toBe('{"tag":"other draft"}');
  });

  it('switches transport and creates another source without retaining old or previous-source parameters', () => {
    const { registry, query, alternate } = fixtureRegistry(),
      document = new EditorDocument(application(), registry);
    mount(document);
    show('sources');
    changeControl(screen.getByLabelText('数据源 Transport'), 'test.alt');
    expect(screen.queryByLabelText('query取值方式')).toBeNull();
    changeControl(screen.getByLabelText('filter取值方式'), 'literal');
    changeControl(screen.getByLabelText('filter'), '新过滤');
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(page(document).dataSources![0].input).toEqual({ filter: literal('新过滤') });
    expect(document.getSnapshot().plan.schema.dependencies.transports!['test.alt']).toBe('2.0.0');
    fireEvent.click(screen.getByRole('button', { name: '新建数据源' }));
    changeControl(screen.getByRole('textbox', { name: '数据源 ID' }), 'created');
    expect(screen.queryByLabelText('filter取值方式')).toBeNull();
    changeControl(screen.getByLabelText('query取值方式'), 'literal');
    changeControl(screen.getByLabelText('query'), '新查询');
    fireEvent.click(screen.getByRole('button', { name: '创建数据源' }));
    expect(page(document).dataSources!.find((item) => item.id === 'created')!.input).toEqual({
      query: literal('新查询'),
    });
    expect(query).not.toHaveBeenCalled();
    expect(alternate).not.toHaveBeenCalled();
  });

  it.each([{ path: ['first.name', ''] }, { path: [] }, { path: ['0', 'quoted"key'] }])(
    'roundtrips shared Value dataRef path $path',
    ({ path }) => {
      const binding: Value = { kind: 'dataRef', sourceId: 'people', path };
      expect(parseBinding(bindingDraft(binding, { type: 'json' }), { type: 'json' })).toEqual(
        binding,
      );
      expect(() =>
        parseBinding({ ...bindingDraft(binding, { type: 'json' }), path: '[1]' }, { type: 'json' }),
      ).toThrow();
    },
  );

  it('authors a special dataRef path through the property UI and retains invalid path drafts when selection changes', () => {
    const { registry } = fixtureRegistry(),
      document = new EditorDocument(application(), registry);
    document.select('a', 'text');
    mount(document, 'property');
    changeControl(screen.getByLabelText('文本内容绑定方式'), 'dataRef');
    changeControl(screen.getByLabelText('文本内容数据源'), 'people');
    changeControl(screen.getByRole('textbox', { name: '文本内容数据路径' }), '["first.name",""]');
    expect(findNode(page(document), 'text')!.node.props.value).toEqual({
      kind: 'dataRef',
      sourceId: 'people',
      path: ['first.name', ''],
    });
    const accepted = document.getSnapshot();
    changeControl(screen.getByRole('textbox', { name: '文本内容数据路径' }), '[');
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.getSnapshot()).toBe(accepted);
    act(() => document.select('a', 'button'));
    act(() => document.select('a', 'text'));
    expect(
      (screen.getByRole('textbox', { name: '文本内容数据路径' }) as HTMLInputElement).value,
    ).toBe('[');
  });

  it('preserves dataRef action parameters when another shared Value input changes', () => {
    const { registry } = fixtureRegistry(),
      schema = application();
    const title: Value = { kind: 'dataRef', sourceId: 'people', path: ['first.name', ''] };
    schema.pages[0].children[1].on = {
      onClick: [{ id: 'notice', action: 'ui.notify', input: { title } }],
    };
    const document = new EditorDocument(schema, registry);
    document.select('a', 'button');
    mount(document, 'actions');
    changeControl(screen.getByLabelText('tone取值方式'), 'literal');
    changeControl(screen.getByLabelText('tone'), 'success');
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(findNode(page(document), 'button')!.node.on!.onClick[0].input.title).toEqual(title);
  });
});
