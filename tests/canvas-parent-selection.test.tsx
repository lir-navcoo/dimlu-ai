import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type { ApplicationSchema } from '../packages/schema/types';
import { EditorCanvas } from '../src/editor/Canvas';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';

const schema: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'parent-selection',
  title: 'Parent selection',
  entryPageId: 'page',
  dependencies: { components: { 'ui.layout': '1.0.0', 'ui.text': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: 'Page',
      state: [],
      children: [
        {
          id: 'root',
          component: 'ui.layout',
          props: {},
          children: [
            {
              id: 'middle',
              component: 'ui.layout',
              props: {},
              children: [
                {
                  id: 'leaf',
                  component: 'ui.text',
                  props: { value: { kind: 'literal', value: 'Leaf content' } },
                },
              ],
            },
          ],
        },
        {
          id: 'other-root',
          component: 'ui.layout',
          props: {},
          children: [
            {
              id: 'other-leaf',
              component: 'ui.text',
              props: { value: { kind: 'literal', value: 'Other leaf content' } },
            },
          ],
        },
      ],
    },
  ],
};

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const runtimes: PageRuntime[] = [];

beforeEach(() => {
  frames.clear();
  frameId = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  frames.clear();
});

async function measureNextFrame() {
  // Let MutationObserver schedule the same measurement as the browser, then
  // explicitly release one frame instead of relying on elapsed wall-clock time.
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}

function setup() {
  const document = new EditorDocument(schema, registry);
  document.select('page', 'leaf');
  const runtime = new PageRuntime(document.getSnapshot().plan, 'page', { designMode: true });
  runtimes.push(runtime);
  function Canvas() {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
    return <EditorCanvas document={document} snapshot={snapshot} runtime={runtime} mode="edit" />;
  }
  const view = render(
    <TipProvider>
      <Canvas />
    </TipProvider>,
  );
  return { document, runtime, view };
}

function expectNoStaleActions() {
  expect(screen.queryByRole('button', { name: '选择父级组件' })).toBeNull();
  expect(screen.queryByRole('button', { name: '复制选中组件' })).toBeNull();
  expect(screen.queryByRole('button', { name: '删除选中组件' })).toBeNull();
}

describe('parent selection while canvas measurement is pending', () => {
  it('ascends each current ancestor without reusing the previous frame toolbar', async () => {
    const { document, runtime } = setup();
    const original = document.getSnapshot();
    const leaf = screen.getByText('Leaf content');
    await measureNextFrame();

    for (const parent of ['middle', 'root', null]) {
      fireEvent.click(screen.getByRole('button', { name: '选择父级组件' }));
      expect(document.getSnapshot().selection.nodeId).toBe(parent);
      expectNoStaleActions();
      expect(document.getSnapshot().plan).toBe(original.plan);
      expect(document.getSnapshot().revision).toBe(original.revision);
      expect(document.getSnapshot().canUndo).toBe(false);
      expect(runtime.disposed).toBe(false);
      expect(screen.getByText('Leaf content')).toBe(leaf);
      await measureNextFrame();
    }
    expectNoStaleActions();
  });

  it('hides the old branch actions until the newly selected branch is measured', async () => {
    const { document } = setup();
    await measureNextFrame();
    expect(screen.getByRole('button', { name: '选择父级组件' })).toBeTruthy();

    act(() => document.select('page', 'other-leaf'));
    expectNoStaleActions();
    expect(document.getSnapshot().selection.nodeId).toBe('other-leaf');
    await measureNextFrame();

    fireEvent.click(screen.getByRole('button', { name: '选择父级组件' }));
    expect(document.getSnapshot().selection.nodeId).toBe('other-root');
    expectNoStaleActions();
    expect(document.getSnapshot().canUndo).toBe(false);
  });

  it('removes all stale actions immediately when the current selection is cleared', async () => {
    const { document } = setup();
    await measureNextFrame();
    expect(screen.getByRole('button', { name: '删除选中组件' })).toBeTruthy();

    act(() => document.select('page', null));
    expectNoStaleActions();
    expect(screen.getByText('Leaf content')).toBeTruthy();
    expect(screen.getByText('Other leaf content')).toBeTruthy();
    await measureNextFrame();
    expectNoStaleActions();
    expect(document.getSnapshot().canUndo).toBe(false);
  });
});
