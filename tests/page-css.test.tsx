import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { assertPageStyleSource, scopePageStyleSource } from '../packages/schema/page-style-source';
import type { ApplicationSchema } from '../packages/schema/types';
import { ApplicationRuntimeHost } from '../src/ApplicationRuntimeHost';
import { EditorCanvas } from '../src/editor/Canvas';
import { PageSettingsPanel } from '../src/editor/PageSettingsPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { materials, registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';

const source = ':root { background-color: rgb(201, 211, 221); } p { color: rgb(11, 22, 33); }';
const scope = '[data-page-style="test"]';
const schema = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'page-css-test',
  title: '页面 CSS 测试',
  entryPageId: 'one',
  dependencies: { components: { 'ui.text': registry.components['ui.text'].version }, actions: {} },
  pages: ['one', 'two'].map((id) => ({
    id,
    title: id,
    state: [],
    children: [{ id, component: 'ui.text', props: { value: { kind: 'literal', value: id } } }],
  })),
});
const sheetFor = (root: Element) =>
  [...root.ownerDocument.head.querySelectorAll('style')].find((style) =>
    style.textContent?.includes(`[data-page-style="${root.getAttribute('data-page-style')}"]`),
  );
const pageRoot = (text: string) => screen.getByText(text).closest('[data-page-style]')!;

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/editor');
});

