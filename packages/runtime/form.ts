import {
  isJson,
  matchesFieldValue,
  type FieldDefinition,
  type FieldArrayDefinition,
  type FieldTarget,
  type FormDefinition,
  type Json,
  type Value,
} from '../schema/types';
import { temporalError } from '../schema/formats';
import { assignPath, rowValues } from '../schema/field-data';
import { prepareFormPatch } from '../schema/form-patch';
import { compileValue, type EvaluationContext } from './expression';
import type { Registry } from './registry';
import { abortable, isAbortError } from './abort';

export interface FieldState {
  value: Json;
  error?: string;
  visible: boolean;
  disabled: boolean;
  dirty: boolean;
  touched: boolean;
}
export interface FieldArrayRow {
  id: string;
  index: number;
  values: Readonly<Record<string, Json>>;
  fields: Readonly<Record<string, FieldState>>;
}
export interface FieldArrayState {
  rows: readonly FieldArrayRow[];
  visible: boolean;
  disabled: boolean;
  dirty: boolean;
  touched: boolean;
  error?: string;
}
export interface FormSnapshot {
  values: Readonly<Record<string, Json>>;
  computed: Readonly<Record<string, Json>>;
  fields: Readonly<Record<string, FieldState>>;
  arrays: Readonly<Record<string, FieldArrayState>>;
  errors: Readonly<Record<string, string>>;
  formErrors: readonly string[];
  isDirty: boolean;
  isValid: boolean;
  isSubmitting: boolean;
  isSubmitted: boolean;
  isSubmitSuccessful: boolean;
  submitCount: number;
  submitError?: string;
}
export function fieldKey(target: FieldTarget): string {
  return typeof target === 'string'
    ? target
    : target.arrayId + '/' + target.rowId + '/' + target.fieldId;
}
export class FormSubmissionError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(immutable);
  }
  return value;
}
type Submit = (
  values: Readonly<Record<string, Json>>,
  signal: AbortSignal,
) => unknown | Promise<unknown>;
interface StoredRow {
  id: string;
  values: Record<string, Json>;
  initial: Record<string, Json>;
}

