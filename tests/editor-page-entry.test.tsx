import { useState, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { PageRuntime } from '../packages/runtime/engine';
import type {
  ActionCall,
  ApplicationSchema,
  Json,
  PageSchema,
  Value,
} from '../packages/schema/types';
import App from '../src/App';
import { ActionPanel } from '../src/editor/ActionPanel';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { EditorSessionProvider } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { changeControl, selectPage } from './ui-helpers';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const notify = (id = 'enter-notice', title: Value = literal('页面进入')): ActionCall => ({
  id,
  action: 'ui.notify',
  input: { title },
});
const execute = (id = 'enter-query', sourceId = 'people'): ActionCall => ({
  id,
  action: 'data.execute',
  input: { sourceId: literal(sourceId) },
});
const application = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'page-entry-acceptance',
  title: '页面进入独立验收',
  entryPageId: 'a',
  dependencies: {
    components: { 'ui.text': '1.0.0', 'ui.button': '1.0.0' },
    actions: {},
    transports: { 'demo.peopleQuery': '1.0.0', 'demo.recordSave': '1.0.0' },
  },
  pages: ['a', 'b'].map((id): PageSchema => ({
    id,
    title: `页面 ${id}`,
    state: [
      { id: 'label', type: 'string', initial: '初始状态' },
      { id: 'result', type: 'object', initial: {} },
      { id: 'flag', type: 'boolean', initial: false },
    ],
    forms: [
      {
        id: 'model',
        fields: [
          { id: 'name', path: ['name'], label: '名称', type: 'string', initial: '' },
          { id: 'note', path: ['note'], label: '保留字段', type: 'string', initial: '' },
        ],
      },
    ],
    dataSources: [
      {
        id: 'people',
        kind: 'query',
        transport: 'demo.peopleQuery',
        input: { query: literal('') },
        initial: {},
      },
      {
        id: 'save',
        kind: 'mutation',
        transport: 'demo.recordSave',
        input: {
          id: literal('record-1'),
          values: literal({ name: '验收', department: '测试', amount: 1 }),
        },
        initial: {},
      },
    ],
    children: [
      { id: 'text', component: 'ui.text', props: { value: literal(`内容 ${id}`) } },
      { id: 'button', component: 'ui.button', props: { label: literal('触发事件') } },
    ],
  })),
});
const page = (document: EditorDocument, id = 'a') =>
  document.getSnapshot().plan.pages.get(id)!.schema;
const saved = (document: EditorDocument, id = 'a') => page(document, id).onEnter;
const runtimes: PageRuntime[] = [];

afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
});

