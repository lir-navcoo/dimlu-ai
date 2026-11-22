import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { keyboardSchema } from './keyboard-delete-fixture';
import { selectionRegistry } from './multiselection-fixture';
import { changeControl } from './ui-helpers';
import { pressEscape } from './escape-priority-fixture';
import { layerBegin, layerHarness, layerPointer } from './drag-layer-fixture';
import { DialogMaterial } from '../src/materials/feedback';
import { SelectMaterial } from '../src/SelectMaterial';

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
let policyStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
  // JSDOM loads only the real scoped policy rules,not Tailwind/modern @layer or paint geometry.
  const css = readFileSync(resolve('src/editor/styles/shell-drag.css'), 'utf8');
  policyStyle = document.createElement('style');
  policyStyle.textContent = [...css.matchAll(/\.drag-feedback(?:\.keyboard)?\s*\{[^}]*\}/g)]
    .map((match) => match[0])
    .join('\n');
  document.head.append(policyStyle);
});
afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  policyStyle?.remove();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  if (originalElementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});
const feedback = () => screen.getByLabelText('拖放操作');
const notice = () => document.querySelector<HTMLElement>('.drag-notice');

describe('drag feedback owns one body Portal outside the isolated root', () => {
  it('portaled Select retains real Provider callbacks,ref autofocus and React logical ancestry', async () => {
    const { author, root, logicalClicks, api, session } = layerHarness();
    const before = author.getSnapshot();
    const draft = { source: 'base', dirty: true, value: 'state.' };
    act(() => session().drafts.write('layer:retained', draft));
    const destination = layerBegin();
    const panel = feedback();
    expect(root.contains(panel)).toBe(false);
    expect(document.body.contains(panel)).toBe(true);
    expect(screen.getAllByLabelText('拖放操作')).toHaveLength(1);
    expect(getComputedStyle(panel).pointerEvents).toBe('auto');
    await waitFor(() => expect(document.activeElement).toBe(destination));
    const clicksBefore = logicalClicks.length;
    changeControl(destination, JSON.stringify({ kind: 'after', nodeId: 'tail' }));
    expect(logicalClicks.length).toBeGreaterThan(clicksBefore);
    expect(logicalClicks).toContain(destination);
    expect(api().session!.candidate!.intent).toEqual({ kind: 'after', nodeId: 'tail' });
    expect(feedback()).toBe(panel);
    expect(author.getSnapshot()).toBe(before);
    expect(session().drafts.read('layer:retained', 'base', '')).toBe(draft);
    fireEvent.click(within(panel).getByRole('button', { name: '取消拖动' }));
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(panel.isConnected).toBe(false);
    expect(author.getSnapshot()).toBe(before);
  });

  it('successful real confirm commits once and replaces feedback with one body notice;next session clears it', () => {
    const { author, root } = layerHarness();
    const move = vi.spyOn(author, 'moveNode');
    const destination = layerBegin();
    changeControl(destination, JSON.stringify({ kind: 'after', nodeId: 'tail' }));
    fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
    expect(move).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(notice()?.textContent).toContain('已放置，可撤销');
    expect(root.contains(notice())).toBe(false);
    expect(document.body.contains(notice())).toBe(true);
    expect(document.querySelectorAll('.drag-notice')).toHaveLength(1);
    expect(author.getSnapshot().canUndo).toBe(true);
    act(() => author.undo());
    expect(author.getSnapshot().canUndo).toBe(false);
    layerBegin('material');
    expect(notice()).toBeNull();
    expect(screen.getAllByLabelText('拖放操作')).toHaveLength(1);
  });

  it.each([false, true])(
    'StrictMode=%s repeated sessions/unmount leave no feedback,notice or detached host',
    (strict) => {
      const { root, view, api } = layerHarness({ strict });
      const baseline = [...document.body.children];
      for (let n = 0; n < 3; n++) {
        layerBegin('material');
        expect(screen.getAllByLabelText('拖放操作')).toHaveLength(1);
        act(() => api().cancel());
        expect(screen.queryByLabelText('拖放操作')).toBeNull();
      }
      layerBegin();
      view.unmount();
      expect(root.isConnected).toBe(true);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(notice()).toBeNull();
      expect([...document.body.children]).toEqual(baseline);
    },
  );
});

