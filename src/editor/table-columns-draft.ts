import { isJson, type Json } from '../../packages/schema/types';
import { dataContracts } from '../materials/data';

export type ColumnRow = {
  rowId: string;
  original: Record<string, Json>;
  edits: Partial<Record<'key' | 'title' | 'width' | 'sortable' | 'align', string>>;
};
export type ColumnContent =
  { kind: 'rows'; rows: ColumnRow[]; nextRowId: number } | { kind: 'json'; text: string };
export type ColumnsDraft = { content: ColumnContent; error: string };

export function columnValueErrors(value: unknown): string[] {
  if (!isJson(value)) return ['表格列必须是有效的 JSON 值'];
  return dataContracts['ui.table'].validateProps!({ columns: value }, {});
}

/** A format capability check, never a replacement for runtime validity. */
export function canRepresentColumns(value: unknown): value is Record<string, Json>[] {
  return (
    !columnValueErrors(value).length &&
    (value as Record<string, Json>[]).every(
      (column) =>
        column.align === undefined ||
        (typeof column.align === 'string' && ['left', 'center', 'right'].includes(column.align)),
    )
  );
}

export function rowsForColumns(value: Record<string, Json>[]): ColumnContent {
  return {
    kind: 'rows',
    rows: value.map((original, index) => ({
      rowId: `source:${index}`,
      original: { ...original },
      edits: {},
    })),
    nextRowId: 1,
  };
}

export function initialColumnsDraft(value: Json | undefined): ColumnsDraft {
  return {
    content: canRepresentColumns(value)
      ? rowsForColumns(value)
      : { kind: 'json', text: JSON.stringify(value, null, 2) ?? '' },
    error: '',
  };
}

export function columnField(row: ColumnRow, field: keyof ColumnRow['edits']): string {
  const edit = row.edits[field];
  if (edit !== undefined) return edit;
  const original = row.original[field];
  return original === undefined ? '' : String(original);
}

/** Copy every own JSON key, including __proto__, then change only explicit controls. */
export function materializeColumn(row: ColumnRow): Record<string, Json> {
  const result = { ...row.original };
  for (const field of ['key', 'title', 'width', 'sortable', 'align'] as const) {
    const edit = row.edits[field];
    if (edit === undefined) continue;
    if (field === 'key' || field === 'title') result[field] = edit;
    else if (!edit.trim()) delete result[field];
    else if (field === 'width') {
      const width: unknown = (() => {
        try {
          return JSON.parse(edit);
        } catch {
          return undefined;
        }
      })();
      if (typeof width !== 'number' || !Number.isFinite(width))
        throw new Error('列宽需为有效数字，清空可取消设置');
      result.width = width;
    } else if (field === 'sortable') {
      if (edit !== 'true' && edit !== 'false') throw new Error('排序需为未设置、开启或关闭');
      result.sortable = edit === 'true';
    } else result.align = edit;
  }
  return result;
}

export function materializeColumns(content: ColumnContent): Json {
  return content.kind === 'json' ? JSON.parse(content.text) : content.rows.map(materializeColumn);
}
