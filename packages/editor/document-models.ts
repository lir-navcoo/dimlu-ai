import { acceptsField } from '../runtime/registry';
import type {
  FieldDefinition,
  FieldArrayDefinition,
  FormDefinition,
  NodeSchema,
  PageSchema,
  StateDefinition,
  DataSourceDefinition,
} from '../schema/types';
import { findNode, type DocumentHost } from './document-context';
import {
  assertFieldRange,
  assertLocalFieldBindings,
  formReferences,
  managedFieldProps,
  nearestForm,
} from './forms';
import { sourceReferences, stateReferences } from './data';

/** Page models: state, data sources, forms, fields and detail arrays. */
export class DocumentModels {
  constructor(private readonly host: DocumentHost) {}

  private form(page: PageSchema, id: string) {
    const form = page.forms?.find((f) => f.id === id);
    if (!form) throw new Error('表单不存在 ' + id);
    return form;
  }

  createState = (pageId: string, input: StateDefinition) => {
    const { schema, page } = this.host.draft(pageId);
    if (page.state.some((state) => state.id === input.id)) throw new Error('状态 ID 已存在');
    page.state.push(structuredClone(input));
    return this.host.commit(schema, '创建页面状态 ' + input.id);
  };

  updateState = (pageId: string, id: string, input: Omit<StateDefinition, 'id'>) => {
    const { schema, page } = this.host.draft(pageId);
    const state = page.state.find((state) => state.id === id);
    if (!state) throw new Error('状态不存在 ' + id);
    Object.assign(state, structuredClone(input), { id });
    return this.host.commit(schema, '保存页面状态 ' + id);
  };

  removeState = (pageId: string, id: string) => {
    const { schema, page } = this.host.draft(pageId);
    if (!page.state.some((state) => state.id === id)) throw new Error('状态不存在 ' + id);
    const refs = stateReferences(page, id);
    if (refs.length) throw new Error('状态仍被引用：' + refs.join('；'));
    page.state = page.state.filter((state) => state.id !== id);
    return this.host.commit(schema, '删除页面状态 ' + id);
  };

  createDataSource = (pageId: string, input: DataSourceDefinition) => {
    const { schema, page } = this.host.draft(pageId);
    if (page.dataSources?.some((source) => source.id === input.id))
      throw new Error('数据源 ID 已存在');
    const transport = this.host.registry().transports?.[input.transport];
    if (!transport) throw new Error('未注册 transport ' + input.transport);
    (schema.dependencies.transports ??= {})[input.transport] ??= transport.version;
    (page.dataSources ??= []).push(structuredClone(input));
    return this.host.commit(schema, '创建数据源 ' + input.id);
  };

  updateDataSource = (pageId: string, id: string, input: Omit<DataSourceDefinition, 'id'>) => {
    const { schema, page } = this.host.draft(pageId);
    const source = page.dataSources?.find((source) => source.id === id);
    if (!source) throw new Error('数据源不存在 ' + id);
    const transport = this.host.registry().transports?.[input.transport];
    if (!transport) throw new Error('未注册 transport ' + input.transport);
    (schema.dependencies.transports ??= {})[input.transport] ??= transport.version;
    Object.assign(source, structuredClone(input), { id });
    return this.host.commit(schema, '保存数据源 ' + id);
  };

  removeDataSource = (pageId: string, id: string) => {
    const { schema, page } = this.host.draft(pageId);
    if (!page.dataSources?.some((source) => source.id === id))
      throw new Error('数据源不存在 ' + id);
    const refs = sourceReferences(
      { ...page, dataSources: page.dataSources.filter((source) => source.id !== id) },
      id,
    );
    if (refs.length) throw new Error('数据源仍被引用：' + refs.join('；'));
    page.dataSources = page.dataSources.filter((source) => source.id !== id);
    return this.host.commit(schema, '删除数据源 ' + id);
  };

