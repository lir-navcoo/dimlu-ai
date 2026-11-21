/** All native DOM rectangles and pointer positions are screen CSS pixels. */
export type ScreenPoint = { x: number; y: number };
export type LogicalPoint = { x: number; y: number };
export type ScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};
export function normalizeRect(
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
): ScreenRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}
const validScale = (scale: number) => (Number.isFinite(scale) && scale > 0 ? scale : 1);
export function screenToLogical(
  point: ScreenPoint,
  origin: ScreenPoint,
  scale: number,
): LogicalPoint {
  const factor = validScale(scale);
  return { x: (point.x - origin.x) / factor, y: (point.y - origin.y) / factor };
}
export function logicalToScreen(
  point: LogicalPoint,
  origin: ScreenPoint,
  scale: number,
): ScreenPoint {
  const factor = validScale(scale);
  return { x: origin.x + point.x * factor, y: origin.y + point.y * factor };
}
/** Axis-aligned canvas scaling only; border-box dimensions supply the local scroll conversion. */
export function visualScale(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView!.getComputedStyle(element);
  const borderBox = (axis: 'width' | 'height', offset: number) => {
    let size = parseFloat(style[axis]);
    if (style.boxSizing !== 'border-box')
      size +=
        axis === 'width'
          ? (parseFloat(style.paddingLeft) || 0) +
            (parseFloat(style.paddingRight) || 0) +
            (parseFloat(style.borderLeftWidth) || 0) +
            (parseFloat(style.borderRightWidth) || 0)
          : (parseFloat(style.paddingTop) || 0) +
            (parseFloat(style.paddingBottom) || 0) +
            (parseFloat(style.borderTopWidth) || 0) +
            (parseFloat(style.borderBottomWidth) || 0);
    // offset dimensions are rounded integers. Retain genuine fractional CSS dimensions.
    return Number.isFinite(size) && size > 0 && Math.abs(size - offset) <= 1 ? size : offset;
  };
  const width = borderBox('width', element.offsetWidth),
    height = borderBox('height', element.offsetHeight);
  return {
    x: validScale(width ? rect.width / width : 1),
    y: validScale(height ? rect.height / height : 1),
  };
}
/** The visible client box excludes borders and scrollbars, in screen coordinates. */
export function clientBounds(element: HTMLElement): ScreenRect {
  const rect = element.getBoundingClientRect(),
    scale = visualScale(element);
  const left = rect.left + element.clientLeft * scale.x,
    top = rect.top + element.clientTop * scale.y;
  const width =
    element.clientWidth || element.offsetWidth
      ? element.clientWidth * scale.x
      : Math.max(0, rect.width - element.clientLeft * scale.x * 2);
  const height =
    element.clientHeight || element.offsetHeight
      ? element.clientHeight * scale.y
      : Math.max(0, rect.height - element.clientTop * scale.y * 2);
  return { left, top, right: left + width, bottom: top + height, width, height };
}
/** Convert screen displacement once, at the actual scroller boundary. */
export function scrollByScreen(element: HTMLElement, delta: ScreenPoint) {
  const scale = visualScale(element),
    beforeX = element.scrollLeft,
    beforeY = element.scrollTop;
  if (Number.isFinite(delta.x) && delta.x) element.scrollLeft += delta.x / scale.x;
  if (Number.isFinite(delta.y) && delta.y) element.scrollTop += delta.y / scale.y;
  return element.scrollLeft !== beforeX || element.scrollTop !== beforeY;
}

export type CanvasBoundary = {
  document: Document;
  frame: HTMLIFrameElement;
  parent: HTMLElement;
  isCurrent: () => boolean;
};
const documents = new WeakMap<Document, CanvasBoundary>();
const configuredDocuments = new WeakSet<Document>();
const frames = new WeakMap<Element, CanvasBoundary>();
export function registerCanvasBoundary(boundary: CanvasBoundary) {
  configuredDocuments.add(boundary.document);
  documents.set(boundary.document, boundary);
  frames.set(boundary.frame, boundary);
  return () => {
    if (documents.get(boundary.document) === boundary) documents.delete(boundary.document);
    if (frames.get(boundary.frame) === boundary) frames.delete(boundary.frame);
  };
}
export function canvasBoundary(document: Document) {
  const boundary = documents.get(document);
  try {
    return boundary?.isCurrent() &&
      boundary.frame.isConnected &&
      boundary.frame.contentDocument === document &&
      boundary.parent.contains(boundary.frame)
      ? boundary
      : undefined;
  } catch {
    return undefined;
  }
}
function frameGeometry(boundary: CanvasBoundary) {
  const { frame } = boundary;
  const rect = frame.getBoundingClientRect(),
    scale = visualScale(frame);
  return rect.width > 0 && rect.height > 0 && Number.isFinite(scale.x + scale.y)
    ? { x: rect.left + frame.clientLeft * scale.x, y: rect.top + frame.clientTop * scale.y, scale }
    : undefined;
}
export function toParentPoint(point: ScreenPoint, document: Document): ScreenPoint | undefined {
  const registered = documents.get(document);
  if (!registered) return configuredDocuments.has(document) ? undefined : point;
  const boundary = canvasBoundary(document),
    geometry = boundary && frameGeometry(boundary);
  return geometry && Number.isFinite(point.x + point.y)
    ? { x: geometry.x + point.x * geometry.scale.x, y: geometry.y + point.y * geometry.scale.y }
    : undefined;
}
export function fromParentPoint(point: ScreenPoint, document: Document): ScreenPoint | undefined {
  const registered = documents.get(document);
  if (!registered) return configuredDocuments.has(document) ? undefined : point;
  const boundary = canvasBoundary(document),
    geometry = boundary && frameGeometry(boundary);
  return geometry && Number.isFinite(point.x + point.y)
    ? { x: (point.x - geometry.x) / geometry.scale.x, y: (point.y - geometry.y) / geometry.scale.y }
    : undefined;
}
export function toParentRect(rect: ScreenRect, document: Document): ScreenRect | undefined {
  const start = toParentPoint({ x: rect.left, y: rect.top }, document);
  const end = toParentPoint({ x: rect.right, y: rect.bottom }, document);
  return start && end
    ? {
        left: start.x,
        top: start.y,
        right: end.x,
        bottom: end.y,
        width: end.x - start.x,
        height: end.y - start.y,
      }
    : undefined;
}
/** Parent UI wins; only a registered current frame permits document descent. */
export function canvasHitAtPoint(point: ScreenPoint, document: Document = window.document) {
  let element = document.elementFromPoint?.(point.x, point.y) ?? null;
  const boundary = element && frames.get(element);
  if (boundary && canvasBoundary(boundary.document) === boundary) {
    const local = fromParentPoint(point, boundary.document);
    if (!local) return { document, element: null, point };
    document = boundary.document;
    point = local;
    element = document.elementFromPoint?.(point.x, point.y) ?? null;
  }
  return { document, element, point };
}
