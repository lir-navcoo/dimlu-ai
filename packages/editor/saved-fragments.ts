/** Session metadata only; no captured schema or dependency payload is public. */
export const SAVED_FRAGMENT_NAME_LIMIT = 40;
export const SAVED_FRAGMENT_LIMIT = 20;

export interface SavedFragmentSummary {
  readonly id: string;
  readonly name: string;
  readonly sourcePageId: string;
  readonly sourcePageTitle: string;
  readonly rootCount: number;
  readonly nodeCount: number;
  readonly component?: string;
}

export interface SavedFragmentsSnapshot {
  readonly items: readonly Readonly<SavedFragmentSummary>[];
}

export function normalizeSavedFragmentName(input: string): string {
  if (typeof input !== 'string') throw new Error('片段名称必须是字符串');
  if (/[\u0000-\u001f\u007f\u0085\u2028\u2029]/.test(input))
    throw new Error('片段名称必须为单行，不能包含控制字符');
  const name = input.trim();
  if (!name) throw new Error('请输入片段名称');
  if (Array.from(name).length > SAVED_FRAGMENT_NAME_LIMIT)
    throw new Error(`片段名称不能超过 ${SAVED_FRAGMENT_NAME_LIMIT} 个字符`);
  return name;
}
