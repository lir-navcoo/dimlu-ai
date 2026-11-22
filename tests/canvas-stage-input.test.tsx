import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { CanvasStage } from '../src/editor/canvas-stage';
import { CanvasViewport } from '../src/editor/CanvasViewport';
import { EditorCanvas } from '../src/editor/Canvas';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { ComponentTree } from '../src/editor/ComponentTree';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { Select, TipProvider } from '../src/ui/primitives';
import { useRuntimeDomEnvironment } from '../src/ui/runtime-dom';
import { selectionApplication, selectionRegistry, lit } from './multiselection-fixture';

const disposals: (() => void)[] = [];
afterEach(() => {
  try {
    cleanup();
  } finally {
    try {
      disposals.splice(0).forEach((dispose) => dispose());
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  }
});
function size(element: Element, values: Record<string, number>) {
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(element, key, { configurable: true, value });
}
function key(target: HTMLElement, value: string, init: KeyboardEventInit = {}) {
  const event = new target.ownerDocument.defaultView!.KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(target, event);
  return event;
}
// Deliver one native event in its actual owning window. Capture methods below
// are witnesses only; this does NOT simulate physical browser pointer capture.
function pointer(
  target: HTMLElement | Window,
  type: string,
  x = 20,
  y = 30,
  pointerId = 1,
  init: MouseEventInit = {},
) {
  const win = 'ownerDocument' in target ? target.ownerDocument.defaultView! : target;
  const event = new (win as Window & typeof globalThis).MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...init,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  fireEvent(target, event);
  return event;
}
function PortalControls() {
  const environment = useRuntimeDomEnvironment();
  const [value, setValue] = useState('a');
  return environment
    ? createPortal(
        <div data-canvas-action="true">
          <input aria-label="Child native input" />
          <textarea aria-label="Child native textarea" />
          <select aria-label="Child native select">
            <option>a</option>
          </select>
          <div contentEditable suppressContentEditableWarning aria-label="Child editable">
            native text
          </div>
          <div role="dialog">
            <button>Child physical dialog control</button>
          </div>
          <Select aria-label="Child business chooser" value={value} onValueChange={setValue}>
            <option value="a">Child A</option>
            <option value="b">Child B</option>
          </Select>
        </div>,
        environment.portalRoot,
      )
    : null;
}
function harness({ emptyPage = false } = {}) {
  const schema = selectionApplication();
  if (emptyPage) schema.pages[0].children = [];
  const author = new EditorDocument(schema, selectionRegistry());
  author.select('a', emptyPage ? null : 'alpha');
  const stage = new CanvasStage();
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  let session!: ReturnType<typeof useEditorSession>;
  const runtimes = new Set<PageRuntime>();
  const boxes = new WeakMap<Element, DOMRect>();
  const getBox = function (this: Element) {
    return boxes.get(this) ?? new DOMRect(20, 30, 200, 40);
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(getBox);
  function Probe() {
    drag = useDragDrop()!;
    session = useEditorSession();
    return (
      <button
        onPointerDown={(event) => drag.begin({ kind: 'material', component: 'ui.text' }, event)}
      >
        Parent material source
      </button>
    );
  }
  function Scene() {
    const snapshot = useSyncExternalStore(author.subscribe, author.getSnapshot);
    const [runtime, setRuntime] = useState<PageRuntime | null>(null);
    useEffect(() => {
      const next = new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true });
      runtimes.add(next);
      setRuntime(next);
      return () => next.dispose();
    }, [snapshot.plan, snapshot.selection.pageId]);
    stage.context = { document: author, snapshot, runtime };
    return (
      <DragDropProvider document={author} snapshot={snapshot} enabled stage={stage}>
        <Probe />
        <div className="sidebar-content">
          <ComponentTree document={author} snapshot={snapshot} />
        </div>
        <input aria-label="Parent property input" />
        <div className="monaco-editor">
          <input aria-label="Parent Monaco input" />
        </div>
        <div
          className="canvas-scroll"
          style={{ width: 900, height: 600, overflow: 'auto' }}
          ref={(node) => {
            if (node) {
              size(node, {
                clientWidth: 900,
                clientHeight: 600,
                offsetWidth: 900,
                offsetHeight: 600,
              });
              boxes.set(node, new DOMRect(40, 30, 900, 600));
            }
          }}
        >
          <CanvasViewport mode="edit" stage={stage}>
            {runtime && runtime.plan === snapshot.plan && !runtime.disposed ? (
              <EditorCanvas document={author} snapshot={snapshot} runtime={runtime} mode="edit">
                <PortalControls />
              </EditorCanvas>
            ) : (
              <p>Real runtime loading gap</p>
            )}
          </CanvasViewport>
        </div>
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
  disposals.push(() => runtimes.forEach((runtime) => runtime.dispose()));
  const frame = view.container.querySelector<HTMLIFrameElement>('iframe')!;
  expect(frame).toBeTruthy();
  const doc = frame.contentDocument!,
    win = doc.defaultView!;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  if (!doc.head) doc.documentElement.appendChild(doc.createElement('head'));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
  vi.spyOn(doc, 'readyState', 'get').mockReturnValue('complete');
  doc.documentElement.dataset.dimluRuntimeEntry = 'ready';
  const content = doc.createElement('div');
  content.id = 'canvas-content';
  const portals = doc.createElement('div');
  portals.id = 'canvas-portals';
  doc.body.append(content, portals);
  const style = doc.createElement('style');
  style.textContent = ':root { --dimlu-runtime-baseline: ready; }';
  doc.head.append(style);
  vi.spyOn(win.Element.prototype, 'getBoundingClientRect').mockImplementation(getBox);
  Object.defineProperty(frame, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      const scale = session.viewport.getSnapshot().zoom;
      const factor = scale.kind === 'manual' ? scale.scale : 1;
      return new DOMRect(
        100,
        80,
        parseFloat(frame.style.width) * factor,
        parseFloat(frame.style.height) * factor,
      );
    },
  });
  Object.defineProperties(frame, {
    offsetWidth: { configurable: true, get: () => parseFloat(frame.style.width) },
    offsetHeight: { configurable: true, get: () => parseFloat(frame.style.height) },
    clientWidth: { configurable: true, get: () => parseFloat(frame.style.width) },
    clientHeight: { configurable: true, get: () => parseFloat(frame.style.height) },
  });
  size(doc.documentElement, { clientWidth: 900, clientHeight: 600 });
  act(() => frame.dispatchEvent(new Event('load')));
  const query = within(doc.body);
  const canvas = () => query.getByLabelText('页面编辑画布') as HTMLDivElement;
  const focus = () => {
    frame.focus();
    canvas().focus();
  };
  const tree = (id: string) =>
    screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.classList.contains('tree-select') &&
          button.getAttribute('aria-label')?.endsWith(` ${id}`),
      )!;
  const parentHit = vi.fn<(x: number, y: number) => Element | null>(() => frame);
  const childHit = vi.fn<(x: number, y: number) => Element | null>(() =>
    query.getByText('Alpha text', { selector: 'p' }),
  );
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: parentHit });
  Object.defineProperty(doc, 'elementFromPoint', { configurable: true, value: childHit });
  disposals.push(() => Reflect.deleteProperty(document, 'elementFromPoint'));
  const capture = (element: HTMLElement) => {
    const set = vi.fn(),
      release = vi.fn();
    Object.defineProperties(element, {
      setPointerCapture: { configurable: true, value: set },
      releasePointerCapture: { configurable: true, value: release },
      hasPointerCapture: { configurable: true, value: () => true },
    });
    return { set, release };
  };
  const drop = (intent: object) => {
    const element = doc.createElement('div');
    element.dataset.dropIntent = JSON.stringify(intent);
    content.append(element);
    childHit.mockReturnValue(element);
    return element;
  };
  return {
    author,
    stage,
    view,
    frame,
    doc,
    win,
    query,
    content,
    portals,
    boxes,
    canvas,
    focus,
    tree,
    capture,
    drop,
    parentHit,
    childHit,
    drag: () => drag,
    session: () => session,
    runtimes,
    parentInput: () => screen.getByRole('textbox', { name: 'Parent property input' }),
  };
}

