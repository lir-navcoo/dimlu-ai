import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema } from '../packages/schema/types';
import { registry } from '../src/materials';
import { CodePanel, ReactCodePanel } from '../src/code/CodePanel';
import { splitPageActionCode } from '../packages/runtime/page-action-code';
import { PageSettingsPanel } from '../src/editor/PageSettingsPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';

const schema = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'draft-test',
  title: 'Draft',
  entryPageId: 'one',
  dependencies: { components: {}, actions: {} },
  pages: ['one', 'two'].map((id) => ({ id, title: id, state: [], children: [] })),
});
function show(
  doc: EditorDocument,
  panel: 'react' | 'actions' = 'react',
  authoringAllowed = true,
) {
  function Panel() {
    const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot, doc.getSnapshot);
    return panel === 'react' ? (
      <ReactCodePanel key={snapshot.selection.pageId} document={doc} snapshot={snapshot} />
    ) : (
      <CodePanel
        key={snapshot.selection.pageId}
        document={doc}
        snapshot={snapshot}
        authoringAllowed={authoringAllowed}
      />
    );
  }
  return render(
    <TipProvider>
      <EditorSessionProvider>
        <Panel />
      </EditorSessionProvider>
    </TipProvider>,
  );
}
const text = () => screen.getByRole('textbox', { name: '页面 React 代码' }) as HTMLTextAreaElement;
const saved = (doc: EditorDocument, pageId = 'one') =>
  doc.getSnapshot().plan.pages.get(pageId)!.schema.code;
afterEach(() => {
  cleanup();
  delete (globalThis as Record<string, unknown>).__panelProbe;
});

