import type { DataType, Json, FieldDefinition, FieldArrayDefinition } from '../schema/types';

export interface ContractField {
  type: DataType | 'json';
  required?: boolean;
}
export interface ComponentContract {
  version: string;
  style?: import('../schema/style').StyleCapability;
  props: Record<string, ContractField>;
  events?: string[];
  slots?: Record<string, string[]>;
  children?: boolean;
  form?: boolean;
  fieldArray?: boolean;
  field?: {
    type: FieldType | readonly FieldType[];
    valueProp: 'value' | 'checked';
    changeEvent?: 'onChange' | 'onValueChange' | 'onCheckedChange';
    defaults?: (props: Readonly<Record<string, unknown>>) => Partial<FieldDefinition>;
  };
  /** Validates literal props in the editor and resolved props in the renderer. */
  validateProps?: (
    props: Readonly<Record<string, unknown>>,
    context: {
      fieldType?: FieldType;
      fieldItemType?: 'string' | 'number';
      field?: FieldDefinition;
      array?: FieldArrayDefinition;
    },
  ) => string[];
}
export type FieldType = 'string' | 'number' | 'boolean' | 'array';
export function fieldTypes(contract: ComponentContract): readonly FieldType[] {
  const type = contract.field?.type;
  return !type ? [] : typeof type === 'string' ? [type] : type;
}
export function acceptsField(
  contract: ComponentContract,
  type: FieldType,
  props: Readonly<Record<string, unknown>> = {},
  fieldItemType?: 'string' | 'number',
  field?: FieldDefinition,
) {
  return (
    fieldTypes(contract).includes(type) &&
    !contract.validateProps?.(props, { fieldType: type, fieldItemType, field }).length
  );
}
export interface ActionContext {
  signal: AbortSignal;
  getState(): Readonly<Record<string, Json>>;
  setState(id: string, value: unknown): void;
  setFormValues(formId: string, values: unknown): void;
  resetForm(formId: string): void;
  submitForm(formId: string): Promise<void>;
  executeDataSource(sourceId: string, input?: Record<string, Json>): Promise<Json>;
  /** Invoke a compiled application method (`app.method.<id>`) from other action code. */
  invokeApplication?(methodId: string, payload?: unknown): Promise<Json>;
  emitEffect(effect: { type: string; data: Record<string, Json> }): void;
  pageActions?: {
    setState(patch: unknown): void;
    getValue(nodeId: string): Json;
    setValue(nodeId: string, value: unknown): void;
    validateField(nodeId: string): boolean;
    resetField(nodeId: string): void;
    validateForm(formId: string): boolean;
  };
}
export interface ActionContract {
  version: string;
  input: Record<string, ContractField>;
  output?: DataType | 'json';
  execute(input: Record<string, Json>, context: ActionContext): unknown | Promise<unknown>;
}
export interface Registry {
  components: Record<string, ComponentContract>;
  actions: Record<string, ActionContract>;
  transports?: Record<string, TransportContract>;
  computations?: Record<
    string,
    { version: string; compute(values: Readonly<Record<string, Json>>): Json }
  >;
}
export interface TransportContract {
  version: string;
  input: Record<string, ContractField>;
  output: DataType | 'json';
  execute(
    input: Record<string, Json>,
    context: { signal: AbortSignal },
  ): unknown | Promise<unknown>;
}

export function createRegistry(
  components: Registry['components'],
  actions: Registry['actions'],
  computations: Registry['computations'] = {},
  transports: Registry['transports'] = {},
): Registry {
  return {
    components,
    computations,
    transports,
    actions: {
      'data.execute': {
        version: '1.0.0',
        input: { sourceId: { type: 'string', required: true }, input: { type: 'object' } },
        output: 'json',
        execute(input, context) {
          return context.executeDataSource(
            String(input.sourceId),
            input.input as Record<string, Json> | undefined,
          );
        },
      },
      'app.navigate': {
        version: '1.0.0',
        input: {
          pageId: { type: 'string', required: true },
          replace: { type: 'boolean' },
        },
        execute(input, context) {
          context.emitEffect({
            type: 'app.navigate',
            data: {
              pageId: String(input.pageId),
              replace: input.replace === true,
            },
          });
        },
      },
      'form.setValues': {
        version: '1.0.0',
        input: {
          formId: { type: 'string', required: true },
          values: { type: 'object', required: true },
        },
        execute(input, context) {
          context.setFormValues(String(input.formId), input.values);
        },
      },
      'form.reset': {
        version: '1.0.0',
        input: { formId: { type: 'string', required: true } },
        execute(input, context) {
          context.resetForm(String(input.formId));
        },
      },
      'form.submit': {
        version: '1.0.0',
        input: { formId: { type: 'string', required: true } },
        execute(input, context) {
          return context.submitForm(String(input.formId));
        },
      },
      'state.set': {
        version: '1.0.0',
        input: {
          stateId: { type: 'string', required: true },
          value: { type: 'json', required: true },
        },
        execute(input, context) {
          context.setState(String(input.stateId), input.value);
        },
      },
      // 条件分支由运行时在动作链循环中直接执行（then/else 子链），不经过 execute。
      'control.branch': {
        version: '1.0.0',
        input: { when: { type: 'boolean', required: true } },
        execute() {
          throw new Error('条件分支由运行时直接执行');
        },
      },
      ...actions,
    },
  };
}
