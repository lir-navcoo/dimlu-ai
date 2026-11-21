import { useId } from 'react';
import type { ContractField } from '../../packages/runtime/registry';
import type { PageSchema, Value } from '../../packages/schema/types';
import { Input, Select } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import { ExpressionContext, type ExpressionContextProps } from './ExpressionContext';
import { ReferencePaths, type ReferencePathOwner } from './ReferencePaths';
import { EventReferencePaths, type EventReferenceOwner } from './EventReferencePaths';
import { PageEntryReferencePaths, type PageEntryReferenceOwner } from './PageEntryReferencePaths';

export type BindingDraft = {
  kind: Value['kind'] | 'unset';
  text: string;
  stateId: string;
  sourceId: string;
  path: string;
  formId: string;
  fieldId: string;
};
export function bindingDraft(value: Value | undefined, field: ContractField): BindingDraft {
  return {
    kind: value?.kind ?? 'unset',
    text:
      value?.kind === 'literal'
        ? field.type === 'string'
          ? String(value.value)
          : JSON.stringify(value.value, null, 2)
        : value?.kind === 'expression'
          ? value.source
          : '',
    stateId: value?.kind === 'stateRef' ? value.stateId : '',
    path:
      (value?.kind === 'stateRef' || value?.kind === 'dataRef') && value.path
        ? JSON.stringify(value.path)
        : '',
    sourceId: value?.kind === 'dataRef' ? value.sourceId : '',
    formId: value?.kind === 'fieldRef' || value?.kind === 'formValues' ? value.formId : '',
    fieldId: value?.kind === 'fieldRef' ? value.fieldId : '',
  };
}
export function parseBinding(draft: BindingDraft, field: ContractField): Value | undefined {
  switch (draft.kind) {
    case 'unset':
      if (field.required) throw new Error('必填参数尚未设置');
      return undefined;
    case 'literal':
      return {
        kind: 'literal',
        value: field.type === 'string' ? draft.text : JSON.parse(draft.text),
      };
    case 'expression':
      return { kind: 'expression', language: 'javascript', source: draft.text };
    case 'stateRef':
      if (!draft.stateId) throw new Error('请选择页面状态');
      const path: unknown = draft.path ? JSON.parse(draft.path) : undefined;
      if (
        path !== undefined &&
        (!Array.isArray(path) || !path.every((key) => typeof key === 'string'))
      )
        throw new Error('状态路径必须是 JSON 字符串数组');
      return {
        kind: 'stateRef',
        stateId: draft.stateId,
        ...(path ? { path: path as string[] } : {}),
      };
    case 'dataRef': {
      const path: unknown = draft.path ? JSON.parse(draft.path) : undefined;
      if (
        !draft.sourceId ||
        (path !== undefined &&
          (!Array.isArray(path) || !path.every((key) => typeof key === 'string')))
      )
        throw new Error('数据源引用需要 sourceId 和 JSON 字符串数组路径');
      return {
        kind: 'dataRef',
        sourceId: draft.sourceId,
        ...(path ? { path: path as string[] } : {}),
      };
    }
    case 'fieldRef':
      if (!draft.formId || !draft.fieldId) throw new Error('请选择表单及字段');
      return { kind: 'fieldRef', formId: draft.formId, fieldId: draft.fieldId };
    case 'formValues':
      if (!draft.formId) throw new Error('请选择表单');
      return { kind: 'formValues', formId: draft.formId };
  }
}
export function ValueInput({
  label,
  field,
  draft,
  onChange,
  page,
  showMode = true,
  showLabel = true,
  pageScope = false,
  expressionContext,
  referenceOwner,
  eventReferenceOwner,
  pageReferenceOwner,
  readOnly = false,
}: {
  label: string;
  field: ContractField;
  draft: BindingDraft;
  onChange: (v: BindingDraft) => void;
  page: PageSchema;
  showMode?: boolean;
  showLabel?: boolean;
  pageScope?: boolean;
  expressionContext?: ExpressionContextProps;
  referenceOwner?: ReferencePathOwner;
  eventReferenceOwner?: EventReferenceOwner;
  pageReferenceOwner?: PageEntryReferenceOwner;
  readOnly?: boolean;
}) {
  const id = useId();
  const update = (patch: Partial<BindingDraft>) => {
    if (!readOnly) onChange({ ...draft, ...patch });
  };
  return (
    <div className="action-parameter">
      {showLabel && (
        <div className="action-parameter-label">
          <label htmlFor={id}>
            {label}
            {field.required ? ' *' : ''}
          </label>
          <code>{field.type}</code>
        </div>
      )}
      {showMode && (
        <Select
          disabled={readOnly}
          aria-label={`${label}取值方式`}
          value={draft.kind}
          onValueChange={(kind) => update({ kind: kind as BindingDraft['kind'] })}
        >
          <option value="unset">不设置</option>
          <option value="literal">固定值</option>
          <option value="stateRef">页面状态</option>
          <option value="fieldRef">表单字段</option>
          <option value="formValues">表单数据</option>
          <option value="expression">JavaScript 表达式</option>
          <option value="dataRef">数据源</option>
        </Select>
      )}
      {draft.kind === 'dataRef' && (
        <>
          <Select
            disabled={readOnly}
            id={id}
            aria-label={`${label}数据源`}
            value={draft.sourceId}
            onValueChange={(sourceId) => update({ sourceId })}
          >
            <option value="">请选择数据源</option>
            {page.dataSources?.map((source) => (
              <option key={source.id} value={source.id}>
                {source.id}
              </option>
            ))}
          </Select>
          <Input
            readOnly={readOnly}
            aria-label={`${label}数据路径`}
            placeholder={'可选 JSON 路径，例如 ["rows"]'}
            value={draft.path}
            onChange={(event) => update({ path: event.target.value })}
          />
          {!readOnly &&
            pageScope &&
            pageReferenceOwner &&
            !referenceOwner &&
            !eventReferenceOwner && (
              <PageEntryReferencePaths
                owner={pageReferenceOwner}
                label={label}
                page={page}
                source={page.dataSources?.find((source) => source.id === draft.sourceId)}
                binding={draft}
              />
            )}
          {!readOnly && !pageReferenceOwner && referenceOwner && (
            <ReferencePaths
              owner={referenceOwner}
              label={label}
              page={page}
              source={page.dataSources?.find((source) => source.id === draft.sourceId)}
              binding={draft}
              onChoose={(path) => update({ path })}
            />
          )}
          {!readOnly && !pageReferenceOwner && !referenceOwner && eventReferenceOwner && (
            <EventReferencePaths
              owner={eventReferenceOwner}
              label={label}
              page={page}
              source={page.dataSources?.find((source) => source.id === draft.sourceId)}
              binding={draft}
              onChoose={(path) => update({ path })}
            />
          )}
        </>
      )}
      {draft.kind === 'literal' &&
        (field.type === 'string' ? (
          <Input
            readOnly={readOnly}
            id={id}
            aria-label={label}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
          />
        ) : (
          <CodeEditor
            readOnly={readOnly}
            id={id}
            label={label}
            language="json"
            value={draft.text}
            height={112}
            placeholder="JSON 值"
            onChange={(text) => update({ text })}
          />
        ))}
      {draft.kind === 'expression' && (
        <>
          <CodeEditor
            readOnly={readOnly}
            id={id}
            label={label}
            language="javascript"
            value={draft.text}
            height={112}
            placeholder={
              pageScope ? '例如 state.query 或 sources.people.data' : '请输入 JavaScript 表达式'
            }
            onChange={(text) => update({ text })}
          />
          {expressionContext && !pageScope && <ExpressionContext {...expressionContext} />}
        </>
      )}
      {draft.kind === 'stateRef' && (
        <>
          <Select
            disabled={readOnly}
            id={id}
            aria-label={`${label}页面状态`}
            value={draft.stateId}
            onValueChange={(stateId) => update({ stateId })}
          >
            <option value="">请选择状态</option>
            {page.state.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
          </Select>
          <Input
            readOnly={readOnly}
            aria-label={`${label}状态路径`}
            placeholder={'可选 JSON 路径，例如 ["profile", "name"]'}
            value={draft.path}
            onChange={(e) => update({ path: e.target.value })}
          />
        </>
      )}
      {(draft.kind === 'fieldRef' || draft.kind === 'formValues') && (
        <Select
          disabled={readOnly}
          id={id}
          aria-label={`${label}表单`}
          value={draft.formId}
          onValueChange={(formId) => update({ formId, fieldId: '' })}
        >
          <option value="">请选择表单</option>
          {page.forms?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.id}
            </option>
          ))}
        </Select>
      )}
      {draft.kind === 'fieldRef' && (
        <Select
          disabled={readOnly}
          aria-label={`${label}字段`}
          value={draft.fieldId}
          onValueChange={(fieldId) => update({ fieldId })}
        >
          <option value="">请选择字段</option>
          {page.forms
            ?.find((f) => f.id === draft.formId)
            ?.fields.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} · {f.path.join('.')}
              </option>
            ))}
        </Select>
      )}
    </div>
  );
}
