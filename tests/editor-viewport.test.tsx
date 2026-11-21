import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import type {
  ApplicationSchema,
  Json,
  NodeSchema,
  PageCode,
  Value,
} from '../packages/schema/types';
import { RuntimeRenderer, useMaterialNode, useRuntime } from '../packages/react-runtime/Renderer';
import { materials, registry } from '../src/materials';
import { CanvasViewport, CanvasSurface } from '../src/editor/CanvasViewport';
import { ViewportStore, resolveViewport } from '../src/editor/viewport';
import {
  clientBounds,
  logicalToScreen,
  normalizeRect,
  screenToLogical,
  scrollByScreen,
  visualScale,
} from '../src/editor/coordinates';
import { clippingBounds, revealRect } from '../src/editor/CanvasHost';
import { EditorSessionProvider, useDraft, useEditorViewport } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { CodePageCanvas } from '../src/code/CodePage';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const text = (id: string): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value: literal(id) },
});
function fixture(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'viewport-acceptance',
    title: '视口独立验收',
    entryPageId: 'page',
    dependencies: {
      components: Object.fromEntries(
        Object.entries(registry.components).map(([id, value]) => [id, value.version]),
      ),
      actions: {},
    },
    pages: [
      {
        id: 'page',
        title: '页面',
        state: [],
        forms: [
          {
            id: 'model',
            fields: [
              { id: 'name', path: ['name'], label: '绑定名称', type: 'string', initial: '' },
            ],
            arrays: [
              {
                id: 'items',
                path: ['items'],
                label: '项目明细',
                fields: [
                  { id: 'name', path: ['name'], label: '项目', type: 'string', initial: '' },
                ],
                initial: [{ name: '第一行' }],
              },
            ],
          },
        ],
        children: [
          {
            id: 'form',
            component: 'ui.form',
            formId: 'model',
            props: {},
            children: [
              text('page-probe'),
              {
                id: 'bound',
                component: 'ui.input',
                props: {},
                field: { formId: 'model', fieldId: 'name' },
              },
              {
                id: 'details',
                component: 'ui.fieldArray',
                props: { formId: literal('model'), arrayId: literal('items') },
              },
              {
                id: 'drawer',
                component: 'ui.drawer',
                props: {
                  title: literal('视口抽屉'),
                  open: literal(true),
                  showTrigger: literal(false),
                },
                children: [text('drawer-probe')],
                slots: { footer: { params: [], children: [text('footer-probe')] } },
              },
            ],
          },
        ],
      },
    ],
  };
}

