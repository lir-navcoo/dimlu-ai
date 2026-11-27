import {
  FieldFrame,
  useMaterialValue,
  boolProp,
  requiredText,
  textProp,
  type Contracts,
  type FieldPresentation,
} from './shared';
import { textStyle } from './style';

export interface ColorPickerMaterialProps extends FieldPresentation {
  value: string;
  onValueChange?: (value: string) => void;
  showText?: boolean;
}

const DEFAULT_COLOR = '#4f46e5';
const HEX = /^#[0-9a-fA-F]{6}$/;
const normalize = (value: unknown) =>
  typeof value === 'string' && HEX.test(value) ? value : DEFAULT_COLOR;

export function ColorPickerMaterial({
  value,
  onValueChange,
  showText = true,
  ...field
}: ColorPickerMaterialProps) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  const current = normalize(selected);

  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <div className="material-color-picker" style={textStyle(field.style)} {...a11y}>
          <input
            type="color"
            className="material-color-swatch"
            value={current}
            disabled={field.disabled || field.readOnly}
            aria-label={`${field.label}颜色选择器`}
            onChange={(event) => change(event.target.value)}
          />
          {showText && (
            <input
              type="text"
              className="material-color-text"
              value={current}
              disabled={field.disabled || field.readOnly}
              aria-label={`${field.label}颜色值`}
              onChange={(event) => {
                const next = event.target.value;
                if (HEX.test(next)) change(next);
              }}
            />
          )}
          <input type="hidden" name={field.name} value={current} readOnly aria-hidden="true" />
        </div>
      )}
    </FieldFrame>
  );
}

export const colorPickerContracts: Contracts = {
  'ui.colorPicker': {
    version: '1.0.0',
    field: { type: 'string', valueProp: 'value', changeEvent: 'onValueChange' },
    props: {
      label: requiredText,
      value: { ...textProp, required: true },
      showText: boolProp,
      hint: textProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props) => {
      const value = props.value;
      return value !== undefined && (typeof value !== 'string' || !HEX.test(value))
        ? ['value 必须为 #RRGGBB 格式的十六进制颜色']
        : [];
    },
  },
};
