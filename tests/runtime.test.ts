import { describe, expect, it, vi } from 'vitest';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';
import { compileApplication, PageRuntime, type PlannedAction } from '../packages/runtime/engine';
import { compileValue } from '../packages/runtime/expression';
import type { Value } from '../packages/schema/types';
const exp = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const literal = (value: any): Value => ({ kind: 'literal', value });
const action = (
  id: string,
  name: string,
  input: Record<string, Value> = {},
  resultTo?: string,
): PlannedAction => ({
  schema: { id, action: name, input, resultTo },
  input: Object.fromEntries(Object.entries(input).map(([k, v]) => [k, compileValue(v)])),
});

describe('expression semantics', () => {
  it('uses ordinary JS expression syntax and separates reusable parsing from per-instance values', () => {
    const value = compileValue(exp("Math.round(state.price * scope.row.quantity) + ' 元'"));
    expect(value.evaluate({ state: { price: 2.5 }, scope: { row: { quantity: 3 } } })).toBe('8 元');
    expect(value.evaluate({ state: { price: 10 }, scope: { row: { quantity: 2 } } })).toBe('20 元');
    expect(value.dependencies).toEqual(['price']);
  });
  it('short circuits and forbids mutations, global access and arbitrary calls', () => {
    expect(
      compileValue(exp('false && state.missing.value')).evaluate({ state: {}, scope: {} }),
    ).toBe(false);
    for (const source of [
      'state.count = 1',
      'window.location',
      'state.name.trim()',
      'state["constructor"]',
      'Math.random()',
    ])
      expect(() => compileValue(exp(source))).toThrow();
  });
});

// State/action tests use a dedicated fixture so form fields stay out of page state.
const stateApplication = structuredClone(exampleApplication);
stateApplication.pages[0] = {
  id: 'purchase',
  title: 'State fixture',
  state: [
    { id: 'name', type: 'string', initial: '' },
    { id: 'quantity', type: 'number', initial: 2 },
    { id: 'price', type: 'number', initial: 399 },
    { id: 'result', type: 'string', initial: '' },
  ],
  children: [],
};
describe('page runtime', () => {
  it('isolates instances, validates state writes and only notifies dependent subscriptions', () => {
    const plan = compileApplication(stateApplication, registry);
    const first = new PageRuntime(plan, 'purchase');
    const second = new PageRuntime(plan, 'purchase');
    const name = vi.fn();
    const price = vi.fn();
    first.subscribeState(['name'], name);
    first.subscribeState(['price'], price);
    first.setState('name', '显示器');
    expect(first.getState().name).toBe('显示器');
    expect(second.getState().name).toBe('');
    expect(name).toHaveBeenCalledOnce();
    expect(price).not.toHaveBeenCalled();
    expect(() => first.setState('quantity', '2')).toThrow();
    expect(() => first.setState('quantity', NaN)).toThrow();
    first.dispose();
    second.dispose();
  });
  it('executes sequentially, exposes prior updates and stops on the first failure', async () => {
    const rt = new PageRuntime(compileApplication(stateApplication, registry), 'purchase');
    const result = await rt.run(
      [
        action('first', 'state.set', { stateId: literal('quantity'), value: literal(5) }),
        action('second', 'state.set', {
          stateId: literal('price'),
          value: exp('state.quantity * 10'),
        }),
        action('invalid', 'state.set', { stateId: literal('quantity'), value: literal('bad') }),
        action('never', 'state.set', {
          stateId: literal('name'),
          value: literal('should not run'),
        }),
      ],
      {},
      undefined,
      'test',
    );
    expect(result).toBe(false);
    expect(rt.getState().price).toBe(50);
    expect(rt.getState().name).toBe('');
    expect(rt.getRecords().at(-1)?.kind).toBe('action.error');
    rt.dispose();
  });
  it('cancels superseded events and ignores late writes even when an adapter ignores AbortSignal', async () => {
    const resolve: ((value: string) => void)[] = [];
    const testRegistry = {
      ...registry,
      actions: {
        ...registry.actions,
        slow: {
          version: '1.0.0',
          input: {},
          output: 'string' as const,
          execute: () => new Promise<string>((r) => resolve.push(r)),
        },
      },
    };
    const app = structuredClone(stateApplication);
    app.dependencies.actions.slow = '1.0.0';
    const rt = new PageRuntime(compileApplication(app, testRegistry), 'purchase');
    const call = [action('slow', 'slow', {}, 'result')];
    const old = rt.run(call, {}, undefined, 'same');
    const next = rt.run(call, {}, undefined, 'same');
    resolve[1]('new');
    await next;
    resolve[0]('old');
    await old;
    expect(rt.getState().result).toBe('new');
    expect(rt.getPending()).toBe(0);
    rt.dispose();
  });
  it('protects shared result targets across different event lanes and page disposal', async () => {
    const resolve: ((value: string) => void)[] = [];
    const testRegistry = {
      ...registry,
      actions: {
        ...registry.actions,
        slow: {
          version: '1.0.0',
          input: {},
          output: 'string' as const,
          execute: () => new Promise<string>((r) => resolve.push(r)),
        },
      },
    };
    const app = structuredClone(stateApplication);
    app.dependencies.actions.slow = '1.0.0';
    const rt = new PageRuntime(compileApplication(app, testRegistry), 'purchase');
    const call = [action('slow', 'slow', {}, 'result')];
    const old = rt.run(call, {}, undefined, 'enter');
    const next = rt.run(call, {}, undefined, 'search');
    resolve[1]('latest');
    await next;
    resolve[0]('stale');
    await old;
    expect(rt.getState().result).toBe('latest');
    const disposed = rt.run(call, {}, undefined, 'final');
    rt.dispose();
    resolve[2]('too late');
    await disposed;
    expect(rt.getState().result).toBe('latest');
    expect(rt.getPending()).toBe(0);
  });
});
