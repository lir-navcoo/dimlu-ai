import { createContext, type Context } from 'react';

// Hot updates must not split providers from consumers that retained the previous module.
const contexts: Map<string, Context<unknown>> = import.meta.hot?.data.editorContexts ?? new Map();
if (import.meta.hot) import.meta.hot.data.editorContexts = contexts;
export function editorContext<T>(key: string, initial: T): Context<T> {
  let context = contexts.get(key);
  if (!context) {
    context = createContext(initial) as Context<unknown>;
    contexts.set(key, context);
  }
  return context as Context<T>;
}
