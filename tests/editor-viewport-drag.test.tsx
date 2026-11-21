import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { autoScrollAtPoint } from '../src/editor/DragDrop';
import { hitTestDrop } from '../src/editor/hit-test';
import { compileApplication } from '../packages/runtime/engine';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { changeControl } from './ui-helpers';

const plan = compileApplication(exampleApplication, registry);
const elementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
let boxes: WeakMap<Element, DOMRect>;
beforeEach(() => {
  boxes = new WeakMap();
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this) ?? new DOMRect();
  });
});
afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  if (elementFromPoint) Object.defineProperty(document, 'elementFromPoint', elementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
function own(element: HTMLElement, dimensions: Record<string, number>) {
  Object.entries(dimensions).forEach(([name, value]) =>
    Object.defineProperty(element, name, { configurable: true, value }),
  );
}
function hit(element: Element | null) {
  const lookup = vi.fn(() => element);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: lookup });
  return lookup;
}
function scrollFixture(scale: number, fractional = false) {
  const root = document.createElement('div');
  root.className = 'canvas-scroll';
  root.style.overflow = 'auto';
  boxes.set(root, new DOMRect(50, 40, 620, 520));
  own(root, {
    offsetWidth: 620,
    offsetHeight: 520,
    clientLeft: 10,
    clientTop: 10,
    clientWidth: 600,
    clientHeight: 500,
    scrollWidth: 1600,
    scrollHeight: 1500,
  });
  const inner = document.createElement('div');
  inner.style.overflow = 'auto';
  inner.style.boxSizing = 'border-box';
  const logicalWidth = fractional ? 220.4 : 220,
    logicalHeight = fractional ? 180.4 : 180;
  inner.style.width = `${logicalWidth}px`;
  inner.style.height = `${logicalHeight}px`;
  boxes.set(inner, new DOMRect(100, 100, logicalWidth * scale, logicalHeight * scale));
  own(inner, {
    offsetWidth: 220,
    offsetHeight: 180,
    clientLeft: 10,
    clientTop: 10,
    clientWidth: 200,
    clientHeight: 160,
    scrollWidth: 1200,
    scrollHeight: 1400,
  });
  inner.scrollLeft = 13;
  inner.scrollTop = 21;
  const marker = document.createElement('span');
  inner.append(marker);
  root.append(inner);
  document.body.append(root);
  return { root, inner, marker, right: 100 + 210 * scale, bottom: 100 + 170 * scale };
}
function pointer(target: Element | Window, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
}

describe('drag auto-scroll converts only at each actual scroller boundary', () => {
  it.each([0.5, 1, 1.5, 1000 / 1440])(
    'moves exactly 12 screen pixels per axis inside a scaled scroller at %s',
    (scale) => {
      const { root, inner, marker, right, bottom } = scrollFixture(scale);
      expect(autoScrollAtPoint({ x: right - 1, y: bottom - 1 }, marker)).toBe(true);
      expect(inner.scrollLeft).toBeCloseTo(13 + 12 / scale, 10);
      expect(inner.scrollTop).toBeCloseTo(21 + 12 / scale, 10);
      expect(root.scrollLeft).toBe(0);
      expect(root.scrollTop).toBe(0);
    },
  );

  it('keeps fractional layout border dimensions rather than offsetWidth rounding at a non-round fit', () => {
    const scale = 1000 / 1440;
    const { inner, marker, right, bottom } = scrollFixture(scale, true);
    autoScrollAtPoint({ x: right - 1, y: bottom - 1 }, marker);
    expect(inner.scrollLeft).toBeCloseTo(13 + 12 / scale, 10);
    expect(inner.scrollTop).toBeCloseTo(21 + 12 / scale, 10);
  });

  it.each([0.5, 1.5])(
    'measures the edge threshold in screen pixels, independent of scale %s',
    (scale) => {
      const { inner, marker, right, bottom } = scrollFixture(scale);
      expect(autoScrollAtPoint({ x: right - 30, y: bottom - 30 }, marker)).toBe(false);
      expect([inner.scrollLeft, inner.scrollTop]).toEqual([13, 21]);
      expect(autoScrollAtPoint({ x: right - 29, y: bottom - 29 }, marker)).toBe(true);
      expect(inner.scrollLeft).toBeCloseTo(13 + 12 / scale, 10);
      expect(inner.scrollTop).toBeCloseTo(21 + 12 / scale, 10);
    },
  );

  it('clamps the last inner step, then permits each exhausted axis to scroll the unscaled outer canvas', () => {
    const scale = 0.5;
    const { root, inner, marker } = scrollFixture(scale);
    boxes.set(inner, new DOMRect(660 - 210 * scale, 550 - 170 * scale, 220 * scale, 180 * scale));
    inner.scrollLeft = 995;
    inner.scrollTop = 1240;
    expect(autoScrollAtPoint({ x: 659, y: 549 }, marker)).toBe(true);
    expect(inner.scrollLeft).toBe(1000);
    expect(inner.scrollTop).toBe(1240);
    expect(root.scrollLeft).toBe(0);
    expect(root.scrollTop).toBe(12);
    autoScrollAtPoint({ x: 659, y: 549 }, marker);
    expect(inner.scrollLeft).toBe(1000);
    expect(inner.scrollTop).toBe(1240);
    expect(root.scrollLeft).toBe(12);
    expect(root.scrollTop).toBe(24);
    root.scrollLeft = 998;
    root.scrollTop = 999;
    autoScrollAtPoint({ x: 659, y: 549 }, marker);
    expect(root.scrollLeft).toBe(1000);
    expect(root.scrollTop).toBe(1000);
    expect(autoScrollAtPoint({ x: 659, y: 549 }, marker)).toBe(false);
  });

  it('handles negative native RTL horizontal ranges without changing the screen-space direction', () => {
    const scale = 0.5;
    const { inner, marker } = scrollFixture(scale);
    inner.style.direction = 'rtl';
    inner.scrollLeft = 0;
    autoScrollAtPoint({ x: 106, y: 140 }, marker);
    expect(inner.scrollLeft).toBe(-24);
    inner.scrollLeft = -995;
    autoScrollAtPoint({ x: 106, y: 140 }, marker);
    expect(inner.scrollLeft).toBe(-1000);
  });

  it('scrolls only the component-tree sidebar and never an unrelated panel, hidden ancestor or window', () => {
    const { root, inner, marker, right, bottom } = scrollFixture(1);
    const windowScroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    root.className = 'sidebar-content';
    expect(autoScrollAtPoint({ x: right - 1, y: bottom - 1 }, marker)).toBe(false);
    const tree = document.createElement('div');
    tree.className = 'component-tree';
    inner.append(tree);
    tree.append(marker);
    expect(autoScrollAtPoint({ x: right - 1, y: bottom - 1 }, marker)).toBe(true);
    inner.style.display = 'none';
    const before = [inner.scrollLeft, inner.scrollTop];
    expect(autoScrollAtPoint({ x: right - 1, y: bottom - 1 }, marker)).toBe(false);
    expect([inner.scrollLeft, inner.scrollTop]).toEqual(before);
    expect(autoScrollAtPoint({ x: 1000, y: 1000 }, document.body)).toBe(false);
    expect(autoScrollAtPoint({ x: 1000, y: 1000 }, null)).toBe(false);
    expect(windowScroll).not.toHaveBeenCalled();
  });
});

