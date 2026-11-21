import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import type { ApplicationSchema, PageCode } from '../packages/schema/types';
import { registry } from '../src/materials';
import { compilePageCode } from '../src/code/compiler';
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
      <CodePageCanvas code={source} runtime={value} mode="preview" openCode={() => {}} />,
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
      <CodePageCanvas code={source} runtime={value} mode="edit" openCode={() => {}} />,
    );
    expect((globalThis as Record<string, unknown>).__codeProbe).toBeUndefined();
    view.rerender(
      <CodePageCanvas code={source} runtime={value} mode="preview" openCode={() => {}} />,
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
    view.rerender(<CodePageCanvas code={source} runtime={value} mode="edit" openCode={() => {}} />);
    expect(probe.cleanups).toBe(1);
    expect(view.container.querySelector('.page-code-host')).toBeNull();
  });
  it('connects the same Runtime context through ShadowRoot and responds to state changes', async () => {
    const value = runtime();
    const source = code(
      'import {useRuntime, useRuntimeState, useDesignMode} from "@dimlu/runtime";export default function Page({runtime}){const ctx=useRuntime();const n=useRuntimeState("count");return <button onClick={()=>ctx.setState("count",n+1)}>{runtime===ctx ? n : "wrong"}/{String(useDesignMode())}</button>}',
    );
    const view = render(
      <CodePageCanvas code={source} runtime={value} mode="preview" openCode={() => {}} />,
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
          <CodePageCanvas code={code(source)} runtime={value} mode="preview" openCode={() => {}} />
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
