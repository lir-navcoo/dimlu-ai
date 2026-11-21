import { compileApplication, freeze, type ApplicationPlan } from '../runtime/engine';
import type { NodeSchema, PageSchema, ApplicationSchema } from '../schema/types';
import {
  findNode,
  containsNode,
  type DocumentHost,
  type EditorSnapshot,
  type InsertTarget,
  type NodeLocation,
} from './document-context';
import { DocumentPages } from './document-pages';
import { DocumentModels } from './document-models';
import { DocumentActions } from './document-actions';
import { DocumentNodeProps } from './document-node-props';
import { DocumentNodes } from './document-nodes';
import { DocumentClipboard } from './document-clipboard';
import { canonicalSelection, pageNodeOrder, selectedNodeIds, type Selection } from './selection';
export type { Selection } from './selection';
export type { EditorSnapshot, InsertTarget, NodeLocation };
export { findNode, containsNode };
export type { DocumentHost } from './document-context';

interface Entry {
  plan: ApplicationPlan;
  selection: Readonly<Selection>;
}

/** Every UI surface edits this document. Failed validation never mutates history or preview. */
export class EditorDocument {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  private snapshot!: EditorSnapshot;
  private group?: string;
  private idSequenceValue = 0;
  private reservedPageIds = new Set<string>();
  private reservedMethodIds = new Set<string>();
  private readonly pages: DocumentPages;
  private readonly models: DocumentModels;
  private readonly actions: DocumentActions;
  private readonly nodeProps: DocumentNodeProps;
  private readonly nodes: DocumentNodes;
  private readonly clipboardDomain: DocumentClipboard;
  private readonly host: DocumentHost;

  constructor(
    input: unknown,
    private registry: import('../runtime/registry').Registry,
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
    this.host = {
      registry: () => this.registry,
      plan: () => this.snapshot.plan,
      selection: () => this.snapshot.selection,
      draft: (pageId) => this.draft(pageId),
      commit: (input, change, selection, group) =>
        this.commit(input, change, selection, group),
      targetList: (page, target) => this.targetList(page, target),
      insertInto: (list, node, index) => this.insertInto(list, node, index),
      idSequence: () => this.idSequenceValue,
      setIdSequence: (value) => {
        this.idSequenceValue = value;
      },
      allocatePageId: () => this.allocatePageId(),
      allocateMethodId: () => this.allocateMethodId(),
    };
    this.pages = new DocumentPages(this.host);
    this.models = new DocumentModels(this.host);
    this.actions = new DocumentActions(this.host);
    this.nodeProps = new DocumentNodeProps(this.host);
    this.nodes = new DocumentNodes(this.host);
    this.clipboardDomain = new DocumentClipboard(this.host);
  }

