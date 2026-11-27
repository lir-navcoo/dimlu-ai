import {
  FieldFrame,
  useMaterialValue,
  boolProp,
  numberProp,
  requiredText,
  textProp,
  type Contracts,
  type FieldPresentation,
} from './shared';

export interface SliderMaterialProps extends FieldPresentation {
  value: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean;
}

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

function clampToStep(value: number, min: number, max: number, step: number) {
  const clamped = Math.max(min, Math.min(max, value));
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Keep the resulting number tidy (avoid 0.30000000000000004 from float steps).
  const precision = (String(step).split('.')[1] ?? '').length;
  return Number(Math.max(min, Math.min(max, snapped)).toFixed(precision));
}

export function SliderMaterial({
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  showValue = true,
  ...field
}: SliderMaterialProps) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  const lower = finite(min, 0);
  const upper = Math.max(lower, finite(max, 100));
  const interval = Math.max(0.01, finite(step, 1));
  const current = clampToStep(finite(selected, lower), lower, upper, interval);
  const percent = upper === lower ? 0 : ((current - lower) / (upper - lower)) * 100;

  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <div className="material-slider" style={a11y.style} aria-label={`${field.label}滑块`}>
          <input
            {...a11y}
            type="range"
            className="material-slider-range"
            min={lower}
            max={upper}
            step={interval}
            value={current}
            disabled={field.disabled || field.readOnly}
            aria-valuemin={lower}
            aria-valuemax={upper}
            aria-valuenow={current}
            onChange={(event) =>
              change(clampToStep(Number(event.target.value), lower, upper, interval))
            }
          />
          {showValue && <output className="material-slider-value">{current}</output>}
          <input type="hidden" name={field.name} value={current} readOnly aria-hidden="true" />
        </div>
      )}
    </FieldFrame>
  );
}

export const sliderContracts: Contracts = {
  'ui.slider': {
    version: '1.0.0',
    field: { type: 'number', valueProp: 'value', changeEvent: 'onValueChange' },
    props: {
      label: requiredText,
      value: { ...numberProp, required: true },
      min: numberProp,
      max: numberProp,
      step: numberProp,
      showValue: boolProp,
      hint: textProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props) => {
      const errors: string[] = [];
      const min = props.min;
      const max = props.max;
      const step = props.step;
      const value = props.value;
      if (min !== undefined && (typeof min !== 'number' || !Number.isFinite(min)))
        errors.push('min 必须为有限数字');
      if (max !== undefined && (typeof max !== 'number' || !Number.isFinite(max)))
        errors.push('max 必须为有限数字');
      if (typeof min === 'number' && typeof max === 'number' && min > max)
        errors.push('min 不能大于 max');
      if (step !== undefined && (typeof step !== 'number' || !Number.isFinite(step) || step <= 0))
        errors.push('step 必须为大于 0 的数字');
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
        errors.push('value 必须为有限数字');
      if (
        typeof value === 'number' &&
        typeof min === 'number' &&
        typeof max === 'number' &&
        min <= max &&
        (value < min || value > max)
      )
        errors.push('value 必须位于 min 到 max 之间');
      return errors;
    },
  },
};
