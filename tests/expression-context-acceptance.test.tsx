import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { registry } from '../src/materials';
import { PropertyPanel } from '../src/editor/Editor';
import { ActionChainEditor, ActionPanel } from '../src/editor/ActionPanel';
import { ExpressionContext } from '../src/editor/ExpressionContext';
import { bindingDraft, ValueInput } from '../src/editor/ValueEditor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { changeControl, closeActionConfig, openActionConfig } from './ui-helpers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const lit = (value: Json): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const loop = (item: string, index?: string): NonNullable<NodeSchema['repeat']> => ({
  items: lit([{ id: 'one' }]),
  item,
  ...(index ? { index } : {}),
  key: expr(`scope[${JSON.stringify(item)}].id`),
});
const localRegistry = {
  ...registry,
  components: {
    ...registry.components,
    'test.context-slot': {
      version: '1.0.0',
      props: {},
      slots: { body: ['slot-param', 'row'] },
    },
  },
};
function schema(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'context-acceptance',
    title: 'Context',
    entryPageId: 'page',
    dependencies: {
      components: {
        'ui.layout': '1.0.0',
        'ui.text': '1.0.0',
        'ui.button': '1.0.0',
        'test.context-slot': '1.0.0',
      },
      actions: { 'ui.notify': '1.0.0' },
    },
    pages: [
      {
        id: 'page',
        title: 'Page',
        state: [],
        children: [
          {
            id: 'outer',
            component: 'ui.layout',
            props: {},
            repeat: loop('row'),
            children: [
              {
                id: 'slot-host',
                component: 'test.context-slot',
                props: {},
                slots: {
                  body: {
                    params: ['slot-param', 'row'],
                    children: [
                      {
                        id: 'target',
                        component: 'ui.text',
                        props: { value: expr('"text"') },
                        style: { width: expr('100') },
                        repeat: loop('own', 'pos'),
                      },
                      {
                        id: 'button',
                        component: 'ui.button',
                        props: { label: lit('Run') },
                        on: {
                          onClick: [
                            {
                              id: 'notice',
                              action: 'ui.notify',
                              input: { title: expr('"notice"') },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
          { id: 'plain', component: 'ui.text', props: { value: expr('"plain"') } },
        ],
      },
      {
        id: 'second',
        title: 'Second',
        state: [],
        children: [
          { id: 'elsewhere', component: 'ui.text', props: { value: expr('"elsewhere"') } },
        ],
      },
    ],
  };
}
function make() {
  const doc = new EditorDocument(schema(), localRegistry);
  doc.select('page', 'target');
  return doc;
}
let session: ReturnType<typeof useEditorSession>;
function Host({ doc, actions = false }: { doc: EditorDocument; actions?: boolean }) {
  session = useEditorSession();
  const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const node = findNode(page, snapshot.selection.nodeId!)!.node;
  return actions ? (
    <ActionPanel key={`${page.id}/${node.id}`} document={doc} snapshot={snapshot} node={node} />
  ) : (
    <PropertyPanel document={doc} snapshot={snapshot} />
  );
}
function mount(doc: EditorDocument, actions = false) {
  return render(
    <TipProvider>
      <EditorSessionProvider>
        <Host doc={doc} actions={actions} />
      </EditorSessionProvider>
    </TipProvider>,
  );
}
const input = (label: string) =>
  screen.getByRole('textbox', { name: label }) as HTMLTextAreaElement;
const codes = (root: Element) =>
  [...root.querySelectorAll('code')]
    .map((el) => el.textContent)
    .filter((text) => text?.startsWith('scope['));
const propertyHelp = () => input('文本内容').closest('.property-field')!;
const styleHelp = () => input('宽度绑定').closest('.style-binding-editor')!;
const showStyle = () => fireEvent.click(screen.getByRole('tab', { name: '样式' }));
const expectedLocals = [
  'scope["row"]',
  'scope["index"]',
  'scope["slot-param"]',
  'scope["own"]',
  'scope["pos"]',
];
function passiveProbe(doc: EditorDocument) {
  const writes = vi.spyOn(session.drafts, 'write');
  const clears = vi.spyOn(session.drafts, 'clear');
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const publications = { document: 0, clipboard: 0, fragments: 0 };
  const stops = [
    doc.subscribe(() => publications.document++),
    doc.subscribeClipboard(() => publications.clipboard++),
    doc.subscribeSavedFragments(() => publications.fragments++),
  ];
  return {
    verify(documentCount: number) {
      expect(publications).toEqual({ document: documentCount, clipboard: 0, fragments: 0 });
      expect(writes).not.toHaveBeenCalled();
      expect(clears).not.toHaveBeenCalled();
      expect(storage).not.toHaveBeenCalled();
      stops.forEach((stop) => stop());
    },
  };
}

describe('042 independent actual expression entry contexts', () => {
  it('shows actual ancestor-slot-current repeat locals in the direct property editor without event', () => {
    const doc = make();
    mount(doc);
    expect(codes(propertyHelp())).toEqual(expectedLocals);
    expect(propertyHelp().textContent).toContain('sources');
    expect(propertyHelp().textContent).not.toMatch(/\bevent\b|scope\.row/);
    expect(input('文本内容').placeholder).toBe('请输入 JavaScript 表达式');
    expect(document.querySelector('[title]')).toBeNull();
  });
  it('shows actual committed locals in style expression binding and keeps its text local', () => {
    const doc = make();
    mount(doc);
    showStyle();
    expect(codes(styleHelp())).toEqual(expectedLocals);
    expect(styleHelp().textContent).not.toMatch(/\bevent\b/);
    const before = doc.exportJson();
    changeControl(input('宽度绑定'), 'scope["own"].');
    expect(doc.exportJson()).toBe(before);
    expect(input('宽度绑定').value).toBe('scope["own"].');
  });
  it('refreshes committed ancestor hints without resetting dirty property text, DOM identity or selection range', () => {
    const doc = make();
    mount(doc);
    changeControl(input('文本内容'), 'state.');
    const editor = input('文本内容');
    editor.focus();
    editor.setSelectionRange(2, 4);
    const probe = passiveProbe(doc);
    act(() => {
      doc.setNodeLogic('page', 'outer', { repeat: loop('renamed', 'ordinal') });
      doc.select('page', 'target');
    });
    expect(codes(propertyHelp())).toEqual([
      'scope["renamed"]',
      'scope["ordinal"]',
      'scope["slot-param"]',
      'scope["row"]',
      'scope["own"]',
      'scope["pos"]',
    ]);
    expect(input('文本内容')).toBe(editor);
    expect(editor.value).toBe('state.');
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 4]);
    expect(doc.getSnapshot().selection.nodeId).toBe('target');
    probe.verify(2);
  });
  it('refreshes committed ancestor style hints while preserving dirty binding and fallback editor caret', () => {
    const doc = make();
    mount(doc);
    showStyle();
    changeControl(input('宽度绑定'), 'state.');
    const editor = input('宽度绑定');
    editor.focus();
    editor.setSelectionRange(1, 3);
    const probe = passiveProbe(doc);
    act(() => {
      doc.setNodeLogic('page', 'outer', { repeat: loop('replacement', 'cursor') });
      doc.select('page', 'target');
    });
    expect(codes(styleHelp())).toContain('scope["replacement"]');
    expect(input('宽度绑定')).toBe(editor);
    expect(editor.value).toBe('state.');
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 3]);
    probe.verify(2);
  });
  it('refreshes selection and page contexts then restores the original property draft', () => {
    const doc = make();
    mount(doc);
    changeControl(input('文本内容'), 'scope["own"].');
    act(() => doc.select('page', 'plain'));
    expect(codes(propertyHelp())).toEqual([]);
    expect(propertyHelp().textContent).toContain('当前没有循环或插槽参数');
    act(() => doc.select('second', 'elsewhere'));
    expect(codes(propertyHelp())).toEqual([]);
    expect(input('文本内容').value).toBe('"elsewhere"');
    act(() => doc.select('page', 'target'));
    expect(codes(propertyHelp())).toEqual(expectedLocals);
    expect(input('文本内容').value).toBe('scope["own"].');
  });
  it('preserves same-node editor identity across empty/nonempty/empty committed local sets with zero extra writes', () => {
    const doc = make();
    doc.select('page', 'plain');
    mount(doc);
    changeControl(input('文本内容'), 'state.');
    const editor = input('文本内容');
    const probe = passiveProbe(doc);
    act(() => doc.setNodeLogic('page', 'plain', { repeat: loop('fresh') }));
    expect(codes(propertyHelp())).toEqual(['scope["fresh"]', 'scope["index"]']);
    expect(input('文本内容')).toBe(editor);
    expect(editor.value).toBe('state.');
    act(() => doc.setNodeLogic('page', 'plain', { repeat: undefined }));
    expect(codes(propertyHelp())).toEqual([]);
    expect(input('文本内容')).toBe(editor);
    expect(editor.value).toBe('state.');
    probe.verify(2);
  });
  it('keeps expression guidance absent in ordinary literal property and style modes', () => {
    const doc = make();
    doc.setProp('page', 'target', 'value', lit('fixed'));
    doc.setStyle('page', 'target', { width: lit(30) });
    mount(doc);
    expect(document.querySelector('.property-field .editor-note')).toBeNull();
    showStyle();
    fireEvent.click(screen.getByRole('button', { name: '宽度绑定设置' }));
    expect(document.querySelector('.style-binding-editor .editor-note')).toBeNull();
  });
  it('keeps component event guidance singular, safely scoped, and preserves invalid action draft on provider refresh', () => {
    const doc = make();
    doc.select('page', 'button');
    mount(doc, true);
    const notes = () =>
      [...document.querySelectorAll('.editor-note')].filter((node) =>
        node.textContent?.includes('sources'),
      );
    expect(notes()).toHaveLength(1);
    expect(notes()[0].textContent).toMatch(/\bevent\b/);
    expect(codes(notes()[0])).toEqual(['scope["row"]', 'scope["index"]', 'scope["slot-param"]']);
    openActionConfig(1);
    changeControl(input('title'), 'state.');
    const editor = input('title');
    const probe = passiveProbe(doc);
    act(() => {
      doc.setNodeLogic('page', 'outer', { repeat: loop('newrow') });
      doc.select('page', 'button');
    });
    expect(codes(notes()[0])).toContain('scope["newrow"]');
    expect(input('title')).toBe(editor);
    expect(editor.value).toBe('state.');
    probe.verify(2);
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      findNode(doc.getSnapshot().plan.pages.get('page')!.schema, 'button')!.node.on!.onClick[0]
        .input.title,
    ).toEqual(expr('"notice"'));
  });
  it('page entry guidance excludes event and locals even when an irrelevant scopes argument is supplied', () => {
    const page = schema().pages[0];
    const save = vi.fn();
    render(
      <TipProvider>
        <EditorSessionProvider>
          <ActionChainEditor
            page={page}
            existing={[]}
            draftKey="page-entry"
            scopes={['misleading']}
            pageScope
            saveLabel="保存页面进入动作"
            onSave={save}
          />
        </EditorSessionProvider>
      </TipProvider>,
    );
    const note = screen.getByText(/可用表达式：state \/ forms \/ sources/);
    expect(note.textContent).not.toMatch(/\bevent\b|scope\[|misleading/);
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps NodeLogic repeat.items outer-only and draft-derived locals separate from committed property guidance', () => {
    const doc = make();
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '逻辑' }));
    changeControl(screen.getByRole('textbox', { name: '记录变量' }), 'draftOnly');
    changeControl(screen.getByRole('textbox', { name: '索引变量' }), 'draftIndex');
    const outerNote = screen.getByText(/循环数据在外层作用域计算/);
    expect(outerNote.textContent).toContain('scope["slot-param"]');
    expect(outerNote.textContent).not.toMatch(/draftOnly|draftIndex|scope\["own"\]/);
    const localNote = screen.getByText(/可用作用域：/);
    expect(localNote.textContent).toContain('scope["draftOnly"]');
    expect(localNote.textContent).toContain('scope["draftIndex"]');
    fireEvent.click(screen.getByRole('tab', { name: '属性' }));
    expect(codes(propertyHelp())).toEqual(expectedLocals);
    fireEvent.click(screen.getByRole('tab', { name: '逻辑' }));
    expect((screen.getByRole('textbox', { name: '记录变量' }) as HTMLInputElement).value).toBe(
      'draftOnly',
    );
  });
});

describe('042 pure display edges and ValueInput compatibility', () => {
  it('deduplicates exact frozen caller names in lexical order and displays quoted aliases as plain code', () => {
    const names = Object.freeze(['row', 'a-b', 'quote"\\key', '行', 'row']);
    const view = render(<ExpressionContext scopeNames={names} eventAllowed={false} />);
    expect(codes(view.container)).toEqual([
      'scope["row"]',
      'scope["a-b"]',
      `scope[${JSON.stringify('quote"\\key')}]`,
      'scope["行"]',
    ]);
    expect(names).toEqual(['row', 'a-b', 'quote"\\key', '行', 'row']);
    expect(view.container.querySelectorAll('button,input,textarea,[title]')).toHaveLength(0);
    expect(view.container.textContent).not.toMatch(/\bevent\b|scope\.row/);
  });
  it('shows explicit empty locals and event only with the actual explicit capability', () => {
    const view = render(<ExpressionContext scopeNames={[]} eventAllowed={false} />);
    expect(view.container.textContent).toContain('当前没有循环或插槽参数');
    expect(view.container.textContent).not.toMatch(/\bevent\b/);
    view.rerender(<ExpressionContext scopeNames={[]} eventAllowed />);
    expect(view.container.textContent).toMatch(/\bevent\b/);
    expect(view.container.textContent).toContain('sources');
  });
  it('default expression ValueInput remains editable with a neutral placeholder and no invented helper', () => {
    const changed = vi.fn();
    const field = { type: 'json' as const };
    const draft = bindingDraft(expr('state.'), field);
    render(
      <TipProvider>
        <ValueInput
          label="独立表达式"
          page={schema().pages[0]}
          field={field}
          draft={draft}
          onChange={changed}
        />
      </TipProvider>,
    );
    expect(input('独立表达式').placeholder).toBe('请输入 JavaScript 表达式');
    expect(document.querySelector('.editor-note')).toBeNull();
    changeControl(input('独立表达式'), 'sources.people');
    expect(changed).toHaveBeenCalledWith({ ...draft, text: 'sources.people' });
  });
  it('pageScope overrides an accidental nonpage context without promising local/event names', () => {
    const field = { type: 'json' as const };
    const draft = bindingDraft(expr('state.'), field);
    render(
      <TipProvider>
        <ValueInput
          label="页面表达式"
          page={schema().pages[0]}
          field={field}
          draft={draft}
          onChange={vi.fn()}
          pageScope
          expressionContext={{ scopeNames: ['wrong'], eventAllowed: true }}
        />
      </TipProvider>,
    );
    expect(input('页面表达式').placeholder).toBe('例如 state.query 或 sources.people.data');
    expect(document.querySelector('.editor-note')).toBeNull();
    expect(document.body.textContent).not.toContain('scope["wrong"]');
  });
  it('optional presentation context updates never remount expression input or call onChange, and is absent in literal mode', () => {
    const field = { type: 'json' as const };
    const draft = bindingDraft(expr('state.'), field);
    const onChange = vi.fn();
    const props = { label: '连续编辑', page: schema().pages[0], field, draft, onChange };
    const view = render(
      <TipProvider>
        <ValueInput {...props} expressionContext={{ scopeNames: [], eventAllowed: false }} />
      </TipProvider>,
    );
    const editor = input('连续编辑');
    editor.focus();
    editor.setSelectionRange(1, 4);
    view.rerender(
      <TipProvider>
        <ValueInput {...props} expressionContext={{ scopeNames: ['added'], eventAllowed: false }} />
      </TipProvider>,
    );
    expect(input('连续编辑')).toBe(editor);
    expect(editor.value).toBe('state.');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([1, 4]);
    view.rerender(
      <TipProvider>
        <ValueInput {...props} />
      </TipProvider>,
    );
    expect(input('连续编辑')).toBe(editor);
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(
      <TipProvider>
        <ValueInput
          {...props}
          draft={bindingDraft(lit(3), field)}
          expressionContext={{ scopeNames: ['wrong'], eventAllowed: true }}
        />
      </TipProvider>,
    );
    expect(document.querySelector('.editor-note')).toBeNull();
  });
});
