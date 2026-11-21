import { validateApplication } from '../schema/validate';
import {
  isJson,
  matchesType,
  type ApplicationSchema,
  type PageSchema,
  type Json,
  type NodeSchema,
  type ActionCall,
  type Issue,
} from '../schema/types';
import { compileValue, type CompiledValue, type EvaluationContext } from './expression';
import type { Registry } from './registry';
import { FormRuntime, type FormSnapshot } from './form';
import { abortable, isAbortError } from './abort';
import { DataSourceRuntime, type DataSourceSnapshot } from './data-source';
import { withApplicationMethods } from './application-methods';

export class SchemaError extends Error {
  constructor(public readonly issues: Issue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join('\n'));
  }
}
export { deepFreeze as freeze } from '../schema/deep-freeze';
import { deepFreeze as freeze } from '../schema/deep-freeze';
export interface PlannedAction {
  schema: ActionCall;
  input: Record<string, CompiledValue>;
}
export interface PlannedNode {
  schema: NodeSchema;
  props: Record<string, CompiledValue>;
  style: Record<string, CompiledValue>;
  when?: CompiledValue;
  repeat?: { items: CompiledValue; key: CompiledValue };
  children: PlannedNode[];
  slots: Record<string, { params: string[]; children: PlannedNode[] }>;
  on: Record<string, PlannedAction[]>;
  dependencies: readonly string[];
}
export interface PlannedPage {
  schema: PageSchema;
  children: PlannedNode[];
  onEnter: PlannedAction[];
  onLeave: PlannedAction[];
}
export interface ApplicationPlan {
  schema: ApplicationSchema;
  pages: ReadonlyMap<string, PlannedPage>;
  registry: Registry;
}
const planActions = (actions: ActionCall[] = []): PlannedAction[] =>
  actions.map((schema) => ({
    schema,
    input: Object.fromEntries(Object.entries(schema.input).map(([k, v]) => [k, compileValue(v)])),
  }));
function planNodes(nodes: NodeSchema[]): PlannedNode[] {
  return nodes.map((schema) => {
    const props = Object.fromEntries(
      Object.entries(schema.props).map(([k, v]) => [k, compileValue(v)]),
    );
    const when = schema.when ? compileValue(schema.when) : undefined;
    const style = Object.fromEntries(
      Object.entries(schema.style ?? {}).map(([key, value]) => [key, compileValue(value)]),
    );
    const repeat = schema.repeat
      ? { items: compileValue(schema.repeat.items), key: compileValue(schema.repeat.key) }
      : undefined;
    return {
      schema,
      props,
      style: freeze(style),
      when,
      repeat,
      children: planNodes(schema.children ?? []),
      on: Object.fromEntries(Object.entries(schema.on ?? {}).map(([k, v]) => [k, planActions(v)])),
      slots: Object.fromEntries(
        Object.entries(schema.slots ?? {}).map(([k, v]) => [
          k,
          { params: v.params, children: planNodes(v.children) },
        ]),
      ),
      dependencies: [
        ...(schema.field ? [`@form:${schema.field.formId}`] : []),
        ...(schema.formId ? [`@form:${schema.formId}`] : []),
        ...new Set(
          [
            ...Object.values(props),
            ...Object.values(style),
            ...(when ? [when] : []),
            ...(repeat ? [repeat.items, repeat.key] : []),
          ].flatMap((v) => [...v.dependencies]),
        ),
      ],
    };
  });
}
export function compileApplication(input: unknown, registry: Registry): ApplicationPlan {
  const issues = validateApplication(input, registry);
  if (issues.length) throw new SchemaError(issues);
  const schema = freeze(structuredClone(input as ApplicationSchema));
  const appRegistry = withApplicationMethods(schema, registry);
  const linkedRegistry: Registry = freeze({
    transports: Object.fromEntries(
      Object.entries(appRegistry.transports ?? {}).map(([id, contract]) => [
        id,
        { ...contract, input: structuredClone(contract.input) },
      ]),
    ),
    computations: Object.fromEntries(
      Object.entries(appRegistry.computations ?? {}).map(([id, entry]) => [id, { ...entry }]),
    ),
    components: Object.fromEntries(
      Object.entries(appRegistry.components).map(([id, entry]) => [
        id,
        {
          ...entry,
          props: structuredClone(entry.props),
          style: entry.style ? structuredClone(entry.style) : undefined,
          field: entry.field
            ? {
                ...entry.field,
                type: Array.isArray(entry.field.type) ? [...entry.field.type] : entry.field.type,
              }
            : undefined,
          events: entry.events ? [...entry.events] : undefined,
          slots: entry.slots ? structuredClone(entry.slots) : undefined,
        },
      ]),
    ),
    actions: Object.fromEntries(
      Object.entries(appRegistry.actions).map(([id, entry]) => [
        id,
        { ...entry, input: structuredClone(entry.input) },
      ]),
    ),
  });
  return {
    schema,
    registry: linkedRegistry,
    pages: new Map(
      schema.pages.map((page) => [
        page.id,
        {
          schema: page,
          children: planNodes(page.children),
          onEnter: planActions(page.onEnter),
          onLeave: planActions(page.onLeave),
        },
      ]),
    ),
  };
}

