import { editorContext } from './context';
import { createPortal } from 'react-dom';
import { Button, Select, Tip } from '../ui/primitives';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ApplicationPlan } from '../../packages/runtime/engine';
import {
  findNode,
  type EditorDocument,
  type EditorSnapshot,
  type InsertTarget,
} from '../../packages/editor/document';
import { resolveDrop, type DragSource, type DropIntent } from '../../packages/editor/drop';
import type { NodeSchema } from '../../packages/schema/types';
import { describeNodeName } from './node-display-name';
import {
  cloneMaterialTemplate,
  type MaterialTemplate,
} from '../../packages/editor/material-template';
import { catalog } from './catalog';
import { errorText } from './errors';
import { hitTestDrop } from './hit-test';
import { clippingBounds, documentViewport } from './CanvasHost';
import {
  canvasBoundary,
  canvasHitAtPoint,
  clientBounds,
  fromParentPoint,
  scrollByScreen,
  toParentPoint,
  toParentRect,
  visualScale,
} from './coordinates';
import { selectedNodeIds } from '../../packages/editor/selection';
import { isAuthorEscape, isEscapeTextTarget } from './author-escape';
import { useCanvasStageVersion, type CanvasStage } from './canvas-stage';
type Point = {
  x: number;
  y: number;
};
interface Candidate {
  intent: DropIntent;
  target?: InsertTarget;
  valid: boolean;
  label: string;
  reason?: string;
}
interface Session {
  source: DragSource;
  document: EditorDocument;
  selection: EditorSnapshot['selection'];
  pageId: string;
  plan: ApplicationPlan;
  method: 'pointer' | 'keyboard';
  point: Point;
  pointerId?: number;
  candidate?: Candidate;
}
interface DragApi {
  stage?: CanvasStage;
  enabled: boolean;
  multiSelected: boolean;
  session: Session | null;
  /** Includes a pointer gesture before it crosses the drag threshold. */
  isInteracting: boolean;
  begin: (source: DragSource, event?: ReactPointerEvent<HTMLElement>) => void;
  finish: () => void;
  cancel: () => void;
  choose: (intent: DropIntent) => void;
  /** Offered during Canvas capture, invoked only if this exact event reaches window bubble. */
  offerCanvasEscape: (event: KeyboardEvent, action: () => boolean) => void;
}
const DragContext = editorContext<DragApi | null>('drag', null);
export const useDragDrop = () => useContext(DragContext);
const intentKey = (intent: DropIntent) => JSON.stringify(intent);
export function materialTemplate(component: string): MaterialTemplate {
  const meta = Object.hasOwn(catalog, component) ? catalog[component] : undefined;
  if (!meta || meta.insertable === false)
    throw new Error('该物料需要先配置上下文，暂不支持直接拖入');
  return cloneMaterialTemplate({
    component,
    props: meta.defaultProps,
    ...(meta.initialChildren !== undefined ? { children: meta.initialChildren } : {}),
  });
}
export function materialNode(component: string): Omit<NodeSchema, 'id'> {
  const meta = Object.hasOwn(catalog, component) ? catalog[component] : undefined;
  if (!meta || meta.insertable === false)
    throw new Error('该物料需要先配置上下文，暂不支持直接拖入');
  return {
    component,
    props: Object.fromEntries(
      Object.entries(meta.defaultProps).map(([name, value]) => [name, { kind: 'literal', value }]),
    ),
  };
}
function nodeLabel(plan: ApplicationPlan, pageId: string, id: string) {
  const node = findNode(plan.pages.get(pageId)!.schema, id)?.node;
  return node ? describeNodeName(node, catalog[node.component]?.title ?? node.component) : id;
}
function intentLabel(plan: ApplicationPlan, pageId: string, intent: DropIntent) {
  if (intent.kind !== 'inside')
    return `${nodeLabel(plan, pageId, intent.nodeId)}${intent.kind === 'before' ? '之前' : '之后'}`;
  return intent.parentId
    ? `${nodeLabel(plan, pageId, intent.parentId)} / ${intent.slot ?? '子节点'}末尾`
    : '页面末尾';
}
/** Scroll only the canvas or the visible component-tree panel beneath a client-space pointer. */
export function autoScrollAtPoint(
  point: Point,
  hit: Element | null = canvasHitAtPoint(point).element,
) {
  const boundary = hit && canvasBoundary(hit.ownerDocument);
  const panel = hit?.closest<HTMLElement>('.sidebar-content');
  const root =
    hit?.closest<HTMLElement>('.canvas-scroll') ??
    (panel?.querySelector('.component-tree') ? panel : null) ??
    (boundary?.document.scrollingElement as HTMLElement | null);
  if (!root || !hit) return false;
  let element: HTMLElement | null =
    hit instanceof hit.ownerDocument.defaultView!.HTMLElement ? hit : hit.parentElement;
  let movedX = false,
    movedY = false;
  const edge = (position: number, start: number, end: number) => {
    const before = position - start,
      after = end - position;
    return before < 30 && before <= after ? -12 : after < 30 ? 12 : 0;
  };
  while (element) {
    const style = element.ownerDocument.defaultView!.getComputedStyle(element),
      bounds = clippingBounds(element, root);
    if (bounds) {
      const scale = visualScale(element);
      const rawBounds = clientBounds(element);
      const mappedBounds = toParentRect(rawBounds, element.ownerDocument);
      const frameX = rawBounds.width && mappedBounds ? mappedBounds.width / rawBounds.width : 1;
      const frameY = rawBounds.height && mappedBounds ? mappedBounds.height / rawBounds.height : 1;
      scale.x *= frameX;
      scale.y *= frameY;
      let dx =
        !movedX &&
        /auto|scroll/.test(style.overflowX || style.overflow) &&
        element.scrollWidth > element.clientWidth
          ? edge(point.x, bounds.left, bounds.right)
          : 0;
      let dy =
        !movedY &&
        /auto|scroll/.test(style.overflowY || style.overflow) &&
        element.scrollHeight > element.clientHeight
          ? edge(point.y, bounds.top, bounds.bottom)
          : 0;
      const rangeX = Math.max(0, element.scrollWidth - element.clientWidth),
        rangeY = Math.max(0, element.scrollHeight - element.clientHeight);
      const minX = style.direction === 'rtl' ? -rangeX : 0,
        maxX = style.direction === 'rtl' ? 0 : rangeX;
      dx = Math.max(
        (minX - element.scrollLeft) * scale.x,
        Math.min(dx, (maxX - element.scrollLeft) * scale.x),
      );
      dy = Math.max(
        -element.scrollTop * scale.y,
        Math.min(dy, (rangeY - element.scrollTop) * scale.y),
      );
      const beforeX = element.scrollLeft,
        beforeY = element.scrollTop;
      scrollByScreen(element, { x: dx / frameX, y: dy / frameY });
      movedX ||= element.scrollLeft !== beforeX;
      movedY ||= element.scrollTop !== beforeY;
    }
    if (element === root || (movedX && movedY)) break;
    element = element.parentElement;
  }
  if (boundary) {
    const outer = boundary.parent.closest<HTMLElement>('.canvas-scroll');
    const mapped = toParentRect(documentViewport(boundary.document), boundary.document);
    if (outer && mapped) {
      const bounds = clientBounds(outer);
      const beforeX = outer.scrollLeft,
        beforeY = outer.scrollTop;
      scrollByScreen(outer, {
        x: !movedX
          ? edge(point.x, Math.max(bounds.left, mapped.left), Math.min(bounds.right, mapped.right))
          : 0,
        y: !movedY
          ? edge(point.y, Math.max(bounds.top, mapped.top), Math.min(bounds.bottom, mapped.bottom))
          : 0,
      });
      movedX ||= outer.scrollLeft !== beforeX;
      movedY ||= outer.scrollTop !== beforeY;
    }
  }
  return movedX || movedY;
}
export function DragDropProvider({
  stage,
  document,
  snapshot,
  enabled,
  children,
  onCommit,
}: {
  stage?: CanvasStage;
  document: EditorDocument;
  snapshot: EditorSnapshot;
  enabled: boolean;
  children: ReactNode;
  onCommit?: () => void;
}) {
  useCanvasStageVersion(stage);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [, setGestureActive] = useState(false);
  const [session, setSession] = useState<Session | null>(null),
    [notice, setNotice] = useState<{
      text: string;
      error?: boolean;
      document: EditorDocument;
      plan: ApplicationPlan;
      pageId: string;
    } | null>(null);
  const current = useRef({ document, snapshot, enabled, stage });
  current.current = { document, snapshot, enabled, stage };
  const active = useRef<Session | null>(null),
    pending = useRef<
      | (Session & {
          pointerId: number;
          start: Point;
        })
      | null
    >(null);
  const gestureGeneration = useRef(0),
    deferredBlur = useRef<object | null>(null);
  const capture = useRef<{
    element: HTMLElement;
    pointerId: number;
  } | null>(null);
  const cache = useRef(new Map<string, Candidate>()),
    suppressClick = useRef<HTMLElement | null>(null);
  const destination = useRef<HTMLLabelElement>(null);
  const composing = useRef(false);
  const canvasEscapes = useRef(
    new WeakMap<
      KeyboardEvent,
      {
        document: EditorDocument;
        plan: ApplicationPlan;
        selection: EditorSnapshot['selection'];
        focus: Element | null;
        owner: Document;
        action: () => boolean;
      }
    >(),
  );
  const offerCanvasEscape = (event: KeyboardEvent, action: () => boolean) => {
    const owner =
      stage?.current()?.author === event.target
        ? stage.current()!.environment.document
        : window.document;
    const latest = current.current,
      actual = latest.document.getSnapshot();
    if (
      !mounted.current ||
      !latest.enabled ||
      composing.current ||
      !isAuthorEscape(event) ||
      isEscapeTextTarget(event, destination.current, owner) ||
      active.current ||
      pending.current
    )
      return;
    canvasEscapes.current.set(event, {
      document: latest.document,
      plan: actual.plan,
      selection: actual.selection,
      focus: owner.activeElement,
      owner,
      action,
    });
  };
  const publish = (next: Session | null) => {
    active.current = next;
    setSession(next);
  };
  const cancel = () => {
    gestureGeneration.current++;
    deferredBlur.current = null;
    pending.current = null;
    setGestureActive(false);
    cache.current.clear();
    publish(null);
    const held = capture.current;
    capture.current = null;
    try {
      if (held?.element.hasPointerCapture?.(held.pointerId))
        held.element.releasePointerCapture(held.pointerId);
    } catch {
      // A retiring document can already have released its native pointer.
    }
  };
  const reportNotice = (source: Session, text: string, error?: boolean) => {
    setNotice({
      text,
      error,
      document: source.document,
      plan: source.document.getSnapshot().plan,
      pageId: source.pageId,
    });
  };
  const inspect = (drag: Session, intent: DropIntent): Candidate => {
    const key = intentKey(intent),
      cached = cache.current.get(key);
    if (cached) return cached;
    const label = intentLabel(drag.plan, drag.pageId, intent);
    let candidate: Candidate;
    try {
      const target = resolveDrop(drag.plan.pages.get(drag.pageId)!.schema, drag.source, intent);
      if (drag.source.kind === 'node')
        current.current.document.checkMove(drag.pageId, drag.source.nodeId, target);
      else
        current.current.document.checkInsertFragment(
          drag.pageId,
          materialTemplate(drag.source.component),
          target,
        );
      candidate = { intent, target, label, valid: true };
    } catch (error) {
      candidate = { intent, label, valid: false, reason: errorText(error) };
    }
    cache.current.set(key, candidate);
    return candidate;
  };
  const choose = (intent: DropIntent) => {
    const drag = active.current;
    if (drag) publish({ ...drag, candidate: inspect(drag, intent) });
  };
  const begin = (source: DragSource, event?: ReactPointerEvent<HTMLElement>) => {
    const actual = current.current.document.getSnapshot();
    if (
      !mounted.current ||
      current.current.document !== document ||
      actual.plan !== snapshot.plan ||
      actual.selection !== snapshot.selection ||
      actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled ||
      !current.current.enabled ||
      (stage && !stage.current()) ||
      (source.kind === 'node' &&
        (selectedNodeIds(current.current.document.getSnapshot().selection).length > 1 ||
          !!event?.ctrlKey ||
          !!event?.metaKey)) ||
      (event &&
        (active.current || pending.current) &&
        (active.current ?? pending.current)?.pointerId !== event.pointerId) ||
      (event && (event.button !== 0 || (!event.isPrimary && event.isPrimary !== undefined)))
    )
      return;
    const point = event
      ? toParentPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.ownerDocument)
      : { x: 0, y: 0 };
    if (
      !point ||
      (event &&
        stage &&
        event.currentTarget.ownerDocument !== window.document &&
        event.currentTarget !== stage.current()?.author)
    )
      return;
    cancel();
    suppressClick.current = null;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture?.(event.pointerId);
      capture.current = { element: event.currentTarget, pointerId: event.pointerId };
    }
    setNotice(null);
    const {
      plan,
      selection: { pageId },
    } = current.current.snapshot;
    if (source.kind === 'node') current.current.document.select(pageId, source.nodeId);
    const next: Session = {
      source,
      document: current.current.document,
      selection: current.current.document.getSnapshot().selection,
      pageId,
      plan,
      method: event ? 'pointer' : 'keyboard',
      point,
      pointerId: event?.pointerId,
    };
    if (event) {
      pending.current = { ...next, start: point, pointerId: event.pointerId };
      setGestureActive(true);
    } else {
      publish(next);
      choose({ kind: 'inside' });
    }
  };
  const finish = () => {
    if (deferredBlur.current) {
      cancel();
      return;
    }
    const drag = active.current;
    pending.current = null;
    if (!drag) return;
    const { document: doc, snapshot: latest, enabled } = current.current;
    try {
      const actual = doc.getSnapshot();
      if (
        !mounted.current ||
        !enabled ||
        (current.current.stage && !current.current.stage.current()) ||
        doc !== drag.document ||
        actual.plan !== drag.plan ||
        actual.selection !== drag.selection ||
        latest.plan !== drag.plan ||
        actual.plan.pages.get(drag.pageId)?.schema.code?.enabled ||
        latest.selection.pageId !== drag.pageId
      )
        throw new Error('页面定义已变化，拖动已取消');
      if (!drag.candidate) {
        cancel();
        return;
      }
      if (!drag.candidate.valid) throw new Error(drag.candidate.reason);
      const target = resolveDrop(
        latest.plan.pages.get(drag.pageId)!.schema,
        drag.source,
        drag.candidate.intent,
      );
      const changed =
        drag.source.kind === 'node'
          ? doc.moveNode(drag.pageId, drag.source.nodeId, target)
          : !!doc.insertFragment(drag.pageId, materialTemplate(drag.source.component), target);
      reportNotice(drag, changed ? '已放置，可撤销' : '位置未变化');
      onCommit?.();
    } catch (error) {
      reportNotice(drag, errorText(error), true);
    }
    cancel();
  };
  const hitTest = (point: Point): DropIntent | undefined => {
    const { plan, selection } = current.current.snapshot;
    return hitTestDrop(point, plan, selection.pageId);
  };
  // Window listeners stay stable while refs carry current document and drag state.
  const handlers = useRef({ begin, finish, cancel, hitTest, inspect, publish });
  handlers.current = { begin, finish, cancel, hitTest, inspect, publish };
  useEffect(() => {
    const move = (event: PointerEvent, owner: Document) => {
      const point = toParentPoint({ x: event.clientX, y: event.clientY }, owner);
      if (!point || (current.current.stage && !current.current.stage.current())) {
        handlers.current.cancel();
        return;
      }
      const waiting = pending.current;
      if (waiting && waiting.pointerId !== event.pointerId) return;
      if (
        waiting &&
        !active.current &&
        Math.hypot(point.x - waiting.start.x, point.y - waiting.start.y) >= 6
      ) {
        handlers.current.publish(waiting);
        pending.current = null;
      }
      const drag = active.current;
      if (!drag || drag.method !== 'pointer') return;
      if (drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const intent = handlers.current.hitTest(point);
      handlers.current.publish({
        ...drag,
        point,
        candidate: intent ? handlers.current.inspect(drag, intent) : undefined,
      });
    };
    const up = (event: PointerEvent, owner: Document) => {
      const point = toParentPoint({ x: event.clientX, y: event.clientY }, owner);
      if (!point) {
        handlers.current.cancel();
        return;
      }
      if (pending.current && pending.current.pointerId !== event.pointerId) return;
      if (active.current?.method === 'pointer' && active.current.pointerId !== event.pointerId)
        return;
      if (active.current?.method === 'pointer') {
        const drag = active.current,
          intent = handlers.current.hitTest(point);
        handlers.current.publish({
          ...drag,
          candidate: intent ? handlers.current.inspect(drag, intent) : undefined,
        });
        suppressClick.current = capture.current?.element ?? null;
        handlers.current.finish();
      } else if (pending.current) handlers.current.cancel();
      pending.current = null;
      setGestureActive(false);
    };
    const cancel = () => handlers.current.cancel();
    const pointerCancel = (event: PointerEvent) => {
      const drag = active.current ?? pending.current;
      if (
        drag?.method === 'pointer' &&
        drag.pointerId === event.pointerId &&
        (event.type !== 'lostpointercapture' || event.target === capture.current?.element)
      )
        cancel();
    };
    const key = (event: KeyboardEvent, owner: Document) => {
      const offered = canvasEscapes.current.get(event);
      canvasEscapes.current.delete(event);
      if (
        !mounted.current ||
        composing.current ||
        !isAuthorEscape(event) ||
        isEscapeTextTarget(event, destination.current, owner)
      )
        return;
      const latest = current.current,
        actual = latest.document.getSnapshot(),
        drag = active.current ?? pending.current;
      if (drag) {
        // An idle Canvas offer must never cancel a different drag begun later in this dispatch.
        if (
          offered ||
          !latest.enabled ||
          latest.document !== drag.document ||
          actual.plan !== drag.plan ||
          actual.selection !== drag.selection ||
          latest.snapshot.plan !== drag.plan ||
          latest.snapshot.selection !== drag.selection ||
          actual.plan.pages.get(drag.pageId)?.schema.code?.enabled
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }
      if (
        offered &&
        latest.enabled &&
        latest.document === offered.document &&
        actual.plan === offered.plan &&
        actual.selection === offered.selection &&
        latest.snapshot.plan === offered.plan &&
        latest.snapshot.selection === offered.selection &&
        offered.owner === owner &&
        owner.activeElement === offered.focus &&
        !actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled &&
        offered.action()
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const compositionStart = () => {
      composing.current = true;
    };
    const compositionEnd = () => {
      composing.current = false;
    };
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    const blur = () => {
      const ownStage = current.current.stage;
      const context = current.current;
      const generation = gestureGeneration.current;
      const platform = ownStage?.platform();
      const runtime = ownStage?.context.runtime;
      const within = () => {
        const parent = window.document;
        const app = ownStage?.parent?.closest('.app-shell') ?? parent.body;
        return (
          !!platform &&
          ownStage?.platform()?.environment === platform.environment &&
          ((parent.hasFocus() && !!parent.activeElement && app.contains(parent.activeElement)) ||
            (parent.activeElement === platform.frame && platform.environment.document.hasFocus()))
        );
      };
      clearTimeout(blurTimer);
      if (ownStage && within()) {
        deferredBlur.current = null;
        return;
      }
      const token = {};
      deferredBlur.current = token;
      const expire = () => {
        if (deferredBlur.current !== token) return;
        deferredBlur.current = null;
        const latest = current.current;
        if (
          generation !== gestureGeneration.current ||
          latest.stage !== ownStage ||
          latest.document !== context.document ||
          latest.snapshot.plan !== context.snapshot.plan ||
          latest.snapshot.selection !== context.snapshot.selection ||
          ownStage?.context.runtime !== runtime ||
          ownStage?.platform()?.environment !== platform?.environment
        )
          return;
        if (!ownStage || !within()) {
          composing.current = false;
          cancel();
        }
      };
      if (ownStage) blurTimer = setTimeout(expire, 0);
      else expire();
    };
    const click = (event: MouseEvent, owner: Document) => {
      if (
        event.detail > 0 &&
        event.target instanceof owner.defaultView!.Node &&
        suppressClick.current?.contains(event.target)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick.current = null;
      }
    };
    const bind = (view: Window, owner: Document) => {
      const moving = (event: PointerEvent) => move(event, owner);
      const releasing = (event: PointerEvent) => up(event, owner);
      const typing = (event: KeyboardEvent) => key(event, owner);
      const clicking = (event: MouseEvent) => click(event, owner);
      view.addEventListener('pointermove', moving, { passive: false });
      view.addEventListener('pointerup', releasing);
      view.addEventListener('pointercancel', pointerCancel);
      view.addEventListener('lostpointercapture', pointerCancel);
      view.addEventListener('keydown', typing);
      view.addEventListener('compositionstart', compositionStart, true);
      view.addEventListener('compositionend', compositionEnd, true);
      view.addEventListener('click', clicking, true);
      view.addEventListener('blur', blur);
      return () => {
        view.removeEventListener('pointermove', moving);
        view.removeEventListener('pointerup', releasing);
        view.removeEventListener('pointercancel', pointerCancel);
        view.removeEventListener('lostpointercapture', pointerCancel);
        view.removeEventListener('keydown', typing);
        view.removeEventListener('compositionstart', compositionStart, true);
        view.removeEventListener('compositionend', compositionEnd, true);
        view.removeEventListener('click', clicking, true);
        view.removeEventListener('blur', blur);
      };
    };
    const unbindParent = bind(window, window.document);
    let child: Document | undefined,
      unbindChild = () => {};
    const reconcile = () => {
      const next = stage?.current()?.environment.document;
      if (child === next) return;
      unbindChild();
      child = next;
      unbindChild = next ? bind(next.defaultView!, next) : () => {};
    };
    const unsubscribe = stage?.subscribe(reconcile);
    const invalidate = stage?.onInvalidate((reason) => {
      if (reason !== 'takeover') cancel();
    });
    reconcile();
    return () => {
      clearTimeout(blurTimer);
      unsubscribe?.();
      invalidate?.();
      unbindChild();
      unbindParent();
      canvasEscapes.current = new WeakMap();
    };
  }, [stage]);
  useEffect(() => {
    if (
      (active.current || pending.current) &&
      (!enabled ||
        document !== (active.current ?? pending.current)!.document ||
        snapshot.selection !== (active.current ?? pending.current)!.selection ||
        snapshot.plan !== (active.current ?? pending.current)!.plan ||
        snapshot.selection.pageId !== (active.current ?? pending.current)!.pageId)
    )
      cancel();
  }, [document, enabled, snapshot.plan, snapshot.selection]);
  useEffect(() => {
    if (session?.method !== 'pointer') return;
    let frame = 0;
    const scroll = () => {
      const drag = active.current;
      if (drag?.method !== 'pointer') return;
      const scrolled = autoScrollAtPoint(drag.point);
      const intent = handlers.current.hitTest(drag.point);
      if (
        scrolled ||
        (intent ? intentKey(intent) : '') !==
          (drag.candidate ? intentKey(drag.candidate.intent) : '')
      )
        handlers.current.publish({
          ...drag,
          candidate: intent ? handlers.current.inspect(drag, intent) : undefined,
        });
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [session?.method]);
  const actual = document.getSnapshot();
  const authorReady =
    enabled &&
    (!stage || !!stage.current()) &&
    actual.plan === snapshot.plan &&
    actual.selection === snapshot.selection &&
    !actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled;
  const visibleSession =
    authorReady &&
    session?.document === document &&
    session.plan === actual.plan &&
    session.selection === actual.selection &&
    session.pageId === actual.selection.pageId
      ? session
      : null;
  const visibleNotice =
    authorReady &&
    notice?.document === document &&
    notice.plan === actual.plan &&
    notice.pageId === actual.selection.pageId
      ? notice
      : null;
  useEffect(() => {
    // Hide in the render above; expire state as well so a later return cannot revive it.
    setNotice((previous) =>
      previous &&
      (!enabled ||
        previous.document !== document ||
        previous.plan !== snapshot.plan ||
        previous.pageId !== snapshot.selection.pageId ||
        snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled)
        ? null
        : previous,
    );
  }, [document, enabled, snapshot.plan, snapshot.selection.pageId]);
  const keyboardTargets: DropIntent[] = [{ kind: 'inside' }];
  if (visibleSession?.method === 'keyboard') {
    const walk = (nodes: NodeSchema[]) => {
      for (const node of nodes) {
        keyboardTargets.push(
          { kind: 'before', nodeId: node.id },
          { kind: 'after', nodeId: node.id },
        );
        const contract = visibleSession.plan.registry.components[node.component];
        if (contract.children) keyboardTargets.push({ kind: 'inside', parentId: node.id });
        for (const name of Object.keys(contract.slots ?? {}))
          keyboardTargets.push({ kind: 'inside', parentId: node.id, slot: name });
        walk(node.children ?? []);
        for (const slot of Object.values(node.slots ?? {})) walk(slot.children);
      }
    };
    walk(visibleSession.plan.pages.get(visibleSession.pageId)!.schema.children);
  }
  return (
    <DragContext.Provider
      value={{
        stage,
        get enabled() {
          return (
            current.current.enabled && (!current.current.stage || !!current.current.stage.current())
          );
        },
        get multiSelected() {
          return selectedNodeIds(current.current.document.getSnapshot().selection).length > 1;
        },
        session,
        get isInteracting() {
          return !!(pending.current || active.current);
        },
        begin,
        finish,
        cancel,
        choose,
        offerCanvasEscape,
      }}
    >
      {children}
      {createPortal(
        visibleSession ? (
          <aside
            className={`drag-feedback ${visibleSession.method} ${visibleSession.candidate && !visibleSession.candidate.valid ? 'invalid' : ''}`}
            aria-label="拖放操作"
            style={
              visibleSession.method === 'pointer'
                ? {
                    left: Math.max(8, Math.min(visibleSession.point.x + 14, innerWidth - 280)),
                    top: Math.max(8, Math.min(visibleSession.point.y + 18, innerHeight - 140)),
                  }
                : undefined
            }
          >
            <strong>
              {visibleSession.source.kind === 'material'
                ? `新增 ${catalog[visibleSession.source.component]?.title}`
                : `移动 ${nodeLabel(visibleSession.plan, visibleSession.pageId, visibleSession.source.nodeId)}`}
            </strong>
            <p role="status">
              {visibleSession.candidate
                ? `${visibleSession.candidate.valid ? '放入：' : '不可放入：'}${visibleSession.candidate.label}`
                : '移动到画布、组件树或插槽落点'}
            </p>
            {visibleSession.candidate?.reason && <small>{visibleSession.candidate.reason}</small>}
            {visibleSession.method === 'keyboard' ? (
              <>
                <label ref={destination}>
                  拖放位置
                  <Select
                    autoFocus
                    aria-label="拖放位置"
                    value={
                      visibleSession.candidate ? intentKey(visibleSession.candidate.intent) : ''
                    }
                    onValueChange={(event) => choose(JSON.parse(event))}
                  >
                    {keyboardTargets.map((intent) => (
                      <option key={intentKey(intent)} value={intentKey(intent)}>
                        {intentLabel(visibleSession.plan, visibleSession.pageId, intent)}
                      </option>
                    ))}
                  </Select>
                </label>
                <div>
                  <Button disabled={!visibleSession.candidate?.valid} onClick={finish}>
                    确认放置
                  </Button>
                  <Button onClick={cancel}>取消拖动</Button>
                </div>
              </>
            ) : (
              <small>松开放置 · Esc 取消</small>
            )}
          </aside>
        ) : (
          visibleNotice && (
            <div
              className={`drag-notice ${visibleNotice.error ? 'error' : ''}`}
              role={visibleNotice.error ? 'alert' : 'status'}
            >
              {visibleNotice.text}
              <Button aria-label="关闭拖放提示" onClick={() => setNotice(null)}>
                ×
              </Button>
            </div>
          )
        ),
        window.document.body,
      )}
    </DragContext.Provider>
  );
}
export function DragHandle({
  source,
  label,
  children,
  className = 'drag-handle',
}: {
  source: DragSource;
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  const drag = useDragDrop();
  // The provider also guards invocation against a retained handle callback.
  const multi = source.kind === 'node' && !!drag?.multiSelected;
  return (
    <Tip content={`${label} · 拖动或按空格选择落点`} disabled={!!drag?.session}>
      <Button
        type="button"
        className={className}
        data-drag-source="true"
        aria-label={label}
        disabled={!drag?.enabled || multi}
        onPointerDown={(event) => drag?.begin(source, event)}
        onClick={(event) => {
          // Assistive technologies can activate a button without a pointer or key event.
          if (event.detail === 0) drag?.begin(source);
        }}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) drag?.begin(source);
          }
        }}
      >
        {children ?? '⠿'}
      </Button>
    </Tip>
  );
}
export function DropZone({
  intent,
  label,
  visible = true,
  className = '',
  children,
}: {
  intent: DropIntent;
  label: string;
  visible?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const drag = useDragDrop();
  if (!drag?.enabled || !visible) return null;
  const selected =
    !!drag.session?.candidate && intentKey(drag.session.candidate.intent) === intentKey(intent);
  return (
    <div
      className={`drop-zone ${className} ${drag.session ? 'drag-active' : ''} ${selected ? (drag.session!.candidate!.valid ? 'drop-valid' : 'drop-invalid') : ''}`}
      data-drop-intent={intentKey(intent)}
    >
      {children ?? label}
    </div>
  );
}
