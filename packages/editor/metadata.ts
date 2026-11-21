import { isJson, matchesType, type Json } from '../schema/types';
import type { Registry } from '../runtime/registry';
import {
  cloneLiteralJson,
  cloneMaterialTemplate,
  type MaterialTemplate,
} from './material-template';

export type Setter =
  | { kind: 'text'; multiline?: boolean }
  | { kind: 'number' | 'boolean' | 'json' | 'options' | 'columns' }
  | { kind: 'select'; options: { label: string; value: Json }[] }
  | { kind: 'custom'; id: string; options?: Record<string, Json> };
export interface PropertyMetadata {
  name: string;
  label: string;
  group: string;
  setter: Setter;
  /** Hide irrelevant controls for literal/default props; dynamic bindings stay editable. */
  visibleWhen?: { prop: string; equals: Json };
}
export interface MaterialMetadata {
  title: string;
  icon: string;
  category: string;
  properties: PropertyMetadata[];
  defaultProps: Record<string, Json>;
  initialChildren?: MaterialTemplate[];
  insertable?: boolean;
  /** Design presentation adapter; independent of runtime props and Schema. */
  design?: { kind: 'overlay' };
  /** Hide registered demo/internal components from the material palette. */
  palette?: boolean;
}
export type MaterialCatalog = Record<string, MaterialMetadata>;
/** Authoring metadata is checked against runtime capabilities; it never enters application JSON. */
export function validateCatalog(catalog: MaterialCatalog, registry: Registry): string[] {
  const errors: string[] = [];
  for (const [component, input] of Object.entries(catalog)) {
    try {
      // Protect all older JSON/type checks below from cyclic or exotic metadata too.
      const meta = cloneLiteralJson(input) as unknown as MaterialMetadata;
      const contract = Object.hasOwn(registry.components, component)
        ? registry.components[component]
        : undefined;
      if (!contract) {
        errors.push(component + ' 未注册');
        continue;
      }
      const names = new Set<string>();
      for (const prop of meta.properties) {
        const field = Object.hasOwn(contract.props, prop.name)
          ? contract.props[prop.name]
          : undefined;
        if (!field || names.has(prop.name)) {
          errors.push(component + '.' + prop.name + ' 未定义或重复');
          continue;
        }
        names.add(prop.name);
        if (
          prop.setter.kind === 'custom' &&
          (!prop.setter.id.trim() ||
            (prop.setter.options !== undefined && !isJson(prop.setter.options)))
        )
          errors.push(component + '.' + prop.name + ' 自定义设置器配置无效');
        if (prop.visibleWhen) {
          const dependency = contract.props[prop.visibleWhen.prop];
          if (!dependency || !matchesType(prop.visibleWhen.equals, dependency.type))
            errors.push(component + '.' + prop.name + ' 显示条件无效');
        }
        const type = { text: 'string', number: 'number', boolean: 'boolean' }[
          prop.setter.kind as 'text' | 'number' | 'boolean'
        ];
        if (type && field.type !== type && field.type !== 'json')
          errors.push(component + '.' + prop.name + ' 编辑控件类型不匹配');
        if (prop.setter.kind === 'options' && field.type !== 'array')
          errors.push(component + '.' + prop.name + ' 选项编辑器需要数组属性');
        if (prop.setter.kind === 'columns' && field.type !== 'array')
          errors.push(component + '.' + prop.name + ' 表格列编辑器需要数组属性');
        if (
          prop.setter.kind === 'select' &&
          (!prop.setter.options.length ||
            prop.setter.options.some((option) => !matchesType(option.value, field.type)))
        )
          errors.push(component + '.' + prop.name + ' 选项类型不匹配');
      }
      for (const [key, value] of Object.entries(meta.defaultProps))
        if (
          !Object.hasOwn(contract.props, key) ||
          !isJson(value) ||
          !matchesType(value, contract.props[key].type)
        )
          errors.push(component + '.' + key + ' 默认属性无效');
      if (meta.insertable !== false)
        for (const [key, field] of Object.entries(contract.props))
          if (field.required && !Object.hasOwn(meta.defaultProps, key))
            errors.push(component + '.' + key + ' 缺少默认属性');
      if (meta.insertable !== false || meta.initialChildren !== undefined)
        cloneMaterialTemplate(
          {
            component,
            props: meta.defaultProps,
            ...(meta.initialChildren !== undefined ? { children: meta.initialChildren } : {}),
          },
          registry,
        );
    } catch (error) {
      errors.push(component + '：' + (error instanceof Error ? error.message : String(error)));
    }
  }
  return errors;
}
