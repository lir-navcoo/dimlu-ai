import { forbiddenObjectKeySet, matchesType, type Json } from '../schema/types';
import type { Registry } from '../runtime/registry';

/** Editor metadata only. Runtime Schema receives ordinary nodes and literal Values. */
export interface MaterialTemplate {
  component: string;
  props: Record<string, Json>;
  children?: MaterialTemplate[];
  slots?: Record<string, { children: MaterialTemplate[] }>;
}

/** Validate before JSON utilities: they cannot safely inspect cyclic author metadata. */
export function cloneLiteralJson(input: unknown): Json {
  const ancestors = new WeakSet<object>();
  const visit = (value: unknown, path: string): Json => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || value === null)
      throw new Error(path + ' 必须是有限的 JSON 值');
    if (ancestors.has(value)) throw new Error(path + ' 包含循环引用');
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype)
      throw new Error(path + ' 必须是普通 JSON 对象');
    ancestors.add(value);
    try {
      const entries: [string, Json][] = [];
      for (const key of Reflect.ownKeys(value)) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string' || forbiddenObjectKeySet.has(key))
          throw new Error(path + ' 包含无效键');
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
          throw new Error(path + '.' + key + ' 必须是可枚举数据属性');
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
          throw new Error(path + ' 包含无效数组属性');
        entries.push([key, visit(descriptor.value, path + '.' + key)]);
      }
      if (array) {
        if (entries.length !== value.length) throw new Error(path + ' 不允许稀疏数组');
        return entries.map(([, item]) => item);
      }
      return Object.fromEntries(entries);
    } finally {
      ancestors.delete(value);
    }
  };
  return visit(input, '物料模板');
}

function record(value: Json | undefined, path: string): Record<string, Json> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(path + ' 必须是对象');
  return value;
}

/** Clone the entire JSON graph first, then validate its template and optional runtime contract. */
export function cloneMaterialTemplate(input: unknown, registry?: Registry): MaterialTemplate {
  const parse = (value: Json, path: string): MaterialTemplate => {
    const source = record(value, path);
    for (const key of Object.keys(source))
      if (!['component', 'props', 'children', 'slots'].includes(key))
        throw new Error(path + '.' + key + ' 不是物料模板字段');
    if (typeof source.component !== 'string' || !source.component)
      throw new Error(path + ' 缺少组件类型');
    const component = source.component,
      props = record(source.props, path + '.props');
    if (Object.hasOwn(props, 'formId') || Object.hasOwn(props, 'arrayId'))
      throw new Error(path + ' 不支持模型引用属性');
    const contract =
      registry && Object.hasOwn(registry.components, component)
        ? registry.components[component]
        : undefined;
    if (registry && !contract) throw new Error('未注册组件 ' + component);
    if (contract) {
      for (const [name, prop] of Object.entries(props)) {
        const field = Object.hasOwn(contract.props, name) ? contract.props[name] : undefined;
        if (!field || !matchesType(prop, field.type))
          throw new Error(path + '.' + name + ' 默认属性无效');
      }
      for (const [name, field] of Object.entries(contract.props))
        if (field.required && !Object.hasOwn(props, name))
          throw new Error(path + '.' + name + ' 缺少默认属性');
      const errors = contract.validateProps?.(props, {}) ?? [];
      if (errors.length) throw new Error(path + '：' + errors.join('；'));
    }
    const children = (list: Json, name: string): MaterialTemplate[] => {
      if (!Array.isArray(list)) throw new Error(name + ' 必须是数组');
      return list.map((child, index) => parse(child, name + '[' + index + ']'));
    };
    const template: MaterialTemplate = { component, props };
    if (Object.hasOwn(source, 'children')) {
      if (contract && !contract.children) throw new Error(path + ' 不支持子节点');
      template.children = children(source.children, path + '.children');
    }
    if (Object.hasOwn(source, 'slots')) {
      template.slots = {};
      for (const [name, definition] of Object.entries(record(source.slots, path + '.slots'))) {
        if (contract && (!contract.slots || !Object.hasOwn(contract.slots, name)))
          throw new Error(path + ' 未定义插槽 ' + name);
        const slot = record(definition, path + '.slots.' + name);
        if (Object.keys(slot).some((key) => key !== 'children') || !Object.hasOwn(slot, 'children'))
          throw new Error(path + '.slots.' + name + ' 只允许 children');
        template.slots[name] = { children: children(slot.children, path + '.slots.' + name) };
      }
    }
    return template;
  };
  return parse(cloneLiteralJson(input), '物料模板');
}