describe('atomic page-entry action commands', () => {
  it('adds exact action dependencies, clones callers and preserves another-page selection', () => {
    const document = new EditorDocument(application(), registry);
    document.select('b', 'button');
    const calls = [
      notify(),
      { ...execute(), input: { sourceId: literal('people'), input: literal({ query: '原始' }) } },
    ];
    const expected = structuredClone(calls);
    expect(document.setPageEnterActions('a', calls)).toBe(true);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'button' });
    expect(document.getSnapshot().plan.schema.dependencies.actions).toEqual({
      'ui.notify': registry.actions['ui.notify'].version,
      'data.execute': registry.actions['data.execute'].version,
    });
    calls[0].input.title = literal('外部修改');
    (calls[1].input.input as { kind: 'literal'; value: { query: string } }).value.query = '污染';
    calls.push(notify('later'));
    expect(saved(document)).toEqual(expected);
    expect(Object.isFrozen(saved(document))).toBe(true);
    const imported = new EditorDocument(JSON.parse(document.exportJson()), registry);
    expect(saved(imported)).toEqual(expected);
  });

  it('adds, edits and clears each entire chain with one undo/redo entry', () => {
    const document = new EditorDocument(application(), registry);
    for (const calls of [[notify(), notify('second')], [notify('replacement')], []]) {
      const before = document.getSnapshot();
      expect(document.setPageEnterActions('a', calls)).toBe(true);
      const after = document.getSnapshot();
      expect(after.revision).toBe(before.revision + 1);
      expect(after.selection).toEqual(before.selection);
      expect(saved(document)).toEqual(calls.length ? calls : undefined);
      document.undo();
      expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
      document.redo();
      expect(document.getSnapshot().plan.schema).toEqual(after.plan.schema);
    }
  });

  it('treats identical and absent-empty definitions as no-ops, preserving redo', () => {
    const document = new EditorDocument(application(), registry);
    const initial = document.getSnapshot();
    expect(document.setPageEnterActions('a', [])).toBe(false);
    expect(document.getSnapshot()).toBe(initial);
    document.setPageEnterActions('a', [notify()]);
    document.setProp('a', 'text', 'value', literal('暂存'));
    document.undo();
    const before = document.getSnapshot();
    expect(before.canRedo).toBe(true);
    expect(document.setPageEnterActions('a', structuredClone(saved(document)!))).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    expect(document.getSnapshot().canRedo).toBe(true);
  });

  const invalidCalls: [string, ActionCall[], string][] = [
    ['unknown page', [notify()], 'missing'],
    ['unknown action', [{ ...notify(), action: 'unknown.action' }], 'a'],
    ['wrong input type', [notify('bad-type', literal(3))], 'a'],
    ['missing required input', [{ ...notify(), input: {} }], 'a'],
    [
      'unknown input',
      [{ ...notify(), input: { title: literal('x'), unknown: literal(true) } }],
      'a',
    ],
    ['duplicate chain IDs', [notify('duplicate'), notify('duplicate')], 'a'],
    ['unknown result state', [{ ...execute(), resultTo: 'missing' }], 'a'],
    ['wrong result type', [{ ...execute(), resultTo: 'flag' }], 'a'],
    ['action without output', [{ ...notify(), resultTo: 'label' }], 'a'],
    ['unknown source', [execute('bad-source', 'missing')], 'a'],
    [
      'unknown state',
      [
        {
          id: 'bad-state',
          action: 'state.set',
          input: { stateId: literal('missing'), value: literal('x') },
        },
      ],
      'a',
    ],
    [
      'wrong state value',
      [
        {
          id: 'bad-state',
          action: 'state.set',
          input: { stateId: literal('flag'), value: literal('x') },
        },
      ],
      'a',
    ],
    [
      'unknown form',
      [{ id: 'bad-form', action: 'form.reset', input: { formId: literal('missing') } }],
      'a',
    ],
  ];
  it.each(invalidCalls)(
    'rejects %s without changing schema, history, selection or revision',
    (_name, calls, pageId) => {
      const document = new EditorDocument(application(), registry);
      document.setProp('a', 'text', 'value', literal('临时'));
      document.undo();
      const before = document.getSnapshot();
      expect(() => document.setPageEnterActions(pageId, calls)).toThrow();
      expect(document.getSnapshot()).toBe(before);
      expect(before.canRedo).toBe(true);
    },
  );

  it.each([
    'event',
    'event.value',
    'event[state.label]',
    'scope',
    'scope.row',
    'scope["row"]',
    'scope[state.label]',
    'state.flag ? scope : state.label',
    'state.flag ? event : state.label',
  ])('rejects page-entry access to unavailable context: %s', (source) => {
    const document = new EditorDocument(application(), registry);
    const before = document.getSnapshot();
    expect(() =>
      document.setPageEnterActions('a', [notify('bad-scope', expression(source))]),
    ).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });

  it('detects node-event ID collisions while allowing the same action ID on a different page', () => {
    const document = new EditorDocument(application(), registry);
    document.setEventActions('a', 'button', 'onClick', [notify('owned-by-node')]);
    const before = document.getSnapshot();
    expect(() => document.setPageEnterActions('a', [notify('owned-by-node')])).toThrow('重复动作');
    expect(document.getSnapshot()).toBe(before);
    document.setPageEnterActions('b', [notify('owned-by-node')]);
    expect(saved(document, 'b')?.[0].id).toBe('owned-by-node');
  });

  it('accepts page-owned expressions and literal business text containing context names', () => {
    const document = new EditorDocument(application(), registry);
    const calls = [
      notify('literal-context', literal('event scope.row')),
      notify('state-context', expression('state.flag ? state.label : "event"')),
      notify('form-context', expression('forms.model.fields.name.value')),
      notify('source-context', expression('sources.people.data["message"]')),
    ];
    expect(document.setPageEnterActions('a', calls)).toBe(true);
    expect(saved(document)).toEqual(calls);
  });

  it.each(['state', 'form', 'field', 'source'] as const)(
    'protects %s referenced by the authored chain until cleared',
    (kind) => {
      const document = new EditorDocument(application(), registry);
      const call =
        kind === 'state'
          ? notify('state-reference', { kind: 'stateRef', stateId: 'label' })
          : kind === 'form'
            ? { id: 'form-reference', action: 'form.reset', input: { formId: literal('model') } }
            : kind === 'field'
              ? notify('field-reference', { kind: 'fieldRef', formId: 'model', fieldId: 'name' })
              : execute();
      document.setPageEnterActions('a', [call]);
      const remove = () =>
        kind === 'state'
          ? document.removeState('a', 'label')
          : kind === 'form'
            ? document.removeForm('a', 'model')
            : kind === 'field'
              ? document.removeField('a', 'model', 'name')
              : document.removeDataSource('a', 'people');
      const before = document.getSnapshot();
      expect(remove).toThrow();
      expect(document.getSnapshot()).toBe(before);
      document.setPageEnterActions('a', []);
      expect(remove()).toBe(true);
    },
  );
});

