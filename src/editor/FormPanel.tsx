import { Button, Input as UiInput, Select, Checkbox } from '../ui/primitives';
import { Dialog } from '@base-ui/react/dialog';
import { CodeEditor } from '../ui/CodeEditor';
import { useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';
import { DraftNotice, useDraft, useEditorSession, useSessionState } from './session';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { nearestForm } from '../../packages/editor/forms';
import { acceptsField, fieldTypes } from '../../packages/runtime/registry';
import type {
  FieldDefinition,
  FieldRule,
  NodeSchema,
  PageSchema,
  Value,
} from '../../packages/schema/types';
import { matchesFieldValue } from '../../packages/schema/types';
import { bindingDraft, parseBinding, ValueInput, type BindingDraft } from './ValueEditor';
import { errorText } from './errors';
import { useAuthorGuard } from './author-guard';
type Props = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  node?: NodeSchema;
  mode?: 'binding' | 'models';
};
type FieldType = FieldDefinition['type'];
type EditableRuleKind = Exclude<FieldRule['kind'], 'expression'>;
type RuleDraft =
  | {
      kind: EditableRuleKind;
      draft: string;
      message: string;
    }
  | {
      kind: 'expression';
      test: Value;
      draft: string;
      message: string;
    };
type ConditionKind = 'when' | 'disabled';
const conditionField = { type: 'boolean' as const };
type FieldEditorDraft = {
  field: FieldDefinition;
  path: string;
  numberDraft: string;
  arrayDraft: string;
  rules: RuleDraft[];
  conditions: { when: BindingDraft; disabled: BindingDraft };
};
const typeNames = { string: '文本', number: '数字', boolean: '布尔', array: '数组（多选值）' };
const ruleNames = {
  required: '必填',
  mustBeTrue: '必须为 true（勾选 / 开启）',
  min: '最小值',
  max: '最大值',
  minLength: '最短长度',
  maxLength: '最长长度',
  pattern: '正则表达式',
  expression: '表达式',
};
const blankField = (
  type: FieldType,
  itemType: 'string' | 'number' = 'string',
): FieldDefinition => ({
  id: '',
  path: [],
  label: '',
  type,
  ...(type === 'array' ? { itemType } : {}),
  initial: type === 'array' ? [] : type === 'string' ? '' : type === 'number' ? null : false,
});
function FieldConditionEditor({
  kind,
  value,
  page,
  formId,
  onChange,
}: {
  kind: ConditionKind;
  value: BindingDraft;
  page: PageSchema;
  formId?: string;
  onChange: (value: BindingDraft) => void;
}) {
  const label = kind === 'when' ? '显示条件' : '禁用条件';
  const states = page.state.filter((state) => state.type === 'boolean');
  const fields = page.forms
    ?.find((form) => form.id === formId)
    ?.fields.filter((field) => field.type === 'boolean');
  const statePath =
    value.path || (value.stateId && !states.some((state) => state.id === value.stateId));
  return (
    <div className="field-condition">
      <label>
        {label}取值方式
        <Select
          aria-label={`${label}取值方式`}
          value={value.kind}
          onValueChange={(next) => {
            const base = bindingDraft(undefined, conditionField);
            onChange({
              ...base,
              kind: next as BindingDraft['kind'],
              text: next === 'literal' ? 'false' : '',
              formId: next === 'fieldRef' ? (formId ?? '') : '',
            });
          }}
        >
          <option value="unset">{kind === 'when' ? '默认（始终显示）' : '默认（不禁用）'}</option>
          <option value="literal">固定布尔值</option>
          <option value="stateRef">页面状态</option>
          <option value="fieldRef" disabled={!fields?.length && value.kind !== 'fieldRef'}>
            同表单字段
          </option>
          <option value="expression">JS 表达式</option>
        </Select>
      </label>
      {value.kind === 'literal' ? (
        <label className="field-condition-boolean">
          <Checkbox
            aria-label={`${label}固定值`}
            checked={value.text === 'true'}
            onCheckedChange={(checked) => onChange({ ...value, text: String(checked) })}
          />
          条件为 true
        </label>
      ) : value.kind === 'stateRef' ? (
        <Select
          aria-label={`${label}页面状态`}
          value={statePath ? ':existing' : value.stateId}
          onValueChange={(stateId) => {
            if (stateId !== ':existing') onChange({ ...value, stateId, path: '' });
          }}
        >
          <option value="">请选择布尔状态</option>
          {statePath && (
            <option value=":existing">
              {value.stateId}
              {value.path && ` · ${value.path}`}
            </option>
          )}
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.id}
            </option>
          ))}
        </Select>
      ) : value.kind === 'fieldRef' ? (
        <Select
          aria-label={`${label}字段`}
          value={value.fieldId}
          onValueChange={(fieldId) => onChange({ ...value, fieldId })}
        >
          <option value="">请选择同表单布尔字段</option>
          {fields?.map((field) => (
            <option key={field.id} value={field.id}>
              {field.label} · {field.path.join('.')}
            </option>
          ))}
        </Select>
      ) : value.kind === 'expression' ? (
        <>
          <ValueInput
            label={label}
            field={conditionField}
            draft={value}
            onChange={onChange}
            page={page}
            showMode={false}
            showLabel={false}
          />
          <p className="editor-note">
            可使用页面状态 <code>state</code> 和当前表单 <code>forms</code>，结果须为布尔值。
          </p>
        </>
      ) : null}
      <p className="editor-note">
        {kind === 'when'
          ? '仅结果为 true 时显示字段；隐藏时不参与校验和提交。'
          : '结果为 true 时禁用字段；禁用值仍参与校验和提交。'}
      </p>
    </div>
  );
}
function FieldEditor({
  draftKey,
  initial,
  page,
  conditionFormId,
  creating = false,
  fixedType,
  allowedTypes,
  allowedItemTypes,
  submitLabel,
  inDialog = false,
  canSave,
  onSave,
}: {
  draftKey: string;
  initial: FieldDefinition;
  page: PageSchema;
  conditionFormId?: string;
  creating?: boolean;
  fixedType?: FieldType;
  allowedTypes?: readonly FieldType[];
  allowedItemTypes?: readonly ('string' | 'number')[];
  submitLabel: string;
  inDialog?: boolean;
  canSave: () => boolean;
  onSave: (field: FieldDefinition) => void;
}) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [draft, setDraft, status] = useDraft<FieldEditorDraft>(draftKey, JSON.stringify(initial), {
    field: structuredClone(initial),
    path: initial.path.join('.'),
    numberDraft: String(initial.initial ?? ''),
    arrayDraft: JSON.stringify(initial.initial),
    rules: (initial.rules ?? []).map((rule) => ({
      ...structuredClone(rule),
      draft: 'value' in rule ? String(rule.value) : '',
    })) as RuleDraft[],
    conditions: {
      when: bindingDraft(initial.when, conditionField),
      disabled: bindingDraft(initial.disabled, conditionField),
    },
  });
  const { field, path, numberDraft, arrayDraft, rules, conditions } = draft;
  const patch = <K extends keyof typeof draft>(key: K, next: SetStateAction<(typeof draft)[K]>) =>
    setDraft((current) => ({
      ...current,
      [key]:
        typeof next === 'function'
          ? (next as (value: (typeof draft)[K]) => (typeof draft)[K])(current[key])
          : next,
    }));
  const setField = (value: SetStateAction<FieldDefinition>) => patch('field', value);
  const setPath = (value: string) => patch('path', value);
  const setNumberDraft = (value: string) => patch('numberDraft', value);
  const setRules = (value: SetStateAction<RuleDraft[]>) => patch('rules', value);
  const [error, setError] = useState('');
  const changeRule = (index: number, patch: Partial<Pick<RuleDraft, 'draft' | 'message'>>) =>
    setRules((items) => items.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  return (
    <form
      className="field-definition"
      aria-label={creating ? '新建字段配置' : '字段配置'}
      onSubmit={(event) => {
        event.preventDefault();
        if (!mounted.current || !canSave()) return;
        try {
          if (status.stale) throw new Error('定义已变化，请先确认使用草稿或放弃草稿');
          if (!field.label.trim()) throw new Error('请填写字段名称');
          const next = structuredClone(field);
          for (const kind of ['when', 'disabled'] as const) {
            const condition = conditions[kind];
            const original = bindingDraft(field[kind], conditionField);
            if (JSON.stringify(condition) === JSON.stringify(original)) continue;
            const label = kind === 'when' ? '显示条件' : '禁用条件';
            try {
              if (condition.kind === 'expression' && !condition.text.trim())
                throw new Error('请填写布尔表达式');
              const value = parseBinding(condition, conditionField);
              if (value) next[kind] = value;
              else delete next[kind];
            } catch (error) {
              throw new Error(`${label}：${errorText(error)}`);
            }
          }
          if (creating) {
            next.path = path.split('.').map((p) => p.trim());
            if (!next.id.trim() || next.id !== next.id.trim() || next.path.some((p) => !p))
              throw new Error('字段 ID 和数据路径不能为空，也不能包含空路径段');
          }
          if (next.type === 'number') {
            next.initial = numberDraft.trim() === '' ? null : Number(numberDraft);
            if (next.initial !== null && !Number.isFinite(next.initial))
              throw new Error('默认值必须是有效数字');
          }
          if (next.type === 'array') {
            const values: unknown = JSON.parse(arrayDraft);
            if (!matchesFieldValue(values, next))
              throw new Error('默认值必须符合数组元素类型和去重设置');
            next.initial = values as (string | number)[];
          }
          next.rules = rules.map(({ draft, ...rule }): FieldRule => {
            if (!rule.message.trim()) throw new Error('请填写校验提示');
            if (rule.kind === 'expression')
              return { kind: rule.kind, test: rule.test, message: rule.message };
            if (rule.kind === 'required' || rule.kind === 'mustBeTrue')
              return { kind: rule.kind, message: rule.message };
            if (rule.kind === 'pattern')
              return { kind: rule.kind, message: rule.message, value: draft };
            if (!draft.trim() || !Number.isFinite(Number(draft)))
              throw new Error('校验值必须是有效数字');
            return { kind: rule.kind, message: rule.message, value: Number(draft) };
          });
          onSave(next);
          status.reset();
          setError('');
        } catch (e) {
          setError(errorText(e));
        }
      }}
    >
      <div className={inDialog ? 'workbench-dialog-scroll field-definition-fields' : undefined}>
        <DraftNotice {...status} />
        {creating ? (
          <>
            <label>
              字段 ID
              <UiInput
                aria-label="字段 ID"
                value={field.id}
                onChange={(e) => {
                  const id = e.target.value;
                  setField({ ...field, id });
                  if (!path || path === field.id) setPath(id);
                }}
              />
            </label>
            <label>
              数据路径
              <UiInput
                aria-label="数据路径"
                value={path}
                placeholder="例如 applicant.name"
                onChange={(e) => setPath(e.target.value)}
              />
            </label>
            {!fixedType && (
              <label>
                字段类型
                <Select
                  aria-label="字段类型"
                  value={field.type}
                  onValueChange={(e) => {
                    const type = e as FieldType;
                    setField({ ...blankField(type), id: field.id, label: field.label });
                    setNumberDraft('');
                    patch('arrayDraft', '[]');
                    setRules([]);
                  }}
                >
                  {Object.entries(typeNames)
                    .filter(([type]) => !allowedTypes || allowedTypes.includes(type as FieldType))
                    .map(([type, title]) => (
                      <option key={type} value={type}>
                        {title}
                      </option>
                    ))}
                </Select>
              </label>
            )}
          </>
        ) : (
          <p className="editor-note">
            {field.id} · {typeNames[field.type]} · {field.path.join('.')}
            <br />
            修改后影响所有绑定此字段的组件。
          </p>
        )}
        {creating && field.type === 'array' && (
          <label>
            数组元素类型
            <Select
              aria-label="数组元素类型"
              value={field.itemType ?? 'string'}
              onValueChange={(value) => {
                setField({ ...field, itemType: value as 'string' | 'number', initial: [] });
                patch('arrayDraft', '[]');
              }}
            >
              {(['string', 'number'] as const)
                .filter((type) => !allowedItemTypes || allowedItemTypes.includes(type))
                .map((type) => (
                  <option key={type} value={type}>
                    {typeNames[type]}
                  </option>
                ))}
            </Select>
          </label>
        )}
        <label>
          字段名称
          <UiInput
            aria-label="字段名称"
            value={field.label}
            onChange={(e) => setField({ ...field, label: e.target.value })}
          />
        </label>
        <label>
          默认值
          {field.type === 'boolean' ? (
            <Checkbox
              aria-label="字段默认值"
              checked={field.initial === true}
              onCheckedChange={(e) => setField({ ...field, initial: e })}
            />
          ) : field.type === 'array' ? (
            <CodeEditor
              label="字段默认值"
              language="json"
              height={112}
              value={arrayDraft}
              onChange={(value) => patch('arrayDraft', value)}
            />
          ) : (
            <UiInput
              aria-label="字段默认值"
              type={field.type === 'number' ? 'number' : 'text'}
              step="any"
              value={field.type === 'number' ? numberDraft : String(field.initial)}
              onChange={(e) => {
                if (field.type === 'number') setNumberDraft(e.target.value);
                else setField({ ...field, initial: e.target.value });
              }}
            />
          )}
        </label>
        {field.type === 'array' && (
          <p className="editor-note">
            {field.itemType === 'number' ? '数字' : '文本'}数组，默认值使用 JSON，例如{' '}
            {field.itemType === 'number' ? '[1, 2]' : '["a", "b"]'}
            {field.range
              ? '；范围使用两个起止值，允许起止相同；空数组表示未填写。'
              : '；空数组表示未选择，长度规则按选择项数校验。'}
          </p>
        )}
        {field.type === 'number' && <small>留空表示未填写（null）。</small>}
        {field.type === 'boolean' && (
          <p className="editor-note">
            false 是有效值。“必填”不会要求勾选；必须同意或开启时，请使用“必须为 true”规则。
          </p>
        )}
        <div className="field-rules">
          <strong>校验规则</strong>
          {rules.map((rule, index) => (
            <div className="field-rule" key={index}>
              {rule.kind === 'expression' ? (
                <>
                  <strong>表达式规则（保留）</strong>
                  <code>{JSON.stringify(rule.test)}</code>
                  <small>{rule.message}</small>
                </>
              ) : (
                <>
                  <label>
                    规则 {index + 1}
                    <Select
                      aria-label={`规则 ${index + 1} 类型`}
                      value={rule.kind}
                      onValueChange={(e) =>
                        setRules((items) =>
                          items.map((r, i) =>
                            i !== index
                              ? r
                              : {
                                  kind: e as EditableRuleKind,
                                  message: r.message,
                                  draft: '',
                                },
                          ),
                        )
                      }
                    >
                      {(
                        [
                          'required',
                          ...(field.type === 'boolean' ? ['mustBeTrue'] : []),
                          ...(field.type === 'string'
                            ? ['minLength', 'maxLength', 'pattern']
                            : field.type === 'array'
                              ? ['minLength', 'maxLength']
                              : field.type === 'number'
                                ? ['min', 'max']
                                : []),
                        ] as (keyof typeof ruleNames)[]
                      ).map((kind) => (
                        <option key={kind} value={kind}>
                          {field.type === 'array' && kind === 'minLength'
                            ? '最少选择项数'
                            : field.type === 'array' && kind === 'maxLength'
                              ? '最多选择项数'
                              : ruleNames[kind]}
                        </option>
                      ))}
                    </Select>
                  </label>
                  {rule.kind !== 'required' && rule.kind !== 'mustBeTrue' && (
                    <label>
                      校验值
                      <UiInput
                        aria-label={`规则 ${index + 1} 校验值`}
                        type={rule.kind === 'pattern' ? 'text' : 'number'}
                        step="any"
                        value={rule.draft}
                        onChange={(e) => changeRule(index, { draft: e.target.value })}
                      />
                    </label>
                  )}
                  <label>
                    错误提示
                    <UiInput
                      aria-label={`规则 ${index + 1} 错误提示`}
                      value={rule.message}
                      onChange={(e) => changeRule(index, { message: e.target.value })}
                    />
                  </label>
                  <Button
                    type="button"
                    onClick={() => setRules((items) => items.filter((_, i) => i !== index))}
                  >
                    移除规则 {index + 1}
                  </Button>
                </>
              )}
            </div>
          ))}
          <Button
            type="button"
            onClick={() =>
              setRules((items) => [
                ...items,
                {
                  kind: field.type === 'boolean' ? 'mustBeTrue' : 'required',
                  message:
                    (field.type === 'boolean' ? '请勾选或开启' : '请填写') +
                    (field.label || '此字段'),
                  draft: '',
                },
              ])
            }
          >
            ＋ 添加校验规则
          </Button>
        </div>
        <section className="field-conditions" aria-label="字段条件">
          <h4>显示与禁用条件</h4>
          <FieldConditionEditor
            kind="when"
            value={conditions.when}
            page={page}
            formId={conditionFormId}
            onChange={(when) => patch('conditions', (current) => ({ ...current, when }))}
          />
          <FieldConditionEditor
            kind="disabled"
            value={conditions.disabled}
            page={page}
            formId={conditionFormId}
            onChange={(disabled) => patch('conditions', (current) => ({ ...current, disabled }))}
          />
        </section>
      </div>
      <div className={inDialog ? 'workbench-dialog-actions field-definition-actions' : undefined}>
        {error && (
          <p role="alert" className="property-error">
            {error}
          </p>
        )}
        <Button className="apply-button" type="submit" disabled={status.stale}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
export function FormPanel({ document, snapshot, node, mode = 'binding' }: Props) {
  const canAuthor = useAuthorGuard(document, snapshot, node?.id);
  const pageId = snapshot.selection.pageId;
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const forms = page.forms ?? [];
  const contract = node && snapshot.plan.registry.components[node.component];
  const literalProps = Object.fromEntries(
    Object.entries(node?.props ?? {})
      .filter(([, value]) => value.kind === 'literal')
      .map(([key, value]) => [key, value.kind === 'literal' ? value.value : undefined]),
  );
  const compatibleTypes = contract
    ? fieldTypes(contract).filter((type) => acceptsField(contract, type, literalProps))
    : [];
  const compatibleItemTypes = contract
    ? (['string', 'number'] as const).filter((type) =>
        acceptsField(contract, 'array', literalProps, type),
      )
    : [];
  const owner = node && nearestForm(page, node.id, snapshot.plan.registry);
  const ownerModel = forms.find((form) => form.id === owner?.formId);
  const foreignBinding = !!node?.field && node.field.formId !== ownerModel?.id;
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [fieldDialogKey, setFieldDialogKey] = useState<string | null>(null);
  const fieldTrigger = useRef<HTMLButtonElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'field'; formId: string; fieldId: string; plan: EditorSnapshot['plan'] }
    | { kind: 'form'; formId: string; plan: EditorSnapshot['plan'] }
    | null
  >(null);
  const session = useEditorSession();
  const stateKey = `${pageId}/${mode}/${mode === 'binding' ? node?.id : 'page'}`;
  const [creatingForm, setCreatingForm] = useSessionState(`${stateKey}/creatingForm`, false);
  const [formId, setFormId] = useSessionState(`${stateKey}/formId`, '');
  const [addingField, setAddingField] = useSessionState(`${stateKey}/addingField`, false);
  const [modelId, setModelId] = useSessionState(
    `${stateKey}/modelId`,
    node?.field?.formId ?? node?.formId ?? forms[0]?.id ?? '',
  );
  const model = forms.find((f) => f.id === modelId) ?? forms[0];
  const [editingId, setEditingId] = useSessionState(`${stateKey}/editingId`, '');
  const [fieldQuery, setFieldQuery] = useSessionState(`${stateKey}/fieldQuery`, '');
  const [modelFieldDismissed, setModelFieldDismissed] = useSessionState(
    `${stateKey}/modelFieldDismissed`,
    false,
  );
  const editing = model?.fields.find((f) => f.id === editingId);
  const normalizedFieldQuery = fieldQuery.trim().toLowerCase();
  const matchesFieldQuery = (field: FieldDefinition) =>
    `${field.id} ${field.label} ${field.path.join('.')}`
      .toLowerCase()
      .includes(normalizedFieldQuery);
  const matchedFields = model?.fields.filter(matchesFieldQuery) ?? [];
  const visibleFields = model?.fields.filter(
    (field) => field.id === editingId || matchesFieldQuery(field),
  );
  const editingFieldForcedVisible =
    !!editing && normalizedFieldQuery !== '' && !matchesFieldQuery(editing);
  const boundField =
    node?.field &&
    forms
      .find((f) => f.id === node.field!.formId)
      ?.fields.find((f) => f.id === node.field!.fieldId);
  const bindingModelId = boundField ? node?.field?.formId : ownerModel?.id;
  const bindingDraftKey =
    mode === 'binding' &&
    node &&
    contract?.field &&
    bindingModelId &&
    (boundField || compatibleTypes.length)
      ? boundField
        ? `field:${pageId}/${bindingModelId}/${boundField.id}`
        : `new-field:${pageId}/${bindingModelId}/${node.id}`
      : null;
  const fieldDialogOpen = bindingDraftKey !== null && fieldDialogKey === bindingDraftKey;
  useLayoutEffect(() => {
    setFieldDialogKey(null);
  }, [bindingDraftKey]);
  useEffect(() => {
    if (mode !== 'models' || session.dataTarget?.pageId !== pageId) return;
    const target = session.dataTarget;
    if (target.formId) setModelId(target.formId);
    setEditingId(target.fieldId ?? '');
    setAddingField(!!target.create);
  }, [session.dataTarget, mode, pageId]);
  const run = (action: () => unknown) => {
    if (!canAuthor()) return false;
    try {
      action();
      setError('');
      setMessage('配置已应用');
      return true;
    } catch (e) {
      setError(errorText(e));
      setMessage('');
      return false;
    }
  };
  const save = (action: () => unknown) => {
    if (!canAuthor()) return;
    action();
    setMessage('配置已应用');
    setError('');
  };
  const openFieldDialog = () => {
    if (canAuthor()) setFieldDialogKey(bindingDraftKey);
  };
  /** New-field creation is blocked when the node binding is incompatible with the managed form. */
  const newFieldBlocked =
    addingField &&
    !!node &&
    !!contract?.field &&
    (model.id !== ownerModel?.id || !compatibleTypes.length);
  // The field editor lives in a dialog. The session-driven editing state opens it
  // (direct openData calls included); closing or saving dismisses it until reopened.
  const modelDialogOpen =
    !modelFieldDismissed &&
    !!model &&
    ((!!editing && !addingField) || (addingField && !newFieldBlocked));
  const dialogField = editing;
  const closeModelFieldDialog = () => {
    setModelFieldDismissed(true);
    setAddingField(false);
  };
  const updateField = (formId: string, field: FieldDefinition) =>
    document.updateField(pageId, formId, field.id, {
      label: field.label,
      initial: field.initial,
      rules: field.rules,
      when: field.when,
      disabled: field.disabled,
    });
  return (
    <section className="form-panel" aria-label="表单与字段设置">
      {mode === 'binding' && node && contract?.form && (
        <div className="property-group">
          <h3>表单绑定</h3>
          <label>
            绑定表单
            <Select
              aria-label="绑定表单"
              value={node.formId ?? ''}
              onValueChange={(e) => run(() => document.bindForm(pageId, node.id, e || undefined))}
            >
              <option value="">未绑定</option>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.id}
                </option>
              ))}
            </Select>
          </label>
          <Button type="button" onClick={() => setCreatingForm(!creatingForm)}>
            创建表单模型
          </Button>
          {creatingForm && (
            <div className="model-create">
              <label>
                表单 ID
                <UiInput
                  aria-label="新表单 ID"
                  value={formId}
                  onChange={(e) => setFormId(e.target.value)}
                />
              </label>
              <p className="editor-note">一起创建首个字段；创建后绑定到当前容器。</p>
              <FieldEditor
                draftKey={`new-form:${pageId}/${node.id}`}
                initial={blankField('string')}
                page={page}
                creating
                submitLabel="创建并绑定表单"
                canSave={canAuthor}
                onSave={(field) => {
                  if (!canAuthor()) return;
                  if (!formId.trim() || formId !== formId.trim())
                    throw new Error('请填写有效的表单 ID');
                  save(() => document.createForm(pageId, node.id, { id: formId, fields: [field] }));
                  setModelId(formId);
                  setCreatingForm(false);
                }}
              />
            </div>
          )}
          <p className="editor-note">
            子组件只能绑定最近表单容器的模型。修改或解除模型前，请先解除受影响的字段绑定；业务提交动作沿用原有配置。
          </p>
        </div>
      )}
      {mode === 'binding' && node && contract?.field && (
        <div className="property-group">
          <h3>
            字段绑定 ·{' '}
            {fieldTypes(contract)
              .map((type) => typeNames[type])
              .join(' / ')}
          </h3>
          {(ownerModel || node.field) && (
            <label>
              绑定字段
              <Select
                aria-label="绑定字段"
                value={node.field ? JSON.stringify([node.field.formId, node.field.fieldId]) : ''}
                onValueChange={(e) =>
                  run(() => {
                    if (!e) document.bindField(pageId, node.id);
                    else {
                      const [formId, fieldId] = JSON.parse(e) as string[];
                      document.bindField(pageId, node.id, { formId, fieldId });
                    }
                  })
                }
              >
                <option value="">未绑定</option>
                {foreignBinding && (
                  <option value={JSON.stringify([node.field!.formId, node.field!.fieldId])}>
                    当前绑定：{node.field!.formId} / {boundField?.label ?? node.field!.fieldId}
                    （容器外）
                  </option>
                )}
                {(ownerModel ? [ownerModel] : []).map((f) => (
                  <optgroup label={f.id} key={f.id}>
                    {f.fields
                      .filter((field) =>
                        acceptsField(contract, field.type, literalProps, field.itemType, field),
                      )
                      .map((field) => (
                        <option key={field.id} value={JSON.stringify([f.id, field.id])}>
                          {f.id} / {field.label} ({field.id})
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </label>
          )}
          {ownerModel ? (
            <p className="editor-note">
              仅列出所属表单 {ownerModel.id}{' '}
              的兼容字段。绑定后标签、默认值和校验由字段管理；解除绑定使用模型初始值
              {contract.field?.valueProp === 'checked'
                ? '，保留 true / false'
                : contract.field?.changeEvent === 'onValueChange'
                  ? '，保留空值'
                  : '，空数字转为 0'}
              ，不复制预览输入。
            </p>
          ) : (
            <p className="editor-note">
              {owner
                ? '所属表单容器尚未绑定模型，请先配置该容器。'
                : '请先将输入组件放入表单容器，再绑定字段。'}
            </p>
          )}
          {ownerModel && !compatibleTypes.length && (
            <p className="editor-note">
              选项包含不同类型的实际值，暂时无法绑定字段；请先将选项统一为文本或数字。
            </p>
          )}
          {foreignBinding && (
            <p className="editor-note">
              当前绑定来自容器外，现有定义予以保留；请解除后重新绑定所属表单的字段。
            </p>
          )}
          {boundField ? (
            <div className="binding-summary">
              <strong>{boundField.label}</strong>
              <span>由表单字段 {boundField.id} 管理</span>
              <code>
                {node.field!.formId} / {boundField.id}
              </code>
              <span>{boundField.rules?.length ?? 0} 条校验规则</span>
              <Button
                ref={fieldTrigger}
                aria-haspopup="dialog"
                aria-expanded={fieldDialogOpen}
                onClick={openFieldDialog}
              >
                编辑字段设置
              </Button>
            </div>
          ) : ownerModel && compatibleTypes.length ? (
            <Button
              ref={fieldTrigger}
              aria-haspopup="dialog"
              aria-expanded={fieldDialogOpen}
              onClick={openFieldDialog}
            >
              ＋ 新建并绑定字段
            </Button>
          ) : null}
        </div>
      )}
      {mode === 'models' && (
        <div className="form-models">
          <h3>
            本页表单模型 <span>{forms.length}</span>
          </h3>
          {model ? (
            <>
              <label>
                管理表单
                <Select
                  aria-label="管理表单"
                  value={model.id}
                  onValueChange={(e) => {
                    session.openData({ pageId, formId: e });
                    setError('');
                  }}
                >
                  {forms.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.id}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="model-field-search">
                <span>字段列表</span>
                <UiInput
                  aria-label="搜索表单字段"
                  placeholder="搜索字段名称、ID 或路径"
                  value={fieldQuery}
                  onChange={(event) => setFieldQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape' || !fieldQuery) return;
                    event.preventDefault();
                    setFieldQuery('');
                  }}
                />
                <small>
                  {matchedFields.length}/{model.fields.length}
                </small>
                {editingFieldForcedVisible && <em>已保留当前编辑字段</em>}
              </label>
              <ul className="model-field-list">
                {visibleFields?.map((f) => (
                  <li key={f.id}>
                    <Button
                      type="button"
                      aria-current={editing?.id === f.id ? 'true' : undefined}
                      onClick={() => {
                        session.openData({ pageId, formId: model.id, fieldId: f.id });
                        setModelFieldDismissed(false);
                      }}
                      aria-label={`编辑字段 ${model.id}/${f.id}`}
                    >
                      {f.label}
                      <small>
                        {f.id} · {typeNames[f.type]} · {f.path.join('.') || '根级字段'}
                      </small>
                    </Button>
                    <Button
                      type="button"
                      aria-label={`删除字段 ${model.id}/${f.id}`}
                      onClick={() => {
                        setError('');
                        setDeleteTarget({
                          kind: 'field',
                          formId: model.id,
                          fieldId: f.id,
                          plan: snapshot.plan,
                        });
                      }}
                    >
                      删除
                    </Button>
                  </li>
                ))}
                {visibleFields?.length === 0 && (
                  <li className="model-field-empty">没有匹配的字段</li>
                )}
              </ul>
              {model.arrays?.length ? (
                <p className="editor-note">
                  另有 {model.arrays.length} 个动态字段组，保留原有配置。
                </p>
              ) : null}
              {addingField && newFieldBlocked && (
                <p className="editor-note">
                  {!compatibleTypes.length
                    ? '选项的实际值类型不一致，请先统一为文本或数字，再创建绑定字段。'
                    : ownerModel
                      ? `当前组件只能绑定所属表单 ${ownerModel.id}，请切换管理表单。`
                      : '当前组件不在已绑定模型的表单容器内，无法创建并绑定字段。'}
                </p>
              )}
              <div className="model-form-actions">
                <Button
                  type="button"
                  onClick={() => {
                    if (addingField) {
                      session.openData({ pageId, formId: model.id });
                    } else {
                      session.openData({ pageId, formId: model.id, create: true });
                      if (!newFieldBlocked) setModelFieldDismissed(false);
                    }
                    setEditingId('');
                  }}
                >
                  ＋ 新建字段
                </Button>
                <Button
                  type="button"
                  className="model-delete"
                  onClick={() => {
                    setError('');
                    setDeleteTarget({ kind: 'form', formId: model.id, plan: snapshot.plan });
                  }}
                >
                  删除表单模型
                </Button>
              </div>
              <p className="editor-note">
                删除前检查组件、表达式和代码物料引用；整表、动态或计算函数依赖会保守阻止字段删除。
              </p>
            </>
          ) : (
            <p className="editor-note">本页暂无表单模型。</p>
          )}
        </div>
      )}
      {error && (
        <p className="property-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="editor-note" role="status">
          {message}
        </p>
      )}
      {bindingDraftKey && (
        <Dialog.Root
          open={fieldDialogOpen}
          onOpenChange={(open) => {
            if (!open) setFieldDialogKey(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop className="material-modal-backdrop" />
            <Dialog.Popup
              className="material-modal field-settings-dialog"
              finalFocus={fieldTrigger}
            >
              <header>
                <div>
                  <Dialog.Title>{boundField ? '字段设置' : '新建并绑定字段'}</Dialog.Title>
                  <Dialog.Description>
                    {boundField
                      ? `${bindingModelId} / ${boundField.id}`
                      : `所属表单 · ${bindingModelId}`}
                  </Dialog.Description>
                </div>
                <Dialog.Close className="ui-button" aria-label="关闭字段设置">
                  关闭
                </Dialog.Close>
              </header>
              {fieldDialogOpen && node && bindingModelId && (
                <div className="material-modal-body form-panel">
                  <FieldEditor
                    key={bindingDraftKey}
                    draftKey={bindingDraftKey}
                    initial={
                      boundField ?? {
                        ...blankField(compatibleTypes[0] ?? 'string', compatibleItemTypes[0]),
                        ...contract?.field?.defaults?.(literalProps),
                      }
                    }
                    page={page}
                    conditionFormId={bindingModelId}
                    creating={!boundField}
                    allowedItemTypes={compatibleItemTypes}
                    fixedType={compatibleTypes.length === 1 ? compatibleTypes[0] : undefined}
                    allowedTypes={compatibleTypes}
                    submitLabel={boundField ? '保存字段设置' : '创建并绑定字段'}
                    inDialog
                    canSave={canAuthor}
                    onSave={(field) => {
                      save(() => {
                        if (boundField) updateField(bindingModelId, field);
                        else document.createField(pageId, bindingModelId, field, node.id);
                      });
                      setFieldDialogKey(null);
                    }}
                  />
                </div>
              )}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {modelDialogOpen && (
        <Dialog.Root
          open={modelDialogOpen}
          onOpenChange={(open) => {
            if (!open) closeModelFieldDialog();
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop className="material-modal-backdrop" />
            <Dialog.Popup className="material-modal field-settings-dialog">
              <header>
                <div>
                  <Dialog.Title>{dialogField ? '字段设置' : '新建字段'}</Dialog.Title>
                  <Dialog.Description>
                    {dialogField ? `${model.id} / ${dialogField.id}` : `所属表单 · ${model.id}`}
                  </Dialog.Description>
                </div>
                <Dialog.Close className="ui-button" aria-label="关闭字段设置">
                  关闭
                </Dialog.Close>
              </header>
              <div className="material-modal-body form-panel">
                {dialogField ? (
                  <FieldEditor
                    key={`${model.id}/${dialogField.id}`}
                    draftKey={`field:${pageId}/${model.id}/${dialogField.id}`}
                    initial={dialogField}
                    page={page}
                    conditionFormId={model.id}
                    submitLabel="保存字段设置"
                    inDialog
                    canSave={canAuthor}
                    onSave={(field) => {
                      save(() => updateField(model.id, field));
                      closeModelFieldDialog();
                    }}
                  />
                ) : (
                  <FieldEditor
                    key={`${model.id}/new`}
                    draftKey={`new-field:${pageId}/${model.id}/${node?.id ?? 'model'}`}
                    initial={{
                      ...blankField(
                        compatibleTypes[0] ?? 'string',
                        compatibleItemTypes[0] ?? 'string',
                      ),
                      ...contract?.field?.defaults?.(literalProps),
                    }}
                    page={page}
                    conditionFormId={model.id}
                    allowedItemTypes={contract?.field ? compatibleItemTypes : undefined}
                    fixedType={compatibleTypes.length === 1 ? compatibleTypes[0] : undefined}
                    allowedTypes={contract?.field ? compatibleTypes : undefined}
                    creating
                    submitLabel={node && contract?.field ? '创建并绑定字段' : '创建字段'}
                    inDialog
                    canSave={canAuthor}
                    onSave={(field) => {
                      if (!canAuthor()) return;
                      save(() =>
                        document.createField(
                          pageId,
                          model.id,
                          field,
                          contract?.field ? node!.id : undefined,
                        ),
                      );
                      closeModelFieldDialog();
                    }}
                  />
                )}
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setError('');
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal project-confirmation form-delete-dialog">
            <Dialog.Title className="project-confirmation-title">
              {deleteTarget?.kind === 'field' ? '删除表单字段？' : '删除表单模型？'}
            </Dialog.Title>
            <Dialog.Description className="project-confirmation-description">
              {deleteTarget?.kind === 'field'
                ? `将删除字段“${deleteTarget.fieldId}”。如果组件、表达式或动作仍引用它，操作会被阻止。`
                : `将删除表单“${deleteTarget?.formId}”。如果仍有字段绑定或页面定义引用它，操作会被阻止。`}
            </Dialog.Description>
            {error && (
              <p role="alert" className="property-error">
                {error}
              </p>
            )}
            <div className="project-confirmation-actions">
              <Dialog.Close className="ui-button">取消</Dialog.Close>
              <Button
                variant="danger"
                onClick={() => {
                  const target = deleteTarget;
                  if (!target) return;
                  const latest = document.getSnapshot();
                  const currentForm = latest.plan.pages
                    .get(pageId)
                    ?.schema.forms?.find((candidate) => candidate.id === target.formId);
                  if (
                    !canAuthor() ||
                    target.plan !== latest.plan ||
                    !currentForm ||
                    (target.kind === 'field' &&
                      !currentForm.fields.some((field) => field.id === target.fieldId))
                  ) {
                    setDeleteTarget(null);
                    setError('页面或表单定义已变化，请重新选择后操作。');
                    return;
                  }
                  const removed = run(() =>
                    target.kind === 'field'
                      ? document.removeField(pageId, target.formId, target.fieldId)
                      : document.removeForm(pageId, target.formId),
                  );
                  if (removed) setDeleteTarget(null);
                }}
              >
                确认删除
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
