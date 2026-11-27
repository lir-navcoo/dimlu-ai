import Ajv from 'ajv';
import { applicationJsonSchema } from './schema';
import {
  matchesType,
  type ApplicationSchema,
  type Issue,
} from './types';
import { validatePage } from './validate-page';
import type { Registry } from '../runtime/registry';
import { compileValue } from '../runtime/expression';
import { withApplicationMethods } from '../runtime/application-methods';

const ajv = new Ajv({ allErrors: true, strict: false });
const shape = ajv.compile(applicationJsonSchema);

export function validateApplication(input: unknown, registry: Registry): Issue[] {
  if (!shape(input))
    return (shape.errors ?? []).map((e) => ({
      path: e.instancePath || '/',
      code: `shape.${e.keyword}`,
      message: `${e.message ?? '结构错误'} ${JSON.stringify(e.params)}`,
    }));
  const app = input as ApplicationSchema;
  const issues: Issue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const methodIds = new Set<string>();
  for (const [index, method] of (app.methods ?? []).entries()) {
    if (methodIds.has(method.id))
      add(`/methods/${index}/id`, 'method.id', `重复应用方法 ID ${method.id}`);
    methodIds.add(method.id);
  }
  try {
    registry = withApplicationMethods(app, registry);
  } catch (error) {
    add('/methods', 'method.compile', `应用方法编译失败：${(error as Error).message}`);
  }
  const pageIds = new Set<string>();
  for (const [kind, dependencies] of Object.entries(app.dependencies)) {
    const entries = registry[kind as keyof Registry] ?? {};
    for (const [id, version] of Object.entries(dependencies)) {
      if (!Object.hasOwn(entries, id))
        add(`/dependencies/${kind}/${id}`, 'dependency.missing', `未注册 ${id}`);
      else if (entries[id].version !== version)
        add(
          `/dependencies/${kind}/${id}`,
          'dependency.version',
          `${id} 需要 ${version}，实际 ${entries[id].version}`,
        );
    }
  }
  const sharedIds = new Set<string>();
  for (const [index, source] of (app.sharedDataSources ?? []).entries()) {
    const at = `/sharedDataSources/${index}`;
    if (sharedIds.has(source.id)) add(at, 'source.id', `重复共享数据源 ID ${source.id}`);
    sharedIds.add(source.id);
    const contract = registry.transports?.[source.transport];
    if (!contract) add(`${at}/transport`, 'transport.missing', `未注册 transport ${source.transport}`);
    if (!Object.hasOwn(app.dependencies.transports ?? {}, source.transport))
      add(`${at}/dependency`, 'dependency.undeclared', `transport ${source.transport} 未声明依赖`);
    if (contract && !matchesType(source.initial, contract.output))
      add(`${at}/initial`, 'source.type', `初始值需要 ${contract.output}`);
    for (const [key, binding] of Object.entries(source.input)) {
      if (contract) {
        if (!Object.hasOwn(contract.input, key))
          add(`${at}/input/${key}`, 'source.input', `未知数据源参数 ${key}`);
        else if (
          binding.kind === 'literal' &&
          !matchesType(binding.value, contract.input[key].type)
        )
          add(`${at}/input/${key}`, 'source.type', `数据源参数 ${key} 类型错误`);
      }
      try {
        if (compileValue(binding).usesScope)
          add(`${at}/input/${key}`, 'source.scope', '共享数据源 input 不能读取 scope');
      } catch {
        /* shape validation already rejected malformed bindings */
      }
    }
  }
  app.pages.forEach((page, pageIndex) => {
    const base = `/pages/${pageIndex}`;
    if (pageIds.has(page.id)) add(base, 'id.duplicate', `重复页面 ID ${page.id}`);
    pageIds.add(page.id);
    validatePage(page, base, { app, registry, add });
  });
  if (!pageIds.has(app.entryPageId)) add('/entryPageId', 'page.missing', '入口页面不存在');
  return issues;
}
