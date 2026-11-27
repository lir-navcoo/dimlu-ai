import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlateEditor } from 'platejs/react';
import { RichTextDisplayMaterial, RichTextMaterial } from '../src/materials/rich-text';
import { extendedCatalog } from '../src/editor/extended-catalog';

const probe = vi.hoisted(() => ({ editor: undefined as PlateEditor | undefined }));
vi.mock('platejs/react', async (importOriginal) => {
  const plate = await importOriginal<typeof import('platejs/react')>();
  return {
    ...plate,
    usePlateEditor: (...args: Parameters<typeof plate.usePlateEditor>) => {
      const editor = plate.usePlateEditor(...args);
      probe.editor = editor ?? undefined;
      return editor;
    },
  };
});

afterEach(cleanup);

describe('Plate rich text material', () => {
  it('renders the Plate editor with formatting tools and keeps the HTML field value', () => {
    render(<RichTextMaterial label="正文" value="<p>你好 Plate</p>" />);
    const toolbar = screen.getByRole('toolbar', { name: '富文本格式工具栏' });
    const editor = screen.getByRole('textbox', { name: '正文' });
    expect(toolbar).toBeTruthy();
    expect(toolbar.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((document.querySelector('input[type="hidden"]') as HTMLInputElement).value).toBe(
      '<p>你好 Plate</p>',
    );
  });

  it('publishes text edits as HTML rather than Slate editing markup', async () => {
    const changed = vi.fn();
    render(<RichTextMaterial label="正文" value="<p>hello</p>" onValueChange={changed} />);
    const editor = probe.editor!;
    act(() => {
      editor.tf.select({ anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 5 } });
      editor.tf.insertText('world');
    });
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const template = document.createElement('template');
    template.innerHTML = changed.mock.lastCall![0];
    expect(template.content.textContent).toBe('world');
    expect(template.content.querySelector('[data-slate-node]')).toBeNull();
  });

  it('exposes real mark, block, list, and history actions', () => {
    render(<RichTextMaterial label="正文" value="<p>你好 Plate</p>" />);
    const editor = screen.getByRole('textbox', { name: '正文' });
    const actions = [
      '撤销',
      '重做',
      '粗体',
      '斜体',
      '下划线',
      '删除线',
      '行内代码',
      '高亮',
      '下标',
      '上标',
      '标题 1',
      '标题 2',
      '标题 3',
      '引用',
      '无序列表',
      '有序列表',
    ];
    expect(actions).toHaveLength(16);
    for (const label of actions) {
      const button = screen.getByRole('button', { name: label });
      expect((button as HTMLButtonElement).disabled).toBe(false);
      fireEvent.mouseDown(button);
      fireEvent.click(button);
    }
    expect(editor.textContent).toContain('你好 Plate');
    expect((document.querySelector('input[type="hidden"]') as HTMLInputElement).value).toBe(
      '<p>你好 Plate</p>',
    );
  });

  it('applies italic to a real selection and serializes semantic emphasis HTML', async () => {
    const changed = vi.fn();
    render(<RichTextMaterial label="正文" value="<p>italic text</p>" onValueChange={changed} />);
    const editor = probe.editor!;
    act(() => {
      editor.tf.select({ anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 6 } });
    });
    fireEvent.mouseDown(screen.getByRole('button', { name: '斜体' }));
    fireEvent.click(screen.getByRole('button', { name: '斜体' }));
    await waitFor(() => expect(changed).toHaveBeenCalled());
    const output = changed.mock.lastCall![0] as string;
    expect(output).toMatch(/<(em|i)[^>]*>[\s\S]*?italic[\s\S]*?<\/(em|i)>/);
    expect((editor.children[0] as { children: Array<{ italic?: boolean; text: string }> }).children[0]).toEqual({
      italic: true,
      text: 'italic',
    });
  });

  it('preserves link and image HTML until an editor change is made', () => {
    render(
      <RichTextMaterial
        label="正文"
        value='<p><a href="https://example.test/page">原链接</a><img src="https://example.test/image.png" alt="示意"> 原文</p>'
      />,
    );
    const serialized = (document.querySelector('input[type="hidden"]') as HTMLInputElement).value;
    expect(serialized).toContain('<a href="https://example.test/page">');
    expect(serialized).toContain('<img src="https://example.test/image.png" alt="示意">');
  });

  it('round-trips safe links and images inside legacy lists after editing', async () => {
    const changed: string[] = [];
    render(
      <RichTextMaterial
        label="正文"
        value='<ul><li><a href="https://example.test/item" data-slate-type="hostile" onclick="bad()">条目</a><img src="https://example.test/item.png" alt="条目图"></li></ul>'
        onValueChange={(next) => changed.push(next)}
      />,
    );
    const editor = probe.editor!;
    const [text, path] = [...editor.api.nodes({ at: [0], match: (node) => 'text' in node })].find(
      ([node]) => typeof node.text === 'string' && node.text.includes('条目'),
    )!;
    act(() => {
      editor.tf.select({
        anchor: { path, offset: 0 },
        focus: { path, offset: String(text.text).length },
      });
    });
    fireEvent.mouseDown(screen.getByRole('button', { name: '粗体' }));
    fireEvent.click(screen.getByRole('button', { name: '粗体' }));
    await waitFor(() => expect(changed.length).toBeGreaterThan(0));
    const serialized = changed.at(-1)!;
    expect(serialized).toContain('href="https://example.test/item"');
    expect(serialized).toContain('src="https://example.test/item.png"');
    expect(serialized).toContain('alt="条目图"');
    expect(serialized).not.toMatch(/data-slate-node|data-slate-type|onclick=/);
  });

  it('preserves safe links and images and strips unsafe attributes after an actual edit', async () => {
    const changed: string[] = [];
    render(
      <RichTextMaterial
        label="正文"
        value={
          '<p><a href="https://example.test/page" target="_blank" onclick="bad()">原链接</a><img src="https://example.test/image.png" alt="示意" width="120" onerror="bad()"> 原文</p><p><a href="javascript:bad()">危险链接</a><img src="data:image/svg+xml,bad" alt="不保留"></p>'
        }
        onValueChange={(next) => changed.push(next)}
      />,
    );
    const editor = probe.editor!;
    const [text, path] = [...editor.api.nodes({ at: [0], match: (node) => 'text' in node })].find(
      ([node]) => typeof node.text === 'string' && node.text.includes('原文'),
    )!;
    act(() => {
      editor.tf.select({
        anchor: { path, offset: 0 },
        focus: { path, offset: String(text.text).length },
      });
    });
    fireEvent.mouseDown(screen.getByRole('button', { name: '粗体' }));
    fireEvent.click(screen.getByRole('button', { name: '粗体' }));

    await waitFor(() => expect(changed.length).toBeGreaterThan(0));
    const template = document.createElement('template');
    template.innerHTML = changed.at(-1)!;
    const link = template.content.querySelector('a');
    const image = template.content.querySelector('img');
    expect(link?.getAttribute('href')).toBe('https://example.test/page');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(image?.getAttribute('src')).toBe('https://example.test/image.png');
    expect(image?.getAttribute('alt')).toBe('示意');
    expect(image?.getAttribute('width')).toBe('120');
    expect(template.content.querySelectorAll('img')).toHaveLength(1);
    expect(template.content.querySelector('strong')?.textContent).toContain('原文');
    expect(template.content.textContent).toContain('危险链接');
    expect(changed.at(-1)).not.toMatch(/javascript:|onerror=|onclick=|data:image/);
  });

  it('renders read-only and display through the same safe, non-editable view', () => {
    const value =
      '<h2>标题</h2><ul><li>旧列表</li></ul><p>上<br>下<a href="javascript:alert(1)" onclick="alert(1)">链接</a><img src="https://example.test/a.png" onerror="alert(1)" alt="示意"></p><hr><a href="/&#92;example.test">跨源</a><script>alert(1)</script>';
    const { container } = render(
      <>
        <RichTextMaterial label="只读正文" value={value} readOnly />
        <RichTextDisplayMaterial label="图文展示" value={value} />
      </>,
    );
    const views = container.querySelectorAll('.plate-rich-text');
    expect(views).toHaveLength(2);
    expect(views[0].classList.contains('plate-rich-text-static')).toBe(true);
    expect(views[1].classList.contains('plate-rich-text-static')).toBe(true);
    expect(views[0].innerHTML).toBe(views[1].innerHTML);
    expect(views[0].querySelector('h2')?.textContent).toBe('标题');
    expect(views[0].querySelector('ul > li')?.textContent).toBe('旧列表');
    expect(views[0].querySelector('p > br')).not.toBeNull();
    expect(views[0].querySelector('hr')).not.toBeNull();
    expect(views[0].querySelectorAll('a[href]')).toHaveLength(0);
    expect(views[0].querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(views[0].querySelector('a')?.hasAttribute('onclick')).toBe(false);
    expect(views[0].querySelector('img')?.hasAttribute('onerror')).toBe(false);
    expect(views[0].querySelector('img')?.getAttribute('src')).toBe('https://example.test/a.png');
    expect(views[0].querySelector('script')).toBeNull();
    expect(container.querySelector('[contenteditable]')).toBeNull();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('registers the rich text display material and rich text setter', () => {
    expect(extendedCatalog['ui.richTextDisplay'].title).toBe('图文展示');
    const property = extendedCatalog['ui.richTextDisplay'].properties.find(
      (item) => item.name === 'value',
    );
    expect(property?.setter).toEqual({ kind: 'richText' });
  });
});
