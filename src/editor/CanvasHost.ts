import { nodePath } from '../../packages/editor/node-path';
import type { PageSchema } from '../../packages/schema/types';
import { nodeRect } from './geometry';
import { canvasBoundary, clientBounds, scrollByScreen, toParentRect } from './coordinates';
export type CanvasRect = NonNullable<ReturnType<typeof nodeRect>>;
export function revealRect(
  scroller: HTMLElement,
  rect: CanvasRect,
  padding = 16,
  bounds = clientBounds(scroller),
) {
  const left = bounds.left + padding,
    right = bounds.right - padding;
  const top = bounds.top + padding,
    bottom = bounds.bottom - padding;
  const dx =
    rect.left < left
      ? rect.left - left
      : rect.right > right
        ? Math.min(rect.left - left, rect.right - right)
        : 0;
  const dy =
    rect.top < top
      ? rect.top - top
      : rect.bottom > bottom
        ? Math.min(rect.top - top, rect.bottom - bottom)
        : 0;
  scrollByScreen(scroller, { x: dx, y: dy });
}
export function canvasViewport(surface: HTMLElement) {
  const boundary = canvasBoundary(surface.ownerDocument);
  if (boundary) {
    const raw = documentViewport(boundary.document);
    const mapped = toParentRect(raw, boundary.document)!;
    const parent = boundary.parent.closest<HTMLElement>('.canvas-scroll') ?? boundary.parent;
    return (
      intersectRect(mapped, clientBounds(parent)) ?? {
        ...mapped,
        width: 0,
        height: 0,
        right: mapped.left,
        bottom: mapped.top,
      }
    );
  }
  return clientBounds(surface.closest<HTMLElement>('.canvas-scroll') ?? surface);
}
export function documentViewport(document: Document): CanvasRect {
  const width = document.documentElement.clientWidth || document.defaultView!.innerWidth;
  const height = document.documentElement.clientHeight || document.defaultView!.innerHeight;
  return { left: 0, top: 0, right: width, bottom: height, width, height };
}
export function intersectRect(a: CanvasRect, b: CanvasRect): CanvasRect | undefined {
  const left = Math.max(a.left, b.left),
    top = Math.max(a.top, b.top),
    right = Math.min(a.right, b.right),
    bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top
    ? { left, top, right, bottom, width: right - left, height: bottom - top }
    : undefined;
}
/** Respect each actual overflow ancestor, not just the workbench viewport. */
export function clippingBounds(marker: HTMLElement, surface: HTMLElement): CanvasRect | undefined {
  let bounds: CanvasRect | undefined = canvasViewport(surface);
  const root = surface.closest<HTMLElement>('.canvas-scroll') ?? surface;
  let parent: HTMLElement | null = marker;
  while (parent && bounds) {
    const style = parent.ownerDocument.defaultView!.getComputedStyle(parent);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return;
    const x = /auto|scroll|hidden|clip/.test(style.overflowX || style.overflow);
    const y = /auto|scroll|hidden|clip/.test(style.overflowY || style.overflow);
    // display:contents has no box, so its computed overflow cannot clip descendants.
    if (style.display !== 'contents' && (x || y)) {
      const raw =
        parent === parent.ownerDocument.scrollingElement && canvasBoundary(parent.ownerDocument)
          ? documentViewport(parent.ownerDocument)
          : clientBounds(parent);
      const mapped = toParentRect(raw, parent.ownerDocument);
      if (!mapped) return;
      const { left, top, right, bottom } = mapped;
      bounds = intersectRect(bounds, {
        left: x ? left : bounds.left,
        top: y ? top : bounds.top,
        right: x ? right : bounds.right,
        bottom: y ? bottom : bounds.bottom,
        width: 0,
        height: 0,
      });
    }
    if (parent === root) break;
    parent = parent.parentElement;
  }
  return bounds;
}
export function nearestInstance<T extends { key: string; rect: CanvasRect }>(
  items: T[],
  viewport: CanvasRect,
  preferred?: string,
): T | undefined {
  const exact = preferred && items.find((item) => item.key === preferred);
  if (exact) return exact;
  const score = (rect: CanvasRect) => {
    const x = Math.max(viewport.left - rect.right, 0, rect.left - viewport.right);
    const y = Math.max(viewport.top - rect.bottom, 0, rect.top - viewport.bottom);
    return (
      Math.hypot(x, y) * 10000 +
      Math.hypot(
        (rect.left + rect.right - viewport.left - viewport.right) / 2,
        (rect.top + rect.bottom - viewport.top - viewport.bottom) / 2,
      )
    );
  };
  return items.reduce<T | undefined>(
    (best, item) => (!best || score(item.rect) < score(best.rect) ? item : best),
    undefined,
  );
}
/** All coordinates are viewport CSS pixels; scrolling stays inside the canvas host. */
export class CanvasHost {
  constructor(readonly surface: HTMLElement) {}
  locate(page: PageSchema, nodeId: string, instanceKey?: string) {
    const viewport = canvasViewport(this.surface);
    const path = nodePath(page, nodeId).reverse();
    for (const { node } of path) {
      const items = [...this.surface.querySelectorAll<HTMLElement>('[data-editor-node]')]
        .filter((marker) => marker.dataset.editorNode === node.id)
        .flatMap((marker) => {
          const raw = nodeRect(marker);
          const rect = raw && toParentRect(raw, marker.ownerDocument);
          return rect ? [{ marker, rect, key: marker.dataset.editorInstance ?? '' }] : [];
        });
      const target = nearestInstance(items, viewport, node.id === nodeId ? instanceKey : undefined);
      if (!target) continue;
      const boundary = canvasBoundary(this.surface.ownerDocument);
      const root =
        this.surface.closest<HTMLElement>('.canvas-scroll') ??
        (boundary?.document.scrollingElement as HTMLElement | null);
      if (root) {
        let parent = target.marker.parentElement;
        while (parent && parent !== root) {
          const style = parent.ownerDocument.defaultView!.getComputedStyle(parent);
          if (/(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY)) {
            const rect = nodeRect(target.marker);
            if (rect) revealRect(parent, rect, 8);
          }
          parent = parent.parentElement;
        }
        const rect = nodeRect(target.marker);
        if (rect)
          revealRect(
            root,
            rect,
            20,
            boundary ? documentViewport(boundary.document) : clientBounds(root),
          );
        if (boundary) {
          const raw = nodeRect(target.marker);
          const mapped = raw && toParentRect(raw, boundary.document);
          const outer = boundary.parent.closest<HTMLElement>('.canvas-scroll');
          if (mapped && outer) revealRect(outer, mapped, 20);
        }
      }
      return {
        ...target,
        nodeId: node.id,
        fallback: node.id !== nodeId,
        inactiveReason: target.marker.dataset.editorInactive,
      };
    }
    return undefined;
  }
}