export interface RuntimeRecord {
  sequence: number;
  time: string;
  level: 'info' | 'error';
  kind: string;
  message: string;
  nodeId?: string;
}
interface Subscription {
  keys: readonly string[];
  notify: () => void;
}
export interface FormSubmitOptions {
  signal?: AbortSignal;
  scope?: Readonly<Record<string, unknown>>;
  event?: unknown;
  target?: { node: PlannedNode; instanceKey: string };
  formStack?: readonly string[];
}
let instanceSequence = 0;
export class PageRuntime {
  readonly instanceId = ++instanceSequence;
  readonly page: PlannedPage;
  private state: Record<string, Json>;
  private versions = new Map<string, number>();
  private subscriptions = new Set<Subscription>();
  private metaListeners = new Set<() => void>();
  private effectListeners = new Set<
    (effect: { type: string; data: Record<string, Json> }) => void
  >();
  subscribeEffects = (listener: (effect: { type: string; data: Record<string, Json> }) => void) => {
    this.effectListeners.add(listener);
    return () => {
      this.effectListeners.delete(listener);
    };
  };
  emitEffect = (effect: { type: string; data: Record<string, Json> }) => {
    if (!this.disposed)
      for (const listener of this.effectListeners) listener(structuredClone(effect));
  };
  private controllers = new Map<string, AbortController>();
  private resultRevisions = new Map<string, number>();
  private entered = false;
  private left = false;
  private sequence = 0;
  private metaVersion = 0;
  private records: RuntimeRecord[] = [];
  private forms = new Map<string, FormRuntime>();
  private formUnsubscribers: (() => void)[] = [];
  private sources = new Map<string, DataSourceRuntime>();
  private sourceUnsubscribers: (() => void)[] = [];
  private designMode: boolean;
  disposed = false;
  constructor(
    readonly plan: ApplicationPlan,
    pageId: string,
    options: { designMode?: boolean } = {},
  ) {
    this.designMode = options.designMode ?? false;
    const page = plan.pages.get(pageId);
    if (!page) throw new Error(`未知页面 ${pageId}`);
    this.page = page;
    this.state = freeze(
      Object.fromEntries(page.schema.state.map((s) => [s.id, structuredClone(s.initial)])),
    );
    for (const definition of page.schema.forms ?? []) {
      const form = new FormRuntime(
        definition,
        () => ({ state: this.state, scope: {} }),
        plan.registry.computations,
      );
      this.forms.set(definition.id, form);
      this.formUnsubscribers.push(form.subscribe(() => this.notifyKey(`@form:${definition.id}`)));
    }
    for (const definition of page.schema.dataSources ?? []) {
      const source = new DataSourceRuntime(
        definition,
        plan.registry.transports![definition.transport],
        () => this.context(),
        { enabled: !this.designMode, canExecute: () => !this.disposed && !this.designMode },
      );
      this.sources.set(definition.id, source);
      this.sourceUnsubscribers.push(
        source.subscribe(() => {
          this.notifyKey(`@source:${definition.id}`);
          this.notifyMeta();
        }),
      );
    }
  }
  getDataSource(id: string) {
    const source = this.sources.get(id);
    if (!source) throw new Error(`未知数据源 ${id}`);
    return source;
  }
  getDataSourcesSnapshot = (): Record<string, DataSourceSnapshot> =>
    Object.fromEntries([...this.sources].map(([id, source]) => [id, source.getSnapshot()]));
  setDesignMode = (designMode: boolean) => {
    if (this.disposed || this.designMode === designMode) return;
    this.designMode = designMode;
    if (designMode) {
      this.controllers.forEach((controller) => controller.abort());
      this.controllers.clear();
    }
    this.sources.forEach((source) => source.setEnabled(!designMode));
    this.notifyMeta();
    if (!designMode) void this.enter();
  };
  getForm(id: string) {
    const form = this.forms.get(id);
    if (!form) throw new Error(`未知表单 ${id}`);
    return form;
  }
  getFormsSnapshot = (): Record<string, FormSnapshot> =>
    Object.fromEntries([...this.forms].map(([id, form]) => [id, form.getSnapshot()]));
  private notifyKey(id: string) {
    this.versions.set(id, (this.versions.get(id) ?? 0) + 1);
    for (const sub of this.subscriptions)
      if (sub.keys.includes('*') || sub.keys.includes(id)) sub.notify();
  }
  getState = (): Readonly<Record<string, Json>> => this.state;
  getRecords = (): readonly RuntimeRecord[] => this.records;
  getPending = () =>
    this.controllers.size +
    [...this.sources.values()].filter((source) => source.getSnapshot().loading).length;
  getMetaVersion = () => this.metaVersion;
  subscribeMeta = (notify: () => void) => {
    this.metaListeners.add(notify);
    return () => this.metaListeners.delete(notify);
  };
  subscribeState = (keys: readonly string[], notify: () => void) => {
    const sub = { keys, notify };
    this.subscriptions.add(sub);
    return () => this.subscriptions.delete(sub);
  };
  snapshot = (keys: readonly string[]) =>
    keys.includes('*')
      ? [...this.versions.entries()].map(([k, v]) => `${k}:${v}`).join('|')
      : keys.map((k) => `${k}:${this.versions.get(k) ?? 0}`).join('|');
  private notifyMeta() {
    this.metaVersion++;
    this.metaListeners.forEach((fn) => fn());
  }
  report(kind: string, message: string, nodeId?: string, level: RuntimeRecord['level'] = 'info') {
    if (this.disposed) return;
    this.records = [
      ...this.records.slice(-99),
      {
        sequence: ++this.sequence,
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        level,
        kind,
        message,
        nodeId,
      },
    ];
    this.notifyMeta();
  }
  setState = (id: string, value: unknown): void => {
    if (this.disposed) throw new Error('页面已销毁');
    const definition = this.page.schema.state.find((s) => s.id === id);
    if (!definition) throw new Error(`未知状态 ${id}`);
    if (!matchesType(value, definition.type)) throw new Error(`状态 ${id} 需要 ${definition.type}`);
    if (Object.is(this.state[id], value)) return;
    this.state = freeze({ ...this.state, [id]: structuredClone(value as Json) });
    // Precise invalidation: only forms whose compiled rules read this state key refresh.
    for (const form of this.forms.values()) if (form.dependsOnState(id)) form.refresh();
    this.notifyKey(id);
  };
  context(scope: Readonly<Record<string, unknown>> = {}, event?: unknown): EvaluationContext {
    return {
      state: this.state,
      forms: this.getFormsSnapshot(),
      sources: this.getDataSourcesSnapshot(),
      formValues: (id) => this.getForm(id).getSubmitValues(),
      scope,
      event,
    };
  }
  async enter() {
    if (this.entered || this.disposed || this.designMode) return;
    this.entered = true;
    this.report('lifecycle', `进入 ${this.page.schema.title}`);
    await this.run(this.page.onEnter, {}, undefined, 'page:enter');
  }
  /** Page-leave actions run once, only after a real (non-design) page entry. */
  async leave() {
    if (this.left || this.disposed || this.designMode || !this.entered) return;
    this.left = true;
    this.report('lifecycle', `离开 ${this.page.schema.title}`);
    await this.run(this.page.onLeave, {}, undefined, 'page:leave');
  }
  /** Hosts dispose synchronously unless leave actions would actually run. */
  willRunLeaveActions(): boolean {
    return !this.designMode && !this.disposed && this.page.onLeave.length > 0;
  }
  /** Native and action-driven submissions share validation, cancellation and onSubmit execution. */
  async submitForm(formId: string, options: FormSubmitOptions = {}): Promise<void> {
    const form = this.getForm(formId);
    const stack = options.formStack ?? [];
    if (stack.includes(formId)) throw new Error(`表单提交循环：${[...stack, formId].join(' → ')}`);
    if (form.getSnapshot().isSubmitting) throw new Error(`表单 ${formId} 正在提交`);
    let target = options.target;
    if (!target) {
      const candidates: { node: PlannedNode; instanceKey: string; scoped: boolean }[] = [];
      const visit = (nodes: PlannedNode[], prefix = '', scoped = false) => {
        for (const node of nodes) {
          const instanceKey = prefix + node.schema.id;
          const local = scoped || !!node.repeat;
          if (node.schema.formId === formId) candidates.push({ node, instanceKey, scoped: local });
          visit(node.children, instanceKey + '/', local);
          for (const [name, slot] of Object.entries(node.slots))
            visit(slot.children, instanceKey + '/slot:' + name + '/', true);
        }
      };
      visit(this.page.children);
      if (candidates.length !== 1 || candidates[0].scoped)
        throw new Error(`表单 ${formId} 需要唯一且不在循环或插槽中的表单容器`);
      target = candidates[0];
    }
    if (target.node.schema.formId !== formId) throw new Error('提交目标与表单模型不一致');
    const current = target;
    const ok = await form.submit(
      async (_values, signal) => {
        const success = await this.run(
          current.node.on.onSubmit ?? [],
          options.scope ?? {},
          options.event,
          `${current.instanceKey}:onSubmit`,
          current.node.schema.id,
          { signal, throwOnError: true, formStack: [...stack, formId] },
        );
        if (!success) throw new DOMException('Aborted', 'AbortError');
      },
      { signal: options.signal, throwOnCancel: true },
    );
    if (!ok)
      throw new Error(form.getSnapshot().submitError ?? `表单 ${formId} 校验失败或提交已取消`);
  }
  async run(
    actions: PlannedAction[],
    scope: Readonly<Record<string, unknown>>,
    event: unknown,
    lane: string,
    nodeId?: string,
    options: { signal?: AbortSignal; throwOnError?: boolean; formStack?: readonly string[] } = {},
  ): Promise<boolean> {
    if (this.disposed || this.designMode || actions.length === 0)
      return !this.disposed && !this.designMode;
    this.controllers.get(lane)?.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.controllers.set(lane, controller);
    this.notifyMeta();
    const active = () =>
      !this.disposed && !controller.signal.aborted && this.controllers.get(lane) === controller;
    try {
      for (const action of actions) {
        if (!active()) return false;
        const contract = this.plan.registry.actions[action.schema.action];
        const resultTarget = action.schema.resultTo;
        const resultRevision = resultTarget ? (this.resultRevisions.get(resultTarget) ?? 0) + 1 : 0;
        if (resultTarget) this.resultRevisions.set(resultTarget, resultRevision);
        const input: Record<string, Json> = {};
        for (const [key, binding] of Object.entries(action.input)) {
          const v = binding.evaluate(this.context(scope, event));
          if (!isJson(v) || !matchesType(v, contract.input[key].type))
            throw new Error(`动作 ${action.schema.action} 参数 ${key} 类型错误`);
          input[key] = structuredClone(v);
        }
        this.report('action.start', action.schema.action, nodeId);
        const output = await abortable(controller.signal, () =>
          contract.execute(input, {
            signal: controller.signal,
            getState: this.getState,
            emitEffect: (effect) => {
              if (!active()) return;
              if (effect.type === 'app.navigate') {
                const pageId = effect.data.pageId;
                if (typeof pageId !== 'string' || !this.plan.pages.has(pageId))
                  throw new Error(`未知目标页面 ${String(pageId)}`);
              }
              this.emitEffect(effect);
            },
            setState: (id, value) => {
              if (active()) this.setState(id, value);
            },
            setFormValues: (id, values) => {
              if (active()) this.getForm(id).setValues(values);
            },
            resetForm: (id) => {
              if (active()) this.getForm(id).reset();
            },
            submitForm: async (id) => {
              if (!active()) throw new Error('动作已取消');
              await this.submitForm(id, {
                signal: controller.signal,
                formStack: options.formStack,
              });
            },
            executeDataSource: async (id, input) => {
              if (!active() || this.designMode) throw new Error('动作已取消或当前为编辑模式');
              return this.getDataSource(id).execute(input, { signal: controller.signal });
            },
          }),
        );
        if (!active()) return false;
        if (contract.output && !matchesType(output, contract.output))
          throw new Error(`动作 ${action.schema.action} 返回类型错误`);
        if (resultTarget && this.resultRevisions.get(resultTarget) === resultRevision)
          this.setState(resultTarget, output);
        this.report('action.success', action.schema.action, nodeId);
      }
      return true;
    } catch (error) {
      if (active() && !isAbortError(error))
        this.report('action.error', (error as Error).message, nodeId, 'error');
      if (active() && options.throwOnError) throw error;
      return false;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (this.controllers.get(lane) === controller) {
        this.controllers.delete(lane);
        this.notifyMeta();
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.controllers.forEach((c) => c.abort());
    this.controllers.clear();
    this.formUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.sourceUnsubscribers.forEach((unsubscribe) => unsubscribe());
    this.sources.forEach((source) => source.dispose());
    this.forms.forEach((form) => form.dispose());
    this.subscriptions.clear();
    this.metaListeners.clear();
    this.effectListeners.clear();
  }
}
