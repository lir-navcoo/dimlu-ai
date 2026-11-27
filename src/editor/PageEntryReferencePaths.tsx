import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { ActionCall, DataSourceDefinition, PageSchema } from '../../packages/schema/types';
import { useDragDrop } from './DragDrop';
import { initialReferencePaths, ReferencePathMenuView } from './ReferencePaths';
import type { BindingDraft } from './ValueEditor';

export type PageEntryReferenceContext = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  pageId: string;
  savedActions: ActionCall[] | undefined;
  pageSource: string;
  canReference: () => boolean;
};
type PageEntryReferenceCall = {
  id: string;
  action: string;
  input: Record<string, BindingDraft>;
};
export type PageEntryReferenceOwner = PageEntryReferenceContext & {
  draftKey: string;
  bindingIdentity: BindingDraft;
  entryIdentity: object;
  parentGeneration: object;
  authoringAllowed: boolean;
  draftIdentity: { calls: PageEntryReferenceCall[] };
  callIdentity: PageEntryReferenceCall;
  index: number;
  callId: string;
  action: string;
  parameter: string;
  subscribeDraft: (listener: () => void) => () => void;
  requestCallerRender?: () => void;
  canChoose: () => boolean;
  choosePath: (path: string) => void;
};

type Context = {
  document: EditorDocument;
  plan: EditorSnapshot['plan'];
  selection: EditorSnapshot['selection'];
  page: PageSchema;
  source: DataSourceDefinition | undefined;
  pageId: string;
  parentGeneration: object;
  authoringAllowed: boolean;
  savedActions: ActionCall[] | undefined;
  pageSource: string;
  draftKey: string;
  entry: object;
  draft: PageEntryReferenceOwner['draftIdentity'];
  call: PageEntryReferenceCall;
  index: number;
  callId: string;
  action: string;
  parameter: string;
  binding: BindingDraft;
  kind: BindingDraft['kind'];
  sourceId: string;
  path: string;
  subscribeDraft: PageEntryReferenceOwner['subscribeDraft'];
  enabled: boolean;
  interacting: boolean;
};
type Permission = { context: Context; epoch: number; active: boolean };
type Receipt = Permission & { choose: (path: string) => void; paths: string[]; consumed: boolean };
function pureParentCheck(owner: PageEntryReferenceOwner) {
  try {
    return owner.canReference() === true && owner.canChoose() === true;
  } catch {
    return false;
  }
}
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

/** Page-entry opt-in; choosing changes one captured parameter draft, never the page. */
export function PageEntryReferencePaths({
  owner,
  page,
  source,
  binding,
  label,
}: {
  owner: PageEntryReferenceOwner;
  page: PageSchema;
  source: DataSourceDefinition | undefined;
  binding: BindingDraft;
  label: string;
}) {
  const drag = useDragDrop();
  const trigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const epoch = useRef(0);
  const blockedCaller = useRef<PageEntryReferenceOwner | null>(null);
  const pending = useRef<Receipt | null>(null);
  const [presentation, setPresentation] = useState<Receipt | null>(null);
  const [, setMountCommit] = useState(0);
  const context: Context = {
    document: owner.document,
    plan: owner.snapshot.plan,
    selection: owner.snapshot.selection,
    page,
    source,
    pageId: owner.pageId,
    parentGeneration: owner.parentGeneration,
    authoringAllowed: owner.authoringAllowed,
    savedActions: owner.savedActions,
    pageSource: owner.pageSource,
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
  // Consumed choices still need this pure owner check after presentation retirement.
  const ownerMatches = (captured: Permission) => {
    const latest = current.current;
    const expected = captured.context;
    const actual = expected.document.getSnapshot();
    const livePage = actual.plan.pages.get(actual.selection.pageId)?.schema;
    const action =
      actual.plan.pages.get(actual.selection.pageId)?.actions[expected.action] ??
      actual.plan.registry.actions[expected.action];
    const call = expected.draft.calls[expected.index];
    return (
      mounted.current &&
      captured.epoch === epoch.current &&
      blockedCaller.current !== latest.owner &&
      same(expected, latest.context) &&
      visible(trigger.current) &&
      actual.plan === expected.plan &&
      actual.selection === expected.selection &&
      actual.selection.pageId === expected.pageId &&
      livePage === expected.page &&
      livePage?.onEnter === expected.savedActions &&
      JSON.stringify(livePage) === expected.pageSource &&
      expected.draftKey === `page-enter:${expected.pageId}` &&
      expected.authoringAllowed &&
      latest.owner.authoringAllowed &&
      !!action &&
      Object.hasOwn(action.input, expected.parameter) &&
      call === expected.call &&
      call.id === expected.callId &&
      call.action === expected.action &&
      call.input[expected.parameter] === expected.binding &&
      latest.owner.bindingIdentity === expected.binding &&
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
      pureParentCheck(latest.owner)
    );
  };
  const allowed = (captured: Permission) => captured.active && ownerMatches(captured);
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
    const receipt: Receipt = {
      context,
      epoch: epoch.current,
      active: true,
      choose: owner.choosePath,
      paths: choices.paths,
      consumed: false,
    };
    callbackReceipt = receipt;
    pending.current = receipt;
    setPresentation(receipt);
  };
  const choose = (receipt: Receipt, path: string) => {
    if (pending.current !== receipt || receipt.consumed) {
      retire(receipt);
      return;
    }
    if (!allowed(receipt)) {
      invalidate();
      return;
    }
    if (!receipt.paths.includes(path)) return;
    receipt.consumed = true;
    retire(receipt);
    // Closing can reenter. Never borrow a new owner or disturb a replacement menu.
    if (!pending.current && ownerMatches(receipt)) receipt.choose(path);
  };
  const open = !!presentation?.active && pending.current === presentation;
  return (
    <ReferencePathMenuView
      open={open}
      onOpenChange={changeOpen}
      triggerRef={trigger}
      sourceId={source?.id}
      disabled={!source || !context.authoringAllowed || !context.enabled || context.interacting}
      label={label}
      choices={{ paths: presentation ? choices.paths : [], truncated: choices.truncated }}
      onChoose={(path) => presentation && choose(presentation, path)}
    />
  );
}
