import { useEffect, useId, useState, type FocusEventHandler } from 'react';
import { Checkbox } from '@base-ui/react/checkbox';
import { Switch } from '@base-ui/react/switch';
import { Check } from 'lucide-react';
import { textStyle } from './materials/style';
import { materialStyleTarget } from '../packages/react-runtime/Renderer';

export interface BooleanMaterialProps {
  style?: React.CSSProperties;
  label: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  name?: string;
}

function BooleanMaterial({
  variant,
  label,
  checked,
  onCheckedChange,
  onBlur,
  hint,
  error,
  required = false,
  disabled = false,
  name,
  style,
}: BooleanMaterialProps & { variant: 'checkbox' | 'switch' }) {
  const id = useId();
  const controlled = !!onCheckedChange;
  const [localChecked, setLocalChecked] = useState(checked);
  useEffect(() => setLocalChecked(checked), [checked, controlled]);
  const Root = variant === 'switch' ? Switch.Root : Checkbox.Root;
  const description =
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div
      className="material-field material-boolean-field"
      style={style}
      {...materialStyleTarget(style)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlur?.(event);
      }}
    >
      <label className="material-boolean-label" htmlFor={id} style={textStyle(style)}>
        <Root
          id={id}
          name={name}
          checked={controlled ? checked : localChecked}
          onCheckedChange={onCheckedChange ?? setLocalChecked}
          disabled={disabled}
          required={required}
          className={`material-${variant}`}
          aria-labelledby={`${id}-label`}
          aria-describedby={description}
          aria-invalid={!!error}
        >
          {variant === 'switch' ? (
            <Switch.Thumb className="material-switch-thumb" />
          ) : (
            <Checkbox.Indicator>
              <Check size={12} strokeWidth={2.5} />
            </Checkbox.Indicator>
          )}
        </Root>
        <span id={`${id}-label`} style={textStyle(style)}>
          {label}
          {required && <b aria-hidden="true"> *</b>}
        </span>
      </label>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small id={`${id}-error`} className="field-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function CheckboxMaterial(props: BooleanMaterialProps) {
  return <BooleanMaterial {...props} variant="checkbox" />;
}
export function SwitchMaterial(props: BooleanMaterialProps) {
  return <BooleanMaterial {...props} variant="switch" />;
}
