import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { createRegistry } from '../packages/runtime/registry';
import type { StyleCapability } from '../packages/schema/style';
import { CanvasResize } from '../src/editor/CanvasResize';
import { registerCanvasBoundary } from '../src/editor/coordinates';
import { lit, selectionApplication, selectionRegistry } from './multiselection-fixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function box(element: HTMLElement, width: number, height: number, scale = 1) {
  Object.defineProperties(element, {
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(20, 30, width * scale, height * scale),
    },
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
  });
}

function pointer(
  target: HTMLElement | Window,
  type: string,
  clientX = 0,
  clientY = 0,
  pointerId = 1,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
  return event;
}

function setup(
  options: {
    capability?: StyleCapability | false;
    lock?: boolean;
    hidden?: boolean;
    bound?: boolean;
    inactive?: boolean;
    scale?: number;
    targetStyle?: string;
    owner?: Document;
  } = {},
) {
  const schema = selectionApplication();
  const alpha = findNode(schema.pages[0], 'alpha')!.node;
  if (options.lock) alpha.lock = true;
  if (options.hidden) alpha.hidden = true;
  if (options.bound)
    alpha.style = { width: { kind: 'expression', language: 'javascript', source: '240' } };
  const source = selectionRegistry();
  const { capability = source.components['ui.text'].style } = options;
  const registry = createRegistry(
    {
      ...source.components,
      'ui.text': { ...source.components['ui.text'], style: capability || undefined },
    },
    source.actions,
    source.computations,
    source.transports,
  );
  const author = new EditorDocument(schema, registry);
  author.select('a', 'alpha');
  const dom = options.owner ?? document;
  const marker = dom.createElement('div');
  marker.dataset.editorNode = 'alpha';
  if (options.inactive) marker.dataset.editorInactive = 'condition';
  const target = dom.createElement('div');
  target.style.cssText = options.targetStyle ?? 'box-sizing: border-box';
  if (capability && capability.target === 'popup') {
    const host = dom.createElement('section');
    host.className = 'material-overlay-host';
    box(host, 500, 400, options.scale);
    target.className = 'material-modal design';
    host.append(target);
    marker.append(host);
  } else {
    if (capability && capability.target === 'field') target.className = 'material-field';
    marker.append(target);
  }
  box(target, 200, 100, options.scale);
  dom.body.append(marker);
  const canAuthor = vi.fn(() => true);
  const changed = vi.fn<(active: boolean) => void>();
  const setStyle = vi.spyOn(author, 'setStyle');
  const snapshot = author.getSnapshot();
  const view = render(
    <div
      className="canvas-outline selected"
      ref={(element) => (element ? () => marker.remove() : undefined)}
    >
      <CanvasResize
        document={author}
        snapshot={snapshot}
        marker={marker}
        canAuthor={canAuthor}
        onActiveChange={changed}
      />
    </div>,
  );
  const handles = () => [
    ...view.container.querySelectorAll<HTMLButtonElement>('[data-resize-handle]'),
  ];
  const handle = (direction: string) =>
    handles().find((element) => element.dataset.resizeHandle === direction)!;
  const preview = () => view.container.querySelector('[data-resize-preview]');
  const style = () =>
    findNode(author.getSnapshot().plan.pages.get('a')!.schema, 'alpha')!.node.style;
  return {
    author,
    setStyle,
    changed,
    canAuthor,
    view,
    marker,
    target,
    handles,
    handle,
    preview,
    style,
  };
}

function capture(element: HTMLElement) {
  const holding = new Set<number>();
  const set = vi.fn((id: number) => {
    holding.add(id);
  });
  const release = vi.fn((id: number) => {
    holding.delete(id);
  });
  Object.assign(element, {
    setPointerCapture: set,
    releasePointerCapture: release,
    hasPointerCapture: (id: number) => holding.has(id),
  });
  return { set, release };
}

