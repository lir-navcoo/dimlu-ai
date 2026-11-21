import Ajv from 'ajv';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applicationJsonSchema } from '../packages/schema/schema';
import publishedSchema from '../public/schema/application.v0.1.json';
import { validateApplication } from '../packages/schema/validate';
import {
  NODE_NAME_EXTENSION,
  isCanonicalNodeName,
  normalizeNodeName,
  readNodeName,
} from '../packages/schema/node-name';
import { EditorDocument } from '../packages/editor/document';
import { ProjectStorage, PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';

const key = 'dimlu:node-name';
const valid = [
  'A',
  '采购筛选区',
  'A B',
  '😀'.repeat(80),
  '中'.repeat(80),
  '<script>alert(1)</script>',
  'a\u200bb',
  'a\u2028b',
];
const invalid: unknown[] = [
  '',
  ' ',
  ' leading',
  'trailing\n',
  'a\nb',
  'a\tb',
  'a\u0000b',
  'a\u007fb',
  '😀'.repeat(81),
  '中'.repeat(81),
  null,
  1,
  [],
  {},
  { name: 'name' },
];
const structural = new Ajv({ strict: false, allErrors: true }).compile(applicationJsonSchema);
afterEach(() => vi.useRealTimers());

describe('reserved node author name schema and canonical input boundary', () => {
  it.each([
    ['2028', '\u2028'],
    ['2029', '\u2029'],
  ])('trailing U+%s is invalid imported whitespace while commands trim it', (_code, separator) => {
    const value = `Name${separator}`;
    const schema = selectionApplication();
    schema.pages[0].children[0].extensions = { [key]: value };
    expect.soft(isCanonicalNodeName(value)).toBe(false);
    expect.soft(structural(schema)).toBe(false);
    expect
      .soft(
        validateApplication(schema, selectionRegistry()).some(
          (issue) => issue.path === '/pages/0/children/0/extensions/dimlu:node-name',
        ),
      )
      .toBe(true);
    expect.soft(() => new EditorDocument(schema, selectionRegistry())).toThrow();
    expect(normalizeNodeName(value)).toBe('Name');
  });
  it('generated public schema is exactly the approved runtime-validation shape', () => {
    expect(publishedSchema).toEqual(applicationJsonSchema);
  });
  it('reserves precisely one node extension key', () => expect(NODE_NAME_EXTENSION).toBe(key));
  it.each(valid)(
    'accepts literal canonical Unicode name %s in semantic and published shape',
    (value) => {
      const schema = selectionApplication();
      schema.pages[0].children[0].extensions = {
        [key]: value,
        'test:opaque': { nested: [1, 'root'] },
      };
      expect(isCanonicalNodeName(value)).toBe(true);
      expect(readNodeName(schema.pages[0].children[0])).toBe(value);
      expect(structural(schema)).toBe(true);
      expect(validateApplication(schema, selectionRegistry())).toEqual([]);
      const doc = new EditorDocument(schema, selectionRegistry());
      expect(JSON.parse(doc.exportJson()).pages[0].children[0].extensions).toEqual(
        schema.pages[0].children[0].extensions,
      );
    },
  );
  it.each(invalid)(
    'rejects imported noncanonical node name %j without coercion in both validators',
    (value) => {
      const schema = selectionApplication();
      schema.pages[0].children[0].extensions = { [key]: value as never };
      expect(isCanonicalNodeName(value)).toBe(false);
      expect(readNodeName(schema.pages[0].children[0])).toBeUndefined();
      expect(structural(schema)).toBe(false);
      const issues = validateApplication(schema, selectionRegistry());
      expect(
        issues.some((issue) => issue.path === '/pages/0/children/0/extensions/dimlu:node-name'),
      ).toBe(true);
      expect(() => new EditorDocument(schema, selectionRegistry())).toThrow();
    },
  );
  it.each(['\r\n  名称 😀 \t', '\u00a0名称 😀\u3000'])(
    'commands normalize external whitespace first: %j',
    (input) => {
      expect(normalizeNodeName(input)).toBe('名称 😀');
    },
  );
  it.each(['', ' \r\n\t', '\u3000\u00a0'])('empty canonical command %j means deletion', (input) => {
    expect(normalizeNodeName(input)).toBeUndefined();
  });
  it.each(['a\nb', 'a\u007fb', '😀'.repeat(81)])(
    'command rejects invalid interior or codepoint length',
    (input) => {
      expect(() => normalizeNodeName(input)).toThrow();
    },
  );
  it('does not reserve app/page versions of the same previously opaque key', () => {
    const schema = selectionApplication();
    schema.extensions = { [key]: { historical: true } };
    schema.pages[0].extensions = { [key]: ['still', 'opaque'] };
    expect(structural(schema)).toBe(true);
    expect(validateApplication(schema, selectionRegistry())).toEqual([]);
  });
  it('walks names inside deeply nested slots and reports the exact path', () => {
    const schema = selectionApplication();
    schema.pages[0].children[0].children![1].slots!.footer.children[0].children![0].extensions = {
      [key]: ' bad',
    };
    expect(
      validateApplication(schema, selectionRegistry()).some(
        (issue) =>
          issue.path ===
          '/pages/0/children/0/children/1/slots/footer/children/0/children/0/extensions/dimlu:node-name',
      ),
    ).toBe(true);
  });
  it('protects invalid persisted raw bytes while fallback edits stay in memory', () => {
    vi.useFakeTimers();
    const fallback = selectionApplication();
    const bad = structuredClone(fallback);
    bad.pages[0].children[0].extensions = { [key]: ' invalid ' };
    const raw = JSON.stringify({ storageVersion: 1, schema: bad });
    const values = new Map([[PROJECT_STORAGE_KEY, raw]]);
    const storage = {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: vi.fn((name: string, value: string) => {
        values.set(name, value);
      }),
    };
    const project = new ProjectStorage(storage, selectionRegistry(), fallback, { debounceMs: 1 });
    project.start();
    project.getSnapshot().document.setNodeName('a', 'alpha', 'Memory name');
    vi.runAllTimers();
    project.flush();
    project.stop();
    expect(project.getSnapshot()).toMatchObject({ protected: true, status: 'protected', raw });
    expect(values.get(PROJECT_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    project.start();
    project.confirmReplacement();
    expect(project.getSnapshot().protected).toBe(false);
    expect(
      JSON.parse(values.get(PROJECT_STORAGE_KEY)!).schema.pages[0].children[0].children[0]
        .extensions[key],
    ).toBe('Memory name');
    project.stop();
  });
});
