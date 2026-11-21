import { useMemo, useEffect, useRef, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useRuntime } from '../../packages/react-runtime/Renderer';
import { FormRuntime } from '../../packages/runtime/form';
import { validateApplication } from '../../packages/schema/validate';
import { createRegistry } from '../../packages/runtime/registry';
import type { FieldDefinition, FieldTarget, Json } from '../../packages/schema/types';
import { Input, Button, Tip } from '../ui/primitives';
import { SelectMaterial } from '../SelectMaterial';
import { CheckboxMaterial } from '../BooleanMaterial';
import { DateMaterial } from './temporal';
import {
  FieldFrame,
  arrayProp,
  boolProp,
  textProp,
  numberProp,
  record,
  type Contracts,
} from './shared';
import { validateSelectProps, type SelectOption } from '../select-options';

const emptyRegistry = createRegistry({}, {});
export function arrayDefinitionErrors(definition: unknown) {
  return validateApplication(
    {
      schemaVersion: '0.1.0',
      id: 'array-check',
      title: '明细配置',
      entryPageId: 'page',
      dependencies: { components: {}, actions: {} },
      pages: [
        {
          id: 'page',
          title: '明细配置',
          state: [],
          forms: [{ id: 'model', fields: [], arrays: [definition] }],
          children: [],
        },
      ],
    },
    emptyRegistry,
  ).map((issue) => `${issue.path} ${issue.message}`);
}
type ArrayProps = {
  style?: React.CSSProperties;
  label?: string;
  fields?: FieldDefinition[];
  value?: Record<string, Json>[];
  onValueChange?: (value: Record<string, Json>[]) => void;
  minItems?: number;
  maxItems?: number;
  disabled?: boolean;
  formId?: string;
  arrayId?: string;
  options?: Record<string, SelectOption[]>;
};
function ArrayCell({
  store,
  field,
  target,
  options,
  commit,
}: {
  store: FormRuntime;
  field: FieldDefinition;
  target: FieldTarget;
  options?: SelectOption[];
  commit: (action: () => void) => void;
}) {
  const state = store.getFieldState(target)!;
  if (!state.visible) return null;
  const shared = {
    label: field.label,
    name: store.getFieldName(target),
    disabled: state.disabled,
    error: state.error,
    required: field.rules?.some(
      (r) => r.kind === (field.type === 'boolean' ? 'mustBeTrue' : 'required'),
    ),
    onBlur: () => store.blur(target),
  };
  const change = (value: unknown) => commit(() => store.setValue(target, value));
  if (field.format)
    return (
      <DateMaterial
        {...shared}
        mode={field.format}
        range={field.range}
        value={state.value as string | string[]}
        onValueChange={change}
      />
    );
  if (field.type === 'boolean')
    return (
      <CheckboxMaterial {...shared} checked={state.value as boolean} onCheckedChange={change} />
    );
  if (options || field.type === 'array')
    return (
      <SelectMaterial
        {...shared}
        multiple={field.type === 'array'}
        options={options ?? []}
        value={state.value as string | number | null | (string | number)[]}
        onValueChange={change}
      />
    );
  return (
    <FieldFrame {...shared}>
      {(a11y) => (
        <Input
          {...a11y}
          name={shared.name}
          type={field.type === 'number' ? 'number' : 'text'}
          value={state.value === null ? '' : String(state.value)}
          disabled={shared.disabled}
          required={shared.required}
          step="any"
          onChange={(event) =>
            change(
              field.type === 'number'
                ? event.target.value === ''
                  ? null
                  : event.target.valueAsNumber
                : event.target.value,
            )
          }
        />
      )}
    </FieldFrame>
  );
}
function ArrayView({
  store,
  arrayId,
  options = {},
  onChange,
  style,
}: {
  style?: React.CSSProperties;
  store: FormRuntime;
  arrayId: string;
  options?: Record<string, SelectOption[]>;
  onChange?: (value: Record<string, Json>[]) => void;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot),
    array = snapshot.arrays[arrayId],
    definition = store.getArrayDefinition(arrayId);
  const commit = (action: () => void) => {
    action();
    onChange?.(structuredClone(store.getSnapshot().values[arrayId]) as Record<string, Json>[]);
  };
  if (!array.visible) return null;
  return (
    <section className="material-field-array" style={style} aria-label={definition.label}>
      <header>
        <strong>{definition.label}</strong>
        <Button
          disabled={
            array.disabled ||
            (definition.maxItems !== undefined && array.rows.length >= definition.maxItems)
          }
          onClick={() =>
            commit(() => {
              store.append(arrayId);
            })
          }
        >
          <Plus size={13} />
          新增一行
        </Button>
      </header>
      {array.error && (
        <p className="field-error" role="alert">
          {array.error}
        </p>
      )}
      {!array.rows.length && (
        <p className="material-placeholder">暂无明细，点击“新增一行”开始填写。</p>
      )}
      {array.rows.map((row, index) => (
        <fieldset key={row.id} className="material-array-row" data-row-id={row.id}>
          <legend>第 {index + 1} 行</legend>
          <div className="material-array-fields">
            {definition.fields.map((field) => (
              <ArrayCell
                key={field.id}
                field={field}
                store={store}
                target={{ arrayId, rowId: row.id, fieldId: field.id }}
                options={options[field.id]}
                commit={commit}
              />
            ))}
          </div>
          <div className="material-array-actions">
            <Tip content="上移这一行">
              <Button
                aria-label={`上移第 ${index + 1} 行`}
                disabled={array.disabled || index === 0}
                onClick={() => commit(() => store.move(arrayId, row.id, index - 1))}
              >
                <ArrowUp size={13} />
              </Button>
            </Tip>
            <Tip content="下移这一行">
              <Button
                aria-label={`下移第 ${index + 1} 行`}
                disabled={array.disabled || index === array.rows.length - 1}
                onClick={() => commit(() => store.move(arrayId, row.id, index + 1))}
              >
                <ArrowDown size={13} />
              </Button>
            </Tip>
            <Tip content="删除这一行">
              <Button
                aria-label={`删除第 ${index + 1} 行`}
                disabled={array.disabled || array.rows.length <= (definition.minItems ?? 0)}
                onClick={() => commit(() => store.remove(arrayId, row.id))}
              >
                <Trash2 size={13} />
              </Button>
            </Tip>
          </div>
        </fieldset>
      ))}
    </section>
  );
}
function BoundArray({
  formId,
  arrayId,
  options,
  style,
}: {
  formId: string;
  style?: React.CSSProperties;
  arrayId: string;
  options?: Record<string, SelectOption[]>;
}) {
  return (
    <ArrayView
      store={useRuntime().getForm(formId)}
      arrayId={arrayId}
      options={options}
      style={style}
    />
  );
}
function IndependentArray({
  label = '动态明细',
  fields = [],
  value = [],
  minItems,
  maxItems,
  disabled,
  onValueChange,
  options,
  style,
}: ArrayProps) {
  const source = JSON.stringify({ label, fields, value, minItems, maxItems, disabled });
  const previous = useRef<{ config: string; store: FormRuntime } | null>(null);
  const store = useMemo(() => {
    const config = JSON.parse(source) as ArrayProps;
    const configKey = JSON.stringify({ ...config, value: undefined });
    if (
      previous.current?.config === configKey &&
      JSON.stringify(previous.current.store.getSnapshot().values.rows) ===
        JSON.stringify(config.value)
    )
      return previous.current.store;
    const next = new FormRuntime({
      id: 'local',
      fields: [],
      arrays: [
        {
          id: 'rows',
          path: ['rows'],
          label: config.label!,
          fields: config.fields!,
          initial: config.value!,
          minItems: config.minItems,
          maxItems: config.maxItems,
          ...(config.disabled ? { disabled: { kind: 'literal', value: true } } : {}),
        },
      ],
    });
    previous.current = { config: configKey, store: next };
    return next;
  }, [source]);
  const active = useRef<FormRuntime | null>(null);
  useEffect(() => {
    active.current = store;
    return () => {
      active.current = null;
      // StrictMode replays effects synchronously; release only after a real detach/replacement.
      queueMicrotask(() => {
        if (active.current !== store) store.dispose();
      });
    };
  }, [store]);
  return (
    <ArrayView
      store={store}
      arrayId="rows"
      options={options}
      onChange={onValueChange}
      style={style}
    />
  );
}
export function FieldArrayMaterial(props: ArrayProps) {
  return props.formId && props.arrayId ? (
    <BoundArray
      formId={props.formId}
      arrayId={props.arrayId}
      options={props.options}
      style={props.style}
    />
  ) : (
    <IndependentArray {...props} />
  );
}
export const fieldArrayContracts: Contracts = {
  'ui.fieldArray': {
    version: '1.0.0',
    fieldArray: true,
    props: {
      label: textProp,
      fields: arrayProp,
      value: arrayProp,
      minItems: numberProp,
      maxItems: numberProp,
      disabled: boolProp,
      formId: textProp,
      arrayId: textProp,
      options: { type: 'object' },
    },
    events: ['onValueChange'],
    validateProps: (props, context) => {
      const errors: string[] = [];
      if (!!props.formId !== !!props.arrayId) errors.push('明细绑定需同时指定 formId 和 arrayId');
      if (!props.formId && 'fields' in props)
        errors.push(
          ...arrayDefinitionErrors({
            id: 'rows',
            path: ['rows'],
            label: props.label ?? '动态明细',
            fields: props.fields,
            initial: props.value ?? [],
            ...('minItems' in props ? { minItems: props.minItems } : {}),
            ...('maxItems' in props ? { maxItems: props.maxItems } : {}),
          }),
        );
      if ('options' in props) {
        if (!record(props.options)) errors.push('明细选项应为字段 ID 到选项数组的映射');
        else {
          const fields =
            context.array?.fields ??
            (!props.formId && !errors.length && Array.isArray(props.fields)
              ? (props.fields as FieldDefinition[])
              : undefined);
          for (const [key, options] of Object.entries(props.options)) {
            const field = fields?.find((field) => field.id === key);
            if (fields && (!field || field.format || field.type === 'boolean'))
              errors.push(`${key}: 选项只能配置给已有的文本、数字或多选字段`);
            errors.push(
              ...validateSelectProps(
                { options, multiple: field?.type === 'array' },
                { fieldType: field?.type, fieldItemType: field?.itemType },
              ).map((error) => `${key}: ${error}`),
            );
          }
        }
      }
      return errors;
    },
  },
};
