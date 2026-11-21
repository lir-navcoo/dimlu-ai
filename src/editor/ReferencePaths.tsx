import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { selectedNodeIds } from '../../packages/editor/selection';
import type { DataSourceDefinition, Json, PageSchema } from '../../packages/schema/types';
import { Button } from '../ui/primitives';
import { useDragDrop } from './DragDrop';

export type ReferencePathOwner = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  nodeId: string;
  property: string;
  draftIdentity: object;
  subscribeDraft: (listener: () => void) => () => void;
  requestCallerRender?: () => void;
  canChoose: () => boolean;
};

/** Saved JSON only; arrays stay leaves and every suggestion preserves its exact keys. */
export function initialReferencePaths(initial: Json): { paths: string[]; truncated: boolean } {
  const paths: string[] = [];
  let visited = 0;
  let textLength = 0;
  let truncated = false;
  const walk = (value: Json, path: string[]): boolean => {
    if (visited >= 128) {
      truncated = true;
      return false;
    }
    visited++;
    if (path.some((key) => key.length > 2048)) {
      truncated = true;
      return true;
    }
    const text = JSON.stringify(path);
    if (text.length > 2048) {
      truncated = true;
      return true;
    }
    if (textLength + text.length > 32768) {
      truncated = true;
      return false;
    }
    paths.push(text);
    textLength += text.length;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (visited >= 128) {
          truncated = true;
          return false;
        }
        if (path.length >= 5) {
          visited++;
          truncated = true;
          break;
        }
        if (['__proto__', 'prototype', 'constructor'].includes(key)) {
          visited++;
          continue;
        }
        if (!walk(value[key], [...path, key])) return false;
      }
    }
    return true;
  };
  walk(initial, []);
  return { paths, truncated };
}

type Binding = { kind: string; sourceId: string; path: string };
type Context = {
  document: EditorDocument;
  plan: EditorSnapshot['plan'];
  selection: EditorSnapshot['selection'];
  page: PageSchema;
  source: DataSourceDefinition | undefined;
  nodeId: string;
  property: string;
  draft: object;
  kind: string;
  sourceId: string;
  path: string;
  subscribeDraft: ReferencePathOwner['subscribeDraft'];
  enabled: boolean;
  interacting: boolean;
};
type Permission = { context: Context; epoch: number; active: boolean };
type Receipt = Permission & { choose: (path: string) => void };
function same(left: Context, right: Context) {
  return (Object.keys(left) as (keyof Context)[]).every((key) => left[key] === right[key]);
}
function visible(element: HTMLElement | null) {
  if (!element?.isConnected) return false;
  for (let item: HTMLElement | null = element; item; item = item.parentElement) {
    if (item.hidden || item.hasAttribute('inert') || item.hasAttribute('data-closed')) return false;
    const style = item.ownerDocument.defaultView?.getComputedStyle(item);
    if (style?.display === 'none' || ['hidden', 'collapse'].includes(style?.visibility ?? ''))
      return false;
  }
  return true;
}