describe('drop hit testing consumes visual client rectangles without a second scale conversion', () => {
  it.each([0.5, 1.5, 1000 / 1440])(
    'resolves row/reverse/RTL, page gaps, repeat instances and explicit slots at scale %s',
    (scale) => {
      document.body.innerHTML =
        '<div class="editor-surface"><div data-editor-node="purchase-heading"><h2>标题</h2></div><div data-editor-node="purchase-form"><form><div data-editor-node="purchase-name"><input /></div><div data-editor-node="purchase-items"><section>明细</section></div></form></div><div data-editor-node="purchase-note"><div style="display:flex;flex-direction:row"><div data-editor-node="purchase-notice"><p>说明</p></div></div></div><div data-editor-node="purchase-notice" data-editor-instance="repeat2"><p>重复说明</p></div><div data-drop-intent=\'{"kind":"inside","parentId":"person-card","slot":"footer"}\'>footer</div></div>';
      const surface = document.querySelector('.editor-surface')!;
      const row = document.querySelector('[data-editor-node="purchase-note"] > div') as HTMLElement;
      const notice = row.querySelector('p')!;
      boxes.set(notice, new DOMRect(123.25, 80.5, 200 * scale, 40 * scale));
      const lookup = hit(notice);
      const leftPoint = { x: 123.25 + 40 * scale, y: 80.5 + 20 * scale };
      expect(hitTestDrop(leftPoint, plan, 'purchase')).toEqual({
        kind: 'before',
        nodeId: 'purchase-notice',
      });
      expect(lookup).toHaveBeenLastCalledWith(leftPoint.x, leftPoint.y);
      row.style.flexDirection = 'row-reverse';
      expect(hitTestDrop(leftPoint, plan, 'purchase')).toEqual({
        kind: 'after',
        nodeId: 'purchase-notice',
      });
      row.style.direction = 'rtl';
      expect(hitTestDrop(leftPoint, plan, 'purchase')).toEqual({
        kind: 'before',
        nodeId: 'purchase-notice',
      });
      const heading = surface.querySelector('h2')!,
        form = surface.querySelector('form')!;
      boxes.set(heading, new DOMRect(100, 100, 200 * scale, 40 * scale));
      boxes.set(form, new DOMRect(100, 100 + 100 * scale, 200 * scale, 300 * scale));
      boxes.set(
        form.querySelector('input')!,
        new DOMRect(100, 100 + 120 * scale, 200 * scale, 40 * scale),
      );
      boxes.set(
        form.querySelector('section')!,
        new DOMRect(100, 100 + 220 * scale, 200 * scale, 40 * scale),
      );
      lookup.mockReturnValue(surface);
      expect(hitTestDrop({ x: 110, y: 100 + 60 * scale }, plan, 'purchase')).toEqual({
        kind: 'after',
        nodeId: 'purchase-heading',
      });
      lookup.mockReturnValue(form);
      expect(hitTestDrop({ x: 110, y: 100 + 210 * scale }, plan, 'purchase')).toEqual({
        kind: 'before',
        nodeId: 'purchase-items',
      });
      const repeated = surface.querySelector('[data-editor-instance="repeat2"] p')!;
      boxes.set(repeated, new DOMRect(350, 450, 200 * scale, 40 * scale));
      lookup.mockReturnValue(repeated);
      expect(hitTestDrop({ x: 350 + 20 * scale, y: 450 + 35 * scale }, plan, 'purchase')).toEqual({
        kind: 'after',
        nodeId: 'purchase-notice',
      });
      lookup.mockReturnValue(surface.querySelector('[data-drop-intent]')!);
      expect(hitTestDrop({ x: 500, y: 600 }, plan, 'composition')).toEqual({
        kind: 'inside',
        parentId: 'person-card',
        slot: 'footer',
      });
    },
  );
});