/** Stable field/row identities own state; data paths only determine the submitted shape. */
export class FormRuntime {
  readonly definition: FormDefinition;
  private values: Record<string, Json> = {};
  private rows = new Map<string, StoredRow[]>();
  private initialRowIds = new Map<string, string[]>();
  private rowSequence = 0;
  private touched = new Set<string>();
  private serverErrors: Record<string, string> = {};
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private submissionValues?: Readonly<Record<string, Json>>;
  private disposed = false;
  private status = this.defaultStatus();
  private snapshot!: FormSnapshot;
  private rules = new Map<string, ReturnType<typeof compileValue>>();
  constructor(
    definition: FormDefinition,
    private pageContext: () => EvaluationContext = () => ({ state: {}, scope: {} }),
    private computations: Registry['computations'] = {},
  ) {
    this.definition = immutable(structuredClone(definition));
    const register = (value?: Value) => {
      if (value) this.rules.set(JSON.stringify(value), compileValue(value));
    };
    for (const field of [
      ...definition.fields,
      ...(definition.arrays ?? []).flatMap((a) => a.fields),
    ]) {
      if (
        !field.path.length ||
        field.path.some((p) => ['__proto__', 'prototype', 'constructor'].includes(p))
      )
        throw new Error('非法字段路径');
      register(field.when);
      register(field.disabled);
      field.rules?.forEach((r) => {
        if (r.kind === 'expression') register(r.test);
      });
    }
    definition.arrays?.forEach((a) => {
      register(a.when);
      register(a.disabled);
    });
    definition.rules?.forEach((r) => register(r.test));
    this.restoreDefaults();
    this.refresh();
  }
  private defaultStatus() {
    return {
      isSubmitting: false,
      isSubmitted: false,
      isSubmitSuccessful: false,
      submitCount: 0,
      submitError: undefined as string | undefined,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => this.listeners.delete(notify);
  };
  getArrayDefinition(id: string): FieldArrayDefinition {
    const array = this.definition.arrays?.find((a) => a.id === id);
    if (!array) throw new Error('未知数组字段 ' + id);
    return array;
  }
  getFieldDefinition(target: FieldTarget): FieldDefinition {
    const field =
      typeof target === 'string'
        ? this.definition.fields.find((f) => f.id === target)
        : this.getArrayDefinition(target.arrayId).fields.find((f) => f.id === target.fieldId);
    if (!field) throw new Error('未知字段 ' + fieldKey(target));
    return field;
  }
  getFieldState(target: FieldTarget): FieldState | undefined {
    return typeof target === 'string'
      ? this.snapshot.fields[target]
      : this.snapshot.arrays[target.arrayId]?.rows.find((r) => r.id === target.rowId)?.fields[
          target.fieldId
        ];
  }
  getFieldName(target: FieldTarget): string {
    const field = this.getFieldDefinition(target);
    if (typeof target === 'string') return field.path.join('.');
    const index = this.rows.get(target.arrayId)!.findIndex((r) => r.id === target.rowId);
    return [...this.getArrayDefinition(target.arrayId).path, String(index), ...field.path].join(
      '.',
    );
  }
  private makeRow(array: FieldArrayDefinition, input: unknown): StoredRow {
    const values = rowValues(array.fields, input);
    return { id: 'row-' + ++this.rowSequence, values, initial: { ...values } };
  }
  private restoreDefaults() {
    this.values = Object.fromEntries(this.definition.fields.map((f) => [f.id, f.initial]));
    this.rows.clear();
    this.initialRowIds.clear();
    for (const array of this.definition.arrays ?? []) {
      const rows = array.initial.map((value) => this.makeRow(array, value));
      this.rows.set(array.id, rows);
      this.initialRowIds.set(
        array.id,
        rows.map((r) => r.id),
      );
    }
  }
  private rowData(
    array: FieldArrayDefinition,
    row: StoredRow,
    visibleOnly = false,
  ): Record<string, Json> {
    const result: Record<string, Json> = {};
    for (const field of array.fields) {
      const target = { arrayId: array.id, rowId: row.id, fieldId: field.id };
      if (!visibleOnly || this.getFieldState(target)?.visible)
        assignPath(result, field.path, row.values[field.id]);
    }
    return result;
  }
  private data(visibleOnly = false): Record<string, Json> {
    const result: Record<string, Json> = {};
    for (const field of this.definition.fields)
      if (!visibleOnly || this.snapshot.fields[field.id].visible)
        assignPath(result, field.path, this.values[field.id]);
    for (const array of this.definition.arrays ?? [])
      if (!visibleOnly || this.snapshot.arrays[array.id].visible)
        assignPath(
          result,
          array.path,
          this.rows.get(array.id)!.map((row) => this.rowData(array, row, visibleOnly)),
        );
    return result;
  }
  getSubmitValues = () => this.submissionValues ?? immutable(this.data(true));
  refresh = () => {
    if (this.disposed) return;
    const values = immutable(this.data());
    const computed: Record<string, Json> = {},
      formErrors: string[] = [];
    for (const entry of this.definition.computed ?? []) {
      try {
        const value = this.computations?.[entry.compute]?.compute(values);
        if (!isJson(value)) throw new Error('计算必须返回有限的 JSON 数据');
        computed[entry.id] = immutable(structuredClone(value));
      } catch (cause) {
        formErrors.push('计算 ' + entry.id + ' 配置错误：' + (cause as Error).message);
      }
    }
    const ctx: EvaluationContext = {
      ...this.pageContext(),
      forms: {
        [this.definition.id]: {
          values,
          computed: immutable(computed),
          fields: Object.fromEntries(
            Object.entries(this.values).map(([id, value]) => [id, { value }]),
          ),
        },
      },
    };
    const bool = (v: Value, context = ctx) => {
      const result = this.rules.get(JSON.stringify(v))!.evaluate(context);
      if (typeof result !== 'boolean') throw new Error('表单条件和校验表达式必须返回布尔值');
      return result;
    };
    const fields: Record<string, FieldState> = {},
      arrays: Record<string, FieldArrayState> = {},
      errors: Record<string, string> = {};
    let valid = formErrors.length === 0;
    const evaluateField = (
      field: FieldDefinition,
      value: Json,
      initial: Json,
      target: FieldTarget,
      context: EvaluationContext,
      parentVisible = true,
      parentDisabled = false,
    ): FieldState => {
      const key = fieldKey(target);
      let visible = parentVisible,
        disabled = parentDisabled,
        error: string | undefined;
      try {
        visible = parentVisible && (field.when ? bool(field.when, context) : true);
        disabled = parentDisabled || (field.disabled ? bool(field.disabled, context) : false);
        if (visible) {
          const empty =
            value === null ||
            value === '' ||
            (typeof value === 'string' && !value.trim()) ||
            (Array.isArray(value) && value.length === 0);
          if (!matchesFieldValue(value, field)) error = field.label + '类型错误';
          error ??= temporalError(value, field);
          for (const rule of field.rules ?? []) {
            if (error) break;
            let pass = true;
            switch (rule.kind) {
              case 'required':
                pass = !empty;
                break;
              case 'mustBeTrue':
                pass = value === true;
                break;
              case 'min':
                pass = empty || Number(value) >= rule.value;
                break;
              case 'max':
                pass = empty || Number(value) <= rule.value;
                break;
              case 'minLength':
                pass =
                  empty ||
                  (Array.isArray(value) ? value.length : String(value).length) >= rule.value;
                break;
              case 'maxLength':
                pass =
                  empty ||
                  (Array.isArray(value) ? value.length : String(value).length) <= rule.value;
                break;
              case 'pattern':
                pass = empty || new RegExp(rule.value).test(String(value));
                break;
              case 'expression':
                pass = bool(rule.test, context);
                break;
            }
            if (!pass) error = rule.message;
          }
          error = Object.hasOwn(this.serverErrors, key) ? this.serverErrors[key] : error;
        }
      } catch (cause) {
        error = '配置错误：' + (cause as Error).message;
        disabled = true;
      }
      if (error) valid = false;
      const shown = error && (this.touched.has(key) || this.status.isSubmitted) ? error : undefined;
      if (shown) errors[key] = shown;
      return {
        value,
        visible,
        disabled: disabled || this.status.isSubmitting,
        dirty:
          Array.isArray(value) && Array.isArray(initial)
            ? value.length !== initial.length ||
              value.some((item, i) => !Object.is(item, initial[i]))
            : !Object.is(value, initial),
        touched: this.touched.has(key),
        ...(shown ? { error: shown } : {}),
      };
    };
    for (const field of this.definition.fields)
      fields[field.id] = evaluateField(field, this.values[field.id], field.initial, field.id, ctx);
    for (const array of this.definition.arrays ?? []) {
      const stored = this.rows.get(array.id)!;
      let visible = true,
        disabled = false,
        error: string | undefined;
      try {
        visible = array.when ? bool(array.when) : true;
        disabled = array.disabled ? bool(array.disabled) : false;
        if (visible) {
          if (stored.length < (array.minItems ?? 0))
            error = array.label + '至少需要 ' + array.minItems + ' 行';
          if (array.maxItems !== undefined && stored.length > array.maxItems)
            error = array.label + '最多允许 ' + array.maxItems + ' 行';
          error = Object.hasOwn(this.serverErrors, array.id) ? this.serverErrors[array.id] : error;
        }
      } catch (cause) {
        error = '配置错误：' + (cause as Error).message;
        disabled = true;
      }
      if (error) valid = false;
      const shown =
        error && (this.touched.has(array.id) || this.status.isSubmitted) ? error : undefined;
      if (shown) errors[array.id] = shown;
      const rows = stored.map((row, index) => {
        const rowData = immutable(this.rowData(array, row));
        const context = { ...ctx, scope: { row: rowData, index } };
        return {
          id: row.id,
          index,
          values: rowData,
          fields: Object.fromEntries(
            array.fields.map((field) => [
              field.id,
              evaluateField(
                field,
                row.values[field.id],
                row.initial[field.id],
                { arrayId: array.id, rowId: row.id, fieldId: field.id },
                context,
                visible,
                disabled,
              ),
            ]),
          ),
        };
      });
      const initialIds = this.initialRowIds.get(array.id)!;
      const dirty =
        stored.length !== initialIds.length ||
        stored.some((r, i) => r.id !== initialIds[i]) ||
        rows.some((r) => Object.values(r.fields).some((f) => f.dirty));
      arrays[array.id] = {
        rows,
        visible,
        disabled: disabled || this.status.isSubmitting,
        dirty,
        touched: this.touched.has(array.id),
        ...(shown ? { error: shown } : {}),
      };
    }
    for (const rule of this.definition.rules ?? []) {
      try {
        if (!bool(rule.test)) formErrors.push(rule.message);
      } catch (cause) {
        formErrors.push('表单规则配置错误：' + (cause as Error).message);
      }
    }
    if (formErrors.length) valid = false;
    const shownFormErrors = this.status.isSubmitted ? formErrors : [];
    shownFormErrors.forEach((message, i) => {
      errors['$form:' + i] = message;
    });
    this.snapshot = immutable({
      values,
      computed,
      fields,
      arrays,
      errors,
      formErrors: shownFormErrors,
      isDirty:
        Object.values(fields).some((f) => f.dirty) || Object.values(arrays).some((a) => a.dirty),
      isValid: valid,
      ...this.status,
    });
    this.listeners.forEach((fn) => fn());
  };
  private edited(preserveServerErrors = false) {
    if (!preserveServerErrors) this.serverErrors = {};
    this.status.submitError = undefined;
    this.status.isSubmitSuccessful = false;
    this.refresh();
  }
  setValue = (target: FieldTarget, value: unknown) => {
    if (this.disposed) throw new Error('表单已销毁');
    const field = this.getFieldDefinition(target),
      state = this.getFieldState(target);
    if (!state || state.disabled || !state.visible) return;
    if (!matchesFieldValue(value, field)) throw new Error(fieldKey(target) + ' 需要 ' + field.type);
    value = structuredClone(value);
    if (typeof target === 'string') this.values = { ...this.values, [target]: value as Json };
    else {
      const row = this.rows.get(target.arrayId)!.find((r) => r.id === target.rowId)!;
      row.values = { ...row.values, [target.fieldId]: value as Json };
    }
    delete this.serverErrors[fieldKey(target)];
    if (typeof target !== 'string') delete this.serverErrors[target.arrayId];
    this.edited(true);
  };
  /** Patch nested business paths. Validate the entire patch before publishing any change. */
  setValues = (input: unknown) => {
    if (this.disposed) throw new Error('表单已销毁');
    if (this.status.isSubmitting) throw new Error('表单正在提交，无法回填');
    const prepared = prepareFormPatch(this.definition, input);
    this.values = { ...this.values, ...prepared.fields };
    for (const { array, rows } of prepared.arrays)
      this.rows.set(
        array.id,
        rows.map((values) => ({
          id: 'row-' + ++this.rowSequence,
          values,
          initial: structuredClone(values),
        })),
      );
    this.edited();
  };
  blur = (target: FieldTarget) => {
    this.getFieldDefinition(target);
    if (this.disposed || !this.getFieldState(target)) return;
    this.touched.add(fieldKey(target));
    this.refresh();
  };
  private arrayEditable(id: string) {
    this.getArrayDefinition(id);
    if (this.disposed) throw new Error('表单已销毁');
    const state = this.snapshot.arrays[id];
    return state.visible && !state.disabled;
  }
  append = (arrayId: string, value: unknown = {}): string | undefined => {
    if (!this.arrayEditable(arrayId)) return;
    const row = this.makeRow(this.getArrayDefinition(arrayId), value);
    this.rows.get(arrayId)!.push(row);
    delete this.serverErrors[arrayId];
    this.touched.add(arrayId);
    this.edited(true);
    return row.id;
  };
  remove = (arrayId: string, rowId: string) => {
    if (!this.arrayEditable(arrayId)) return;
    const rows = this.rows.get(arrayId)!,
      index = rows.findIndex((r) => r.id === rowId);
    if (index < 0) return;
    rows.splice(index, 1);
    for (const key of this.touched)
      if (key.startsWith(arrayId + '/' + rowId + '/')) this.touched.delete(key);
    this.serverErrors = Object.fromEntries(
      Object.entries(this.serverErrors).filter(
        ([key]) => !key.startsWith(arrayId + '/' + rowId + '/'),
      ),
    );
    delete this.serverErrors[arrayId];
    this.touched.add(arrayId);
    this.edited(true);
  };
  move = (arrayId: string, rowId: string, toIndex: number) => {
    if (!this.arrayEditable(arrayId)) return;
    const rows = this.rows.get(arrayId)!,
      fromIndex = rows.findIndex((r) => r.id === rowId);
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= rows.length)
      throw new Error('目标行下标超出范围');
    if (fromIndex < 0 || fromIndex === toIndex) return;
    rows.splice(toIndex, 0, rows.splice(fromIndex, 1)[0]);
    this.touched.add(arrayId);
    this.edited(true);
  };
  validate = () => {
    for (const field of this.definition.fields)
      if (this.snapshot.fields[field.id].visible) this.touched.add(field.id);
    for (const [arrayId, array] of Object.entries(this.snapshot.arrays))
      if (array.visible) {
        this.touched.add(arrayId);
        for (const row of array.rows)
          for (const [fieldId, state] of Object.entries(row.fields))
            if (state.visible) this.touched.add(fieldKey({ arrayId, rowId: row.id, fieldId }));
      }
    this.refresh();
    return this.snapshot.isValid;
  };
  submit = async (
    callback: Submit,
    options: { signal?: AbortSignal; throwOnCancel?: boolean } = {},
  ): Promise<boolean> => {
    if (this.disposed || this.status.isSubmitting) return false;
    if (options.signal?.aborted) return false;
    this.status.submitCount++;
    this.status.isSubmitted = true;
    this.status.isSubmitSuccessful = false;
    this.status.submitError = undefined;
    this.serverErrors = {};
    if (!this.validate()) return false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.controller = controller;
    this.submissionValues = immutable(this.data(true));
    this.status.isSubmitting = true;
    this.refresh();
    const active = () =>
      !this.disposed && !controller.signal.aborted && this.controller === controller;
    try {
      await abortable(controller.signal, () => callback(this.getSubmitValues(), controller.signal));
      if (!active()) return false;
      this.status.isSubmitSuccessful = true;
      return true;
    } catch (error) {
      if (isAbortError(error)) {
        if (options.throwOnCancel) throw error;
        return false;
      }
      if (active()) {
        this.status.submitError = error instanceof Error ? error.message : String(error);
        if (error instanceof FormSubmissionError) {
          const known = new Set([
            ...Object.keys(this.snapshot.fields),
            ...Object.keys(this.snapshot.arrays),
            ...Object.entries(this.snapshot.arrays).flatMap(([arrayId, array]) =>
              array.rows.flatMap((row) =>
                Object.keys(row.fields).map((fieldId) =>
                  fieldKey({ arrayId, rowId: row.id, fieldId }),
                ),
              ),
            ),
          ]);
          this.serverErrors = Object.fromEntries(
            Object.entries(error.fieldErrors).filter(([key]) => known.has(key)),
          );
        }
      }
      return false;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (!this.disposed && this.controller === controller) {
        this.controller = undefined;
        this.submissionValues = undefined;
        this.status.isSubmitting = false;
        this.refresh();
      }
    }
  };
  handleSubmit = (callback: Submit) => (event?: { preventDefault(): void }) => {
    event?.preventDefault();
    return this.submit(callback);
  };
  reset = () => {
    if (this.disposed) return;
    this.controller?.abort();
    this.controller = undefined;
    this.submissionValues = undefined;
    this.restoreDefaults();
    this.touched.clear();
    this.serverErrors = {};
    this.status = this.defaultStatus();
    this.refresh();
  };
  dispose() {
    this.disposed = true;
    this.controller?.abort();
    this.listeners.clear();
  }
}
