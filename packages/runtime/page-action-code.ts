import { parse } from 'sucrase/dist/parser/index';
import { TokenType as tt } from 'sucrase/dist/parser/tokenizer/types';
import { assertMethodCapabilities, shadowedCapabilityNames } from './method-sandbox';
import { forbiddenObjectKeySet, isJson, type Json, type PageActionCode } from '../schema/types';
import { deepFreeze } from '../schema/deep-freeze';

export const pageActionPrefix = 'page.action.';
export const pageActionId = (name: string) => pageActionPrefix + name;
export const pageActionName = (id: string) => id.slice(pageActionPrefix.length);

const reserved = new Set([
  ...forbiddenObjectKeySet,
  'state',
  'setState',
  'then',
  '$',
  'utils',
  'dataSourceMap',
]);
const declarationsOnly = '页面动作仅支持顶层 export function 或 export async function 声明。';
const shadow = shadowedCapabilityNames.map((name) => `const ${name} = undefined;`).join('\n');

type PageAction = (...args: unknown[]) => unknown;

/** Read named exports without evaluating any author code, including default parameters. */
export function compilePageActionCode({ source }: PageActionCode) {
  const { tokens } = parse(source, false, false, false);
  assertMethodCapabilities(source);
  const names: string[] = [];
  const parts: string[] = [];
  const type = (index: number) => tokens[index]?.type;
  const text = (index: number) => source.slice(tokens[index].start, tokens[index].end);
  const endOf = (start: number, opening: number, closing: number) => {
    let depth = 1;
    for (let i = start + 1; i < tokens.length; i++) {
      const token = type(i);
      if (token === opening || (opening === tt.braceL && token === tt.dollarBraceL)) depth++;
      if (token === closing && --depth === 0) return i;
    }
    throw new Error(declarationsOnly);
  };
  let i = 0;
  while (type(i) !== tt.eof && i < tokens.length) {
    if (type(i) === tt.semi) {
      i++;
      continue;
    }
    if (type(i++) !== tt._export) throw new Error(declarationsOnly);
    const start = i;
    if (type(i) === tt._async || (type(i) === tt.name && text(i) === 'async')) i++;
    if (type(i++) !== tt._function || type(i) !== tt.name) throw new Error(declarationsOnly);
    const name = text(i++);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || reserved.has(name))
      throw new Error(`页面动作函数名不可用：${name}`);
    if (names.includes(name)) throw new Error(`页面动作函数重复：${name}`);
    if (type(i) !== tt.parenL) throw new Error(declarationsOnly);
    i = endOf(i, tt.parenL, tt.parenR) + 1;
    if (type(i) !== tt.braceL) throw new Error(declarationsOnly);
    i = endOf(i, tt.braceL, tt.braceR);
    names.push(name);
    parts.push(source.slice(tokens[start].start, tokens[i++].end));
  }
  const body = `"use strict";\n${shadow}\n${parts.join('\n')}\nreturn {${names.join(',')}};`;
  // Construction checks strict JS syntax, but never calls the resulting factory.
  const instantiate = new Function(body) as () => Record<string, PageAction>;
  return { names, instantiate };
}

export interface PageActionChunk {
  name: string;
  /** Full `export (async) function name() {...}` text of this action. */
  code: string;
  /** Character range inside `source` so editors can rewrite a single action. */
  start: number;
  end: number;
}

/** Split a saved action source into per-action chunks, mirroring the compiler's rules. */
export function splitPageActionCode(source: string): PageActionChunk[] {
  const { tokens } = parse(source, false, false, false);
  const chunks: PageActionChunk[] = [];
  const type = (index: number) => tokens[index]?.type;
  const text = (index: number) => source.slice(tokens[index].start, tokens[index].end);
  const endOf = (start: number, opening: number, closing: number) => {
    let depth = 1;
    for (let i = start + 1; i < tokens.length; i++) {
      const token = type(i);
      if (token === opening || (opening === tt.braceL && token === tt.dollarBraceL)) depth++;
      if (token === closing && --depth === 0) return i;
    }
    throw new Error(declarationsOnly);
  };
  let i = 0;
  while (type(i) !== tt.eof && i < tokens.length) {
    if (type(i) === tt.semi) {
      i++;
      continue;
    }
    if (type(i++) !== tt._export) throw new Error(declarationsOnly);
    const exportAt = i - 1;
    if (type(i) === tt._async || (type(i) === tt.name && text(i) === 'async')) i++;
    if (type(i++) !== tt._function || type(i) !== tt.name) throw new Error(declarationsOnly);
    const name = text(i++);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || reserved.has(name))
      throw new Error(`页面动作函数名不可用：${name}`);
    if (type(i) !== tt.parenL) throw new Error(declarationsOnly);
    i = endOf(i, tt.parenL, tt.parenR) + 1;
    if (type(i) !== tt.braceL) throw new Error(declarationsOnly);
    i = endOf(i, tt.braceL, tt.braceR);
    chunks.push({ name, start: tokens[exportAt].start, end: tokens[i++].end, code: '' });
  }
  for (const chunk of chunks) chunk.code = source.slice(chunk.start, chunk.end);
  return chunks;
}

/**
 * Capability bridge for a page action's `this`. Both realms (Worker RPC and the
 * main-thread fallback) implement this shape, so the JS-API surface is identical:
 * `this.state` (read-only snapshot), `this.setState(patch)`, `this.$(id).getValue()/.setValue()`.
 */
