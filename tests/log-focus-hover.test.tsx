import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import App from '../src/App';
import type { ApplicationSchema } from '../packages/schema/types';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { logButton, logHarness } from './log-definition-fixture';

const nativeSignals = vi.hoisted(() => ({ hold: false, pending: [] as (() => void)[] }));
vi.mock('@base-ui/react/dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/dialog')>();
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Root: (props: ComponentProps<typeof actual.Dialog.Root>) => (
        <actual.Dialog.Root
          {...props}
          onOpenChangeComplete={(open) => {
            const deliver = () => props.onOpenChangeComplete?.(open);
            if (open && nativeSignals.hold && props.onOpenChangeComplete)
              nativeSignals.pending.push(deliver);
            else deliver();
          }}
        />
      ),
    },
  };
});

const schema: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'log-hover',
  title: 'Local hover',
  entryPageId: 'page',
  dependencies: { components: { 'ui.text': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: 'Page',
      state: [{ id: 'invalidDisplay', type: 'string', initial: 'invalid-display' }],
      children: [
        {
          id: 'other',
          component: 'ui.text',
          props: { value: { kind: 'literal', value: 'Other' } },
        },
        {
          id: 'failure',
          component: 'ui.text',
          props: { value: { kind: 'literal', value: 'Actual error source' } },
          style: {
            display: { kind: 'expression', language: 'javascript', source: 'state.invalidDisplay' },
          },
        },
      ],
    },
  ],
};
const frames = new Map<number, FrameRequestCallback>();
let sequence = 0;
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  nativeSignals.hold = false;
  nativeSignals.pending.length = 0;
  frames.clear();
  sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(40, 100, 240, 300),
  );
});
afterEach(() => {
  cleanup();
  frames.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
async function finish() {
  for (let round = 0; round < 3; round++) {
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      const next = [...frames.values()];
      frames.clear();
      next.forEach((callback) => callback(round));
    });
  }
}
function mount() {
  const saved = JSON.stringify({
    storageVersion: 1,
    savedAt: 'fixture',
    schema,
    selection: { pageId: 'page', nodeId: 'other' },
  });
  render(
    <App
      projectStorage={{
        getItem: (key) => (key === PROJECT_STORAGE_KEY ? saved : null),
        setItem: () => {},
      }}
    />,
  );
}
describe('044 independent actual App hover after log-owned layout change', () => {
  it('keeps pending target focus when a previously hovered canvas publishes only clearHover after dock close', async () => {
    mount();
    await finish();
    const canvas = document.querySelector<HTMLElement>('.editor-canvas')!;
    const marker = canvas.querySelector<HTMLElement>('[data-editor-node="other"]')!;
    fireEvent.pointerOver(marker, { pointerType: 'mouse', clientX: 200, clientY: 400, buttons: 0 });
    expect(
      document
        .querySelector('[data-editor-tree-node="other"]')
        ?.getAttribute('data-editor-hovered'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
    const row = [...document.querySelectorAll<HTMLElement>('.logs article')].find(
      (entry) =>
        entry.textContent?.includes('style.error') && entry.textContent.includes('node · failure'),
    )!;
    fireEvent.click(within(row).getByRole('button'));
    const destination = screen.getByRole('button', { name: '选中 文本 failure' });
    fireEvent.pointerLeave(canvas, {
      pointerType: 'mouse',
      clientX: 200,
      clientY: 400,
      buttons: 0,
    });
    await finish();
    expect(
      document
        .querySelector('[data-editor-tree-node="other"]')
        ?.getAttribute('data-editor-hovered'),
    ).not.toBe('true');
    expect(document.activeElement).toBe(destination);
  });

  it('still rejects a foreign selected-instance publication retaining the exact pending request', async () => {
    const h = logHarness();
    try {
      fireEvent.click(logButton());
      const own = h.session().navigation.getSnapshot().request;
      expect(own?.nodeId).toBe('target');
      act(() => h.session().navigation.setSelectedInstance({ pageId: 'page', nodeId: 'other' }));
      expect(h.session().navigation.getSnapshot().selectedInstance?.nodeId).toBe('other');
      expect(h.session().navigation.getSnapshot().request).toBeNull();
      await finish();
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: '选中 文本 target' }),
      );
    } finally {
      h.runtime.dispose();
    }
  });

  it('rejects an identical navigation snapshot publication from a foreign keyboard command without treating it as changed hover', async () => {
    const h = logHarness();
    try {
      const origin = logButton();
      fireEvent.click(origin);
      const before = h.session().navigation.getSnapshot();
      expect(before.request?.nodeId).toBe('target');
      act(() => {
        h.session().navigation.requestHistoryFocus(h.doc, h.doc.getSnapshot(), 'tree', origin);
        expect(h.session().navigation.getSnapshot().request).toBeNull();
        // The foreign command owns a legitimate focus restoration of its own.
        // Cancel that separate intent before flushing to isolate the old log
        // receipt's ability to execute; the clone publication remains real.
        h.session().navigation.resetKeyboardInteraction();
      });
      const after = h.session().navigation.getSnapshot();
      expect(after.hover).toBe(before.hover);
      expect(after.selectedInstance).toBe(before.selectedInstance);
      expect(after.request).toBeNull();
      await finish();
      expect(document.activeElement).not.toBe(
        screen.getByRole('button', { name: '选中 文本 target' }),
      );
    } finally {
      h.session().navigation.resetKeyboardInteraction();
      h.runtime.dispose();
    }
  });

  it('preserves presenting ownership during its registered native opening across passive canvas hover until actual host completion', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 760 });
    mount();
    await finish();
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
    const row = [...document.querySelectorAll<HTMLElement>('.logs article')].find(
      (entry) =>
        entry.textContent?.includes('style.error') && entry.textContent.includes('node · failure'),
    )!;
    nativeSignals.hold = true;
    fireEvent.click(within(row).getByRole('button'));
    await finish();
    expect(nativeSignals.pending).toHaveLength(1);
    const destination = screen.getByRole('button', { name: '选中 文本 failure' });
    expect(document.activeElement).not.toBe(destination);
    expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
    const marker = document.querySelector<HTMLElement>(
      '.editor-canvas [data-editor-node="other"]',
    )!;
    expect(marker).toBeTruthy();
    fireEvent.pointerOver(marker, { pointerType: 'mouse', clientX: 200, clientY: 400, buttons: 0 });
    act(() => nativeSignals.pending.splice(0).forEach((deliver) => deliver()));
    await finish();
    console.log(
      'presenting-native-hover-outcome',
      JSON.stringify({
        selected: destination.getAttribute('aria-pressed'),
        hovered: document
          .querySelector('[data-editor-tree-node="other"]')
          ?.getAttribute('data-editor-hovered'),
        active: (document.activeElement as HTMLElement)?.outerHTML.slice(0, 160),
      }),
    );
    expect(document.activeElement).toBe(destination);
  });
  it.each(['canvas', 'tree'] as const)(
    'keeps exact pending tree focus through a %s hover notification without a fresh pointer movement or press',
    async (source) => {
      mount();
      await finish();
      fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
      const row = [...document.querySelectorAll<HTMLElement>('.logs article')].find(
        (entry) =>
          entry.textContent?.includes('style.error') &&
          entry.textContent.includes('node · failure'),
      )!;
      expect(row).toBeTruthy();
      fireEvent.click(within(row).getByRole('button'));
      const destination = screen.getByRole('button', { name: '选中 文本 failure' });
      expect(destination.getAttribute('aria-pressed')).toBe('true');
      expect(document.querySelector('#debug-dock')?.classList.contains('open')).toBe(false);
      expect(document.activeElement).not.toBe(destination);
      if (source === 'canvas') {
        const marker = document.querySelector<HTMLElement>(
          '.editor-canvas [data-editor-node="other"]',
        )!;
        expect(marker).toBeTruthy();
        fireEvent.pointerOver(marker, {
          pointerType: 'mouse',
          clientX: 200,
          clientY: 400,
          buttons: 0,
        });
      } else {
        const treeRow = screen
          .getByRole('button', { name: '选中 文本 other' })
          .closest<HTMLElement>('[data-editor-tree-node]')!;
        fireEvent.pointerEnter(treeRow, {
          pointerType: 'mouse',
          clientX: 200,
          clientY: 400,
          buttons: 0,
        });
      }
      await finish();
      console.log(
        'actual-hover-outcome',
        JSON.stringify({
          source,
          active: (document.activeElement as HTMLElement)?.outerHTML.slice(0, 170),
          selected: destination.getAttribute('aria-pressed'),
          hovered: document
            .querySelector('[data-editor-tree-node="other"]')
            ?.getAttribute('data-editor-hovered'),
          pendingFrames: frames.size,
        }),
      );
      expect(document.activeElement).toBe(destination);
    },
  );
});
