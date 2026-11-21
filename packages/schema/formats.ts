import type { FieldDefinition } from './types';
export type TemporalFormat = 'date' | 'month' | 'time' | 'datetime-local';
export function validTemporal(value: unknown, format: TemporalFormat): boolean {
  if (typeof value !== 'string') return false;
  if (format === 'datetime-local') {
    const parts = value.split('T');
    return parts.length === 2 && validTemporal(parts[0], 'date') && validTemporal(parts[1], 'time');
  }
  if (format === 'time') return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  if (y < 1 || m < 1 || m > 12) return false;
  if (format === 'month') return day === undefined;
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day !== undefined && d > 0 && d <= days[m - 1];
}
export function temporalError(
  value: unknown,
  field: Pick<FieldDefinition, 'format' | 'range'>,
): string | undefined {
  if (!field.format || value === '' || value === null || (Array.isArray(value) && !value.length))
    return;
  if (field.range) {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every((v) => validTemporal(v, field.format!))
    )
      return '请填写完整且有效的起止值';
    const normalize = (part: unknown) => {
      const text = String(part);
      return (field.format === 'time' && text.length === 5) ||
        (field.format === 'datetime-local' && text.length === 16)
        ? `${text}:00`
        : text;
    };
    if (normalize(value[0]) > normalize(value[1])) return '开始值不能晚于结束值';
  } else if (!validTemporal(value, field.format)) return '日期或时间格式无效';
}
