import { assertMethodCapabilities, shadowedCapabilityNames } from './method-sandbox';
import type { Json } from '../schema/types';

/**
 * Inside the realm every capability call is awaitable (fire-and-forget still works
 * because messages are ordered); `getState` stays synchronous via the snapshot and
 * optimistic local writes, so method sources written against the main-thread
 * ActionContext contract behave identically here.
 */
type MethodRealmContext = {
  signal: AbortSignal;
  getState(): Record<string, Json>;
  setState(id: string, value: unknown): Promise<void>;
  setFormValues(formId: string, values: unknown): Promise<void>;
  resetForm(formId: string): Promise<void>;
  submitForm(formId: string): Promise<unknown>;
  executeDataSource(sourceId: string, input?: Record<string, Json>): Promise<unknown>;
  emitEffect(effect: { type: string; data: Record<string, Json> }): Promise<void>;
};

/**
 * Worker-side implementation of the application-method realm. Messages in, messages
 * out; the only way back to the host realm is the capability RPC, which the host
 * maps onto a real ActionContext. Compiled methods and the run registry live here,
 * so one worker serves many runs concurrently and keeps its compile cache warm.
 */

export interface MethodRunRequest {
  kind: 'run';
  runId: number;
  source: string;
  input: Record<string, Json>;
  /** Snapshot of engine state taken when the run was launched. */
  state: Record<string, Json>;
}

export interface MethodContextReply {
  kind: 'ctx-reply';
  runId: number;
  callId: number;
  ok: boolean;
  value?: unknown;
  message?: string;
}

export type HostToWorkerMessage = MethodRunRequest | MethodContextReply;

export type WorkerToHostMessage =
  | { kind: 'result'; runId: number; ok: true; result: unknown }
  | { kind: 'result'; runId: number; ok: false; name?: string; message: string }
  | { kind: 'ctx-call'; runId: number; callId: number; method: string; args: readonly unknown[] };

interface PendingCall {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

interface ActiveRun {
  controller: AbortController;
  calls: Map<number, PendingCall>;
  closed: boolean;
}

/** Per-worker run registry, created once in the worker entry and shared across messages. */
export type WorkerRunState = Map<number, ActiveRun>;

const compiledMethods = new Map<
  string,
  (input: Record<string, Json>, context: MethodRealmContext) => Promise<unknown>
>();

function compileMethod(source: string) {
  const cached = compiledMethods.get(source);
  if (cached) return cached;
  // Defense in depth: the host gate already ran; repeat it inside the realm so a
  // smuggled source still cannot leave the capability box.
  assertMethodCapabilities(source);
  const shadow = shadowedCapabilityNames.map((name) => `const ${name} = undefined;`).join('\n');
  const compiled = new Function(
    'input',
    'context',
    `"use strict";\n${shadow}\nreturn (async () => {\n${source}\n})();`,
  ) as (input: Record<string, Json>, context: MethodRealmContext) => Promise<unknown>;
  compiledMethods.set(source, compiled);
  return compiled;
}

/** Methods read state through this cache; writes apply locally before the RPC so
 * `setState` followed by `getState` behaves exactly like the main-thread contract. */
function applyLocal(state: Record<string, Json>, id: string, value: unknown): void {
  try {
    state[id] = structuredClone(value as Json);
  } catch {
    // Non-cloneable values can only live in the local cache; the host contract
    // rejects them when the RPC arrives.
    state[id] = value as Json;
  }
}

export function handleWorkerMessage(
  message: HostToWorkerMessage,
  post: (message: WorkerToHostMessage) => void,
  runs: Map<number, ActiveRun>,
): void {
  if (message.kind === 'ctx-reply') {
    const run = runs.get(message.runId);
    const call = run?.calls.get(message.callId);
    if (!run || !call) return;
    run.calls.delete(message.callId);
    if (message.ok) call.resolve(message.value);
    else call.reject(new Error(message.message ?? '宿主能力调用失败'));
    return;
  }

  const { runId, source, input } = message;
  const run: ActiveRun = { controller: new AbortController(), calls: new Map(), closed: false };
  runs.set(runId, run);
  const state: Record<string, Json> = structuredClone(message.state);
  let nextCallId = 1;

  const rpc = (method: string, args: readonly unknown[]): Promise<unknown> => {
    if (run.closed) return Promise.reject(new Error('方法执行已结束'));
    const callId = nextCallId++;
    let settle!: { resolve: (value: unknown) => void; reject: (error: unknown) => void };
    const promise = new Promise<unknown>((resolve, reject) => {
      settle = { resolve, reject };
    });
    run.calls.set(callId, { promise, ...settle });
    post({ kind: 'ctx-call', runId, callId, method, args });
    return promise;
  };

  const context: MethodRealmContext = {
    signal: run.controller.signal,
    getState: () => state,
    setState: (id, value) => {
      applyLocal(state, id, value);
      return rpc('setState', [id, value]) as Promise<void>;
    },
    setFormValues: (formId, values) => rpc('setFormValues', [formId, values]) as Promise<void>,
    resetForm: (formId) => rpc('resetForm', [formId]) as Promise<void>,
    submitForm: (formId) => rpc('submitForm', [formId]),
    executeDataSource: (sourceId, sourceInput) =>
      rpc('executeDataSource', [sourceId, sourceInput]),
    emitEffect: (effect) => rpc('emitEffect', [effect]) as Promise<void>,
  };

  void (async () => {
    try {
      const result = await compileMethod(source)(input, context);
      // Settle the run only after every capability call has settled, so fire-and-forget
      // writes/errors are never lost between the method body and the result message.
      const settled = await Promise.allSettled(
        [...run.calls.values()].map((call) => call.promise),
      );
      run.closed = true;
      const failure = settled.find((entry) => entry.status === 'rejected');
      if (failure && failure.status === 'rejected') {
        const error = failure.reason as { name?: string; message?: string };
        post({
          kind: 'result',
          runId,
          ok: false,
          name: error?.name,
          message: error?.message ?? String(failure.reason),
        });
        return;
      }
      post({ kind: 'result', runId, ok: true, result });
    } catch (error) {
      run.closed = true;
      const named = error as { name?: string; message?: string };
      post({
        kind: 'result',
        runId,
        ok: false,
        name: named?.name,
        message: named?.message ?? String(error),
      });
    }
  })();
}
