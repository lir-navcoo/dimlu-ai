/**
 * N2 independent acceptance template. Not executed against the active developer checkout.
 * Copy into the frozen 002 snapshot at tests/data-source-acceptance.test.ts before running.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataSourceRuntime } from '../packages/runtime/data-source';
import { compileApplication, PageRuntime, type PlannedAction } from '../packages/runtime/engine';
import { compileValue, type EvaluationContext } from '../packages/runtime/expression';
import {
  createRegistry,
  type Registry,
  type TransportContract,
} from '../packages/runtime/registry';
import { EditorDocument } from '../packages/editor/document';
import type {
  ActionCall,
  ApplicationSchema,
  DataSourceDefinition,
  Json,
  Value,
} from '../packages/schema/types';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const dataRef = (sourceId: string, path?: string[]): Value => ({
  kind: 'dataRef',
  sourceId,
  ...(path ? { path } : {}),
});
const action = (
  id: string,
  name: string,
  input: Record<string, Value>,
  resultTo?: string,
): ActionCall => ({ id, action: name, input, ...(resultTo ? { resultTo } : {}) });
const planned = (calls: ActionCall[]): PlannedAction[] =>
  calls.map((schema) => ({
    schema,
    input: Object.fromEntries(
      Object.entries(schema.input).map(([key, value]) => [key, compileValue(value)]),
    ),
  }));
const context = (): EvaluationContext => ({ state: {}, scope: {} });

function controlledTransport() {
  const calls: {
    input: Record<string, Json>;
    signal: AbortSignal;
    resolve(value: unknown): void;
    reject(error: unknown): void;
  }[] = [];
  const execute = vi.fn(
    (input: Record<string, Json>, { signal }: { signal: AbortSignal }) =>
      new Promise<unknown>((resolve, reject) => {
        calls.push({ input, signal, resolve, reject });
      }),
  );
  const transport: TransportContract = {
    version: '1.0.0',
    input: { query: { type: 'string', required: true }, options: { type: 'object' } },
    output: 'object',
    execute,
  };
  return { transport, calls, execute };
}

function sourceDefinition(
  kind: DataSourceDefinition['kind'] = 'query',
  id = 'users',
): DataSourceDefinition {
  return {
    id,
    kind,
    transport: 'test.users',
    input: { query: literal('default') },
    initial: { rows: [], total: 0 },
  };
}

function testRegistry(transport: TransportContract): Registry {
  return createRegistry(
    {
      'test.text': { version: '1.0.0', props: { value: { type: 'json' } } },
      'test.button': { version: '1.0.0', props: {}, events: ['onClick'] },
    },
    {
      'test.notice': {
        version: '1.0.0',
        input: {},
        execute(_input, ctx) {
          ctx.emitEffect({ type: 'notice', data: {} });
        },
      },
    },
    {},
    { 'test.users': transport },
  );
}

function application(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'data-source-acceptance',
    title: '数据源独立验收',
    entryPageId: 'page',
    dependencies: {
      components: { 'test.text': '1.0.0', 'test.button': '1.0.0' },
      actions: { 'data.execute': '1.0.0', 'state.set': '1.0.0', 'test.notice': '1.0.0' },
      transports: { 'test.users': '1.0.0' },
    },
    pages: [
      {
        id: 'page',
        title: '源',
        state: [
          { id: 'query', type: 'string', initial: 'first' },
          { id: 'result', type: 'object', initial: {} },
          { id: 'marker', type: 'string', initial: '' },
        ],
        dataSources: [sourceDefinition()],
        children: [
          { id: 'result-text', component: 'test.text', props: { value: dataRef('users') } },
          { id: 'query-button', component: 'test.button', props: {} },
        ],
      },
    ],
  };
}

function assertJsonSnapshot(value: unknown) {
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  expect(
    Object.values(value as Record<string, unknown>).every((entry) => entry !== undefined),
  ).toBe(true);
}

describe('independent data-source acceptance', () => {
  it('protects form fields referenced by source default input without changing history or redo', () => {
    const { transport } = controlledTransport(),
      schema = application();
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [
          { id: 'name', path: ['name'], label: '姓名', type: 'string', initial: '初始姓名' },
          { id: 'other', path: ['other'], label: '其他', type: 'string', initial: '' },
        ],
      },
    ];
    schema.pages[0].dataSources![0].input.query = expression('forms.model.fields.name.value');
    const document = new EditorDocument(schema, testRegistry(transport));
    document.setProp('page', 'result-text', 'value', literal('临时修改'));
    document.undo();
    const before = document.getSnapshot();
    expect(before.canRedo).toBe(true);
    expect(() => document.removeField('page', 'model', 'name')).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
  });

  it('treats superseded query cancellation inside a submitted form as cancellation without business errors', async () => {
    const { transport, calls } = controlledTransport(),
      registry = testRegistry(transport),
      schema = application();
    registry.components['test.form'] = {
      version: '1.0.0',
      props: {},
      children: true,
      form: true,
      events: ['onSubmit'],
    };
    schema.dependencies.components['test.form'] = '1.0.0';
    schema.dependencies.actions['form.submit'] = '1.0.0';
    schema.pages[0].forms = [
      {
        id: 'model',
        fields: [{ id: 'name', path: ['name'], label: '姓名', type: 'string', initial: '合法' }],
      },
    ];
    schema.pages[0].children.push({
      id: 'form',
      component: 'test.form',
      formId: 'model',
      props: {},
      on: { onSubmit: [action('submitted-query', 'data.execute', { sourceId: literal('users') })] },
    });
    const runtime = new PageRuntime(compileApplication(schema, registry), 'page'),
      effects = vi.fn();
    runtime.subscribeEffects(effects);
    const old = runtime.run(
      planned([
        action('submit-model', 'form.submit', { formId: literal('model') }),
        action('must-not-notify', 'test.notice', {}),
      ]),
      {},
      undefined,
      'submit-lane',
    );
    expect(runtime.getForm('model').getSnapshot().isSubmitting).toBe(true);
    const latest = runtime.getDataSource('users').execute({ query: 'replacement' });
    calls[1].resolve({ rows: ['replacement'], total: 1 });
    await latest;
    expect(await old).toBe(false);
    const form = runtime.getForm('model').getSnapshot();
    expect(form.isSubmitting).toBe(false);
    expect(form.submitError).toBeUndefined();
    expect(runtime.getRecords().filter((record) => record.kind === 'action.error')).toEqual([]);
    expect(effects).not.toHaveBeenCalled();
    expect(runtime.getPending()).toBe(0);
    runtime.dispose();
  });

  it('keeps legacy pages valid without source definitions or transport dependencies', () => {
    const { transport } = controlledTransport(),
      schema = application();
    delete schema.dependencies.transports;
    delete schema.pages[0].dataSources;
    schema.pages[0].children = [];
    const registry = testRegistry(transport);
    delete registry.transports;
    expect(() => compileApplication(schema, registry)).not.toThrow();
  });

  it('rejects invalid source identities, versions, types, references and action overrides atomically', () => {
    const { transport } = controlledTransport(),
      registry = testRegistry(transport);
    const variants: ((schema: ApplicationSchema) => void)[] = [
      (schema) => {
        schema.pages[0].dataSources!.push(sourceDefinition());
      },
      (schema) => {
        schema.pages[0].dataSources![0].transport = 'missing';
      },
      (schema) => {
        delete schema.dependencies.transports;
      },
      (schema) => {
        schema.dependencies.transports!['test.users'] = '9.0.0';
      },
      (schema) => {
        schema.pages[0].dataSources![0].input = {};
      },
      (schema) => {
        schema.pages[0].dataSources![0].input.query = literal(123);
      },
      (schema) => {
        schema.pages[0].dataSources![0].input.extra = literal('unknown');
      },
      (schema) => {
        schema.pages[0].dataSources![0].initial = [];
      },
      (schema) => {
        schema.pages[0].children[0].props.value = dataRef('missing');
      },
      (schema) => {
        schema.pages[0].children[0].props.value = expression('sources.missing.data');
      },
      (schema) => {
        schema.pages[0].children[1].on = {
          onClick: [action('missing', 'data.execute', { sourceId: literal('missing') })],
        };
      },
      (schema) => {
        schema.pages[0].children[1].on = {
          onClick: [
            action('bad-override', 'data.execute', {
              sourceId: literal('users'),
              input: literal({ query: 2 }),
            }),
          ],
        };
      },
    ];
    const document = new EditorDocument(application(), registry),
      before = document.getSnapshot();
    for (const mutate of variants) {
      const invalid = application();
      mutate(invalid);
      expect(() => compileApplication(invalid, registry)).toThrow();
      expect(() => document.replace(invalid)).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
  });

  it('rejects event and scope inputs and explicitly rejects source-bound form rules', () => {
    const { transport } = controlledTransport(),
      registry = testRegistry(transport);
    for (const source of ['event', 'event.target.value', 'scope', 'scope.row.name']) {
      const schema = application();
      schema.pages[0].dataSources![0].input.query = expression(source);
      expect(() => compileApplication(schema, registry)).toThrow();
      expect(
        () => new DataSourceRuntime(schema.pages[0].dataSources![0], transport, context),
      ).toThrow();
    }
    const quoted = application();
    quoted.pages[0].dataSources![0].input.query = expression("'scope.row / event'");
    expect(() => compileApplication(quoted, registry)).not.toThrow();
    const form = application();
    form.pages[0].forms = [
      {
        id: 'model',
        fields: [
          {
            id: 'name',
            path: ['name'],
            label: '姓名',
            type: 'string',
            initial: '',
            when: expression('sources.users.loading'),
          },
        ],
      },
    ];
    expect(() => compileApplication(form, registry)).toThrow();
  });

  it('publishes immutable serializable snapshots, clones output and preserves data through errors', async () => {
    const { transport, calls } = controlledTransport(),
      definition = sourceDefinition();
    const source = new DataSourceRuntime(definition, transport, context);
    const initial = source.getSnapshot();
    expect(initial).toEqual({
      data: { rows: [], total: 0 },
      status: 'idle',
      loading: false,
      error: null,
    });
    assertJsonSnapshot(initial);
    expect(Object.isFrozen(initial.data)).toBe(true);
    const transitions: unknown[] = [],
      unsubscribe = source.subscribe(() => transitions.push(source.getSnapshot()));
    const pending = source.execute();
    expect(source.getSnapshot().status).toBe('loading');
    const output = { rows: [{ id: 'a' }], total: 1 };
    calls[0].resolve(output);
    const accepted = await pending;
    output.rows[0].id = 'external-mutation';
    expect(accepted).toEqual({ rows: [{ id: 'a' }], total: 1 });
    expect(Object.isFrozen((accepted as { rows: Json[] }).rows[0])).toBe(true);
    const successfulData = source.getSnapshot().data;
    const failed = source.refresh();
    const observed = failed.catch((error: unknown) => error);
    calls[1].reject(new TypeError('request failed'));
    expect(await observed).toBeInstanceOf(TypeError);
    expect(source.getSnapshot()).toEqual({
      data: successfulData,
      status: 'error',
      loading: false,
      error: { name: 'TypeError', message: 'request failed' },
    });
    expect(source.getSnapshot().data).toBe(successfulData);
    transitions.forEach(assertJsonSnapshot);
    unsubscribe();
    source.dispose();
  });

  it.each([
    { output: undefined },
    { output: new Date() },
    { output: { rows: undefined } },
    { output: ['wrong shape'] },
  ])(
    'rejects invalid transport output $output without replacing accepted data',
    async ({ output }) => {
      const { transport, calls } = controlledTransport();
      const source = new DataSourceRuntime(sourceDefinition(), transport, context),
        before = source.getSnapshot().data;
      const pending = source.execute(),
        observed = pending.catch((error: unknown) => error);
      calls[0].resolve(output);
      expect(await observed).toBeInstanceOf(Error);
      expect(source.getSnapshot().data).toBe(before);
      expect(source.getSnapshot().status).toBe('error');
      assertJsonSnapshot(source.getSnapshot());
      source.dispose();
    },
  );

  it('evaluates current defaults only on explicit calls, applies shallow overrides and validates before invoking transport', async () => {
    const { transport, calls, execute } = controlledTransport();
    let query: Json = 'first';
    const definition = sourceDefinition();
    definition.input = { query: expression('state.query'), options: literal({ a: 1, b: 2 }) };
    const source = new DataSourceRuntime(definition, transport, () => ({
      state: { query },
      scope: {},
    }));
    query = 'changed';
    expect(execute).not.toHaveBeenCalled();
    const first = source.execute({ options: { b: 3 } });
    expect(calls[0].input).toEqual({ query: 'changed', options: { b: 3 } });
    calls[0].resolve({ rows: [], total: 0 });
    await first;
    const before = source.getSnapshot(),
      notify = vi.fn();
    source.subscribe(notify);
    query = 123;
    await expect(source.execute()).rejects.toThrow();
    await expect(source.execute({ unknown: true })).rejects.toThrow();
    expect(source.getSnapshot()).toBe(before);
    expect(notify).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    const overridden = source.execute({ query: 'explicit' });
    expect(calls[1].input.query).toBe('explicit');
    calls[1].resolve({ rows: [], total: 0 });
    await overridden;
    source.dispose();
  });

  it('keeps an existing valid query active when a later request fails input validation', async () => {
    const { transport, calls, execute } = controlledTransport(),
      source = new DataSourceRuntime(sourceDefinition(), transport, context);
    const first = source.execute(),
      before = source.getSnapshot();
    await expect(source.execute({ query: 123 })).rejects.toThrow();
    expect(calls[0].signal.aborted).toBe(false);
    expect(source.getSnapshot()).toBe(before);
    expect(execute).toHaveBeenCalledOnce();
    calls[0].resolve({ rows: ['valid'], total: 1 });
    await first;
    expect(source.getSnapshot().status).toBe('success');
    source.dispose();
  });

  it('uses latest-wins within a query even when the old transport ignores cancellation', async () => {
    const { transport, calls } = controlledTransport(),
      source = new DataSourceRuntime(sourceDefinition(), transport, context);
    const first = source.execute({ query: 'old' }),
      oldOutcome = first.catch((error: unknown) => error);
    const second = source.execute({ query: 'new' });
    expect(calls[0].signal.aborted).toBe(true);
    expect(await oldOutcome).toMatchObject({ name: 'AbortError' });
    calls[1].resolve({ rows: ['new'], total: 1 });
    await second;
    const accepted = source.getSnapshot();
    calls[0].resolve({ rows: ['old'], total: 99 });
    await Promise.resolve();
    expect(source.getSnapshot()).toBe(accepted);
    source.dispose();
  });

  it('rejects a concurrent mutation before executing its transport and supports a later explicit retry', async () => {
    const { transport, calls, execute } = controlledTransport(),
      source = new DataSourceRuntime(sourceDefinition('mutation'), transport, context);
    const first = source.execute(),
      before = source.getSnapshot();
    await expect(source.execute()).rejects.toThrow(/busy|正在执行/);
    expect(source.getSnapshot()).toBe(before);
    expect(calls[0].signal.aborted).toBe(false);
    expect(execute).toHaveBeenCalledOnce();
    calls[0].resolve({ rows: [], total: 1 });
    await first;
    const retry = source.refresh();
    calls[1].resolve({ rows: [], total: 2 });
    await retry;
    expect(execute).toHaveBeenCalledTimes(2);
    source.dispose();
  });

  it('supports explicit cancel, external abort and disposal without publishing ignored late results', async () => {
    const { transport, calls } = controlledTransport(),
      source = new DataSourceRuntime(sourceDefinition(), transport, context);
    const first = source.execute(),
      canceled = first.catch((error: unknown) => error);
    source.cancel();
    expect(await canceled).toMatchObject({ name: 'AbortError' });
    expect(source.getSnapshot()).toMatchObject({ status: 'idle', loading: false, error: null });
    const idle = source.getSnapshot();
    calls[0].resolve({ rows: ['old'], total: 3 });
    await Promise.resolve();
    expect(source.getSnapshot()).toBe(idle);
    const controller = new AbortController();
    const second = source.execute({}, { signal: controller.signal }),
      aborted = second.catch((error: unknown) => error);
    controller.abort();
    expect(await aborted).toMatchObject({ name: 'AbortError' });
    expect(source.getSnapshot().loading).toBe(false);
    const third = source.execute(),
      disposed = third.catch((error: unknown) => error);
    source.dispose();
    expect(await disposed).toMatchObject({ name: 'AbortError' });
    const final = source.getSnapshot(),
      notify = vi.fn();
    source.subscribe(notify);
    calls[1].resolve({ rows: ['late'], total: 2 });
    calls[2].resolve({ rows: ['disposed'], total: 1 });
    await Promise.resolve();
    expect(source.getSnapshot()).toBe(final);
    expect(notify).not.toHaveBeenCalled();
    await expect(source.execute()).rejects.toThrow();
  });

  it('keeps two source instances isolated even with equal definition IDs', async () => {
    const { transport, calls } = controlledTransport();
    const a = new DataSourceRuntime(sourceDefinition(), transport, context),
      b = new DataSourceRuntime(sourceDefinition(), transport, context);
    const first = a.execute(),
      second = b.execute();
    a.dispose();
    const observed = first.catch((error: unknown) => error);
    calls[1].resolve({ rows: ['b'], total: 1 });
    await second;
    expect(await observed).toMatchObject({ name: 'AbortError' });
    expect(b.getSnapshot().data).toEqual({ rows: ['b'], total: 1 });
    b.dispose();
  });

  it('stops superseded action chains across lanes and counts directly invoked source work as pending', async () => {
    const { transport, calls } = controlledTransport(),
      runtime = new PageRuntime(compileApplication(application(), testRegistry(transport)), 'page');
    const effects = vi.fn();
    runtime.subscribeEffects(effects);
    const old = runtime.run(
      planned([
        action(
          'old-query',
          'data.execute',
          { sourceId: literal('users'), input: literal({ query: 'old' }) },
          'result',
        ),
        action('old-notice', 'test.notice', {}),
      ]),
      {},
      undefined,
      'lane-old',
    );
    const recent = runtime.run(
      planned([
        action(
          'new-query',
          'data.execute',
          { sourceId: literal('users'), input: literal({ query: 'new' }) },
          'result',
        ),
        action('new-notice', 'test.notice', {}),
      ]),
      {},
      undefined,
      'lane-new',
    );
    calls[1].resolve({ rows: ['new'], total: 1 });
    expect(await recent).toBe(true);
    expect(await old).toBe(false);
    expect(runtime.getState().result).toEqual({ rows: ['new'], total: 1 });
    expect(effects).toHaveBeenCalledOnce();
    expect(runtime.getRecords().filter((record) => record.kind === 'action.error')).toEqual([]);
    calls[0].resolve({ rows: ['old'], total: 100 });
    await Promise.resolve();
    expect(effects).toHaveBeenCalledOnce();
    expect(runtime.getPending()).toBe(0);
    const direct = runtime.getDataSource('users').refresh();
    expect(runtime.getPending()).toBeGreaterThan(0);
    calls[2].resolve({ rows: [], total: 0 });
    await direct;
    expect(runtime.getPending()).toBe(0);
    runtime.dispose();
  });

  it('subscribes to precise source keys and preserves reversible dataRef paths', async () => {
    const { transport, calls } = controlledTransport(),
      schema = application();
    schema.pages[0].dataSources!.push(sourceDefinition('query', 'other'));
    const runtime = new PageRuntime(compileApplication(schema, testRegistry(transport)), 'page');
    const a = vi.fn(),
      b = vi.fn();
    runtime.subscribeState(['@source:users'], a);
    runtime.subscribeState(['@source:other'], b);
    const aVersion = runtime.snapshot(['@source:users']);
    const other = runtime.getDataSource('other').execute();
    calls[0].resolve({ 'first.name': { '': '原样路径' }, rows: [], total: 0 });
    await other;
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    expect(runtime.snapshot(['@source:users'])).toBe(aVersion);
    const binding = compileValue(dataRef('other', ['first.name', '']));
    expect(binding.dependencies).toEqual(['@source:other']);
    expect(binding.evaluate(runtime.context())).toBe('原样路径');
    const status = compileValue(expression('sources.other.status'));
    expect(status.dependencies).toEqual(['@source:other']);
    expect(status.evaluate(runtime.context())).toBe('success');
    assertJsonSnapshot(runtime.getDataSourcesSnapshot());
    runtime.dispose();
  });

  it('blocks design-mode source entry and preserves instance identity while canceling in-flight work on edit', async () => {
    const { transport, calls, execute } = controlledTransport(),
      schema = application();
    schema.pages[0].onEnter = [
      action('enter-query', 'data.execute', { sourceId: literal('users') }),
    ];
    const runtime = new PageRuntime(compileApplication(schema, testRegistry(transport)), 'page', {
      designMode: true,
    });
    const source = runtime.getDataSource('users');
    await runtime.enter();
    await expect(source.execute()).rejects.toThrow();
    expect(
      await runtime.run(
        planned([action('design-call', 'data.execute', { sourceId: literal('users') })]),
        {},
        undefined,
        'design',
      ),
    ).toBe(false);
    expect(execute).not.toHaveBeenCalled();
    runtime.setDesignMode(false);
    await runtime.enter();
    expect(execute).toHaveBeenCalledOnce();
    calls[0].resolve({ rows: ['entered'], total: 1 });
    await vi.waitFor(() => expect(runtime.getPending()).toBe(0));
    const accepted = source.getSnapshot().data;
    const pending = source.refresh(),
      canceled = pending.catch((error: unknown) => error);
    runtime.setDesignMode(true);
    expect(await canceled).toMatchObject({ name: 'AbortError' });
    expect(runtime.getDataSource('users')).toBe(source);
    expect(source.getSnapshot().data).toBe(accepted);
    expect(runtime.getPending()).toBe(0);
    calls[1].resolve({ rows: ['late'], total: 99 });
    await Promise.resolve();
    expect(source.getSnapshot().data).toBe(accepted);
    runtime.setDesignMode(false);
    await runtime.enter();
    expect(execute).toHaveBeenCalledTimes(2);
    expect(runtime.getPending()).toBe(0);
    runtime.dispose();
  });
});
