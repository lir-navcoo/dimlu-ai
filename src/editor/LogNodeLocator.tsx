import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import type { ApplicationPlan, PageRuntime, RuntimeRecord } from '../../packages/runtime/engine';
import type { LocateRequest, NavigationSnapshot } from './navigation';
import { Button, Tip } from '../ui/primitives';
import { useAuthorGuard } from './author-guard';
import { useDragDrop } from './DragDrop';
import { useEditorNavigation, useEditorSession } from './session';

/** One host presentation, not a persisted document or runtime operation. */
export type LogPresentation = {
  token: object;
  document: EditorDocument;
  runtime: PageRuntime;
  expected: EditorSnapshot;
  active: boolean;
};
export type LogPresentationBridge = {
  current: LogPresentation | null;
  ready: boolean;
  awaitingHost?: boolean;
  read: () => LogPresentation | null;
  prepare: (owner: LogPresentation) => boolean;
  release: (owner: LogPresentation) => void;
};
type Input = {
  document: EditorDocument;
  plan: ApplicationPlan;
  runtime: PageRuntime;
  authorSnapshot?: EditorSnapshot;
  authoringAllowed?: boolean;
  presentation?: LogPresentationBridge;
  open: boolean;
  tab: string;
  maximized: boolean;
};
type RecordOwner = {
  record: RuntimeRecord;
  fields: RuntimeRecord;
  runtime: PageRuntime;
  active: boolean;
};
type Context = {
  document: EditorDocument;
  runtime: PageRuntime;
  instanceId: number;
  plan: ApplicationPlan;
  selection: EditorSnapshot['selection'];
  supported: boolean;
  allowed: boolean;
  code: boolean;
  enabled: boolean;
  interacting: boolean;
  open: boolean;
  tab: string;
  maximized: boolean;
  publication: number;
};
type Permission = { context: Context; active: boolean };
type Pending = {
  active: boolean;
  phase: 'select' | 'presenting' | 'requesting' | 'awaiting-tree';
  context: Context;
  record: RecordOwner;
  initial: EditorSnapshot;
  candidate?: EditorSnapshot;
  result?: EditorSnapshot;
  expectedPublications: number;
  publications: number;
  origin: HTMLButtonElement;
  owner: Document;
  presentation?: LogPresentation;
  installed: boolean;
  acknowledged: boolean;
  closed: boolean;
  request?: LocateRequest;
  requestReturned: boolean;
  navigationPublications: number;
  observedNavigation: NavigationSnapshot;
  cleanup: () => void;
};
function same<T extends object>(left: T, right: T) {
  return (Object.keys(right) as (keyof T)[]).every((key) => left[key] === right[key]);
}
export function isLogHostVisible(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.hasAttribute('inert') || current.hasAttribute('data-closed'))
      return false;
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === 'none' ||
      style?.visibility === 'hidden' ||
      style?.visibility === 'collapse'
    )
      return false;
  }
  return true;
}
function leftHost(owner: Document) {
  const host = owner.getElementById('left-panel');
  return host instanceof HTMLElement && isLogHostVisible(host) ? host : null;
}
function focusedDefinition(
  pending: Pending,
  target: EventTarget | null = pending.owner.activeElement,
) {
  if (!(target instanceof HTMLButtonElement) || !target.matches('.tree-select') || target.disabled)
    return false;
  const row = target.closest<HTMLElement>('[data-editor-tree-node]');
  const host = leftHost(pending.owner);
  return (
    !!host &&
    !!row &&
    host.contains(target) &&
    row.dataset.editorTreeNode === pending.record.fields.nodeId &&
    row.querySelector('.tree-select') === target &&
    isLogHostVisible(target)
  );
}
function selectionResult(actual: EditorSnapshot, pending: Pending) {
  return (
    actual.plan === pending.initial.plan &&
    actual.revision === pending.initial.revision &&
    actual.change === pending.initial.change &&
    actual.canUndo === pending.initial.canUndo &&
    actual.canRedo === pending.initial.canRedo &&
    actual.selection.pageId === pending.initial.selection.pageId &&
    actual.selection.nodeId === pending.record.fields.nodeId &&
    !actual.selection.nodeIds
  );
}