  getSnapshot = () => this.snapshot;
  usesRegistry = (registry: import('../runtime/registry').Registry) => this.registry === registry;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => this.listeners.delete(notify);
  };
  endGroup = () => {
    this.group = undefined;
  };

  // --- Transaction core ---------------------------------------------------------------

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

  // --- Tree primitives shared by collaborators ----------------------------------------

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

  private allocatePageId() {
    let index = 1;
    while (
      this.reservedPageIds.has(`page-${index}`) ||
      this.snapshot.plan.pages.has(`page-${index}`)
    )
      index++;
    return `page-${index}`;
  }

  private allocateMethodId() {
    let index = 1;
    while (this.reservedMethodIds.has(`method-${index}`)) index++;
    return `method-${index}`;
  }

  // --- Selection -----------------------------------------------------------------------

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

  // --- Domain delegation ----------------------------------------------------------------

  renameApplication = (title: string) => this.pages.renameApplication(title);
  createPage = (title: string) => this.pages.createPage(title);
  renamePage = (pageId: string, title: string) => this.pages.renamePage(pageId, title);
  setPageGroup = (pageId: string, group: string) => this.pages.setPageGroup(pageId, group);
  duplicatePage = (pageId: string, title?: string) => this.pages.duplicatePage(pageId, title);
  movePage = (pageId: string, index: number) => this.pages.movePage(pageId, index);
  setEntryPage = (pageId: string) => this.pages.setEntryPage(pageId);
  removePage = (pageId: string, replacementEntryId?: string) =>
    this.pages.removePage(pageId, replacementEntryId);
  setPageCode = (pageId: string, code: import('../schema/types').PageCode | undefined) =>
    this.pages.setPageCode(pageId, code);

  createApplicationMethod = (
    input?: string | Omit<import('../schema/types').ApplicationMethod, 'id'>,
  ) => this.actions.createApplicationMethod(input);
  updateApplicationMethod = (
    methodId: string,
    patch: Partial<
      Pick<
        import('../schema/types').ApplicationMethod,
        'title' | 'description' | 'inputType' | 'outputType' | 'source'
      >
    >,
  ) => this.actions.updateApplicationMethod(methodId, patch);
  removeApplicationMethod = (methodId: string) =>
    this.actions.removeApplicationMethod(methodId);
  setPageEnterActions = (pageId: string, actions: import('../schema/types').ActionCall[]) =>
    this.actions.setPageEnterActions(pageId, actions);
  setPageLeaveActions = (pageId: string, actions: import('../schema/types').ActionCall[]) =>
    this.actions.setPageLeaveActions(pageId, actions);
  setEventActions = (
    pageId: string,
    nodeId: string,
    eventName: string,
    actions: import('../schema/types').ActionCall[],
  ) => this.actions.setEventActions(pageId, nodeId, eventName, actions);

  setProp = (
    pageId: string,
    nodeId: string,
    name: string,
    value: import('../schema/types').Value | undefined,
    group?: string,
  ) => this.nodeProps.setProp(pageId, nodeId, name, value, group);
  setProps = (
    pageId: string,
    nodeId: string,
    patch: Record<string, import('../schema/types').Value | undefined>,
    group?: string,
  ) => this.nodeProps.setProps(pageId, nodeId, patch, group);
  setNodeName = (pageId: string, nodeId: string, input: string) =>
    this.nodeProps.setNodeName(pageId, nodeId, input);
  setNodeLogic = (
    pageId: string,
    nodeId: string,
    patch: {
      when?: import('../schema/types').Value | undefined;
      repeat?: NodeSchema['repeat'] | undefined;
    },
  ) => this.nodeProps.setNodeLogic(pageId, nodeId, patch);
  setStyle = (
    pageId: string,
    nodeId: string,
    patch: Partial<Record<import('../schema/style').StyleProperty, import('../schema/types').Value | undefined>>,
    group?: string,
  ) => this.nodeProps.setStyle(pageId, nodeId, patch, group);

  createState = (pageId: string, input: import('../schema/types').StateDefinition) =>
    this.models.createState(pageId, input);
  updateState = (
    pageId: string,
    id: string,
    input: Omit<import('../schema/types').StateDefinition, 'id'>,
  ) => this.models.updateState(pageId, id, input);
  removeState = (pageId: string, id: string) => this.models.removeState(pageId, id);
  createDataSource = (
    pageId: string,
    input: import('../schema/types').DataSourceDefinition,
  ) => this.models.createDataSource(pageId, input);
  updateDataSource = (
    pageId: string,
    id: string,
    input: Omit<import('../schema/types').DataSourceDefinition, 'id'>,
  ) => this.models.updateDataSource(pageId, id, input);
  removeDataSource = (pageId: string, id: string) => this.models.removeDataSource(pageId, id);
  createForm = (
    pageId: string,
    nodeId: string,
    input: import('../schema/types').FormDefinition,
  ) => this.models.createForm(pageId, nodeId, input);
  bindForm = (pageId: string, nodeId: string, formId?: string) =>
    this.models.bindForm(pageId, nodeId, formId);
  bindField = (
    pageId: string,
    nodeId: string,
    binding?: { formId: string; fieldId: string },
  ) => this.models.bindField(pageId, nodeId, binding);
  createField = (
    pageId: string,
    formId: string,
    input: import('../schema/types').FieldDefinition,
    nodeId?: string,
  ) => this.models.createField(pageId, formId, input, nodeId);
  configureFieldArray = (
    pageId: string,
    nodeId: string,
    input: import('../schema/types').FieldArrayDefinition,
  ) => this.models.configureFieldArray(pageId, nodeId, input);
  bindFieldArray = (pageId: string, nodeId: string, arrayId?: string) =>
    this.models.bindFieldArray(pageId, nodeId, arrayId);
  updateField = (
    pageId: string,
    formId: string,
    fieldId: string,
    input: Pick<import('../schema/types').FieldDefinition, 'label' | 'initial' | 'rules'>,
  ) => this.models.updateField(pageId, formId, fieldId, input);
  removeField = (pageId: string, formId: string, fieldId: string) =>
    this.models.removeField(pageId, formId, fieldId);
  removeForm = (pageId: string, formId: string) => this.models.removeForm(pageId, formId);

  checkInsert = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
  ) => this.nodes.checkInsert(pageId, input, target);
  insertNode = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
  ) => this.nodes.insertNode(pageId, input, target);
  checkMove = (pageId: string, nodeId: string, target: InsertTarget = {}) =>
    this.nodes.checkMove(pageId, nodeId, target);
  moveNode = (pageId: string, nodeId: string, target: InsertTarget = {}) =>
    this.nodes.moveNode(pageId, nodeId, target);
  duplicateNode = (pageId: string, nodeId: string, target?: InsertTarget) =>
    this.nodes.duplicateNode(pageId, nodeId, target);
  checkDuplicateNodes = (pageId: string, nodeIds: readonly string[]) =>
    this.nodes.checkDuplicateNodes(pageId, nodeIds);
  duplicateNodes = (pageId: string, nodeIds: readonly string[]) =>
    this.nodes.duplicateNodes(pageId, nodeIds);
  removeNode = (pageId: string, nodeId: string) => this.nodes.removeNode(pageId, nodeId);
  removeNodes = (pageId: string, nodeIds: readonly string[]) =>
    this.nodes.removeNodes(pageId, nodeIds);
  checkInsertFragment = (
    pageId: string,
    input: import('./material-template').MaterialTemplate,
    target: InsertTarget = {},
  ) => this.nodes.checkInsertFragment(pageId, input, target);
  insertFragment = (
    pageId: string,
    input: import('./material-template').MaterialTemplate,
    target: InsertTarget = {},
  ) => this.nodes.insertFragment(pageId, input, target);

  getSavedFragmentsSnapshot = () => this.clipboardDomain.getSavedFragmentsSnapshot();
  subscribeSavedFragments = (notify: () => void) =>
    this.clipboardDomain.subscribeSavedFragments(notify);
  getClipboardSnapshot = () => this.clipboardDomain.getClipboardSnapshot();
  subscribeClipboard = (notify: () => void) => this.clipboardDomain.subscribeClipboard(notify);
  clearClipboard = () => this.clipboardDomain.clearClipboard();
  copyNodeToClipboard = (pageId: string, nodeId: string) =>
    this.clipboardDomain.copyNodeToClipboard(pageId, nodeId);
  copyNodesToClipboard = (pageId: string, ids: readonly string[]) =>
    this.clipboardDomain.copyNodesToClipboard(pageId, ids);
  saveFragment = (pageId: string, explicitIds: readonly string[], input: string) =>
    this.clipboardDomain.saveFragment(pageId, explicitIds, input);
  removeSavedFragment = (itemId: string) => this.clipboardDomain.removeSavedFragment(itemId);
  checkPasteClipboard = (pageId: string, target: InsertTarget = {}) =>
    this.clipboardDomain.checkPasteClipboard(pageId, target);
  pasteClipboard = (pageId: string, target: InsertTarget = {}) =>
    this.clipboardDomain.pasteClipboard(pageId, target);
  checkPasteClipboardNodes = (pageId: string, target: InsertTarget = {}) =>
    this.clipboardDomain.checkPasteClipboardNodes(pageId, target);
  pasteClipboardNodes = (pageId: string, target: InsertTarget = {}) =>
    this.clipboardDomain.pasteClipboardNodes(pageId, target);
  checkInsertSavedFragment = (pageId: string, itemId: string, target: InsertTarget = {}) =>
    this.clipboardDomain.checkInsertSavedFragment(pageId, itemId, target);
  insertSavedFragment = (pageId: string, itemId: string, target: InsertTarget = {}) =>
    this.clipboardDomain.insertSavedFragment(pageId, itemId, target);

  // --- Import / export / history ---------------------------------------------------------

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

export type { ApplicationSchema };