describe('body Portal follows live author lifetime without stale resurrection', () => {
  it.each(['disabled', 'page', 'plan', 'selection', 'document', 'code'] as const)(
    'active %s change removes Portal and old finish cannot mutate either document',
    (kind) => {
      const { author, view, tree, api } = layerHarness();
      layerBegin();
      const panel = feedback();
      const oldFinish = api().finish;
      let target = author;
      act(() => {
        if (kind === 'disabled') view.rerender(tree(author, false));
        else if (kind === 'page') author.selectPage('b');
        else if (kind === 'plan') author.renamePage('b', 'Changed plan');
        else if (kind === 'selection') author.select('a', 'tail');
        else if (kind === 'code')
          author.setPageCode('a', { ...keyboardSchema().pages[0].code!, enabled: true });
        else {
          target = new EditorDocument(keyboardSchema(), selectionRegistry());
          view.rerender(tree(target));
        }
      });
      const oldState = author.getSnapshot();
      const newState = target.getSnapshot();
      expect(panel.isConnected).toBe(false);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(notice()).toBeNull();
      act(() => oldFinish());
      expect(author.getSnapshot()).toBe(oldState);
      expect(target.getSnapshot()).toBe(newState);
      expect(notice()).toBeNull();
    },
  );

  it.each(['disabled', 'page', 'plan', 'document'] as const)(
    'notice expires on %s and does not revive on returning to edit/source context',
    (kind) => {
      const { author, view, tree } = layerHarness();
      layerBegin('material');
      fireEvent.click(screen.getByRole('button', { name: '确认放置' }));
      expect(notice()).toBeTruthy();
      act(() => {
        if (kind === 'disabled') view.rerender(tree(author, false));
        else if (kind === 'page') author.selectPage('b');
        else if (kind === 'plan') author.renamePage('b', 'Invalidate completed notice');
        else view.rerender(tree(new EditorDocument(keyboardSchema(), selectionRegistry())));
      });
      expect(notice()).toBeNull();
      act(() => {
        if (kind === 'page') author.selectPage('a');
        else view.rerender(tree(author));
      });
      expect(notice()).toBeNull();
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
    },
  );

  it('stale rendered snapshot cannot keep an author Portal alive after live full-selection change', () => {
    const { author } = layerHarness({ frozenSnapshot: true });
    layerBegin();
    act(() => author.selectMany('a', ['alpha', 'tail'], 'alpha'));
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(notice()).toBeNull();
  });
});

describe('pointer feedback keeps client coordinates and excludes itself as a drop destination', () => {
  it.each([0.5, 1.5, 1000 / 1440])(
    'root scale %s does not scale fixed pointer feedback coordinates a second time',
    (scale) => {
      const { root, api, author } = layerHarness();
      root.style.transform = `scale(${scale})`;
      const before = author.getSnapshot();
      layerPointer(
        'pointerdown',
        screen.getByRole('button', { name: 'Start material pointer' }),
        100,
        200,
      );
      expect(api().isInteracting).toBe(true);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      layerPointer('pointermove', window, 120, 220);
      const panel = feedback();
      expect(root.contains(panel)).toBe(false);
      expect(panel.style.left).toBe('134px');
      expect(panel.style.top).toBe('238px');
      expect(getComputedStyle(panel).position).toBe('fixed');
      expect(getComputedStyle(panel).pointerEvents).toBe('none');
      const hit = vi.fn(() => panel);
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
      layerPointer('pointermove', window, 140, 240);
      expect(api().session!.candidate).toBeUndefined();
      expect(author.getSnapshot()).toBe(before);
      layerPointer('pointercancel', window, 140, 240);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
    },
  );

  it('shows a clipped passive guide only near a valid canvas candidate and commits only the insertion', async () => {
    const { author, root, api } = layerHarness({
      children: (
        <>
          <div className="canvas-scroll">
            <div className="editor-surface">
              <div data-editor-node="tail">
                <p>Tail canvas marker</p>
              </div>
              <div data-editor-node="shared">
                <p>Shared canvas marker</p>
              </div>
            </div>
          </div>
          <div data-editor-tree-node="tail">Tail tree marker</div>
          <div
            data-drop-intent={JSON.stringify({ kind: 'inside', parentId: 'tail' })}
            className="editor-surface"
          >
            Invalid canvas drop zone
          </div>
        </>
      ),
    });
    const guide = () => document.querySelector<HTMLElement>('.canvas-alignment-guide');
    const tail = screen.getByText('Tail canvas marker');
    const tree = screen.getByText('Tail tree marker');
    const invalid = screen.getByText('Invalid canvas drop zone');
    const shared = screen.getByText('Shared canvas marker');
    const canvasScroll = tail.closest('.canvas-scroll')!;
    const boxes = new Map<Element, DOMRect>([
      [tail, new DOMRect(65, 70, 110, 70)],
      [shared, new DOMRect(82, 150, 110, 40)],
      [canvasScroll, new DOMRect(40, 50, 220, 80)],
    ]);
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      return boxes.get(this) ?? new DOMRect(0, 0, 240, 40);
    });
    let hit = tail;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
    const css = readFileSync(resolve('src/editor/styles/workbench-navigation.css'), 'utf8');
    policyStyle.textContent += `\n${css.match(/\.canvas-alignment-guide\s*\{[^}]*\}/)![0]}`;
    const before = author.getSnapshot();
    layerPointer(
      'pointerdown',
      screen.getByRole('button', { name: 'Start material pointer' }),
      5,
      45,
    );
    layerPointer('pointermove', window, 68, 82);
    await waitFor(() => expect(guide()?.style.left).toBe('65px'));
    expect(guide()?.style.top).toBe('66px');
    expect(guide()?.style.height).toBe('64px');
    expect(guide()?.getAttribute('aria-hidden')).toBe('true');
    expect(root.contains(guide())).toBe(false);
    expect(getComputedStyle(guide()!).pointerEvents).toBe('none');
    expect(author.getSnapshot()).toBe(before);

    layerPointer('pointermove', window, 82, 82);
    await waitFor(() => expect(guide()).toBeNull());
    layerPointer('pointermove', window, 120, 82);
    await waitFor(() => expect(guide()?.style.left).toBe('120px'));
    hit = tree;
    layerPointer('pointermove', window, 68, 82);
    expect(api().session?.candidate?.valid).toBe(true);
    expect(guide()).toBeNull();
    hit = invalid;
    layerPointer('pointermove', window, 68, 82);
    expect(api().session?.candidate?.valid).toBe(false);
    expect(guide()).toBeNull();

    hit = tail;
    layerPointer('pointermove', window, 68, 82);
    await waitFor(() => expect(guide()).toBeTruthy());
    layerPointer('pointerup', window, 68, 82);
    expect(guide()).toBeNull();
    const roots = author.getSnapshot().plan.pages.get('a')!.schema.children;
    expect(roots.map((node) => node.id)).toEqual(['root', roots[1].id, 'tail', 'shared']);
    expect(roots[1].component).toBe('ui.text');
    expect(roots[1].style).toBeUndefined();
    expect(author.getSnapshot().canUndo).toBe(true);
    act(() => author.undo());
    expect(author.getSnapshot().plan).toBe(before.plan);
  });

  it('pointer feedback clamps in physical viewport bounds and keeps cancellation cleanup', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const { api } = layerHarness();
    const source = screen.getByRole('button', { name: 'Start material pointer' });
    const capture = vi.fn();
    const release = vi.fn();
    Object.defineProperty(source, 'setPointerCapture', { value: capture });
    Object.defineProperty(source, 'hasPointerCapture', { value: () => true });
    Object.defineProperty(source, 'releasePointerCapture', { value: release });
    layerPointer('pointerdown', source, 100, 200);
    layerPointer('pointermove', window, 2000, 2000);
    expect(feedback().style.left).toBe('110px');
    expect(feedback().style.top).toBe('704px');
    expect(capture).toHaveBeenCalledWith(1);
    layerPointer('pointercancel', window);
    expect(api().isInteracting).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(1);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
  });
});

