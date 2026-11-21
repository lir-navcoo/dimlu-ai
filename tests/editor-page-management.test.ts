import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema, Json, PageSchema, Value } from '../packages/schema/types';
import { registry } from '../src/materials';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
function application(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'page-management-acceptance',
    title: '页面管理独立验收',
    entryPageId: 'a',
    dependencies: {
      components: Object.fromEntries(
        ['ui.layout', 'ui.form', 'ui.input', 'ui.text', 'ui.card', 'ui.button'].map((id) => [
          id,
          registry.components[id].version,
        ]),
      ),
      actions: {
        'ui.notify': registry.actions['ui.notify'].version,
        'form.reset': registry.actions['form.reset'].version,
      },
      transports: { 'demo.peopleQuery': registry.transports!['demo.peopleQuery'].version },
    },
    pages: [
      {
        id: 'a',
        title: '源页面',
        description: 'a 的原始定义',
        state: [
          { id: 'label', type: 'string', initial: 'a literal' },
          { id: 'rows', type: 'array', initial: [{ id: 'row-a', name: 'a' }] },
        ],
        forms: [
          {
            id: 'model',
            fields: [{ id: 'name', path: ['name'], label: '名称 a', type: 'string', initial: 'a' }],
            arrays: [
              {
                id: 'lines',
                path: ['lines'],
                label: '明细 a',
                fields: [
                  { id: 'quantity', path: ['quantity'], label: '数量', type: 'number', initial: 1 },
                ],
                initial: [{ quantity: 1 }],
              },
            ],
          },
        ],
        dataSources: [
          {
            id: 'people',
            kind: 'query',
            transport: 'demo.peopleQuery',
            input: { query: expression('state.label') },
            initial: {},
          },
        ],
        onEnter: [
          {
            id: 'enter-notice',
            action: 'ui.notify',
            input: { title: { kind: 'stateRef', stateId: 'label' } },
          },
        ],
        code: {
          enabled: false,
          language: 'tsx',
          source:
            'globalThis.__pageCloneProbe = "a";\nexport default () => <p data-page="a">a</p>;',
          css: '[data-page="a"]::before { content: "a"; }\n',
        },
        children: [
          {
            id: 'frame',
            component: 'ui.layout',
            props: {},
            children: [
              {
                id: 'form',
                component: 'ui.form',
                formId: 'model',
                props: {},
                children: [
                  {
                    id: 'input',
                    component: 'ui.input',
                    field: { formId: 'model', fieldId: 'name' },
                    props: {},
                  },
                ],
              },
              {
                id: 'repeat',
                component: 'ui.layout',
                props: {},
                repeat: {
                  items: { kind: 'stateRef', stateId: 'rows' },
                  item: 'item',
                  key: expression('scope.item.id'),
                },
                children: [
                  {
                    id: 'row-text',
                    component: 'ui.text',
                    props: { value: expression('scope.item.name') },
                  },
                ],
              },
              {
                id: 'card',
                component: 'ui.card',
                props: {},
                slots: {
                  footer: {
                    params: [],
                    children: [
                      {
                        id: 'footer-text',
                        component: 'ui.text',
                        props: { value: literal('a:state/model/people') },
                      },
                    ],
                  },
                },
              },
              {
                id: 'button',
                component: 'ui.button',
                props: { label: literal('a 的按钮') },
                on: {
                  onClick: [
                    {
                      id: 'reset-model',
                      action: 'form.reset',
                      input: { formId: literal('model') },
                    },
                  ],
                },
              },
            ],
          },
        ],
        extensions: {
          'test:author': { id: 'a', source: 'state.a', values: ['a', 'model', 'people'] },
        },
      },
      {
        id: 'b',
        title: '目标页面',
        state: [],
        children: [{ id: 'b-text', component: 'ui.text', props: { value: literal('b') } }],
      },
    ],
  };
}
const schemaOf = (document: EditorDocument) => document.getSnapshot().plan.schema;
const ids = (document: EditorDocument) => schemaOf(document).pages.map((page) => page.id);
const pageOf = (document: EditorDocument, id: string) =>
  document.getSnapshot().plan.pages.get(id)!.schema;

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__pageCloneProbe;
});

