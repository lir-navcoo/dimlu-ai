import { useEffect, useId, useRef, useState, type ReactNode, type FocusEventHandler, type MouseEventHandler } from 'react';
import type { ComponentContract } from '../../packages/runtime/registry';
import { textStyle } from './style';
import { materialStyleTarget } from '../../packages/react-runtime/Renderer';
import { isDocumentNode } from '../ui/runtime-dom';

export const textProp = { type: 'string' as const };
export const numberProp = { type: 'number' as const };
export const boolProp = { type: 'boolean' as const };
export const jsonProp = { type: 'json' as const };
export const arrayProp = { type: 'array' as const };
export const requiredText = { ...textProp, required: true };
export type Contracts = Record<string, ComponentContract>;

export function useMaterialValue<T>(value: T, onChange?: (value: T) => void) {
  const [local, setLocal] = useState(value);
  const controlled = !!onChange;
  const serialized = JSON.stringify(value);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!controlled) setLocal(latest.current);
  }, [serialized, controlled]);
  return [controlled ? value : local, onChange ?? setLocal] as const;
}
export interface FieldPresentation {
  style?: React.CSSProperties;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  onBlur?: FocusEventHandler<HTMLElement>;
  onClick?: MouseEventHandler<HTMLElement>;
}
export function FieldFrame({
  label,
  hint,
  error,
  required,
  onBlur,
  onClick,
  children,
  style,
}: FieldPresentation & {
  children: (props: {
    id: string;
    'aria-labelledby': string;
    'aria-describedby'?: string;
    'aria-invalid': boolean;
    style?: React.CSSProperties;
  }) => ReactNode;
}) {
  const id = useId();
  return (
    <div
      className="material-field"
      style={style}
      {...materialStyleTarget(style)}
      onClick={onClick}
      onBlur={(event) => {
        if (
          isDocumentNode(event.relatedTarget, event.currentTarget.ownerDocument) &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        onBlur?.(event);
      }}
    >
      <label id={`${id}-label`} htmlFor={id} style={textStyle(style)}>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </label>
      {children({
        id,
        'aria-labelledby': `${id}-label`,
        'aria-describedby':
          [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined,
        'aria-invalid': !!error,
        style: textStyle(style),
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function enumErrors(
  props: Readonly<Record<string, unknown>>,
  values: Record<string, readonly unknown[]>,
) {
  return Object.entries(values).flatMap(([key, allowed]) =>
    key in props && !allowed.includes(props[key]) ? [`${key} 的值无效`] : [],
  );
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function displayValue(value: unknown) {
  return value === undefined || value === null || value === ''
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
}
export function validKey(value: unknown): value is string | number {
  return (
    (typeof value === 'string' && !!value.trim()) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
export function readData(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, key) =>
        record(current) &&
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        Object.hasOwn(current, key)
          ? current[key]
          : undefined,
      value,
    );
}
export function rowsErrors(props: Readonly<Record<string, unknown>>, key = 'data') {
  if (!(key in props)) return [];
  if (!Array.isArray(props[key]) || !props[key].every(record)) return [`${key} 必须为对象数组`];
  if (!('rowKey' in props)) return [];
  const keys = props[key].map((row) => readData(row, String(props.rowKey)));
  return keys.some((key) => !validKey(key)) ||
    new Set(keys.map((key) => `${typeof key}:${key}`)).size !== keys.length
    ? ['每行必须具有唯一且非空的 rowKey']
    : [];
}
