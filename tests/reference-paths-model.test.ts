import { describe, expect, it } from 'vitest';
import type { Json } from '../packages/schema/types';
import { initialReferencePaths } from '../src/editor/ReferencePaths';
import { bindingDraft, parseBinding } from '../src/editor/ValueEditor';

describe('saved initial reference path discovery', () => {
  it('preserves exact special and empty keys, falsy values and array leaves', () => {
    const input = {
      'first.name': { '': { 'quote"[]/汉': 'chosen' } },
      list: [{ child: 'never guessed' }],
      zero: 0,
      false: false,
      empty: '',
      null: null,
    };
    expect(initialReferencePaths(input)).toEqual({
      paths: [
        [],
        ['first.name'],
        ['first.name', ''],
        ['first.name', '', 'quote"[]/汉'],
        ['list'],
        ['zero'],
        ['false'],
        ['empty'],
        ['null'],
      ].map((path) => JSON.stringify(path)),
      truncated: false,
    });
    for (const value of [null, false, 0, '', {}, []] satisfies Json[])
      expect(initialReferencePaths(value)).toEqual({ paths: ['[]'], truncated: false });
  });

  it('bounds visited entries including the root and preserves deterministic prefixes', () => {
    const input = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`key${i}`, i]));
    const result = initialReferencePaths(input);
    expect(result.paths).toEqual(['[]', ...Array.from({ length: 127 }, (_, i) => `["key${i}"]`)]);
    expect(result.truncated).toBe(true);
    expect(
      initialReferencePaths(Object.fromEntries(Object.entries(input).slice(0, 127))).truncated,
    ).toBe(false);
  });

  it('keeps depth five selectable while deeper manual paths stay valid', () => {
    const input = { a: { b: { c: { d: { e: { f: 'deep' } } } } } };
    const result = initialReferencePaths(input);
    expect(result.paths.at(-1)).toBe('["a","b","c","d","e"]');
    expect(result.paths).toHaveLength(6);
    expect(result.truncated).toBe(true);
    const draft = bindingDraft(
      { kind: 'dataRef', sourceId: 'saved', path: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { type: 'json' },
    );
    expect(parseBinding(draft, { type: 'json' })).toEqual({
      kind: 'dataRef',
      sourceId: 'saved',
      path: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
  });

  it('enforces exact per-path and aggregate serialized UTF16 budgets', () => {
    const boundary = '汉'.repeat(2044);
    expect(initialReferencePaths({ [boundary]: 1 }).paths.at(-1)?.length).toBe(2048);
    expect(initialReferencePaths({ [boundary + 'x']: 1, usable: 0 })).toEqual({
      paths: ['[]', '["usable"]'],
      truncated: true,
    });
    const input = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`${i}${'x'.repeat(1900)}`, 0]),
    );
    const result = initialReferencePaths(input);
    expect(result.truncated).toBe(true);
    expect(result.paths.length).toBeGreaterThan(2);
    expect(result.paths.length).toBeLessThan(31);
    const used = result.paths.reduce((sum, path) => sum + path.length, 0);
    expect(used).toBeLessThanOrEqual(32768);
    expect(
      used + JSON.stringify([Object.keys(input)[result.paths.length - 1]]).length,
    ).toBeGreaterThan(32768);
  });

  it('excludes reserved and inherited keys in helper-only adversarial input', () => {
    // Not a valid application Schema: this independently checks defensive discovery.
    const input = Object.assign(
      Object.create({ inherited: 'hidden' }),
      JSON.parse('{"__proto__":{},"constructor":{},"prototype":{},"safe":false}'),
    ) as Json;
    expect(initialReferencePaths(input)).toEqual({ paths: ['[]', '["safe"]'], truncated: false });
  });

  it('distinguishes an explicit root from an unspecified path without changing manual parsing', () => {
    const field = { type: 'json' } as const;
    const draft = bindingDraft({ kind: 'dataRef', sourceId: 'saved' }, field);
    expect(draft.path).toBe('');
    expect(parseBinding(draft, field)).toEqual({ kind: 'dataRef', sourceId: 'saved' });
    expect(parseBinding({ ...draft, path: '[]' }, field)).toEqual({
      kind: 'dataRef',
      sourceId: 'saved',
      path: [],
    });
    expect(() => parseBinding({ ...draft, path: '[' }, field)).toThrow();
  });
});
