import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerCanvasBoundary,
  canvasBoundary,
  toParentPoint,
  fromParentPoint,
  toParentRect,
  canvasHitAtPoint,
} from '../src/editor/coordinates';
import { clippingBounds, CanvasHost, nearestInstance } from '../src/editor/CanvasHost';
import { nodeRect } from '../src/editor/geometry';
import { hitTestDrop } from '../src/editor/hit-test';
import { autoScrollAtPoint } from '../src/editor/DragDrop';
import { compileApplication } from '../packages/runtime/engine';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups
    .splice(0)
    .reverse()
    .forEach((clean) => clean());
  vi.restoreAllMocks();
});
function size(element: Element, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(element, key, { configurable: true, value });
}
// Native iframe/documents are real. Only boxes/client sizes/scroll limits are
// supplied because JSDOM has no layout engine; none of these are browser proofs.
function boundary(scaleX = 0.75, scaleY = scaleX) {
  const parent = document.createElement('div');
  parent.className = 'canvas-scroll';
  parent.style.cssText = 'overflow:auto;width:900px;height:700px;box-sizing:border-box';
  const frame = document.createElement('iframe');
  frame.style.cssText = 'width:804.4px;height:606.4px;box-sizing:border-box;border:2px solid';
  parent.append(frame);
  document.body.append(parent);
  cleanups.push(() => parent.remove());
  const child = frame.contentDocument!;
  const win = child.defaultView!;
  // The real runtime baseline declares native document scrolling. This fixture
  // supplies that declaration too; it does not load the compiled stylesheet.
  child.documentElement.style.overflow = 'auto';
  const boxes = new WeakMap<Element, DOMRect>();
  const getBox = function (this: Element) {
    return boxes.get(this) ?? new DOMRect();
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(getBox);
  vi.spyOn(win.Element.prototype, 'getBoundingClientRect').mockImplementation(getBox);
  boxes.set(parent, new DOMRect(50, 40, 900, 700));
  let origin = { left: 100.25, top: 80.5 };
  Object.defineProperty(frame, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(origin.left, origin.top, 804.4 * scaleX, 606.4 * scaleY),
  });
  size(parent, {
    offsetWidth: 900,
    offsetHeight: 700,
    clientWidth: 900,
    clientHeight: 700,
    clientLeft: 0,
    clientTop: 0,
    scrollWidth: 1800,
    scrollHeight: 1400,
  });
  size(frame, {
    offsetWidth: 804,
    offsetHeight: 606,
    clientWidth: 780,
    clientHeight: 580,
    clientLeft: 2,
    clientTop: 3,
  });
  size(child.documentElement, {
    clientWidth: 780,
    clientHeight: 580,
    scrollWidth: 1500,
    scrollHeight: 1800,
  });
  Object.defineProperty(child, 'scrollingElement', {
    configurable: true,
    value: child.documentElement,
  });
  Object.defineProperty(win, 'innerWidth', { configurable: true, value: 780 });
  Object.defineProperty(win, 'innerHeight', { configurable: true, value: 580 });
  let current = true;
  const registration = { document: child, frame, parent, isCurrent: () => current };
  cleanups.push(registerCanvasBoundary(registration));
  const surface = child.createElement('div');
  surface.className = 'editor-surface';
  child.body.append(surface);
  const box = (element: Element, x: number, y: number, width: number, height: number) => {
    boxes.set(element, new DOMRect(x, y, width, height));
    size(element, {
      offsetWidth: width,
      offsetHeight: height,
      clientWidth: width,
      clientHeight: height,
      clientLeft: 0,
      clientTop: 0,
    });
  };
  const lookup = (doc: Document, element: Element | null) => {
    const fn = vi.fn(() => element);
    Object.defineProperty(doc, 'elementFromPoint', { configurable: true, value: fn });
    return fn;
  };
  cleanups.push(() => Reflect.deleteProperty(document, 'elementFromPoint'));
  return {
    parent,
    frame,
    child,
    win,
    surface,
    registration,
    box,
    lookup,
    retire: () => {
      current = false;
    },
    pan: (left: number, top: number) => {
      origin = { left, top };
    },
  };
}
function marker(doc: Document, id: string, host: Element, value = id) {
  const element = doc.createElement('div');
  element.dataset.editorNode = id;
  element.dataset.editorInstance = id;
  const text = doc.createElement('p');
  text.textContent = value;
  element.append(text);
  host.append(element);
  return { element, text };
}

