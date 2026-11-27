import {
  Component,
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useRef,
  useId,
  useSyncExternalStore,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
  type ChangeEvent,
  type CSSProperties,
} from 'react';
import { matchesType, type FieldTarget, type NodeSchema } from '../schema/types';
import { PageRuntime, type PlannedNode } from '../runtime/engine';
import { styleValueError, type StyleProperty } from '../schema/style';
import { scopeStyleSource } from '../schema/style-source';
import { scopePageStyleSource } from '../schema/page-style-source';

const materialStyleTargets = new WeakMap<
  CSSProperties,
  { ref: (target: HTMLElement | SVGElement | null) => void; 'data-material-style': string }
>();
/** 绑定到 style 所对应的实际物料节点，弹层也使用同一入口。 */
export function materialStyleTarget(style?: CSSProperties) {
  return style && materialStyleTargets.get(style);
}
function useStyleScopeId() {
  return useId().replace(/[^\w-]/g, (char) => `_${char.charCodeAt(0).toString(16)}_`);
}

function useScopedStyleRef(css?: string) {
  return useMemo(() => {
    if (!css) return;
    let sheet: HTMLStyleElement | undefined;
    return (target: HTMLElement | SVGElement | null) => {
      sheet?.remove();
      sheet = undefined;
      if (!target) return;
      const root = target.getRootNode();
      const document = target.ownerDocument;
      sheet = document.createElement('style');
      sheet.textContent = css;
      if (root.nodeType === 11) root.appendChild(sheet);
      else document.head.appendChild(sheet);
    };
  }, [css]);
}

function useMaterialStyleTarget(source?: string) {
  const id = useStyleScopeId();
  const css = useMemo(
    () => source && scopeStyleSource(source, `[data-material-style="${id}"]`),
    [id, source],
  );
  const ref = useScopedStyleRef(css);
  return useMemo(() => ref && { 'data-material-style': id, ref }, [id, ref]);
}

function PageStyleScope({ source, children }: { source?: string; children: ReactNode }) {
  const id = useStyleScopeId();
  const css = useMemo(
    () => source && scopePageStyleSource(source, `:where([data-page-style="${id}"])`),
    [id, source],
  );
  const ref = useScopedStyleRef(css);
  return ref ? (
    <div ref={ref} data-page-style={id}>
      {children}
    </div>
  ) : (
    children
  );
}

export type SlotRenderers = Record<
  string,
  (params: Record<string, unknown>, key?: string | number) => ReactNode