describe('canvas-stage original native input ownership', () => {
  it('box-selects through the iframe at 75%, adds with Ctrl and cancels with Escape', () => {
    const h = harness();
    act(() => h.session().viewport.setScale(0.75));
    const alpha = h.query.getByText('Alpha text', { selector: 'p' });
    const tail = h.query.getByText('Tail text', { selector: 'p' });
    h.boxes.set(alpha, new DOMRect(40, 40, 80, 25));
    h.boxes.set(tail, new DOMRect(190, 95, 70, 25));
    const before = h.author.getSnapshot();
    const blank = h.canvas().querySelector<HTMLElement>('.editor-surface')!;
    const capture = h.capture(blank);
    pointer(blank, 'pointerdown', 280, 140);
    pointer(h.win, 'pointermove', 160, 80);
    expect(document.querySelector('.canvas-marquee')).not.toBeNull();
    pointer(h.win, 'pointerup', 160, 80);
    expect(capture.set).toHaveBeenCalledWith(1);
    expect(capture.release).toHaveBeenCalledWith(1);
    expect(h.author.getSnapshot().selection.nodeId).toBe('tail');
    expect(h.author.getSnapshot().plan).toBe(before.plan);
    expect(document.querySelector('.canvas-marquee')).toBeNull();
    pointer(blank, 'pointerdown', 32, 32, 1, { ctrlKey: true });
    pointer(h.win, 'pointermove', 130, 75);
    pointer(h.win, 'pointerup', 130, 75);
    expect(h.author.getSnapshot().selection).toMatchObject({
      nodeId: 'tail',
      nodeIds: ['alpha', 'tail'],
    });
    pointer(alpha, 'pointerdown', 32, 32, 1, { shiftKey: true });
    pointer(h.win, 'pointermove', 130, 75);
    expect(document.querySelector('.canvas-marquee')).not.toBeNull();
    expect(key(h.canvas(), 'Escape').defaultPrevented).toBe(true);
    pointer(h.win, 'pointerup', 130, 75);
    expect(document.querySelector('.canvas-marquee')).toBeNull();
    expect(h.author.getSnapshot().selection.nodeIds).toEqual(['alpha', 'tail']);
  });
  it('drops the first material onto the empty iframe canvas at 75% and restores the hint on undo', async () => {
    const h = harness({ emptyPage: true });
    act(() => h.session().viewport.setScale(0.75));
    const hint = '从组件库拖入组件，开始设计页面';
    const guide = h.query.getByText(hint);
    const zone = guide.closest('.drop-zone');
    expect(zone?.closest('#canvas-content')).toBe(h.content);
    expect(zone?.getAttribute('data-drop-intent')).toBe(JSON.stringify({ kind: 'inside' }));
    h.childHit.mockReturnValue(guide);
    const before = h.author.getSnapshot();
    const material = screen.getByRole('button', { name: 'Parent material source' });
    pointer(material, 'pointerdown', 20, 20);
    pointer(window, 'pointermove', 130, 110);
    expect(zone?.classList.contains('drop-valid')).toBe(true);
    pointer(window, 'pointerup', 160, 125);
    expect(h.childHit).toHaveBeenLastCalledWith(80, 60);
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    expect(h.author.getSnapshot().plan.pages.get('a')!.schema.children).toMatchObject([
      { component: 'ui.text' },
    ]);
    expect(await h.query.findByText('页面末尾 · 拖入组件')).toBeTruthy();
    expect(h.query.queryByText(hint)).toBeNull();
    act(() => h.author.undo());
    expect(h.author.getSnapshot().plan).toBe(before.plan);
    expect(await h.query.findByText(hint)).toBeTruthy();
  });

  it('I1 shares the original drag and exact capture owner across documents with visual threshold fresh release and one Undo', () => {
    const h = harness();
    act(() => h.session().viewport.setScale(0.75));
    const root = h.canvas(),
      body = h.query.getByText('Alpha text', { selector: 'p' });
    const childCapture = h.capture(root);
    const before = h.author.getSnapshot();
    h.drop({ kind: 'inside' });
    pointer(body, 'pointerdown');
    expect(childCapture.set).toHaveBeenCalledExactlyOnceWith(1);
    pointer(h.win, 'pointermove', 26, 30);
    expect(h.drag().session).toBeNull();
    pointer(h.win, 'pointerup', 26, 30);
    expect(childCapture.release).toHaveBeenCalledWith(1);
    expect(h.author.getSnapshot()).toBe(before);
    pointer(body, 'pointerdown');
    pointer(h.win, 'pointermove', 28, 30);
    expect(h.drag().session?.method).toBe('pointer');
    h.childHit.mockReturnValue(null);
    pointer(h.win, 'pointerup', 90, 90);
    expect(h.author.getSnapshot()).toBe(before);
    h.drop({ kind: 'inside' });
    pointer(body, 'pointerdown');
    pointer(h.win, 'pointermove', 40, 30);
    pointer(h.win, 'pointerup', 50, 40);
    expect(h.author.getSnapshot().revision).toBe(before.revision + 1);
    act(() => h.author.undo());
    expect(h.author.getSnapshot().plan).toBe(before.plan);
    const material = screen.getByRole('button', { name: 'Parent material source' });
    const parentCapture = h.capture(material);
    h.drop({ kind: 'inside', parentId: 'card', slot: 'footer' });
    const materialBefore = h.author.getSnapshot();
    pointer(material, 'pointerdown', 20, 20);
    pointer(window, 'pointermove', 130, 120);
    pointer(window, 'pointerup', 140, 130);
    expect(parentCapture.set).toHaveBeenCalledWith(1);
    expect(parentCapture.release).toHaveBeenCalledWith(1);
    expect(h.author.getSnapshot().revision).toBe(materialBefore.revision + 1);
    expect(
      findNode(h.author.getSnapshot().plan.pages.get('a')!.schema, 'card')!.node.slots!.footer
        .children.length,
    ).toBe(2);
    act(() => h.author.undo());
    expect(h.author.getSnapshot().plan).toBe(materialBefore.plan);
    const toTreeBefore = h.author.getSnapshot();
    h.capture(h.canvas());
    h.parentHit.mockReturnValue(h.tree('tail'));
    h.childHit.mockClear();
    pointer(h.query.getByText('Alpha text', { selector: 'p' }), 'pointerdown');
    pointer(h.win, 'pointermove', 100, 100);
    pointer(h.win, 'pointerup', 120, 110);
    expect(h.parentHit).toHaveBeenLastCalledWith(190, 162.5);
    expect(h.childHit).not.toHaveBeenCalled();
    expect(h.author.getSnapshot().revision).toBe(toTreeBefore.revision + 1);
    act(() => h.author.undo());
    expect(h.author.getSnapshot().plan).toBe(toTreeBefore.plan);
  });

  it('I2 ignores unrelated pointer loss and synchronously cancels exact pending or active owners on retirement', () => {
    const h = harness();
    const root = h.canvas(),
      body = h.query.getByText('Alpha text', { selector: 'p' });
    const capture = h.capture(root);
    const before = h.author.getSnapshot();
    const dropTarget = h.drop({ kind: 'inside' });
    pointer(body, 'pointerdown');
    pointer(h.win, 'pointermove', 60, 30);
    pointer(h.win, 'pointercancel', 60, 30, 99);
    expect(h.drag().session).not.toBeNull();
    const unrelated = h.doc.createElement('div');
    h.doc.body.append(unrelated);
    pointer(unrelated, 'lostpointercapture');
    expect(h.drag().session).not.toBeNull();
    pointer(root, 'lostpointercapture');
    expect(h.drag().isInteracting).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
    // Controlled blur-order protocol only: unresolved transfer must block a
    // commit, and the old bounded callback must not cancel a newer gesture.
    const parentFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const childFocus = vi.spyOn(h.doc, 'hasFocus').mockReturnValue(false);
    vi.useFakeTimers();
    pointer(body, 'pointerdown');
    pointer(h.win, 'pointermove', 60, 30);
    act(() => h.win.dispatchEvent(new h.win.Event('blur')));
    pointer(h.win, 'pointerup', 60, 30);
    expect(h.author.getSnapshot()).toBe(before);
    expect(h.drag().isInteracting).toBe(false);
    pointer(body, 'pointerdown');
    expect(h.drag().isInteracting).toBe(true);
    act(() => vi.advanceTimersByTime(0));
    expect(h.drag().isInteracting).toBe(true);
    pointer(h.win, 'pointercancel');
    vi.useRealTimers();
    parentFocus.mockRestore();
    childFocus.mockRestore();
    pointer(body, 'pointerdown');
    expect(h.drag().isInteracting).toBe(true);
    let currentDuringNativePagehide = true;
    h.win.addEventListener(
      'pagehide',
      () => {
        currentDuringNativePagehide = !!h.stage.current();
      },
      { once: true },
    );
    act(() => h.win.dispatchEvent(new h.win.Event('pagehide')));
    expect(currentDuringNativePagehide).toBe(false);
    expect(h.drag().isInteracting).toBe(false);
    expect(capture.release).toHaveBeenCalledWith(1);
    pointer(h.win, 'pointermove', 200, 200);
    pointer(h.win, 'pointerup', 200, 200);
    expect(h.author.getSnapshot()).toBe(before);
    // The extra drop hit target belongs to this fixture, outside React's
    // portal. Only React-owned author/business children must retire.
    expect([...h.content.children]).toEqual([dropTarget]);
    h.view.unmount();
    const active = harness();
    const activeBefore = active.author.getSnapshot();
    const activeCapture = active.capture(active.canvas());
    active.drop({ kind: 'inside' });
    pointer(active.query.getByText('Alpha text', { selector: 'p' }), 'pointerdown');
    pointer(active.win, 'pointermove', 80, 30);
    expect(active.drag().session?.method).toBe('pointer');
    act(() => active.win.dispatchEvent(new active.win.Event('pagehide')));
    expect(active.stage.current()).toBeUndefined();
    expect(active.drag().isInteracting).toBe(false);
    expect(activeCapture.release).toHaveBeenCalledWith(1);
    pointer(active.win, 'pointerup', 200, 200);
    expect(active.author.getSnapshot()).toBe(activeBefore);
  });

  it('I3 accepts only exact current child or tree command hosts and preserves real native Portal and foreign realms', async () => {
    const h = harness();
    h.focus();
    const remove = vi.spyOn(h.author, 'removeNode');
    expect(key(h.canvas(), 'Delete').defaultPrevented).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    await waitFor(() => expect(h.doc.activeElement).toBe(h.canvas()));
    expect(key(h.canvas(), 'z', { ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(h.doc.activeElement).toBe(h.canvas()));
    const copy = vi.spyOn(h.author, 'copyNodesToClipboard');
    expect(key(h.canvas(), 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(copy).toHaveBeenCalledOnce();
    const before = h.author.getSnapshot();
    const parentCanvas = h.view.container.querySelector<HTMLElement>('.canvas-scroll')!;
    for (const protection of ['inert', 'hidden', 'visibility'] as const) {
      if (protection === 'visibility') parentCanvas.style.visibility = 'hidden';
      else parentCanvas.setAttribute(protection, '');
      h.focus();
      expect(key(h.canvas(), 'Delete').defaultPrevented).toBe(false);
      expect(key(h.canvas(), 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(key(h.canvas(), 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
      if (protection === 'visibility') parentCanvas.style.visibility = '';
      else parentCanvas.removeAttribute(protection);
    }
    h.focus();
    expect(key(h.canvas(), 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    for (const target of [
      h.query.getByLabelText('Child native input'),
      h.query.getByLabelText('Child native textarea'),
      h.query.getByLabelText('Child native select'),
      h.query.getByLabelText('Child editable'),
      h.query.getByRole('button', { name: 'Child physical dialog control' }),
      h.query.getByRole('combobox', { name: 'Child business chooser' }),
    ]) {
      target.focus();
      expect(key(target, 'Delete').defaultPrevented).toBe(false);
      expect(key(target, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(key(target, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(h.author.getSnapshot()).toBe(before);
    }
    const foreignFrame = document.createElement('iframe');
    document.body.append(foreignFrame);
    const foreign = foreignFrame.contentDocument!.createElement('input');
    foreignFrame.contentDocument!.body.append(foreign);
    foreign.focus();
    expect(key(foreign, 'Delete').defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
    foreignFrame.remove();
    h.focus();
    const event = key(h.canvas(), 'c', { ctrlKey: true });
    const calls = copy.mock.calls.length;
    fireEvent(h.canvas(), event);
    expect(copy).toHaveBeenCalledTimes(calls);
    const shadowRoot = h.canvas().attachShadow({ mode: 'open' });
    const shadowButton = h.doc.createElement('button');
    shadowRoot.append(shadowButton);
    shadowButton.focus();
    const shadowBefore = h.author.getSnapshot();
    expect(key(shadowButton, 'Delete', { composed: true }).defaultPrevented).toBe(false);
    expect(key(shadowButton, 'v', { ctrlKey: true, composed: true }).defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(shadowBefore);
    act(() => h.author.select('a', 'tail'));
    h.tree('tail').focus();
    expect(key(h.tree('tail'), 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.author.getClipboardSnapshot().available).toBe(true);
  });

  it('I4 offers the same Escape after popup dismissal and never cascades drag cancellation into selection clear', async () => {
    const h = harness();
    const before = h.author.getSnapshot();
    h.focus();
    key(h.canvas(), ' ');
    expect(h.drag().isInteracting).toBe(true);
    const destination = screen.getByRole('combobox', { name: '拖放位置' });
    fireEvent.click(destination);
    const option = screen.getAllByRole('option')[0];
    option.focus();
    key(option, 'Escape');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(h.drag().isInteracting).toBe(true);
    expect(h.author.getSnapshot()).toBe(before);
    destination.focus();
    key(destination, 'Escape');
    expect(h.drag().isInteracting).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
    h.focus();
    const order: string[] = [];
    const documentHandler = () => order.push('document');
    h.doc.addEventListener('keydown', documentHandler);
    const stop = h.author.subscribe(() => order.push('author'));
    key(h.canvas(), 'Escape');
    await waitFor(() => expect(h.author.getSnapshot().selection.nodeId).toBeNull());
    expect(order).toEqual(['document', 'author']);
    stop();
    h.doc.removeEventListener('keydown', documentHandler);
  });

  it('I5 binds composition after readiness and replaced host identity without lending old listeners authority', async () => {
    const h = harness();
    const root = h.canvas();
    h.focus();
    const before = h.author.getSnapshot();
    fireEvent(root, new h.win.CompositionEvent('compositionstart', { bubbles: true, data: '中' }));
    expect(key(root, 'Delete').defaultPrevented).toBe(false);
    expect(key(root, 'z', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(root, 'c', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
    fireEvent(root, new h.win.CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    expect(key(root, 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(key(root, 'Delete', { isComposing: true }).defaultPrevented).toBe(false);
    expect(key(root, 'Delete', { keyCode: 229 }).defaultPrevented).toBe(false);
    act(() => h.author.setProp('a', 'tail', 'value', lit('New host plan')));
    await waitFor(() => expect(h.canvas()).not.toBe(root));
    expect(root.isConnected).toBe(false);
    fireEvent(root, new h.win.CompositionEvent('compositionstart', { bubbles: true, data: '旧' }));
    h.focus();
    expect(key(h.canvas(), 'Delete').defaultPrevented).toBe(true);
    // setProp deliberately selected tail in the real document commit.
    expect(findNode(h.author.getSnapshot().plan.pages.get('a')!.schema, 'tail')).toBeUndefined();
    expect(findNode(h.author.getSnapshot().plan.pages.get('a')!.schema, 'alpha')).toBeTruthy();
  });

  it('I6 retains legal remount tickets but rejects parent takeover across real Canvas gaps and preserves new tree commands', async () => {
    const h = harness();
    h.focus();
    expect(key(h.canvas(), 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(h.author.getClipboardSnapshot().available).toBe(true);
    const first = h.canvas();
    expect(key(first, 'v', { ctrlKey: true }).defaultPrevented).toBe(true);
    await waitFor(() => expect(h.canvas()).not.toBe(first));
    await waitFor(() => expect(h.doc.activeElement).toBe(h.canvas()));
    expect(document.activeElement).toBe(h.frame);
    const current = h.canvas();
    const outside = h.parentInput();
    act(() => outside.focus());
    // A real parent focus operation leaves the child's last activeElement
    // intact in JSDOM too. Delivery below challenges the live focus-chain guard.
    expect(h.doc.activeElement).toBe(current);
    const before = h.author.getSnapshot();
    expect(key(current, 'v', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(h.author.getSnapshot()).toBe(before);
    act(() => h.focus());
    expect(h.stage.current()?.author).toBe(h.canvas());
    expect(h.stage.focused(h.canvas())).toBe(true);
    let observedGap = false;
    const realDispose = PageRuntime.prototype.dispose;
    const oldCanvas = h.canvas();
    let intercepted = false;
    vi.spyOn(PageRuntime.prototype, 'dispose').mockImplementation(function (this: PageRuntime) {
      realDispose.call(this);
      if (intercepted) return;
      intercepted = true;
      observedGap = !oldCanvas.isConnected && !h.doc.querySelector('[aria-label="页面编辑画布"]');
      outside.focus();
      pointer(outside, 'pointerdown');
    });
    expect(key(oldCanvas, 'v', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(observedGap).toBe(true);
    await waitFor(() => expect(h.canvas()).not.toBe(oldCanvas));
    expect(document.activeElement).toBe(outside);
    expect(h.doc.activeElement).not.toBe(h.canvas());
    // A late owning-document event/load cannot revive the retired operation.
    act(() => h.frame.dispatchEvent(new Event('load')));
    expect(document.activeElement).toBe(outside);
    act(() => h.author.select('a', 'tail'));
    const tree = h.tree('tail');
    tree.focus();
    expect(key(tree, 'c', { ctrlKey: true }).defaultPrevented).toBe(true);
    const treeClipboard = h.author.getClipboardSnapshot();
    expect(treeClipboard).not.toBeNull();
    const navigation = h.session().navigation;
    const treeSnapshot = h.author.getSnapshot();
    const replacement = document.createElement('button');
    h.view.container.append(replacement);
    const restore = vi.spyOn(replacement, 'focus');
    act(() => {
      navigation.requestHistoryFocus(h.author, treeSnapshot, 'tree', tree);
      // This is inside the tree's own origin. Its existing Navigation ticket
      // must survive even though persistent Stage parent capture also sees it.
      pointer(tree, 'pointerdown');
      navigation.restoreHistoryFocus(h.author, treeSnapshot, 'tree', replacement);
    });
    expect(restore).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(h.author.getClipboardSnapshot()).toBe(treeClipboard);
    expect(document.activeElement).toBe(replacement);
  });
});
