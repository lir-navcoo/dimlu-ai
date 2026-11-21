export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type DataType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';
export type ExtensionData = Record<string, Json>;

export type Value =
  | { kind: 'literal'; value: Json }
  | { kind: 'stateRef'; stateId: string; path?: string[] }
  | { kind: 'dataRef'; sourceId: string; path?: string[] }
  | { kind: 'fieldRef'; formId: string; fieldId: string }
  | { kind: 'formValues'; formId: string }
  | { kind: 'expression'; language: 'javascript'; source: string };

export interface StateDefinition {
  id: string;
  type: DataType;
  initial: Json;
}
export interface DataSourceDefinition {
  id: string;
  kind: 'query' | 'mutation';
  transport: string;
  input: Record<string, Value>;
  initial: Json;
}

export type FieldRule =
  | { kind: 'required' | 'mustBeTrue'; message: string }
  | { kind: 'min' | 'max' | 'minLength' | 'maxLength'; value: number; message: string }
  | { kind: 'pattern'; value: string; message: string }
  | { kind: 'expression'; test: Value; message: string };
export interface FieldDefinition {
  id: string;
  path: string[];
  label: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  /** Primitive value list, distinct from dynamic rows in FormDefinition.arrays. */
  itemType?: 'string' | 'number';
  uniqueItems?: boolean;
  format?: import('./formats').TemporalFormat;
  range?: boolean;
  initial: string | number | boolean | null | (string | number)[];
  rules?: FieldRule[];
  when?: Value;
  disabled?: Value;
}
export interface FormDefinition {
  id: string;
  fields: FieldDefinition[];
  arrays?: FieldArrayDefinition[];
  computed?: { id: string; compute: string }[];
  rules?: { test: Value; message: string }[];
}
export interface FieldArrayDefinition {
  id: string;
  path: string[];
  label: string;
  fields: FieldDefinition[];
  initial: Record<string, Json>[];
  minItems?: number;
  maxItems?: number;
  when?: Value;
  disabled?: Value;
}
export type FieldTarget = string | { arrayId: string; rowId: string; fieldId: string };

export interface ActionCall {
  id: string;
  action: string;
  input: Record<string, Value>;
  resultTo?: string;
}

export interface SlotDefinition {
  params: string[];
  children: NodeSchema[];
}

export interface NodeSchema {
  id: string;
  component: string;
  props: Record<string, Value>;
  style?: Partial<Record<import('./style').StyleProperty, Value>>;
  formId?: string;
  field?: { formId: string; fieldId: string };
  children?: NodeSchema[];
  slots?: Record<string, SlotDefinition>;
  on?: Record<string, ActionCall[]>;
  when?: Value;
  repeat?: { items: Value; item: string; index?: string; key: Value };
  extensions?: ExtensionData;
}

export interface PageCode {
  enabled: boolean;
  language: 'jsx' | 'tsx';
  source: string;
  css: string;
}
export interface PageSchema {
  id: string;
  title: string;
  description?: string;
  code?: PageCode;
  state: StateDefinition[];
  forms?: FormDefinition[];
  dataSources?: DataSourceDefinition[];
  children: NodeSchema[];
  onEnter?: ActionCall[];
  extensions?: ExtensionData;
}

export interface ApplicationMethod {
  id: string;
  title: string;
  description?: string;
  inputType?: DataType | 'json';
  outputType?: DataType | 'json';
  source: string;
}

export interface ApplicationSchema {
  schemaVersion: '0.1.0';
  id: string;
  title: string;
  entryPageId: string;
  dependencies: {
    components: Record<string, string>;
    actions: Record<string, string>;
    computations?: Record<string, string>;
    transports?: Record<string, string>;
  };
  pages: PageSchema[];
  methods?: ApplicationMethod[];
  extensions?: ExtensionData;
}

export interface Issue {
  path: string;
  code: string;
  message: string;
}

export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return (
    !!value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.entries(value).every(
      ([key, item]) => !['__proto__', 'prototype', 'constructor'].includes(key) && isJson(item),
    )
  );
}

export function matchesType(value: unknown, type: DataType | 'json'): boolean {
  if (type === 'json') return isJson(value);
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value) && isJson(value);
  if (type === 'object')
    return value !== null && !Array.isArray(value) && typeof value === 'object' && isJson(value);
  return typeof value === type && isJson(value);
}

export function matchesFieldValue(
  value: unknown,
  field: Pick<FieldDefinition, 'type' | 'itemType' | 'uniqueItems'>,
): boolean {
  if (field.type !== 'array')
    return (
      field.itemType === undefined &&
      ((value === null && field.type === 'number') || matchesType(value, field.type))
    );
  return (
    (field.itemType === 'string' || field.itemType === 'number') &&
    Array.isArray(value) &&
    value.every((item) => matchesType(item, field.itemType!)) &&
    (field.uniqueItems === false || new Set(value).size === value.length)
  );
}