  private bindFieldDraft(page: PageSchema, nodeId: string, formId: string, fieldId: string) {
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('绑定目标节点不存在');
    const field = this.form(page, formId).fields.find((f) => f.id === fieldId);
    const contract = this.host.registry().components[node.component];
    const literals = Object.fromEntries(
      Object.entries(node.props)
        .filter(([, value]) => value.kind === 'literal')
        .map(([key, value]) => [key, value.kind === 'literal' ? value.value : undefined]),
    );
    if (
      !field ||
      !contract.field ||
      !acceptsField(contract, field.type, literals, field.itemType, field)
    )
      throw new Error('字段不存在或类型与组件不匹配');
    const owner = nearestForm(page, nodeId, this.host.registry());
    if (!owner?.formId) throw new Error('请先将组件放入已绑定模型的表单容器，再绑定字段');
    if (owner.formId !== formId) throw new Error(`只能绑定所属表单 ${owner.formId} 的字段`);
    if (
      node.when ||
      node.repeat ||
      node.on?.onChange ||
      node.on?.onBlur ||
      node.on?.onValueChange ||
      node.on?.onCheckedChange
    )
      throw new Error('请先处理组件的显示条件、循环或 change/blur 事件，再绑定字段');
    for (const key of managedFieldProps) {
      if (node.props[key] && node.props[key].kind !== 'literal')
        throw new Error(`属性 ${key} 已有动态绑定，请先处理后再绑定字段`);
    }
    for (const key of managedFieldProps) delete node.props[key];
    node.field = { formId, fieldId };
  }

  createForm = (pageId: string, nodeId: string, input: FormDefinition) => {
    const { schema, page } = this.host.draft(pageId);
    if (page.forms?.some((f) => f.id === input.id)) throw new Error('表单 ID 已存在');
    const node = findNode(page, nodeId)?.node;
    if (!node || !this.host.registry().components[node.component].form)
      throw new Error('该组件不支持表单绑定');
    input.fields.forEach(assertFieldRange);
    (page.forms ??= []).push(structuredClone(input));
    node.formId = input.id;
    assertLocalFieldBindings(page, node, this.host.registry());
    return this.host.commit(schema, '创建并绑定表单 ' + input.id, { pageId, nodeId });
  };

