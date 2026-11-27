import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { selectedNodeIds } from '../../packages/editor/selection';
import type { ActionCall, DataSourceDefinition, PageSchema } from '../../packages/schema/types';
import { useDragDrop } from './DragDrop';
import { initialReferencePaths, ReferencePathMenuView } from './ReferencePaths';
import type { BindingDraft } from './ValueEditor';

export type EventReferenceContext = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  nodeId: string;
  eventName: string;
  savedActions: ActionCall[] | undefined;
};
type EventReferenceCall = {
  id: string;
  action: string;
  input: Record<string, BindingDraft>;
};
export type EventReferenceOwner = EventReferenceContext & {
  draftKey: string;
  eventSource: string;
  entryIdentity: object;
  draftIdentity: { calls: EventReferenceCall[] };
  callIdentity: EventReferenceCall;
  index: number;
  callId: string;
  action: string;
  parameter: string;
  subscribeDraft: (listener: () => void) => () => void;
  requestCallerRender?: () => void;
  canChoose: () => boolean;
};

type Context = {
  document: EditorDocument;
  plan: EditorSnapshot['plan'];
  selection: EditorSnapshot['selection'];
  page: PageSchema;
  source: DataSourceDefinition | undefined;
  nodeId: string;
  eventName: string;
  savedActions: ActionCall[] | undefined;
  eventSource: string;
  draftKey: string;
  entry: object;
  draft: EventReferenceOwner['draftIdentity'];
  call: EventReferenceCall;
  index: number;
  callId: string;
  action: string;
  parameter: string;
  binding: BindingDraft;
  kind: BindingDraft['kind'];
  sourceId: string;
  path: string;
  subscribeDraft: EventReferenceOwner['subscribeDraft'];
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

/** Node-event opt-in; an option owns one exact caller draft and call position. */
export function EventReferencePaths({
  owner,
  page,
  source,
  binding,
  onChoose,
  label,
}: {
  owner: EventReferenceOwner;
  page: PageSchema;
  source: DataSourceDefinition | undefined;
  binding: BindingDraft;
  onChoose: (path: string) => void;
  label: string;
}) {
  const drag = useDragDrop();
  const trigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const blockedCaller = useRef<EventReferenceOwner | null>(null);
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
    eventName: owner.eventName,
    savedActions: owner.savedActions,
    eventSource: owner.eventSource,
    draftKey: owner.draftKey,
    entry: owner.entryIdentity,
    draft: owner.draftIdentity,
    call: owner.callIdentity,
    index: owner.index,
    callId: owner.callId,
    action: owner.action,
    parameter: owner.parameter,
    binding,
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
    blockedCaller.current = caller;
    permission.current.active = false;
    const receipt = pending.current;
    if (receipt) retire(receipt);
    // Only the real ActionChainEditor/useDraft render can acknowledge this caller.
    caller.requestCallerRender?.();
  };
  const allowed = (captured: Permission) => {
    const latest = current.current;
    const expected = captured.context;
    const actual = expected.document.getSnapshot();
    const livePage = actual.plan.pages.get(actual.selection.pageId)?.schema;
    const node = livePage && findNode(livePage, expected.nodeId)?.node;
    const component = node && actual.plan.registry.components[node.component];
    const action =
      actual.plan.pages.get(actual.selection.pageId)?.actions[expected.action] ??
      actual.plan.registry.actions[expected.action];
    const call = expected.draft.calls[expected.index];
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
      !!component?.events?.includes(expected.eventName) &&
      (!node.field ||
        !['onChange', 'onValueChange', 'onCheckedChange', 'onBlur'].includes(expected.eventName)) &&
      node.on?.[expected.eventName] === expected.savedActions &&
      !!action &&
      Object.hasOwn(action.input, expected.parameter) &&
      call === expected.call &&
      call.id === expected.callId &&
      call.action === expected.action &&
      call.input[expected.parameter] === expected.binding &&
      expected.binding.kind === expected.kind &&
      expected.binding.sourceId === expected.sourceId &&
      expected.binding.path === expected.path &&
      expected.kind === 'dataRef' &&
      !!expected.source &&
      livePage.dataSources?.find((entry) => entry.id === expected.sourceId) === expected.source &&
      expected.enabled &&
      !expected.interacting &&
      latest.drag?.enabled !== false &&
      !latest.drag?.isInteracting &&
      !livePage.code?.enabled &&
      latest.owner.canChoose()
    );
  };
  if (pending.current && !same(pending.current.context, context)) pending.current.active = false;
  useLayoutEffect(() => {
    const receipt = pending.current;
    if (receipt && !allowed(receipt)) retire(receipt);
  });
  useLayoutEffect(() => {
    mounted.current = true;
    // StrictEffects rebinds fresh closures; it never acknowledges a blocked caller.
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

  // A delayed close retains its own receipt, never the newest pending menu.
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
    <ReferencePathMenuView
      open={open}
      onOpenChange={changeOpen}
      triggerRef={trigger}
      sourceId={source?.id}
      disabled={!source || !context.enabled || context.interacting}
      label={label}
      choices={{ paths: presentation ? choices.paths : [], truncated: choices.truncated }}
      onChoose={(path) => presentation && choose(presentation, path)}
    />
  );
}