export interface PageActionHost {
  getState(): Record<string, Json>;
  setState(patch: Record<string, Json>): unknown;
  getValue(nodeId: string): unknown;
  setValue(nodeId: string, value: unknown): unknown;
  /** Emit a host effect: `ui.notify` (toast) or `app.navigate` (route). */
  emitEffect(effect: { type: string; data: Record<string, Json> }): unknown;
  /** Load a page data source by id. */
  loadDataSource(sourceId: string, input?: Record<string, Json>): Promise<Json>;
  /** Invoke a compiled application method (`app.method.<id>`) from page action code. */
  invokeApplication(methodId: string, payload?: unknown): Promise<Json>;
  /** Field operations exposed through `this.$(id)` / `this.utils.form`. */
  validateField(nodeId: string): unknown;
  resetField(nodeId: string): unknown;
  validateForm(formId: string): unknown;
  /** Track fire-and-forget capability calls so the caller can await them. */
  track?(promise: Promise<unknown>): void;
  applyLocal?(state: Record<string, Json>, id: string, value: unknown): void;
}

/** Build the Yida-style `this` scope and invoke a named exported page action. */
export async function invokePageAction(
  functions: Record<string, PageAction>,
  name: string,
  payload: unknown,
  host: PageActionHost,
): Promise<unknown> {
  if (!Object.hasOwn(functions, name)) throw new Error(`未知页面动作 ${name}`);
  const state = { ...host.getState() };
  const applyLocal =
    host.applyLocal ??
    ((target: Record<string, Json>, id: string, value: unknown) => {
      target[id] = structuredClone(value as Json);
    });
  const call = (method: keyof PageActionHost, args: readonly unknown[]) => {
    let result: unknown;
    switch (method) {
      case 'setState':
        result = host.setState(args[0] as Record<string, Json>);
        break;
      case 'getValue':
        result = host.getValue(args[0] as string);
        break;
      case 'setValue':
        result = host.setValue(args[0] as string, args[1]);
        break;
      case 'emitEffect':
        result = host.emitEffect(args[0] as { type: string; data: Record<string, Json> });
        break;
      case 'loadDataSource':
        result = host.loadDataSource(
          args[0] as string,
          args[1] as Record<string, Json> | undefined,
        );
        break;
      case 'invokeApplication':
        result = host.invokeApplication(args[0] as string, args[1] as Json | undefined);
        break;
      case 'validateField':
        result = host.validateField(args[0] as string);
        break;
      case 'resetField':
        result = host.resetField(args[0] as string);
        break;
      case 'validateForm':
        result = host.validateForm(args[0] as string);
        break;
      default:
        throw new Error(`页面动作调用了未知能力 ${String(method)}`);
    }
    if (result instanceof Promise) {
      host.track?.(result);
      return result;
    }
    return Promise.resolve(result);
  };
  const page = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(page, 'state', { get: () => deepFreeze(structuredClone(state)) });
  page.setState = (patch: unknown) => {
    if (!isJson(patch) || !patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new Error('this.setState 需要 JSON 对象');
    for (const [id, value] of Object.entries(patch)) {
      if (!Object.hasOwn(state, id)) throw new Error(`未知状态 ${id}`);
      applyLocal(state, id, value);
    }
    return call('setState', [patch]);
  };
  page.$ = (id: string) =>
    Object.freeze({
      getValue: () => call('getValue', [id]),
      setValue: (value: unknown) => call('setValue', [id, value]),
      get: (prop: string) =>
        prop === 'value' ? call('getValue', [id]) : Promise.resolve(undefined),
      set: (prop: string, value: unknown) =>
        prop === 'value' ? call('setValue', [id, value]) : Promise.resolve(undefined),
      validate: () => call('validateField', [id]),
      reset: () => call('resetField', [id]),
    });
  // Yida-style public utils: toast, dialog (degrades to toast) and router.
  const utils = Object.freeze({
    toast: (content: unknown) => utilsNotify(String(content ?? ''), 'info'),
    dialog: (content: unknown) => utilsNotify(String(content ?? ''), 'info'),
    notify: (title: unknown, tone: unknown) =>
      utilsNotify(String(title ?? ''), typeof tone === 'string' ? tone : 'info'),
    router: Object.freeze({
      push: (pageId: unknown) => navigate(pageId, false),
      replace: (pageId: unknown) => navigate(pageId, true),
    }),
    form: Object.freeze({
      validate: (formId: string) => call('validateForm', [formId]),
    }),
    invokeMethod: (methodId: unknown, payload: unknown) => {
      if (typeof methodId !== 'string' || !methodId)
        throw new Error('应用方法 ID 必须为非空文本');
      return call('invokeApplication', [methodId, payload]);
    },
  });
  function utilsNotify(title: string, tone: string) {
    return call('emitEffect', [{ type: 'ui.notify', data: { title, tone } }]);
  }
  function navigate(pageId: unknown, replace: boolean) {
    if (typeof pageId !== 'string' || !pageId) throw new Error('目标页面 ID 必须为非空文本');
    return call('emitEffect', [{ type: 'app.navigate', data: { pageId, replace } }]);
  }
  page.utils = utils;
  page.dataSourceMap = new Proxy(Object.create(null) as Record<string, unknown>, {
    get: (_target, sourceId) => {
      if (typeof sourceId !== 'string') return undefined;
      return Object.freeze({
        load: (params?: Record<string, Json>) => call('loadDataSource', [sourceId, params]),
      });
    },
  });
  for (const [fnName, fn] of Object.entries(functions)) page[fnName] = fn.bind(page);
  Object.freeze(page);
  let result = await functions[name].apply(page, payload === undefined ? [] : [payload]);
  if (result === undefined) result = null;
  if (!isJson(result)) throw new Error('页面动作必须返回 JSON 值');
  return result;
}
