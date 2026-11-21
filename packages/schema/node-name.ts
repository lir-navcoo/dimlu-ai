import type { NodeSchema } from './types';

export const NODE_NAME_EXTENSION = 'dimlu:node-name';
export const NODE_NAME_MAX_LENGTH = 80;
// Shared with exported JSON Schema: canonical, nonempty and free of C0/DEL.
const canonicalPattern = '^(?!\\s)(?![\\s\\S]*[\\u0000-\\u001f\\u007f])[\\s\\S]*\\S$';
const canonical = new RegExp(canonicalPattern, 'u');
export const nodeNameJsonSchema = {
  type: 'string',
  minLength: 1,
  maxLength: NODE_NAME_MAX_LENGTH,
  pattern: canonicalPattern,
} as const;

export function isCanonicalNodeName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Array.from(value).length <= NODE_NAME_MAX_LENGTH &&
    canonical.test(value)
  );
}

/** Author commands normalize input; imported values must already be canonical. */
export function normalizeNodeName(input: string): string | undefined {
  if (typeof input !== 'string') throw new Error('编辑器名称必须为文本');
  const value = input.trim();
  if (!value) return undefined;
  if (!isCanonicalNodeName(value)) throw new Error('编辑器名称最多 80 个字符，不能包含控制字符');
  return value;
}

/** Defensive display read; Schema validation separately rejects malformed reserved values. */
export function readNodeName(node: Pick<NodeSchema, 'extensions'>): string | undefined {
  const value = node.extensions?.[NODE_NAME_EXTENSION];
  return isCanonicalNodeName(value) ? value : undefined;
}
