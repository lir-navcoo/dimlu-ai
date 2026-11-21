import { compileValue } from '../runtime/expression';
import type { Registry } from '../runtime/registry';
import type { FieldDefinition, NodeSchema, PageSchema, Value } from '../schema/types';

export const managedFieldProps = [
  'value',
  'checked',
  'label',
  'required',
  'disabled',
  'error',
  'name',
];

function formScopes(page: PageSchema, registry: Registry) {
  const scopes = new Map<string, NodeSchema | undefined>();
  const visit = (nodes: NodeSchema[], owner?: NodeSchema) => {
    for (const node of nodes) {
      scopes.set(node.id, owner);
      // An unbound form is still a boundary; do not fall through to an outer form.
      const next = registry.components[node.component]?.form ? node : owner;
      visit(node.children ?? [], next);
      for (const slot of Object.values(node.slots ?? {})) visit(slot.children, next);
    }
  };
  visit(page.children);
  return scopes;
}

/** Editor authoring scope; explicit runtime model references remain page-scoped. */
export function nearestForm(page: PageSchema, nodeId: string, registry: Registry) {
  return formScopes(page, registry).get(nodeId);
}

export function assertLocalFieldBindings(
  page: PageSchema,
  subtree: NodeSchema,
  registry: Registry,
) {
  const scopes = formScopes(page, registry);
  const visit = (node: NodeSchema) => {
    const arrayForm = registry.components[node.component]?.fieldArray && node.props.formId;
    if (
      arrayForm &&
      arrayForm.kind === 'literal' &&
      scopes.get(node.id)?.formId !== arrayForm.value
    )
      throw new Error(`组件 ${node.id} 已绑定明细模型；请先解除绑定再移出所属表单`);
    if (node.field && scopes.get(node.id)?.formId !== node.field.formId)
      throw new Error(
        `组件 ${node.id} 绑定了 ${node.field.formId}/${node.field.fieldId}；请先解除字段绑定，再移出所属表单或修改表单模型`,
      );
    node.children?.forEach(visit);
    for (const slot of Object.values(node.slots ?? {})) slot.children.forEach(visit);
  };
  visit(subtree);
}

/** Opaque TSX/computations cannot expose individual reads: retain the complete model. */
export function formReferences(page: PageSchema, formId: string, fieldId?: string): string[] {
  const references = new Set<string>();
  const inspect = (input: unknown, at: string) => {
    if (!input || typeof input !== 'object') return;
    const value = input as Value;
    if (value.kind === 'literal') return;
    if (value.kind === 'fieldRef') {
      if (value.formId === formId && (!fieldId || value.fieldId === fieldId)) references.add(at);
      return;
    }
    if (value.kind === 'formValues' || (value.kind === 'expression' && 'source' in input)) {
      if (compileValue(value).dependencies.some((d) => d === '*' || d === `@form:${formId}`))
        references.add(at + '（整个表单或动态引用）');
      return;
    }
    if (Array.isArray(input)) input.forEach((v, i) => inspect(v, `${at}/${i}`));
    else
      for (const [key, v] of Object.entries(input))
        if (key !== 'extensions') inspect(v, `${at}/${key}`);
  };
  const visit = (nodes: NodeSchema[]) => {
    for (const node of nodes) {
      if (
        (!fieldId && node.formId === formId) ||
        (node.field?.formId === formId && (!fieldId || node.field.fieldId === fieldId))
      )
        references.add('组件 ' + node.id);
      // Existing code materials declare their model through the conventional formId prop.
      if (node.props.formId?.kind === 'literal' && node.props.formId.value === formId)
        references.add('组件 ' + node.id + '（代码物料）');
      inspect(node.props, `组件 ${node.id}/props`);
      inspect(node.style, `组件 ${node.id}/style`);
      inspect(node.on, `组件 ${node.id}/on`);
      inspect(node.when, `组件 ${node.id}/when`);
      inspect(node.repeat, `组件 ${node.id}/repeat`);
      visit(node.children ?? []);
      for (const slot of Object.values(node.slots ?? {})) visit(slot.children);
    }
  };
  visit(page.children);
  inspect(page.onEnter, '页面进入事件');
  inspect(page.onLeave, '页面离开事件');
  for (const source of page.dataSources ?? []) inspect(source.input, `数据源 ${source.id}/input`);
  for (const form of page.forms ?? []) {
    if (form.id === formId && !fieldId) continue; // The removed definition's own references disappear.
    for (const field of form.fields) {
      if (form.id === formId && field.id === fieldId) continue;
      inspect(field, `字段 ${form.id}/${field.id}`);
    }
    inspect(form.arrays, `表单 ${form.id}/arrays`);
    inspect(form.rules, `表单 ${form.id}/rules`);
    if (form.id === formId && form.computed?.length)
      references.add('表单计算函数（字段依赖由 TypeScript 管理）');
  }
  return [...references];
}

export function assertFieldRange(field: FieldDefinition) {
  for (const [min, max] of [
    ['min', 'max'],
    ['minLength', 'maxLength'],
  ] as const) {
    const lower = field.rules
      ?.filter((r) => r.kind === min)
      .map((r) => ('value' in r ? Number(r.value) : 0));
    const upper = field.rules
      ?.filter((r) => r.kind === max)
      .map((r) => ('value' in r ? Number(r.value) : 0));
    if (lower?.length && upper?.length && Math.max(...lower) > Math.min(...upper))
      throw new Error('最小值不能大于最大值');
  }
}
