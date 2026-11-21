import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { Ellipsis, Plus, FileText, Search, ChevronDown, ChevronRight, X } from 'lucide-react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { PageSchema } from '../../packages/schema/types';
import { Button, Input, Select, Tip } from '../ui/primitives';
import { useDragDrop } from './DragDrop';
import { errorText } from './errors';
import { useSessionState } from './session';

type Capture = { document: EditorDocument; plan: EditorSnapshot['plan'] };
type PageDialog = Capture & {
  token: object;
  kind: 'create' | 'rename' | 'delete' | 'group';
  page?: PageSchema;
  title: string;
  replacement: string;
  error: string;
};

type PageEntry = { page: PageSchema; index: number; group?: string };

function pageGroup(page: PageSchema) {
  const extension = page.extensions?.['dimlu:editor'];
  if (!extension || typeof extension !== 'object' || Array.isArray(extension)) return undefined;
  const group = (extension as Record<string, unknown>).group;
  return typeof group === 'string' && group.trim() ? group.trim() : undefined;
}

export function PagePanel({
  document,
  snapshot,
  authoringAllowed = false,
  onNavigatePage,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed?: boolean;
  onNavigatePage?: (pageId: string) => void;
}) {
  const drag = useDragDrop();
  const current = useRef({ document, snapshot, authoringAllowed, drag });
  current.current = { document, snapshot, authoringAllowed, drag };
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const panel = useRef<HTMLElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [query, setQuery] = useSessionState('pages/query', '');
  const [recentIds, setRecentIds] = useSessionState<string[]>('pages/recent', []);
  const [collapsedGroups, setCollapsedGroups] = useSessionState<Record<string, boolean>>(
    'pages/collapsed-groups',
    {},
  );
  const pending = useRef(dialog);
  pending.current = dialog;
  const invalidDialogs = useRef(new WeakSet<object>());
  const [error, setError] = useState('');
  const base = { document, plan: snapshot.plan };
  const blocked = !authoringAllowed || !!drag?.isInteracting;
  if (dialog && (blocked || dialog.document !== document || dialog.plan !== snapshot.plan))
    invalidDialogs.current.add(dialog.token);
  const conflict = !!dialog && invalidDialogs.current.has(dialog.token);
  const valid = (capture: Capture, mutate = true) => {
    const latest = current.current;
    return (
      active.current &&
      latest.document === capture.document &&
      !latest.drag?.isInteracting &&
      (!mutate || latest.authoringAllowed) &&
      latest.document.getSnapshot().plan === capture.plan
    );
  };
  const updateDialog = (target: PageDialog, patch: Partial<PageDialog>) => {
    const previous = pending.current;
    if (!previous || previous.token !== target.token) return;
    const next = { ...previous, ...patch };
    pending.current = next;
    setDialog(next);
  };
  const close = (target: PageDialog) => {
    if (pending.current?.token !== target.token) return;
    pending.current = null;
    setDialog(null);
  };
  const open = (kind: PageDialog['kind'], page?: PageSchema) => {
    if (!valid(base)) return;
    const next: PageDialog = {
      ...base,
      token: {},
      kind,
      page,
      title: kind === 'group' && page ? (pageGroup(page) ?? '') : (page?.title ?? ''),
      replacement: '',
      error: '',
    };
    pending.current = next;
    setDialog(next);
    setError('');
  };
  const run = (action: () => unknown) => {
    if (!valid(base)) return;
    try {
      action();
      setError('');
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const confirm = (target: PageDialog) => {
    const latest = pending.current;
    if (!latest || latest.token !== target.token || invalidDialogs.current.has(latest.token))
      return;
    if (!valid(latest)) {
      invalidDialogs.current.add(latest.token);
      updateDialog(latest, { error: '页面或编辑环境已变化，请关闭后重新打开。' });
      return;
    }
    try {
      if (latest.kind === 'create') {
        const pageId = latest.document.createPage(latest.title);
        onNavigatePage?.(pageId);
      } else if (latest.kind === 'rename')
        latest.document.renamePage(latest.page!.id, latest.title);
      else if (latest.kind === 'group') latest.document.setPageGroup(latest.page!.id, latest.title);
      else {
        const wasSelected = latest.document.getSnapshot().selection.pageId === latest.page!.id;
        latest.document.removePage(
          latest.page!.id,
          latest.plan.schema.entryPageId === latest.page!.id ? latest.replacement : undefined,
        );
        if (wasSelected) onNavigatePage?.(latest.document.getSnapshot().selection.pageId);
      }
      close(latest);
      setError('');
    } catch (reason) {
      updateDialog(latest, { error: errorText(reason) });
    }
  };
  const pages = snapshot.plan.schema.pages;
  useEffect(() => {
    const pageIds = new Set(pages.map((page) => page.id));
    const currentPageId = snapshot.selection.pageId;
    if (!pageIds.has(currentPageId)) return;
    setRecentIds((current) => {
      const next = [currentPageId, ...current.filter((id) => id !== currentPageId)].filter((id) =>
        pageIds.has(id),
      );
      const limited = next.slice(0, 6);
      return JSON.stringify(current) === JSON.stringify(limited) ? current : limited;
    });
  }, [pages, snapshot.selection.pageId]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const searching = normalizedQuery.length > 0;
  const visiblePages = useMemo<PageEntry[]>(
    () =>
      pages
        .map((page, index) => ({ page, index, group: pageGroup(page) }))
        .filter(({ page, group }) =>
          [page.title, page.id, group ?? '未分组'].some((value) =>
            value.toLocaleLowerCase().includes(normalizedQuery),
          ),
        ),
    [normalizedQuery, pages],
  );
  const recentPages = recentIds
    .map((id) => pages.find((page) => page.id === id))
    .filter((page): page is PageSchema => !!page);
  const groupedPages = useMemo(() => {
    const groups = new Map<string, PageEntry[]>();
    visiblePages.forEach((entry) => {
      const name = entry.group ?? '未分组';
      const entries = groups.get(name) ?? [];
      entries.push(entry);
      groups.set(name, entries);
    });
    return [...groups.entries()];
  }, [visiblePages]);
  const hasNamedGroups = visiblePages.some((entry) => !!entry.group);
  const selectPage = (pageId: string) => {
    if (!valid(base, false)) return;
    if (onNavigatePage) onNavigatePage(pageId);
    else document.selectPage(pageId);
  };
  const renderPageRow = ({ page, index }: PageEntry, recent = false) => (
    <li
      key={`${recent ? 'recent-' : ''}${page.id}`}
      className={`page-row ${snapshot.selection.pageId === page.id ? 'selected' : ''}`}
    >
      <Tip content={`${page.title} · ${page.id}`} side="right">
        <Button
          className="page-row-select"
          aria-label={`${recent ? '最近访问 ' : '切换到页面 '}${page.title} (${page.id})`}
          aria-current={!recent && snapshot.selection.pageId === page.id ? 'page' : undefined}
          disabled={!!drag?.isInteracting}
          onClick={() => selectPage(page.id)}
        >
          <FileText size={14} aria-hidden="true" />
          <span className="page-row-text">
            <span>{page.title}</span>
            <small>{page.id}</small>
          </span>
          {!recent && snapshot.plan.schema.entryPageId === page.id && (
            <span className="page-entry-badge">入口</span>
          )}
        </Button>
      </Tip>
      {!recent && (
        <Menu.Root>
          <Tip content="页面操作">
            <Menu.Trigger
              className="ui-button page-menu-trigger"
              aria-label={`页面操作 ${page.title} (${page.id})`}
              disabled={blocked}
            >
              <Ellipsis size={14} />
            </Menu.Trigger>
          </Tip>
          <Menu.Portal>
            <Menu.Positioner sideOffset={4} className="menu-positioner">
              <Menu.Popup
                className="ui-menu"
                finalFocus={() =>
                  pending.current
                    ? false
                    : createButton.current?.disabled
                      ? panel.current
                      : createButton.current
                }
              >
                <Menu.Item
                  className="ui-menu-item"
                  disabled={blocked}
                  onClick={() => open('rename', page)}
                >
                  重命名
                </Menu.Item>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={blocked}
                  onClick={() => open('group', page)}
                >
                  设置分组
                </Menu.Item>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={blocked}
                  onClick={() =>
                    run(() => {
                      const pageId = document.duplicatePage(page.id);
                      onNavigatePage?.(pageId);
                    })
                  }
                >
                  复制页面
                </Menu.Item>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={blocked || index === 0}
                  onClick={() => run(() => document.movePage(page.id, index - 1))}
                >
                  上移页面
                </Menu.Item>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={blocked || index === pages.length - 1}
                  onClick={() => run(() => document.movePage(page.id, index + 1))}
                >
                  下移页面
                </Menu.Item>
                <Menu.Item
                  className="ui-menu-item"
                  disabled={blocked || snapshot.plan.schema.entryPageId === page.id}
                  onClick={() => run(() => document.setEntryPage(page.id))}
                >
                  设为入口
                </Menu.Item>
                <Tip
                  content={pages.length === 1 ? '至少保留一个页面' : '删除前需确认；可通过撤销恢复'}
                  side="right"
                >
                  <Menu.Item
                    className="ui-menu-item danger"
                    disabled={blocked || pages.length === 1}
                    onClick={() => open('delete', page)}
                  >
                    删除页面
                  </Menu.Item>
                </Tip>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </li>
  );
  return (
    <section className="page-panel" aria-label="页面管理" ref={panel} tabIndex={-1}>
      <div className="page-panel-heading">
        <strong>页面 · {pages.length}</strong>
        <Tip content={blocked ? '编辑模式且未拖拽时可新建页面' : '新建页面'}>
          <Button
            ref={createButton}
            aria-label="新建页面"
            disabled={blocked}
            onClick={() => open('create')}
          >
            <Plus size={13} />
          </Button>
        </Tip>
      </div>
      <p className="editor-note">
        复制页面只复制定义，不包含当前运行数据。删除后的本次会话草稿会保留，供撤销恢复。
      </p>
      {!authoringAllowed && (
        <p className="editor-note">预览中可切换页面；修改页面请切回编辑模式。</p>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <div className="page-search">
        <Search size={13} aria-hidden="true" />
        <Input
          ref={searchInput}
          aria-label="筛选页面"
          value={query}
          placeholder="搜索名称、ID 或分组"
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="page-search-meta" role="status" aria-atomic="true">
          <span className="sr-only">匹配页面数：</span>
          {visiblePages.length}/{pages.length}
        </span>
        {query && (
          <Button
            type="button"
            className="page-search-clear"
            variant="ghost"
            aria-label="清除页面搜索"
            onClick={() => {
              setQuery('');
              searchInput.current?.focus();
            }}
          >
            <X size={13} aria-hidden="true" />
          </Button>
        )}
      </div>
      {!searching && recentPages.length > 1 && (
        <section className="page-recent" aria-label="最近访问">
          <div className="page-section-heading">最近访问</div>
          <ul className="page-list">
            {recentPages
              .slice(0, 5)
              .map((page) => renderPageRow({ page, index: pages.indexOf(page) }, true))}
          </ul>
        </section>
      )}
      {visiblePages.length === 0 ? (
        <p className="editor-note page-empty">没有匹配的页面</p>
      ) : hasNamedGroups ? (
        <div className="page-groups" aria-label="应用页面">
          {groupedPages.map(([group, entries]) => {
            const collapsed = !searching && collapsedGroups[group] === true;
            const groupDetails = (
              <>
                <span className="page-group-title">{group}</span>
                <span className="page-search-meta">{entries.length}</span>
              </>
            );
            return (
              <section className="page-group" key={group}>
                {searching ? (
                  <div className="page-group-heading page-group-search-heading">{groupDetails}</div>
                ) : (
                  <button
                    type="button"
                    className="page-group-heading"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedGroups((current) => ({ ...current, [group]: !collapsed }))
                    }
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    {groupDetails}
                  </button>
                )}
                {!collapsed && (
                  <ul className="page-list">{entries.map((entry) => renderPageRow(entry))}</ul>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <ul className="page-list" aria-label="应用页面">
          {visiblePages.map((entry) => renderPageRow(entry))}
        </ul>
      )}
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(value) => {
          if (!value && dialog) close(dialog);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup
            className="material-modal project-confirmation page-dialog"
            initialFocus={dialog?.kind === 'delete' ? cancelButton : titleInput}
            finalFocus={() =>
              createButton.current?.disabled ? panel.current : createButton.current
            }
          >
            <Dialog.Title className="project-confirmation-title">
              {dialog?.kind === 'create'
                ? '新建页面'
                : dialog?.kind === 'rename'
                  ? '重命名页面'
                  : dialog?.kind === 'group'
                    ? '设置页面分组'
                    : '删除页面？'}
            </Dialog.Title>
            <Dialog.Description className="project-confirmation-description">
              {dialog?.kind === 'delete'
                ? `删除“${dialog.page?.title}”（${dialog.page?.id}）的定义？本次会话草稿保留，可撤销恢复。`
                : dialog?.kind === 'group'
                  ? '输入分组名称；留空可移出当前分组。'
                  : '页面名称用于显示，内部 ID 保持稳定。'}
            </Dialog.Description>
            {dialog && (
              <form
                className="page-dialog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  confirm(dialog);
                }}
              >
                {dialog.kind !== 'delete' ? (
                  <label>
                    {dialog.kind === 'group' ? '分组名称' : '页面名称'}
                    <Input
                      ref={titleInput}
                      aria-label={dialog.kind === 'group' ? '分组名称' : '页面名称'}
                      placeholder={dialog.kind === 'group' ? '例如：管理后台' : undefined}
                      value={dialog.title}
                      disabled={blocked || conflict}
                      onChange={(event) => {
                        if (valid(dialog) && !invalidDialogs.current.has(dialog.token))
                          updateDialog(dialog, { title: event.target.value, error: '' });
                      }}
                    />
                  </label>
                ) : (
                  dialog.plan.schema.entryPageId === dialog.page?.id && (
                    <label>
                      新入口页面
                      <Select
                        aria-label="新入口页面"
                        value={dialog.replacement}
                        disabled={blocked || conflict}
                        onValueChange={(replacement) => {
                          if (valid(dialog) && !invalidDialogs.current.has(dialog.token))
                            updateDialog(dialog, { replacement, error: '' });
                        }}
                      >
                        <option value="">请选择新入口页面</option>
                        {dialog.plan.schema.pages
                          .filter((page) => page.id !== dialog.page!.id)
                          .map((page) => (
                            <option key={page.id} value={page.id}>
                              {page.title} · {page.id}
                            </option>
                          ))}
                      </Select>
                    </label>
                  )
                )}
                {conflict && (
                  <p role="alert" className="field-error">
                    页面或编辑环境已变化，请关闭后重新打开。
                  </p>
                )}
                {dialog.error && (
                  <p role="alert" className="field-error">
                    {dialog.error}
                  </p>
                )}
                <div className="project-confirmation-actions">
                  <Dialog.Close ref={cancelButton} className="ui-button" type="button">
                    取消
                  </Dialog.Close>
                  <Button
                    type="submit"
                    variant={dialog.kind === 'delete' ? 'danger' : 'primary'}
                    disabled={
                      blocked ||
                      conflict ||
                      (dialog.kind === 'delete' &&
                        dialog.plan.schema.entryPageId === dialog.page?.id &&
                        !dialog.replacement)
                    }
                  >
                    {dialog.kind === 'delete'
                      ? '确认删除'
                      : dialog.kind === 'group'
                        ? '保存分组'
                        : '保存页面'}
                  </Button>
                </div>
              </form>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
