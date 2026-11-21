import { compileValue } from '../runtime/expression';
import type {
  ActionCall,
  ApplicationMethod,
  ApplicationSchema,
} from '../schema/types';
import { findNode, type DocumentHost } from './document-context';
import { assertActionScope } from './scope';

/** Shared application methods and page-scoped action chains (entry, leave, events). */
export class DocumentActions {
  constructor(private readonly host: DocumentHost) {}

  private registerActionDependency(schema: ApplicationSchema, actionId: string) {
    const actions = this.host.plan().registry.actions;
    if (!Object.hasOwn(actions, actionId)) throw new Error('未注册动作 ' + actionId);
    if (Object.hasOwn(this.host.registry().actions, actionId))
      schema.dependencies.actions[actionId] ??= actions[actionId].version;
  }

  createApplicationMethod = (
    input: string | Omit<ApplicationMethod, 'id'> = '新建方法',
  ): string => {
    const schema = structuredClone(this.host.plan().schema);
    const draft: Omit<ApplicationMethod, 'id'> =
      typeof input === 'string'
        ? { title: input, inputType: 'json', outputType: 'json', source: 'return input.payload;' }
        : input;
    const normalized = draft.title.trim();
    if (!normalized) throw new Error('方法名称不能为空');
    const id = this.host.allocateMethodId();
    const method: ApplicationMethod = {
      ...draft,
      id,
      title: normalized,
    };
    schema.methods = [...(schema.methods ?? []), method];
    this.host.commit(schema, `新建应用方法 ${normalized}`);
    return id;
  };

  updateApplicationMethod = (
    methodId: string,
    patch: Partial<
      Pick<ApplicationMethod, 'title' | 'description' | 'inputType' | 'outputType' | 'source'>
    >,
  ): boolean => {
    const schema = structuredClone(this.host.plan().schema);
    const method = schema.methods?.find((item) => item.id === methodId);
    if (!method) throw new Error(`未知应用方法 ${methodId}`);
    const next = { ...method, ...patch };
    next.title = next.title.trim();
    if (!next.title) throw new Error('方法名称不能为空');
    schema.methods = schema.methods!.map((item) => (item.id === methodId ? next : item));
    return this.host.commit(schema, `修改应用方法 ${next.title}`);
  };

  removeApplicationMethod = (methodId: string): boolean => {
    const schema = structuredClone(this.host.plan().schema);
    if (!schema.methods?.some((method) => method.id === methodId))
      throw new Error(`未知应用方法 ${methodId}`);
    schema.methods = schema.methods.filter((method) => method.id !== methodId);
    return this.host.commit(schema, `删除应用方法 ${methodId}`);
  };

  /** Page entry is a page-scoped definition; saving never executes its actions. */
  setPageEnterActions = (pageId: string, actions: ActionCall[]) => {
    const { schema, page } = this.host.draft(pageId);
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
    return this.host.commit(schema, '保存页面进入动作');
  };

  /** Page leave mirrors page entry: page-scoped, saved without execution. */
  setPageLeaveActions = (pageId: string, actions: ActionCall[]) => {
    const { schema, page } = this.host.draft(pageId);
    const calls = structuredClone(actions);
    for (const call of calls) {
      this.registerActionDependency(schema, call.action);
      for (const value of Object.values(call.input)) {
        const compiled = compileValue(value);
        if (compiled.usesEvent || compiled.usesScope)
          throw new Error('页面离开动作不能访问 event 或 scope');
      }
    }
    if (calls.length) page.onLeave = calls;
    else delete page.onLeave;
    return this.host.commit(schema, '保存页面离开动作');
  };

  /** The entire event chain is one validated edit and one undo entry. */
  setEventActions = (pageId: string, nodeId: string, eventName: string, actions: ActionCall[]) => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('事件目标节点不存在');
    const component = this.host.registry().components[node.component];
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
    return this.host.commit(schema, `保存事件 ${eventName}`, { pageId, nodeId });
  };
}
