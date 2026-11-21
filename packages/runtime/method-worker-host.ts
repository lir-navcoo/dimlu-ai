import type { ActionContext } from './registry';
import type { Json } from '../schema/types';
import type { HostToWorkerMessage, WorkerToHostMessage } from './method-worker-core';

/**
 * Host-side bridge to the method realm. One shared worker multiplexes runs; capability
 * calls travel back as messages and are mapped onto a real ActionContext. Aborting a
 * run terminates the worker outright — the only way to stop arbitrary method code —
 * and the worker respawns lazily on the next run.
 */

export interface MethodRunPayload {
  source: string;
  input: Record<string, Json>;
  state: Record<string, Json>;
}

export interface MethodRunOptions {
  signal: AbortSignal;
  context: ActionContext;
}

interface WorkerLike {
  postMessage: (data: HostToWorkerMessage) => void;
  onmessage: ((event: { data: WorkerToHostMessage }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  terminate: () => void;
}

interface PendingRun {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
  context: ActionContext;
}

function abortError(message = '方法执行已取消'): Error {
  return new DOMException(message, 'AbortError');
}

/** Workers exist in every browser runtime; jsdom/SSR fall back to the main-thread realm. */
export function isWorkerRealmSupported(): boolean {
  return typeof Worker === 'function';
}

function createDefaultMethodWorker(): WorkerLike {
  return new Worker(new URL('./method-worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

export class MethodWorkerHost {
  private worker: WorkerLike | null = null;
  private readonly runs = new Map<number, PendingRun>();
  private nextRunId = 1;
  private nextCallId = 1;

  constructor(private readonly factory: () => WorkerLike = createDefaultMethodWorker) {}

  run(payload: MethodRunPayload, { signal, context }: MethodRunOptions): Promise<unknown> {
    // Support gating happens at the routing layer (application-methods); a custom
    // factory here may legitimately simulate a realm where the runtime lacks Worker.
    let worker: WorkerLike;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    if (signal.aborted) return Promise.reject(abortError());
    const runId = this.nextRunId++;
    return new Promise((resolve, reject) => {
      const abort = () => this.terminateAll();
      signal.addEventListener('abort', abort, { once: true });
      this.runs.set(runId, {
        resolve,
        reject,
        context,
        cleanup: () => signal.removeEventListener('abort', abort),
      });
      worker.postMessage({
        kind: 'run',
        runId,
        source: payload.source,
        input: payload.input,
        state: payload.state,
      });
    });
  }

  /** Rejects every pending run and kills the realm; used for abort, errors and disposal. */
  terminateAll(reason?: unknown): void {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    const pending = [...this.runs.values()];
    this.runs.clear();
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    for (const run of pending) {
      run.cleanup();
      if (reason !== undefined) run.reject(reason);
      else run.reject(abortError());
    }
  }

  dispose(): void {
    this.terminateAll();
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.factory();
    worker.onmessage = (event) => this.handleMessage(event.data, worker);
    worker.onerror = () => this.terminateAll(new Error('方法域发生未捕获错误'));
    this.worker = worker;
    return worker;
  }

  private handleMessage(message: WorkerToHostMessage, worker: WorkerLike): void {
    if (message.kind === 'ctx-call') {
      void this.forwardCapabilityCall(message, worker);
      return;
    }
    const run = this.runs.get(message.runId);
    if (!run) return;
    this.runs.delete(message.runId);
    run.cleanup();
    if (message.ok) run.resolve(message.result);
    else
      run.reject(
        message.name === 'AbortError'
          ? abortError(message.message)
          : new Error(message.message),
      );
  }

  private async forwardCapabilityCall(
    message: Extract<WorkerToHostMessage, { kind: 'ctx-call' }>,
    worker: WorkerLike,
  ): Promise<void> {
    const run = this.runs.get(message.runId);
    if (!run) return;
    let ok = true;
    let value: unknown;
    let failureMessage: string | undefined;
    try {
      value = await this.callCapability(run.context, message.method, message.args);
    } catch (error) {
      ok = false;
      value = undefined;
      failureMessage = (error as { message?: string })?.message ?? String(error);
    }
    // The run may have been terminated while the capability was in flight.
    if (this.runs.get(message.runId) !== run || this.worker !== worker) return;
    worker.postMessage({
      kind: 'ctx-reply',
      runId: message.runId,
      callId: message.callId,
      ok,
      value,
      message: failureMessage,
    });
  }

  private callCapability(
    context: ActionContext,
    method: string,
    args: readonly unknown[],
  ): unknown {
    const [first, second] = args;
    switch (method) {
      case 'setState':
        return context.setState(String(first), second);
      case 'setFormValues':
        return context.setFormValues(String(first), second);
      case 'resetForm':
        return context.resetForm(String(first));
      case 'submitForm':
        return context.submitForm(String(first));
      case 'executeDataSource':
        return context.executeDataSource(
          String(first),
          second as Record<string, Json> | undefined,
        );
      case 'emitEffect':
        return context.emitEffect(
          first as { type: string; data: Record<string, Json> },
        );
      default:
        throw new Error(`方法域调用了未知能力 ${method}`);
    }
  }
}

/** Shared realm for application methods; one idle worker is cheap to keep around. */
export const methodWorkerHost = new MethodWorkerHost();
