import { extendedMaterials, extendedContracts } from './materials/index';
import { textStyle, withMaterialStyles } from './materials/style';
import { feedbackActions } from './materials/feedback';
import { demoTransports } from './data-transports';
import { httpRequestTransport } from '../packages/runtime/http-transport';
import { Button, Input as UiInput, Tip } from './ui/primitives';
import {
  useEffect,
  useId,
  useState,
  type ChangeEventHandler,
  type InputHTMLAttributes,
  type MouseEventHandler,
} from 'react';
import { createRegistry } from '../packages/runtime/registry';
import {
  useForm,
  useField,
  useFieldArray,
  useRuntime,
  type ReactMaterials,
  materialStyleTarget,
  type SlotRenderers,
} from '../packages/react-runtime/Renderer';
import { lineTotal, purchaseTotal } from './purchase';
import { FormSubmissionError } from '../packages/runtime/form';
import { SelectMaterial } from './SelectMaterial';
import { validateSelectProps } from './select-options';
import { CheckboxMaterial, SwitchMaterial } from './BooleanMaterial';
function Text({
  value,
  tone = 'default',
  ellipsis,
  style,
  onClick,
}: {
  value: unknown;
  tone?: string;
  ellipsis?: boolean;
  style?: React.CSSProperties;
  onClick?: MouseEventHandler<HTMLParagraphElement>;
}) {
  return (
    <p
      className={`material-text ${tone}${ellipsis ? ' ellipsis' : ''}`}
      style={style}
      onClick={onClick}
      {...materialStyleTarget(style)}
    >
      {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
    </p>
  );
}
function Input({
  label,
  hint,
  error,
  multiline = false,
  rows = 4,
  type = 'text',
  clearable = false,
  showCount = false,
  autoSize = false,
  style,
  ...props
}: {
  label: string;
  hint?: string;
  error?: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  multiline?: boolean;
  rows?: number;
  clearable?: boolean;
  showCount?: boolean;
  autoSize?: boolean;
  onChange?: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  const text = props.value === undefined || props.value === null ? '' : String(props.value);
  const lineCount = Number.isFinite(rows) ? Math.max(1, Math.min(20, Math.floor(rows))) : 4;
  const autoRows = autoSize
    ? Math.max(1, Math.min(20, text ? text.split('\n').length : 1))
    : undefined;
  const canClear = clearable && !props.disabled && !props.readOnly && !!props.onChange && !!text;
  return (
    <div className="material-field" style={style} {...materialStyleTarget(style)}>
      <label htmlFor={id} style={textStyle(style)}>
        {label}
        {props.required && <b aria-hidden="true"> *</b>}
      </label>
      <UiInput
        {...props}
        style={textStyle(style)}
        type={multiline ? undefined : type}
        render={multiline ? <textarea rows={autoRows ?? lineCount} /> : undefined}
        readOnly={props.readOnly ?? !props.onChange}
        minLength={props.minLength}
        maxLength={props.maxLength}
        id={id}
        aria-invalid={!!error}
        aria-describedby={
          [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') ||
          undefined
        }
      />
      {canClear && (
        <Tip content="清空输入">
          <Button
            className="material-input-clear"
            variant="ghost"
            aria-label={`清空${label}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onChange?.({ target: { value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>);
            }}
          >
            ×
          </Button>
        </Tip>
      )}
      {showCount && (
        <small className="field-count" aria-hidden="true">
          {text.length}
          {props.maxLength !== undefined ? `/${props.maxLength}` : ''}
        </small>
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small className="field-error" id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
function NumberInput({
  step = 'any',
  precision,
  unit,
  ...props
}: Omit<Parameters<typeof Input>[0], 'multiline' | 'rows'> & {
  step?: string | number;
  precision?: number;
  unit?: string;
}) {
  const input = (
    <Input
      {...props}
      multiline={false}
      type="number"
      step={precision !== undefined && Number.isFinite(precision) && precision > 0 ? 1 / 10 ** Math.floor(precision) : step}
    />
  );
  if (!unit) return input;
  return (
    <span className="material-number">
      {input}
      <span className="material-number-unit">{unit}</span>
    </span>
  );
}
function MaterialButton({
  label,
  variant = 'primary',
  type = 'button',
  block,
  onClick,
  disabled,
  style,
}: {
  label: string;
  variant?: string;
  type?: 'button' | 'submit' | 'reset';
  block?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <Button
      className={`material-button ${variant}${block ? ' block' : ''}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={style}
      {...materialStyleTarget(style)}
    >
      {label}
    </Button>
  );
}
// Normal React hook usage; no separate state or event DSL for code extensions.
function FormStatus({ formId, onClick }: { formId: string; onClick?: MouseEventHandler<HTMLDivElement> }) {
  const form = useForm(formId);
  const dirtyCount = [
    ...Object.values(form.fields),
    ...Object.values(form.arrays).flatMap((array) =>
      array.rows.flatMap((row) => Object.values(row.fields)),
    ),
  ].filter((field) => field.dirty).length;
  const arrayDirty = Object.values(form.arrays).some((array) => array.dirty);
  return (
    <div className="form-status" aria-live="polite" onClick={onClick}>
      {form.formErrors.map((message) => (
        <p className="field-error" role="alert" key={message}>
          {message}
        </p>
      ))}
      {form.submitError && (
        <p role="alert" className="field-error">
          {form.submitError}
        </p>
      )}
      <small>
        {form.isSubmitting
          ? '正在提交，请稍候…'
          : form.isSubmitSuccessful
            ? '提交成功，可继续修改或重置。'
            : `已修改 ${dirtyCount} 个字段${arrayDirty ? ' · 明细已调整' : ''} · 已尝试提交 ${form.submitCount} 次`}
      </small>
    </div>
  );
}
function ArrayCell({
  formId,
  arrayId,
  rowId,
  fieldId,
}: {
  formId: string;
  arrayId: string;
  rowId: string;
  fieldId: string;
}) {
  const field = useField(formId, { arrayId, rowId, fieldId });
  const definition = useRuntime().getForm(formId).getFieldDefinition({ arrayId, rowId, fieldId });
  if (!field.visible) return null;
  return (
    <Input
      {...field.input}
      label={field.label}
      error={field.error}
      type={
        definition.type === 'number'
          ? 'number'
          : definition.type === 'boolean'
            ? 'checkbox'
            : 'text'
      }
      step={definition.type === 'number' ? 'any' : undefined}
    />
  );
}
function PurchaseItems({
  formId,
  arrayId,
  onClick,
}: {
  formId: string;
  arrayId: string;
  onClick?: MouseEventHandler<HTMLElement>;
}) {
  const array = useFieldArray(formId, arrayId);
  const definition = useRuntime().getForm(formId).getArrayDefinition(arrayId);
  if (!array.visible) return null;
  return (
    <section className="purchase-items" aria-label={array.label} onClick={onClick}>
      <header className="items-heading">
        <div>
          <h3>{array.label}</h3>
          <small>{array.fields.length} 条明细 · 新增、排序和删除后自动重新计算</small>
        </div>
        <Button
          className="item-action add"
          type="button"
          disabled={
            array.disabled ||
            (array.maxItems !== undefined && array.fields.length >= array.maxItems)
          }
          onClick={() => array.append()}
        >
          ＋ 新增明细
        </Button>
      </header>
      {array.error && (
        <p className="field-error" role="alert">
          {array.error}
        </p>
      )}
      {array.fields.length === 0 && <p className="items-empty">还没有采购明细，请新增一行。</p>}
      {array.fields.map((row, index) => (
        <fieldset className="purchase-item" key={row.id} data-row-id={row.id}>
          <legend>采购明细第 {index + 1} 行</legend>
          <div className="item-fields">
            {definition.fields.map((field) => (
              <ArrayCell
                key={field.id}
                formId={formId}
                arrayId={arrayId}
                rowId={row.id}
                fieldId={field.id}
              />
            ))}
          </div>
          <div className="item-footer">
            <span>
              小计 <strong>¥{lineTotal(row.values)}</strong>
            </span>
            <div className="item-actions">
              <Button
                className="item-action"
                type="button"
                disabled={array.disabled || index === 0}
                onClick={() => array.move(row.id, index - 1)}
              >
                上移
              </Button>
              <Button
                className="item-action"
                type="button"
                disabled={array.disabled || index === array.fields.length - 1}
                onClick={() => array.move(row.id, index + 1)}
              >
                下移
              </Button>
              <Button
                className="item-action remove"
                type="button"
                disabled={array.disabled}
                onClick={() => array.remove(row.id)}
              >
                删除
              </Button>
            </div>
          </div>
        </fieldset>
      ))}
    </section>
  );
}
function Summary({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div className="material-summary" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Badge({
  value,
  tone = 'green',
  style,
  onClick,
}: {
  value: string;
  tone?: string;
  style?: React.CSSProperties;
  onClick?: MouseEventHandler<HTMLSpanElement>;
}) {
  return (
    <span
      className={`material-badge ${tone}`}
      style={style}
      onClick={onClick}
      {...materialStyleTarget(style)}
    >
      {value}
    </span>
  );
}
function RecordRow({
  record,
  onClick,
}: {
  record: Record<string, string | number>;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  return (
    <article className="material-record">
      <div className="record-avatar">{String(record.name).slice(0, 1)}</div>
      <div>
        <strong>{record.name}</strong>
        <span>
          {record.department} · {record.role}
        </span>
      </div>
      <span className="record-status">在职</span>
      <Button onClick={onClick} type="button">
        查看资料
      </Button>
    </article>
  );
}
function Empty({
  title,
  description = '暂无匹配的内容',
  style,
  onClick,
}: {
  title: string;
  description?: string;
  style?: React.CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className="material-empty"
      style={style}
      onClick={onClick}
      {...materialStyleTarget(style)}
    >
      <span aria-hidden="true">⌕</span>
      <strong style={textStyle(style)}>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
function RecordCard({
  record,
  slots,
  onClick,
}: {
  record: Record<string, unknown>;
  slots: SlotRenderers;
  onClick?: MouseEventHandler<HTMLElement>;
}) {
  return (
    <article className="material-card" onClick={onClick}>
      <header>{slots.header?.({ record })}</header>
      <section>{slots.body?.({ record })}</section>
      <footer>{slots.footer?.({ record })}</footer>
    </article>
  );
}
// A code extension is an ordinary React component: normal JSX, hooks and events.
export function NativeReactCounter({
  label,
  onClick,
}: {
  label: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const [count, setCount] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => {
      /* unsubscribe resources here */
    };
  }, []);
  return (
    <div className="native-counter" onClick={onClick}>
      <div>
        <span className="eyebrow">REACT COMPONENT</span>
        <strong>{label}</strong>
        <small>{mounted ? '组件已挂载，局部状态由 React 管理' : '正在挂载'}</small>
      </div>
      <Button onClick={() => setCount((value) => value + 1)} type="button">
        本地计数 <b>{count}</b>
        <span>＋</span>
      </Button>
    </div>
  );
}
export const materials: ReactMaterials = {
  'ui.text': Text,
  'ui.input': Input,
  'ui.select': SelectMaterial,
  'ui.checkbox': CheckboxMaterial,
  'ui.switch': SwitchMaterial,
  'ui.number': NumberInput,
  'ui.button': MaterialButton,
  'ui.formStatus': FormStatus,
  'react.purchaseItems': PurchaseItems,
  'ui.summary': Summary,
  'ui.badge': Badge,
  'ui.record': RecordRow,
  'ui.empty': Empty,
  'ui.recordCard': RecordCard,
  'react.counter': NativeReactCounter,
  ...extendedMaterials,
};
const string = { type: 'string' as const };
const number = { type: 'number' as const };
const requiredString = { ...string, required: true };
const booleanContract = {
  version: '1.0.0',
  field: { type: 'boolean', valueProp: 'checked', changeEvent: 'onCheckedChange' },
  props: {
    label: requiredString,
    checked: { type: 'boolean', required: true },
    hint: string,
    disabled: { type: 'boolean' },
    readOnly: { type: 'boolean' },
    required: { type: 'boolean' },
  },
  events: ['onCheckedChange', 'onBlur', 'onClick'],
} satisfies import('../packages/runtime/registry').ComponentContract;
const people = [
  { id: 'u1', name: '陈嘉宁', department: '产品设计部', role: '产品设计师' },
  { id: 'u2', name: '林知远', department: '研发中心', role: '前端工程师' },
  { id: 'u3', name: '许清和', department: '产品设计部', role: '产品经理' },
  { id: 'u4', name: '周予安', department: '运营中心', role: '运营专员' },
];
async function delay(signal: AbortSignal, ms = 280) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
export const registry = createRegistry(
  withMaterialStyles({
    'ui.layout': { version: '1.0.0', props: { variant: string }, children: true },
    'ui.text': {
      version: '1.0.0',
      props: {
        value: { type: 'json', required: true },
        tone: string,
        ellipsis: { type: 'boolean' },
      },
      events: ['onClick'],
    },
    'ui.input': {
      version: '1.0.0',
      field: { type: 'string', valueProp: 'value' },
      props: {
        label: requiredString,
        value: requiredString,
        type: string,
        hint: string,
        placeholder: string,
        multiline: { type: 'boolean' },
        rows: number,
        clearable: { type: 'boolean' },
        showCount: { type: 'boolean' },
        autoSize: { type: 'boolean' },
        minLength: number,
        maxLength: number,
        disabled: { type: 'boolean' },
        readOnly: { type: 'boolean' },
        required: { type: 'boolean' },
      },
      events: ['onChange', 'onBlur', 'onClick'],
      validateProps: (props) => {
        const errors: string[] = [];
        const allowedTypes = ['text', 'email', 'url', 'password', 'search', 'tel'];
        if (props.type !== undefined && !allowedTypes.includes(String(props.type)))
          errors.push('type 的值无效');
        if (props.multiline === true && props.type !== undefined && props.type !== 'text')
          errors.push('多行输入的 type 必须为 text');
        for (const key of ['minLength', 'maxLength']) {
          if (props[key] !== undefined && (!Number.isInteger(props[key]) || Number(props[key]) < 0))
            errors.push(`${key} 必须为非负整数`);
        }
        if (props.rows !== undefined && (!Number.isInteger(props.rows) || Number(props.rows) < 1))
          errors.push('rows 必须为正整数');
        if (
          typeof props.minLength === 'number' &&
          typeof props.maxLength === 'number' &&
          props.minLength > props.maxLength
        )
          errors.push('minLength 不能大于 maxLength');
        return errors;
      },
    },
    'ui.select': {
      version: '1.0.0',
      field: {
        type: ['string', 'number', 'array'],
        valueProp: 'value',
        changeEvent: 'onValueChange',
      },
      props: {
        label: requiredString,
        value: { type: 'json', required: true },
        options: { type: 'array', required: true },
        placeholder: string,
        hint: string,
        clearable: { type: 'boolean' },
        multiple: { type: 'boolean' },
        disabled: { type: 'boolean' },
        readOnly: { type: 'boolean' },
        required: { type: 'boolean' },
      },
      events: ['onValueChange', 'onBlur', 'onClick'],
      validateProps: validateSelectProps,
    },
    'ui.number': {
      version: '1.0.0',
      field: { type: 'number', valueProp: 'value' },
      props: {
        label: requiredString,
        value: { ...number, required: true },
        min: number,
        max: number,
        step: { type: 'json' },
        precision: number,
        unit: string,
        placeholder: string,
        hint: string,
        disabled: { type: 'boolean' },
        readOnly: { type: 'boolean' },
        required: { type: 'boolean' },
      },
      events: ['onChange', 'onBlur', 'onClick'],
      validateProps: (props) => {
        const errors: string[] = [];
        if (typeof props.min === 'number' && typeof props.max === 'number' && props.min > props.max)
          errors.push('min 不能大于 max');
        if (
          props.step !== undefined &&
          typeof props.step !== 'number' &&
          !(typeof props.step === 'string' && props.step === 'any')
        )
          errors.push('step 必须为数字或 any');
        if (typeof props.step === 'number' && props.step <= 0) errors.push('step 必须大于 0');
        if (
          props.precision !== undefined &&
          (typeof props.precision !== 'number' ||
            !Number.isInteger(props.precision) ||
            props.precision < 0 ||
            props.precision > 8)
        )
          errors.push('precision 必须为 0 到 8 的整数');
        return errors;
      },
    },
    'ui.checkbox': booleanContract,
    'ui.switch': booleanContract,
    'ui.button': {
      version: '1.0.0',
      props: {
        label: requiredString,
        variant: string,
        type: string,
        block: { type: 'boolean' },
        disabled: { type: 'boolean' },
      },
      events: ['onClick'],
    },
    'ui.form': {
      version: '1.0.0',
      props: {},
      children: true,
      form: true,
      events: ['onSubmit', 'onReset', 'onClick'],
    },
    'ui.formStatus': { version: '1.0.0', props: { formId: requiredString }, events: ['onClick'] },
    'react.purchaseItems': {
      version: '1.0.0',
      props: { formId: requiredString, arrayId: requiredString },
      events: ['onClick'],
    },
    'ui.summary': {
      version: '1.0.0',
      props: { label: requiredString, value: requiredString },
      events: ['onClick'],
    },
    'ui.badge': {
      version: '1.0.0',
      props: { value: requiredString, tone: string },
      events: ['onClick'],
    },
    'ui.record': {
      version: '1.0.0',
      props: { record: { type: 'object', required: true } },
      events: ['onClick'],
    },
    'ui.empty': {
      version: '1.0.0',
      props: { title: requiredString, description: string },
      events: ['onClick'],
    },
    'ui.recordCard': {
      version: '1.0.0',
      props: { record: { type: 'object', required: true } },
      events: ['onClick'],
      slots: { header: ['record'], body: ['record'], footer: ['record'] },
    },
    'react.counter': {
      version: '1.0.0',
      props: { label: requiredString },
      events: ['onClick'],
    },
    ...extendedContracts,
  }),
  {
    ...feedbackActions,
    'demo.savePurchaseOnce': {
      version: '1.0.0',
      input: {},
      output: 'object',
      async execute(_input, context) {
        if (context.getState().saveCommitted === true)
          throw new Error('申请已保存，请仅重试刷新列表');
        return context.executeDataSource('savePurchase');
      },
    },
    'demo.saveRecordOnce': {
      version: '1.0.0',
      input: {},
      output: 'object',
      async execute(_input, context) {
        if (context.getState().saveCommitted === true)
          throw new Error('保存已完成，请仅重试刷新列表');
        return context.executeDataSource('saveRecord');
      },
    },
    'demo.saveRecord': {
      version: '1.0.0',
      input: {
        rows: { type: 'array', required: true },
        id: { type: 'string', required: true },
        values: { type: 'object', required: true },
      },
      output: 'array',
      async execute({ rows, id, values }, { signal }) {
        const input = values as Record<string, unknown>;
        if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('请填写名称');
        if (typeof input.department !== 'string') throw new Error('部门格式错误');
        const name = input.name.trim(),
          department = input.department;
        const records = rows as Record<string, unknown>[];
        if (!records.some((row) => row && row.id === id)) throw new Error('记录不存在，请重新选择');
        await delay(signal);
        if (input.name.includes('失败'))
          throw new FormSubmissionError('模拟保存失败，请修改名称后重试。', {
            name: '名称不能包含“失败”',
          });
        return records.map((row) => (row.id === id ? { ...row, name, department } : row));
      },
    },
    'demo.submitPurchase': {
      version: '1.0.0',
      input: { values: { type: 'object', required: true } },
      output: 'string',
      async execute({ values }, { signal }) {
        const input = values as Record<string, unknown>;
        if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('请填写申请名称');
        if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 20)
          throw new Error('采购明细需为 1–20 行');
        for (const item of input.items) {
          if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80)
            throw new Error('请填写有效的物品名称');
          if (
            !Number.isInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > 999 ||
            typeof item.price !== 'number' ||
            !Number.isFinite(item.price) ||
            item.price < 0.01 ||
            Math.abs(item.price * 100 - Math.round(item.price * 100)) >= 0.000001
          )
            throw new Error('数量需为 1–999 的整数，单价需为正数且最多两位小数');
        }
        const total = purchaseTotal(input);
        if (!Number.isFinite(total) || total > 50000)
          throw new Error('单笔采购金额不能超过 50,000 元');
        if (
          total > 10000 &&
          (typeof input.approvalReason !== 'string' || !input.approvalReason.trim())
        )
          throw new Error('请填写审批说明');
        await delay(signal);
        if (String(input.name).includes('失败'))
          throw new FormSubmissionError('模拟服务拒绝了申请，请修改名称后重试。', {
            name: '名称含有“失败”，请修改后重试',
          });
        return `已提交「${String(input.name).trim()}」，合计 ¥${Math.round(total * 100) / 100}（本地模拟）`;
      },
    },
    'demo.searchPeople': {
      version: '1.0.0',
      input: { query: requiredString },
      output: 'array',
      async execute({ query }, { signal }) {
        await delay(signal);
        return people.filter((person) =>
          `${person.name}${person.department}`.includes(String(query).trim()),
        );
      },
    },
  },
  { 'purchase.total': { version: '1.0.0', compute: purchaseTotal } },
  { 'http.request': httpRequestTransport, ...demoTransports },
);
