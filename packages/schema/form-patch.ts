import { readPath, rowValues } from './field-data';
import { matchesFieldValue, matchesType, type FormDefinition, type Json } from './types';

/** Shared by schema validation and runtime; preparation never changes the model. */
export function prepareFormPatch(definition: FormDefinition, input: unknown) {
  const arrays = definition.arrays ?? [];
  const descriptors = [...definition.fields, ...arrays];
  if (!matchesType(input, 'object')) throw new Error('回填数据必须是 JSON 对象');
  const checkPaths = (object: Record<string, unknown>, prefix: string[] = []) => {
    for (const [key, value] of Object.entries(object)) {
      const path = [...prefix, key];
      const terminal = descriptors.find(
        (field) => field.path.length === path.length && field.path.every((p, i) => p === path[i]),
      );
      if (terminal) {
        if ('fields' in terminal ? !Array.isArray(value) : !matchesFieldValue(value, terminal))
          throw new Error(`字段 ${path.join('.')} 类型错误`);
      } else {
        if (
          !descriptors.some(
            (field) => path.length < field.path.length && path.every((p, i) => p === field.path[i]),
          ) ||
          !matchesType(value, 'object')
        )
          throw new Error(`未知或非法字段 ${path.join('.')}`);
        checkPaths(value as Record<string, unknown>, path);
      }
    }
  };
  checkPaths(input as Record<string, unknown>);
  return {
    fields: Object.fromEntries(
      definition.fields
        .filter((field) => readPath(input, field.path) !== undefined)
        .map((field) => [field.id, structuredClone(readPath(input, field.path)) as Json]),
    ),
    arrays: arrays
      .filter((array) => readPath(input, array.path) !== undefined)
      .map((array) => ({
        array,
        rows: (readPath(input, array.path) as Json[]).map((value) =>
          rowValues(array.fields, value),
        ),
      })),
  };
}
