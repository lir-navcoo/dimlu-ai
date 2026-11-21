import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { CheckboxGroup } from '@base-ui/react/checkbox-group';
import { Checkbox } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import {
  FieldFrame,
  useMaterialValue,
  textProp,
  boolProp,
  arrayProp,
  jsonProp,
  requiredText,
  enumErrors,
  type FieldPresentation,
  type Contracts,
} from './shared';
import { validateSelectProps, type SelectOption, type SelectValue } from '../select-options';
import { textStyle } from './style';

type Props = FieldPresentation & {
  options: SelectOption[];
  orientation?: 'horizontal' | 'vertical';
};
export function RadioGroupMaterial({
  value,
  onValueChange,
  options,
  orientation = 'horizontal',
  ...field
}: Props & { value: SelectValue | null; onValueChange?: (value: SelectValue | null) => void }) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <RadioGroup
          {...a11y}
          className={`material-choice-group ${orientation}`}
          value={selected === '' ? null : selected}
          onValueChange={change}
          disabled={field.disabled}
          required={field.required}
          name={field.name}
        >
          {options.map((option) => (
            <label
              className="material-choice"
              key={`${typeof option.value}:${option.value}`}
              style={textStyle(field.style)}
            >
              <Radio.Root
                className="material-radio"
                value={option.value}
                disabled={option.disabled}
              >
                <Radio.Indicator className="material-radio-dot" />
              </Radio.Root>
              <span>{option.label}</span>
            </label>
          ))}
          {!options.length && <small>暂无选项</small>}
          {selected !== null &&
            selected !== '' &&
            !options.some((o) => Object.is(o.value, selected)) && (
              <small>当前值已不在选项中，请重新选择。</small>
            )}
        </RadioGroup>
      )}
    </FieldFrame>
  );
}
const encode = (value: SelectValue) => `${typeof value}:${value}`;
export function CheckboxGroupMaterial({
  value,
  onValueChange,
  options,
  orientation = 'horizontal',
  ...field
}: Props & { value: SelectValue[]; onValueChange?: (value: SelectValue[]) => void }) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  // Base UI groups use string keys. Encode only the UI identity; callbacks keep authored value types.
  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <CheckboxGroup
          {...a11y}
          className={`material-choice-group ${orientation}`}
          value={selected.map(encode)}
          onValueChange={(keys) =>
            change(
              keys
                .map(
                  (key) =>
                    options.find((o) => encode(o.value) === key)?.value ??
                    selected.find((v) => encode(v) === key)!,
                )
                .filter((v) => v !== undefined),
            )
          }
          disabled={field.disabled}
        >
          {options.map((option) => (
            <label
              className="material-choice"
              key={encode(option.value)}
              style={textStyle(field.style)}
            >
              <Checkbox.Root
                className="material-checkbox"
                value={encode(option.value)}
                name={field.name}
                disabled={option.disabled}
              >
                <Checkbox.Indicator>
                  <Check size={12} />
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span>{option.label}</span>
            </label>
          ))}
          {!options.length && <small>暂无选项</small>}
          {selected.some((v) => !options.some((o) => Object.is(o.value, v))) && (
            <small>部分值已不在选项中，请重新选择。</small>
          )}
        </CheckboxGroup>
      )}
    </FieldFrame>
  );
}
const props = {
  label: requiredText,
  value: { ...jsonProp, required: true },
  options: { ...arrayProp, required: true },
  hint: textProp,
  orientation: textProp,
  disabled: boolProp,
  required: boolProp,
};
export const groupContracts: Contracts = {
  'ui.radioGroup': {
    version: '1.0.0',
    field: { type: ['string', 'number'], valueProp: 'value', changeEvent: 'onValueChange' },
    props,
    events: ['onValueChange', 'onBlur'],
    validateProps: (props, context) => [
      ...validateSelectProps({ ...props, multiple: false }, context),
      ...enumErrors(props, { orientation: ['horizontal', 'vertical'] }),
    ],
  },
  'ui.checkboxGroup': {
    version: '1.0.0',
    field: { type: 'array', valueProp: 'value', changeEvent: 'onValueChange' },
    props,
    events: ['onValueChange', 'onBlur'],
    validateProps: (props, context) => [
      ...validateSelectProps({ ...props, multiple: true }, context),
      ...enumErrors(props, { orientation: ['horizontal', 'vertical'] }),
    ],
  },
};
