import { isJson, matchesType, type ApplicationMethod, type Json } from '../schema/types';
import type { ActionContext, ActionContract, Registry } from './registry';

export const applicationMethodActionId = (methodId: string) => `app.method.${methodId}`;

export function compileApplicationMethod(method: ApplicationMethod): ActionContract {
  const executeBody = new Function(
    'input',
    'context',
    `"use strict"; return (async () => {\n${method.source}\n})();`,
  ) as ActionContract['execute'];
  return {
    version: '1.0.0',
    input: { payload: { type: method.inputType ?? 'json', required: true } },
    output: method.outputType ?? 'json',
    execute: executeBody,
  };
}

export async function executeApplicationMethod(
  method: ApplicationMethod,
  payload: unknown,
  context: ActionContext,
): Promise<Json> {
  const contract = compileApplicationMethod(method);
  if (!isJson(payload) || !matchesType(payload, method.inputType ?? 'json'))
    throw new Error('测试输入不符合方法的 payload 类型');
  const result = await contract.execute({ payload }, context);
  if (!isJson(result) || !matchesType(result, method.outputType ?? 'json'))
    throw new Error('方法返回值不符合声明类型');
  return structuredClone(result);
}

export function withApplicationMethods(
  application: { methods?: ApplicationMethod[] },
  registry: Registry,
): Registry {
  const actions: Registry['actions'] = { ...registry.actions };
  for (const method of application.methods ?? []) {
    const actionId = applicationMethodActionId(method.id);
    if (Object.hasOwn(actions, actionId))
      throw new Error(`应用方法 ID 与已注册动作冲突：${actionId}`);
    actions[actionId] = compileApplicationMethod(method);
  }
  return { ...registry, actions };
}
