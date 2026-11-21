import { isJson, matchesType, type DataSourceDefinition, type Json } from '../schema/types';
import type { TransportContract } from './registry';
import { compileValue, type EvaluationContext } from './expression';
import { abortable } from './abort';

export interface DataSourceSnapshot {
  data: Json;
  status: 'idle' | 'loading' | 'success' | 'error';
  loading: boolean;
  error: null | { name: string; message: string };
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(immutable);
  }
  return value;
}
export function checkTransportInput(
  contract: TransportContract,
  input: unknown,
  partial = false,
): Record<string, Json> {
  if (!matchesType(input, 'object')) throw new Error('数据源输入必须是 JSON 对象');
  const values = input as Record<string, Json>;
  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(contract.input, key)) throw new Error(`未知数据源参数 ${key}`);
    if (!matchesType(value, contract.input[key].type))
      throw new Error(`数据源参数 ${key} 需要 ${contract.input[key].type}`);
  }
  if (!partial)
    for (const [key, field] of Object.entries(contract.input))
      if (field.required && !Object.hasOwn(values, key)) throw new Error(`数据源缺少参数 ${key}`);
  return structuredClone(values);
}
export class DataSourceRuntime {
  readonly definition: DataSourceDefinition;
  private snapshot: DataSourceSnapshot;
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private enabled: boolean;
  private canExecute: () => boolean;
  private disposed = false;
  private input: Record<string, ReturnType<typeof compileValue>>;
  constructor(
    definition: DataSourceDefinition,
    private transport: TransportContract,
    private context: () => EvaluationContext,
    options: { enabled?: boolean; canExecute?: () => boolean } = {},
  ) {
    if (!matchesType(definition.initial, transport.output))
      throw new Error(`数据源 ${definition.id} 初始值需要 ${transport.output}`);
    this.definition = immutable(structuredClone(definition));
    this.enabled = options.enabled ?? true;
    this.canExecute = options.canExecute ?? (() => true);
    this.input = Object.fromEntries(
      Object.entries(this.definition.input).map(([key, value]) => {
        const binding = compileValue(value);
        if (binding.usesEvent || binding.usesScope)
          throw new Error('数据源输入仅允许页面作用域，不能读取 event 或 scope');
        return [key, binding];
      }),
    );
    this.snapshot = immutable({
      data: structuredClone(definition.initial),
      status: 'idle',
      loading: false,
      error: null,
    });
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(snapshot: DataSourceSnapshot) {
    this.snapshot = immutable(snapshot);
    this.listeners.forEach((listener) => listener());
  }
  execute = async (
    override: Record<string, Json> = {},
    options: { signal?: AbortSignal } = {},
  ): Promise<Json> => {
    if (this.disposed) throw new Error('数据源已销毁');
    if (!this.enabled || !this.canExecute()) throw new Error('编辑模式不能执行数据源');
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (this.definition.kind === 'mutation' && this.controller)
      throw new Error(`数据源 ${this.definition.id} 正在执行（busy）`);
    // Input failures do not replace an existing valid request or publish a partial status.
    checkTransportInput(this.transport, override, true);
    const ctx = this.context();
    const defaults = Object.fromEntries(
      Object.entries(this.input)
        .filter(([key]) => !Object.hasOwn(override, key))
        .map(([key, value]) => [key, value.evaluate(ctx)]),
    );
    const input = checkTransportInput(this.transport, { ...defaults, ...override });
    this.controller?.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.controller = controller;
    this.publish({ ...this.snapshot, status: 'loading', loading: true, error: null });
    const active = () =>
      !this.disposed &&
      this.enabled &&
      this.canExecute() &&
      !controller.signal.aborted &&
      this.controller === controller;
    try {
      const output = await abortable(controller.signal, () =>
        this.transport.execute(input, { signal: controller.signal }),
      );
      if (!active()) throw new DOMException('Aborted', 'AbortError');
      if (!isJson(output) || !matchesType(output, this.transport.output))
        throw new Error(`数据源 ${this.definition.id} 返回值需要 ${this.transport.output}`);
      const data = immutable(structuredClone(output));
      this.publish({ data, status: 'success', loading: false, error: null });
      if (!active()) throw new DOMException('Aborted', 'AbortError');
      return data;
    } catch (error) {
      if (active())
        this.publish({
          ...this.snapshot,
          status: 'error',
          loading: false,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (this.controller === controller) {
        this.controller = undefined;
        if (!this.disposed && this.snapshot.loading)
          this.publish({ ...this.snapshot, status: 'idle', loading: false, error: null });
      }
    }
  };
  refresh = (options: { signal?: AbortSignal } = {}) => this.execute({}, options);
  cancel = () => {
    const controller = this.controller;
    if (!controller) return;
    this.controller = undefined;
    controller.abort();
    if (!this.disposed)
      this.publish({ ...this.snapshot, status: 'idle', loading: false, error: null });
  };
  setEnabled = (enabled: boolean) => {
    this.enabled = enabled;
    if (!enabled) this.cancel();
  };
  dispose = () => {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  };
}