describe('page management atomic commands', () => {
  it('creates a trimmed blank page, appends it and selects it without business content', () => {
    const document = new EditorDocument(application(), registry);
    const dependencies = structuredClone(schemaOf(document).dependencies);
    const id = document.createPage('  新页面  ');
    expect(id).not.toBe('a');
    expect(id).not.toBe('b');
    expect(ids(document)).toEqual(['a', 'b', id]);
    expect(pageOf(document, id)).toEqual({ id, title: '新页面', state: [], children: [] });
    expect(document.getSnapshot().selection).toEqual({ pageId: id, nodeId: null });
    expect(schemaOf(document).entryPageId).toBe('a');
    expect(schemaOf(document).dependencies).toEqual(dependencies);
    const second = document.createPage('新页面');
    expect(second).not.toBe(id);
    expect(pageOf(document, second).title).toBe('新页面');
  });

  it('renames only the title and retains another page selection and all definition bytes', () => {
    const document = new EditorDocument(application(), registry);
    document.select('b', 'b-text');
    const before = structuredClone(pageOf(document, 'a'));
    expect(document.renamePage('a', '  已改名  ')).toBe(true);
    expect(pageOf(document, 'a')).toEqual({ ...before, title: '已改名' });
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'b-text' });
  });

  it('renames the application without changing pages, entry point, or selection', () => {
    const document = new EditorDocument(application(), registry);
    document.select('b', 'b-text');
    const before = structuredClone(schemaOf(document));
    expect(document.renameApplication('  采购平台  ')).toBe(true);
    expect(schemaOf(document)).toEqual({ ...before, title: '采购平台' });
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'b-text' });
    expect(document.renameApplication('采购平台')).toBe(false);
    expect(() => document.renameApplication('  ')).toThrow('应用名称不能为空');
  });

  it('sets and clears a page group without changing other page definition data', () => {
    const document = new EditorDocument(application(), registry);
    const before = structuredClone(pageOf(document, 'a'));
    expect(document.setPageGroup('a', '  采购  ')).toBe(true);
    expect(pageOf(document, 'a')).toEqual({
      ...before,
      extensions: { ...(before.extensions ?? {}), 'dimlu:editor': { group: '采购' } },
    });
    expect(document.setPageGroup('a', '')).toBe(true);
    expect(pageOf(document, 'a')).toEqual(before);
  });

  it('duplicates complete nested definitions while preserving page-local identities and literal/code bytes', () => {
    const document = new EditorDocument(application(), registry);
    const source = structuredClone(pageOf(document, 'a'));
    const dependencies = structuredClone(schemaOf(document).dependencies);
    const id = document.duplicatePage('a');
    expect(ids(document)).toEqual(['a', id, 'b']);
    expect(pageOf(document, id)).toEqual({ ...source, id, title: '源页面 副本' });
    expect(pageOf(document, id)).not.toBe(pageOf(document, 'a'));
    expect(pageOf(document, id).children).not.toBe(pageOf(document, 'a').children);
    expect(document.getSnapshot().selection).toEqual({ pageId: id, nodeId: 'frame' });
    expect(schemaOf(document).entryPageId).toBe('a');
    expect(schemaOf(document).dependencies).toEqual(dependencies);
    document.setProp(id, 'footer-text', 'value', literal('修改副本'));
    expect(pageOf(document, 'a')).toEqual(source);
    const explicit = document.duplicatePage('b', '  显式副本  ');
    expect(pageOf(document, explicit).title).toBe('显式副本');
    expect(document.getSnapshot().selection).toEqual({ pageId: explicit, nodeId: 'b-text' });
  });

  it('duplicates empty pages with null selected node', () => {
    const document = new EditorDocument(application(), registry);
    const empty = document.createPage('空页');
    const duplicate = document.duplicatePage(empty);
    expect(pageOf(document, duplicate).children).toEqual([]);
    expect(document.getSnapshot().selection).toEqual({ pageId: duplicate, nodeId: null });
  });

  it('moves to the final array index without changing entry or selected node', () => {
    const document = new EditorDocument(application(), registry);
    const third = document.createPage('第三页');
    document.select('b', 'b-text');
    expect(document.movePage('a', 2)).toBe(true);
    expect(ids(document)).toEqual(['b', third, 'a']);
    expect(document.movePage('a', 0)).toBe(true);
    expect(ids(document)).toEqual(['a', 'b', third]);
    expect(schemaOf(document).entryPageId).toBe('a');
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'b-text' });
  });

  it('sets entry explicitly without reordering pages or changing selection', () => {
    const document = new EditorDocument(application(), registry);
    document.select('a', 'footer-text');
    expect(document.setEntryPage('b')).toBe(true);
    expect(ids(document)).toEqual(['a', 'b']);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'footer-text' });
    expect(schemaOf(document).entryPageId).toBe('b');
  });

  it('deletes a selected nonentry page and selects the existing entry first node', () => {
    const document = new EditorDocument(application(), registry);
    document.select('b', 'b-text');
    expect(document.removePage('b')).toBe(true);
    expect(ids(document)).toEqual(['a']);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'frame' });
  });

  it('requires and applies explicit entry replacement, preserving another-page selection', () => {
    const document = new EditorDocument(application(), registry);
    document.select('b', 'b-text');
    expect(document.removePage('a', 'b')).toBe(true);
    expect(ids(document)).toEqual(['b']);
    expect(schemaOf(document).entryPageId).toBe('b');
    expect(document.getSnapshot().selection).toEqual({ pageId: 'b', nodeId: 'b-text' });
  });

  it('deleting selected entry uses replacement first node, including an empty replacement', () => {
    const document = new EditorDocument(application(), registry);
    const empty = document.createPage('空入口');
    document.select('a', 'footer-text');
    document.removePage('a', empty);
    expect(document.getSnapshot().selection).toEqual({ pageId: empty, nodeId: null });
    expect(schemaOf(document).entryPageId).toBe(empty);
  });

  it.each([
    ['create', (document: EditorDocument) => document.createPage('新页')],
    ['rename', (document: EditorDocument) => document.renamePage('a', '改名')],
    ['duplicate', (document: EditorDocument) => document.duplicatePage('a')],
    ['move', (document: EditorDocument) => document.movePage('a', 1)],
    ['entry', (document: EditorDocument) => document.setEntryPage('b')],
    ['delete entry', (document: EditorDocument) => document.removePage('a', 'b')],
    ['delete nonentry', (document: EditorDocument) => document.removePage('b')],
  ])('%s is one atomic undo/redo including order, entry and selection', (_name, command) => {
    const document = new EditorDocument(application(), registry);
    document.select('a', 'footer-text');
    const before = document.getSnapshot();
    command(document);
    const after = document.getSnapshot();
    expect(after.revision).toBe(before.revision + 1);
    document.undo();
    expect(schemaOf(document)).toEqual(before.plan.schema);
    expect(document.getSnapshot().selection).toEqual(before.selection);
    expect(document.getSnapshot().canUndo).toBe(false);
    document.redo();
    expect(schemaOf(document)).toEqual(after.plan.schema);
    expect(document.getSnapshot().selection).toEqual(after.selection);
  });

  it('leaves revision, redo and schema identity unchanged on normalized no-ops', () => {
    const document = new EditorDocument(application(), registry);
    document.renamePage('a', '临时标题');
    document.undo();
    const before = document.getSnapshot();
    expect(before.canRedo).toBe(true);
    expect(document.renamePage('a', '  源页面  ')).toBe(false);
    expect(document.movePage('a', 0)).toBe(false);
    expect(document.setEntryPage('a')).toBe(false);
    expect(document.getSnapshot()).toBe(before);
  });

  const failures: [string, (document: EditorDocument) => unknown][] = [
    ['empty create title', (document) => document.createPage('')],
    ['whitespace create title', (document) => document.createPage('  ')],
    ['nonstring create title', (document) => document.createPage(3 as unknown as string)],
    ['missing rename page', (document) => document.renamePage('missing', 'x')],
    ['empty rename title', (document) => document.renamePage('a', '  ')],
    ['missing duplicate page', (document) => document.duplicatePage('missing')],
    ['empty duplicate title', (document) => document.duplicatePage('a', '  ')],
    [
      'nonstring duplicate title',
      (document) => document.duplicatePage('a', null as unknown as string),
    ],
    ['missing moved page', (document) => document.movePage('missing', 0)],
    ['negative move index', (document) => document.movePage('a', -1)],
    ['end-exclusive move index', (document) => document.movePage('a', 2)],
    ['fractional move index', (document) => document.movePage('a', 0.5)],
    ['NaN move index', (document) => document.movePage('a', NaN)],
    ['unknown entry', (document) => document.setEntryPage('missing')],
    ['unknown removal target', (document) => document.removePage('missing')],
    ['entry requires replacement', (document) => document.removePage('a')],
    ['entry cannot replace itself', (document) => document.removePage('a', 'a')],
    ['unknown replacement', (document) => document.removePage('a', 'missing')],
    ['nonentry replacement forbidden', (document) => document.removePage('b', 'a')],
  ];
  it.each(failures)('rejects %s atomically even with redo history', (_name, command) => {
    const document = new EditorDocument(application(), registry);
    document.renamePage('b', '待撤销');
    document.undo();
    const before = document.getSnapshot();
    expect(() => command(document)).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
  });

  it('protects the last remaining page without any history mutation', () => {
    const document = new EditorDocument(application(), registry);
    document.removePage('b');
    const before = document.getSnapshot();
    expect(() => document.removePage('a')).toThrow();
    expect(() => document.removePage('a', 'a')).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });

  it('never reuses generated identity across deletion, undo and branching history', () => {
    const document = new EditorDocument(application(), registry);
    const first = document.createPage('未保存草稿所有者');
    document.undo();
    const branch = document.createPage('分支新页');
    expect(branch).not.toBe(first);
    document.removePage(branch);
    const later = document.createPage('再次新页');
    expect(new Set([first, branch, later]).size).toBe(3);
    const duplicate = document.duplicatePage('a');
    expect([first, branch, later, 'a', 'b']).not.toContain(duplicate);
  });

  it('seeds deterministic allocation from initial page identities', () => {
    const schema = application();
    schema.pages.push({ id: 'page-1', title: '已有编号', state: [], children: [] });
    const document = new EditorDocument(schema, registry);
    expect(document.createPage('新页')).toBe('page-2');
  });

  it.each(['undo', 'delete'] as const)(
    'reserves identities introduced only by a successful import after %s',
    (route) => {
      const document = new EditorDocument(application(), registry);
      const imported = structuredClone(schemaOf(document));
      imported.pages.push({ id: 'page-1', title: '导入身份', state: [], children: [] });
      expect(document.replace(imported)).toBe(true);
      if (route === 'undo') document.undo();
      else document.removePage('page-1');
      expect(ids(document)).not.toContain('page-1');
      expect(document.createPage('新页')).toBe('page-2');
    },
  );

  it('does not reserve identity from invalid titles or a failed imported plan', () => {
    const document = new EditorDocument(application(), registry);
    expect(() => document.createPage('  ')).toThrow();
    expect(() => document.duplicatePage('a', '  ')).toThrow();
    const invalid = structuredClone(schemaOf(document));
    invalid.pages.push({ id: 'page-1', title: '未提交身份', state: [], children: [] });
    invalid.entryPageId = 'missing';
    const before = document.getSnapshot();
    expect(() => document.replace(invalid)).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(document.createPage('合法新页')).toBe('page-1');
  });

  it('allows explicit import to restore a known identity without rewriting imported values', () => {
    const document = new EditorDocument(application(), registry);
    const generated = document.createPage('旧身份');
    document.undo();
    const imported = structuredClone(schemaOf(document));
    const restored: PageSchema = {
      id: generated,
      title: '显式恢复',
      state: [],
      children: [],
      extensions: { 'test:restored': generated },
    };
    imported.pages.push(restored);
    document.replace(imported);
    expect(pageOf(document, generated)).toEqual(restored);
    document.removePage(generated);
    expect(document.createPage('此后新身份')).not.toBe(generated);
  });

  it('does not compile/evaluate author code or execute query/mutation transports in any command', () => {
    const query = vi.spyOn(registry.transports!['demo.peopleQuery'], 'execute');
    const mutation = vi.spyOn(registry.transports!['demo.recordSave'], 'execute');
    const schema = application();
    schema.pages[0].code!.enabled = true;
    const document = new EditorDocument(schema, registry);
    const id = document.duplicatePage('a');
    document.renamePage(id, '变更');
    document.movePage(id, 0);
    document.setEntryPage(id);
    document.removePage(id, 'a');
    document.createPage('空白');
    expect(query).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
    expect((globalThis as Record<string, unknown>).__pageCloneProbe).toBeUndefined();
  });
});
