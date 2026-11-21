import { compileApplication, freeze, type ApplicationPlan } from '../runtime/engine';
import { acceptsField, type Registry } from '../runtime/registry';
import type {
  FieldDefinition,
  FieldArrayDefinition,
  FormDefinition,
  NodeSchema,
  PageSchema,
  PageCode,
  Value,
  ActionCall,
  StateDefinition,
  DataSourceDefinition,
  ApplicationMethod,
  ApplicationSchema,
} from '../schema/types';
import { assertActionScope, assertMoveScope, assertLogicScope } from './scope';
import { sourceReferences, stateReferences } from './data';
import { compileValue } from '../runtime/expression';
import { cloneMaterialTemplate, type MaterialTemplate } from './material-template';
import { inspectClipboardTree, type ClipboardSummary } from './node-clipboard';
import { inspectBulkDuplicateTree } from './bulk-duplicate';
import {
  normalizeSavedFragmentName,
  SAVED_FRAGMENT_LIMIT,
  type SavedFragmentSummary,
  type SavedFragmentsSnapshot,
} from './saved-fragments';
import { NODE_NAME_EXTENSION, normalizeNodeName, readNodeName } from '../schema/node-name';
import {
  canonicalSelection,
  pageNodeOrder,
  selectedNodeIds,
  topSelectedNodeIds,
  type Selection,
} from './selection';
export type { Selection } from './selection';
import {
  assertFieldRange,
  assertLocalFieldBindings,
  formReferences,
  managedFieldProps,
  nearestForm,
} from './forms';

export interface InsertTarget {
  parentId?: string;
  slot?: string;
  index?: number;
}
export interface NodeLocation {
  node: NodeSchema;
  list: NodeSchema[];
  index: number;
  parentId?: string;
  slot?: string;
}
export function findNode(page: PageSchema, id: string): NodeLocation | undefined {
  const visit = (
    list: NodeSchema[],
    parentId?: string,
    slot?: string,
  ): NodeLocation | undefined => {
    for (const [index, node] of list.entries()) {
      if (node.id === id) return { node, list, index, parentId, slot };
      const child = visit(node.children ?? [], node.id);
      if (child) return child;
      for (const [name, definition] of Object.entries(node.slots ?? {})) {
        const found = visit(definition.children, node.id, name);
        if (found) return found;
      }
    }
  };
  return visit(page.children);
}
export function containsNode(node: NodeSchema, id: string): boolean {
  return (
    node.id === id ||
    [
      ...(node.children ?? []),
      ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children),
    ].some((child) => containsNode(child, id))
  );
}
interface Entry {
  plan: ApplicationPlan;
  selection: Readonly<Selection>;
}
/** Editor-owned frozen captures. This payload never leaves the document instance. */
interface StaticForest {
  nodes: NodeSchema[];
  components: Record<string, string>;
}
export interface EditorSnapshot extends Entry {
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  change: string;
}

