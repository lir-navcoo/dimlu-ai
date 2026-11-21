import Ajv from 'ajv';
import { temporalError } from './formats';
import { fieldTypes } from '../runtime/registry';
import { applicationJsonSchema } from './schema';
import {
  matchesType,
  matchesFieldValue,
  type ApplicationSchema,
  type Issue,
  type NodeSchema,
  type Value,
  type ActionCall,
  type FieldDefinition,
} from './types';
import { assertValueScope, compileValue, valueScopeReads } from '../runtime/expression';
import { isStyleProperty, styleValueError, styleValueTypes } from './style';
import { rowValues } from './field-data';
import { prepareFormPatch } from './form-patch';
import { checkTransportInput } from '../runtime/data-source';
import type { Registry } from '../runtime/registry';
import { applicationMethodActionId, withApplicationMethods } from '../runtime/application-methods';

const ajv = new Ajv({ allErrors: true, strict: false });
const shape = ajv.compile(applicationJsonSchema);
const reserved = new Set(['__proto__', 'prototype', 'constructor']);

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
  app.pages.forEach((page, pageIndex) => {
    const base = `/pages/${pageIndex}`;
    if (pageIds.has(page.id)) add(base, 'id.duplicate', `重复页面 ID ${page.id}`);
    pageIds.add(page.id);
    const states = new Map(page.state.map((s) => [s.id, s]));
    const forms = new Map((page.forms ?? []).map((f) => [f.id, f]));
    const sources = new Map((page.dataSources ?? []).map((source) => [source.id, source]));
    const stateIds = new Set<string>();
    page.state.forEach((s, i) => {
      if (stateIds.has(s.id) || reserved.has(s.id))
        add(`${base}/state/${i}`, 'state.id', `重复或保留的状态 ID ${s.id}`);
      stateIds.add(s.id);
      if (!matchesType(s.initial, s.type))
        add(`${base}/state/${i}/initial`, 'state.type', `${s.id} 初始值不符合 ${s.type}`);
    });
    const value = (v: Value, path: string, eventAllowed = false, scope?: ReadonlySet<string>) => {
      try {
        const c = compileValue(v);
        if (scope)
          for (const name of valueScopeReads(v).names)
            if (!scope.has(name)) add(path, 'scope.missing', `当前组件缺少作用域 scope.${name}`);
        for (const id of c.dependencies)
          if (id.startsWith('@form:')) {
            if (!forms.has(id.slice(6))) add(path, 'form.missing', `未知表单 ${id.slice(6)}`);
          } else if (id.startsWith('@source:')) {
            if (id === '@source:*') add(path, 'source.reference', '数据源引用需要明确的源 ID');
            else if (!sources.has(id.slice(8)))
              add(path, 'source.missing', `未知数据源 ${id.slice(8)}`);
          } else if (id !== '*' && !states.has(id)) add(path, 'state.missing', `未知状态 ${id}`);
        if (v.kind === 'fieldRef' && !forms.get(v.formId)?.fields.some((f) => f.id === v.fieldId))
          add(path, 'field.missing', `未知字段 ${v.formId}.${v.fieldId}`);
        if (c.usesEvent && !eventAllowed)
          add(path, 'event.scope', 'event 只允许在事件动作参数中访问');
      } catch (error) {
        add(path, 'expression.invalid', String((error as Error).message));
      }
    };
    const knownType = (binding: Value) => {
      if (binding.kind === 'stateRef' && !binding.path?.length)
        return states.get(binding.stateId)?.type;
      if (binding.kind === 'fieldRef')
        return forms.get(binding.formId)?.fields.find((field) => field.id === binding.fieldId)
          ?.type;
      if (binding.kind === 'formValues') return 'object';
      if (binding.kind === 'dataRef' && !binding.path?.length) {
        const definition = sources.get(binding.sourceId);
        return definition && registry.transports?.[definition.transport]?.output;
      }
      return undefined;
    };
    const checkReferenceType = (binding: Value, type: string, path: string) => {
      const actual = knownType(binding);
      if (actual && actual !== 'json' && type !== 'json' && actual !== type)
        add(path, 'source.type', `数据源返回类型 ${actual} 与 ${type} 不匹配`);
    };
    const sourceIds = new Set<string>();
    for (const [index, source] of (page.dataSources ?? []).entries()) {
      const at = `${base}/dataSources/${index}`;
      if (sourceIds.has(source.id) || reserved.has(source.id))
        add(at, 'source.id', '重复或保留的数据源 ID');
      sourceIds.add(source.id);
      const contract = Object.hasOwn(registry.transports ?? {}, source.transport)
        ? registry.transports![source.transport]
        : undefined;
      if (!contract) add(at, 'transport.missing', `未注册 transport ${source.transport}`);
      if (!Object.hasOwn(app.dependencies.transports ?? {}, source.transport))
        add(at, 'dependency.undeclared', `transport ${source.transport} 未声明依赖`);
      if (contract) {
        if (!matchesType(source.initial, contract.output))
          add(`${at}/initial`, 'source.type', `初始值需要 ${contract.output}`);
        for (const [key, field] of Object.entries(contract.input))
          if (field.required && !Object.hasOwn(source.input, key))
            add(at, 'source.input', `数据源缺少参数 ${key}`);
      }
      for (const [key, binding] of Object.entries(source.input)) {
        const path = `${at}/input/${key}`;
        value(binding, path);
        if (contract) {
          if (!Object.hasOwn(contract.input, key))
            add(path, 'source.input', `未知数据源参数 ${key}`);
          else {
            if (binding.kind === 'literal' && !matchesType(binding.value, contract.input[key].type))
              add(path, 'source.type', `数据源参数 ${key} 类型错误`);
            checkReferenceType(binding, contract.input[key].type, path);
          }
        }
        try {
          if (compileValue(binding).usesScope)
            add(path, 'source.scope', '数据源 input 不能读取 scope');
        } catch {
          /* value reports syntax */
        }
      }
    }
    const formIds = new Set<string>();
    for (const [fi, form] of (page.forms ?? []).entries()) {
      const at = `${base}/forms/${fi}`;
      if (formIds.has(form.id) || reserved.has(form.id)) add(at, 'form.id', '重复或保留的表单 ID');
      formIds.add(form.id);
      if (!form.fields.length && !form.arrays?.length)
        add(at, 'form.empty', '表单至少需要一个字段或数组');
      const check = (v: Value, path: string) => {
        value(v, path);
        try {
          if (v.kind === 'formValues') add(path, 'form.rule', '规则不能读取提交载荷');
          if (compileValue(v).usesSources)
            add(path, 'form.rule', '表单规则暂不支持读取数据源，请使用页面状态');
          if (
            compileValue(v).dependencies.some(
              (d) => d === '*' || (d.startsWith('@form:') && d !== `@form:${form.id}`),
            )
          )
            add(path, 'form.rule', '规则只能读取明确的页面状态和当前表单值');
          if (v.kind === 'literal' && typeof v.value !== 'boolean')
            add(path, 'form.rule', '条件必须是布尔值');
        } catch {
          /* value reports invalid syntax */
        }
      };
      const checkIdentity = (entries: { id: string; path: string[] }[], prefix: string) => {
        const ids = new Set<string>(),
          paths: string[][] = [];
        for (const [i, entry] of entries.entries()) {
          const fp = `${prefix}/${i}`;
          if (ids.has(entry.id) || reserved.has(entry.id))
            add(fp, 'field.id', '重复或保留的字段 ID');
          ids.add(entry.id);
          if (
            paths.some((p) =>
              p
                .slice(0, Math.min(p.length, entry.path.length))
                .every((part, k) => part === entry.path[k]),
            )
          )
            add(fp, 'field.path', '字段路径重复或相互包含');
          paths.push(entry.path);
        }
      };
      const checkFields = (fields: FieldDefinition[], prefix: string) => {
        checkIdentity(fields, prefix);
        for (const [i, field] of fields.entries()) {
          const fp = `${prefix}/${i}`;
          if (!matchesFieldValue(field.initial, field)) add(fp, 'field.type', '字段初始值类型错误');
          if (field.uniqueItems !== undefined && field.type !== 'array')
            add(fp, 'field.type', 'uniqueItems 仅用于数组');
          if (
            field.format &&
            !(
              (field.type === 'string' && !field.range) ||
              (field.type === 'array' &&
                field.itemType === 'string' &&
                field.range &&
                field.uniqueItems === false)
            )
          )
            add(fp, 'field.format', '日期时间需为文本字段，范围需为允许重复的文本数组');
          if (field.range && !field.format) add(fp, 'field.format', '范围字段需声明日期时间格式');
          const formatError = temporalError(field.initial, field);
          if (formatError) add(fp, 'field.format', formatError);
          if (field.when) check(field.when, `${fp}/when`);
          if (field.disabled) check(field.disabled, `${fp}/disabled`);
          for (const [ri, rule] of (field.rules ?? []).entries()) {
            const rp = `${fp}/rules/${ri}`;
            if (rule.kind === 'expression') check(rule.test, `${rp}/test`);
            if (rule.kind === 'mustBeTrue' && field.type !== 'boolean')
              add(rp, 'rule.type', '必须为 true 规则只能用于布尔字段');
            if (['min', 'max'].includes(rule.kind) && field.type !== 'number')
              add(rp, 'rule.type', '数值规则只能用于数字');
            if (
              (rule.kind === 'pattern' && field.type !== 'string') ||
              (['minLength', 'maxLength'].includes(rule.kind) &&
                !['string', 'array'].includes(field.type))
            )
              add(rp, 'rule.type', '正则规则仅用于文本，长度规则用于文本或数组');
            if (
              (rule.kind === 'minLength' || rule.kind === 'maxLength') &&
              (!Number.isInteger(rule.value) || rule.value < 0)
            )
              add(rp, 'rule.range', '长度必须为非负整数');
            if (rule.kind === 'pattern')
              try {
                new RegExp(rule.value);
              } catch {
                add(rp, 'rule.pattern', '正则表达式无效');
              }
          }
        }
      };
      checkIdentity([...form.fields, ...(form.arrays ?? [])], at + '/fields-and-arrays');
      checkFields(form.fields, at + '/fields');
      for (const [i, array] of (form.arrays ?? []).entries()) {
        const ap = `${at}/arrays/${i}`;
        checkFields(array.fields, ap + '/fields');
        if (
          array.minItems !== undefined &&
          array.maxItems !== undefined &&
          array.minItems > array.maxItems
        )
          add(ap, 'array.range', '最小行数不能超过最大行数');
        if (array.when) check(array.when, ap + '/when');
        if (array.disabled) check(array.disabled, ap + '/disabled');
        for (const [ri, initial] of array.initial.entries())
          try {
            const values = rowValues(array.fields, initial);
            for (const field of array.fields) {
              const error = temporalError(values[field.id], field);
              if (error) add(`${ap}/initial/${ri}/${field.id}`, 'field.format', error);
            }
          } catch (error) {
            add(`${ap}/initial/${ri}`, 'array.initial', (error as Error).message);
          }
      }
      const computedIds = new Set<string>();
      for (const [i, entry] of (form.computed ?? []).entries()) {
        const cp = `${at}/computed/${i}`;
        if (computedIds.has(entry.id) || reserved.has(entry.id))
          add(cp, 'computed.id', '重复或保留的计算 ID');
        computedIds.add(entry.id);
        if (!Object.hasOwn(registry.computations ?? {}, entry.compute))
          add(cp, 'computed.missing', '未注册计算函数 ' + entry.compute);
        if (!Object.hasOwn(app.dependencies.computations ?? {}, entry.compute))
          add(cp, 'dependency.undeclared', '计算函数未声明依赖 ' + entry.compute);
      }
      form.rules?.forEach((rule, i) => check(rule.test, `${at}/rules/${i}/test`));
    }
    const actionIds = new Set<string>();
    const calls = (
      list: ActionCall[],
      path: string,
      eventAllowed: boolean,
      scope: ReadonlySet<string> = new Set(),
    ) =>
      list.forEach((call, i) => {
        const at = `${path}/${i}`;
        if (actionIds.has(call.id)) add(at, 'id.duplicate', `重复动作调用 ID ${call.id}`);
        actionIds.add(call.id);
        const contract = Object.hasOwn(registry.actions, call.action)
          ? registry.actions[call.action]
          : undefined;
        const localMethod = (app.methods ?? []).some(
          (method) => applicationMethodActionId(method.id) === call.action,
        );
        if (
          !localMethod &&
          call.action !== 'app.navigate' &&
          !Object.hasOwn(app.dependencies.actions, call.action)
        )
          add(at, 'dependency.undeclared', `动作 ${call.action} 未声明依赖`);
        if (contract) {
          for (const [key, field] of Object.entries(contract.input))
            if (field.required && !Object.hasOwn(call.input, key))
              add(at, 'action.input', `动作 ${call.action} 缺少参数 ${key}`);
          for (const [key, inputValue] of Object.entries(call.input)) {
            if (!Object.hasOwn(contract.input, key))
              add(`${at}/input/${key}`, 'action.input', `未知动作参数 ${key}`);
            else if (
              inputValue.kind === 'literal' &&
              !matchesType(inputValue.value, contract.input[key].type)
            )
              add(`${at}/input/${key}`, 'action.type', `参数 ${key} 类型错误`);
            if (Object.hasOwn(contract.input, key))
              checkReferenceType(inputValue, contract.input[key].type, `${at}/input/${key}`);
          }
        }
        for (const [key, v] of Object.entries(call.input))
          value(v, `${at}/input/${key}`, eventAllowed, scope);
        if (call.action === 'app.navigate') {
          const target = call.input.pageId;
          if (
            target?.kind === 'literal' &&
            typeof target.value === 'string' &&
            !app.pages.some((page) => page.id === target.value)
          )
            add(at, 'page.missing', `未知目标页面 ${target.value}`);
        }
        if (call.action === 'data.execute') {
          const target = call.input.sourceId;
          if (target?.kind === 'literal' && typeof target.value === 'string') {
            const definition = sources.get(target.value);
            if (!definition) add(at, 'source.missing', `未知数据源 ${target.value}`);
            else {
              const transport = registry.transports?.[definition.transport];
              if (transport && call.input.input?.kind === 'literal') {
                try {
                  checkTransportInput(transport, call.input.input.value, true);
                } catch (error) {
                  add(`${at}/input/input`, 'source.input', (error as Error).message);
                }
              }
              if (
                call.resultTo &&
                transport?.output &&
                transport.output !== 'json' &&
                states.has(call.resultTo) &&
                states.get(call.resultTo)!.type !== transport.output
              )
                add(at, 'source.type', '数据源返回类型与结果状态不匹配');
            }
          }
        }
        if (call.resultTo && !states.has(call.resultTo))
          add(at, 'state.missing', `未知结果状态 ${call.resultTo}`);
        if (call.resultTo && contract && !contract.output)
          add(at, 'action.output', '此动作未声明返回值');
        if (
          call.resultTo &&
          contract?.output &&
          contract.output !== 'json' &&
          states.has(call.resultTo) &&
          states.get(call.resultTo)!.type !== contract.output
        )
          add(at, 'action.output', '动作返回类型与结果状态不匹配');
        if (call.action === 'state.set') {
          const target = call.input.stateId;
          if (!Object.hasOwn(call.input, 'value')) add(at, 'action.input', 'state.set 缺少 value');
          if (
            target?.kind === 'literal' &&
            typeof target.value === 'string' &&
            !states.has(target.value)
          )
            add(at, 'state.missing', `未知目标状态 ${target.value}`);
          if (
            target?.kind === 'literal' &&
            typeof target.value === 'string' &&
            states.has(target.value) &&
            call.input.value?.kind === 'literal' &&
            !matchesType(call.input.value.value, states.get(target.value)!.type)
          )
            add(at, 'action.type', 'state.set 的值与目标状态类型不匹配');
          if (
            target?.kind === 'literal' &&
            typeof target.value === 'string' &&
            states.has(target.value) &&
            call.input.value
          )
            checkReferenceType(
              call.input.value,
              states.get(target.value)!.type,
              `${at}/input/value`,
            );
        }
        if (['form.setValues', 'form.reset', 'form.submit'].includes(call.action)) {
          const target = call.input.formId;
          if (
            target?.kind === 'literal' &&
            typeof target.value === 'string' &&
            !forms.has(target.value)
          )
            add(at, 'form.missing', `未知目标表单 ${target.value}`);
          if (
            call.action === 'form.setValues' &&
            target?.kind === 'literal' &&
            typeof target.value === 'string' &&
            forms.has(target.value) &&
            call.input.values?.kind === 'literal'
          ) {
            try {
              prepareFormPatch(forms.get(target.value)!, call.input.values.value);
            } catch (error) {
              add(`${at}/input/values`, 'action.input', (error as Error).message);
            }
          }
        }
      });
    const nodeIds = new Set<string>();
    const nodes = (list: NodeSchema[], path: string, outerScope: ReadonlySet<string> = new Set()) =>
      list.forEach((node, i) => {
        const at = `${path}/${i}`;
        const localScope = new Set([
          ...outerScope,
          ...(node.repeat ? [node.repeat.item, node.repeat.index ?? 'index'] : []),
        ]);
        if (nodeIds.has(node.id)) add(at, 'id.duplicate', `重复节点 ID ${node.id}`);
        nodeIds.add(node.id);
        const contract = Object.hasOwn(registry.components, node.component)
          ? registry.components[node.component]
          : undefined;
        if (!Object.hasOwn(app.dependencies.components, node.component))
          add(at, 'dependency.undeclared', `组件 ${node.component} 未声明依赖`);
        if (
          node.style &&
          (!contract?.style || !['root', 'field', 'popup'].includes(contract.style.target))
        )
          add(`${at}/style`, 'style.unsupported', '物料没有声明可用的样式目标');
        for (const [key, binding] of Object.entries(node.style ?? {})) {
          const path = `${at}/style/${key}`;
          value(binding, path, false, localScope);
          if (!isStyleProperty(key) || !contract?.style?.properties.includes(key)) {
            add(path, 'style.unsupported', `物料不支持样式 ${key}`);
            continue;
          }
          const error =
            binding.kind === 'literal' ? styleValueError(key, binding.value) : undefined;
          if (error) add(path, 'style.value', error);
          const type = knownType(binding);
          if (
            type &&
            type !== 'json' &&
            !styleValueTypes(key).includes(type as 'string' | 'number')
          )
            add(path, 'style.type', `样式 ${key} 不接收 ${type} 类型`);
          try {
            assertValueScope(binding, localScope);
          } catch (error) {
            add(path, 'style.scope', (error as Error).message);
          }
        }
        if (contract) {
          if (node.formId && (!contract.form || !forms.has(node.formId)))
            add(at, 'form.binding', '物料不支持表单绑定或表单不存在');
          if (node.formId && (node.field || node.repeat))
            add(at, 'form.binding', '表单容器不能同时绑定字段或重复');
          if (node.field) {
            const field = forms
              .get(node.field.formId)
              ?.fields.find((f) => f.id === node.field!.fieldId);
            if (!field) add(at, 'field.missing', '绑定字段不存在');
            if (!contract.field || (field && !fieldTypes(contract).includes(field.type)))
              add(at, 'field.binding', '字段类型与物料适配器不匹配');
            if (
              contract.field &&
              contract.field.valueProp !==
                (fieldTypes(contract).every((type) => type === 'boolean') ? 'checked' : 'value')
            )
              add(at, 'field.binding', '字段适配器需要使用原生 value/checked 属性');
            if (
              node.repeat ||
              node.when ||
              ['value', 'checked', 'label', 'required', 'disabled', 'error', 'name'].some((k) =>
                Object.hasOwn(node.props, k),
              ) ||
              node.on?.onChange ||
              node.on?.onValueChange ||
              node.on?.onCheckedChange ||
              node.on?.onBlur
            )
              add(
                at,
                'field.binding',
                '字段值、标签、状态及 change/blur 事件由表单管理；条件写在字段定义中',
              );
          }
          for (const [key, field] of Object.entries(contract.props))
            if (
              field.required &&
              !Object.hasOwn(node.props, key) &&
              !(node.field && ['label', 'value', 'checked'].includes(key))
            )
              add(at, 'prop.required', `组件 ${node.component} 缺少属性 ${key}`);
          const literalProps = Object.fromEntries(
            Object.entries(node.props)
              .filter(([, value]) => value.kind === 'literal')
              .map(([key, value]) => [key, value.kind === 'literal' ? value.value : undefined]),
          );
          if (
            contract.fieldArray &&
            typeof literalProps.formId === 'string' &&
            typeof literalProps.arrayId === 'string' &&
            !forms
              .get(literalProps.formId)
              ?.arrays?.some((array) => array.id === literalProps.arrayId)
          )
            add(at, 'array.binding', '绑定的明细模型不存在');
          for (const message of contract.validateProps?.(literalProps, {
            array:
              contract.fieldArray &&
              typeof literalProps.formId === 'string' &&
              typeof literalProps.arrayId === 'string'
                ? forms
                    .get(literalProps.formId)
                    ?.arrays?.find((array) => array.id === literalProps.arrayId)
                : undefined,
            field: node.field
              ? forms.get(node.field.formId)?.fields.find((f) => f.id === node.field!.fieldId)
              : undefined,
            fieldItemType: node.field
              ? forms
                  .get(node.field.formId)
                  ?.fields.find((field) => field.id === node.field!.fieldId)?.itemType
              : undefined,
            fieldType: node.field
              ? forms
                  .get(node.field.formId)
                  ?.fields.find((field) => field.id === node.field!.fieldId)?.type
              : undefined,
          }) ?? [])
            add(`${at}/props`, 'prop.value', message);
          for (const [key, v] of Object.entries(node.props)) {
            if (!Object.hasOwn(contract.props, key))
              add(`${at}/props/${key}`, 'prop.unknown', `未知属性 ${key}`);
            else if (v.kind === 'literal' && !matchesType(v.value, contract.props[key].type))
              add(`${at}/props/${key}`, 'prop.type', `属性 ${key} 类型错误`);
            if (Object.hasOwn(contract.props, key))
              checkReferenceType(v, contract.props[key].type, `${at}/props/${key}`);
          }
          for (const name of Object.keys(node.on ?? {}))
            if (!contract.events?.includes(name)) add(at, 'event.unknown', `不支持事件 ${name}`);
          if (node.children?.length && !contract.children)
            add(at, 'children.unsupported', '组件不接收 children');
          for (const [name, slot] of Object.entries(node.slots ?? {})) {
            const params =
              contract.slots && Object.hasOwn(contract.slots, name)
                ? contract.slots[name]
                : undefined;
            if (!params) add(at, 'slot.unknown', `未知插槽 ${name}`);
            else
              for (const param of slot.params)
                if (!params.includes(param) || reserved.has(param))
                  add(at, 'slot.param', `插槽 ${name} 不提供参数 ${param}`);
          }
        }
        const logicType = (v: Value, allowed: string[], path: string) => {
          const actual =
            v.kind === 'literal'
              ? Array.isArray(v.value)
                ? 'array'
                : v.value === null
                  ? 'null'
                  : typeof v.value
              : knownType(v);
          if (
            (actual && actual !== 'json' && !allowed.includes(actual)) ||
            (v.kind === 'literal' && typeof v.value === 'number' && !Number.isFinite(v.value))
          )
            add(path, 'logic.type', `此处需要 ${allowed.join(' / ')} 类型`);
        };
        for (const [key, v] of Object.entries(node.props))
          value(v, `${at}/props/${key}`, false, localScope);
        if (node.when) {
          value(node.when, `${at}/when`, false, localScope);
          logicType(node.when, ['boolean'], `${at}/when`);
        }
        if (node.repeat) {
          value(node.repeat.items, `${at}/repeat/items`, false, outerScope);
          value(node.repeat.key, `${at}/repeat/key`, false, localScope);
          logicType(node.repeat.items, ['array'], `${at}/repeat/items`);
          logicType(node.repeat.key, ['string', 'number'], `${at}/repeat/key`);
          if (
            reserved.has(node.repeat.item) ||
            reserved.has(node.repeat.index ?? 'index') ||
            node.repeat.item === (node.repeat.index ?? 'index')
          )
            add(at, 'scope.invalid', '循环变量名冲突或使用保留字');
        }
        for (const [name, list] of Object.entries(node.on ?? {}))
          calls(list, `${at}/on/${name}`, true, localScope);
        nodes(node.children ?? [], `${at}/children`, localScope);
        for (const [name, slot] of Object.entries(node.slots ?? {}))
          nodes(
            slot.children,
            `${at}/slots/${name}/children`,
            new Set([...localScope, ...slot.params]),
          );
      });
    calls(page.onEnter ?? [], `${base}/onEnter`, false);
    nodes(page.children, `${base}/children`);
  });
  if (!pageIds.has(app.entryPageId)) add('/entryPageId', 'page.missing', '入口页面不存在');
  return issues;
}
