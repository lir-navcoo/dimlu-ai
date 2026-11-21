import { describe, expect, it } from 'vitest';
import type { Json } from '../packages/schema/types';
import type { ActionContext } from '../packages/runtime/registry';
import {
  handleWorkerMessage,
  type HostToWorkerMessage,
  type WorkerRunState,
  type WorkerToHostMessage,
} from '../packages/runtime/method-worker-core';
import { MethodWorkerHost, isWorkerRealmSupported } from '../packages/runtime/method-worker-host';
import { compileApplicationMethod } from '../packages/runtime/application-methods';

/**
 * Drives the real worker-side core against the real host bridge over simulated message
 * delivery, so the full protocol (run, capability RPC, abort, errors) is exercised
 * without a runtime Worker, which jsdom does not provide.
 */
class FakeWorker {
  onmessage: ((event: { data: WorkerToHostMessage }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;
  readonly runs: WorkerRunState = new Map();

  postMessage(data: HostToWorkerMessage): void {
    if (this.terminated) return;
    setTimeout(() => {
      if (this.terminated) return;
      handleWorkerMessage(data, (message) => {
        setTimeout(() => {
          if (!this.terminated) this.onmessage?.({ data: message });
        }, 0);
      }, this.runs);
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
    this.runs.clear();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

function recordingContext(
  overrides: Partial<ActionContext> = {},
): ActionContext & { state: Record<string, Json>; effects: unknown[] } {
  const state: Record<string, Json> = {};
  const effects: unknown[] = [];
  const base: ActionContext = {
    signal: new AbortController().signal,
    getState: () => state,
    setState: (id, value) => {
      state[id] = structuredClone(value as Json);
    },
    setFormValues: () => {},
    resetForm: () => {},
    submitForm: async () => {},
    executeDataSource: async () => null,
    emitEffect: (effect) => {
      effects.push(effect);
    },
    ...overrides,
  };
  return Object.assign(base, { state, effects }) as ActionContext & {
    state: Record<string, Json>;
    effects: unknown[];
  };
}

describe('method worker realm', () => {
  it('runs a method and returns its JSON result through the bridge', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    const result = await host.run(
      { source: 'return input.payload.label.toUpperCase();', input: { payload: { label: 'ok' } }, state: {} },
      { signal: new AbortController().signal, context: recordingContext() },
    );
    expect(result).toBe('OK');
    host.dispose();
  });

  it('bridges setState to the host and keeps getState optimistic', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    const context = recordingContext();
    const result = await host.run(
      {
        source:
          "context.setState('a', input.payload.v); const seen = context.getState(); return [seen.a, typeof context.getState];",
        input: { payload: { v: 42 } },
        state: { start: 'x' },
      },
      { signal: new AbortController().signal, context },
    );
    // getState is a function (sync contract) and sees both the snapshot and the local write.
    expect(result).toEqual([42, 'function']);
    await flush();
    expect(context.state).toEqual({ a: 42 });
    host.dispose();
  });

  it('propagates host capability errors to the run, including fire-and-forget calls', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    const context = recordingContext({
      emitEffect: () => {
        throw new Error('未知目标页面 other');
      },
    });
    await expect(
      host.run(
        { source: "context.emitEffect({ type: 'app.navigate', data: { pageId: 'other' } }); return 'done';", input: {}, state: {} },
        { signal: new AbortController().signal, context },
      ),
    ).rejects.toThrow('未知目标页面 other');
    host.dispose();
  });

  it('waits for pending capability calls before settling the result', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    const applied: string[] = [];
    const context = recordingContext({
      setState: (id) => {
        applied.push(id);
      },
    });
    const result = await host.run(
      {
        source: "context.setState('late', 1); return 'ok';",
        input: {},
        state: {},
      },
      { signal: new AbortController().signal, context },
    );
    expect(result).toBe('ok');
    await flush();
    expect(applied).toEqual(['late']);
    host.dispose();
  });

  it('rejects with AbortError and terminates the realm when the signal aborts', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    const controller = new AbortController();
    // A capability call that never answers, so the run is still pending at abort time.
    const context = recordingContext({
      executeDataSource: () => new Promise(() => {}),
    });
    const pending = host.run(
      { source: "await context.executeDataSource('slow'); return 'unreachable';", input: {}, state: {} },
      { signal: controller.signal, context },
    );
    await flush();
    const expectation = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await expectation;
    expect(worker.terminated).toBe(true);
    // The next run lazily respawns a fresh realm.
    const second = new FakeWorker();
    const host2 = new MethodWorkerHost(() => second);
    const result = await host2.run(
      { source: 'return 7;', input: {}, state: {} },
      { signal: new AbortController().signal, context: recordingContext() },
    );
    expect(result).toBe(7);
    host2.dispose();
    host.dispose();
  });

  it('rejects an already aborted signal without spawning a realm', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    const controller = new AbortController();
    controller.abort();
    await expect(
      host.run(
        { source: 'return 1;', input: {}, state: {} },
        { signal: controller.signal, context: recordingContext() },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker.terminated).toBe(false);
  });

  it('rejects pending runs when the realm reports an uncaught error', async () => {
    const worker = new FakeWorker();
    const host = new MethodWorkerHost(() => worker);
    // A pending capability call keeps the run alive; a real realm crash is simulated
    // by firing onerror (an in-thread infinite loop would block the test process).
    const context = recordingContext({
      executeDataSource: () => new Promise(() => {}),
    });
    const pending = host.run(
      { source: "await context.executeDataSource('slow'); return 'unreachable';", input: {}, state: {} },
      { signal: new AbortController().signal, context },
    );
    await flush();
    const expectation = expect(pending).rejects.toThrow('未捕获错误');
    worker.onerror?.(new Error('boom'));
    await expectation;
    host.dispose();
  });

  it('routes compiled methods through the worker realm when Worker exists', async () => {
    const previous = globalThis.Worker;
    let spawned = 0;
    class RoutedWorker extends FakeWorker {
      constructor() {
        super();
        spawned += 1;
      }
    }
    (globalThis as { Worker?: unknown }).Worker = RoutedWorker;
    try {
      const method = { id: 'via-worker', title: 'V', source: "context.setState('n', input.payload); return 'routed';" };
      const contract = compileApplicationMethod(method);
      const context = recordingContext();
      const result = await contract.execute({ payload: 3 }, context);
      expect(result).toBe('routed');
      expect(spawned).toBeGreaterThan(0);
      await flush();
      expect(context.state).toEqual({ n: 3 });
    } finally {
      (globalThis as { Worker?: unknown }).Worker = previous;
    }
  });

  it('keeps the main-thread fallback when Worker is unavailable', async () => {
    const previous = globalThis.Worker;
    (globalThis as { Worker?: unknown }).Worker = undefined;
    try {
      const contract = compileApplicationMethod({
        id: 'fallback',
        title: 'F',
        source: "context.setState('m', 1); return input.payload.x;",
      });
      const context = recordingContext();
      const result = await contract.execute({ payload: { x: 'sync' } }, context);
      expect(result).toBe('sync');
      expect(context.state).toEqual({ m: 1 });
    } finally {
      (globalThis as { Worker?: unknown }).Worker = previous;
    }
  });
});
