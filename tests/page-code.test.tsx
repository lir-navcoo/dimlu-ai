import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import type {
  ActionCall,
  ApplicationSchema,
  Json,
  PageActionCode,
  PageCode,
} from '../packages/schema/types';
import { registry } from '../src/materials';
import { compilePageCode } from '../src/code/compiler';
import { compileValue } from '../packages/runtime/expression';
import { pageActionPrefix } from '../packages/runtime/page-action-code';
import { CodePageCanvas, evaluatePageCode } from '../src/code/CodePage';

const definition = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'code-test',
  title: 'Code',
  entryPageId: 'one',
  dependencies: { components: {}, actions: {} },
  pages: [
    { id: 'one', title: 'One', state: [{ id: 'count', type: 'number', initial: 7 }], children: [] },
  ],
});
const code = (source: string, language: PageCode['language'] = 'tsx'): PageCode => ({
  enabled: true,
  language,
  source,
  css: 'button { color: rgb(1, 2, 3); }',
});
const runtimes: PageRuntime[] = [];
function runtime() {
  const value = new PageRuntime(compileApplication(definition(), registry), 'one');
  runtimes.push(value);
  return value;
}
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((value) => value.dispose());
  delete (globalThis as Record<string, unknown>).__codeProbe;
});

describe('page code definition and author module boundaries', () => {
  it('publishes code atomically with clone protection, no-op, undo/redo and preserved children', () => {
    const doc = new EditorDocument(definition(), registry);
    const before = doc.getSnapshot();
    const value = code('throw new Error("not evaluated"); export default () => <p/>;');
    expect(doc.setPageCode('one', value)).toBe(true);
    value.source = 'changed';
    const saved = doc.getSnapshot();
    expect(saved.plan.pages.get('one')!.schema.code!.source).toContain('not evaluated');
    expect(saved.plan.pages.get('one')!.schema.children).toEqual(
      before.plan.pages.get('one')!.schema.children,
    );
    expect(doc.setPageCode('one', saved.plan.pages.get('one')!.schema.code)).toBe(false);
    expect(() => doc.setPageCode('one', { ...value, extra: true } as PageCode)).toThrow();
    expect(doc.getSnapshot()).toBe(saved);
    doc.undo();
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.code).toBeUndefined();
    doc.redo();
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.code).toEqual(
      saved.plan.pages.get('one')!.schema.code,
    );
    doc.setPageCode('one', undefined);
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.code).toBeUndefined();
  });
  it('requires the exact optional code shape and keeps application compilation inert', () => {
    for (const invalid of [
      {},
      { enabled: true, language: 'js', source: '', css: '' },
      { enabled: true, language: 'jsx', source: '' },
      { enabled: 1, language: 'jsx', source: '', css: '' },
    ]) {
      const schema = definition();
      schema.pages[0].code = invalid as PageCode;
      expect(() => compileApplication(schema, registry)).toThrow();
    }
    const schema = definition();
    schema.pages[0].code = code('globalThis.__codeProbe = "executed"; export default () => <p/>;');
    compileApplication(schema, registry);
    compilePageCode(schema.pages[0].code!);
    expect((globalThis as Record<string, unknown>).__codeProbe).toBeUndefined();
  });
  it.each([
    'import X from "unknown";',
    'export * from "unknown";',
    'export { X } from "unknown";',
    'export type { X } from "unknown";',
    'import type { X } from "unknown";',
    'const x = import("react");',
    'const x = import.meta.url;',
    'const x = require("react");',
    'const x = require?.("react");',
    'const alias = require;',
    'const React = r\\u0065quire("react");',
  ])('rejects unsupported module syntax before execution: %s', (prefix) => {
    expect(() => compilePageCode(code(`${prefix}\nexport default () => <p/>;`))).toThrow();
  });
  it('accepts native object methods, escaped allowed imports and non-code import text', () => {
    expect(() =>
      compilePageCode(
        code(
          'import { useState } from "\\u0072eact"; const object = {require() { return 1; }, import() { return 2; }}; const text = `import("bad") require("bad")`; const regex = /import\("bad"\)/; export default () => <p>{object.require() + object.import()}</p>;',
        ),
      ),
    ).not.toThrow();
  });
  it('keeps a second execution-time module whitelist and validates the default React component', () => {
    expect(() => evaluatePageCode({ code: 'require("unknown")' })).toThrow('不支持导入模块');
    expect(() => evaluatePageCode(compilePageCode(code('export const value = 1;')))).toThrow(
      'export default',
    );
    expect(() => evaluatePageCode(compilePageCode(code('export default 123;')))).toThrow(
      'export default',
    );
    for (const source of [
      'import {memo} from "react"; export default memo(() => <p/>);',
      'import {forwardRef} from "react"; export default forwardRef((props, ref) => <p ref={ref}/>);',
    ])
      expect(typeof evaluatePageCode(compilePageCode(code(source)))).toBe('object');
  });
});

