import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type { ApplicationSchema, NodeSchema } from '../packages/schema/types';
import { EditorCanvas } from '../src/editor/Canvas';
import { CanvasViewport } from '../src/editor/CanvasViewport';
import { clippingBounds } from '../src/editor/CanvasHost';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';

const frames = new Map<number, FrameRequestCallback>();
const runtimes: PageRuntime[] = [];
let frameId = 0;
let clip: DOMRect;
let node: DOMRect;
let header: DOMRect;

beforeEach(() => {
  frames.clear();
  frameId = 0;
  clip = new DOMRect(100, 118, 585, 500);
  node = new DOMRect(120, 137.671875, 200, 34.1953125);
  header = new DOMRect();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.closest('[data-editor-design-hidden]') || getComputedStyle(this).display === 'none')
      return new DOMRect();
    if (this.classList.contains('canvas-overlay-context')) return header;
    if (this.classList.contains('zero-box-contents')) return new DOMRect();
    if (this.classList.contains('real-inner-clip')) return new DOMRect(110, 125, 300, 150);
    if (this.closest('[data-editor-node="leaf"]')) return node;
    if (this.classList.contains('editor-canvas')) return new DOMRect(100, 118, 585, 900);
    return clip;
  });
});

afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frames.clear();
});

async function frame() {
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

async function setup(scale = 1.5, inOverlay = false, contentsHost = false) {
  const leaf: NodeSchema = {
    id: 'leaf',
    component: 'ui.text',
    props: { value: { kind: 'literal', value: '短文本' } },
  };
  const schema: ApplicationSchema = {
    schemaVersion: '0.1.0',
    id: 'toolbar-edge',
    title: '选中工具条边缘回归',
    entryPageId: 'page',
    dependencies: {
      components: { 'ui.text': '1.0.0', 'ui.dialog': '1.0.0' },
      actions: {},
    },
    pages: [
      {
        id: 'page',
        title: '页面',
        state: [],
        children: inOverlay
          ? [
              {
                id: 'dialog',
                component: 'ui.dialog',
                props: { title: { kind: 'literal', value: '浮层' } },
                children: [leaf],
              },
            ]
          : [leaf],
      },
    ],
  };
  const editorDocument = new EditorDocument(schema, registry);
  let session!: ReturnType<typeof useEditorSession>;
  function Scene() {
    session = useEditorSession();
    const snapshot = useSyncExternalStore(editorDocument.subscribe, editorDocument.getSnapshot);
    const runtime = useMemo(() => {
      const next = new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true });
      runtimes.push(next);
      return next;
    }, [snapshot.plan, snapshot.selection.pageId]);
    useEffect(() => () => runtime.dispose(), [runtime]);
    return (
      <div className="canvas-scroll">
        <CanvasViewport mode="edit">
          <div
            className={contentsHost ? 'zero-box-contents' : undefined}
            style={contentsHost ? { display: 'contents', overflow: 'auto' } : undefined}
          >
            <EditorCanvas
              document={editorDocument}
              snapshot={snapshot}
              runtime={runtime}
              mode="edit"
            />
          </div>
        </CanvasViewport>
      </div>
    );
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Scene />
      </TipProvider>
    </EditorSessionProvider>,
  );
  act(() => {
    session.viewport.setPreset('phone');
    session.viewport.setScale(scale);
    editorDocument.select('page', 'leaf');
  });
  await frame();
  await frame();
  const outline = view.container.querySelector<HTMLElement>(
    '[data-editor-outline="leaf"].selected',
  );
  expect(outline).not.toBeNull();
  const toolbar = outline!.querySelector<HTMLElement>('.canvas-selection-toolbar');
  return {
    ...view,
    toolbar,
    top: toolbar ? 118 + parseFloat(outline!.style.top) + parseFloat(toolbar.style.top) : undefined,
  };
}