function mount(document: EditorDocument) {
  function Harness() {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    const [panel, setPanel] = useState<'lifecycle' | 'events'>('lifecycle');
    const [allowed, setAllowed] = useState(true);
    const node = findNode(page(document, snapshot.selection.pageId), 'button')!.node;
    return (
      <>
        <button onClick={() => setPanel('events')}>测试组件事件</button>
        <button onClick={() => setPanel('lifecycle')}>测试页面面板</button>
        <button onClick={() => setAllowed((current) => !current)}>测试切换权限</button>
        {panel === 'events' ? (
          <ActionPanel document={document} snapshot={snapshot} node={node} />
        ) : (
          <PageLifecyclePanel document={document} snapshot={snapshot} authoringAllowed={allowed} />
        )}
      </>
    );
  }
  return render(
    <EditorSessionProvider>
      <TipProvider>
        <Harness />
      </TipProvider>
    </EditorSessionProvider>,
  );
}
const enterRegion = () => screen.getByRole('region', { name: '页面进入动作' });
function addNotice(title: string) {
  // The harness reuses this helper for the component-event editor, which has no lifecycle region.
  const host = screen.queryByRole('region', { name: '页面进入动作' }) ?? document.body;
  fireEvent.click(within(host).getByRole('button', { name: '添加动作' }));
  const cards = within(host).getAllByRole('region', { name: /^动作 \d+$/ });
  const card = within(cards.at(-1)!);
  changeControl(card.getByLabelText(/动作 \d+ 类型/), 'ui.notify');
  changeControl(card.getByLabelText('title取值方式'), 'literal');
  changeControl(card.getByLabelText('title'), title);
}
const saveEntry = () => screen.getByRole('button', { name: '保存进入动作' });
const titleInput = () => screen.getByRole('textbox', { name: 'title' }) as HTMLInputElement;

