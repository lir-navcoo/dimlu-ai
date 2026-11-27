import type { PageActionCode } from '../schema/types';
import type { ActionContext, Registry } from './registry';
import { isWorkerRealmSupported, MethodWorkerHost } from './method-worker-host';
import {
  compilePageActionCode,
  invokePageAction,
  pageActionId,
  type PageActionHost,
} from './page-action-code';

interface MainThreadHost extends PageActionHost {
  pending: Promise<unknown>[];
}

/** Map the page `this` capability bridge onto a real ActionContext (main-thread realm). */
function mainThreadHost(context: ActionContext): MainThreadHost {
  return {
    pending: [],
    getState: context.getState,
    setState: (patch) => {
      for (const id of Object.keys(patch))
        if (!Object.hasOwn(context.getState(), id)) throw new Error(`未知状态 ${id}`);
      return context.pageActions?.setState(patch);
    },
    getValue: (id) => context.pageActions?.getValue(id) ?? null,
    setValue: (id, value) => context.pageActions?.setValue(id, value),
    emitEffect: (effect) => context.emitEffect(effect),
    loadDataSource: (sourceId, sourceInput) => context.executeDataSource(sourceId, sourceInput),
    invokeApplication: (methodId, payload) =>
      context.invokeApplication?.(methodId, payload) ??
      Promise.reject(new Error(`未知应用方法 ${methodId}`)),
    validateField: (id) => context.pageActions?.validateField(id) ?? true,
    resetField: (id) => context.pageActions?.resetField(id),
    validateForm: (formId) => context.pageActions?.validateForm(formId) ?? true,
    track(promise) {
      this.pending.push(promise);
    },
  };
}

export function compilePageActions(code: PageActionCode | undefined): Registry['actions'] {
  if (!code) return {};
  const compiled = compilePageActionCode(code);
  return Object.fromEntries(
    compiled.names.map((name) => [
      pageActionId(name),
      {
        version: '1.0.0',
        input: { payload: { type: 'json' } },
        output: 'json',
        async execute(input, context) {
          if (isWorkerRealmSupported()) {
            // One action per worker: aborts/timeouts never cancel unrelated action chains.
            const host = new MethodWorkerHost();
            const timer = setTimeout(
              () => host.terminateAll(new Error(`页面动作 ${name} 执行超时`)),
              5000,
            );
            try {
              return await host.run(
                { source: code.source, pageAction: name, input, state: { ...context.getState() } },
                { signal: context.signal, context },
              );
            } finally {
              clearTimeout(timer);
              host.dispose();
            }
          }
          // Restricted main-thread realm (jsdom/SSR): the same compile-time gate and
          // shadow list as application methods, with capabilities limited to page APIs.
          const host = mainThreadHost(context);
          const result = await invokePageAction(compiled.instantiate(), name, input.payload, host);
          await Promise.all(host.pending);
          return result;
        },
      },
    ]),
  );
}
