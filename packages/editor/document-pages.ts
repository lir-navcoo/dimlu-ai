import type { PageCode, PageSchema } from '../schema/types';
import type { DocumentHost } from './document-context';

/** Page lifecycle: create, rename, group, duplicate, reorder, entry and removal. */
export class DocumentPages {
  constructor(private readonly host: DocumentHost) {}

  /** Titles trim and must not collapse to whitespace. */
  private pageTitle(title: string) {
    if (typeof title !== 'string' || !title.trim()) throw new Error('页面名称不能为空');
    return title.trim();
  }

  renameApplication = (title: string): boolean => {
    if (typeof title !== 'string' || !title.trim()) throw new Error('应用名称不能为空');
    const schema = structuredClone(this.host.plan().schema);
    const normalized = title.trim();
    if (schema.title === normalized) return false;
    schema.title = normalized;
    return this.host.commit(schema, '重命名应用');
  };

  createPage = (title: string): string => {
    const name = this.pageTitle(title);
    const schema = structuredClone(this.host.plan().schema);
    const id = this.host.allocatePageId();
    schema.pages.push({ id, title: name, state: [], children: [] });
    this.host.commit(schema, '新建页面 ' + name, { pageId: id, nodeId: null });
    return id;
  };

  renamePage = (pageId: string, title: string): boolean => {
    const { schema, page } = this.host.draft(pageId);
    page.title = this.pageTitle(title);
    return this.host.commit(schema, '重命名页面');
  };

  setPageGroup = (pageId: string, group: string): boolean => {
    const { schema, page } = this.host.draft(pageId);
    if (typeof group !== 'string') throw new Error('页面分组必须是文本');
    const normalized = group.trim();
    const extensions = { ...(page.extensions ?? {}) };
    const editor = {
      ...(extensions['dimlu:editor'] && typeof extensions['dimlu:editor'] === 'object'
        ? (extensions['dimlu:editor'] as Record<string, import('../schema/types').Json>)
        : {}),
    };
    if (normalized) editor.group = normalized;
    else delete editor.group;
    if (Object.keys(editor).length) extensions['dimlu:editor'] = editor;
    else delete extensions['dimlu:editor'];
    if (Object.keys(extensions).length) page.extensions = extensions;
    else delete page.extensions;
    return this.host.commit(schema, normalized ? '设置页面分组' : '移出页面分组');
  };

  duplicatePage = (pageId: string, title?: string): string => {
    const { schema, page } = this.host.draft(pageId);
    const name = this.pageTitle(title === undefined ? page.title + ' 副本' : title);
    const id = this.host.allocatePageId();
    const copy = { ...structuredClone(page), id, title: name };
    schema.pages.splice(schema.pages.findIndex((item) => item.id === pageId) + 1, 0, copy);
    this.host.commit(schema, '复制页面 ' + page.title, {
      pageId: id,
      nodeId: copy.children[0]?.id ?? null,
    });
    return id;
  };

  movePage = (pageId: string, index: number): boolean => {
    const { schema, page } = this.host.draft(pageId);
    if (!Number.isInteger(index) || index < 0 || index >= schema.pages.length)
      throw new Error('页面位置超出范围');
    schema.pages.splice(
      schema.pages.findIndex((item) => item.id === pageId),
      1,
    );
    schema.pages.splice(index, 0, page);
    return this.host.commit(schema, '调整页面顺序');
  };

  setEntryPage = (pageId: string): boolean => {
    const { schema } = this.host.draft(pageId);
    schema.entryPageId = pageId;
    return this.host.commit(schema, '设置入口页面');
  };

  removePage = (pageId: string, replacementEntryId?: string): boolean => {
    const { schema } = this.host.draft(pageId);
    if (schema.pages.length === 1) throw new Error('至少保留一个页面');
    if (schema.entryPageId === pageId) {
      if (
        !replacementEntryId ||
        replacementEntryId === pageId ||
        !schema.pages.some((page) => page.id === replacementEntryId)
      )
        throw new Error('删除入口页面前请选择其他页面作为新入口');
      schema.entryPageId = replacementEntryId;
    } else if (replacementEntryId !== undefined) {
      throw new Error('仅删除入口页面时可以指定新入口');
    }
    schema.pages = schema.pages.filter((page) => page.id !== pageId);
    const entry = schema.pages.find((page) => page.id === schema.entryPageId)!;
    const selection =
      this.host.selection().pageId === pageId
        ? { pageId: entry.id, nodeId: entry.children[0]?.id ?? null }
        : this.host.selection();
    return this.host.commit(schema, '删除页面', selection);
  };

  /** Structural publication only. Compilation and activation never run inside the document. */
  setPageCode = (pageId: string, code: PageCode | undefined) => {
    const { schema, page } = this.host.draft(pageId);
    if (code === undefined) delete page.code;
    else page.code = structuredClone(code);
    return this.host.commit(schema, code?.enabled ? '保存页面代码' : '禁用页面代码');
  };
}

