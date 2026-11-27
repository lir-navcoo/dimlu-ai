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
import { textStyle } from './style';

export interface RateMaterialProps extends FieldPresentation {
  value: number;
  onValueChange?: (value: number) => void;
  count?: number;
  allowHalf?: boolean;
  /** 点击当前已选分值时清零（宜搭 allowClear）。 */
  allowClear?: boolean;
  showGrade?: boolean;
}

const clampCount = (value: unknown) => {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 5;
  return Math.max(1, Math.min(10, count));
};

const clampValue = (value: unknown, count: number) => {
  const next = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(count, next));
};

export function RateMaterial({
  value,
  onValueChange,
  count = 5,
  allowHalf = false,
  allowClear = false,
  showGrade = false,
  ...field
}: RateMaterialProps) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  const total = clampCount(count);
  const current = clampValue(selected, total);

  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <div
          {...a11y}
          className="material-rate"
          role="group"
          aria-label={`${field.label}评分`}
          style={textStyle(field.style)}
        >
          <div className="material-rate-stars">
            {Array.from({ length: total }, (_, index) => {
              const star = index + 1;
              const fullValue = star;
              const halfValue = star - 0.5;
              const full = current >= fullValue;
              const half = allowHalf && current >= halfValue && current < fullValue;
              return (
                <span
                  className={`material-rate-star${full ? ' is-full' : half ? ' is-half' : ''}`}
                  key={star}
                >
                  {allowHalf && (
                    <button
                      type="button"
                      className="material-rate-hit material-rate-hit-half"
                      aria-label={`${halfValue} 分`}
                      aria-pressed={current === halfValue}
                      disabled={field.disabled || field.readOnly}
                      onClick={() =>
                        change(allowClear && current === halfValue ? 0 : halfValue)
                      }
                    >
                      <span aria-hidden="true">★</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="material-rate-hit"
                    aria-label={`${fullValue} 分`}
                    aria-pressed={current === fullValue}
                    disabled={field.disabled || field.readOnly}
                    onClick={() =>
                      change(allowClear && current === fullValue ? 0 : fullValue)
                    }
                  >
                    <span aria-hidden="true">★</span>
                  </button>
                </span>
              );
            })}
          </div>
          {showGrade && (
            <output className="material-rate-grade">
              {current}/{total}
            </output>
          )}
          <input type="hidden" name={field.name} value={current} readOnly aria-hidden="true" />
        </div>
      )}
    </FieldFrame>
  );
}

export const rateContracts: Contracts = {
  'ui.rate': {
    version: '1.0.0',
    field: { type: 'number', valueProp: 'value', changeEvent: 'onValueChange' },
    props: {
      label: requiredText,
      value: { ...numberProp, required: true },
      count: numberProp,
      allowHalf: boolProp,
      allowClear: boolProp,
      showGrade: boolProp,
      hint: textProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props) => {
      const errors: string[] = [];
      const count = props.count;
      if (
        count !== undefined &&
        (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 10)
      )
        errors.push('count 必须为 1 到 10 的整数');
      const value = props.value;
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))
        errors.push('value 必须为有限数字');
      if (typeof value === 'number' && typeof count === 'number' && (value < 0 || value > count))
        errors.push('value 必须位于 0 到 count 之间');
      if (
        typeof value === 'number' &&
        (props.allowHalf === false ? !Number.isInteger(value) : !Number.isInteger(value * 2))
      )
        errors.push(
          props.allowHalf === false
            ? 'allowHalf 关闭时 value 必须为整数'
            : 'value 必须以 0.5 为步进',
        );
      return errors;
    },
  },
};