describe('ordinary page CSS', () => {
  it('scopes comma lists, functional selectors, root aliases, and CSS variables', () => {
    expect(
      scopePageStyleSource(
        ':root:hover, body > .grid, .card:is(.a,.b), [data-label="a,b"], * { --accent: red; color: var(--accent); }',
        scope,
      ),
    ).toBe(
      `${scope}:hover, ${scope} > .grid, ${scope} .card:is(.a,.b), ${scope} [data-label="a,b"], ${scope} * { --accent: red; color: var(--accent); }`,
    );
  });

  it.each([
    '@import "https://example.test/theme.css";',
    ':root + .outside { color: red; }',
    'body:hover ~ .outside { color: red; }',
    'html body { color: red; }',
    '.card { & > p { color: red; } }',
    '.card, { color: red; }',
    '.card { background: url("https://example.test/image"); }',
    '.card { background: image-set("https://example.test/image" 1x); }',
    '.card { --image: u\\72l("https://example.test/image"); }',
    '.card { color: var(--image, url("https://example.test/image")); }',
  ])('rejects unsupported CSS: %s', (css) => {
    expect(() => assertPageStyleSource(css)).toThrow();
  });

  it('keeps invalid saves out of history and allows clearing and undoing a valid save', () => {
    const doc = new EditorDocument(schema(), registry);
    const initial = doc.getSnapshot();
    expect(() => doc.setPageCss('one', ':root + p { color: red; }')).toThrow();
    expect(doc.getSnapshot()).toBe(initial);
    doc.setPageCss('one', source);
    expect(doc.getSnapshot().plan.schema.pages[0].css).toBe(source);
    doc.setPageCss('one', '  ');
    expect(doc.getSnapshot().plan.schema.pages[0].css).toBeUndefined();
    doc.undo();
    expect(doc.getSnapshot().plan.schema.pages[0].css).toBe(source);
    doc.undo();
    expect(doc.getSnapshot().plan.schema.pages[0].css).toBeUndefined();
  });

  it('supports keyboard navigation and associated panels in page settings tabs', () => {
    const doc = new EditorDocument(schema(), registry);
    const snapshot = doc.getSnapshot();
    render(
      <EditorSessionProvider>
        <TipProvider>
          <PageSettingsPanel document={doc} snapshot={snapshot} authoringAllowed />
        </TipProvider>
      </EditorSessionProvider>,
    );

    const logic = screen.getByRole('tab', { name: '页面逻辑' });
    const css = screen.getByRole('tab', { name: '页面 CSS' });
    const code = screen.getByRole('tab', { name: '页面代码' });
    expect(logic.getAttribute('tabindex')).toBe('0');
    expect(css.getAttribute('tabindex')).toBe('-1');
    expect(code.getAttribute('tabindex')).toBe('-1');
    expect(logic.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.getByRole('tabpanel', { name: '页面逻辑' })).toBeTruthy();

    fireEvent.keyDown(logic, { key: 'ArrowRight' });
    expect(css.getAttribute('tabindex')).toBe('0');
    expect(logic.getAttribute('aria-selected')).toBe('true');
    expect(css.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(css);
    expect(css.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: '页面 CSS' })).toBeTruthy();
    expect(css.getAttribute('aria-controls')).toBe(
      screen.getByRole('tabpanel', { name: '页面 CSS' }).id,
    );
  });

  it('keeps drafts separate from canvas styles across tabs and pages; saves without React code', () => {
    const doc = new EditorDocument(schema(), registry);
    function Panel({ allowed }: { allowed: boolean }) {
      const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
      return <PageSettingsPanel document={doc} snapshot={snapshot} authoringAllowed={allowed} />;
    }
    const tree = (allowed: boolean) => (
      <EditorSessionProvider>
        <TipProvider>
          <Panel allowed={allowed} />
        </TipProvider>
      </EditorSessionProvider>
    );
    const view = render(tree(true));
    const tab = (name: string) => screen.getByRole('tab', { name });
    const editor = () =>
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: '普通页面 CSS 源码' });
    const save = () => screen.getByRole<HTMLButtonElement>('button', { name: '保存页面 CSS' });
    fireEvent.click(tab('页面 CSS'));
    expect(editor().value).toBe(':root {\n}');
    expect(editor().placeholder).toBe('');
    expect(save().disabled).toBe(true);
    fireEvent.change(editor(), { target: { value: '@import "theme.css";' } });
    fireEvent.click(save());
    expect(screen.getByRole('alert').textContent).toContain('暂不支持 @ 规则');
    fireEvent.change(editor(), { target: { value: source } });
    expect(doc.getSnapshot().plan.schema.pages[0].css).toBeUndefined();
    fireEvent.click(tab('页面逻辑'));
    fireEvent.click(tab('页面 CSS'));
    expect(editor().value).toBe(source);
    act(() => doc.selectPage('two'));
    expect(editor().value).toBe(':root {\n}');
    act(() => doc.selectPage('one'));
    expect(editor().value).toBe(source);
    view.rerender(tree(false));
    expect(editor().readOnly).toBe(true);
    expect(save().disabled).toBe(true);
    view.rerender(tree(true));
    fireEvent.click(save());
    expect(doc.getSnapshot().plan.schema.pages[0]).toMatchObject({ css: source });
    expect(doc.getSnapshot().plan.schema.pages[0].code).toBeUndefined();
  });

  it.each(['edit', 'preview'] as const)(
    'applies saved styles inside the %s canvas only',
    (mode) => {
      const doc = new EditorDocument(schema(), registry);
      doc.setPageCss('one', source);
      const snapshot = doc.getSnapshot();
      const runtime = new PageRuntime(snapshot.plan, 'one');
      const view = render(
        <EditorSessionProvider>
          <TipProvider>
            <EditorCanvas document={doc} snapshot={snapshot} runtime={runtime} mode={mode}>
              <p data-testid="editor-control">编辑器界面</p>
            </EditorCanvas>
          </TipProvider>
        </EditorSessionProvider>,
      );
      const root = pageRoot('one');
      const sheet = sheetFor(root);
      expect(root.closest('.editor-surface')).toBeTruthy();
      expect(root.contains(screen.getByTestId('editor-control'))).toBe(false);
      expect(getComputedStyle(root).backgroundColor).toBe('rgb(201, 211, 221)');
      expect(sheet).toBeTruthy();
      view.unmount();
      expect(sheet?.isConnected).toBe(false);
      runtime.dispose();
    },
  );

  it('isolates simultaneous runtimes for the same page and skips custom React views', () => {
    const input = schema();
    input.pages[0].css = source;
    const plan = compileApplication(input, registry);
    const one = new PageRuntime(plan, 'one');
    const two = new PageRuntime(plan, 'one');
    const view = render(
      <>
        <RuntimeRenderer runtime={one} materials={materials} />
        <RuntimeRenderer runtime={two} materials={materials} />
        <RuntimeRenderer runtime={two} materials={materials}>
          <p>自定义视图</p>
        </RuntimeRenderer>
      </>,
    );
    const first = screen.getAllByText('one')[0].closest('[data-page-style]')!;
    const second = screen.getAllByText('one')[1].closest('[data-page-style]')!;
    expect(first.getAttribute('data-page-style')).not.toBe(second.getAttribute('data-page-style'));
    expect(sheetFor(first)).not.toBe(sheetFor(second));
    expect(screen.getByText('自定义视图').closest('[data-page-style]')).toBeNull();
    view.unmount();
    one.dispose();
    two.dispose();
  });

  it('removes the previous page stylesheet when navigating in the application host', () => {
    const input = schema();
    input.pages[0].css = source;
    window.history.replaceState({}, '', '/apps/page-css-test');
    const view = render(<ApplicationRuntimeHost plan={compileApplication(input, registry)} />);
    const first = view.container.querySelector('[data-page-style]')!;
    const sheet = sheetFor(first);
    expect(sheet).toBeTruthy();
    expect(getComputedStyle(first).backgroundColor).toBe('rgb(201, 211, 221)');
    fireEvent.change(screen.getByRole('combobox', { name: '切换应用页面' }), {
      target: { value: 'two' },
    });
    expect(view.container.querySelector('[data-page-style]')).toBeNull();
    expect(sheet?.isConnected).toBe(false);
  });
});