describe('selection toolbar screen-space placement', () => {
  it('places the toolbar below a short row when the visible top edge blocks above', async () => {
    // Browser 025 evidence: phone390, 150%, clip top118, text bottom171.8671875.
    const { toolbar, top } = await setup();
    expect(toolbar).not.toBeNull();
    expect(top).toBeCloseTo(173.8671875);
    expect(top!).toBeGreaterThan(node.bottom);
    expect(top! + 28).toBeLessThanOrEqual(clip.bottom);
  });

  it('keeps the toolbar above the selection when the complete toolbar fits', async () => {
    node = new DOMRect(120, 200, 200, 34);
    const { top } = await setup();
    expect(top).toBe(170);
    expect(top! + 28).toBeLessThan(node.top);
  });

  it.each([0.5, 1.25, 1.5])('does not rescale the toolbar placement at zoom %s', async (scale) => {
    // Feed independent client-space geometry; the overlay must not apply scale a second time.
    node = new DOMRect(120, 137.671875, 130 * scale, 22.796875 * scale);
    const { toolbar, top, container } = await setup(scale);
    expect(container.querySelector('.canvas-viewport')?.getAttribute('data-viewport-scale')).toBe(
      String(scale),
    );
    expect(toolbar?.closest('.canvas-scaled-surface')).toBeNull();
    expect(toolbar?.style.width).toBe('218px');
    expect(top).toBeCloseTo(node.bottom + 2);
  });

  it('keeps the constrained fallback below an overlapping sticky scope header', async () => {
    clip = new DOMRect(100, 118, 585, 120);
    header = new DOMRect(100, 118, 585, 44);
    node = new DOMRect(120, 170, 200, 60);
    const { toolbar, top, container } = await setup(1.5, true);
    expect(container.querySelector('.canvas-overlay-context')).not.toBeNull();
    expect(toolbar).not.toBeNull();
    expect(top!).toBeGreaterThanOrEqual(header.bottom + 4);
    expect(top! + 28).toBeLessThanOrEqual(clip.bottom);
    expect(top).toBe(172);
  });

  it('omits the toolbar when the clipped viewport cannot contain its height', async () => {
    clip = new DOMRect(100, 118, 585, 29);
    node = new DOMRect(120, 125, 200, 20);
    const { toolbar } = await setup();
    expect(toolbar).toBeNull();
  });

  it('preserves the actual selection toolbar through a boxless overflow ancestor', async () => {
    const { toolbar, top, container } = await setup(1.5, false, true);
    const host = container.querySelector<HTMLElement>('.zero-box-contents')!;
    expect(getComputedStyle(host).display).toBe('contents');
    expect(getComputedStyle(host).overflow).toBe('auto');
    expect(host.getBoundingClientRect().width).toBe(0);
    expect(toolbar).not.toBeNull();
    expect(top).toBeCloseTo(node.bottom + 2);
  });
});

describe('boxless ancestors in toolbar clipping', () => {
  function clippingFixture() {
    const view = render(
      <div className="canvas-scroll">
        <div className="editor-surface">
          <div className="zero-box-contents" style={{ display: 'contents', overflow: 'auto' }}>
            <div className="real-inner-clip" style={{ overflow: 'hidden' }}>
              <span data-testid="clip-marker">visible content</span>
            </div>
          </div>
        </div>
      </div>,
    );
    return {
      marker: view.getByTestId('clip-marker'),
      surface: view.container.querySelector<HTMLElement>('.editor-surface')!,
      contents: view.container.querySelector<HTMLElement>('.zero-box-contents')!,
    };
  }

  it('ignores boxless overflow but intersects a real nested clipping box', () => {
    const { marker, surface } = clippingFixture();
    expect(clippingBounds(marker, surface)).toEqual({
      left: 110,
      top: 125,
      right: 410,
      bottom: 275,
      width: 300,
      height: 150,
    });
  });

  it.each(['hidden', 'collapse'])(
    'still rejects visibility:%s on a boxless ancestor',
    (visibility) => {
      const { marker, surface, contents } = clippingFixture();
      contents.style.visibility = visibility;
      expect(clippingBounds(marker, surface)).toBeUndefined();
    },
  );

  it('still rejects a display:none ancestor', () => {
    const { marker, surface, contents } = clippingFixture();
    contents.style.display = 'none';
    expect(clippingBounds(marker, surface)).toBeUndefined();
  });

  it('still clips to a real overflow box with zero area', () => {
    const { marker, surface, contents } = clippingFixture();
    contents.style.display = 'block';
    expect(clippingBounds(marker, surface)).toBeUndefined();
  });
});
