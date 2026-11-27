import { act, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { compileApplication, PageRuntime, type PlannedAction } from '../packages/runtime/engine';
import { compileValue } from '../packages/runtime/expression';
import { validateApplication } from '../packages/schema/validate';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl, closeActionConfig, openActionConfig } from './ui-helpers';
import { EditorDocument, findNode } from '../packages/editor/document';
import { FormSubmissionError } from '../packages/runtime/form';
import { ActionPanel } from '../src/editor/ActionPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { actionsExample as actionExample } from './fixtures/example-json';
import type {
  ActionCall,
  ApplicationSchema,
  Json,
  NodeSchema,
  Value,
} from '../packages/schema/types';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const call = (id: string, action: string, input: Record<string, Value>): ActionCall => ({
  id,
  action,
  input,
});
const planned = (calls: ActionCall[]): PlannedAction[] =>
  calls.map((schema) => ({
    schema,
    input: Object.fromEntries(
      Object.entries(schema.input).map(([key, value]) => [key, compileValue(value)]),
    ),
  }));
function application(children: NodeSchema[] = []): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'action-acceptance',
    title: '动作独立验收',
    entryPageId: 'page',
    dependencies: {
      components: Object.fromEntries(
        Object.entries(registry.components).map(([id, entry]) => [id, entry.version]),
      ),
      actions: Object.fromEntries(
        Object.entries(registry.actions).map(([id, entry]) => [id, entry.version]),
      ),
    },
    pages: [
      {
        id: 'page',
        title: '动作',
        state: [
          { id: 'message', type: 'string', initial: '' },
          { id: 'count', type: 'number', initial: 0 },
          { id: 'open', type: 'boolean', initial: false },
        ],
        children,
      },
    ],
  };
}
const button = (on: NodeSchema['on']): NodeSchema => ({
  id: 'button',
  component: 'ui.button',
  props: { label: literal('执行动作') },
  on,
});

function formApplication(onSubmit: ActionCall[] = []): ApplicationSchema {
  const schema = application([
    {
      id: 'form-container',
      component: 'ui.form',
      formId: 'record',
      props: {},
      on: { onSubmit },
      children: [
        {
          id: 'name-input',
          component: 'ui.input',
          field: { formId: 'record', fieldId: 'displayName' },
          props: {},
        },
      ],
    },
  ]);
  schema.pages[0].forms = [
    {
      id: 'record',
      fields: [
        {
          id: 'displayName',
          path: ['profile', 'name'],
          label: '姓名',
          type: 'string',
          initial: '',
          rules: [{ kind: 'required', message: '姓名必填' }],
        },
        { id: 'amount', path: ['amount'], label: '金额', type: 'number', initial: 2 },
      ],
      arrays: [
        {
          id: 'lines',
          path: ['order', 'lines'],
          label: '明细',
          fields: [
            { id: 'itemName', path: ['name'], label: '品名', type: 'string', initial: '' },
            { id: 'quantity', path: ['quantity'], label: '数量', type: 'number', initial: 1 },
          ],
          initial: [{ name: '初始行', quantity: 2 }],
        },
      ],
    },
  ];
  return schema;
}