/** Bridges one current execution record to the existing structure consumer. */
export function useLogNodeLocator(input: Input) {
  const drag = useDragDrop();
  const session = useEditorSession();
  const { navigation, state: navigationState } = useEditorNavigation();
  const snapshot = input.authorSnapshot ?? input.document.getSnapshot();
  const supported = !!input.authorSnapshot && !!input.presentation;
  const canAuthor = useAuthorGuard(
    input.document,
    snapshot,
    undefined,
    supported && input.authoringAllowed === true,
    'author',
  );
  const mounted = useRef(false);
  const [publication, setPublication] = useState(0);
  const [requestCommit, setRequestCommit] = useState<LocateRequest | null>(null);
  const [preparedCommit, setPreparedCommit] = useState<LogPresentation | null>(null);
  const pending = useRef<Pending | null>(null);
  const records = useRef(new WeakMap<RuntimeRecord, RecordOwner>());
  const retained = useRef(new Set<RecordOwner>());
  const current = useRef({ input, drag, snapshot, session });
  current.current = { input, drag, snapshot, session };
  const pageId = snapshot.selection.pageId;
  const context: Context = {
    document: input.document,
    runtime: input.runtime,
    instanceId: input.runtime.instanceId,
    plan: snapshot.plan,
    selection: snapshot.selection,
    supported,
    allowed: input.authoringAllowed === true,
    code: !!snapshot.plan.pages.get(pageId)?.schema.code?.enabled,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
    open: input.open,
    tab: input.tab,
    maximized: input.maximized,
    publication,
  };
  const permission = useRef<Permission>({ context, active: true });
  if (!permission.current.active || !same(permission.current.context, context)) {
    permission.current.active = false;
    permission.current = { context, active: true };
  }
  const generation = permission.current;

  const recordCurrent = (record: RecordOwner) => {
    if (
      !record.active ||
      !record.runtime.getRecords().includes(record.record) ||
      !(['sequence', 'time', 'level', 'kind', 'message', 'nodeId'] as const).every(
        (key) => record.record[key] === record.fields[key],
      )
    )
      record.active = false;
    // Context changes retire callbacks and pending navigation, not authentic
    // records still retained by their own non-disposed runtime.
    return record.active && record.runtime === current.current.input.runtime;
  };
  const recordOwner = (record: RuntimeRecord) => {
    let owner = records.current.get(record);
    if (!owner) {
      owner = { record, fields: { ...record }, runtime: input.runtime, active: true };
      records.current.set(record, owner);
      retained.current.add(owner);
    }
    return owner;
  };
  const domainCurrent = (captured: Context) => {
    const latest = current.current;
    const actual = latest.input.document.getSnapshot();
    return (
      mounted.current &&
      captured.supported &&
      captured.allowed &&
      !captured.code &&
      captured.enabled &&
      !captured.interacting &&
      latest.input.document === captured.document &&
      latest.input.authorSnapshot !== undefined &&
      latest.input.presentation !== undefined &&
      latest.input.authoringAllowed === captured.allowed &&
      latest.input.runtime === captured.runtime &&
      captured.runtime.instanceId === captured.instanceId &&
      !captured.runtime.disposed &&
      latest.input.plan === captured.plan &&
      actual.plan === captured.plan &&
      captured.runtime.plan === captured.plan &&
      actual.selection.pageId === captured.selection.pageId &&
      captured.runtime.page === captured.plan.pages.get(captured.selection.pageId) &&
      !actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled &&
      (latest.drag?.enabled !== false) === captured.enabled &&
      !!latest.drag?.isInteracting === captured.interacting &&
      latest.input.tab === captured.tab &&
      latest.input.maximized === captured.maximized
    );
  };
  const inspect = (target: Pending) => {
    if (!target.active) return false;
    const latest = current.current;
    const actual = target.context.document.getSnapshot();
    if (
      pending.current !== target ||
      !domainCurrent(target.context) ||
      !recordCurrent(target.record) ||
      target.publications > target.expectedPublications ||
      !findNode(
        actual.plan.pages.get(actual.selection.pageId)!.schema,
        target.record.fields.nodeId!,
      )
    ) {
      target.active = false;
      return false;
    }
    if (actual !== target.initial) {
      if (
        target.expectedPublications !== 1 ||
        !selectionResult(actual, target) ||
        (target.candidate && target.candidate !== actual)
      )
        target.active = false;
      else target.candidate = actual;
    } else if (target.candidate) target.active = false;
    if (
      latest.input.authorSnapshot !== target.initial &&
      latest.input.authorSnapshot !== target.candidate
    )
      target.active = false;
    if (target.result && actual !== target.result) target.active = false;
    if (target.phase === 'select') {
      if (!latest.input.open) target.active = false;
    } else {
      const bridge = latest.input.presentation;
      if (!latest.input.open) target.closed = true;
      else if (target.closed) target.active = false;
      if (
        target.installed &&
        (!target.presentation?.active || latest.input.presentation?.read() !== target.presentation)
      )
        target.active = false;
      if (
        target.acknowledged &&
        (latest.input.open ||
          latest.session.leftTab !== 'structure' ||
          !latest.session.leftOpen ||
          !bridge ||
          bridge.current !== target.presentation ||
          (!bridge.ready && (target.phase !== 'presenting' || !bridge.awaitingHost)))
      )
        target.active = false;
    }
    return target.active;
  };
  const finish = (target: Pending) => {
    // Retire before publishing a cancellation; subscribers must not reenter it.
    target.active = false;
    if (target.presentation) target.presentation.active = false;
    // Defer cleanup until the owned method returns its exact local request.
    // Nested publications cannot identify that object for this invocation.
    if (target.phase === 'requesting' && !target.requestReturned) return;
    target.cleanup();
    target.cleanup = () => {};
    if (pending.current === target) pending.current = null;
    if (target.request && navigation.isCurrent(target.request))
      navigation.complete(target.request, '');
    if (target.presentation) current.current.input.presentation?.release(target.presentation);
    setRequestCommit((value) => (value === target.request ? null : value));
    setPreparedCommit((value) => (value === target.presentation ? null : value));
  };
  const cancel = () => {
    permission.current.active = false;
    const target = pending.current;
    if (target) finish(target);
  };
  const observe = useRef({ inspect, finish });
  observe.current = { inspect, finish };
  // Rendering only retires capabilities. Publications/cleanup happen in effects.
  if (pending.current) inspect(pending.current);
  // Capture even records without a node: adding an ID later must not turn a
  // previously observed record with altered identity into a fresh locator.
  for (const record of input.runtime.getRecords()) recordOwner(record);
  for (const entry of retained.current) {
    recordCurrent(entry);
    if (!entry.active) retained.current.delete(entry);
  }
  useLayoutEffect(() => {
    mounted.current = true;
    if (!permission.current.active) {
      permission.current = { context, active: true };
      setPublication((value) => value + 1);
    }
    return () => {
      mounted.current = false;
      permission.current.active = false;
      const target = pending.current;
      if (target) observe.current.finish(target);
    };
  }, []);
  useLayoutEffect(() => {
    const stopDocument = input.document.subscribe(() => {
      if (!mounted.current || current.current.input.document !== input.document) return;
      permission.current.active = false;
      const target = pending.current;
      if (target) {
        target.publications++;
        if (!observe.current.inspect(target)) observe.current.finish(target);
      }
      setPublication((value) => value + 1);
    });
    const stopRuntime = input.runtime.subscribeMeta(() => {
      for (const entry of retained.current) {
        recordCurrent(entry);
        if (!entry.active) retained.current.delete(entry);
      }
      const target = pending.current;
      if (target && !observe.current.inspect(target)) observe.current.finish(target);
    });
    return () => {
      stopDocument();
      stopRuntime();
    };
  }, [input.document, input.runtime]);

  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    if (!inspect(target)) {
      finish(target);
      return;
    }
    if (
      target.phase !== 'presenting' ||
      !target.installed ||
      preparedCommit !== target.presentation
    )
      return;
    target.acknowledged = true;
    const bridge = input.presentation;
    if (
      !bridge ||
      bridge.current !== target.presentation ||
      bridge.read() !== target.presentation ||
      input.open ||
      session.leftTab !== 'structure' ||
      !session.leftOpen ||
      input.authorSnapshot !== target.result ||
      target.publications !== target.expectedPublications
    ) {
      finish(target);
      return;
    }
    if (!bridge.ready) {
      // Only an explicitly registered host lifecycle may outlive this ACK.
      // An arbitrary false-ready bridge must settle on this bounded commit.
      if (!bridge.awaitingHost) finish(target);
      return;
    }
    if (!leftHost(target.owner)) {
      finish(target);
      return;
    }
    target.phase = 'requesting';
    const request = navigation.requestLocateOwned('tree', target.record.fields.nodeId!);
    // A retired or replaced receipt still cleans up only its own returned R1.
    target.requestReturned = true;
    target.request = request ?? undefined;
    if (
      !request ||
      !inspect(target) ||
      target.navigationPublications !== 1 ||
      !target.request ||
      navigation.getSnapshot().request !== target.request ||
      !navigation.isCurrent(target.request)
    ) {
      finish(target);
      return;
    }
    target.phase = 'awaiting-tree';
    target.observedNavigation = navigation.getSnapshot();
    setRequestCommit(target.request);
  });
  // This effect is gated on the actual request being committed to this consumer
  // render. The tree's corresponding layout effect has already queued its RAF.
  useEffect(() => {
    const target = pending.current;
    if (
      !target?.active ||
      target.phase !== 'awaiting-tree' ||
      !requestCommit ||
      target.request !== requestCommit ||
      navigationState.request !== requestCommit
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (pending.current !== target) return;
      // A consumer completion normally finishes synchronously in its subscription.
      // One bounded frame terminates a missing/hidden consumer; it never refocuses.
      finish(target);
    });
    return () => cancelAnimationFrame(frame);
  }, [requestCommit, navigationState.request]);

  const run = (
    record: RecordOwner,
    captured: Permission,
    guard: () => boolean,
    origin: HTMLButtonElement,
  ) => {
    if (!captured.active || permission.current !== captured) return;
    if (!domainCurrent(captured.context) || !guard()) {
      captured.active = false;
      return;
    }
    if (!recordCurrent(record)) return;
    const latest = current.current;
    const initial = latest.input.document.getSnapshot();
    const nodeId = record.fields.nodeId;
    if (
      !nodeId ||
      !latest.input.open ||
      latest.input.tab !== 'logs' ||
      initial.selection !== captured.context.selection ||
      latest.input.authorSnapshot?.selection !== captured.context.selection ||
      latest.input.authorSnapshot?.plan !== initial.plan ||
      !findNode(initial.plan.pages.get(initial.selection.pageId)!.schema, nodeId)
    ) {
      captured.active = false;
      return;
    }
    if (pending.current) finish(pending.current);
    const baseline = navigation.getSnapshot();
    const target: Pending = {
      active: true,
      phase: 'select',
      context: captured.context,
      record,
      initial,
      expectedPublications:
        initial.selection.nodeId === nodeId && !initial.selection.nodeIds ? 0 : 1,
      publications: 0,
      origin,
      owner: origin.ownerDocument,
      installed: false,
      acknowledged: false,
      closed: false,
      navigationPublications: 0,
      observedNavigation: baseline,
      requestReturned: false,
      cleanup: () => {},
    };
    pending.current = target;
    const stopNavigation = navigation.subscribe(() => {
      if (!target.active || pending.current !== target) return;
      if (!inspect(target)) {
        finish(target);
        return;
      }
      const state = navigation.getSnapshot();
      if (target.phase === 'requesting') {
        target.navigationPublications++;
        const request = state.request;
        if (
          target.navigationPublications !== 1 ||
          !request ||
          request.document !== target.context.document ||
          request.plan !== target.context.plan ||
          request.selection !== target.result?.selection ||
          request.pageId !== target.initial.selection.pageId ||
          request.nodeId !== nodeId ||
          request.destination !== 'tree' ||
          request.instanceKey !== undefined
        ) {
          finish(target);
          return;
        }
      } else if (
        (target.phase === 'presenting' || target.phase === 'awaiting-tree') &&
        state.hover !== target.observedNavigation.hover &&
        state.enabled === target.observedNavigation.enabled &&
        state.message === target.observedNavigation.message &&
        state.selectedInstance === target.observedNavigation.selectedInstance &&
        state.request === target.observedNavigation.request &&
        (target.phase === 'presenting'
          ? state.request === baseline.request
          : !!target.request &&
            state.request === target.request &&
            navigation.isCurrent(target.request))
      ) {
        // Own layout changes can expose hover targets before the existing tree
        // consumer focuses. Only hover metadata may change; ownership stays exact.
        target.observedNavigation = state;
      } else if (target.phase === 'awaiting-tree') {
        if (state.request === null && focusedDefinition(target)) {
          // Only a real, visible active definition plus the exact consumer
          // completion is success. No subsequent operation claims its focus.
          finish(target);
        } else finish(target);
      } else if (state !== baseline) finish(target);
    });
    const interaction = () => finish(target);
    const focus = (event: FocusEvent) => {
      if (!target.active) return;
      if (
        !inspect(target) ||
        (event.target !== origin &&
          event.target !== target.owner.body &&
          !(
            (target.phase === 'requesting' || target.phase === 'awaiting-tree') &&
            focusedDefinition(target, event.target)
          ))
      )
        finish(target);
    };
    target.owner.addEventListener('pointerdown', interaction, true);
    target.owner.addEventListener('keydown', interaction, true);
    target.owner.addEventListener('focusin', focus, true);
    target.cleanup = () => {
      stopNavigation();
      target.owner.removeEventListener('pointerdown', interaction, true);
      target.owner.removeEventListener('keydown', interaction, true);
      target.owner.removeEventListener('focusin', focus, true);
    };
    try {
      latest.input.document.select(initial.selection.pageId, nodeId);
      const result = latest.input.document.getSnapshot();
      if (
        !inspect(target) ||
        target.publications !== target.expectedPublications ||
        !selectionResult(result, target) ||
        (target.expectedPublications === 0 ? result !== initial : result !== target.candidate)
      ) {
        finish(target);
        return;
      }
      target.result = result;
      target.phase = 'presenting';
      target.presentation = {
        token: {},
        document: latest.input.document,
        runtime: latest.input.runtime,
        expected: result,
        active: true,
      };
      if (!current.current.input.presentation?.prepare(target.presentation)) {
        finish(target);
        return;
      }
      target.installed = true;
      if (!inspect(target)) finish(target);
      else setPreparedCommit(target.presentation);
    } catch (error) {
      finish(target);
      throw error;
    }
  };

  const control = (record: RuntimeRecord) => {
    const target = recordOwner(record);
    const currentRuntime =
      supported &&
      recordCurrent(target) &&
      !input.runtime.disposed &&
      input.runtime.plan === input.plan &&
      snapshot.plan === input.plan &&
      input.runtime.page === input.plan.pages.get(snapshot.selection.pageId);
    if (!currentRuntime || !record.nodeId || !findNode(input.runtime.page.schema, record.nodeId))
      return null;
    const help = !input.authoringAllowed
      ? '切回编辑模式后定位'
      : context.code
        ? '代码页面不支持定位组件'
        : !context.enabled || context.interacting
          ? '结束拖拽后定位'
          : '在结构中定位组件定义';
    return (
      <LogNodeLocator
        record={record}
        disabled={!context.allowed || context.code || !context.enabled || context.interacting}
        help={help}
        onLocate={(origin) => run(target, generation, canAuthor, origin)}
      />
    );
  };
  return { control, cancel };
}

export function LogNodeLocator({
  record,
  disabled,
  help,
  onLocate,
}: {
  record: RuntimeRecord;
  disabled: boolean;
  help: string;
  onLocate: (origin: HTMLButtonElement) => void;
}) {
  return (
    <Tip content={help}>
      <Button
        variant="ghost"
        aria-label={`在结构中定位组件定义 ${record.nodeId} · ${record.kind} · ${record.sequence}`}
        disabled={disabled}
        onClick={(event) => onLocate(event.currentTarget)}
      >
        <LocateFixed size={13} />
      </Button>
    </Tip>
  );
}
