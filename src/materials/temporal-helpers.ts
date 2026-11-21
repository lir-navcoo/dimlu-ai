import { validTemporal, type TemporalFormat } from '../../packages/schema/formats';

export const pad2 = (value: number) => String(value).padStart(2, '0');
export const padYear = (value: number) => String(value).padStart(4, '0');
export function dateParts(value: string) {
  const [year, month, day = 1] = value.split('-').map(Number);
  return { year, month, day };
}
export function isoDate(year: number, month: number, day: number) {
  return `${padYear(year)}-${pad2(month)}-${pad2(day)}`;
}
export function daysInMonth(year: number, month: number) {
  return [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
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
  ][month - 1];
}
function utcDate(value: string) {
  const { year, month, day } = dateParts(value);
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  // setUTCFullYear avoids Date's special constructor interpretation of 0..99.
  date.setUTCFullYear(year, month - 1, day);
  return date;
}
function fromDate(date: Date) {
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}
export function addDays(value: string, amount: number) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  if (date.getUTCFullYear() < 1) return '0001-01-01';
  if (date.getUTCFullYear() > 9999) return '9999-12-31';
  return fromDate(date);
}
export function addMonths(value: string, amount: number) {
  const { year, month, day } = dateParts(value);
  const total = Math.max(0, Math.min(9999 * 12 - 1, (year - 1) * 12 + month - 1 + amount));
  const nextYear = Math.floor(total / 12) + 1,
    nextMonth = (total % 12) + 1;
  return isoDate(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)));
}
export function weekDay(value: string) {
  return (utcDate(value).getUTCDay() + 6) % 7;
}
export function monthDays(year: number, month: number) {
  const first = isoDate(year, month, 1),
    start = weekDay(first);
  return Array.from({ length: 42 }, (_, index) => {
    const date = utcDate(first);
    date.setUTCDate(1 - start + index);
    return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? null : fromDate(date);
  });
}
export function localNow(mode: TemporalFormat) {
  const date = new Date();
  const day = isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return mode === 'time'
    ? time
    : mode === 'month'
      ? day.slice(0, 7)
      : mode === 'datetime-local'
        ? `${day}T${time}`
        : day;
}
export function fullTime(value: string) {
  return validTemporal(value, 'time') ? (value.length === 5 ? `${value}:00` : value) : '00:00:00';
}
export function normalizeDirect(value: string, mode: TemporalFormat) {
  return mode === 'datetime-local' ? value.replace(' ', 'T') : value;
}
export function displayTemporal(value: string, mode: TemporalFormat) {
  return mode === 'datetime-local' ? value.replace('T', ' ') : value;
}