/** Every UI surface edits this document. Failed validation never mutates history or preview. */
export class EditorDocument {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot: EditorSnapshot;
  private group?: string;
  private idSequence = 0;
  private reservedPageIds = new Set<string>();
  private reservedMethodIds = new Set<string>();
  #clipboard?: StaticForest;
  #savedFragments = new Map<
    string,
    { forest: StaticForest; summary: Readonly<SavedFragmentSummary> }
  >();
  private savedFragmentsSnapshot: Readonly<SavedFragmentsSnapshot> = freeze({ items: [] });
  private savedFragmentListeners = new Set<() => void>();
  private savedFragmentSequence = 0;
  private clipboardSummary: Readonly<ClipboardSummary> = Object.freeze({
    available: false,
    nodeCount: 0,
  });
  private clipboardListeners = new Set<() => void>();
  constructor(
    input: unknown,
    private registry: Registry,
    private historyLimit = 100,
  ) {
    if (!Number.isInteger(historyLimit) || historyLimit < 1)
      throw new Error('历史上限必须为正整数');
    const plan = compileApplication(input, registry);
    for (const id of plan.pages.keys()) this.reservedPageIds.add(id);
    for (const method of plan.schema.methods ?? []) this.reservedMethodIds.add(method.id);
    const page = plan.pages.get(plan.schema.entryPageId)!;
    this.snapshot = Object.freeze({
      plan,
      selection: Object.freeze({
        pageId: page.schema.id,
        nodeId: page.schema.children[0]?.id ?? null,
      }),
      canUndo: false,
      canRedo: false,
      revision: 0,
      change: '初始文档',
    });
  }
  getSnapshot = () => this.snapshot;
  getSavedFragmentsSnapshot = () => this.savedFragmentsSnapshot;
  subscribeSavedFragments = (notify: () => void) => {
    this.savedFragmentListeners.add(notify);
    return () => {
      this.savedFragmentListeners.delete(notify);
    };
  };
  getClipboardSnapshot = () => this.clipboardSummary;
  subscribeClipboard = (notify: () => void) => {
    this.clipboardListeners.add(notify);
    return () => {
      this.clipboardListeners.delete(notify);
    };
  };
  clearClipboard = () => {
    this.#clipboard = undefined;
    this.clipboardSummary = Object.freeze({ available: false, nodeCount: 0 });
    this.clipboardListeners.forEach((notify) => notify());
  };
  copyNodeToClipboard = (pageId: string, nodeId: string): void => {
    this.copyNodesToClipboard(pageId, [nodeId]);
  };
  copyNodesToClipboard = (pageId: string, ids: readonly string[]): void => {
    const { forest, nodeCount, sourcePageTitle } = this.captureStaticForest(pageId, ids);
    this.#clipboard = forest;
    this.clipboardSummary = Object.freeze({
      available: true,
      nodeCount,
      sourcePageId: pageId,
      sourcePageTitle,
      ...(forest.nodes.length === 1
        ? { component: forest.nodes[0]!.component }
        : { rootCount: forest.nodes.length }),
    });
    this.clipboardListeners.forEach((notify) => notify());
  };
  private captureStaticForest = (pageId: string, ids: readonly string[]) => {
    const page = this.snapshot.plan.pages.get(pageId)?.schema;
    if (!page) throw new Error('未知页面 ' + pageId);
    if (page.code?.enabled) throw new Error('代码页面暂不支持组件剪贴板');
    if (!ids.length) throw new Error('请先选择静态组件');
    const known = new Set(pageNodeOrder(page));
    for (const id of ids) if (!known.has(id)) throw new Error('复制目标节点不存在');
    const nodes = topSelectedNodeIds(page, ids).map((id) =>
      structuredClone(findNode(page, id)!.node),
    );
    const components = new Set<string>();
    let nodeCount = 0;
    for (const node of nodes) {
      const inspected = inspectClipboardTree(node, this.snapshot.plan.registry);
      for (const component of inspected.components) components.add(component);
      nodeCount += inspected.nodeCount;
    }
    const pins = Object.fromEntries(
      [...components].map((component) => [
        component,
        this.snapshot.plan.schema.dependencies.components[component],
      ]),
    );
    return {
      forest: freeze({ nodes, components: pins }),
      nodeCount,
      sourcePageTitle: page.title,
    };
  };
  saveFragment = (pageId: string, explicitIds: readonly string[], input: string): string => {
    const name = normalizeSavedFragmentName(input);
    if (this.savedFragmentsSnapshot.items.some((item) => item.name === name))
      throw new Error('已存在同名会话片段，请使用其他名称');
    if (this.#savedFragments.size >= SAVED_FRAGMENT_LIMIT)
      throw new Error(`最多保存 ${SAVED_FRAGMENT_LIMIT} 个会话片段，请先删除不需要的片段`);
    const { forest, nodeCount, sourcePageTitle } = this.captureStaticForest(pageId, explicitIds);
    const sequence = this.savedFragmentSequence + 1;
    const id = `fragment-${sequence}`;
    const summary = freeze({
      id,
      name,
      sourcePageId: pageId,
      sourcePageTitle,
      rootCount: forest.nodes.length,
      nodeCount,
      ...(forest.nodes.length === 1 ? { component: forest.nodes[0]!.component } : {}),
    });
    const next = freeze({ items: [...this.savedFragmentsSnapshot.items, summary] });
    this.#savedFragments.set(id, { forest, summary });
    this.savedFragmentSequence = sequence;
    this.savedFragmentsSnapshot = next;
    this.savedFragmentListeners.forEach((notify) => notify());
    return id;
  };
  removeSavedFragment = (itemId: string): void => {
    this.savedFragment(itemId);
    const next = freeze({
      items: this.savedFragmentsSnapshot.items.filter((item) => item.id !== itemId),
    });
    this.#savedFragments.delete(itemId);
    this.savedFragmentsSnapshot = next;
    this.savedFragmentListeners.forEach((notify) => notify());
  };
  private savedFragment = (itemId: string) => {
    const item = this.#savedFragments.get(itemId);
    if (!item) throw new Error('会话片段不存在，请重新选择');
    return item;
  };
  usesRegistry = (registry: Registry) => this.registry === registry;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => this.listeners.delete(notify);
  };
  endGroup = () => {
    this.group = undefined;
  };
  private normalize(plan: ApplicationPlan, selection: Selection): Readonly<Selection> {
    const page = plan.pages.get(selection.pageId);
    if (!page) return Object.freeze({ pageId: plan.schema.entryPageId, nodeId: null });
    return canonicalSelection(page.schema, selectedNodeIds(selection), selection.nodeId);
  }
  private publish(entry: Entry, change: string, increment = true) {
    this.snapshot = Object.freeze({
      ...entry,
      selection: this.normalize(entry.plan, entry.selection),
      canUndo: this.past.length > 0,
      canRedo: this.future.length > 0,
      revision: this.snapshot.revision + (increment ? 1 : 0),
      change,
    });
    this.listeners.forEach((notify) => notify());
  }
  private commit(
    input: unknown,
    change: string,
    selection = this.snapshot.selection,
    group?: string,
  ): boolean {
    const plan = compileApplication(input, this.registry);
    if (JSON.stringify(plan.schema) === JSON.stringify(this.snapshot.plan.schema)) return false;
    if (!group || group !== this.group || !this.past.length) {
      this.past.push({ plan: this.snapshot.plan, selection: this.snapshot.selection });
      if (this.past.length > this.historyLimit) this.past.shift();
    }
    this.group = group;
    this.future = [];
    for (const id of plan.pages.keys()) this.reservedPageIds.add(id);
    for (const method of plan.schema.methods ?? []) this.reservedMethodIds.add(method.id);
    this.publish({ plan, selection }, change);
    return true;
  }
  private draft(pageId: string) {
    const schema = structuredClone(this.snapshot.plan.schema);
    const page = schema.pages.find((p) => p.id === pageId);
    if (!page) throw new Error('未知页面 ' + pageId);
    return { schema, page };
  }
  private targetList(page: PageSchema, target: InsertTarget): NodeSchema[] {
    if (!target.parentId) {
      if (target.slot !== undefined) throw new Error('插槽必须指定所属节点');
      return page.children;
    }
    const parent = findNode(page, target.parentId)?.node;
    if (!parent) throw new Error('插入目标节点不存在');
    const contract = this.registry.components[parent.component];
    if (target.slot !== undefined) {
      if (!contract.slots || !Object.hasOwn(contract.slots, target.slot))
        throw new Error('组件不提供该插槽');
      parent.slots ??= {};
      parent.slots[target.slot] ??= { params: [...contract.slots[target.slot]], children: [] };
      return parent.slots[target.slot].children;
    }
    if (!contract.children) throw new Error('该组件不接收子节点');
    return (parent.children ??= []);
  }
  private insertInto(list: NodeSchema[], node: NodeSchema, index = list.length) {
    if (!Number.isInteger(index) || index < 0 || index > list.length)
      throw new Error('插入位置超出范围');
    list.splice(index, 0, node);
  }
  private pageTitle(title: string) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('页面名称不能为空');
    return title.trim();
  }
  renameApplication = (title: string): boolean => {
    if (typeof title !== 'string' || !title.trim()) throw new Error('应用名称不能为空');
    const schema = structuredClone(this.snapshot.plan.schema);
    const normalized = title.trim();
    if (schema.title === normalized) return false;
    schema.title = normalized;
    return this.commit(schema, '重命名应用');
  };
  createApplicationMethod = (
    input: string | Omit<ApplicationMethod, 'id'> = '新建方法',
  ): string => {
    const schema = structuredClone(this.snapshot.plan.schema);
    const draft: Omit<ApplicationMethod, 'id'> =
      typeof input === 'string'
        ? { title: input, inputType: 'json', outputType: 'json', source: 'return input.payload;' }
        : input;
    const normalized = draft.title.trim();
    if (!normalized) throw new Error('方法名称不能为空');
    let index = 1;
    while (this.reservedMethodIds.has(`method-${index}`)) index++;
    const id = `method-${index}`;
    const method: ApplicationMethod = {
      ...draft,
      id,
      title: normalized,
    };
    schema.methods = [...(schema.methods ?? []), method];
    this.commit(schema, `新建应用方法 ${normalized}`);
    return id;
  };
  updateApplicationMethod = (
    methodId: string,
    patch: Partial<
      Pick<ApplicationMethod, 'title' | 'description' | 'inputType' | 'outputType' | 'source'>
    >,
  ): boolean => {
    const schema = structuredClone(this.snapshot.plan.schema);
    const method = schema.methods?.find((item) => item.id === methodId);
    if (!method) throw new Error(`未知应用方法 ${methodId}`);
    const next = { ...method, ...patch };
    next.title = next.title.trim();
    if (!next.title) throw new Error('方法名称不能为空');
    schema.methods = schema.methods!.map((item) => (item.id === methodId ? next : item));
    return this.commit(schema, `修改应用方法 ${next.title}`);
  };
  removeApplicationMethod = (methodId: string): boolean => {
    const schema = structuredClone(this.snapshot.plan.schema);
    if (!schema.methods?.some((method) => method.id === methodId))
      throw new Error(`未知应用方法 ${methodId}`);
    schema.methods = schema.methods.filter((method) => method.id !== methodId);
    return this.commit(schema, `删除应用方法 ${methodId}`);
  };
  private allocatePageId() {
    let index = 1;
    while (
      this.reservedPageIds.has(`page-${index}`) ||
      this.snapshot.plan.pages.has(`page-${index}`)
    )
      index++;
    return `page-${index}`;
  }
  createPage = (title: string): string => {
    const name = this.pageTitle(title);
    const schema = structuredClone(this.snapshot.plan.schema);
    const id = this.allocatePageId();
    schema.pages.push({ id, title: name, state: [], children: [] });
    this.commit(schema, '新建页面 ' + name, { pageId: id, nodeId: null });
    return id;
  };
  renamePage = (pageId: string, title: string): boolean => {
    const { schema, page } = this.draft(pageId);
    page.title = this.pageTitle(title);
    return this.commit(schema, '重命名页面');
  };
  setPageGroup = (pageId: string, group: string): boolean => {
    const { schema, page } = this.draft(pageId);
    if (typeof group !== 'string') throw new Error('页面分组必须是文本');
    const normalized = group.trim();
    const extensions = { ...(page.extensions ?? {}) };
    const editor = {
      ...(extensions['dimlu:editor'] && typeof extensions['dimlu:editor'] === 'object'
        ? (extensions['dimlu:editor'] as Record<string, import('../schema/types').Json>)
        : {}),
    };
    if (normalized) editor.group = normalized;
    else delete editor.group;
    if (Object.keys(editor).length) extensions['dimlu:editor'] = editor;
    else delete extensions['dimlu:editor'];
    if (Object.keys(extensions).length) page.extensions = extensions;
    else delete page.extensions;
    return this.commit(schema, normalized ? '设置页面分组' : '移出页面分组');
  };
  duplicatePage = (pageId: string, title?: string): string => {
    const { schema, page } = this.draft(pageId);
    const name = this.pageTitle(title === undefined ? page.title + ' 副本' : title);
    const id = this.allocatePageId();
    const copy = { ...structuredClone(page), id, title: name };
    schema.pages.splice(schema.pages.findIndex((item) => item.id === pageId) + 1, 0, copy);
    this.commit(schema, '复制页面 ' + page.title, {
      pageId: id,
      nodeId: copy.children[0]?.id ?? null,
    });
    return id;
  };
  movePage = (pageId: string, index: number): boolean => {
    const { schema, page } = this.draft(pageId);
    if (!Number.isInteger(index) || index < 0 || index >= schema.pages.length)
      throw new Error('页面位置超出范围');
    schema.pages.splice(
      schema.pages.findIndex((item) => item.id === pageId),
      1,
    );
    schema.pages.splice(index, 0, page);
    return this.commit(schema, '调整页面顺序');
  };
  setEntryPage = (pageId: string): boolean => {
    const { schema } = this.draft(pageId);
    schema.entryPageId = pageId;
    return this.commit(schema, '设置入口页面');
  };
  removePage = (pageId: string, replacementEntryId?: string): boolean => {
    const { schema } = this.draft(pageId);
    if (schema.pages.length === 1) throw new Error('至少保留一个页面');
    if (schema.entryPageId === pageId) {
      if (
        !replacementEntryId ||
        replacementEntryId === pageId ||
        !schema.pages.some((page) => page.id === replacementEntryId)
      )
        throw new Error('删除入口页面前请选择其他页面作为新入口');
      schema.entryPageId = replacementEntryId;
    } else if (replacementEntryId !== undefined) {
      throw new Error('仅删除入口页面时可以指定新入口');
    }
    schema.pages = schema.pages.filter((page) => page.id !== pageId);
    const entry = schema.pages.find((page) => page.id === schema.entryPageId)!;
    const selection =
      this.snapshot.selection.pageId === pageId
        ? { pageId: entry.id, nodeId: entry.children[0]?.id ?? null }
        : this.snapshot.selection;
    return this.commit(schema, '删除页面', selection);
  };
  selectPage = (pageId: string) => {
    const page = this.snapshot.plan.pages.get(pageId);
    if (!page) throw new Error('未知页面 ' + pageId);
    this.select(pageId, page.schema.children[0]?.id ?? null);
  };
  select = (pageId: string, nodeId: string | null) => {
    const page = this.snapshot.plan.pages.get(pageId);
    if (!page || (nodeId && !findNode(page.schema, nodeId))) throw new Error('选中节点不存在');
    this.endGroup();
    if (
      pageId === this.snapshot.selection.pageId &&
      nodeId === this.snapshot.selection.nodeId &&
      !this.snapshot.selection.nodeIds
    )
      return;
    this.publish(
      { plan: this.snapshot.plan, selection: { pageId, nodeId } },
      this.snapshot.change,
      false,
    );
  };
  selectMany = (pageId: string, nodeIds: readonly string[], primaryNodeId?: string) => {
    const page = this.snapshot.plan.pages.get(pageId)?.schema;
    if (!page) throw new Error('未知页面 ' + pageId);
    const known = new Set(pageNodeOrder(page));
    if (nodeIds.some((id) => !known.has(id))) throw new Error('选中节点不存在');
    if (primaryNodeId !== undefined && !nodeIds.includes(primaryNodeId))
      throw new Error('主选组件必须属于选区');
    const selection = canonicalSelection(page, nodeIds, primaryNodeId);
    this.endGroup();
    if (JSON.stringify(selection) === JSON.stringify(this.snapshot.selection)) return;
    this.publish({ plan: this.snapshot.plan, selection }, this.snapshot.change, false);
  };
  toggleSelect = (pageId: string, nodeId: string) => {
    if (pageId !== this.snapshot.selection.pageId) throw new Error('不能跨页面切换多选组件');
    const current = selectedNodeIds(this.snapshot.selection);
    const selected = current.includes(nodeId);
    const ids = selected ? current.filter((id) => id !== nodeId) : [...current, nodeId];
    // Validate even a removed item; unknown IDs must never be silently ignored.
    const page = this.snapshot.plan.pages.get(pageId)?.schema;
    if (!page || !findNode(page, nodeId)) throw new Error('选中节点不存在');
    const primary = selected
      ? this.snapshot.selection.nodeId === nodeId
        ? undefined
        : (this.snapshot.selection.nodeId ?? undefined)
      : nodeId;
    this.selectMany(pageId, ids, primary);
  };
  setProp = (
    pageId: string,
    nodeId: string,
    name: string,
    value: Value | undefined,
    group?: string,
  ) => this.setProps(pageId, nodeId, { [name]: value }, group);
  /** Author-only metadata; retain the complete current selection and isolate history. */
  setNodeName = (pageId: string, nodeId: string, input: string): boolean => {
    const { schema, page } = this.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('名称目标节点不存在');
    const name = normalizeNodeName(input);
    if (name === readNodeName(node)) return false;
    const extensions = { ...node.extensions };
    if (name === undefined) delete extensions[NODE_NAME_EXTENSION];
    else extensions[NODE_NAME_EXTENSION] = name;
    if (Object.keys(extensions).length) node.extensions = extensions;
    else delete node.extensions;
    return this.commit(schema, '修改编辑器名称');
  };
  /** One validated edit changes condition and loop together; absence preserves, undefined deletes. */
  /** Structural publication only. Compilation and activation never run inside the document. */
  setPageCode = (pageId: string, code: PageCode | undefined) => {
    const { schema, page } = this.draft(pageId);
    if (code === undefined) delete page.code;
    else page.code = structuredClone(code);
    return this.commit(schema, code?.enabled ? '保存页面代码' : '禁用页面代码');
  };

  setNodeLogic = (
    pageId: string,
    nodeId: string,
    patch: { when?: Value | undefined; repeat?: NodeSchema['repeat'] | undefined },
  ) => {
    const before = this.snapshot.plan.pages.get(pageId)?.schema;
    const { schema, page } = this.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('逻辑目标节点不存在');
    for (const key of ['when', 'repeat'] as const)
      if (Object.hasOwn(patch, key)) {
        if (patch[key] === undefined) delete node[key];
        else if (key === 'when') node.when = structuredClone(patch.when!);
        else node.repeat = structuredClone(patch.repeat!);
      }
    assertLogicScope(before!, page);
    return this.commit(schema, '修改组件逻辑', { pageId, nodeId });
  };
  /** Patch explicit declarations atomically; empty patches leave legacy props untouched. */
  setStyle = (
    pageId: string,
    nodeId: string,
    patch: Partial<Record<import('../schema/style').StyleProperty, Value | undefined>>,
    group?: string,
  ) => {
    const { schema, page } = this.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('样式目标节点不存在');
    assertActionScope(
      page,
      nodeId,
      Object.values(patch).filter((value): value is Value => value !== undefined),
    );
    const style = { ...node.style };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete style[key as keyof typeof style];
      else style[key as keyof typeof style] = structuredClone(value);
    }
    if (Object.keys(style).length) node.style = style;
    else delete node.style;
    return this.commit(schema, '修改组件样式', { pageId, nodeId }, group);
  };
  private registerActionDependency(schema: ApplicationSchema, actionId: string) {
    const actions = this.snapshot.plan.registry.actions;
    if (!Object.hasOwn(actions, actionId)) throw new Error('未注册动作 ' + actionId);
    if (Object.hasOwn(this.registry.actions, actionId))
      schema.dependencies.actions[actionId] ??= actions[actionId].version;
  }
  /** Page entry is a page-scoped definition; saving never executes its actions. */
  setPageEnterActions = (pageId: string, actions: ActionCall[]) => {
    const { schema, page } = this.draft(pageId);
    const calls = structuredClone(actions);
    for (const call of calls) {
      this.registerActionDependency(schema, call.action);
      for (const value of Object.values(call.input)) {
        const compiled = compileValue(value);
        if (compiled.usesEvent || compiled.usesScope)
          throw new Error('页面进入动作不能访问 event 或 scope');
      }
    }
    if (calls.length) page.onEnter = calls;
    else delete page.onEnter;
    return this.commit(schema, '保存页面进入动作');
  };
  /** The entire event chain is one validated edit and one undo entry. */
  setEventActions = (pageId: string, nodeId: string, eventName: string, actions: ActionCall[]) => {
    const { schema, page } = this.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('事件目标节点不存在');
    const component = this.registry.components[node.component];
    if (!component.events?.includes(eventName)) throw new Error(`不支持事件 ${eventName}`);
    if (
      node.field &&
      ['onChange', 'onValueChange', 'onCheckedChange', 'onBlur'].includes(eventName)
    )
      throw new Error('此事件由表单字段适配器管理');
    assertActionScope(
      page,
      nodeId,
      actions.flatMap((action) => Object.values(action.input)),
    );
    for (const action of actions) this.registerActionDependency(schema, action.action);
    if (actions.length) (node.on ??= {})[eventName] = structuredClone(actions);
    else if (node.on) {
      delete node.on[eventName];
      if (!Object.keys(node.on).length) delete node.on;
    }
    return this.commit(schema, `保存事件 ${eventName}`, { pageId, nodeId });
  };
  /** Related property changes share validation and one undo entry. */
  setProps = (
    pageId: string,
    nodeId: string,
    patch: Record<string, Value | undefined>,
    group?: string,
  ) => {
    const { schema, page } = this.draft(pageId);
    const location = findNode(page, nodeId);
    if (!location) throw new Error('属性目标节点不存在');
    const props = this.registry.components[location.node.component]?.props;
    for (const [name, value] of Object.entries(patch)) {
      if (!props || !Object.hasOwn(props, name)) throw new Error('未知组件属性 ' + name);
      if (value === undefined) delete location.node.props[name];
      else location.node.props[name] = structuredClone(value);
    }
    return this.commit(
      schema,
      '修改属性 ' + Object.keys(patch).join('、'),
      { pageId, nodeId },
      group,
    );
  };
  private form(page: PageSchema, id: string) {
    const form = page.forms?.find((f) => f.id === id);
    if (!form) throw new Error('表单不存在 ' + id);
    return form;
  }
  createState = (pageId: string, input: StateDefinition) => {
    const { schema, page } = this.draft(pageId);
    if (page.state.some((state) => state.id === input.id)) throw new Error('状态 ID 已存在');
    page.state.push(structuredClone(input));
    return this.commit(schema, '创建页面状态 ' + input.id);
  };
  updateState = (pageId: string, id: string, input: Omit<StateDefinition, 'id'>) => {
    const { schema, page } = this.draft(pageId);
    const state = page.state.find((state) => state.id === id);
    if (!state) throw new Error('状态不存在 ' + id);
    Object.assign(state, structuredClone(input), { id });
    return this.commit(schema, '保存页面状态 ' + id);
  };
  removeState = (pageId: string, id: string) => {
    const { schema, page } = this.draft(pageId);
    if (!page.state.some((state) => state.id === id)) throw new Error('状态不存在 ' + id);
    const refs = stateReferences(page, id);
    if (refs.length) throw new Error('状态仍被引用：' + refs.join('；'));
    page.state = page.state.filter((state) => state.id !== id);
    return this.commit(schema, '删除页面状态 ' + id);
  };
  createDataSource = (pageId: string, input: DataSourceDefinition) => {
    const { schema, page } = this.draft(pageId);
    if (page.dataSources?.some((source) => source.id === input.id))
      throw new Error('数据源 ID 已存在');
    const transport = this.registry.transports?.[input.transport];
    if (!transport) throw new Error('未注册 transport ' + input.transport);
    (schema.dependencies.transports ??= {})[input.transport] ??= transport.version;
    (page.dataSources ??= []).push(structuredClone(input));
    return this.commit(schema, '创建数据源 ' + input.id);
  };
  updateDataSource = (pageId: string, id: string, input: Omit<DataSourceDefinition, 'id'>) => {
    const { schema, page } = this.draft(pageId);
    const source = page.dataSources?.find((source) => source.id === id);
    if (!source) throw new Error('数据源不存在 ' + id);
    const transport = this.registry.transports?.[input.transport];
    if (!transport) throw new Error('未注册 transport ' + input.transport);
    (schema.dependencies.transports ??= {})[input.transport] ??= transport.version;
    Object.assign(source, structuredClone(input), { id });
    return this.commit(schema, '保存数据源 ' + id);
  };
  removeDataSource = (pageId: string, id: string) => {
    const { schema, page } = this.draft(pageId);
    if (!page.dataSources?.some((source) => source.id === id))
      throw new Error('数据源不存在 ' + id);
    const refs = sourceReferences(
      { ...page, dataSources: page.dataSources.filter((source) => source.id !== id) },
      id,
    );
    if (refs.length) throw new Error('数据源仍被引用：' + refs.join('；'));
    page.dataSources = page.dataSources.filter((source) => source.id !== id);
    return this.commit(schema, '删除数据源 ' + id);
  };
  private bindFieldDraft(page: PageSchema, nodeId: string, formId: string, fieldId: string) {
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('绑定目标节点不存在');
    const field = this.form(page, formId).fields.find((f) => f.id === fieldId);
    const contract = this.registry.components[node.component];
    const literals = Object.fromEntries(
      Object.entries(node.props)
        .filter(([, value]) => value.kind === 'literal')
        .map(([key, value]) => [key, value.kind === 'literal' ? value.value : undefined]),
    );
    if (
      !field ||
      !contract.field ||
      !acceptsField(contract, field.type, literals, field.itemType, field)
    )
      throw new Error('字段不存在或类型与组件不匹配');
    const owner = nearestForm(page, nodeId, this.registry);
    if (!owner?.formId) throw new Error('请先将组件放入已绑定模型的表单容器，再绑定字段');
    if (owner.formId !== formId) throw new Error(`只能绑定所属表单 ${owner.formId} 的字段`);
    if (
      node.when ||
      node.repeat ||
      node.on?.onChange ||
      node.on?.onBlur ||
      node.on?.onValueChange ||
      node.on?.onCheckedChange
    )
      throw new Error('请先处理组件的显示条件、循环或 change/blur 事件，再绑定字段');
    for (const key of managedFieldProps) {
      if (node.props[key] && node.props[key].kind !== 'literal')
        throw new Error(`属性 ${key} 已有动态绑定，请先处理后再绑定字段`);
    }
    for (const key of managedFieldProps) delete node.props[key];
    node.field = { formId, fieldId };
  }
  createForm = (pageId: string, nodeId: string, input: FormDefinition) => {
    const { schema, page } = this.draft(pageId);
    if (page.forms?.some((f) => f.id === input.id)) throw new Error('表单 ID 已存在');
    const node = findNode(page, nodeId)?.node;
    if (!node || !this.registry.components[node.component].form)
      throw new Error('该组件不支持表单绑定');
    input.fields.forEach(assertFieldRange);
    (page.forms ??= []).push(structuredClone(input));
    node.formId = input.id;
    assertLocalFieldBindings(page, node, this.registry);
    return this.commit(schema, '创建并绑定表单 ' + input.id, { pageId, nodeId });
  };
  bindForm = (pageId: string, nodeId: string, formId?: string) => {
    const { schema, page } = this.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node || !this.registry.components[node.component].form)
      throw new Error('该组件不支持表单绑定');
    if (formId) this.form(page, formId);
    if (formId) node.formId = formId;
    else delete node.formId;
    assertLocalFieldBindings(page, node, this.registry);
    return this.commit(schema, '修改表单绑定', { pageId, nodeId });
  };
  bindField = (pageId: string, nodeId: string, binding?: { formId: string; fieldId: string }) => {
    const { schema, page } = this.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('绑定目标节点不存在');
    if (binding) this.bindFieldDraft(page, nodeId, binding.formId, binding.fieldId);
    else if (node.field) {
      const field = this.form(page, node.field.formId).fields.find(
        (f) => f.id === node.field!.fieldId,
      )!;
      const contract = this.registry.components[node.component];
      // Unbinding restores a static value from the definition, never copies live preview data.
      const defaults: Record<string, Value> = {
        label: { kind: 'literal', value: field.label },
        [contract.field!.valueProp]: {
          kind: 'literal',
          value:
            contract.field!.changeEvent === 'onValueChange' ? field.initial : (field.initial ?? 0),
        },
        required: {
          kind: 'literal',
          value: !!field.rules?.some(
            (r) => r.kind === (field.type === 'boolean' ? 'mustBeTrue' : 'required'),
          ),
        },
      };
      for (const [key, value] of Object.entries(defaults))
        if (Object.hasOwn(contract.props, key)) node.props[key] = value;
      delete node.field;
    }
    return this.commit(schema, binding ? '绑定字段' : '解除字段绑定', { pageId, nodeId });
  };
  createField = (pageId: string, formId: string, input: FieldDefinition, nodeId?: string) => {
    const { schema, page } = this.draft(pageId);
    assertFieldRange(input);
    this.form(page, formId).fields.push(structuredClone(input));
    if (nodeId) this.bindFieldDraft(page, nodeId, formId, input.id);
    return this.commit(
      schema,
      '新增字段 ' + input.id,
      nodeId ? { pageId, nodeId } : this.snapshot.selection,
    );
  };
  configureFieldArray = (pageId: string, nodeId: string, input: FieldArrayDefinition) => {
    const { schema, page } = this.draft(pageId),
      node = findNode(page, nodeId)?.node;
    if (!node || !this.registry.components[node.component].fieldArray)
      throw new Error('当前组件不支持明细绑定');
    const owner = nearestForm(page, nodeId, this.registry);
    if (!owner?.formId) throw new Error('请先放入已绑定模型的表单容器');
    const form = this.form(page, owner.formId),
      arrays = (form.arrays ??= []);
    const currentId = node.props.arrayId?.kind === 'literal' ? node.props.arrayId.value : undefined;
    if (currentId && currentId !== input.id)
      throw new Error('已绑定明细不能直接修改 ID，请先解除绑定');
    const existing = arrays.findIndex((array) => array.id === input.id);
    if (existing >= 0 && currentId !== input.id)
      throw new Error('明细模型已存在，请从绑定列表选择');
    if (existing >= 0) arrays[existing] = structuredClone(input);
    else arrays.push(structuredClone(input));
    node.props.formId = { kind: 'literal', value: form.id };
    node.props.arrayId = { kind: 'literal', value: input.id };
    assertLocalFieldBindings(page, node, this.registry);
    return this.commit(schema, '保存并绑定明细模型', { pageId, nodeId });
  };
  bindFieldArray = (pageId: string, nodeId: string, arrayId?: string) => {
    const { schema, page } = this.draft(pageId),
      node = findNode(page, nodeId)?.node;
    if (!node || !this.registry.components[node.component].fieldArray)
      throw new Error('当前组件不支持明细绑定');
    if (arrayId) {
      const owner = nearestForm(page, nodeId, this.registry);
      if (
        !owner?.formId ||
        !this.form(page, owner.formId).arrays?.some((array) => array.id === arrayId)
      )
        throw new Error('只能绑定所属表单的明细模型');
      node.props.formId = { kind: 'literal', value: owner.formId };
      node.props.arrayId = { kind: 'literal', value: arrayId };
    } else {
      const formId = node.props.formId?.kind === 'literal' && node.props.formId.value,
        current = node.props.arrayId?.kind === 'literal' && node.props.arrayId.value;
      const array = page.forms
        ?.find((form) => form.id === formId)
        ?.arrays?.find((array) => array.id === current);
      if (array)
        for (const [key, value] of Object.entries({
          label: array.label,
          fields: array.fields,
          value: array.initial,
          minItems: array.minItems,
          maxItems: array.maxItems,
        })) {
          if (value !== undefined)
            node.props[key] = {
              kind: 'literal',
              value: structuredClone(value) as import('../schema/types').Json,
            };
          else delete node.props[key];
        }
      delete node.props.formId;
      delete node.props.arrayId;
    }
    return this.commit(schema, '修改明细绑定', { pageId, nodeId });
  };
  updateField = (
    pageId: string,
    formId: string,
    fieldId: string,
    input: Pick<FieldDefinition, 'label' | 'initial' | 'rules'>,
  ) => {
    const { schema, page } = this.draft(pageId);
    const field = this.form(page, formId).fields.find((f) => f.id === fieldId);
    if (!field) throw new Error('字段不存在 ' + fieldId);
    Object.assign(field, structuredClone(input));
    assertFieldRange(field);
    return this.commit(schema, '修改字段 ' + fieldId);
  };
  removeField = (pageId: string, formId: string, fieldId: string) => {
    const { schema, page } = this.draft(pageId);
    const form = this.form(page, formId);
    if (!form.fields.some((f) => f.id === fieldId)) throw new Error('字段不存在 ' + fieldId);
    const refs = formReferences(page, formId, fieldId);
    if (refs.length) throw new Error('字段仍被引用：' + refs.join('；'));
    form.fields = form.fields.filter((f) => f.id !== fieldId);
    return this.commit(schema, '删除字段 ' + fieldId);
  };
  removeForm = (pageId: string, formId: string) => {
    const { schema, page } = this.draft(pageId);
    this.form(page, formId);
    const refs = formReferences(page, formId);
    if (refs.length) throw new Error('表单仍被引用：' + refs.join('；'));
    page.forms = page.forms!.filter((f) => f.id !== formId);
    return this.commit(schema, '删除表单 ' + formId);
  };
  private prepareClipboardPaste = (pageId: string, target: InsertTarget = {}) => {
    if (!this.#clipboard) throw new Error('组件剪贴板为空，请先复制一个静态组件');
    return this.prepareStaticForestInsertion(pageId, this.#clipboard, target);
  };
  private prepareStaticForestInsertion = (
    pageId: string,
    forest: StaticForest,
    target: InsertTarget = {},
  ) => {
    const { schema, page } = this.draft(pageId);
    if (page.code?.enabled) throw new Error('代码页面暂不支持粘贴组件');
    const nodes = structuredClone(forest.nodes);
    for (const node of nodes) inspectClipboardTree(node, this.registry);
    for (const [component, version] of Object.entries(forest.components)) {
      if (
        this.registry.components[component].version !== version ||
        (Object.hasOwn(schema.dependencies.components, component) &&
          schema.dependencies.components[component] !== version)
      )
        throw new Error('组件依赖版本冲突 ' + component);
      schema.dependencies.components[component] = version;
    }
    const list = this.targetList(page, target);
    const index = target.index === undefined ? list.length : target.index;
    if (!Number.isInteger(index) || index < 0 || index > list.length)
      throw new Error('插入位置超出范围');
    const used = new Set<string>();
    const collect = (nodes: NodeSchema[]) => {
      for (const node of nodes) {
        used.add(node.id);
        for (const calls of Object.values(node.on ?? {}))
          for (const call of calls) used.add(call.id);
        collect(node.children ?? []);
        for (const slot of Object.values(node.slots ?? {})) collect(slot.children);
      }
    };
    collect(page.children);
    for (const call of page.onEnter ?? []) used.add(call.id);
    let sequence = this.idSequence;
    const reidentify = (node: NodeSchema) => {
      let id: string;
      do {
        id = node.component.replaceAll('.', '-') + '-' + ++sequence;
      } while (used.has(id));
      used.add(id);
      node.id = id;
      node.children?.forEach(reidentify);
      for (const slot of Object.values(node.slots ?? {})) slot.children.forEach(reidentify);
    };
    nodes.forEach(reidentify);
    list.splice(index, 0, ...nodes);
    for (const node of nodes) assertLocalFieldBindings(page, node, this.registry);
    return { schema, page, nodes, sequence };
  };
  checkPasteClipboard = (pageId: string, target: InsertTarget = {}): void => {
    if (this.#clipboard && this.#clipboard.nodes.length > 1)
      throw new Error('剪贴板包含多个顶层组件，请使用 checkPasteClipboardNodes');
    this.checkPasteClipboardNodes(pageId, target);
  };
  pasteClipboard = (pageId: string, target: InsertTarget = {}): string => {
    if (this.#clipboard && this.#clipboard.nodes.length > 1)
      throw new Error('剪贴板包含多个顶层组件，请使用 pasteClipboardNodes');
    return this.pasteClipboardNodes(pageId, target)[0]!;
  };
  checkPasteClipboardNodes = (pageId: string, target: InsertTarget = {}): void => {
    compileApplication(this.prepareClipboardPaste(pageId, target).schema, this.registry);
  };
  pasteClipboardNodes = (pageId: string, target: InsertTarget = {}): string[] => {
    const { schema, page, nodes, sequence } = this.prepareClipboardPaste(pageId, target);
    const ids = nodes.map((node) => node.id);
    const selection = canonicalSelection(page, ids, ids[0]);
    if (
      this.commit(
        schema,
        nodes.length === 1 ? '粘贴组件 ' + nodes[0]!.component : '粘贴组件组',
        selection,
      )
    )
      this.idSequence = sequence;
    return ids;
  };
  checkInsertSavedFragment = (pageId: string, itemId: string, target: InsertTarget = {}): void => {
    const { forest } = this.savedFragment(itemId);
    compileApplication(
      this.prepareStaticForestInsertion(pageId, forest, target).schema,
      this.registry,
    );
  };
  insertSavedFragment = (pageId: string, itemId: string, target: InsertTarget = {}): string[] => {
    const { forest, summary } = this.savedFragment(itemId);
    const { schema, page, nodes, sequence } = this.prepareStaticForestInsertion(
      pageId,
      forest,
      target,
    );
    const ids = nodes.map((node) => node.id);
    if (this.commit(schema, '插入会话片段 ' + summary.name, canonicalSelection(page, ids, ids[0])))
      this.idSequence = sequence;
    return ids;
  };
  /** Prepare an editor-owned literal tree without consuming IDs or changing editor state. */
  private prepareFragment = (
    pageId: string,
    input: MaterialTemplate,
    target: InsertTarget = {},
  ) => {
    const template = cloneMaterialTemplate(input, this.registry);
    const { schema, page } = this.draft(pageId);
    const used = new Set<string>();
    const collect = (nodes: NodeSchema[]) => {
      for (const node of nodes) {
        used.add(node.id);
        for (const calls of Object.values(node.on ?? {}))
          for (const call of calls) used.add(call.id);
        collect(node.children ?? []);
        for (const slot of Object.values(node.slots ?? {})) collect(slot.children);
      }
    };
    collect(page.children);
    for (const call of page.onEnter ?? []) used.add(call.id);
    let sequence = this.idSequence;
    const instantiate = (fragment: MaterialTemplate): NodeSchema => {
      const contract = this.registry.components[fragment.component];
      if (
        Object.hasOwn(schema.dependencies.components, fragment.component) &&
        schema.dependencies.components[fragment.component] !== contract.version
      )
        throw new Error('组件依赖版本冲突 ' + fragment.component);
      let id: string;
      do {
        id = fragment.component.replaceAll('.', '-') + '-' + ++sequence;
      } while (used.has(id));
      used.add(id);
      schema.dependencies.components[fragment.component] = contract.version;
      const node: NodeSchema = {
        id,
        component: fragment.component,
        props: Object.fromEntries(
          Object.entries(fragment.props).map(([name, value]) => [name, { kind: 'literal', value }]),
        ),
      };
      if (fragment.children) node.children = fragment.children.map(instantiate);
      if (contract.slots)
        node.slots = Object.fromEntries(
          Object.entries(contract.slots).map(([name, params]) => [
            name,
            {
              params: [...params],
              children: (fragment.slots?.[name]?.children ?? []).map(instantiate),
            },
          ]),
        );
      return node;
    };
    const node = instantiate(template);
    this.insertInto(this.targetList(page, target), node, target.index);
    assertLocalFieldBindings(page, node, this.registry);
    return { schema, node, sequence };
  };
  checkInsertFragment = (pageId: string, input: MaterialTemplate, target: InsertTarget = {}) => {
    compileApplication(this.prepareFragment(pageId, input, target).schema, this.registry);
  };
  insertFragment = (pageId: string, input: MaterialTemplate, target: InsertTarget = {}): string => {
    const { schema, node, sequence } = this.prepareFragment(pageId, input, target);
    if (this.commit(schema, '新增组件 ' + node.component, { pageId, nodeId: node.id }))
      this.idSequence = sequence;
    return node.id;
  };
  private prepareInsert = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
    preview = false,
  ) => {
    const { schema, page } = this.draft(pageId);
    const contract = Object.hasOwn(this.registry.components, input.component)
      ? this.registry.components[input.component]
      : undefined;
    if (!contract) throw new Error('未注册组件 ' + input.component);
    let id = input.id;
    let sequence = this.idSequence;
    if (!id)
      do {
        id = input.component.replaceAll('.', '-') + '-' + ++sequence;
      } while (findNode(page, id));
    if (!preview) this.idSequence = sequence;
    const node: NodeSchema = { ...structuredClone(input), id };
    if (contract.slots && !node.slots)
      node.slots = Object.fromEntries(
        Object.entries(contract.slots).map(([name, params]) => [
          name,
          { params: [...params], children: [] },
        ]),
      );
    this.insertInto(this.targetList(page, target), node, target.index);
    assertLocalFieldBindings(page, node, this.registry);
    schema.dependencies.components[node.component] = contract.version;
    return { schema, node };
  };
  checkInsert = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
  ) => {
    compileApplication(this.prepareInsert(pageId, input, target, true).schema, this.registry);
  };
  insertNode = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
  ): string => {
    const { schema, node } = this.prepareInsert(pageId, input, target);
    this.commit(schema, '新增组件 ' + node.component, { pageId, nodeId: node.id });
    return node.id;
  };
  /** index is the destination position after the source has been removed. */
  private prepareMove = (pageId: string, nodeId: string, target: InsertTarget = {}) => {
    const { schema, page } = this.draft(pageId);
    const source = findNode(page, nodeId);
    if (!source) throw new Error('移动目标节点不存在');
    if (target.parentId && containsNode(source.node, target.parentId))
      throw new Error('不能移动到自身或自己的子树');
    this.targetList(page, target);
    assertMoveScope(page, source.node, target);
    source.list.splice(source.index, 1);
    this.insertInto(this.targetList(page, target), source.node, target.index);
    assertLocalFieldBindings(page, source.node, this.registry);
    return schema;
  };
  checkMove = (pageId: string, nodeId: string, target: InsertTarget = {}) => {
    compileApplication(this.prepareMove(pageId, nodeId, target), this.registry);
  };
  moveNode = (pageId: string, nodeId: string, target: InsertTarget = {}): boolean => {
    const schema = this.prepareMove(pageId, nodeId, target);
    return this.commit(schema, '移动组件 ' + nodeId, { pageId, nodeId });
  };
  duplicateNode = (pageId: string, nodeId: string, target?: InsertTarget): string => {
    const { schema, page } = this.draft(pageId);
    const source = findNode(page, nodeId);
    if (!source) throw new Error('复制目标节点不存在');
    const destination = target ?? {
      parentId: source.parentId,
      slot: source.slot,
      index: source.index + 1,
    };
    const list = this.targetList(page, destination);
    assertMoveScope(page, source.node, destination);
    const used = new Set<string>();
    const collect = (nodes: NodeSchema[]) => {
      for (const node of nodes) {
        used.add(node.id);
        for (const calls of Object.values(node.on ?? {}))
          for (const call of calls) used.add(call.id);
        collect(node.children ?? []);
        for (const slot of Object.values(node.slots ?? {})) collect(slot.children);
      }
    };
    collect(page.children);
    for (const call of page.onEnter ?? []) used.add(call.id);
    const allocate = (base: string) => {
      let id: string;
      do {
        id = `${base}-copy-${++this.idSequence}`;
      } while (used.has(id));
      used.add(id);
      return id;
    };
    const copy = structuredClone(source.node);
    const reidentify = (node: NodeSchema) => {
      node.id = allocate(node.id);
      for (const calls of Object.values(node.on ?? {}))
        for (const call of calls) call.id = allocate(call.id);
      node.children?.forEach(reidentify);
      for (const slot of Object.values(node.slots ?? {})) slot.children.forEach(reidentify);
    };
    reidentify(copy);
    this.insertInto(list, copy, destination.index);
    assertLocalFieldBindings(page, copy, this.registry);
    this.commit(schema, '复制组件 ' + nodeId, { pageId, nodeId: copy.id });
    return copy.id;
  };
  private prepareDuplicateNodes = (pageId: string, nodeIds: readonly string[]) => {
    const before = this.snapshot.plan.pages.get(pageId)?.schema;
    if (!before) throw new Error('未知页面 ' + pageId);
    const known = new Set(pageNodeOrder(before));
    if (nodeIds.some((id) => !known.has(id))) throw new Error('复制目标节点不存在');
    if (!nodeIds.length) return null;
    const roots = topSelectedNodeIds(before, nodeIds);
    const sources = roots.map((id) => findNode(before, id)!);
    for (const source of sources) {
      inspectBulkDuplicateTree(source.node);
      assertMoveScope(before, source.node, { parentId: source.parentId, slot: source.slot });
    }
    const { schema, page } = this.draft(pageId);
    const used = new Set<string>();
    const collect = (nodes: readonly NodeSchema[]) => {
      for (const node of nodes) {
        used.add(node.id);
        for (const calls of Object.values(node.on ?? {}))
          for (const call of calls) used.add(call.id);
        collect(node.children ?? []);
        for (const slot of Object.values(node.slots ?? {})) collect(slot.children);
      }
    };
    collect(before.children);
    for (const call of before.onEnter ?? []) used.add(call.id);
    let sequence = this.idSequence;
    const allocate = (base: string) => {
      let id: string;
      do {
        id = `${base}-copy-${++sequence}`;
      } while (used.has(id));
      used.add(id);
      return id;
    };
    const reidentify = (node: NodeSchema) => {
      node.id = allocate(node.id);
      for (const calls of Object.values(node.on ?? {}))
        for (const call of calls) call.id = allocate(call.id);
      node.children?.forEach(reidentify);
      for (const slot of Object.values(node.slots ?? {})) slot.children.forEach(reidentify);
    };
    const copies = new Map<string, NodeSchema>();
    for (const source of sources) {
      const copy = structuredClone(source.node);
      reidentify(copy);
      copies.set(source.node.id, copy);
    }
    // Rebuild every original owner list once; inserted copies are never revisited.
    const insertCopies = (nodes: NodeSchema[]): NodeSchema[] =>
      nodes.flatMap((node) => {
        const copy = copies.get(node.id);
        if (copy) return [node, copy];
        if (node.children) node.children = insertCopies(node.children);
        for (const slot of Object.values(node.slots ?? {}))
          slot.children = insertCopies(slot.children);
        return [node];
      });
    page.children = insertCopies(page.children);
    for (const copy of copies.values()) assertLocalFieldBindings(page, copy, this.registry);
    const copiedIds = [...copies.values()].map((node) => node.id);
    const previous = this.snapshot.selection;
    const primarySource =
      previous.pageId === pageId && previous.nodeId
        ? sources.find((source) => containsNode(source.node, previous.nodeId!))
        : undefined;
    const primary = primarySource ? copies.get(primarySource.node.id)!.id : copiedIds[0];
    return { schema, copiedIds, selection: canonicalSelection(page, copiedIds, primary), sequence };
  };
  checkDuplicateNodes = (pageId: string, nodeIds: readonly string[]): void => {
    const candidate = this.prepareDuplicateNodes(pageId, nodeIds);
    if (candidate) compileApplication(candidate.schema, this.registry);
  };
  duplicateNodes = (pageId: string, nodeIds: readonly string[]): string[] => {
    const candidate = this.prepareDuplicateNodes(pageId, nodeIds);
    if (!candidate) return [];
    if (this.commit(candidate.schema, '创建所选组件副本', candidate.selection))
      this.idSequence = candidate.sequence;
    return candidate.copiedIds;
  };
  removeNode = (pageId: string, nodeId: string) => {
    const { schema, page } = this.draft(pageId),
      location = findNode(page, nodeId);
    if (!location) throw new Error('删除目标节点不存在');
    location.list.splice(location.index, 1);
    const selected = this.snapshot.selection;
    const nodeStillExists =
      selected.pageId !== pageId || !selected.nodeId || !!findNode(page, selected.nodeId);
    const selection = nodeStillExists
      ? selected
      : {
          pageId,
          nodeId:
            location.parentId ??
            location.list[location.index]?.id ??
            location.list[location.index - 1]?.id ??
            null,
        };
    return this.commit(schema, '删除组件 ' + nodeId, selection);
  };
  removeNodes = (pageId: string, nodeIds: readonly string[]): boolean => {
    const before = this.snapshot.plan.pages.get(pageId)?.schema;
    if (!before) throw new Error('未知页面 ' + pageId);
    const known = new Set(pageNodeOrder(before));
    if (nodeIds.some((id) => !known.has(id))) throw new Error('删除目标节点不存在');
    if (!nodeIds.length) return false;
    const roots = new Set(topSelectedNodeIds(before, nodeIds));
    const { schema, page } = this.draft(pageId);
    const remove = (list: NodeSchema[]): NodeSchema[] =>
      list.filter((node) => {
        if (roots.has(node.id)) return false;
        if (node.children) node.children = remove(node.children);
        for (const slot of Object.values(node.slots ?? {})) slot.children = remove(slot.children);
        return true;
      });
    page.children = remove(page.children);
    return this.commit(schema, '删除所选组件', { pageId, nodeId: null });
  };
  replace = (input: unknown) => {
    const changed = this.commit(input, '导入应用定义');
    this.clearClipboard();
    return changed;
  };
  importJson = (source: string) => this.replace(JSON.parse(source));
  exportJson = () => JSON.stringify(this.snapshot.plan.schema, null, 2) + '\n';
  undo = () => {
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push({ plan: this.snapshot.plan, selection: this.snapshot.selection });
    this.endGroup();
    this.publish(previous, '撤销');
  };
  redo = () => {
    const next = this.future.pop();
    if (!next) return;
    this.past.push({ plan: this.snapshot.plan, selection: this.snapshot.selection });
    this.endGroup();
    this.publish(next, '重做');
  };
}
