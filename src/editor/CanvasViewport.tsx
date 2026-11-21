import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { resolveViewport, type ViewportMetrics } from './viewport';
import { editorContext } from './context';
import { useEditorViewport } from './session';
import { useDragDrop } from './DragDrop';
import {
  clientBounds,
  logicalToScreen,
  screenToLogical,
  scrollByScreen,
  type LogicalPoint,
} from './coordinates';
import './viewport.css';
import { CanvasStageFrame, type CanvasStage } from './canvas-stage';
const Metrics = editorContext<ViewportMetrics | null>('viewport-metrics', null);
export const useViewportMetrics = () => useContext(Metrics);
/** Fixed logical document size; native child content never feeds its presentation height. */
export function CanvasFrameSurface({ children }: { children: ReactNode }) {
  const metrics = useViewportMetrics()!;
  const height = metrics.measured ? Math.max(240, metrics.availableHeight) : 600;
  return (
    <div
      className="canvas-surface-space"
      style={{ width: metrics.width * metrics.scale, height: height * metrics.scale }}
    >
      <div
        className="canvas-frame-surface"
        style={{
          width: metrics.width,
          height,
          transform: metrics.scale === 1 ? undefined : `scale(${metrics.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
/** Stable physical host; changing presentation never replaces its React children. */
export function CanvasViewport({
  mode,
  stage,
  children,
}: {
  mode: 'edit' | 'preview';
  stage?: CanvasStage;
  children: ReactNode;
}) {
  const { viewport, state } = useEditorViewport();
  const metrics = resolveViewport(state, mode);
  const drag = useDragDrop();
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<LogicalPoint | null>(null);
  const captureAnchor = useRef<() => void>(() => {});
  const previous = useRef<{ width: number; scale: number } | null>(null);
  const latest = useRef(metrics);
  latest.current = metrics;
  useLayoutEffect(() => {
    viewport.setInteracting(!!drag?.isInteracting);
    return () => viewport.setInteracting(false);
  }, [viewport, drag?.isInteracting]);
  useLayoutEffect(() => {
    const scroller = host.current?.closest<HTMLElement>('.canvas-scroll');
    if (!scroller) return;
    const measure = () => {
      const style = getComputedStyle(scroller);
      viewport.measure(
        scroller.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0),
        scroller.clientHeight -
          (parseFloat(style.paddingTop) || 0) -
          (parseFloat(style.paddingBottom) || 0),
      );
    };
    const capture = () => {
      const stage = host.current?.querySelector<HTMLElement>('.canvas-surface-space');
      if (!stage) return;
      const rect = stage.getBoundingClientRect(),
        bounds = clientBounds(scroller);
      const left = Math.max(rect.left, bounds.left),
        right = Math.min(rect.right, bounds.right);
      const top = Math.max(rect.top, bounds.top),
        bottom = Math.min(rect.bottom, bounds.bottom);
      const point = {
        x:
          right >= left
            ? (left + right) / 2
            : Math.max(rect.left, Math.min(rect.right, (bounds.left + bounds.right) / 2)),
        y:
          bottom >= top
            ? (top + bottom) / 2
            : Math.max(rect.top, Math.min(rect.bottom, (bounds.top + bounds.bottom) / 2)),
      };
      anchor.current = screenToLogical(point, { x: rect.left, y: rect.top }, latest.current.scale);
    };
    captureAnchor.current = capture;
    let observedStage: HTMLElement | null = null;
    const stageResize =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(capture);
    const trackStage = () => {
      const stage = host.current?.querySelector<HTMLElement>('.canvas-surface-space') ?? null;
      if (stage === observedStage) return;
      stageResize?.disconnect();
      observedStage = stage;
      if (stage) stageResize?.observe(stage);
      capture();
    };
    // Runtime creation may initially leave a loading placeholder in this stable host.
    const stages = new MutationObserver(trackStage);
    if (host.current) stages.observe(host.current, { childList: true, subtree: true });
    trackStage();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    resize?.observe(scroller);
    scroller.addEventListener('scroll', capture, { passive: true });
    window.addEventListener('resize', measure);
    measure();
    capture();
    return () => {
      resize?.disconnect();
      stageResize?.disconnect();
      stages.disconnect();
      captureAnchor.current = () => {};
      scroller.removeEventListener('scroll', capture);
      window.removeEventListener('resize', measure);
    };
  }, [viewport]);
  useLayoutEffect(() => {
    const scroller = host.current?.closest<HTMLElement>('.canvas-scroll');
    const stage = host.current?.querySelector<HTMLElement>('.canvas-surface-space');
    const old = previous.current;
    previous.current = { width: metrics.width, scale: metrics.scale };
    if (!scroller || !stage) return;
    if (old && (old.width !== metrics.width || old.scale !== metrics.scale) && anchor.current) {
      const rect = stage.getBoundingClientRect(),
        bounds = clientBounds(scroller);
      const point = logicalToScreen(anchor.current, { x: rect.left, y: rect.top }, metrics.scale);
      // Preserve the logical center of the visible page; native scrolling clamps to its range.
      const targetX =
        metrics.width * metrics.scale <= bounds.width
          ? rect.left + rect.width / 2
          : (bounds.left + bounds.right) / 2;
      const targetY =
        rect.height <= bounds.height
          ? rect.top + rect.height / 2
          : (bounds.top + bounds.bottom) / 2;
      scrollByScreen(scroller, { x: point.x - targetX, y: point.y - targetY });
    }
    captureAnchor.current();
  }, [metrics.width, metrics.scale]);
  return (
    <Metrics.Provider value={metrics}>
      <div
        ref={host}
        className="preview-content canvas-viewport"
        data-viewport-width={metrics.width}
        data-viewport-scale={metrics.scale}
        data-viewport-mode={mode}
        data-viewport-preset={state.preset}
        data-viewport-zoom={state.zoom.kind}
        style={{ width: metrics.width * metrics.scale, minHeight: metrics.availableHeight }}
      >
        <CanvasStageFrame stage={stage} mode={mode}>
          {children}
        </CanvasStageFrame>
      </div>
    </Metrics.Provider>
  );
}
/** Only this runtime surface is transformed; selection UI remains its sibling. */
export function CanvasSurface({ children }: { children: ReactNode }) {
  const metrics = useViewportMetrics();
  const surface = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(120);
  useLayoutEffect(() => {
    if (!metrics || !surface.current) return;
    const content = surface.current;
    let frame = 0;
    const measure = () => {
      const size = content.getBoundingClientRect().height / metrics.scale;
      if (Number.isFinite(size) && size > 0)
        setHeight((current) => (Math.abs(current - size) > 0.1 ? size : current));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(content);
    const mutation = new MutationObserver(schedule);
    mutation.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation.disconnect();
    };
  }, [metrics?.width, metrics?.scale, metrics?.availableHeight]);
  return (
    <div
      className="canvas-surface-space"
      style={
        metrics
          ? { width: metrics.width * metrics.scale, height: height * metrics.scale }
          : undefined
      }
    >
      <div
        ref={surface}
        className="canvas-scaled-surface"
        style={
          metrics
            ? {
                width: metrics.width,
                minHeight: Math.max(120, metrics.availableHeight / metrics.scale),
                transform: metrics.scale === 1 ? undefined : 'scale(' + metrics.scale + ')',
              }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