describe('page code draft publication', () => {
  it('activates only the current page and does not leave its next page stuck validating', async () => {
    const doc = new EditorDocument(schema(), registry);
    function Panel() {
      const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
      return <PageSettingsPanel document={doc} snapshot={snapshot} authoringAllowed />;
    }
    render(
      <EditorSessionProvider>
        <TipProvider>
          <Panel />
        </TipProvider>
      </EditorSessionProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: '页面代码' }));
    fireEvent.click(screen.getByRole('button', { name: '启用页面代码' }));
    act(() => doc.selectPage('two'));
    const activate = screen.getByRole('button', { name: '启用页面代码' });
    expect(activate.hasAttribute('disabled')).toBe(false);
    fireEvent.click(activate);
    await waitFor(() => expect(saved(doc, 'two')?.enabled).toBe(true));
    expect(saved(doc)).toBeUndefined();
  });

  it.each(['enable', 'save'] as const)(
    'retires pending %s when preview is entered and permits a fresh edit afterward',
    async (operation) => {
      const doc = new EditorDocument(schema(), registry);
      const source = 'export default () => <p>Edited</p>;';
      function Panel({ allowed }: { allowed: boolean }) {
        const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
        return operation === 'enable' ? (
          <PageSettingsPanel document={doc} snapshot={snapshot} authoringAllowed={allowed} />
        ) : (
          <ReactCodePanel document={doc} snapshot={snapshot} authoringAllowed={allowed} />
        );
      }
      const tree = (allowed: boolean) => (
        <EditorSessionProvider>
          <TipProvider>
            <Panel allowed={allowed} />
          </TipProvider>
        </EditorSessionProvider>
      );
      const view = render(tree(true));
      const name = operation === 'enable' ? '启用页面代码' : '保存并应用';
      const submit = () => screen.getByRole('button', { name }) as HTMLButtonElement;
      if (operation === 'enable') fireEvent.click(screen.getByRole('tab', { name: '页面代码' }));
      else fireEvent.change(text(), { target: { value: source } });
      fireEvent.click(submit());
      expect(screen.getByRole('button', { name: '正在校验…' })).toBeTruthy();
      view.rerender(tree(false));
      expect(submit().disabled).toBe(true);
      if (operation === 'save') expect(text().readOnly).toBe(true);
      view.rerender(tree(true));
      await act(async () => {
        await import('../src/code/compiler');
      });
      expect(saved(doc)).toBeUndefined();
      expect(submit().disabled).toBe(false);
      fireEvent.click(submit());
      await waitFor(() => {
        if (operation === 'enable') expect(saved(doc)?.enabled).toBe(true);
        else expect(saved(doc)?.source).toBe(source);
      });
    },
  );

  it('shares TSX and CSS drafts between the canvas workspace and page settings', async () => {
    const doc = new EditorDocument(schema(), registry);
    doc.setPageCode('one', {
      enabled: true,
      language: 'tsx',
      source: 'export default () => <p>Original</p>;',
      css: '',
    });
    function Workspace() {
      const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
      return (
        <>
          <ReactCodePanel document={doc} snapshot={snapshot} variant="workspace" />
          <PageSettingsPanel document={doc} snapshot={snapshot} authoringAllowed />
        </>
      );
    }
    render(
      <EditorSessionProvider>
        <TipProvider>
          <Workspace />
        </TipProvider>
      </EditorSessionProvider>,
    );
    const source = 'export default () => <p>Updated</p>;';
    const css = 'p { color: red; }';
    fireEvent.change(text(), { target: { value: source } });
    fireEvent.click(screen.getByRole('tab', { name: 'CSS' }));
    fireEvent.change(screen.getByRole('textbox', { name: '页面 CSS' }), { target: { value: css } });
    expect(saved(doc)?.source).toContain('Original');
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    await waitFor(() => expect(saved(doc)).toEqual({ enabled: true, language: 'tsx', source, css }));
  });
  it('keeps the canvas workspace focused on TSX and CSS files', () => {
    const doc = new EditorDocument(schema(), registry);
    render(
      <EditorSessionProvider>
        <ReactCodePanel document={doc} snapshot={doc.getSnapshot()} variant="workspace" />
      </EditorSessionProvider>,
    );
    expect(screen.getByRole('tab', { name: 'TSX' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'CSS' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '启用页面代码' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存并应用' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '页面 React 代码' })).toBeTruthy();
  });
  it('includes a 16px margin in the default page-code CSS', () => {
    const doc = new EditorDocument(schema(), registry);
    render(
      <EditorSessionProvider>
        <ReactCodePanel document={doc} snapshot={doc.getSnapshot()} variant="workspace" />
      </EditorSessionProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'CSS' }));
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: '页面 CSS' }).value).toContain(
      '.page { margin: 16px;',
    );
  });
  it('exposes settings without mounting a second editor', () => {
    const doc = new EditorDocument(schema(), registry);
    render(
      <EditorSessionProvider>
        <ReactCodePanel
          document={doc}
          snapshot={doc.getSnapshot()}
          variant="settings"
          controlsOnly
        />
      </EditorSessionProvider>,
    );
    expect(screen.getByRole('checkbox', { name: '启用页面代码' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存并应用' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'TSX' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '页面 React 代码' })).toBeNull();
  });
  it('renders React code editing directly without a mode tab, keeping only action code in the panel', () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc, 'actions');
    expect(screen.queryByRole('tab', { name: 'React 页面代码' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '页面动作源码' })).toBeTruthy();
  });
  it('invalidates pending publication when a different document reuses the same page ID', async () => {
    const previous = new EditorDocument(schema(), registry);
    const next = new EditorDocument(schema(), registry);
    next.setPageCode('one', {
      enabled: false,
      language: 'tsx',
      source: 'export default () => <p>New document</p>;',
      css: '',
    });
    const view = render(
      <EditorSessionProvider>
        <ReactCodePanel document={previous} snapshot={previous.getSnapshot()} />
      </EditorSessionProvider>,
    );
    const draft = 'export default () => <p>Old pending draft</p>;';
    fireEvent.change(text(), { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    view.rerender(
      <EditorSessionProvider>
        <ReactCodePanel document={next} snapshot={next.getSnapshot()} />
      </EditorSessionProvider>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saved(previous)).toBeUndefined();
    expect(saved(next)?.source).toContain('New document');
    expect(text().value).toBe(draft);
    expect(screen.getByRole('button', { name: '确认使用草稿' })).toBeTruthy();
  });
  it('saves valid source without evaluating top-level code and supports disable/undo', async () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc);
    fireEvent.change(text(), {
      target: { value: 'globalThis.__panelProbe = true; export default () => <h1>Draft</h1>;' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '启用页面代码' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    await waitFor(() => expect(saved(doc)?.enabled).toBe(true));
    expect((globalThis as Record<string, unknown>).__panelProbe).toBeUndefined();
    const source = saved(doc)!.source;
    fireEvent.click(screen.getByRole('button', { name: '禁用代码' }));
    expect(saved(doc)?.enabled).toBe(false);
    expect(saved(doc)?.source).toBe(source);
    act(() => doc.undo());
    expect(saved(doc)?.enabled).toBe(true);
  });
  it('retains invalid drafts after errors and keeps document/history unchanged', async () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc);
    const before = doc.getSnapshot();
    fireEvent.change(text(), {
      target: { value: 'import X from "not-supported"; export default () => <p/>;' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    expect((await screen.findByRole('alert')).textContent).toContain('不支持导入模块');
    expect(doc.getSnapshot()).toBe(before);
    expect(text().value).toContain('not-supported');
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    expect(text().value).toContain('useState');
  });
  it('keeps per-page drafts separate and requires explicit stale replacement after Undo', async () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc);
    const first = 'export default () => <p>First saved</p>;';
    fireEvent.change(text(), { target: { value: first } });
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    await waitFor(() => expect(saved(doc)?.source).toBe(first));
    const draft = 'export default () => <p>Unsaved one</p>;';
    fireEvent.change(text(), { target: { value: draft } });
    act(() => doc.selectPage('two'));
    expect(text().value).toContain('useState');
    fireEvent.change(text(), { target: { value: 'export default () => <p>Unsaved two</p>;' } });
    act(() => doc.selectPage('one'));
    expect(text().value).toBe(draft);
    act(() => doc.undo());
    expect(text().value).toBe(draft);
    expect(screen.getByRole('button', { name: '保存并应用' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    await waitFor(() => expect(saved(doc)?.source).toBe(draft));
  });
  it('discards late compilation on page navigation, document changes or draft replacement', async () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc);
    const draft = 'export default () => <p>Late</p>;';
    fireEvent.change(text(), { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    act(() => doc.selectPage('two'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saved(doc)).toBeUndefined();
    expect(saved(doc, 'two')).toBeUndefined();
    act(() => doc.selectPage('one'));
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    fireEvent.change(text(), { target: { value: 'export default () => <p>New draft</p>;' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saved(doc)).toBeUndefined();
    expect(text().value).toContain('New draft');
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    act(() =>
      doc.setPageCode('two', {
        enabled: false,
        language: 'jsx',
        source: 'export default () => <p/>;',
        css: '',
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saved(doc)).toBeUndefined();
  });
});

describe('page action code authoring', () => {
  const actionSource = `export function greet(payload) {
  return payload.name;
}`;
  it('keeps preview action code read-only and cannot save through the panel', () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc, 'actions', false);
    const editor = actionEditor();
    expect(editor).toHaveProperty('readOnly', true);
    expect(screen.getByRole('button', { name: '保存动作代码' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(editor, { target: { value: 'export function blocked() {}' } });
    fireEvent.click(screen.getByRole('button', { name: '保存动作代码' }));
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode).toBeUndefined();
  });
  it('splits a saved source into per-action chunks including the export keyword', () => {
    const chunks = splitPageActionCode(
      `${actionSource}\n\nexport async function submit(payload) {\n  return this.greet(payload);\n}\n`,
    );
    expect(chunks.map((chunk) => chunk.name)).toEqual(['greet', 'submit']);
    expect(chunks[0].code).toBe(actionSource);
    expect(chunks[1].code).toContain('export async function submit(payload)');
    // 重写一个动作块并重组后仍可编译出同样的动作名集合
    const [first] = chunks;
    const rewritten = `export function greet(payload) {\n  return payload.name ?? '';\n}`;
    expect(
      splitPageActionCode(`${rewritten}\n\n${chunks[1].code}\n`).map((chunk) => chunk.name),
    ).toEqual(['greet', 'submit']);
    void first;
  });
  const actionEditor = () =>
    screen.getByRole('textbox', { name: '页面动作源码' }) as HTMLTextAreaElement;
  it('edits all actions in the same source editor and saves the combined source', () => {
    const doc = new EditorDocument(schema(), registry);
    doc.setPageActionCode('one', {
      source: `${actionSource}\n\nexport async function submit(payload) {\n  return payload;\n}`,
    });
    show(doc, 'actions');
    const editor = actionEditor();
    expect(screen.getAllByRole('textbox', { name: '页面动作源码' })).toHaveLength(1);
    expect(editor.value).toContain('export function greet');
    expect(editor.value).toContain('export async function submit');
    fireEvent.change(editor, {
      target: {
        value:
          'export function greet(payload) { return payload.name.toUpperCase(); }\n\nexport async function submit(payload) { return payload; }',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存动作代码' }));
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode?.source).toBe(editor.value);
  });
  it('keeps invalid syntax editable and allows repairing and saving it', () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc, 'actions');
    const editor = actionEditor();
    const broken = 'export function greet(payload) {';
    fireEvent.change(editor, { target: { value: broken } });
    expect(actionEditor().value).toBe(broken);
    fireEvent.click(screen.getByRole('button', { name: '保存动作代码' }));
    expect(screen.getByRole('alert').textContent).toContain('保存失败');
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode).toBeUndefined();
    const repaired = 'export function greet(payload) { return payload.name; }';
    fireEvent.change(actionEditor(), { target: { value: repaired } });
    fireEvent.click(screen.getByRole('button', { name: '保存动作代码' }));
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode?.source).toBe(repaired);
  });
  it('rejects unsupported source through document validation and keeps the draft', () => {
    const doc = new EditorDocument(schema(), registry);
    show(doc, 'actions');
    fireEvent.change(actionEditor(), {
      target: { value: 'export function formatName(payload) { return window.location.href; }' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存动作代码' }));
    expect(screen.getByRole('alert').textContent).toContain('宿主能力');
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode).toBeUndefined();
    expect(actionEditor().value).toContain('window.location.href');
  });
  it('deletes an action by editing the source directly and saves the result', () => {
    const doc = new EditorDocument(schema(), registry);
    doc.setPageActionCode('one', { source: actionSource });
    show(doc, 'actions');
    fireEvent.change(actionEditor(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存动作代码' }));
    expect(doc.getSnapshot().plan.pages.get('one')!.schema.actionCode).toBeUndefined();
  });
});
