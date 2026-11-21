import { SchemaError } from '../../packages/runtime/engine';

export function errorText(error: unknown): string {
  return error instanceof SchemaError
    ? error.issues.map((i) => `${i.path} · ${i.message}`).join('\n')
    : error instanceof Error
      ? error.message
      : String(error);
}
