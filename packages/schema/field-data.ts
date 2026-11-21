import { matchesFieldValue, matchesType, type FieldDefinition, type Json } from './types';

export function assignPath(target: Record<string, Json>, path: string[], value: Json) {
  let current = target;
  for (const key of path.slice(0, -1)) {
    if (!Object.hasOwn(current, key)) current[key] = {};
    current = current[key] as Record<string, Json>;
  }
  current[path.at(-1)!] = value;
}
export function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) =>
      current && typeof current === 'object' && Object.hasOwn(current, key)
        ? (current as Record<string, unknown>)[key]
        : undefined,
    value,
  );
}
/** Rows use normal nested business data. Internal identity never enters these objects. */
export function rowValues(fields: FieldDefinition[], input: unknown = {}): Record<string, Json> {
  if (!matchesType(input, 'object')) throw new Error('明细行必须是 JSON 对象');
  const visit = (object: Record<string, unknown>, prefix: string[] = []) => {
    for (const [key, value] of Object.entries(object)) {
      const path = [...prefix, key];
      const terminal = fields.find(
        (f) => f.path.length === path.length && f.path.every((p, i) => p === path[i]),
      );
      if (terminal) {
        if (!matchesFieldValue(value, terminal)) throw new Error(`字段 ${path.join('.')} 类型错误`);
      } else {
        if (
          !fields.some(
            (f) => path.length < f.path.length && path.every((p, i) => p === f.path[i]),
          ) ||
          !matchesType(value, 'object')
        )
          throw new Error(`未知或非法字段 ${path.join('.')}`);
        visit(value as Record<string, unknown>, path);
      }
    }
  };
  visit(input as Record<string, unknown>);
  return Object.fromEntries(
    fields.map((field) => {
      const value = readPath(input, field.path);
      return [field.id, structuredClone(value === undefined ? field.initial : value) as Json];
    }),
  );
}