describe('portaled destination preserves one-Escape ownership and focus', () => {
  it('disabled authoring removes feedback before a reachable real runtime modal opens;popup and modal retain Escape', async () => {
    function RuntimeDialog() {
      const [open, setOpen] = useState(false);
      return (
        <DialogMaterial
          title="Reachable runtime modal"
          triggerLabel="Open runtime modal"
          open={open}
          onOpenChange={setOpen}
          showFooter={false}
        >
          <SelectMaterial
            label="Preview real choice"
            value={null}
            options={[{ label: 'Preview option', value: 'one' }]}
          />
        </DialogMaterial>
      );
    }
    const { author, view, tree } = layerHarness({ children: <RuntimeDialog /> });
    const before = author.getSnapshot();
    layerBegin('material');
    view.rerender(tree(author, false));
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(notice()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open runtime modal' }));
    const dialog = screen.getByRole('dialog', { name: 'Reachable runtime modal' });
    const trigger = within(dialog).getByRole('combobox', { name: 'Preview real choice' });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: 'Preview option' });
    option.focus();
    await pressEscape(option);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Reachable runtime modal' })).toBe(dialog);
    trigger.focus();
    await pressEscape(trigger);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reachable runtime modal' })).toBeNull(),
    );
    expect(author.getSnapshot()).toBe(before);
    view.rerender(tree(author));
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(notice()).toBeNull();
  });

  it('popup first,closed trigger next retains snapshot and external user focus after cancel', async () => {
    const { author } = layerHarness();
    const before = author.getSnapshot();
    const destination = layerBegin();
    fireEvent.click(destination);
    const option = screen.getByRole('option', { name: '页面末尾' });
    option.focus();
    await pressEscape(option);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(feedback()).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(destination));
    await pressEscape(destination);
    expect(screen.queryByLabelText('拖放操作')).toBeNull();
    expect(author.getSnapshot()).toBe(before);
    const outside = screen.getByLabelText('Layer external draft');
    outside.focus();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(outside);
  });
});
