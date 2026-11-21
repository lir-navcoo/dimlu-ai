import { isJson, matchesType, type ApplicationMethod, type Json } from '../schema/types';
import type { ActionContext, ActionContract, Registry } from './registry';
import { assertMethodCapabilities, shadowedCapabilityNames } from './method-sandbox';
import { isWorkerRealmSupported, methodWorkerHost } from './method-worker-host';

export const applicationMethodActionId = (methodId: string) => `app.method.${methodId}`;

/** Main-thread realm, used where Worker is unavailable (tests, SSR). Same gate, same shadow. */
function executeOnMainThread(
  source: string,
  input: Record<string, Json>,
  context: ActionContext,
): unknown {
  const shadow = shadowedCapabilityNames.map((name) => `const ${name} = undefined;`).join('\n');
  const body = new Function(
    'input',
    'context',
    `"use strict";\n${shadow}\nreturn (async () => {\n${source}\n})();`,
  ) as (input: Record<string, Json>, context: ActionContext) => Promise<unknown>;
  return body(input, context);
}

export function compileApplicationMethod(method: ApplicationMethod): ActionContract {
  assertMethodCapabilities(method.source);
  return {
    version: '1.0.0',
    input: { payload: { type: method.inputType ?? 'json', required: true } },
    output: method.outputType ?? 'json',
    execute: (input, context) => {
      // Dedicated realm when available: the method body runs in a Worker that can only
      // reach host capabilities through the message bridge. `input` is JSON already, so
      // structured cloning matches the main-thread contract exactly.
      if (isWorkerRealmSupported())
        return methodWorkerHost.run(
          { source: method.source, input, state: { ...context.getState() } },
          { signal: context.signal, context },
        );
      return executeOnMainThread(method.source, input, context);
    },
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
