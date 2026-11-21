import type { FieldType } from '../packages/runtime/registry';

export type SelectValue = string | number;
export interface SelectOption {
  label: string;
  value: SelectValue;
  disabled?: boolean;
}
export function selectOptionErrors(value: unknown): string[] {
  if (!Array.isArray(value)) return ['选项必须为数组'];
  const used = new Set<SelectValue>();
  const errors: string[] = [];
  value.forEach((option, index) => {
    const at = `选项 ${index + 1}`;
    if (!option || typeof option !== 'object' || Array.isArray(option)) {
      errors.push(`${at} 必须包含名称和实际值`);
      return;
    }
    if (typeof option.label !== 'string' || !option.label.trim()) errors.push(`${at} 名称不能为空`);
    if (
      (typeof option.value !== 'string' || !option.value.trim()) &&
      (typeof option.value !== 'number' || !Number.isFinite(option.value))
    )
      errors.push(`${at} 的值必须为非空文本或有限数字`);
    if (option.disabled !== undefined && typeof option.disabled !== 'boolean')
      errors.push(`${at} 的禁用状态必须为布尔值`);
    if (used.has(option.value)) errors.push(`${at} 的值重复`);
    used.add(option.value);
  });
  return errors;
}
export function validateSelectProps(
  props: Readonly<Record<string, unknown>>,
  { fieldType, fieldItemType }: { fieldType?: FieldType; fieldItemType?: 'string' | 'number' },
) {
  const errors: string[] = [];
  const multiple = props.multiple === true;
  if (fieldType && (multiple ? fieldType !== 'array' : fieldType === 'array'))
    errors.push('多选模式需要绑定数组字段，单选模式需要绑定文本或数字字段');
  const optionType = fieldType === 'array' ? fieldItemType : fieldType;
  if ('options' in props) {
    errors.push(...selectOptionErrors(props.options));
    if (
      !errors.length &&
      optionType &&
      (props.options as SelectOption[]).some((option) => typeof option.value !== optionType)
    )
      errors.push(
        `选项实际值类型必须与绑定字段一致（${optionType === 'number' ? '数字' : '文本'}）`,
      );
  }
  const isValue = (value: unknown) =>
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
  if ('value' in props) {
    if (multiple) {
      if (
        !Array.isArray(props.value) ||
        !props.value.every(isValue) ||
        new Set(props.value).size !== props.value.length
      )
        errors.push('多选值必须为不重复的文本或数字数组');
    } else if (props.value !== null && !isValue(props.value))
      errors.push('单选值必须为文本、数字或 null');
  }
  // With no concrete field yet, offer array binding only for homogeneous options.
  if (
    !errors.length &&
    fieldType === 'array' &&
    !fieldItemType &&
    Array.isArray(props.options) &&
    new Set((props.options as SelectOption[]).map((option) => typeof option.value)).size > 1
  )
    errors.push('绑定数组字段前，请统一选项的实际值类型');
  return errors;
}
