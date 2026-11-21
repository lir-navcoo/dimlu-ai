import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ClipboardCopy, ClipboardPaste } from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import type { ClipboardSummary } from '../../packages/editor/node-clipboard';
import {
  pageNodeOrder,
  selectedNodeIds,
  topSelectedNodeIds,
} from '../../packages/editor/selection';
import { useDragDrop } from './DragDrop';
import { catalog } from './catalog';
import { errorText } from './errors';
import './clipboard.css';
import { matchesCopySummary, matchesPasteSnapshot } from './clipboard-operation';

const copyHelp = '仅复制组件内容和内联样式，不包含页面 CSS、代码或模型；只在当前编辑会话内保留。';
type AuthorOwner = {
  document: EditorDocument;
  pageId: string;
  authoringAllowed: boolean;
  code: boolean;
  enabled: boolean;
  interacting: boolean;
};
type AuthorContext = AuthorOwner & {
  plan: EditorSnapshot['plan'];
  selection: EditorSnapshot['selection'];
  clipboard: Readonly<ClipboardSummary>;
  publication: number;
};
type Receipt = {
  active: boolean;
  copy: boolean;
  owner: { context: AuthorOwner; active: boolean };
  initial: EditorSnapshot;
  clipboard: Readonly<ClipboardSummary>;
  rootCount: number;
  component?: string;
  pageTitle: string;
  oldNodeIds: Set<string>;
  documents: number;
  clipboards: number;
  candidate?: EditorSnapshot;
  summary?: Readonly<ClipboardSummary>;
};

