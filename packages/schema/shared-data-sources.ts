import type { ApplicationSchema, DataSourceDefinition, PageSchema } from './types';

export function sharedSourceMap(app: ApplicationSchema): Map<string, DataSourceDefinition> {
  return new Map((app.sharedDataSources ?? []).map((source) => [source.id, source]));
}

/**
 * 页面数据源展开：ref 定义以应用级共享定义展开，页面 input 逐键覆盖。
 * ref 未命中时保持占位定义，让校验层报告缺失引用而不是编译崩溃。
 */
export function resolveDataSources(
  page: PageSchema,
  shared: Map<string, DataSourceDefinition>,
): DataSourceDefinition[] {
  return (page.dataSources ?? []).map((source) => {
    if (!source.ref) return source;
    const definition = shared.get(source.ref);
    if (!definition)
      return {
        ...source,
        kind: 'query',
        transport: source.ref,
        initial: null,
      } as DataSourceDefinition;
    return {
      ...definition,
      id: source.id,
      input: { ...definition.input, ...source.input },
    };
  });
}
