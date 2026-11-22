import { useEffect, useMemo, useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Clipboard,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Trash2,
} from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { createPortal } from 'react-dom';

export type NodeContextMenuState = {
  x: number;
  y: number;
  pageId: string;
  nodeId: string | null;
};

type Item = {
  label: string;
  Icon: typeof Copy;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
};

/**
 * Yidao-style right-click menu for canvas nodes and outline rows: clipboard
 * actions, sibling reordering and deletion in one place. Rendered as a fixed
 * portal so canvas scroll containers never clip it.
 */
export function NodeContextMenu({
  state,
  onClose,
  document,
  snapshot,
  authoringAllowed,
}: {
  state: NodeContextMenuState | null;
  onClose: () => void;
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    const pointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const blur = () => onClose();
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
  }, [state, onClose]);
  const page = state ? snapshot.plan.pages.get(state.pageId)?.schema : undefined;
  const location = state?.nodeId && page ? findNode(page, state.nodeId) : undefined;
  const node = location?.node;
  const siblings = location ? location.list.length : 0;
  const clipboardAvailable = document.getClipboardSnapshot().available;
  const pasteIntoEnabled = useMemo(() => {
    if (!state?.nodeId || !clipboardAvailable) return false;
    try {
      document.checkPasteClipboardNodes(state.pageId, { parentId: state.nodeId });
      return true;
    } catch {
      return false;
    }
    // Recomputed while the menu is open; the clipboard target contract is
    // stable for the menu's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, clipboardAvailable, document]);
  if (!state) return null;
  const width = 200;
  const height = node ? 308 : 44;
  const left = Math.min(state.x, window.innerWidth - width - 8);
  const top = Math.min(state.y, window.innerHeight - height - 8);
  const run = (action: () => void) => () => {
    onClose();
    if (!authoringAllowed) return;
    try {
      action();
    } catch {
      // Invalid targets (non-container paste, clipboard conflicts) stay silent;
      // the command layer already rejects them atomically.
    }
  };
  const items: Item[] = node
    ? [
        {
          label: '复制副本',
          Icon: Copy,
          run: () => document.duplicateNode(state.pageId, state.nodeId!),
        },
        {
          label: '复制到剪贴板',
          Icon: Clipboard,
          run: () => document.copyNodesToClipboard(state.pageId, [state.nodeId!]),
        },
        {
          label: '粘贴为子级',
          Icon: ClipboardPaste,
          disabled: !pasteIntoEnabled,
          run: () => document.pasteClipboardNodes(state.pageId, { parentId: state.nodeId! }),
        },
        {
          label: '上移一层',
          Icon: ArrowUp,
          disabled: siblings <= 1 || location!.index === 0,
          run: () => document.reorderNode(state.pageId, state.nodeId!, 'up'),
        },
        {
          label: '下移一层',
          Icon: ArrowDown,
          disabled: siblings <= 1 || location!.index === siblings - 1,
          run: () => document.reorderNode(state.pageId, state.nodeId!, 'down'),
        },
        {
          label: node!.lock ? '解锁组件' : '锁定组件',
          Icon: node!.lock ? LockOpen : Lock,
          run: () => document.setNodeFlags(state.pageId, state.nodeId!, { lock: !node!.lock }),
        },
        {
          label: node!.hidden ? '显示组件' : '隐藏组件',
          Icon: node!.hidden ? Eye : EyeOff,
          run: () => document.setNodeFlags(state.pageId, state.nodeId!, { hidden: !node!.hidden }),
        },
        {
          label: '置于顶层',
          Icon: ChevronsUp,
          disabled: siblings <= 1 || location!.index === 0,
          run: () => document.reorderNode(state.pageId, state.nodeId!, 'top'),
        },
        {
          label: '置于底层',
          Icon: ChevronsDown,
          disabled: siblings <= 1 || location!.index === siblings - 1,
          run: () => document.reorderNode(state.pageId, state.nodeId!, 'bottom'),
        },
        {
          label: '删除',
          Icon: Trash2,
          danger: true,
          run: () => document.removeNode(state.pageId, state.nodeId!),
        },
      ]
    : [
        {
          label: '粘贴到页面',
          Icon: ClipboardPaste,
          disabled: !clipboardAvailable,
          run: () => document.pasteClipboardNodes(state.pageId),
        },
      ];
  return createPortal(
    <div
      ref={menuRef}
      className="ui-menu node-context-menu"
      role="menu"
      style={{ left, top, width }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={`ui-menu-item${item.danger ? ' danger' : ''}`}
          disabled={item.disabled || !authoringAllowed}
          onClick={run(item.run)}
        >
          <item.Icon size={13} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </div>,
    window.document.body,
  );
}