const runtimes: PageRuntime[] = [];
let boxes: WeakMap<Element, DOMRect>;
let layoutBox: ((element: Element) => DOMRect | undefined) | undefined;
beforeEach(() => {
  boxes = new WeakMap();
  layoutBox = undefined;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return boxes.get(this) ?? layoutBox?.(this) ?? new DOMRect();
  });
});
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).__viewportCodeProbe;
});
function ownSize(element: HTMLElement, values: Record<string, number>) {
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(element, name, { configurable: true, value });
}
function scroller(scaleX: number, scaleY = scaleX) {
  const element = document.createElement('div');
  element.style.overflow = 'auto';
  boxes.set(element, new DOMRect(100, 80, 220 * scaleX, 180 * scaleY));
  ownSize(element, {
    offsetWidth: 220,
    offsetHeight: 180,
    clientLeft: 10,
    clientTop: 10,
    clientWidth: 200,
    clientHeight: 160,
    scrollWidth: 1200,
    scrollHeight: 1400,
  });
  element.scrollLeft = 13;
  element.scrollTop = 21;
  document.body.append(element);
  return element;
}
function sameElements(actual: Element[], expected: Element[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((element, index) => expect(element).toBe(expected[index]));
}

/** JSDOM has no layout. Supply independent border boxes and browser-like scroll clamping. */
function physicalViewport(logicalHeight = 1400) {
  const observers = new Set<{ targets: Set<Element>; callback: ResizeObserverCallback }>();
  class ControlledResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe = (element: Element) => this.targets.add(element);
    unobserve = (element: Element) => this.targets.delete(element);
    disconnect = () => {
      this.targets.clear();
      observers.delete(this);
    };
  }
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
  const outer = document.createElement('div');
  outer.className = 'canvas-scroll';
  outer.style.padding = '10px 20px';
  outer.style.overflow = 'auto';
  boxes.set(outer, new DOMRect(100, 80, 820, 620));
  let clientWidth = 800,
    clientHeight = 600,
    left = 0,
    top = 0;
  ownSize(outer, { offsetWidth: 820, offsetHeight: 620, clientLeft: 10, clientTop: 10 });
  const stage = () => outer.querySelector<HTMLElement>('.canvas-surface-space');
  const width = () => parseFloat(stage()?.style.width ?? '') || 0;
  const height = () => parseFloat(stage()?.style.height ?? '') || 0;
  Object.defineProperties(outer, {
    clientWidth: { configurable: true, get: () => clientWidth },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollWidth: { configurable: true, get: () => Math.max(clientWidth, width() + 40) },
    scrollHeight: { configurable: true, get: () => Math.max(clientHeight, height() + 20) },
    scrollLeft: {
      configurable: true,
      get: () => Math.max(0, Math.min(left, outer.scrollWidth - clientWidth)),
      set: (value: number) => {
        left = Math.max(0, Math.min(value, outer.scrollWidth - clientWidth));
      },
    },
    scrollTop: {
      configurable: true,
      get: () => Math.max(0, Math.min(top, outer.scrollHeight - clientHeight)),
      set: (value: number) => {
        top = Math.max(0, Math.min(value, outer.scrollHeight - clientHeight));
      },
    },
  });
  layoutBox = (element) => {
    if (!outer.contains(element)) return undefined;
    const host = outer.querySelector<HTMLElement>('.canvas-viewport');
    const scale = Number(host?.dataset.viewportScale ?? 1);
    const stageLeft = 130 + Math.max(0, (clientWidth - 40 - width()) / 2) - outer.scrollLeft;
    const stageTop = 100 - outer.scrollTop;
    if (element.classList.contains('canvas-surface-space'))
      return new DOMRect(stageLeft, stageTop, width(), height());
    if (element.classList.contains('canvas-scaled-surface'))
      return new DOMRect(
        stageLeft,
        stageTop,
        Number(host?.dataset.viewportWidth ?? 960) * scale,
        Math.max(logicalHeight, parseFloat((element as HTMLElement).style.minHeight) || 0) * scale,
      );
    return undefined;
  };
  document.body.append(outer);
  return {
    outer,
    resize(element: Element) {
      observers.forEach((observer) => {
        if (observer.targets.has(element))
          observer.callback([], observer as unknown as ResizeObserver);
      });
    },
    setAvailable(width: number, height: number) {
      clientWidth = width + 40;
      clientHeight = height + 20;
      ownSize(outer, { offsetWidth: clientWidth + 20, offsetHeight: clientHeight + 20 });
      boxes.set(outer, new DOMRect(100, 80, clientWidth + 20, clientHeight + 20));
    },
    setContentHeight(height: number) {
      logicalHeight = height;
    },
  };
}

