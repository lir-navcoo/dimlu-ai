import { useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema } from '../packages/schema/types';
import { registry } from '../src/materials';
import { CanvasSurface, CanvasViewport } from '../src/editor/CanvasViewport';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider, useEditorViewport } from '../src/editor/session';
import { ViewportControls } from '../src/editor/ViewportControls';
import { resolveViewport, type ViewportStore } from '../src/editor/viewport';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';

const schema: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'viewport-controls-test',
  title: '视口控件',
  entryPageId: 'page',
  dependencies: { components: { 'ui.text': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: '页面',
      state: [],
      children: [
        { id: 'text', component: 'ui.text', props: { value: { kind: 'literal', value: '内容' } } },
      ],
    },
  ],
};
const elementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 300, 100),
  );
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  vi.restoreAllMocks();
  if (elementFromPoint) Object.defineProperty(document, 'elementFromPoint', elementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
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
function setup() {
  const editorDocument = new EditorDocument(structuredClone(schema), registry);
  let viewport!: ViewportStore;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let setMode!: Dispatch<SetStateAction<'edit' | 'preview'>>;
  function Body() {
    drag = useDragDrop()!;
    viewport = useEditorViewport().viewport;
    const [mode, changeMode] = useState<'edit' | 'preview'>('edit');
    setMode = changeMode;
    return (
      <>
        <ViewportControls mode={mode} />
        <button
          aria-label="测试拖入文本"
          onPointerDown={(event) => drag.begin({ kind: 'material', component: 'ui.text' }, event)}
        >
          拖入
        </button>
        <div className="canvas-scroll">
          <CanvasViewport mode={mode}>
            <CanvasSurface>
              <input aria-label="业务本地值" defaultValue="draft" />
            </CanvasSurface>
          </CanvasViewport>
        </div>
      </>
    );
  }
  function Scene() {
    const snapshot = useSyncExternalStore(editorDocument.subscribe, editorDocument.getSnapshot);
    return (
      <DragDropProvider document={editorDocument} snapshot={snapshot} enabled>
        <Body />
      </DragDropProvider>
    );
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Scene />
      </TipProvider>
    </EditorSessionProvider>,
  );
  act(() => viewport.measure(1000, 600));
  return { view, editorDocument, viewport, setMode, getDrag: () => drag };
}
const device = () => screen.getByRole('combobox', { name: '画布设备宽度' });
const zoom = () => screen.getByRole('combobox', { name: '画布缩放' });
const scale = (view: ReturnType<typeof render>) =>
  Number(view.container.querySelector<HTMLElement>('.canvas-viewport')!.dataset.viewportScale);
const custom = () => screen.getByRole('textbox', { name: '自定义画布宽度' }) as HTMLInputElement;
const disabled = (element: HTMLElement) =>
  expect((element as HTMLButtonElement).disabled).toBe(true);

describe('visible viewport controls use real Base UI selection and accessible width validation', () => {
  it('changes logical devices through portaled options and exposes the actual page width without altering Schema/history', () => {
    const { view, viewport, editorDocument } = setup();
    const baseline = editorDocument.getSnapshot(),
      json = editorDocument.exportJson();
    for (const [preset, width] of [
      ['desktop', 1440],
      ['tablet', 768],
      ['phone', 390],
      // Edit-mode auto now spans the measured container instead of capping at 960.
      ['auto', 1000],
    ] as const) {
      changeControl(device(), preset);
      expect(viewport.getSnapshot().preset).toBe(preset);
      expect(screen.getByLabelText('实际页面宽度').textContent).toBe(`${width} px`);
      expect(view.container.querySelector<HTMLElement>('.canvas-scaled-surface')!.style.width).toBe(
        `${width}px`,
      );
    }
    expect(editorDocument.getSnapshot()).toBe(baseline);
    expect(editorDocument.exportJson()).toBe(json);
  });

  it('does not apply invalid custom drafts on Enter or blur, announces errors, and reverts Escape without a delayed blur commit', () => {
    const { viewport } = setup();
    changeControl(device(), 'custom');
    const input = custom();
    for (const value of ['', '239', '3841', '600.5', '2.4e2', 'NaN']) {
      const snapshot = viewport.getSnapshot();
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(viewport.getSnapshot()).toBe(snapshot);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('240–3840');
      expect(input.getAttribute('aria-describedby')).toBe(alert.id);
      fireEvent.blur(input);
      expect(viewport.getSnapshot()).toBe(snapshot);
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input.value).toBe('960');
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.blur(input);
      expect(viewport.getSnapshot()).toBe(snapshot);
    }
    fireEvent.change(input, { target: { value: '1200' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(viewport.getSnapshot().customWidth).toBe(960);
    expect(input.value).toBe('960');
  });

  it('commits valid boundary widths via Enter/blur and canonicalizes surrounding whitespace', () => {
    const { viewport } = setup();
    changeControl(device(), 'custom');
    fireEvent.change(custom(), { target: { value: ' 240 ' } });
    fireEvent.keyDown(custom(), { key: 'Enter' });
    expect(custom().value).toBe('240');
    expect(viewport.getSnapshot().customWidth).toBe(240);
    fireEvent.change(custom(), { target: { value: '3840' } });
    fireEvent.blur(custom());
    expect(screen.getByLabelText('实际页面宽度').textContent).toBe('3840 px');
    expect(viewport.getSnapshot().customWidth).toBe(3840);
    changeControl(device(), 'phone');
    expect(screen.queryByRole('textbox', { name: '自定义画布宽度' })).toBeNull();
    changeControl(device(), 'custom');
    expect(custom().value).toBe('3840');
  });

  it('continuously displays the real fit percentage/clamp and switches back to manual selection and reset', () => {
    const { viewport, view } = setup();
    changeControl(device(), 'desktop');
    fireEvent.click(screen.getByRole('button', { name: '适应画布宽度' }));
    expect(zoom().textContent).toContain('69.4%');
    expect(scale(view)).toBeCloseTo(1000 / 1440, 10);
    expect(screen.getByRole('button', { name: '适应画布宽度' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    act(() => viewport.measure(400, 600));
    expect(
      screen
        .getAllByRole('status')
        .find((element) => element.classList.contains('viewport-feedback'))?.textContent,
    ).toContain('50%下限');
    expect(zoom().textContent).toContain('50%');
    act(() => viewport.measure(3000, 600));
    expect(
      screen
        .getAllByRole('status')
        .find((element) => element.classList.contains('viewport-feedback'))?.textContent,
    ).toContain('150%上限');
    changeControl(zoom(), '125');
    expect(scale(view)).toBe(1.25);
    expect(viewport.getSnapshot().zoom.kind).toBe('manual');
    expect(
      screen
        .queryAllByRole('status')
        .some((element) => element.classList.contains('viewport-feedback')),
    ).toBe(false);
    act(() => viewport.measure(1000, 600));
    expect(scale(view)).toBe(1.25);
    fireEvent.click(screen.getByRole('button', { name: '恢复画布100%' }));
    expect(scale(view)).toBe(1);
  });

  it('offers each manual percentage once after a floating-point 110% value and retains the selected value', () => {
    const { viewport } = setup();
    act(() => viewport.setScale(1.1));
    expect(zoom().textContent).toContain('110%');
    fireEvent.click(zoom());
    expect(
      screen.getAllByRole('option').filter((option) => option.textContent === '110%'),
    ).toHaveLength(1);
    expect(screen.getByRole('option', { name: /^110%$/ }).dataset.value).toBe('110');
    fireEvent.keyDown(zoom(), { key: 'Escape' });
    changeControl(zoom(), '125');
    changeControl(zoom(), '110');
    expect(resolveViewport(viewport.getSnapshot(), 'edit').scale).toBe(1.1);
  });

  it('disables only zoom actions in preview, keeps device selection available, and restores edit fit without replacing content', () => {
    const { view, viewport, setMode } = setup();
    changeControl(device(), 'desktop');
    fireEvent.click(screen.getByRole('button', { name: '适应画布宽度' }));
    const input = screen.getByLabelText('业务本地值');
    const surface = view.container.querySelector<HTMLElement>('.canvas-scaled-surface')!;
    act(() => setMode('preview'));
    disabled(zoom());
    disabled(screen.getByRole('button', { name: '适应画布宽度' }));
    disabled(screen.getByRole('button', { name: '恢复画布100%' }));
    expect((device() as HTMLButtonElement).disabled).toBe(false);
    expect(zoom().textContent).toContain('100%');
    expect(screen.getByText('预览按100%显示')).toBeTruthy();
    expect(scale(view)).toBe(1);
    expect(surface.style.transform).toBe('');
    changeControl(device(), 'tablet');
    expect(screen.getByLabelText('实际页面宽度').textContent).toBe('768 px');
    expect(scale(view)).toBe(1);
    expect(viewport.getSnapshot().zoom.kind).toBe('fit');
    act(() => setMode('edit'));
    expect(screen.getByLabelText('业务本地值')).toBe(input);
    expect(view.container.querySelector('.canvas-scaled-surface')).toBe(surface);
    expect(scale(view)).toBeCloseTo(1000 / 768, 10);
    expect(zoom().textContent).toContain('130.2%');
  });

  it('uses a Base UI tooltip for width limitations and contains no native title attributes', async () => {
    const { view } = setup();
    const group = screen.getByRole('group', { name: '画布视口' });
    expect(group.querySelector('[title]')).toBeNull();
    act(() => screen.getByRole('button', { name: '画布宽度说明' }).focus());
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('媒体查询和视口单位仍以浏览器窗口为准');
    expect(view.container.contains(tooltip)).toBe(false);
    expect(within(group).getAllByRole('combobox')).toHaveLength(2);
  });

  it('removes covered controls from interaction under desktop maximized and mobile debug panels, then restores the same controls', () => {
    seedLegacyProject();
    render(<App />);
    const group = screen.getByRole('group', { name: '画布视口' });
    const control = device();
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(group.closest('[inert]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '最大化调试区' }));
    expect(group.closest('[inert]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '还原调试区' }));
    expect(group.closest('[inert]')).toBeNull();
    expect(device()).toBe(control);
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
      fireEvent(window, new Event('resize'));
    });
    expect(group.closest('[inert]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    expect(group.closest('[inert]')).toBeNull();
    expect(device()).toBe(control);
  });
});

describe('viewport controls freeze for the complete client-space pointer gesture', () => {
  it.each([0.5, 1.5, 1000 / 1440])(
    'rejects pending/active changes, uses a 6 screen-pixel threshold, and applies only the latest resize after cancel at scale %s',
    (factor) => {
      const { viewport, editorDocument, getDrag, view } = setup();
      act(() => {
        viewport.setPreset('desktop');
        viewport.setScale(factor);
      });
      const json = editorDocument.exportJson();
      const source = screen.getByRole('button', { name: '测试拖入文本' });
      pointer(source, 'pointerdown', 200, 200);
      expect(getDrag().isInteracting).toBe(true);
      expect(getDrag().session).toBeNull();
      disabled(device());
      disabled(zoom());
      disabled(screen.getByRole('button', { name: '适应画布宽度' }));
      const locked = viewport.getSnapshot();
      expect(locked.interacting).toBe(true);
      act(() => {
        expect(viewport.setPreset('phone')).toBe(false);
        expect(viewport.setCustomWidth(700)).toBe(false);
        expect(viewport.setScale(1)).toBe(false);
        expect(viewport.setFit()).toBe(false);
        viewport.measure(1100, 500);
        viewport.measure(1200, 550);
      });
      expect(viewport.getSnapshot()).toBe(locked);
      expect(scale(view)).toBe(factor);
      pointer(window, 'pointermove', 205.9, 200);
      expect(getDrag().session).toBeNull();
      pointer(window, 'pointermove', 206, 200);
      expect(getDrag().session?.method).toBe('pointer');
      expect(getDrag().session?.point).toEqual({ x: 206, y: 200 });
      disabled(device());
      disabled(zoom());
      pointer(window, 'pointercancel', 206, 200, 2);
      expect(getDrag().isInteracting).toBe(true);
      pointer(window, 'pointercancel', 206, 200);
      expect(getDrag().isInteracting).toBe(false);
      expect(viewport.getSnapshot()).toMatchObject({
        preset: 'desktop',
        availableWidth: 1200,
        availableHeight: 550,
        interacting: false,
      });
      expect(scale(view)).toBe(factor);
      expect((device() as HTMLButtonElement).disabled).toBe(false);
      expect(editorDocument.exportJson()).toBe(json);
    },
  );
});