describe('page-entry authoring isolation and permissions', () => {
  it('exposes a page-safe panel on an empty unselected page and saves whole-chain reorder/remove', () => {
    const schema = application();
    schema.pages[0].children = [];
    const document = new EditorDocument(schema, registry);
    document.select('a', null);
    // This panel does not require any component selection or event host.
    function Panel() {
      const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
      return <PageLifecyclePanel document={document} snapshot={snapshot} authoringAllowed />;
    }
    render(
      <EditorSessionProvider>
        <TipProvider>
          <Panel />
        </TipProvider>
      </EditorSessionProvider>,
    );
    expect(screen.getByRole('region', { name: '页面生命周期配置' })).toBeTruthy();
    const before = document.getSnapshot();
    addNotice('第一条');
    addNotice('第二条');
    expect(document.getSnapshot()).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '上移动作 2' }));
    fireEvent.click(saveEntry());
    expect(saved(document)?.map((call) => call.input.title)).toEqual([
      literal('第二条'),
      literal('第一条'),
    ]);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: null });
    fireEvent.click(screen.getByRole('button', { name: '删除动作 2' }));
    fireEvent.click(saveEntry());
    expect(saved(document)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '删除动作 1' }));
    fireEvent.click(saveEntry());
    expect(saved(document)).toBeUndefined();
  });

  it('uses page-only expression hints, retains invalid source and leaves document unchanged', () => {
    const document = new EditorDocument(application(), registry);
    mount(document);
    addNotice('原始');
    changeControl(screen.getByLabelText('title取值方式'), 'expression');
    const input = titleInput();
    expect(input.getAttribute('placeholder')).toContain('state.');
    expect(input.getAttribute('placeholder')).not.toMatch(/scope|event/);
    changeControl(input, 'scope["row"].name');
    const before = document.getSnapshot();
    fireEvent.click(saveEntry());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.getSnapshot()).toBe(before);
    expect(titleInput().value).toBe('scope["row"].name');
    changeControl(titleInput(), 'state.label');
    fireEvent.click(saveEntry());
    expect(saved(document)?.[0].input.title).toEqual(expression('state.label'));
  });

  it('keeps unsaved lifecycle drafts separate across pages and component events', () => {
    const document = new EditorDocument(application(), registry);
    mount(document);
    addNotice('页面 A 草稿');
    act(() => document.select('b', 'button'));
    addNotice('页面 B 草稿');
    act(() => document.select('a', 'button'));
    expect(titleInput().value).toBe('页面 A 草稿');
    fireEvent.click(screen.getByRole('button', { name: '测试组件事件' }));
    addNotice('组件事件草稿');
    fireEvent.click(screen.getByRole('button', { name: '测试页面面板' }));
    expect(titleInput().value).toBe('页面 A 草稿');
    fireEvent.click(saveEntry());
    fireEvent.click(screen.getByRole('button', { name: '测试组件事件' }));
    expect(titleInput().value).toBe('组件事件草稿');
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    const nodeCall = findNode(page(document), 'button')!.node.on!.onClick[0];
    expect(nodeCall.input.title).toEqual(literal('组件事件草稿'));
    expect(nodeCall.id).not.toBe(saved(document)?.[0].id);
    act(() => document.select('b', 'button'));
    fireEvent.click(screen.getByRole('button', { name: '测试页面面板' }));
    expect(titleInput().value).toBe('页面 B 草稿');
  });

  it('requires explicit confirmation after unrelated same-page edits and supports discard', () => {
    const document = new EditorDocument(application(), registry);
    mount(document);
    addNotice('保留草稿');
    act(() => document.updateState('a', 'label', { type: 'string', initial: '其他更新' }));
    expect((saveEntry() as HTMLButtonElement).disabled).toBe(true);
    expect(titleInput().value).toBe('保留草稿');
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(saveEntry());
    expect(saved(document)?.[0].input.title).toEqual(literal('保留草稿'));
    changeControl(titleInput(), '待放弃');
    act(() => document.undo());
    expect((saveEntry() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    expect(screen.queryByRole('textbox', { name: 'title' })).toBeNull();
    expect(saved(document)).toBeUndefined();
  });

  it('blocks authoring and saving an existing dirty draft after switching to preview permission', () => {
    const document = new EditorDocument(application(), registry);
    mount(document);
    addNotice('预览不得保存');
    const before = document.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '测试切换权限' }));
    expect((saveEntry() as HTMLButtonElement).disabled).toBe(true);
    expect(within(enterRegion()).getByRole('button', { name: '添加动作' }).matches(':disabled')).toBe(
      true,
    );
    fireEvent.click(saveEntry());
    expect(document.getSnapshot()).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '测试切换权限' }));
    expect(titleInput().value).toBe('预览不得保存');
    fireEvent.click(saveEntry());
    expect(saved(document)?.[0].input.title).toEqual(literal('预览不得保存'));
  });

  it('authors typed page bindings and compatible action result states through the shared chain UI', () => {
    const document = new EditorDocument(application(), registry);
    document.setPageEnterActions('a', [execute(), notify()]);
    mount(document);
    changeControl(screen.getByLabelText('动作 1 结果状态'), 'result');
    changeControl(screen.getByLabelText('title取值方式'), 'stateRef');
    changeControl(screen.getByLabelText('title页面状态'), 'label');
    fireEvent.click(saveEntry());
    expect(saved(document)?.[0].resultTo).toBe('result');
    expect(saved(document)?.[1].input.title).toEqual({ kind: 'stateRef', stateId: 'label' });
    changeControl(screen.getByLabelText('title取值方式'), 'fieldRef');
    changeControl(screen.getByLabelText('title表单'), 'model');
    changeControl(screen.getByLabelText('title字段'), 'name');
    fireEvent.click(saveEntry());
    expect(saved(document)?.[1].input.title).toEqual({
      kind: 'fieldRef',
      formId: 'model',
      fieldId: 'name',
    });
  });
});

