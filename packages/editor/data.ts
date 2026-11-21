import { compileValue } from '../runtime/expression';
import { applicationMethodActionId } from '../runtime/application-methods';
import type {
  ActionCall,
  ApplicationSchema,
  FieldDefinition,
  PageSchema,
  Value,
} from '../schema/types';

type ActionOwner = { nodeId: string; eventName: string };

export type ApplicationMethodReference = {
  pageId: string;
  pageTitle: string;
  path: string;
  callId: string;
  actionId: string;
  owner?: ActionOwner;
};

/** Inspect declared Value positions, never literal business objects or extension data. */
function pageReferences(
  page: PageSchema,
  visit: (value: Value, path: string) => void,
  action: (call: ActionCall, path: string, owner?: ActionOwner) => void,
) {
  const calls = (chain: ActionCall[], path: string, owner?: ActionOwner) =>
    chain.forEach((call, index) => {
      const at = `${path}/${index}`;
      action(call, at, owner);
      Object.entries(call.input).forEach(([key, value]) => visit(value, `${at}/input/${key}`));
    });
  const fields = (list: FieldDefinition[], path: string) =>
    list.forEach((field) => {
      if (field.when) visit(field.when, `${path}/${field.id}/when`);
      if (field.disabled) visit(field.disabled, `${path}/${field.id}/disabled`);
      field.rules?.forEach((rule, index) => {
        if (rule.kind === 'expression') visit(rule.test, `${path}/${field.id}/rules/${index}`);
      });
    });
  const nodes = (list: PageSchema['children']) => {
    for (const node of list) {
      Object.entries(node.props).forEach(([key, value]) =>
        visit(value, `组件 ${node.id}/props/${key}`),
      );
      Object.entries(node.style ?? {}).forEach(([key, value]) =>
        visit(value, `组件 ${node.id}/style/${key}`),
      );
      if (node.when) visit(node.when, `组件 ${node.id}/when`);
      if (node.repeat) {
        visit(node.repeat.items, `组件 ${node.id}/repeat/items`);
        visit(node.repeat.key, `组件 ${node.id}/repeat/key`);
      }
      Object.entries(node.on ?? {}).forEach(([name, chain]) =>
        calls(chain, `组件 ${node.id}/${name}`, { nodeId: node.id, eventName: name }),
      );
      nodes(node.children ?? []);
      Object.values(node.slots ?? {}).forEach((slot) => nodes(slot.children));
    }
  };
  nodes(page.children);
  calls(page.onEnter ?? [], '页面进入事件');
  for (const form of page.forms ?? []) {
    fields(form.fields, `表单 ${form.id}`);
    for (const array of form.arrays ?? []) {
      fields(array.fields, `表单 ${form.id}/${array.id}`);
      if (array.when) visit(array.when, `表单 ${form.id}/${array.id}/when`);
      if (array.disabled) visit(array.disabled, `表单 ${form.id}/${array.id}/disabled`);
    }
    form.rules?.forEach((rule, index) => visit(rule.test, `表单 ${form.id}/rules/${index}`));
  }
  for (const source of page.dataSources ?? [])
    Object.entries(source.input).forEach(([key, value]) =>
      visit(value, `数据源 ${source.id}/input/${key}`),
    );
}
export function stateReferences(page: PageSchema, id: string): string[] {
  const refs = new Set<string>();
  pageReferences(
    page,
    (value, path) => {
      const deps = compileValue(value).dependencies;
      if (deps.includes(id) || deps.includes('*')) refs.add(path);
    },
    (call, path) => {
      if (call.resultTo === id) refs.add(`${path}/resultTo`);
      if (call.action === 'state.set') {
        const target = call.input.stateId;
        if (target?.kind !== 'literal' || target.value === id)
          refs.add(`${path}/stateId${target?.kind !== 'literal' ? '（动态目标）' : ''}`);
      }
    },
  );
  return [...refs];
}
export function sourceReferences(page: PageSchema, id: string): string[] {
  const refs = new Set<string>();
  pageReferences(
    page,
    (value, path) => {
      if (compileValue(value).dependencies.includes(`@source:${id}`)) refs.add(path);
    },
    (call, path) => {
      if (call.action === 'data.execute') {
        const target = call.input.sourceId;
        if (target?.kind !== 'literal' || target.value === id)
          refs.add(`${path}/sourceId${target?.kind !== 'literal' ? '（动态目标）' : ''}`);
      }
    },
  );
  return [...refs];
}

export function applicationMethodReferences(application: ApplicationSchema, methodId: string) {
  const actionId = applicationMethodActionId(methodId);
  return application.pages.flatMap((page) => {
    const references: ApplicationMethodReference[] = [];
    pageReferences(
      page,
      () => {},
      (call, path, owner) => {
        if (call.action === actionId)
          references.push({ pageId: page.id, pageTitle: page.title, path, callId: call.id, actionId, owner });
      },
    );
    return references;
  });
}