describe('viewport model separates logical device width from edit presentation', () => {
  it('fills the available editing width while preserving the preview width cap and shared floor', () => {
    const viewport = new ViewportStore();
    for (const [available, editWidth, previewWidth] of [
      [100, 240, 240],
      [700, 700, 700],
      [1600, 1600, 960],
    ] as const) {
      viewport.measure(available, 600);
      for (const scale of [0.5, 1, 1.5]) {
        viewport.setScale(scale);
        expect(resolveViewport(viewport.getSnapshot(), 'edit').width).toBe(editWidth);
        expect(resolveViewport(viewport.getSnapshot(), 'preview').width).toBe(previewWidth);
      }
    }
  });

  it('preserves named and custom logical widths across zoom, preview, and a narrower editor shell', () => {
    const viewport = new ViewportStore();
    viewport.measure(800, 500);
    viewport.setScale(0.75);
    for (const [preset, expected] of [
      ['desktop', 1440],
      ['tablet', 768],
      ['phone', 390],
    ] as const) {
      viewport.setPreset(preset);
      expect(resolveViewport(viewport.getSnapshot(), 'edit')).toMatchObject({
        width: expected,
        scale: 0.75,
      });
      expect(resolveViewport(viewport.getSnapshot(), 'preview')).toMatchObject({
        width: expected,
        scale: 1,
      });
      expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBe(0.75);
    }
    viewport.setCustomWidth(1234);
    viewport.setPreset('custom');
    viewport.measure(280, 300);
    expect(resolveViewport(viewport.getSnapshot(), 'edit')).toMatchObject({
      width: 1234,
      scale: 0.75,
    });
    expect(resolveViewport(viewport.getSnapshot(), 'preview')).toMatchObject({
      width: 1234,
      scale: 1,
    });
  });

  it('validates custom integer widths and finite zoom without publishing malformed state', () => {
    const viewport = new ViewportStore();
    for (const width of [239, 3841, 240.5, NaN, Infinity]) {
      const before = viewport.getSnapshot();
      expect(viewport.setCustomWidth(width)).toBe(false);
      expect(viewport.getSnapshot()).toBe(before);
    }
    expect(viewport.setCustomWidth(240)).toBe(true);
    expect(viewport.getSnapshot().customWidth).toBe(240);
    expect(viewport.setCustomWidth(3840)).toBe(true);
    viewport.setScale(0.1);
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBe(0.5);
    viewport.setScale(4);
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBe(1.5);
    for (const value of [NaN, Infinity, -Infinity]) {
      const before = viewport.getSnapshot();
      expect(viewport.setScale(value)).toBe(false);
      expect(viewport.getSnapshot()).toBe(before);
    }
  });

  it('continuously fits width, reports clamping, and stops following fit after a manual scale change', () => {
    const viewport = new ViewportStore();
    viewport.setPreset('desktop');
    viewport.measure(1000, 200);
    viewport.setFit();
    expect(resolveViewport(viewport.getSnapshot(), 'edit')).toMatchObject({
      width: 1440,
      fitClamped: false,
    });
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBeCloseTo(1000 / 1440, 10);
    viewport.measure(1000, 20000);
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBeCloseTo(1000 / 1440, 10);
    viewport.measure(400, 20000);
    expect(resolveViewport(viewport.getSnapshot(), 'edit')).toMatchObject({
      scale: 0.5,
      fitClamped: true,
    });
    viewport.measure(3000, 500);
    expect(resolveViewport(viewport.getSnapshot(), 'edit')).toMatchObject({
      scale: 1.5,
      fitClamped: true,
    });
    viewport.setScale(1.25);
    viewport.measure(750, 500);
    expect(viewport.getSnapshot().zoom.kind).toBe('manual');
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBe(1.25);
  });

  it('deduplicates stable measurements and rejects user changes throughout a gesture while applying only the latest deferred resize', () => {
    const viewport = new ViewportStore();
    viewport.setPreset('desktop');
    viewport.measure(1000, 700);
    viewport.setFit();
    const listener = vi.fn();
    const unsubscribe = viewport.subscribe(listener);
    const before = viewport.getSnapshot();
    viewport.measure(1000, 700);
    expect(viewport.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    viewport.setInteracting(true);
    const locked = viewport.getSnapshot();
    expect(viewport.setPreset('phone')).toBe(false);
    expect(viewport.setCustomWidth(700)).toBe(false);
    expect(viewport.setScale(1.5)).toBe(false);
    expect(viewport.setFit()).toBe(false);
    viewport.measure(1100, 500);
    viewport.measure(1200, 600);
    expect(resolveViewport(viewport.getSnapshot(), 'edit')).toEqual(
      resolveViewport(locked, 'edit'),
    );
    viewport.setInteracting(false);
    expect(viewport.getSnapshot()).toMatchObject({
      preset: 'desktop',
      availableWidth: 1200,
      availableHeight: 600,
    });
    expect(viewport.getSnapshot().zoom.kind).toBe('fit');
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBeCloseTo(1200 / 1440, 10);
    unsubscribe();
  });
});

describe('explicit client and logical coordinate boundaries', () => {
  it.each([0.5, 0.75, 1, 1.25, 1.5, 1000 / 1440])(
    'roundtrips known points at scale %s with a nonzero fractional origin',
    (scale) => {
      const origin = { x: 123.25, y: -47.5 };
      for (const logical of [
        { x: 0, y: 0 },
        { x: -20.5, y: 70.25 },
        { x: 1440, y: 900 },
      ]) {
        const expected = { x: 123.25 + logical.x * scale, y: -47.5 + logical.y * scale };
        const client = logicalToScreen(logical, origin, scale);
        expect(client.x).toBeCloseTo(expected.x, 10);
        expect(client.y).toBeCloseTo(expected.y, 10);
        const result = screenToLogical(expected, origin, scale);
        expect(result.x).toBeCloseTo(logical.x, 10);
        expect(result.y).toBeCloseTo(logical.y, 10);
        const roundtrip = logicalToScreen(screenToLogical(expected, origin, scale), origin, scale);
        expect(roundtrip.x).toBeCloseTo(expected.x, 10);
        expect(roundtrip.y).toBeCloseTo(expected.y, 10);
      }
    },
  );

  it('normalizes native DOMRect fields explicitly, including fractional and negative coordinates', () => {
    const rect = new DOMRect(-15.5, 20.25, 150.5, 60.5);
    expect(Object.keys(rect)).not.toContain('left');
    const normalized = normalizeRect(rect);
    expect(normalized).toMatchObject({
      left: -15.5,
      top: 20.25,
      right: 135,
      bottom: 80.75,
      width: 150.5,
      height: 60.5,
    });
    expect({ ...normalized }).toMatchObject({ left: -15.5, top: 20.25, right: 135, bottom: 80.75 });
  });

  it.each([0.5, 1, 1.5])(
    'measures scaled client borders and converts scroll displacement once at scale %s',
    (scale) => {
      const element = scroller(scale);
      expect(visualScale(element)).toMatchObject({ x: scale, y: scale });
      expect(clientBounds(element)).toMatchObject({
        left: 100 + 10 * scale,
        top: 80 + 10 * scale,
        right: 100 + 210 * scale,
        bottom: 80 + 170 * scale,
        width: 200 * scale,
        height: 160 * scale,
      });
      expect(scrollByScreen(element, { x: 30 * scale, y: 70 * scale })).toBe(true);
      expect([element.scrollLeft, element.scrollTop]).toEqual([43, 91]);
      expect(scrollByScreen(element, { x: 0, y: 0 })).toBe(false);
      element.remove();
    },
  );

  it('supports distinct horizontal and vertical visual scales for border and internal-scroll conversion', () => {
    const element = scroller(0.75, 1.25);
    expect(visualScale(element)).toMatchObject({ x: 0.75, y: 1.25 });
    expect(clientBounds(element)).toMatchObject({
      left: 107.5,
      top: 92.5,
      right: 257.5,
      bottom: 292.5,
      width: 150,
      height: 200,
    });
    scrollByScreen(element, { x: 22.5, y: 87.5 });
    expect([element.scrollLeft, element.scrollTop]).toEqual([43, 91]);
    element.remove();
  });

  it.each([0.5, 1, 1.5])(
    'reveals through the actual client viewport in logical scroll units at scale %s',
    (scale) => {
      const element = scroller(scale);
      const target = new DOMRect(100 + 240 * scale, 80 + 220 * scale, 40 * scale, 20 * scale);
      revealRect(element, target, 0);
      expect(element.scrollLeft).toBeCloseTo(83, 10);
      expect(element.scrollTop).toBeCloseTo(91, 10);
      element.remove();
    },
  );

  it('clips both axes against scaled inner client borders without applying page scale to the outer canvas viewport', () => {
    const root = document.createElement('div');
    root.className = 'canvas-scroll';
    boxes.set(root, new DOMRect(0, 0, 1000, 800));
    ownSize(root, {
      offsetWidth: 1000,
      offsetHeight: 800,
      clientWidth: 1000,
      clientHeight: 800,
      clientLeft: 0,
      clientTop: 0,
    });
    const surface = document.createElement('div');
    const inner = scroller(0.5);
    const marker = document.createElement('div');
    inner.append(marker);
    surface.append(inner);
    root.append(surface);
    document.body.append(root);
    expect(clippingBounds(marker, surface)).toMatchObject({
      left: 105,
      top: 85,
      right: 205,
      bottom: 165,
      width: 100,
      height: 80,
    });
    root.remove();
  });
});

describe('viewport physical geometry and independent resize boundaries', () => {
  function mountViewport(physical: ReturnType<typeof physicalViewport>, initiallyReady = true) {
    let viewport!: ViewportStore;
    let setMode!: Dispatch<SetStateAction<'edit' | 'preview'>>;
    let setReady!: Dispatch<SetStateAction<boolean>>;
    function Scene() {
      viewport = useEditorViewport().viewport;
      const [mode, changeMode] = useState<'edit' | 'preview'>('edit');
      const [ready, changeReady] = useState(initiallyReady);
      setMode = changeMode;
      setReady = changeReady;
      return (
        <CanvasViewport mode={mode}>
          {ready ? (
            <CanvasSurface>
              <input aria-label="稳定业务输入" defaultValue="保留" />
            </CanvasSurface>
          ) : (
            <p>Loading</p>
          )}
          <div data-testid="physical-adornment" style={{ width: 24, height: 24 }}>
            工具
          </div>
        </CanvasViewport>
      );
    }
    const view = render(
      <EditorSessionProvider>
        <Scene />
      </EditorSessionProvider>,
      { container: physical.outer },
    );
    return { view, viewport, setMode, setReady };
  }

  it('measures unscaled available padding once and reserves physical width/height while only transforming the business surface', () => {
    const physical = physicalViewport();
    const { view, viewport, setMode } = mountViewport(physical);
    expect(viewport.getSnapshot()).toMatchObject({ availableWidth: 760, availableHeight: 580 });
    act(() => {
      viewport.setPreset('desktop');
      viewport.setScale(0.5);
    });
    const host = view.container.querySelector<HTMLElement>('.canvas-viewport')!;
    const surface = view.container.querySelector<HTMLElement>('.canvas-scaled-surface')!;
    const space = view.container.querySelector<HTMLElement>('.canvas-surface-space')!;
    const adornment = screen.getByTestId('physical-adornment');
    const input = screen.getByLabelText('稳定业务输入');
    expect(host.style.width).toBe('720px');
    expect(surface.style.width).toBe('1440px');
    expect(surface.style.transform).toBe('scale(0.5)');
    expect(space.style.width).toBe('720px');
    expect(space.style.height).toBe('700px');
    expect(surface.contains(adornment)).toBe(false);
    expect(adornment.style.transform).toBe('');
    expect(adornment.style.width).toBe('24px');
    act(() => setMode('preview'));
    expect(view.container.querySelector('.canvas-scaled-surface')).toBe(surface);
    expect(screen.getByLabelText('稳定业务输入')).toBe(input);
    expect(surface.style.transform).toBe('');
    expect(host.style.width).toBe('1440px');
    expect(space.style.height).toBe('1400px');
    act(() => setMode('edit'));
    expect(surface.style.transform).toBe('scale(0.5)');
    expect(host.style.width).toBe('720px');
    expect(screen.getByLabelText('稳定业务输入')).toBe(input);
  });

  it('uses continuous available width for fit without a height feedback loop and measures content height independently', async () => {
    const physical = physicalViewport();
    const { view, viewport } = mountViewport(physical);
    act(() => {
      viewport.setPreset('desktop');
      viewport.setFit();
    });
    const surface = view.container.querySelector<HTMLElement>('.canvas-scaled-surface')!;
    const host = view.container.querySelector<HTMLElement>('.canvas-viewport')!;
    const space = view.container.querySelector<HTMLElement>('.canvas-surface-space')!;
    expect(Number(host.dataset.viewportScale)).toBeCloseTo(760 / 1440, 10);
    expect(parseFloat(host.style.width)).toBeCloseTo(760, 10);
    const publish = vi.fn();
    const unsubscribe = viewport.subscribe(publish);
    act(() => {
      physical.setAvailable(1000, 500);
      physical.resize(physical.outer);
    });
    expect(Number(host.dataset.viewportScale)).toBeCloseTo(1000 / 1440, 10);
    expect(parseFloat(host.style.width)).toBeCloseTo(1000, 10);
    expect(publish).toHaveBeenCalledTimes(1);
    act(() => {
      physical.setAvailable(1000, 2000);
      physical.resize(physical.outer);
      physical.resize(physical.outer);
    });
    expect(Number(host.dataset.viewportScale)).toBeCloseTo(1000 / 1440, 10);
    expect(publish).toHaveBeenCalledTimes(2);
    act(() => {
      physical.setAvailable(1000, 500);
      physical.resize(physical.outer);
      physical.setContentHeight(1800);
      physical.resize(surface);
    });
    await waitFor(() => expect(parseFloat(space.style.height)).toBeCloseTo(1250, 8));
    expect(Number(host.dataset.viewportScale)).toBeCloseTo(1000 / 1440, 10);
    expect(publish).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it('preserves the actual visible logical center across both scroll axes and clamps when the selected page becomes smaller', () => {
    const physical = physicalViewport();
    const { view, viewport, setMode } = mountViewport(physical);
    act(() => viewport.setPreset('desktop'));
    physical.outer.scrollLeft = 70;
    physical.outer.scrollTop = 200;
    fireEvent.scroll(physical.outer);
    act(() => viewport.setScale(1.5));
    expect(physical.outer.scrollLeft).toBeCloseTo(295, 10);
    expect(physical.outer.scrollTop).toBeCloseTo(445, 10);
    act(() => viewport.setScale(1.25));
    expect(physical.outer.scrollLeft).toBeCloseTo(182.5, 10);
    expect(physical.outer.scrollTop).toBeCloseTo(322.5, 10);
    act(() => setMode('preview'));
    expect(physical.outer.scrollLeft).toBeCloseTo(70, 10);
    expect(physical.outer.scrollTop).toBeCloseTo(200, 10);
    expect(
      view.container.querySelector<HTMLElement>('.canvas-scaled-surface')!.style.transform,
    ).toBe('');
    act(() => viewport.setPreset('phone'));
    expect(physical.outer.scrollLeft).toBe(0);
    expect(physical.outer.scrollTop).toBeCloseTo(200, 10);
    expect(physical.outer.scrollTop).toBeLessThanOrEqual(
      physical.outer.scrollHeight - physical.outer.clientHeight,
    );
  });

  it('initializes the scroll anchor when a loading placeholder is replaced by a stable surface', async () => {
    const physical = physicalViewport();
    const { viewport, setReady } = mountViewport(physical, false);
    act(() => viewport.setPreset('desktop'));
    act(() => setReady(true));
    await act(async () => {
      await Promise.resolve();
    });
    physical.outer.scrollLeft = 70;
    physical.outer.scrollTop = 200;
    fireEvent.scroll(physical.outer);
    act(() => viewport.setScale(1.5));
    expect(physical.outer.scrollLeft).toBeCloseTo(295, 10);
    expect(physical.outer.scrollTop).toBeCloseTo(445, 10);
  });
});

describe('stable viewport host preserves the business tree and editor session', () => {
  it('retains actual Hook, Form, row, body/footer Portal and draft identities through device, zoom, fit and preview changes', async () => {
    const schema = fixture();
    const editorDocument = new EditorDocument(schema, registry);
    const runtime = new PageRuntime(editorDocument.getSnapshot().plan, 'page', {
      designMode: true,
    });
    runtimes.push(runtime);
    const form = runtime.getForm('model');
    const mounted = vi.fn(),
      unmounted = vi.fn();
    let serial = 0;
    const setters = new Map<string, Dispatch<SetStateAction<string>>>();
    function Probe() {
      const id = useMaterialNode()!.id;
      const token = useRef(++serial);
      const owner = useRuntime();
      const [value, setValue] = useState('initial');
      setters.set(id, setValue);
      useEffect(() => {
        mounted(id, token.current, owner);
        return () => {
          unmounted(id, token.current);
        };
      }, []);
      return (
        <input
          aria-label={`Hook ${id}`}
          data-hook-token={token.current}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    let viewport!: ViewportStore;
    let setMode!: Dispatch<SetStateAction<'edit' | 'preview'>>;
    function Scene() {
      const access = useEditorViewport();
      viewport = access.viewport;
      const [mode, changeMode] = useState<'edit' | 'preview'>('edit');
      const [draft, setDraft] = useDraft('viewport/invalid-code', 'source', 'initial');
      setMode = changeMode;
      return (
        <>
          <textarea
            aria-label="未提交代码草稿"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="canvas-scroll">
            <CanvasViewport mode={mode}>
              <CanvasSurface>
                <RuntimeRenderer
                  runtime={runtime}
                  materials={{ ...materials, 'ui.text': Probe }}
                  designMode={mode === 'edit'}
                />
              </CanvasSurface>
              <div data-testid="viewport-adornment">辅助层</div>
            </CanvasViewport>
          </div>
        </>
      );
    }
    const view = render(
      <EditorSessionProvider>
        <TipProvider>
          <Scene />
        </TipProvider>
      </EditorSessionProvider>,
    );
    await waitFor(() =>
      expect(view.container.querySelectorAll('input[data-hook-token]')).toHaveLength(3),
    );
    act(() => {
      viewport.measure(900, 600);
      form.setValue('name', '保留绑定值');
      form.blur('name');
      form.append('items', { name: '第二行' });
      setters.forEach((setValue, id) => setValue(`draft-${id}`));
    });
    const draft = screen.getByLabelText('未提交代码草稿') as HTMLTextAreaElement;
    fireEvent.change(draft, { target: { value: 'export default () => <' } });
    const originals = {
      probes: [...view.container.querySelectorAll('input[data-hook-token]')],
      portals: [...view.container.querySelectorAll('.material-overlay-mount')],
      popups: [...view.container.querySelectorAll('.material-modal')],
      rows: [...view.container.querySelectorAll('[data-row-id]')],
      bound: view.container.querySelector('[name="name"]'),
      host: view.container.querySelector('.canvas-viewport'),
      surface: view.container.querySelector('.canvas-scaled-surface'),
      mounts: mounted.mock.calls.length,
      cleanups: unmounted.mock.calls.length,
      document: editorDocument.getSnapshot(),
      form: form.getSnapshot(),
      json: editorDocument.exportJson(),
    };
    expect(originals.portals).toHaveLength(1);
    expect(originals.popups).toHaveLength(1);
    expect(originals.rows).toHaveLength(2);
    expect(originals.bound).not.toBeNull();
    expect(originals.host).not.toBeNull();
    expect(originals.surface).not.toBeNull();
    const run = vi.spyOn(runtime, 'run'),
      enter = vi.spyOn(runtime, 'enter'),
      reset = vi.spyOn(form, 'reset');
    for (const action of [
      () => viewport.setPreset('phone'),
      () => viewport.setScale(0.5),
      () => viewport.setScale(1.5),
      () => viewport.setPreset('desktop'),
      () => viewport.setFit(),
      () => viewport.measure(1000, 500),
      () => setMode('preview'),
      () => viewport.setPreset('tablet'),
      () => setMode('edit'),
    ]) {
      act(action);
      sameElements(
        [...view.container.querySelectorAll('input[data-hook-token]')],
        originals.probes,
      );
      sameElements(
        [...view.container.querySelectorAll('.material-overlay-mount')],
        originals.portals,
      );
      sameElements([...view.container.querySelectorAll('.material-modal')], originals.popups);
      sameElements([...view.container.querySelectorAll('[data-row-id]')], originals.rows);
      expect(view.container.querySelector('[name="name"]')).toBe(originals.bound);
      expect(view.container.querySelector('.canvas-viewport')).toBe(originals.host);
      expect(view.container.querySelector('.canvas-scaled-surface')).toBe(originals.surface);
      expect(screen.getByLabelText('未提交代码草稿')).toBe(draft);
      expect(draft.value).toBe('export default () => <');
      for (const [index, element] of [
        ...view.container.querySelectorAll<HTMLInputElement>('input[data-hook-token]'),
      ].entries()) {
        expect(element.value).toBe(
          ['draft-page-probe', 'draft-drawer-probe', 'draft-footer-probe'][index],
        );
      }
      expect(mounted).toHaveBeenCalledTimes(originals.mounts);
      expect(unmounted).toHaveBeenCalledTimes(originals.cleanups);
      expect(form.getSnapshot()).toBe(originals.form);
      expect(editorDocument.getSnapshot()).toBe(originals.document);
      expect(editorDocument.exportJson()).toBe(originals.json);
      expect(runtime.disposed).toBe(false);
      expect(run).not.toHaveBeenCalled();
      expect(enter).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
    }
    expect(mounted.mock.calls.every((call) => call[2] === runtime)).toBe(true);
  });

  it('does not remount a native React code component during one preview when only device width or edit zoom changes', async () => {
    const runtime = new PageRuntime(compileApplication(fixture(), registry), 'page', {
      designMode: true,
    });
    runtimes.push(runtime);
    const code: PageCode = {
      enabled: true,
      language: 'tsx',
      css: 'button { color: rgb(1,2,3) }',
      source:
        'import {useState,useEffect} from "react"; globalThis.__viewportCodeProbe={mounts:0,cleanups:0}; export default function Page(){const[n,setN]=useState(0);useEffect(()=>{globalThis.__viewportCodeProbe.mounts++;return()=>{globalThis.__viewportCodeProbe.cleanups++;}},[]);return <button onClick={()=>setN(n+1)}>Count {n}</button>}',
    };
    let viewport!: ViewportStore;
    function Scene() {
      viewport = useEditorViewport().viewport;
      return (
        <div className="canvas-scroll">
          <CanvasViewport mode="preview">
            <CanvasSurface>
              <CodePageCanvas code={code} runtime={runtime} mode="preview" openCode={() => {}} />
            </CanvasSurface>
          </CanvasViewport>
        </div>
      );
    }
    const view = render(
      <EditorSessionProvider>
        <Scene />
      </EditorSessionProvider>,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('.page-code-host')?.shadowRoot?.querySelector('button'),
      ).toBeTruthy(),
    );
    const shadow = view.container.querySelector('.page-code-host')!.shadowRoot!;
    const button = shadow.querySelector('button')!;
    fireEvent.click(button);
    expect(button.textContent).toBe('Count 1');
    for (const action of [
      () => viewport.measure(900, 600),
      () => viewport.setPreset('phone'),
      () => viewport.setScale(0.5),
      () => viewport.setFit(),
      () => viewport.setCustomWidth(1100),
      () => viewport.setPreset('custom'),
    ]) {
      act(action);
      expect(shadow.querySelector('button')).toBe(button);
      expect(button.textContent).toBe('Count 1');
      expect(
        view.container.querySelector('.canvas-viewport')?.getAttribute('data-viewport-scale'),
      ).toBe('1');
    }
    expect((globalThis as Record<string, unknown>).__viewportCodeProbe).toEqual({
      mounts: 1,
      cleanups: 0,
    });
  });
});