>;
export type ReactMaterials = Record<string, ComponentType<any>>;
/** Host-only authoring presentation; never serialized into application schemas. */
export interface MaterialPresentation {
  overlay?: 'collapsed' | 'expanded' | 'ancestor';
  hidden?: boolean;
}
export type DesignPresentation = (
  node: NodeSchema,
  instanceKey: string,
) => MaterialPresentation | undefined;
const MaterialPresentationContext = createContext<MaterialPresentation | undefined>(undefined);
export function useMaterialPresentation() {
  return useContext(MaterialPresentationContext);
}
export interface NodeRenderProps {
  node: NodeSchema;
  instanceKey: string;
  children: ReactNode;
  inactiveReason?: 'condition' | 'field' | 'empty-repeat' | 'author-hidden';
  presentation?: MaterialPresentation;
}
export type NodeDecorator = ComponentType<NodeRenderProps>;
export interface SlotRenderProps extends NodeRenderProps {
  slotName: string;
}
export type SlotDecorator = ComponentType<SlotRenderProps>;
const RuntimeContext = createContext<{
  runtime: PageRuntime;
  materials: ReactMaterials;
  nodeDecorator?: NodeDecorator;
  slotDecorator?: SlotDecorator;
  childrenDecorator?: NodeDecorator;
  designMode?: boolean;
  designPresentation?: DesignPresentation;
} | null>(null);
const emptyScope = Object.freeze({});
const MaterialNodeContext = createContext<NodeSchema | null>(null);
export function useMaterialNode() {
  return useContext(MaterialNodeContext);
}
export function useHasSlot(name: string, slots: SlotRenderers) {
  const node = useMaterialNode();
  return node ? !!node.slots?.[name]?.children.length : !!slots[name];
}
/** Authoring presentation only; business state remains owned by React and the runtime. */
export function useDesignMode() {
  return useContext(RuntimeContext)?.designMode ?? false;
}
export function useRuntime() {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error('组件必须位于 RuntimeRenderer 中');
  return ctx.runtime;
}
export function useRuntimeState(stateId: string) {
  const runtime = useRuntime();
  const keys = useMemo(() => [stateId], [stateId]);
  useBindingVersion(runtime, keys);
  return runtime.getState()[stateId];
}
export function useDataSource(sourceId: string) {
  const source = useRuntime().getDataSource(sourceId);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  return { ...snapshot, execute: source.execute, refresh: source.refresh, cancel: source.cancel };
}
export function useForm(formId: string) {
  const form = useRuntime().getForm(formId);
  const state = useSyncExternalStore(form.subscribe, form.getSnapshot, form.getSnapshot);
  return {
    ...state,
    setValue: form.setValue,
    reset: form.reset,
    validate: form.validate,
    handleSubmit: form.handleSubmit,
  };
}
function fieldProps(
  runtime: PageRuntime,
  formId: string,
  fieldId: FieldTarget,
  changeEvent: 'onChange' | 'onValueChange' | 'onCheckedChange' = 'onChange',
) {
  const form = runtime.getForm(formId);
  const definition = form.getFieldDefinition(fieldId);
  const field = form.getFieldState(fieldId)!;
  return {
    name: form.getFieldName(fieldId),
    label: definition.label,
    ...(definition.type === 'boolean'
      ? { checked: field.value as boolean }
      : { value: (field.value ?? '') as string | number }),
    required:
      definition.rules?.some(
        (r) => r.kind === (definition.type === 'boolean' ? 'mustBeTrue' : 'required'),
      ) ?? false,
    disabled: field.disabled,
    error: field.error,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const target = event.target;
      const value =
        definition.type === 'boolean'
          ? 'checked' in target && target.checked
          : definition.type === 'number'
            ? target.value === '' ||
              !('valueAsNumber' in target) ||
              !Number.isFinite(target.valueAsNumber)
              ? null
              : target.valueAsNumber
            : target.value;
      form.setValue(fieldId, value);
    },
    onBlur: () => form.blur(fieldId),
    ...(changeEvent === 'onCheckedChange'
      ? { onCheckedChange: (checked: boolean) => form.setValue(fieldId, checked) }
      : {}),
    ...(changeEvent === 'onValueChange'
      ? {
          onValueChange: (value: string | number | null | (string | number)[]) =>
            form.setValue(fieldId, value === null && definition.type === 'string' ? '' : value),
        }
      : {}),
  };
}
export function useField(formId: string, fieldId: FieldTarget) {
  const runtime = useRuntime();
  useForm(formId);
  const state = runtime.getForm(formId).getFieldState(fieldId);
  if (!state) throw new Error('未知字段或明细行');
  const { label, error, ...input } = fieldProps(runtime, formId, fieldId);
  return { ...state, label, input: { ...input, 'aria-invalid': !!error } };
}
export function useFieldArray(formId: string, arrayId: string) {
  const runtime = useRuntime();
  const form = useForm(formId);
  const store = runtime.getForm(formId);
  const definition = store.getArrayDefinition(arrayId);
  const operations = useMemo(
    () => ({
      append: (value: unknown = {}) => store.append(arrayId, value),
      remove: (rowId: string) => store.remove(arrayId, rowId),
      move: (rowId: string, toIndex: number) => store.move(arrayId, rowId, toIndex),
    }),
    [store, arrayId],
  );
  return {
    ...form.arrays[arrayId],
    fields: form.arrays[arrayId].rows,
    label: definition.label,
    maxItems: definition.maxItems,
    ...operations,
  };
}
function useBindingVersion(runtime: PageRuntime, keys: readonly string[]) {
  const subscribe = useCallback(
    (fn: () => void) => runtime.subscribeState(keys, fn),
    [runtime, keys],
  );
  const snapshot = useCallback(() => runtime.snapshot(keys), [runtime, keys]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
interface BoundaryProps {
  children: ReactNode;
  runtime: PageRuntime;
  nodeId: string;
  revision: string;
  scope: object;
}
class NodeBoundary extends Component<
  BoundaryProps,
  { error: Error | null; revision: string; scope: object }
> {
  state = { error: null as Error | null, revision: this.props.revision, scope: this.props.scope };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  static getDerivedStateFromProps(props: BoundaryProps, state: NodeBoundary['state']) {
    return state.revision !== props.revision || state.scope !== props.scope
      ? { error: null, revision: props.revision, scope: props.scope }
      : null;
  }
  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.runtime.report('node.error', error.message, this.props.nodeId, 'error');
  }
  render() {
    return this.state.error ? (
      <div role="alert" className="runtime-error">
        <strong>节点 {this.props.nodeId} 无法显示</strong>
        <span>{this.state.error.message}</span>
      </div>
    ) : (
      this.props.children
    );
  }
}

function InactiveNode({
  node,
  instanceKey,
  reason,
}: {
  node: NodeSchema;
  instanceKey: string;
  reason: NonNullable<NodeRenderProps['inactiveReason']>;
}) {
  const context = useContext(RuntimeContext)!;
  const Decorator = context.nodeDecorator;
  return Decorator ? (
    <Decorator
      node={node}
      instanceKey={instanceKey}
      inactiveReason={reason}
      presentation={
        context.designMode ? context.designPresentation?.(node, instanceKey) : undefined
      }
    >
      {null}
    </Decorator>
  ) : null;
}
function Instance({
  node,
  scope,
  instanceKey,
}: {
  node: PlannedNode;
  scope: Readonly<Record<string, unknown>>;
  instanceKey: string;
}) {
  const ctx = useContext(RuntimeContext)!;
  const { runtime, materials } = ctx;
  const presentation = ctx.designMode
    ? ctx.designPresentation?.(node.schema, instanceKey)
    : undefined;
  const style = useResolvedStyle(runtime, node, scope, instanceKey);
  const styleTarget = useMaterialStyleTarget(node.schema.styleCss);
  if (styleTarget) materialStyleTargets.set(style, styleTarget);
  // Hooks precede conditional rendering. Materials retain native event/value callbacks.
  const events = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(node.on).map(([eventName, actions]) => [
          eventName,
          (event: unknown) => {
            if (ctx.designMode) return;
            if (
              eventName === 'onSubmit' &&
              event &&
              typeof (event as { preventDefault?: unknown }).preventDefault === 'function'
            )
              (event as { preventDefault(): void }).preventDefault();
            const result = runtime.run(
              actions,
              scope,
              event,
              `${instanceKey}:${eventName}`,
              node.schema.id,
              eventName === 'onConfirm' ? { throwOnError: true } : undefined,
            );
            if (eventName === 'onConfirm') return result;
          },
        ]),
      ),
    [runtime, node, scope, instanceKey, ctx.designMode],
  );
  const slots: SlotRenderers = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(node.slots).map(([name, slot]) => [
          name,
          (params: Record<string, unknown>, key?: string | number) => {
            const locals = { ...scope };
            for (const param of slot.params) {
              if (!Object.hasOwn(params, param)) throw new Error(`插槽 ${name} 缺少参数 ${param}`);
              locals[param] = params[param];
            }
            const children = slot.children.map((child) => (
              <NodeView
                key={child.schema.id}
                node={child}
                scope={locals}
                instanceKey={`${instanceKey}/slot:${name}${key === undefined ? '' : `/${typeof key}:${key}`}/${child.schema.id}`}
              />
            ));
            const Decorator = ctx.slotDecorator;
            return Decorator ? (
              <Decorator node={node.schema} instanceKey={instanceKey} slotName={name}>
                {children}
              </Decorator>
            ) : (
              children
            );
          },
        ]),
      ),
    [node, scope, runtime, instanceKey, ctx.slotDecorator],
  );
  const context = runtime.context(scope);
  if (
    node.schema.field &&
    !runtime.getForm(node.schema.field.formId).getSnapshot().fields[node.schema.field.fieldId]
      .visible
  )
    return <InactiveNode node={node.schema} instanceKey={instanceKey} reason="field" />;
  if (node.schema.hidden)
    return <InactiveNode node={node.schema} instanceKey={instanceKey} reason="author-hidden" />;
  if (node.when) {
    const visible = node.when.evaluate(context);
    if (typeof visible !== 'boolean') throw new Error('when 必须返回布尔值');
    if (!visible)
      return <InactiveNode node={node.schema} instanceKey={instanceKey} reason="condition" />;
  }
  const props = Object.fromEntries(
    Object.entries(node.props).map(([key, binding]) => [key, binding.evaluate(context)]),
  );
  const contract = runtime.plan.registry.components[node.schema.component];
  for (const [key, value] of Object.entries(props))
    if (!matchesType(value, contract.props[key].type))
      throw new Error(`属性 ${key} 需要 ${contract.props[key].type}`);
  const propErrors = contract.validateProps?.(props, {
    array:
      contract.fieldArray && typeof props.formId === 'string' && typeof props.arrayId === 'string'
        ? runtime.getForm(props.formId).getArrayDefinition(props.arrayId)
        : undefined,
    field: node.schema.field
      ? runtime.getForm(node.schema.field.formId).getFieldDefinition(node.schema.field.fieldId)
      : undefined,
    fieldItemType: node.schema.field
      ? runtime.getForm(node.schema.field.formId).getFieldDefinition(node.schema.field.fieldId)
          .itemType
      : undefined,
    fieldType: node.schema.field
      ? runtime.getForm(node.schema.field.formId).getFieldDefinition(node.schema.field.fieldId).type
      : undefined,
  });
  if (propErrors?.length) throw new Error(propErrors.join('；'));
  const Material = materials[node.schema.component];
  if (!Material) throw new Error(`React 物料 ${node.schema.component} 未安装`);
  const bindingProps: Record<string, unknown> = {};
  if (node.schema.field)
    Object.assign(
      bindingProps,
      fieldProps(
        runtime,
        node.schema.field.formId,
        node.schema.field.fieldId,
        contract.field?.changeEvent,
      ),
    );
  if (node.schema.field && contract.field?.changeEvent === 'onValueChange')
    bindingProps.value = runtime
      .getForm(node.schema.field.formId)
      .getFieldState(node.schema.field.fieldId)!.value;
  if (node.schema.formId) {
    const form = runtime.getForm(node.schema.formId);
    bindingProps.noValidate = true;
    bindingProps.onSubmit = (event: { preventDefault(): void }) => {
      event.preventDefault();
      if (ctx.designMode) return;
      void runtime
        .submitForm(node.schema.formId!, { scope, event, target: { node, instanceKey } })
        .catch(() => {});
    };
    bindingProps.onReset = (event: { preventDefault(): void }) => {
      event.preventDefault();
      if (ctx.designMode) return;
      form.reset();
      void runtime.run(
        node.on.onReset ?? [],
        scope,
        event,
        `${instanceKey}:onReset`,
        node.schema.id,
      );
    };
  }
  const children = node.children.map((child) => (
    <NodeView
      key={child.schema.id}
      node={child}
      scope={scope}
      instanceKey={`${instanceKey}/${child.schema.id}`}
    />
  ));
  const ChildrenDecorator = contract.children && ctx.childrenDecorator;
  const element = createElement(
    Material,
    {
      ...props,
      ...events,
      ...bindingProps,
      ...(Object.keys(slots).length ? { slots } : {}),
      ...(node.schema.style || styleTarget ? { style } : {}),
    },
    ...(ChildrenDecorator
      ? [
          <ChildrenDecorator key="children" node={node.schema} instanceKey={instanceKey}>
            {children}
          </ChildrenDecorator>,
        ]
      : children),
  );
  const Decorator = ctx.nodeDecorator;
  const presented = (
    <MaterialPresentationContext.Provider value={presentation}>
      <MaterialNodeContext.Provider value={node.schema}>{element}</MaterialNodeContext.Provider>
    </MaterialPresentationContext.Provider>
  );
  return Decorator ? (
    <Decorator node={node.schema} instanceKey={instanceKey} presentation={presentation}>
      {presented}
    </Decorator>
  ) : (
    presented
  );
}
/** Bad dynamic declarations do not turn an otherwise valid material into an error node. */
function useResolvedStyle(
  runtime: PageRuntime,
  node: PlannedNode,
  scope: Readonly<Record<string, unknown>>,
  instanceKey: string,
): CSSProperties {
  const style: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const context = runtime.context(scope);
  for (const [key, binding] of Object.entries(node.style)) {
    let value: unknown;
    try {
      value = binding.evaluate(context);
      const error = styleValueError(key as StyleProperty, value);
      if (error) throw new Error(error);
      style[key] = value as string | number;
    } catch (error) {
      let description: string;
      try {
        description = JSON.stringify(value) ?? `[${typeof value}]`;
      } catch {
        description = `[${typeof value}]`;
      }
      errors[key] =
        `${typeof value}:${description.slice(0, 240)} · ${error instanceof Error ? error.message : '样式求值失败'}`;
    }
  }
  // Canonical longhands prevent React clearing a shorthand from erasing unchanged overrides.
  if (style.gap !== undefined) {
    style.rowGap ??= style.gap;
    style.columnGap ??= style.gap;
    delete style.gap;
  }
  const previous = useRef<Record<string, string>>({});
  const signature = JSON.stringify(errors);
  useEffect(() => {
    const current = JSON.parse(signature) as Record<string, string>;
    for (const [key, error] of Object.entries(current))
      if (previous.current[key] !== error)
        runtime.report(
          'style.error',
          `${instanceKey} · style.${key}: ${error}`,
          node.schema.id,
          'error',
        );
    previous.current = current;
  }, [runtime, node.schema.id, instanceKey, signature]);
  return style as CSSProperties;
}
function Content({
  node,
  scope,
  instanceKey,
}: {
  node: PlannedNode;
  scope: Readonly<Record<string, unknown>>;
  instanceKey: string;
}) {
  const runtime = useRuntime();
  if (!node.repeat) return <Instance node={node} scope={scope} instanceKey={instanceKey} />;
  const items = node.repeat.items.evaluate(runtime.context(scope));
  if (!Array.isArray(items)) throw new Error('repeat.items 必须返回数组');
  if (!items.length)
    return <InactiveNode node={node.schema} instanceKey={instanceKey} reason="empty-repeat" />;
  const seen = new Set<string>();
  return items.map((item, index) => {
    const local = {
      ...scope,
      [node.schema.repeat!.item]: item,
      [node.schema.repeat!.index ?? 'index']: index,
    };
    const key = node.repeat!.key.evaluate(runtime.context(local));
    if (
      !['string', 'number'].includes(typeof key) ||
      (typeof key === 'number' && !Number.isFinite(key))
    )
      throw new Error('循环 key 必须为字符串或有限数字');
    const stableKey = `${typeof key}:${key}`;
    if (seen.has(stableKey)) throw new Error(`循环 key 重复：${String(key)}`);
    seen.add(stableKey);
    return (
      <InstanceBoundary
        key={stableKey}
        node={node}
        scope={local}
        instanceKey={`${instanceKey}/${stableKey}`}
      />
    );
  });
}
function InstanceBoundary(props: {
  node: PlannedNode;
  scope: Readonly<Record<string, unknown>>;
  instanceKey: string;
}) {
  const runtime = useRuntime();
  const version = useBindingVersion(runtime, props.node.dependencies);
  return (
    <NodeBoundary
      runtime={runtime}
      nodeId={props.node.schema.id}
      revision={version}
      scope={props.scope}
    >
      <Instance {...props} />
    </NodeBoundary>
  );
}
function NodeView(props: {
  node: PlannedNode;
  scope: Readonly<Record<string, unknown>>;
  instanceKey: string;
}) {
  const runtime = useRuntime();
  const version = useBindingVersion(runtime, props.node.dependencies);
  return (
    <NodeBoundary
      runtime={runtime}
      nodeId={props.node.schema.id}
      revision={version}
      scope={props.scope}
    >
      <Content {...props} />
    </NodeBoundary>
  );
}
export function RuntimeRenderer({
  runtime,
  materials,
  nodeDecorator,
  slotDecorator,
  childrenDecorator,
  designMode = false,
  designPresentation,
  children,
}: {
  runtime: PageRuntime;
  materials: ReactMaterials;
  nodeDecorator?: NodeDecorator;
  slotDecorator?: SlotDecorator;
  childrenDecorator?: NodeDecorator;
  designMode?: boolean;
  designPresentation?: DesignPresentation;
  children?: ReactNode;
}) {
  const value = useMemo(
    () => ({
      runtime,
      materials,
      nodeDecorator,
      slotDecorator,
      childrenDecorator,
      designMode,
      designPresentation,
    }),
    [
      runtime,
      materials,
      nodeDecorator,
      slotDecorator,
      childrenDecorator,
      designMode,
      designPresentation,
    ],
  );
  return (
    <RuntimeContext.Provider key={runtime.instanceId} value={value}>
      {children !== undefined ? (
        children
      ) : (
        <PageStyleScope
          source={runtime.page.schema.code?.enabled ? undefined : runtime.page.schema.css}
        >
          {runtime.page.children.map((node) => (
            <NodeView
              key={node.schema.id}
              node={node}
              scope={emptyScope}
              instanceKey={node.schema.id}
            />
          ))}
        </PageStyleScope>
      )}
    </RuntimeContext.Provider>
  );
}