/** Explicit property-owner opt-in; no author permission is inferred from saved JSON. */
export function ReferencePaths({
  owner,
  page,
  source,
  binding,
  onChoose,
  label,
}: {
  owner: ReferencePathOwner;
  page: PageSchema;
  source: DataSourceDefinition | undefined;
  binding: Binding;
  onChoose: (path: string) => void;
  label: string;
}) {
  const drag = useDragDrop();
  const trigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const blockedCaller = useRef<ReferencePathOwner | null>(null);
  const pending = useRef<Receipt | null>(null);
  const [presentation, setPresentation] = useState<Receipt | null>(null);
  const [, setMountCommit] = useState(0);
  const context: Context = {
    document: owner.document,
    plan: owner.snapshot.plan,
    selection: owner.snapshot.selection,
    page,
    source,
    nodeId: owner.nodeId,
    property: owner.property,
    draft: owner.draftIdentity,
    kind: binding.kind,
    sourceId: binding.sourceId,
    path: binding.path,
    subscribeDraft: owner.subscribeDraft,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
  };
  const current = useRef({ owner, context, drag });
  current.current = { owner, context, drag };
  const permission = useRef<Permission>({ context, epoch: epoch.current, active: true });
  if (
    !permission.current.active ||
    permission.current.epoch !== epoch.current ||
    !same(permission.current.context, context)
  ) {
    permission.current.active = false;
    permission.current = {
      context,
      epoch: epoch.current,
      active: blockedCaller.current !== owner,
    };
  }
  const generation = permission.current;
  const choices = useMemo(
    () => (source ? initialReferencePaths(source.initial) : { paths: [], truncated: false }),
    [source],
  );
  const retire = (receipt: Receipt) => {
    receipt.active = false;
    if (pending.current === receipt) pending.current = null;
    setPresentation((value) => (value === receipt ? null : value));
  };
  const invalidate = () => {
    const caller = current.current.owner;
    epoch.current++;
    // Only this caller's real useDraft render can acknowledge the publication.
    blockedCaller.current = caller;
    permission.current.active = false;
    const receipt = pending.current;
    if (receipt) retire(receipt);
    caller.requestCallerRender?.();
  };
  const allowed = (captured: Permission) => {
    const latest = current.current;
    const expected = captured.context;
    const actual = expected.document.getSnapshot();
    const livePage = actual.plan.pages.get(actual.selection.pageId)?.schema;
    const node = livePage && findNode(livePage, expected.nodeId)?.node;
    return (
      mounted.current &&
      captured.active &&
      captured.epoch === epoch.current &&
      blockedCaller.current !== latest.owner &&
      same(expected, latest.context) &&
      visible(trigger.current) &&
      actual.plan === expected.plan &&
      actual.selection === expected.selection &&
      selectedNodeIds(actual.selection).length === 1 &&
      actual.selection.nodeId === expected.nodeId &&
      livePage === expected.page &&
      !!node &&
      Object.hasOwn(actual.plan.registry.components[node.component].props, expected.property) &&
      !!expected.source &&
      livePage.dataSources?.find((entry) => entry.id === expected.sourceId) === expected.source &&
      expected.kind === 'dataRef' &&
      expected.enabled &&
      !expected.interacting &&
      latest.drag?.enabled !== false &&
      !latest.drag?.isInteracting &&
      !livePage.code?.enabled &&
      latest.owner.canChoose()
    );
  };
  // Render can retire a capability, but cannot publish a draft or close another owner.
  if (pending.current && !same(pending.current.context, context)) pending.current.active = false;
  useLayoutEffect(() => {
    const receipt = pending.current;
    if (receipt && !allowed(receipt)) retire(receipt);
  });
  useLayoutEffect(() => {
    mounted.current = true;
    // StrictEffects can set up this mounted host again after retiring its old
    // handlers. Bind fresh closures without reviving them or acknowledging drafts.
    if (!permission.current.active) setMountCommit((value) => value + 1);
    const stopDocument = owner.document.subscribe(invalidate);
    const stopDraft = owner.subscribeDraft(invalidate);
    return () => {
      mounted.current = false;
      permission.current.active = false;
      const receipt = pending.current;
      if (receipt) retire(receipt);
      stopDocument();
      stopDraft();
    };
  }, [owner.document, owner.subscribeDraft]);

  // This closure keeps its own subject even if an old BaseUI close arrives later.
  let callbackReceipt = presentation;
  const changeOpen = (next: boolean) => {
    if (!next) {
      if (callbackReceipt) retire(callbackReceipt);
      return;
    }
    if (
      callbackReceipt ||
      pending.current ||
      permission.current !== generation ||
      !generation.active
    )
      return;
    if (!allowed(generation)) {
      invalidate();
      return;
    }
    generation.active = false;
    const receipt: Receipt = { context, epoch: epoch.current, active: true, choose: onChoose };
    callbackReceipt = receipt;
    pending.current = receipt;
    setPresentation(receipt);
  };
  const choose = (receipt: Receipt, path: string) => {
    if (pending.current !== receipt) {
      retire(receipt);
      return;
    }
    if (!allowed(receipt)) {
      invalidate();
      return;
    }
    if (!choices.paths.includes(path)) return;
    retire(receipt);
    receipt.choose(path);
  };
  const open = !!presentation?.active && pending.current === presentation;
  return (
    <Menu.Root open={open} onOpenChange={changeOpen} modal={false}>
      <Menu.Trigger
        ref={trigger}
        render={<Button variant="ghost" />}
        disabled={!source || !context.enabled || context.interacting}
        aria-label={`${label}初始值路径`}
        className="max-w-full text-xs"
      >
        初始值路径
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={4}
          align="start"
          className="select-positioner max-w-[var(--available-width)]"
        >
          <Menu.Popup
            aria-label={`${label}初始值路径选项`}
            className="ui-menu flex max-h-[var(--available-height)] w-[min(360px,calc(100vw-24px))] max-w-full flex-col"
          >
            <p className="shrink-0 px-2 py-1 text-[11px] break-words text-slate-500">
              初始值路径 · {source?.id}；运行数据可能不同。
            </p>
            <div className="min-h-0 max-h-[min(280px,var(--available-height))] overflow-y-auto overscroll-contain">
              {presentation &&
                choices.paths.map((path) => (
                  <Menu.Item
                    key={path}
                    label={path}
                    className="ui-menu-item whitespace-normal break-all"
                    closeOnClick={false}
                    onClick={() => choose(presentation, path)}
                  >
                    <code className="min-w-0 flex-1">{path}</code>
                    {path === '[]' && <span className="ml-2 text-slate-500">完整值</span>}
                  </Menu.Item>
                ))}
            </div>
            {choices.truncated ? (
              <p className="shrink-0 px-2 py-1 text-[11px] text-slate-500">
                初始值路径较多，仅显示部分；可继续手动填写路径。
              </p>
            ) : (
              choices.paths.length === 1 && (
                <p className="shrink-0 px-2 py-1 text-[11px] text-slate-500">
                  初始值没有嵌套路径。
                </p>
              )
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