/** Kept in the existing file menu; clipboard changes never subscribe through document history. */
export function ClipboardMenuGroup({
  document,
  snapshot,
  authoringAllowed,
  onFeedback,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed: boolean;
  onFeedback: (message: string, error: boolean) => void;
}) {
  const clipboard = useSyncExternalStore(
    document.subscribeClipboard,
    document.getClipboardSnapshot,
    document.getClipboardSnapshot,
  );
  const drag = useDragDrop();
  const mounted = useRef(false);
  const receipt = useRef<Receipt | null>(null);
  const [publication, setPublication] = useState(0);
  const current = useRef({ document, snapshot, clipboard, authoringAllowed, drag, onFeedback });
  current.current = { document, snapshot, clipboard, authoringAllowed, drag, onFeedback };
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)?.schema;
  const ownerContext: AuthorOwner = {
    document,
    pageId: snapshot.selection.pageId,
    authoringAllowed,
    code: !!page?.code?.enabled,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
  };
  const owner = useRef({ context: ownerContext, active: true });
  if (
    !owner.current.active ||
    (Object.keys(ownerContext) as (keyof AuthorOwner)[]).some(
      (key) => owner.current.context[key] !== ownerContext[key],
    )
  ) {
    owner.current.active = false;
    if (receipt.current) receipt.current.active = false;
    owner.current = { context: ownerContext, active: true };
  }
  const context: AuthorContext = {
    ...ownerContext,
    plan: snapshot.plan,
    selection: snapshot.selection,
    clipboard,
    publication,
  };
  const permission = useRef({ context, active: true });
  if (
    !permission.current.active ||
    (Object.keys(context) as (keyof AuthorContext)[]).some(
      (key) => permission.current.context[key] !== context[key],
    )
  ) {
    permission.current.active = false;
    permission.current = { context, active: true };
  }
  const generation = permission.current;
  const allowed =
    authoringAllowed && !page?.code?.enabled && !drag?.isInteracting && drag?.enabled !== false;

  const observe = (rendered?: {
    snapshot: EditorSnapshot;
    clipboard: Readonly<ClipboardSummary>;
  }) => {
    const pending = receipt.current;
    if (!pending?.active) return;
    const latest = current.current;
    const captured = pending.owner.context;
    const actual = latest.document.getSnapshot();
    const liveClipboard = latest.document.getClipboardSnapshot();
    if (
      !pending.owner.active ||
      owner.current !== pending.owner ||
      latest.document !== captured.document ||
      actual.selection.pageId !== captured.pageId ||
      latest.authoringAllowed !== captured.authoringAllowed ||
      !!actual.plan.pages.get(captured.pageId)?.schema.code?.enabled !== captured.code ||
      (latest.drag?.enabled !== false) !== captured.enabled ||
      !!latest.drag?.isInteracting !== captured.interacting
    ) {
      pending.owner.active = false;
      pending.active = false;
      return;
    }
    const initial = pending.initial;
    if (pending.copy) {
      if (
        actual.plan !== initial.plan ||
        actual.selection !== initial.selection ||
        actual.revision !== initial.revision
      )
        pending.active = false;
      if (liveClipboard !== pending.clipboard) {
        if (
          !matchesCopySummary(liveClipboard, pending) ||
          (pending.summary && pending.summary !== liveClipboard)
        )
          pending.active = false;
        else pending.summary = liveClipboard;
      }
      if (
        rendered &&
        (rendered.snapshot.plan !== initial.plan ||
          rendered.snapshot.selection !== initial.selection ||
          (rendered.clipboard !== pending.clipboard && rendered.clipboard !== pending.summary))
      )
        pending.active = false;
    } else {
      if (liveClipboard !== pending.clipboard) pending.active = false;
      const unchanged = actual.plan === initial.plan && actual.selection === initial.selection;
      if (!unchanged) {
        if (
          !matchesPasteSnapshot(actual, pending) ||
          (pending.candidate && pending.candidate !== actual)
        )
          pending.active = false;
        else pending.candidate = actual;
      } else if (pending.candidate) pending.active = false;
      if (
        rendered &&
        (rendered.clipboard !== pending.clipboard ||
          !(
            (rendered.snapshot.plan === initial.plan &&
              rendered.snapshot.selection === initial.selection) ||
            (pending.candidate &&
              rendered.snapshot.plan === pending.candidate.plan &&
              rendered.snapshot.selection === pending.candidate.selection)
          ))
      )
        pending.active = false;
    }
  };
  observe({ snapshot, clipboard });
  useLayoutEffect(() => {
    mounted.current = true;
    permission.current.active = true;
    owner.current.active = true;
    return () => {
      mounted.current = false;
      permission.current.active = false;
      owner.current.active = false;
      if (receipt.current) receipt.current.active = false;
    };
  }, []);
  useLayoutEffect(() => {
    const changed = () => {
      if (!mounted.current || current.current.document !== document) return;
      permission.current.active = false;
      observe();
      // Another subscriber may have rendered before our listener executes.
      setPublication((value) => value + 1);
    };
    const stopDocument = document.subscribe(changed);
    const stopClipboard = document.subscribeClipboard(changed);
    return () => {
      stopDocument();
      stopClipboard();
    };
  }, [document]);
  const active = () => {
    observe();
    if (!mounted.current || !generation.active || permission.current !== generation) return false;
    const latest = current.current;
    const actual = latest.document.getSnapshot();
    if (
      latest.document !== context.document ||
      actual.plan !== context.plan ||
      actual.selection !== context.selection ||
      latest.snapshot.plan !== context.plan ||
      latest.snapshot.selection !== context.selection ||
      latest.document.getClipboardSnapshot() !== context.clipboard ||
      latest.clipboard !== context.clipboard ||
      latest.authoringAllowed !== context.authoringAllowed ||
      !!actual.plan.pages.get(context.pageId)?.schema.code?.enabled !== context.code ||
      (latest.drag?.enabled !== false) !== context.enabled ||
      !!latest.drag?.isInteracting !== context.interacting
    ) {
      generation.active = false;
      return false;
    }
    return context.authoringAllowed && !context.code && context.enabled && !context.interacting;
  };
  const act = (copy: boolean) => {
    if (!active()) return;
    const initial = document.getSnapshot();
    const ids = selectedNodeIds(initial.selection);
    if (copy ? !ids.length : !clipboard.available) return;
    const source = initial.plan.pages.get(initial.selection.pageId)!.schema;
    const roots = copy ? topSelectedNodeIds(source, ids) : [];
    const pending: Receipt = {
      active: true,
      copy,
      owner: owner.current,
      initial,
      clipboard,
      rootCount: copy ? roots.length : (clipboard.rootCount ?? 1),
      component:
        copy && roots.length === 1 ? findNode(source, roots[0]!)!.node.component : undefined,
      pageTitle: source.title,
      oldNodeIds: new Set(pageNodeOrder(source)),
      documents: 0,
      clipboards: 0,
    };
    if (receipt.current) receipt.current.active = false;
    receipt.current = pending;
    const stopDocument = document.subscribe(() => {
      pending.documents++;
      if (pending.documents > (copy ? 0 : 1)) pending.active = false;
      observe();
    });
    const stopClipboard = document.subscribeClipboard(() => {
      pending.clipboards++;
      if (pending.clipboards > (copy ? 1 : 0)) pending.active = false;
      observe();
    });
    const ownsFeedback = () => {
      observe();
      return (
        mounted.current &&
        pending.active &&
        receipt.current === pending &&
        pending.owner.active &&
        owner.current === pending.owner &&
        current.current.document === document
      );
    };
    let feedbackSent = false;
    const feedback = (message: string, error: boolean) => {
      if (!ownsFeedback()) return;
      feedbackSent = true;
      current.current.onFeedback(message, error);
    };
    try {
      if (copy) {
        document.copyNodesToClipboard(initial.selection.pageId, ids);
        const summary = document.getClipboardSnapshot();
        if (
          !ownsFeedback() ||
          pending.documents !== 0 ||
          pending.clipboards !== 1 ||
          summary !== pending.summary ||
          !matchesCopySummary(summary, pending)
        )
          return;
        feedback(
          (pending.rootCount === 1
            ? '已复制组件到当前会话剪贴板。'
            : `已复制 ${pending.rootCount} 个顶层组件到当前会话剪贴板。`) + copyHelp,
          false,
        );
      } else {
        const pasted = document.pasteClipboardNodes(initial.selection.pageId);
        const actual = document.getSnapshot();
        const selected = selectedNodeIds(actual.selection);
        if (
          !ownsFeedback() ||
          pending.documents !== 1 ||
          pending.clipboards !== 0 ||
          actual !== pending.candidate ||
          !Array.isArray(pasted) ||
          pasted.length !== pending.rootCount ||
          new Set(pasted).size !== pending.rootCount ||
          !pasted.every((id, index) => id === selected[index]) ||
          !matchesPasteSnapshot(actual, pending)
        )
          return;
        feedback(
          pending.rootCount === 1
            ? '已粘贴组件到页面末尾，可撤销。'
            : `已粘贴 ${pending.rootCount} 个顶层组件到页面末尾，可撤销。`,
          false,
        );
      }
    } catch (error) {
      const actual = document.getSnapshot();
      if (
        !feedbackSent &&
        ownsFeedback() &&
        pending.documents === 0 &&
        pending.clipboards === 0 &&
        actual.plan === initial.plan &&
        actual.selection === initial.selection &&
        actual.revision === initial.revision &&
        document.getClipboardSnapshot() === clipboard &&
        active()
      )
        feedback(errorText(error), true);
    } finally {
      stopDocument();
      stopClipboard();
      pending.active = false;
      if (receipt.current === pending) receipt.current = null;
    }
  };
  return (
    <Menu.Group className="clipboard-menu-group" aria-label="组件剪贴板">
      <Menu.GroupLabel className="clipboard-menu-label">组件剪贴板 · 当前会话</Menu.GroupLabel>
      <Menu.Item
        className="ui-menu-item clipboard-menu-item"
        disabled={!allowed || !selectedNodeIds(snapshot.selection).length}
        onClick={() => act(true)}
      >
        <ClipboardCopy size={14} aria-hidden="true" />
        复制组件到剪贴板
      </Menu.Item>
      <Menu.Item
        className="ui-menu-item clipboard-menu-item"
        disabled={!allowed || !clipboard.available}
        onClick={() => act(false)}
      >
        <ClipboardPaste size={14} aria-hidden="true" />
        粘贴组件到页面末尾
      </Menu.Item>
      <p className="clipboard-menu-help">
        {clipboard.available
          ? clipboard.rootCount
            ? `${clipboard.sourcePageTitle} · ${clipboard.rootCount} 个顶层组件 · 共 ${clipboard.nodeCount} 个组件`
            : `${clipboard.sourcePageTitle} · ${catalog[clipboard.component ?? '']?.title ?? clipboard.component} · ${clipboard.nodeCount} 个组件`
          : '选择静态组件复制，再切换页面粘贴。'}
      </p>
      <p className="clipboard-menu-help">
        {copyHelp} 画布复制图标用于直接创建副本。聚焦画布或组件树后，可用 Ctrl/⌘+C、Ctrl/⌘+V
        复制粘贴会话组件。
      </p>
    </Menu.Group>
  );
}