describe('画布内尺寸调整', () => {
  it.each([
    ['nw', 180, 70],
    ['n', undefined, 70],
    ['ne', 220, 70],
    ['e', 220, undefined],
    ['se', 220, 130],
    ['s', undefined, 130],
    ['sw', 180, 130],
    ['w', 180, undefined],
  ])('按 %s 方向只提交尺寸，保留流式布局', (direction, width, height) => {
    const s = setup({ scale: 0.5 });
    expect(s.handles()).toHaveLength(8);
    const handle = s.handle(direction);
    const held = capture(handle);
    expect(pointer(handle, 'pointerdown', 30, 40).defaultPrevented).toBe(true);
    expect(held.set).toHaveBeenCalledOnce();
    pointer(window, 'pointermove', 40, 55);
    expect(s.preview()?.textContent).toBe(`${width ?? 200} × ${height ?? 100} px`);
    expect(s.setStyle).not.toHaveBeenCalled();
    expect(s.target.style.width).toBe('');
    expect(s.target.style.height).toBe('');
    pointer(window, 'pointerup', 60, 60, 7);
    expect(s.preview()).not.toBeNull();
    pointer(window, 'pointerup', 40, 55);
    expect(s.setStyle).toHaveBeenCalledExactlyOnceWith('a', 'alpha', {
      ...(width !== undefined && { width: lit(width) }),
      ...(height !== undefined && { height: lit(height) }),
    });
    expect(held.release).toHaveBeenCalledExactlyOnceWith(1);
    expect(s.preview()).toBeNull();
    expect(s.changed.mock.calls).toEqual([[true], [false]]);
    act(() => {
      s.author.undo();
    });
    expect(s.style()).toBeUndefined();
    expect(s.author.getSnapshot().canUndo).toBe(false);
  });

  it('使用字段盒和浮层盒，并扣除 content-box 的内边距与边框', () => {
    for (const kind of ['field', 'popup'] as const) {
      const s = setup({
        capability: { target: kind, properties: ['width'] },
        targetStyle:
          'box-sizing: content-box; padding: 0 6px; border-width: 0 4px; border-style: solid; max-width: 190px',
      });
      expect(s.handles().map((handle) => handle.dataset.resizeHandle)).toEqual(['e', 'w']);
      pointer(s.handle('e'), 'pointerdown', 40, 45);
      pointer(window, 'pointerup', 70, 45);
      expect(s.setStyle).toHaveBeenCalledExactlyOnceWith('a', 'alpha', { width: lit(190) });
      s.view.unmount();
    }
  });

  it('应用子文档缩放且仅换算一次', () => {
    const host = document.createElement('div');
    const frame = document.createElement('iframe');
    host.append(frame);
    document.body.append(host);
    box(frame, 600, 400, 0.5);
    const owner = frame.contentDocument!;
    const unregister = registerCanvasBoundary({
      document: owner,
      frame,
      parent: host,
      isCurrent: () => true,
    });
    try {
      const s = setup({ owner });
      pointer(s.handle('se'), 'pointerdown', 100, 100);
      pointer(window, 'pointerup', 130, 115);
      expect(s.setStyle).toHaveBeenCalledExactlyOnceWith('a', 'alpha', {
        width: lit(260),
        height: lit(130),
      });
      s.view.unmount();
    } finally {
      unregister();
      host.remove();
    }
  });

  it('不显示不受支持、已锁定、隐藏、未渲染或无尺寸盒的手柄', () => {
    for (const options of [
      { capability: false as const },
      { lock: true },
      { hidden: true },
      { inactive: true },
      { targetStyle: 'display: inline' },
      { targetStyle: 'display: contents' },
    ]) {
      const s = setup(options);
      expect(s.handles()).toHaveLength(0);
      s.view.unmount();
    }
    const s = setup({ bound: true });
    expect(s.handles().map((handle) => handle.dataset.resizeHandle)).toEqual(['n', 's']);
    pointer(s.handle('s'), 'pointerdown', 40, 45);
    pointer(window, 'pointerup', 60, 65);
    expect(s.style()).toEqual({
      width: { kind: 'expression', language: 'javascript', source: '240' },
      height: lit(120),
    });
  });

  it.each([
    'pointercancel',
    'lostpointercapture',
    'Escape',
    'blur',
    'selection',
    'edit-plan',
    'guard',
    'unmount',
    'no-motion',
  ])('取消或无效手势 %s 不写入文档', (kind) => {
    const s = setup();
    const handle = s.handle('se');
    const held = capture(handle);
    pointer(handle, 'pointerdown', 40, 45);
    if (kind !== 'no-motion') pointer(window, 'pointermove', 60, 65);
    if (kind === 'pointercancel' || kind === 'lostpointercapture') pointer(handle, kind);
    else if (kind === 'Escape') expect(fireEvent.keyDown(window, { key: 'Escape' })).toBe(false);
    else if (kind === 'blur') fireEvent.blur(window);
    else if (kind === 'selection')
      act(() => {
        s.author.select('a', 'tail');
      });
    else if (kind === 'edit-plan')
      act(() => {
        s.author.setProp('a', 'tail', 'value', lit('changed'));
      });
    else if (kind === 'guard') s.canAuthor.mockReturnValue(false);
    else if (kind === 'unmount') s.view.unmount();
    pointer(window, 'pointerup', kind === 'no-motion' ? 40 : 60, kind === 'no-motion' ? 45 : 65);
    expect(s.setStyle).not.toHaveBeenCalled();
    expect(s.preview()).toBeNull();
    expect(held.release).toHaveBeenCalledOnce();
  });
});