describe('real selected canvas body dragging under non-unit presentation', () => {
  it.each(['50', '150', 'fit'])(
    'retains client pointer coordinates, screen-sized toolbar and fresh release targets at %s',
    async (selection) => {
      seedLegacyProject();
      const view = render(<App />);
      changeControl(screen.getByRole('combobox', { name: '画布设备宽度' }), 'desktop');
      const outer = screen.getByLabelText('页面画布');
      own(outer, {
        clientWidth: 1000,
        clientHeight: 700,
        offsetWidth: 1000,
        offsetHeight: 700,
        clientLeft: 0,
        clientTop: 0,
      });
      boxes.set(outer, new DOMRect(80, 60, 1000, 700));
      fireEvent(window, new Event('resize'));
      if (selection === 'fit') {
        fireEvent.click(screen.getByRole('button', { name: '适应画布宽度' }));
      } else changeControl(screen.getByRole('combobox', { name: '画布缩放' }), selection);
      const host = view.container.querySelector<HTMLElement>('.canvas-viewport')!;
      const scale = Number(host.dataset.viewportScale);
      expect(scale).not.toBe(1);
      const canvas = screen.getByLabelText('页面编辑画布');
      boxes.set(canvas, new DOMRect(100, 80, 1440 * scale, 1200 * scale));
      const heading = screen.getByRole('heading', { name: '创建采购申请' });
      boxes.set(heading, new DOMRect(160.25, 140.5, 600 * scale, 40 * scale));
      fireEvent.click(heading);
      fireEvent(window, new Event('resize'));
      await waitFor(() =>
        expect(view.container.querySelector('.canvas-selection-toolbar')).not.toBeNull(),
      );
      const outline = view.container.querySelector<HTMLElement>(
        '[data-editor-outline="purchase-heading"].selected',
      )!;
      expect(parseFloat(outline.style.left)).toBeCloseTo(60.25, 8);
      expect(parseFloat(outline.style.top)).toBeCloseTo(60.5, 8);
      expect(parseFloat(outline.style.width)).toBeCloseTo(600 * scale, 8);
      const toolbar = outline.querySelector<HTMLElement>('.canvas-selection-toolbar')!;
      expect(toolbar.style.width).toBe('218px');
      expect(toolbar.closest('.canvas-scaled-surface')).toBeNull();
      const capture = vi.fn();
      Object.defineProperty(canvas, 'setPointerCapture', { value: capture });
      const lookup = hit(view.container.querySelector('[data-drop-intent]')!);
      pointer(heading, 'pointerdown', 160.25, 140.5);
      pointer(window, 'pointermove', 165.25, 140.5);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      pointer(window, 'pointermove', 166.25, 140.5);
      expect(screen.getByLabelText('拖放操作')).toBeTruthy();
      expect(capture).toHaveBeenCalledWith(1);
      expect(lookup).toHaveBeenLastCalledWith(166.25, 140.5);
      lookup.mockReturnValue(null);
      pointer(window, 'pointerup', 400, 450);
      expect(lookup).toHaveBeenLastCalledWith(400, 450);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(screen.getByRole('heading', { name: '创建采购申请' })).toBe(heading);
      expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      lookup.mockReturnValue(screen.getByText('页面末尾 · 拖入组件'));
      pointer(heading, 'pointerdown', 160.25, 140.5);
      pointer(window, 'pointermove', 400, 450);
      pointer(window, 'pointerup', 400, 450);
      const order = () =>
        [
          ...view.container.querySelectorAll<HTMLElement>('.editor-surface > [data-editor-node]'),
        ].map((node) => node.dataset.editorNode);
      expect(order()).toEqual(['purchase-form', 'purchase-heading']);
      fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
      expect(order()).toEqual(['purchase-heading', 'purchase-form']);
      expect((screen.getByRole('button', { name: /撤销/ }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    },
  );
});