describe('canvas-stage trusted document geometry', () => {
  it('G1 maps fractional bordered frame points and rectangles exactly once and refuses stale boundaries', () => {
    const f = boundary(0.75, 1.25);
    expect(canvasBoundary(f.child)).toBe(f.registration);
    const point = { x: 100.25, y: 80.5 };
    const expected = { x: 176.9375, y: 184.875 };
    expect(toParentPoint(point, f.child)).toEqual(expected);
    expect(fromParentPoint(expected, f.child)).toEqual(point);
    expect(
      toParentRect({ left: 10, top: 20, right: 50, bottom: 60, width: 40, height: 40 }, f.child),
    ).toEqual({ left: 109.25, top: 109.25, right: 139.25, bottom: 159.25, width: 30, height: 50 });
    f.child.documentElement.scrollTop = 300;
    f.child.documentElement.scrollLeft = 90;
    expect(toParentPoint(point, f.child)).toEqual(expected);
    f.pan(-20.5, -40.25);
    expect(toParentPoint(point, f.child)).toEqual({ x: 56.1875, y: 64.125 });
    expect(toParentPoint(point, document)).toEqual(point);
    expect(toParentPoint({ x: Number.NaN, y: 1 }, f.child)).toBeUndefined();
    f.retire();
    expect(toParentPoint(point, f.child)).toBeUndefined();
    expect(fromParentPoint(point, f.child)).toBeUndefined();
    expect(
      toParentRect({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 }, f.child),
    ).toBeUndefined();
  });

  it('G2 preserves parent precedence and only descends the exact current frame for existing drop semantics', () => {
    const f = boundary();
    const plan = compileApplication(selectionApplication(), selectionRegistry());
    const a = marker(f.child, 'alpha', f.surface);
    f.box(a.text, 20, 30, 100, 40);
    const parentLookup = f.lookup(document, f.frame);
    const childLookup = f.lookup(f.child, a.text);
    const point = toParentPoint({ x: 30, y: 35 }, f.child)!;
    expect(canvasHitAtPoint(point)?.element).toBe(a.text);
    expect(childLookup).toHaveBeenLastCalledWith(30, 35);
    expect(hitTestDrop(point, plan, 'a')).toEqual({ kind: 'before', nodeId: 'alpha' });
    const tree = document.createElement('button');
    tree.dataset.editorTreeNode = 'tail';
    f.parent.append(tree);
    f.box(tree, point.x - 10, point.y - 5, 100, 40);
    parentLookup.mockReturnValue(tree);
    childLookup.mockClear();
    expect(canvasHitAtPoint(point)?.element).toBe(tree);
    expect(childLookup).not.toHaveBeenCalled();
    expect(hitTestDrop(point, plan, 'a')).toEqual({ kind: 'before', nodeId: 'tail' });
    const control = document.createElement('button');
    f.parent.append(control);
    parentLookup.mockReturnValue(control);
    expect(hitTestDrop(point, plan, 'a')).toBeUndefined();
    expect(childLookup).not.toHaveBeenCalled();
    const slot = f.child.createElement('div');
    slot.dataset.dropIntent = JSON.stringify({ kind: 'inside', parentId: 'card', slot: 'footer' });
    f.surface.append(slot);
    childLookup.mockReturnValue(slot);
    parentLookup.mockReturnValue(f.frame);
    expect(hitTestDrop(point, plan, 'a')).toEqual({
      kind: 'inside',
      parentId: 'card',
      slot: 'footer',
    });
    f.retire();
    childLookup.mockClear();
    expect(hitTestDrop(point, plan, 'a')).toBeUndefined();
    expect(childLookup).not.toHaveBeenCalled();
  });

  it('G3 intersects child and parent clipping in one domain while retaining boxless and repeated-instance rules', () => {
    const f = boundary(0.75);
    const contents = f.child.createElement('div');
    contents.style.cssText = 'display:contents;overflow:auto';
    const clip = f.child.createElement('div');
    clip.style.cssText = 'overflow:hidden;width:200px;height:100px';
    f.surface.append(contents);
    contents.append(clip);
    const a = marker(f.child, 'alpha', clip);
    f.box(clip, 10, 20, 200, 100);
    f.box(a.text, 20, 30, 50, 30);
    const expected = toParentRect(
      { left: 10, top: 20, right: 210, bottom: 120, width: 200, height: 100 },
      f.child,
    );
    expect(clippingBounds(a.element, f.surface)).toEqual(expected);
    const raw = nodeRect(a.element)!;
    expect(raw.left).toBe(20);
    const mapped = toParentRect(raw, f.child)!;
    const farther = { ...mapped, left: mapped.left + 1000, right: mapped.right + 1000 };
    expect(
      nearestInstance(
        [
          { key: 'far', rect: farther },
          { key: 'near', rect: mapped },
        ],
        expected!,
      )?.key,
    ).toBe('near');
    expect(
      nearestInstance(
        [
          { key: 'far', rect: farther },
          { key: 'near', rect: mapped },
        ],
        expected!,
        'far',
      )?.key,
    ).toBe('far');
    contents.style.display = 'none';
    expect(clippingBounds(a.element, f.surface)).toBeUndefined();
    contents.style.cssText = 'display:contents;overflow:auto';
    f.box(clip, 10, 20, 0, 0);
    expect(clippingBounds(a.element, f.surface)).toBeUndefined();
  });

  it('G4 reveals and autoscrolls child boundaries before parent pan without touching the parent window', () => {
    const f = boundary(0.75);
    const inner = f.child.createElement('div');
    inner.style.cssText = 'overflow:auto;width:200px;height:100px';
    f.surface.append(inner);
    const a = marker(f.child, 'alpha', inner);
    f.box(inner, 20, 20, 200, 100);
    size(inner, { scrollWidth: 600, scrollHeight: 500 });
    f.box(a.text, 400, 800, 100, 40);
    const bodyScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const page = selectionApplication().pages[0];
    const selectionBefore = JSON.stringify(page);
    const located = new CanvasHost(f.surface).locate(page, 'alpha', 'alpha');
    expect(located?.marker).toBe(a.element);
    expect(inner.scrollLeft).toBeGreaterThan(0);
    expect(inner.scrollTop).toBeGreaterThan(0);
    expect(JSON.stringify(page)).toBe(selectionBefore);
    inner.scrollLeft = 0;
    inner.scrollTop = 0;
    f.child.documentElement.scrollLeft = 0;
    f.child.documentElement.scrollTop = 0;
    f.parent.scrollLeft = 0;
    f.parent.scrollTop = 0;
    const edge = toParentPoint({ x: 219, y: 119 }, f.child)!;
    expect(autoScrollAtPoint(edge, a.text)).toBe(true);
    expect(inner.scrollLeft).toBeCloseTo(16);
    expect(inner.scrollTop).toBeCloseTo(16);
    expect(f.parent.scrollLeft).toBe(0);
    expect(f.parent.scrollTop).toBe(0);
    inner.scrollLeft = 400;
    inner.scrollTop = 400;
    // At the child viewport edge, an exhausted inner scroller permits the
    // native child document before the unscaled parent pan on each axis.
    const childEdge = toParentPoint({ x: 779, y: 579 }, f.child)!;
    expect(autoScrollAtPoint(childEdge, a.text)).toBe(true);
    expect(f.child.documentElement.scrollTop).toBeGreaterThan(0);
    expect(f.parent.scrollTop).toBe(0);
    f.child.documentElement.scrollLeft = 720;
    f.child.documentElement.scrollTop = 1220;
    f.box(f.parent, 50, 40, 600, 400);
    size(f.parent, { scrollWidth: 1800, scrollHeight: 1400 });
    expect(autoScrollAtPoint(childEdge, a.text)).toBe(true);
    expect(f.child.documentElement.scrollTop).toBe(1220);
    expect(f.parent.scrollLeft).toBeGreaterThan(0);
    expect(f.parent.scrollTop).toBeGreaterThan(0);
    expect(bodyScroll).not.toHaveBeenCalled();
    f.retire();
    const before = f.child.documentElement.scrollTop;
    expect(autoScrollAtPoint(childEdge, a.text)).toBe(false);
    expect(f.child.documentElement.scrollTop).toBe(before);
  });
});