describe('preview-only React code rendering', () => {
  it('never evaluates a pending module after its runtime has been disposed', async () => {
    const value = runtime();
    const source = code(
      'globalThis.__codeProbe = "late"; export default () => <h1>Should not mount</h1>;',
    );
    const view = render(
      <CodePageCanvas code={source} runtime={value} mode="preview" />,
    );
    value.dispose();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((globalThis as Record<string, unknown>).__codeProbe).toBeUndefined();
    expect(view.container.querySelector('.page-code-host')).toBeNull();
  });
  it('keeps the shared runtime API bridge immutable across default and namespace imports', () => {
    for (const source of [
      'import api from "@dimlu/runtime"; api.useRuntime = "polluted"; export default () => null;',
      'import * as api from "@dimlu/runtime"; api.default.useRuntime = "polluted"; export default () => null;',
    ]) {
      expect(() => evaluatePageCode(compilePageCode(code(source)))).toThrow();
      const read = evaluatePageCode(
        compilePageCode(
          code(
            'import {useRuntime} from "@dimlu/runtime"; export default function Read(){ return typeof useRuntime; }',
          ),
        ),
      ) as () => string;
      expect(read()).toBe('function');
    }
  });
  it('does not evaluate editor placeholders and cleans native Hook effects when returning to edit', async () => {
    const value = runtime();
    const source = code(
      'import {useState, useEffect} from "react"; globalThis.__codeProbe = {mounts:0, cleanups:0}; export default function Page(){const [n,setN]=useState(0);useEffect(()=>{globalThis.__codeProbe.mounts++;return ()=>{globalThis.__codeProbe.cleanups++;}},[]);return <button onClick={()=>setN(n+1)}>Count {n}</button>}',
    );
    const view = render(
      <CodePageCanvas code={source} runtime={value} mode="edit" />,
    );
    expect((globalThis as Record<string, unknown>).__codeProbe).toBeUndefined();
    view.rerender(
      <CodePageCanvas code={source} runtime={value} mode="preview" />,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('.page-code-host')?.shadowRoot?.querySelector('button')
          ?.textContent,
      ).toBe('Count 0'),
    );
    const root = view.container.querySelector('.page-code-host')!.shadowRoot!;
    fireEvent.click(root.querySelector('button')!);
    expect(root.querySelector('button')!.textContent).toBe('Count 1');
    const probe = (globalThis as unknown as { __codeProbe: { mounts: number; cleanups: number } })
      .__codeProbe;
    expect(probe.mounts).toBe(1);
    view.rerender(<CodePageCanvas code={source} runtime={value} mode="edit" />);
    expect(probe.cleanups).toBe(1);
    expect(view.container.querySelector('.page-code-host')).toBeNull();
  });
  it('connects the same Runtime context through ShadowRoot and responds to state changes', async () => {
    const value = runtime();
    const source = code(
      'import {useRuntime, useRuntimeState, useDesignMode} from "@dimlu/runtime";export default function Page({runtime}){const ctx=useRuntime();const n=useRuntimeState("count");return <button onClick={()=>ctx.setState("count",n+1)}>{runtime===ctx ? n : "wrong"}/{String(useDesignMode())}</button>}',
    );
    const view = render(
      <CodePageCanvas code={source} runtime={value} mode="preview" />,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('.page-code-host')?.shadowRoot?.querySelector('button')
          ?.textContent,
      ).toBe('7/false'),
    );
    const root = view.container.querySelector('.page-code-host')!.shadowRoot!;
    expect(root.querySelector('style')!.textContent).toContain('rgb(1, 2, 3)');
    expect(view.container.querySelector('style')).toBeNull();
    fireEvent.click(root.querySelector('button')!);
    expect(value.getState().count).toBe(8);
    expect(root.querySelector('button')!.textContent).toBe('8/false');
    act(() => value.setState('count', 12));
    expect(root.querySelector('button')!.textContent).toBe('12/false');
  });
  it.each([
    'throw new Error("module failed"); export default () => <p/>;',
    'export const x=1;',
    'export default function Page(){throw new Error("render failed")}',
  ])('keeps failures local with a retry action: %s', async (source) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const value = runtime();
    try {
      render(
        <div>
          <h1>Workbench shell</h1>
          <CodePageCanvas code={code(source)} runtime={value} mode="preview" />
        </div>,
      );
      await screen.findByRole('alert');
      expect(screen.getByRole('heading', { name: 'Workbench shell' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '重试代码' })).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('page action code', () => {
  const source = `
export function greet(name) {
  return this.normalize(name);
}
export async function save(payload) {
  this.setState({ title: payload.title });
  return this.greet(payload.title);
}
export function normalize(value) {
  return String(value ?? '').trim();
}
`;
  const setActions = (doc: EditorDocument, actions: ActionCall[]) =>
    doc.setEventActions('one', 'button', 'onClick', actions);
  const addButton = (doc: EditorDocument) => {
    const definition = structuredClone(doc.getSnapshot().plan.schema);
    definition.pages[0].children.push({
      id: 'button',
      component: 'ui.button',
      props: { label: { kind: 'literal', value: '动作按钮' } },
      on: {},
    });
    definition.pages[0].state.push({ id: 'title', type: 'string', initial: '' });
    definition.pages[0].code = undefined;
    definition.dependencies.components['ui.button'] = registry.components['ui.button'].version;
    return new EditorDocument(definition, registry);
  };
  const call = (name: string, payload: Json): ActionCall => ({
    id: `call-${name}`,
    action: pageActionPrefix + name,
    input: { payload: { kind: 'literal', value: payload } },
  });
  it('compiles only named exports, rejects host capabilities, and stores source without running it', () => {
    const schemaWithActions = definition();
    // A throwing body proves saving never executes author code: a valid save means it stayed inert.
    const inertSource = source.replace(
      'return this.normalize(name);',
      "throw new Error('executed at save time');",
    );
    schemaWithActions.pages[0].actionCode = { source: inertSource };
    const doc = new EditorDocument(definition(), registry);
    expect(doc.setPageActionCode('one', { source: inertSource })).toBe(true);
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode?.source).toContain('greet');
    const plan = compileApplication(doc.getSnapshot().plan.schema, registry);
    expect(Object.keys(plan.pages.get('one')!.actions).sort()).toEqual([
      'page.action.greet',
      'page.action.normalize',
      'page.action.save',
    ]);
    doc.undo();
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode).toBeUndefined();
    doc.redo();
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode?.source).toContain('greet');
    for (const invalid of [
      'const x = 1;',
      'export default function x() {}',
      'export const x = () => 1;',
      'export function x() {} export function x() {}',
      'export function setState() {}',
      'export function x() { return window.location.href; }',
      'export function x() { return eval("1"); }',
      'export function x(p = import("x")) {}',
    ]) {
      const bad = structuredClone(definition());
      bad.pages[0].actionCode = { source: invalid };
      expect(() => compileApplication(bad, registry)).toThrow();
    }
  });
  it('runs page actions from component events with this.method(), state and scoped page APIs', async () => {
    const doc = addButton(new EditorDocument(definition(), registry));
    doc.setPageActionCode('one', { source });
    setActions(doc, [call('save', { title: '  宜搭  ' })]);
    const plan = compileApplication(doc.getSnapshot().plan.schema, registry);
    const value = new PageRuntime(plan, 'one');
    try {
      expect(
        await value.run(plan.pages.get('one')!.children[0].on!.onClick, {}, undefined, 'test'),
      ).toBe(true);
      expect(value.getState().title).toBe('  宜搭  ');
      const direct = call('greet', '  hi  ');
      const result = await value.run(
        [{ schema: direct, input: { payload: compileValue(direct.input.payload) } }],
        {},
        undefined,
        'call',
      );
      expect(result).toBe(true);
    } finally {
      value.dispose();
    }
  });
  it('auto-hooks exported didMount/willUnmount into the page lifecycle when absent', async () => {
    const lifecycleSource = `
export function didMount() {
  this.setState({ mounted: 'enter' });
}
export function willUnmount() {
  this.setState({ mounted: 'leave' });
}
`;
    const schema = definition();
    schema.pages[0].state.push({ id: 'mounted', type: 'string', initial: '' });
    const doc = addButton(new EditorDocument(schema, registry));
    doc.setPageActionCode('one', { source: lifecycleSource });
    const plan = compileApplication(doc.getSnapshot().plan.schema, registry);
    const page = plan.pages.get('one')!;
    expect(page.onEnter.map((call) => call.schema.action)).toEqual(['page.action.didMount']);
    expect(page.onLeave.map((call) => call.schema.action)).toEqual(['page.action.willUnmount']);
    const value = new PageRuntime(plan, 'one');
    try {
      await value.enter();
      expect(value.getState().mounted).toBe('enter');
      await value.leave();
      expect(value.getState().mounted).toBe('leave');
    } finally {
      value.dispose();
    }
    // 显式定义 onEnter 时优先，不重复执行 didMount。
    const explicit = definition();
    explicit.pages[0].state.push({ id: 'mounted', type: 'string', initial: '' });
    explicit.pages[0].onEnter = [
      { id: 'explicit-enter', action: 'page.action.didMount', input: {} },
    ];
    explicit.pages[0].actionCode = { source: lifecycleSource };
    const explicitPlan = compileApplication(explicit, registry);
    expect(explicitPlan.pages.get('one')!.onEnter.map((call) => call.schema.action)).toEqual([
      'page.action.didMount',
    ]);
  });
  it('exposes Yida-style utils, router and dataSourceMap through page actions', async () => {
    const apiSource = `
export async function notifyAndRoute(payload) {
  this.utils.toast(payload.message);
  this.utils.router.push('two');
  return typeof this.dataSourceMap.any.load === 'function' ? 'ok' : 'missing';
}
`;
    const schema = definition();
    schema.pages.push({ id: 'two', title: 'Two', state: [], children: [] });
    const doc = addButton(new EditorDocument(schema, registry));
    doc.setPageActionCode('one', { source: apiSource });
    const plan = compileApplication(doc.getSnapshot().plan.schema, registry);
    const value = new PageRuntime(plan, 'one');
    const effects: { type: string; data: Record<string, Json> }[] = [];
    const unsubscribe = value.subscribeEffects((effect) => effects.push(effect));
    try {
      const actionCall = call('notifyAndRoute', { message: '已保存' });
      const ok = await value.run(
        [{ schema: actionCall, input: { payload: compileValue(actionCall.input.payload) } }],
        {},
        undefined,
        'api-call',
      );
      expect(ok).toBe(true);
      expect(effects).toEqual(
        expect.arrayContaining([
          { type: 'ui.notify', data: { title: '已保存', tone: 'info' } },
          { type: 'app.navigate', data: { pageId: 'two', replace: false } },
        ]),
      );
    } finally {
      unsubscribe();
      value.dispose();
    }
  });
  it('invokes application methods from page actions through this.utils.invokeMethod', async () => {
    const schema = definition();
    schema.methods = [
      {
        id: 'trimTitle',
        title: '裁剪标题',
        inputType: 'json',
        outputType: 'string',
        source: "return String(input.payload?.title ?? '').trim();",
      },
    ];
    const invokeSource = `
export async function viaAppMethod(payload) {
  return this.utils.invokeMethod('trimTitle', payload);
}
export async function viaMissing() {
  return this.utils.invokeMethod('missing', {});
}
`;
    const doc = addButton(new EditorDocument(schema, registry));
    doc.setPageActionCode('one', { source: invokeSource });
    const plan = compileApplication(doc.getSnapshot().plan.schema, registry);
    expect(Object.keys(plan.registry.actions)).toContain('app.method.trimTitle');
    const value = new PageRuntime(plan, 'one');
    try {
      const actionCall = call('viaAppMethod', { title: '  应用方法  ' });
      const ok = await value.run(
        [{ schema: actionCall, input: { payload: compileValue(actionCall.input.payload) } }],
        {},
        undefined,
        'app-method',
      );
      expect(ok).toBe(true);
      const missingCall = call('viaMissing', {});
      await expect(
        value.run(
          [{ schema: missingCall, input: { payload: compileValue(missingCall.input.payload) } }],
          {},
          undefined,
          'app-method-missing',
          undefined,
          { throwOnError: true },
        ),
      ).rejects.toThrow('未知应用方法');
    } finally {
      value.dispose();
    }
  });
  it('keeps page actions local and rejects stale or invalid action calls', () => {
    const first = addButton(new EditorDocument(definition(), registry));
    first.setPageActionCode('one', { source });
    expect(() => setActions(first, [call('missing', {})])).toThrow();
    expect(setActions(first, [call('save', { title: 'x' })])).toBe(true);
    const second = structuredClone(first.getSnapshot().plan.schema);
    second.pages[0].actionCode = { source: 'export function other() { return null; }' };
    expect(() => compileApplication(second, registry)).toThrow(/当前页没有动作函数/);
    // A second page that defines its own `save` may reference it independently.
    const third = structuredClone(first.getSnapshot().plan.schema);
    const copy = structuredClone(first.getSnapshot().plan.schema.pages[0]);
    copy.id = 'two';
    third.pages[1] = copy;
    expect(() => compileApplication(third, registry)).not.toThrow();
  });
});