describe('page-entry execution boundaries', () => {
  it('never runs transports during design publication and enters once per existing runtime instance', async () => {
    const query = vi
      .spyOn(registry.transports!['demo.peopleQuery'], 'execute')
      .mockResolvedValue({ rows: [] });
    const mutation = vi
      .spyOn(registry.transports!['demo.recordSave'], 'execute')
      .mockResolvedValue({ saved: true });
    const document = new EditorDocument(application(), registry);
    document.setPageEnterActions('a', [execute(), execute('enter-mutation', 'save')]);
    const runtime = new PageRuntime(document.getSnapshot().plan, 'a', { designMode: true });
    runtimes.push(runtime);
    await runtime.enter();
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    runtime.setDesignMode(false);
    await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(mutation.mock.invocationCallOrder[0]);
    runtime.setDesignMode(true);
    runtime.setDesignMode(false);
    await runtime.enter();
    expect(query).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledOnce();
    const next = new PageRuntime(document.getSnapshot().plan, 'a');
    runtimes.push(next);
    await next.enter();
    expect(query).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it('stops the authored entry sequence after a genuine query error', async () => {
    const query = vi
      .spyOn(registry.transports!['demo.peopleQuery'], 'execute')
      .mockRejectedValue(new Error('独立查询失败'));
    const mutation = vi
      .spyOn(registry.transports!['demo.recordSave'], 'execute')
      .mockResolvedValue({ saved: true });
    const document = new EditorDocument(application(), registry);
    document.setPageEnterActions('a', [execute(), execute('must-not-run', 'save')]);
    const runtime = new PageRuntime(document.getSnapshot().plan, 'a');
    runtimes.push(runtime);
    await runtime.enter();
    expect(query).toHaveBeenCalledOnce();
    expect(mutation).not.toHaveBeenCalled();
    expect(runtime.getRecords().some((record) => record.kind === 'action.error')).toBe(true);
  });

  it('does not publish a late entry result or run the next mutation after disposal', async () => {
    let resolveQuery!: (value: Json) => void;
    vi.spyOn(registry.transports!['demo.peopleQuery'], 'execute').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );
    const mutation = vi
      .spyOn(registry.transports!['demo.recordSave'], 'execute')
      .mockResolvedValue({ saved: true });
    const document = new EditorDocument(application(), registry);
    document.setPageEnterActions('a', [
      { ...execute(), resultTo: 'result' },
      execute('late-mutation', 'save'),
    ]);
    const runtime = new PageRuntime(document.getSnapshot().plan, 'a');
    runtimes.push(runtime);
    const entered = runtime.enter();
    runtime.dispose();
    resolveQuery({ late: true });
    await entered;
    expect(runtime.getState().result).toEqual({});
    expect(mutation).not.toHaveBeenCalled();
  });

  it('saves edit-side configuration without transport calls, then runs it through the actual App preview and reset', async () => {
    const query = vi
      .spyOn(registry.transports!['demo.peopleQuery'], 'execute')
      .mockResolvedValue({ rows: [] });
    const mutation = vi
      .spyOn(registry.transports!['demo.recordSave'], 'execute')
      .mockResolvedValue({ saved: true });
    const document = new EditorDocument(application(), registry);
    document.setPageEnterActions('a', [execute(), execute('enter-mutation', 'save'), notify()]);
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({
        storageVersion: 1,
        savedAt: 'fixture',
        schema: document.getSnapshot().plan.schema,
        selection: { pageId: 'a', nodeId: null },
      }),
    );
    render(<App saveDelayMs={1} />);
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    expect(screen.queryByRole('region', { name: '页面生命周期配置', hidden: true })).toBeNull();
    expect(screen.queryByRole('tab', { name: '生命周期' })).toBeNull();
    const logicTab = screen.getByRole('tab', { name: '页面逻辑' });
    fireEvent.click(logicTab);
    expect(window.location.search).toBe('?panel=logic');
    changeControl(titleInput(), '已保存进入动作');
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    expect(screen.queryByRole('region', { name: '页面生命周期配置' })).toBeNull();
    fireEvent.click(logicTab);
    expect(titleInput().value).toBe('已保存进入动作');
    fireEvent.click(saveEntry());
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    fireEvent(window, new Event('pagehide'));
    const persisted = JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!);
    expect(persisted.schema.pages[0].onEnter[2].input.title).toEqual(literal('已保存进入动作'));
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(mutation.mock.invocationCallOrder[0]);
    expect((saveEntry() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(query).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重置页面' }));
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
    selectPage('b');
    selectPage('a');
    await waitFor(() => expect(mutation).toHaveBeenCalledTimes(3));
  }, 15000);
});
