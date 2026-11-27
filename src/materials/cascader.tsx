import { useState } from 'react';
import {
  FieldFrame,
  useMaterialValue,
  arrayProp,
  boolProp,
  requiredText,
  textProp,
  type Contracts,
  type FieldPresentation,
} from './shared';
import { textStyle } from './style';

export interface CascaderOption {
  label: string;
  value: string;
  disabled?: boolean;
  children?: CascaderOption[];
}
export interface CascaderMaterialProps extends FieldPresentation {
  value: string[];
  onValueChange?: (value: string[]) => void;
  options: CascaderOption[];
  placeholder?: string;
  /** 开启后选中任意层级即提交该路径，不必选到叶子。 */
  changeOnSelect?: boolean;
}

function optionErrors(options: unknown, at = '选项'): string[] {
  if (!Array.isArray(options)) return [`${at}必须为数组`];
  const errors: string[] = [];
  const seen = new Set<string>();
  options.forEach((option, index) => {
    const label = `${at} ${index + 1}`;
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      errors.push(`${label}必须包含名称与值`);
      return;
    }
    const item = option as CascaderOption;
    if (typeof item.label !== 'string' || !item.label.trim()) errors.push(`${label}名称不能为空`);
    if (typeof item.value !== 'string' || !item.value) errors.push(`${label}值必须为非空文本`);
    else {
      if (seen.has(item.value)) errors.push(`${label}的值重复`);
      seen.add(item.value);
    }
    if (item.disabled !== undefined && typeof item.disabled !== 'boolean')
      errors.push(`${label}的禁用状态必须为布尔值`);
    if (item.children !== undefined) errors.push(...optionErrors(item.children, `${label}子`));
  });
  return errors;
}

function labelsFor(options: CascaderOption[], path: string[]): string[] {
  const labels: string[] = [];
  let level = options;
  for (const value of path) {
    const found = level.find((option) => option.value === value);
    if (!found) break;
    labels.push(found.label);
    level = found.children ?? [];
  }
  return labels;
}

export function CascaderMaterial({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  changeOnSelect = false,
  ...field
}: CascaderMaterialProps) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  const [open, setOpen] = useState(false);
  const path = Array.isArray(selected) ? selected.filter((v) => typeof v === 'string') : [];
  const [activePath, setActivePath] = useState<string[]>(path);
  const columns: CascaderOption[][] = [Array.isArray(options) ? options : []];
  let level = columns[0];
  for (const valueAtLevel of activePath) {
    const found = level.find((option) => option.value === valueAtLevel);
    if (!found?.children?.length) break;
    level = found.children;
    columns.push(level);
  }
  const labels = labelsFor(columns[0], path);
  const choose = (depth: number, option: CascaderOption) => {
    const next = [...activePath.slice(0, depth), option.value];
    setActivePath(next);
    if (option.children?.length && !changeOnSelect) return;
    change(next);
    setOpen(false);
  };

  return (
    <FieldFrame {...field}>
      {(a11y) => (
        <div className="material-cascader" style={textStyle(field.style)}>
          <button
            {...a11y}
            type="button"
            className="material-cascader-trigger"
            disabled={field.disabled || field.readOnly}
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => {
              if (field.disabled || field.readOnly) return;
              setActivePath(path);
              setOpen((current) => !current);
            }}
          >
            {labels.length ? labels.join(' / ') : placeholder}
            <span aria-hidden="true" className="material-cascader-caret">
              ▾
            </span>
          </button>
          <input
            type="hidden"
            name={field.name}
            value={JSON.stringify(path)}
            readOnly
            aria-hidden="true"
          />
          {open && (
            <div
              className="material-cascader-panel"
              role="dialog"
              aria-label={`${field.label}级联选项`}
            >
              {columns.map((column, depth) => (
                <div className="material-cascader-column" key={depth}>
                  {column.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={`material-cascader-option${
                        activePath[depth] === option.value ? ' is-active' : ''
                      }`}
                      disabled={option.disabled}
                      onClick={() => choose(depth, option)}
                    >
                      <span>{option.label}</span>
                      {option.children?.length ? <span aria-hidden="true">›</span> : null}
                    </button>
                  ))}
                </div>
              ))}
              {!columns[0].length && <div className="material-cascader-empty">暂无选项</div>}
            </div>
          )}
        </div>
      )}
    </FieldFrame>
  );
}

export const cascaderContracts: Contracts = {
  'ui.cascader': {
    version: '1.0.0',
    field: { type: 'array', valueProp: 'value', changeEvent: 'onValueChange' },
    props: {
      label: requiredText,
      value: { ...arrayProp, required: true },
      options: { ...arrayProp, required: true },
      placeholder: textProp,
      changeOnSelect: boolProp,
      hint: textProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props, context) => {
      const errors = optionErrors(props.options);
      if (
        props.value !== undefined &&
        (!Array.isArray(props.value) || !props.value.every((v) => typeof v === 'string'))
      )
        errors.push('value 必须为文本数组');
      if (context.fieldType && context.fieldType !== 'array')
        errors.push('级联选择需要绑定数组字段');
      return errors;
    },
  },
};