function EventPanelHarness({ document }: { document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const node = findNode(
    snapshot.plan.schema.pages.find((p) => p.id === snapshot.selection.pageId)!,
    snapshot.selection.nodeId!,
  )!.node;
  return <ActionPanel document={document} snapshot={snapshot} node={node} />;
}

describe('independent event action acceptance', () => {
  it.each([{ path: ['first.name'] }, { path: [''] }])(
    'preserves state reference path $path when another event input changes',
    ({ path }) => {
      const schema = application([
        button({
          onClick: [
            call('notice', 'ui.notify', { title: { kind: 'stateRef', stateId: 'object', path } }),
          ],
        }),
      ]);
      schema.pages[0].state.push({
        id: 'object',
        type: 'object',
        initial: { 'first.name': '点号属性', '': '空属性' },
      });
      const document = new EditorDocument(schema, registry);
      render(
        <TipProvider>
          <EditorSessionProvider>
            <EventPanelHarness document={document} />
          </EditorSessionProvider>
        </TipProvider>,
      );
      openActionConfig(1);
      changeControl(screen.getByLabelText('tone取值方式'), 'literal');
      changeControl(screen.getByLabelText('tone'), 'success');
      closeActionConfig();
      fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(
        findNode(document.getSnapshot().plan.schema.pages[0], 'button')!.node.on!.onClick[0].input
          .title,
      ).toEqual({ kind: 'stateRef', stateId: 'object', path });
    },
  );

  it('validates literal form patches on import and prevents deleting or changing a field that the patch writes', () => {
    const schema = formApplication();
    schema.pages[0].children.push(
      button({
        onClick: [
          call('prefill', 'form.setValues', {
            formId: literal('record'),
            values: literal({ amount: 3 }),
          }),
        ],
      }),
    );
    const document = new EditorDocument(schema, registry),
      before = document.getSnapshot();
    expect(() => document.removeField('page', 'record', 'amount')).toThrow();
    expect(document.getSnapshot()).toBe(before);
    for (const change of ['path', 'type'] as const) {
      const changed = structuredClone(schema);
      const field = changed.pages[0].forms![0].fields[1];
      if (change === 'path') field.path = ['renamed'];
      else {
        field.type = 'string';
        field.initial = '2';
      }
      expect(() => document.replace(changed)).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
    const invalidValues: Json[] = [
      { unknown: '字段不存在' },
      { amount: '类型错误' },
      { order: { lines: [{ name: 'A', quantity: '类型错误' }] } },
    ];
    for (const values of invalidValues) {
      const invalid = structuredClone(schema);
      invalid.pages[0].children.at(-1)!.on!.onClick[0].input.values = literal(values);
      expect(() => compileApplication(invalid, registry)).toThrow();
    }
  });

  it('runs the published table-to-drawer example through native save, failed external submit and corrected retry', async () => {
    const runtime = new PageRuntime(compileApplication(actionExample, registry), 'records'),
      effects = vi.fn();
    runtime.subscribeEffects(effects);
    render(
      <TipProvider>
        <RuntimeRenderer runtime={runtime} materials={materials} />
      </TipProvider>,
    );
    fireEvent.click(screen.getAllByRole('button', { name: /^编辑$/ })[0]);
    await screen.findByRole('dialog', { name: '编辑记录' });
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).value).toBe(
      '林知远',
    );
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '独立验收姓名');
    fireEvent.click(screen.getByRole('button', { name: '保存记录' }));
    await waitFor(() => expect(runtime.getState().drawerOpen).toBe(false), { timeout: 3000 });
    expect(runtime.getState().records).toEqual([
      { id: 'r1', name: '独立验收姓名', department: '研发中心' },
      { id: 'r2', name: '陈嘉宁', department: '产品设计部' },
    ]);
    expect(effects).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑记录' })).toBeNull());
    fireEvent.click(screen.getAllByRole('button', { name: /^编辑$/ })[1]);
    await screen.findByRole('dialog', { name: '编辑记录' });
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).value).toBe(
      '陈嘉宁',
    );
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '模拟失败');
    fireEvent.click(screen.getByRole('button', { name: '提交表单' }));
    await waitFor(() => expect(runtime.getForm('edit').getSnapshot().submitError).toBeTruthy(), {
      timeout: 3000,
    });
    expect(screen.getByRole('dialog', { name: '编辑记录' })).toBeTruthy();
    expect(runtime.getState().drawerOpen).toBe(true);
    expect((runtime.getState().records as { name: string }[])[1].name).toBe('陈嘉宁');
    expect(effects).toHaveBeenCalledOnce();
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '重试成功姓名');
    fireEvent.click(screen.getByRole('button', { name: '提交表单' }));
    await waitFor(() => expect(runtime.getState().drawerOpen).toBe(false), { timeout: 3000 });
    expect((runtime.getState().records as { name: string }[])[1].name).toBe('重试成功姓名');
    expect(effects).toHaveBeenCalledTimes(2);
    expect(runtime.getPending()).toBe(0);
    runtime.dispose();
  });

  it('saves actions drafted on different nodes in either order without colliding identities', () => {
    const document = new EditorDocument(
      application([button(undefined), { ...button(undefined), id: 'other' }]),
      registry,
    );
    render(
      <TipProvider>
        <EditorSessionProvider>
          <EventPanelHarness document={document} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    const addNotice = (title: string) => {
      fireEvent.click(screen.getByRole('button', { name: '添加动作' }));
      openActionConfig(1);
      changeControl(screen.getByLabelText('动作 1 类型'), 'ui.notify');
      changeControl(screen.getByLabelText('title取值方式'), 'literal');
      changeControl(screen.getByLabelText('title'), title);
      closeActionConfig();
    };
    addNotice('节点A');
    act(() => document.select('page', 'other'));
    addNotice('节点B');
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    act(() => document.select('page', 'button'));
    openActionConfig(1);
    expect((screen.getByLabelText('title') as HTMLInputElement).value).toBe('节点A');
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const page = document.getSnapshot().plan.schema.pages[0];
    const a = findNode(page, 'button')!.node.on!.onClick[0];
    const b = findNode(page, 'other')!.node.on!.onClick[0];
    expect(a.id).not.toBe(b.id);
    expect(a.input.title).toEqual(literal('节点A'));
    expect(b.input.title).toEqual(literal('节点B'));
  });

  it('keeps invalid event drafts across node switches, protects the accepted schema and requires stale draft confirmation', () => {
    const original = [call('notice', 'ui.notify', { title: literal('原配置') })];
    const schema = application([
      button({ onClick: original }),
      { ...button(undefined), id: 'other' },
    ]);
    const document = new EditorDocument(schema, registry);
    render(
      <TipProvider>
        <EditorSessionProvider>
          <EventPanelHarness document={document} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    const before = document.getSnapshot();
    openActionConfig(1);
    changeControl(screen.getByLabelText('title取值方式'), 'expression');
    changeControl(screen.getByLabelText('title'), 'state.');
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.getSnapshot()).toBe(before);
    act(() => document.select('page', 'other'));
    expect(screen.queryByLabelText('title')).toBeNull();
    act(() => document.select('page', 'button'));
    openActionConfig(1);
    expect((screen.getByLabelText('title') as HTMLTextAreaElement).value).toBe('state.');
    closeActionConfig();
    act(() =>
      document.setEventActions('page', 'button', 'onClick', [
        call('notice', 'ui.notify', { title: literal('外部新配置') }),
      ]),
    );
    expect((screen.getByRole('button', { name: '保存事件' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: '确认使用草稿' })).toBeTruthy();
    openActionConfig(1);
    changeControl(screen.getByLabelText('title'), '"草稿已确认"');
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(
      findNode(document.getSnapshot().plan.schema.pages[0], 'button')!.node.on!.onClick[0].input
        .title,
    ).toEqual(expression('"草稿已确认"'));
    expect(screen.queryByRole('alert')).toBeNull();
    document.undo();
    expect(
      findNode(document.getSnapshot().plan.schema.pages[0], 'button')!.node.on!.onClick[0].input
        .title,
    ).toEqual(literal('外部新配置'));
  });

  it('cancels nested submissions and blocks late custom form writes and notifications after the parent lane is superseded', async () => {
    let finish!: () => void;
    const started = vi.fn();
    const customRegistry = {
      ...registry,
      actions: {
        ...registry.actions,
        'test.slowSubmit': {
          version: '1.0.0',
          input: {},
          async execute(
            _input: Record<string, Json>,
            context: Parameters<(typeof registry.actions)['state.set']['execute']>[1],
          ) {
            started();
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            context.setFormValues('record', { profile: { name: '迟到覆盖' } });
            context.setState('message', '迟到状态');
            context.emitEffect({ type: 'ui.notify', data: { title: '迟到通知' } });
          },
        },
      },
    };
    const schema = formApplication([call('slow', 'test.slowSubmit', {})]);
    schema.dependencies.actions['test.slowSubmit'] = '1.0.0';
    const runtime = new PageRuntime(compileApplication(schema, customRegistry), 'page');
    const form = runtime.getForm('record'),
      effects = vi.fn();
    runtime.subscribeEffects(effects);
    form.setValues({ profile: { name: '保留姓名' } });
    const pending = runtime.run(
      planned([
        call('submit', 'form.submit', { formId: literal('record') }),
        call('late', 'state.set', { stateId: literal('open'), value: literal(true) }),
      ]),
      {},
      undefined,
      'parent',
    );
    await waitFor(() => expect(started).toHaveBeenCalledOnce());
    expect(form.getSnapshot().isSubmitting).toBe(true);
    await runtime.run(
      planned([call('replacement', 'state.set', { stateId: literal('count'), value: literal(5) })]),
      {},
      undefined,
      'parent',
    );
    expect(await pending).toBe(false);
    await waitFor(() => expect(form.getSnapshot().isSubmitting).toBe(false));
    finish();
    await Promise.resolve();
    expect(form.getSnapshot().fields.displayName.value).toBe('保留姓名');
    expect(runtime.getState()).toMatchObject({ message: '', open: false, count: 5 });
    expect(effects).not.toHaveBeenCalled();
    expect(runtime.getPending()).toBe(0);
    runtime.dispose();
  });

  it('saves chains, dependencies and order atomically, with one undo step and untouched redo on failure', () => {
    const schema = application([button(undefined)]);
    schema.dependencies.actions = {};
    const document = new EditorDocument(schema, registry);
    const original = document.getSnapshot();
    const first = call('notify', 'ui.notify', { title: literal('第一条') });
    const second = call('increment', 'state.set', { stateId: literal('count'), value: literal(3) });
    document.setEventActions('page', 'button', 'onClick', [first, second]);
    const saved = document.getSnapshot();
    expect(saved.plan.schema.dependencies.actions).toMatchObject({
      'ui.notify': '1.0.0',
      'state.set': '1.0.0',
    });
    expect(findNode(saved.plan.schema.pages[0], 'button')!.node.on!.onClick).toEqual([
      first,
      second,
    ]);
    expect(() =>
      compileApplication(JSON.parse(JSON.stringify(saved.plan.schema)), registry),
    ).not.toThrow();
    document.undo();
    const undone = document.getSnapshot();
    expect(undone.plan.schema).toEqual(original.plan.schema);
    expect(undone.canUndo).toBe(false);
    expect(undone.canRedo).toBe(true);
    expect(() =>
      document.setEventActions('page', 'button', 'onClick', [
        first,
        call('bad', 'state.set', { stateId: literal('missing'), value: literal(1) }),
      ]),
    ).toThrow();
    expect(document.getSnapshot()).toBe(undone);
    document.redo();
    document.setEventActions('page', 'button', 'onClick', [second, first]);
    expect(
      findNode(document.getSnapshot().plan.schema.pages[0], 'button')!.node.on!.onClick.map(
        (a) => a.id,
      ),
    ).toEqual(['increment', 'notify']);
    document.undo();
    expect(document.getSnapshot().plan.schema).toEqual(saved.plan.schema);
    document.setEventActions('page', 'button', 'onClick', []);
    expect(
      findNode(document.getSnapshot().plan.schema.pages[0], 'button')!.node.on,
    ).toBeUndefined();
    document.undo();
    expect(document.getSnapshot().plan.schema).toEqual(saved.plan.schema);
  });

  it('accepts only row and repeat parameters available at the edited node', () => {
    const outside = { ...button(undefined), id: 'outside' };
    const inside = { ...button(undefined), id: 'inside' };
    const repeated = {
      ...button(undefined),
      id: 'repeated',
      repeat: { items: literal([{ id: 'a' }]), item: 'person', key: expression('scope.person.id') },
    };
    const schema = application([
      outside,
      {
        id: 'table',
        component: 'ui.table',
        props: {
          data: literal([{ id: 'a', name: 'A' }]),
          columns: literal([{ key: 'name', title: '姓名' }]),
        },
        slots: { actions: { params: ['row', 'index'], children: [inside] } },
      },
      repeated,
    ]);
    const document = new EditorDocument(schema, registry);
    const before = document.getSnapshot();
    const row = [call('row', 'ui.notify', { title: expression('scope.row.name') })];
    expect(() => document.setEventActions('page', 'outside', 'onClick', row)).toThrow(/scope.row/);
    expect(document.getSnapshot()).toBe(before);
    expect(() => document.setEventActions('page', 'inside', 'onClick', row)).not.toThrow();
    expect(() =>
      document.setEventActions('page', 'repeated', 'onClick', [
        call('person', 'ui.notify', { title: expression('scope.person.id') }),
      ]),
    ).not.toThrow();
    const after = document.getSnapshot();
    expect(() =>
      document.setEventActions('page', 'inside', 'onClick', [
        call('wrong', 'ui.notify', { title: expression('scope.person.id') }),
      ]),
    ).toThrow(/scope.person/);
    expect(document.getSnapshot()).toBe(after);
  });

  it('prevents event edits from replacing form adapter ownership', () => {
    const document = new EditorDocument(formApplication(), registry),
      before = document.getSnapshot();
    for (const event of ['onValueChange', 'onBlur']) {
      expect(() =>
        document.setEventActions('page', 'name-input', event, [
          call('notice', 'ui.notify', { title: literal('禁止覆盖') }),
        ]),
      ).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
  });

  it('patches nested business paths once and rejects every invalid patch before touching values, errors or row identities', async () => {
    const runtime = new PageRuntime(compileApplication(formApplication(), registry), 'page');
    const form = runtime.getForm('record');
    form.setValue('displayName', '原姓名');
    await form.submit(async () => {
      throw new FormSubmissionError('服务失败', { displayName: '服务端字段错误' });
    });
    const before = form.getSnapshot(),
      notify = vi.fn();
    form.subscribe(notify);
    for (const patch of [
      { profile: { name: '不应应用' }, amount: '错误类型' },
      { displayName: '内部ID不是业务path' },
      { profile: { name: '不应应用' }, order: { lines: [{ name: 'A', quantity: '错误类型' }] } },
      { profile: { name: '不应应用' }, unknown: true },
    ]) {
      expect(() => form.setValues(patch)).toThrow();
      expect(form.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
    }
    const ids = before.arrays.lines.rows.map((r) => r.id);
    form.setValues({ profile: { name: '新姓名' } });
    expect(notify).toHaveBeenCalledOnce();
    expect(form.getSubmitValues()).toEqual({
      profile: { name: '新姓名' },
      amount: 2,
      order: { lines: [{ name: '初始行', quantity: 2 }] },
    });
    expect(form.getSnapshot().arrays.lines.rows.map((r) => r.id)).toEqual(ids);
    form.setValues({ order: { lines: [{ name: '替换行', quantity: 4 }] } });
    expect(form.getSnapshot().arrays.lines.rows).toHaveLength(1);
    expect(form.getSnapshot().arrays.lines.rows[0].id).not.toBe(ids[0]);
    runtime.dispose();
  });

  it('blocks invalid submits and runs validated nested submit actions before the outer chain continues', async () => {
    const schema = formApplication([
      call('inner', 'state.set', {
        stateId: literal('message'),
        value: expression('forms.record.fields.displayName.value'),
      }),
    ]);
    const runtime = new PageRuntime(compileApplication(schema, registry), 'page');
    const actions = planned([
      call('submit', 'form.submit', { formId: literal('record') }),
      call('after', 'state.set', { stateId: literal('open'), value: literal(true) }),
    ]);
    expect(await runtime.run(actions, {}, undefined, 'submit-lane')).toBe(false);
    expect(runtime.getState()).toMatchObject({ message: '', open: false });
    expect(runtime.getForm('record').getSnapshot().errors.displayName).toBe('姓名必填');
    runtime.getForm('record').setValues({ profile: { name: '已校验' } });
    expect(await runtime.run(actions, {}, undefined, 'submit-lane')).toBe(true);
    expect(runtime.getState()).toMatchObject({ message: '已校验', open: true });
    runtime.dispose();
  });

  it('rejects submit recursion and scoped programmatic targets without hanging or continuing', async () => {
    const schema = formApplication([call('self', 'form.submit', { formId: literal('record') })]);
    const runtime = new PageRuntime(compileApplication(schema, registry), 'page');
    runtime.getForm('record').setValues({ profile: { name: '有效' } });
    await expect(runtime.submitForm('record')).rejects.toThrow(/循环/);
    expect(runtime.getPending()).toBe(0);
    expect(runtime.getForm('record').getSnapshot().isSubmitting).toBe(false);
    runtime.dispose();
    const scoped = formApplication();
    scoped.pages[0].children = [
      {
        id: 'repeated-container',
        component: 'ui.layout',
        props: {},
        repeat: { items: literal([{ id: 'a' }]), item: 'row', key: expression('scope.row.id') },
        children: scoped.pages[0].children,
      },
    ];
    const scopedRuntime = new PageRuntime(compileApplication(scoped, registry), 'page');
    scopedRuntime.getForm('record').setValues({ profile: { name: '有效' } });
    await expect(scopedRuntime.submitForm('record')).rejects.toThrow(/唯一|循环|插槽/);
    scopedRuntime.dispose();
  });

  it('rejects cycles across different forms and clears all pending submission state', async () => {
    const schema = formApplication([call('to-other', 'form.submit', { formId: literal('other') })]);
    schema.pages[0].forms!.push({
      id: 'other',
      fields: [{ id: 'flag', path: ['flag'], label: '标记', type: 'boolean', initial: false }],
    });
    schema.pages[0].children.push({
      id: 'other-form',
      component: 'ui.form',
      formId: 'other',
      props: {},
      on: { onSubmit: [call('back-to-record', 'form.submit', { formId: literal('record') })] },
    });
    const runtime = new PageRuntime(compileApplication(schema, registry), 'page');
    runtime.getForm('record').setValues({ profile: { name: '有效' } });
    await expect(runtime.submitForm('record')).rejects.toThrow(/循环/);
    expect(runtime.getForm('record').getSnapshot().isSubmitting).toBe(false);
    expect(runtime.getForm('other').getSnapshot().isSubmitting).toBe(false);
    expect(runtime.getPending()).toBe(0);
    runtime.dispose();
  });

  it('keeps configured business actions inert in design mode and activates them in preview', async () => {
    const schema = application([
      { id: 'count', component: 'ui.text', props: { value: expression("'计数：' + state.count") } },
      button({
        onClick: [
          call('increment', 'state.set', {
            stateId: literal('count'),
            value: expression('state.count + 1'),
          }),
        ],
      }),
    ]);
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    changeControl(screen.getByLabelText('应用定义 · JSON'), JSON.stringify(schema));
    fireEvent.click(screen.getByRole('button', { name: '校验并应用' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    fireEvent.click(screen.getByRole('button', { name: /^执行动作$/ }));
    expect(screen.getByText('计数：0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    fireEvent.click(screen.getByRole('button', { name: /^执行动作$/ }));
    await waitFor(() => expect(screen.getByText('计数：1')).toBeTruthy());
  });
  it('rejects unsupported component events, missing inputs and mismatched literal types on import', () => {
    const cases = [
      button({ onValueChange: [call('event', 'ui.notify', { title: literal('无效事件') })] }),
      button({ onClick: [call('missing', 'ui.notify', {})] }),
      button({ onClick: [call('type', 'ui.notify', { title: literal(123) })] }),
      button({
        onClick: [
          call('extra', 'ui.notify', { title: literal('通知'), unknown: literal('未知参数') }),
        ],
      }),
    ];
    for (const node of cases)
      expect(() => compileApplication(application([node]), registry)).toThrow();
    const schema = application([
      button({
        onClick: [
          call('same', 'ui.notify', { title: literal('甲') }),
          call('same', 'ui.notify', { title: literal('乙') }),
        ],
      }),
    ]);
    expect(
      validateApplication(schema, registry).some((issue) => issue.code === 'id.duplicate'),
    ).toBe(true);
  });

  it('checks dynamic action input types before execution and stops later actions without effects', async () => {
    const schema = application([
      button({
        onClick: [
          call('invalid-title', 'ui.notify', { title: expression('state.count') }),
          call('should-not-open', 'state.set', { stateId: literal('open'), value: literal(true) }),
        ],
      }),
    ]);
    const runtime = new PageRuntime(compileApplication(schema, registry), 'page');
    const effects = vi.fn();
    runtime.subscribeEffects(effects);
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    fireEvent.click(screen.getByRole('button', { name: '执行动作' }));
    await waitFor(() => expect(runtime.getPending()).toBe(0));
    expect(runtime.getState().open).toBe(false);
    expect(effects).not.toHaveBeenCalled();
    expect(
      runtime
        .getRecords()
        .some((record) => record.kind === 'action.error' && record.message.includes('类型错误')),
    ).toBe(true);
    runtime.dispose();
  });

  it('does not publish notifications or mutate state from an aborted custom action context', async () => {
    let finish!: () => void;
    let ignoredAbortWork!: () => void;
    const customRegistry = {
      ...registry,
      actions: {
        ...registry.actions,
        'test.late': {
          version: '1.0.0',
          input: {},
          async execute(
            _input: Record<string, Json>,
            context: Parameters<(typeof registry.actions)['state.set']['execute']>[1],
          ) {
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
            ignoredAbortWork = () => {
              context.setState('message', '迟到写入');
              context.emitEffect({ type: 'ui.notify', data: { title: '迟到通知' } });
            };
            ignoredAbortWork();
          },
        },
      },
    };
    const schema = application();
    schema.dependencies.actions['test.late'] = '1.0.0';
    const runtime = new PageRuntime(compileApplication(schema, customRegistry), 'page'),
      effects = vi.fn();
    runtime.subscribeEffects(effects);
    const pending = runtime.run(
      planned([call('slow', 'test.late', {})]),
      {},
      undefined,
      'same-event',
    );
    await runtime.run(
      planned([
        call('replace', 'state.set', { stateId: literal('message'), value: literal('最新输入') }),
      ]),
      {},
      undefined,
      'same-event',
    );
    await act(async () => {
      finish();
      await pending;
    });
    expect(runtime.getState().message).toBe('最新输入');
    expect(effects).not.toHaveBeenCalled();
    runtime.dispose();
    ignoredAbortWork();
    expect(effects).not.toHaveBeenCalled();
  });
});