  bindForm = (pageId: string, nodeId: string, formId?: string) => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node || !this.host.registry().components[node.component].form)
      throw new Error('该组件不支持表单绑定');
    if (formId) this.form(page, formId);
    if (formId) node.formId = formId;
    else delete node.formId;
    assertLocalFieldBindings(page, node, this.host.registry());
    return this.host.commit(schema, '修改表单绑定', { pageId, nodeId });
  };

  bindField = (pageId: string, nodeId: string, binding?: { formId: string; fieldId: string }) => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('绑定目标节点不存在');
    if (binding) this.bindFieldDraft(page, nodeId, binding.formId, binding.fieldId);
    else if (node.field) {
      const field = this.form(page, node.field.formId).fields.find(
        (f) => f.id === node.field!.fieldId,
      )!;
      const contract = this.host.registry().components[node.component];
      // Unbinding restores a static value from the definition, never copies live preview data.
      const defaults: Record<string, import('../schema/types').Value> = {
        label: { kind: 'literal', value: field.label },
        [contract.field!.valueProp]: {
          kind: 'literal',
          value:
            contract.field!.changeEvent === 'onValueChange' ? field.initial : (field.initial ?? 0),
        },
        required: {
          kind: 'literal',
          value: !!field.rules?.some(
            (r) => r.kind === (field.type === 'boolean' ? 'mustBeTrue' : 'required'),
          ),
        },
      };
      for (const [key, value] of Object.entries(defaults))
        if (Object.hasOwn(contract.props, key)) node.props[key] = value;
      delete node.field;
    }
    return this.host.commit(schema, binding ? '绑定字段' : '解除字段绑定', { pageId, nodeId });
  };

  createField = (pageId: string, formId: string, input: FieldDefinition, nodeId?: string) => {
    const { schema, page } = this.host.draft(pageId);
    assertFieldRange(input);
    this.form(page, formId).fields.push(structuredClone(input));
    if (nodeId) this.bindFieldDraft(page, nodeId, formId, input.id);
    return this.host.commit(
      schema,
      '新增字段 ' + input.id,
      nodeId ? { pageId, nodeId } : this.host.selection(),
    );
  };

  configureFieldArray = (pageId: string, nodeId: string, input: FieldArrayDefinition) => {
    const { schema, page } = this.host.draft(pageId),
      node = findNode(page, nodeId)?.node;
    if (!node || !this.host.registry().components[node.component].fieldArray)
      throw new Error('当前组件不支持明细绑定');
    const owner = nearestForm(page, nodeId, this.host.registry());
    if (!owner?.formId) throw new Error('请先放入已绑定模型的表单容器');
    const form = this.form(page, owner.formId),
      arrays = (form.arrays ??= []);
    const currentId = node.props.arrayId?.kind === 'literal' ? node.props.arrayId.value : undefined;
    if (currentId && currentId !== input.id)
      throw new Error('已绑定明细不能直接修改 ID，请先解除绑定');
    const existing = arrays.findIndex((array) => array.id === input.id);
    if (existing >= 0 && currentId !== input.id)
      throw new Error('明细模型已存在，请从绑定列表选择');
    if (existing >= 0) arrays[existing] = structuredClone(input);
    else arrays.push(structuredClone(input));
    node.props.formId = { kind: 'literal', value: form.id };
    node.props.arrayId = { kind: 'literal', value: input.id };
    assertLocalFieldBindings(page, node, this.host.registry());
    return this.host.commit(schema, '保存并绑定明细模型', { pageId, nodeId });
  };

  bindFieldArray = (pageId: string, nodeId: string, arrayId?: string) => {
    const { schema, page } = this.host.draft(pageId),
      node = findNode(page, nodeId)?.node;
    if (!node || !this.host.registry().components[node.component].fieldArray)
      throw new Error('当前组件不支持明细绑定');
    if (arrayId) {
      const owner = nearestForm(page, nodeId, this.host.registry());
      if (
        !owner?.formId ||
        !this.form(page, owner.formId).arrays?.some((array) => array.id === arrayId)
      )
        throw new Error('只能绑定所属表单的明细模型');
      node.props.formId = { kind: 'literal', value: owner.formId };
      node.props.arrayId = { kind: 'literal', value: arrayId };
    } else {
      const formId = node.props.formId?.kind === 'literal' && node.props.formId.value,
        current = node.props.arrayId?.kind === 'literal' && node.props.arrayId.value;
      const array = page.forms
        ?.find((form) => form.id === formId)
        ?.arrays?.find((array) => array.id === current);
      if (array)
        for (const [key, value] of Object.entries({
          label: array.label,
          fields: array.fields,
          value: array.initial,
          minItems: array.minItems,
          maxItems: array.maxItems,
        })) {
          if (value !== undefined)
            node.props[key] = {
              kind: 'literal',
              value: structuredClone(value) as import('../schema/types').Json,
            };
          else delete node.props[key];
        }
      delete node.props.formId;
      delete node.props.arrayId;
    }
    return this.host.commit(schema, '修改明细绑定', { pageId, nodeId });
  };

  updateField = (
    pageId: string,
    formId: string,
    fieldId: string,
    input: Pick<FieldDefinition, 'label' | 'initial' | 'rules'>,
  ) => {
    const { schema, page } = this.host.draft(pageId);
    const field = this.form(page, formId).fields.find((f) => f.id === fieldId);
    if (!field) throw new Error('字段不存在 ' + fieldId);
    Object.assign(field, structuredClone(input));
    assertFieldRange(field);
    return this.host.commit(schema, '修改字段 ' + fieldId);
  };

  removeField = (pageId: string, formId: string, fieldId: string) => {
    const { schema, page } = this.host.draft(pageId);
    const form = this.form(page, formId);
    if (!form.fields.some((f) => f.id === fieldId)) throw new Error('字段不存在 ' + fieldId);
    const refs = formReferences(page, formId, fieldId);
    if (refs.length) throw new Error('字段仍被引用：' + refs.join('；'));
    form.fields = form.fields.filter((f) => f.id !== fieldId);
    return this.host.commit(schema, '删除字段 ' + fieldId);
  };

  removeForm = (pageId: string, formId: string) => {
    const { schema, page } = this.host.draft(pageId);
    this.form(page, formId);
    const refs = formReferences(page, formId);
    if (refs.length) throw new Error('表单仍被引用：' + refs.join('；'));
    page.forms = page.forms!.filter((f) => f.id !== formId);
    return this.host.commit(schema, '删除表单 ' + formId);
  };
}

