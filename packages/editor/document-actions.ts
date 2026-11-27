import { compileValue } from '../runtime/expression';
import type { ActionCall, ApplicationMethod, ApplicationSchema, NodeSchema } from '../schema/types';
import { findNode, type DocumentHost } from './document-context';
import { assertActionScope } from './scope';
import {
  pageActionId,
  pageActionPrefix,
  splitPageActionCode,
} from '../runtime/page-action-code';
import { applicationMethodActionId as methodActionId } from '../runtime/application-methods';

/** Shared application methods and page-scoped action chains (entry, leave, events). */
export class DocumentActions {
  constructor(private readonly host: DocumentHost) {}

  private registerActionDependency(schema: ApplicationSchema, pageId: string, actionId: string) {
    const plan = this.host.plan();
    const local = actionId.startsWith(pageActionPrefix);
    const actions = local ? plan.pages.get(pageId)!.actions : plan.registry.actions;
    if (!Object.hasOwn(actions, actionId)) throw new Error('未注册动作 ' + actionId);
    if (!local && Object.hasOwn(this.host.registry().actions, actionId))
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
      this.registerActionDependency(schema, pageId, call.action);
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
      this.registerActionDependency(schema, pageId, call.action);
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
    for (const action of actions) this.registerActionDependency(schema, pageId, action.action);
    if (actions.length) (node.on ??= {})[eventName] = structuredClone(actions);
    else if (node.on) {
      delete node.on[eventName];
      if (!Object.keys(node.on).length) delete node.on;
    }
    return this.host.commit(schema, `保存事件 ${eventName}`, { pageId, nodeId });
  };
  /** 宜搭式提升：把页面方法抽为应用级方法，搬移函数体并改写本应用内的全部引用。 */
  liftPageAction = (pageId: string, name: string): string => {
    const schema = structuredClone(this.host.plan().schema);
    const page = schema.pages.find((item) => item.id === pageId);
    const source = page?.actionCode?.source;
    if (!page || !source) throw new Error('页面没有已保存的动作代码');
    const chunk = splitPageActionCode(source).find((item) => item.name === name);
    if (!chunk) throw new Error(`页面方法 ${name} 不存在`);
    // 函数体 = 参数表闭合 ) 之后的第一个 { 到最后一个 }；应用方法以 input 为入参，
    // 用 const payload = input 保持页面动作语义不变。
    const afterParams = chunk.code.slice(chunk.code.indexOf(')') + 1);
    const open = afterParams.indexOf('{');
    if (open < 0 || !afterParams.endsWith('}')) throw new Error('无法解析方法体');
    const body = afterParams.slice(open + 1, -1).trim() || '/* 空方法体 */';
    const methodId = this.host.allocateMethodId();
    const method: ApplicationMethod = {
      id: methodId,
      title: name,
      inputType: 'json',
      outputType: 'json',
      source: `const payload = input;\n${body}`,
    };
    schema.methods = [...(schema.methods ?? []), method];
    // 从页面源码移除该函数块
    const nextSource = `${source.slice(0, chunk.start)}${source.slice(chunk.end)}`.trim();
    if (nextSource) page.actionCode = { source: nextSource };
    else delete page.actionCode;
    // 改写全部引用：页面进入/离开动作链与所有页面的组件事件动作链
    const rewrite = (calls: ActionCall[] | undefined) => {
      for (const call of calls ?? [])
        if (call.action === pageActionId(name)) call.action = methodActionId(methodId);
    };
    const visit = (nodes: NodeSchema[] | undefined) => {
      for (const node of nodes ?? []) {
        for (const calls of Object.values(node.on ?? {})) rewrite(calls);
        for (const slot of Object.values(node.slots ?? {})) visit(slot.children);
        visit(node.children);
      }
    };
    for (const item of schema.pages) {
      rewrite(item.onEnter);
      rewrite(item.onLeave);
      visit(item.children);
    }
    this.host.commit(schema, `页面方法 ${name} 抽为应用方法`);
    return methodId;
  };
}
