import { useEffect, useId, useRef, useState, type FocusEventHandler, type MouseEventHandler } from 'react';
import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, X } from 'lucide-react';
import { Button, Tip } from './ui/primitives';
import type { SelectOption, SelectValue } from './select-options';
import { textStyle } from './materials/style';
import { materialStyleTarget } from '../packages/react-runtime/Renderer';
import { runtimePortalContainer, useRuntimeDomEnvironment } from './ui/runtime-dom';

type Selection<Multiple extends boolean> = Multiple extends true
  ? SelectValue[]
  : SelectValue | null;

export function SelectMaterial<Multiple extends boolean = false>({
  label,
  options,
  value,
  onValueChange,
  onBlur,
  placeholder = '请选择',
  hint,
  error,
  required = false,
  disabled = false,
  readOnly = false,
  clearable = true,
  multiple = false as Multiple,
  name,
  style,
  onClick,
}: {
  style?: React.CSSProperties;
  label: string;
  options: SelectOption[];
  value: Selection<Multiple>;
  onValueChange?: (value: Selection<Multiple>) => void;
  multiple?: Multiple;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  clearable?: boolean;
  name?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const id = useId();
  const container = runtimePortalContainer(useRuntimeDomEnvironment());
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // A static Schema value initializes an independent control. Form bindings and
  // authored value callbacks retain ownership when supplied.
  const controlled = !!onValueChange;
  const [localValue, setLocalValue] = useState(value);
  useEffect(() => setLocalValue(value), [value, controlled, multiple]);
  const effectiveValue = controlled ? value : localValue;
  const changeValue = (next: SelectValue | null | SelectValue[]) =>
    (onValueChange ?? setLocalValue)(next as Selection<Multiple>);
  const selected = multiple
    ? Array.isArray(effectiveValue)
      ? effectiveValue
      : []
    : effectiveValue === ''
      ? null
      : effectiveValue;
  const selectedValues = Array.isArray(selected) ? selected : selected === null ? [] : [selected];
  const hasValue = selectedValues.length > 0;
  const unavailable = selectedValues.some(
    (value) => !options.some((option) => Object.is(option.value, value)),
  );
  const selectedText = selectedValues
    .map(
      (value) => options.find((option) => Object.is(option.value, value))?.label ?? String(value),
    )
    .join('、');
  const description =
    [hint ? `${id}-hint` : '', error ? `${id}-error` : '', unavailable ? `${id}-missing` : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div
      className="material-field material-select-field"
      style={style}
      onClick={onClick}
      {...materialStyleTarget(style)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && (event.currentTarget.contains(next) || popup.current?.contains(next))) return;
        onBlur?.(event);
      }}
    >
      <label id={`${id}-label`} htmlFor={id} style={textStyle(style)}>
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </label>
      <div
        className="material-select-controls"
        data-clearable={(clearable && hasValue) || undefined}
      >
        <Select.Root<SelectValue, boolean>
          multiple={multiple}
          value={selected}
          items={options}
          name={name}
          required={required}
          disabled={disabled || readOnly}
          onValueChange={changeValue}
        >
          <Select.Trigger
            style={textStyle(style)}
            ref={trigger}
            id={id}
            className="ui-select material-select-trigger"
            aria-labelledby={`${id}-label`}
            aria-invalid={!!error}
            aria-describedby={description}
          >
            <Select.Value className="min-w-0 flex-1 truncate" placeholder={placeholder}>
              {() => (hasValue ? selectedText : placeholder)}
            </Select.Value>
            <Select.Icon>
              <ChevronDown size={13} />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal container={container}>
            <Select.Positioner
              sideOffset={4}
              alignItemWithTrigger={false}
              className="material-select-positioner"
            >
              <Select.Popup ref={popup} className="ui-select-popup">
                <Select.List className="material-select-list">
                  {options.length ? (
                    options.map((option) => (
                      <Select.Item
                        key={`${typeof option.value}:${option.value}`}
                        value={option.value}
                        disabled={option.disabled}
                        className="ui-select-item"
                      >
                        <Select.ItemText className="min-w-0 flex-1 truncate">
                          {option.label}
                        </Select.ItemText>
                        <Select.ItemIndicator>
                          <Check size={13} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    ))
                  ) : (
                    <p className="material-select-empty">暂无选项</p>
                  )}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
        {clearable && hasValue && (
          <Tip content="清空选择">
            <Button
              className="material-select-clear"
              variant="ghost"
              aria-label={`清空${label}`}
              disabled={disabled || readOnly}
              onClick={() => {
                changeValue(multiple ? [] : null);
                trigger.current?.focus();
              }}
            >
              <X size={13} />
            </Button>
          </Tip>
        )}
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {unavailable && <small id={`${id}-missing`}>当前值已不在选项中，请重新选择。</small>}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
