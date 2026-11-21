import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema } from '../packages/schema/types';
import { registry } from '../src/materials';
import { CodePanel } from '../src/code/CodePanel';
import { EditorSessionProvider } from '../src/editor/session';

const schema = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'draft-test',
  title: 'Draft',
  entryPageId: 'one',
  dependencies: { components: {}, actions: {} },
  pages: ['one', 'two'].map((id) => ({ id, title: id, state: [], children: [] })),
});
function show(doc: EditorDocument) {
  function Panel() {
    const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot, doc.getSnapshot);
    return <CodePanel key={snapshot.selection.pageId} document={doc} snapshot={snapshot} />;
  }
  return render(
    <EditorSessionProvider>
      <Panel />
    </EditorSessionProvider>,
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
        <CodePanel document={previous} snapshot={previous.getSnapshot()} />
      </EditorSessionProvider>,
    );
    const draft = 'export default () => <p>Old pending draft</p>;';
    fireEvent.change(text(), { target: { value: draft } });
    fireEvent.click(screen.getByRole('button', { name: '保存并应用' }));
    view.rerender(
      <EditorSessionProvider>
        <CodePanel document={next} snapshot={next.getSnapshot()} />
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
