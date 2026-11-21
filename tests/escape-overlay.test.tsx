import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@base-ui/react/dialog';
import App from '../src/App';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { DialogMaterial, DrawerMaterial } from '../src/materials/feedback';
import { SelectMaterial } from '../src/SelectMaterial';
import { canvasRoot, keyboardHarness, keyboardSchema, treeRow } from './keyboard-delete-fixture';
import { escapeHarness, pressEscape } from './escape-priority-fixture';
import { lit, selectionText } from './multiselection-fixture';

const originalWidth = window.innerWidth;
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 40));
});
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});
function mountNarrow(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify({
      storageVersion: 1,
      savedAt: '2026-11-10',
      schema: keyboardSchema(),
      selection: { pageId: 'a', nodeId: 'alpha' },
    }),
  );
  render(<App saveDelayMs={1} />);
  fireEvent.click(screen.getByRole('button', { name: '打开页面设计' }));
  return screen.getByRole('dialog', { name: '页面设计' });
}

describe('real ResponsiveSide and Tooltip Escape ownership', () => {
  it.each([390, 760])(
    '%ipx:open destination popup,drag cancellation,then Sidebar dismissal need separate Escapes',
    async (width) => {
      const sidebar = mountNarrow(width);
      fireEvent.keyDown(within(sidebar).getByRole('button', { name: '拖动 文本 alpha' }), {
        key: ' ',
      });
      const destination = screen.getByRole('combobox', { name: '拖放位置' });
      fireEvent.click(destination);
      const option = screen.getByRole('option', { name: '页面末尾' });
      option.focus();
      await pressEscape(option);
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(screen.getByLabelText('拖放操作')).toBeTruthy();
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(sidebar);
      destination.focus();
      await pressEscape(destination);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(sidebar);
      expect(treeRow('alpha').getAttribute('aria-pressed')).toBe('true');
      const close = within(sidebar).getByRole('button', { name: '关闭页面设计' });
      close.focus();
      await pressEscape(close);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull());
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开页面设计' })),
      );
      expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
      expect(screen.getByRole('button', { name: /撤销/ }).hasAttribute('disabled')).toBe(true);
    },
  );

  it.each([390, 760])(
    '%ipx:Sidebar refusal while dragging passes only cancellation;next Escape dismisses it',
    async (width) => {
      const sidebar = mountNarrow(width);
      fireEvent.keyDown(within(sidebar).getByRole('button', { name: '拖动 文本 alpha' }), {
        key: ' ',
      });
      const close = within(sidebar).getByRole('button', { name: '关闭页面设计' });
      close.focus();
      await pressEscape(close);
      expect(screen.queryByLabelText('拖放操作')).toBeNull();
      expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(sidebar);
      expect(treeRow('alpha').getAttribute('aria-pressed')).toBe('true');
      await pressEscape(close);
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull());
      expect(screen.getByText('Alpha text', { selector: 'p' })).toBeTruthy();
    },
  );

  it('real focused tree Tip owns the first Escape without bypassing to Sidebar dismissal', async () => {
    const sidebar = mountNarrow(390);
    const row = treeRow('alpha');
    act(() => row.focus());
    await screen.findByRole('tooltip');
    await pressEscape(row);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(screen.getByRole('dialog', { name: '页面设计' })).toBe(sidebar);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    await pressEscape(row);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '页面设计' })).toBeNull());
  });
});

describe('real runtime overlays retain their own ownership', () => {
  it.each([DialogMaterial, DrawerMaterial])(
    '%s closes its own nested Select first,then runtime overlay without author clearing',
    async (Material) => {
      const onChange = vi.fn();
      function RuntimeOverlay() {
        const [open, setOpen] = useState(true);
        return (
          <Material
            title="Runtime overlay"
            open={open}
            onOpenChange={(value) => {
              onChange(value);
              setOpen(value);
            }}
            showTrigger={false}
            showFooter={false}
          >
            <SelectMaterial
              label="Runtime choice"
              value={null}
              options={[{ label: 'Runtime option', value: 'one' }]}
            />
          </Material>
        );
      }
      const { document } = escapeHarness(
        <div data-canvas-action="true">
          <RuntimeOverlay />
        </div>,
      );
      const before = document.getSnapshot();
      const trigger = screen.getByRole('combobox', { name: 'Runtime choice' });
      fireEvent.click(trigger);
      const option = screen.getByRole('option', { name: 'Runtime option' });
      option.focus();
      await pressEscape(option);
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(screen.getByRole('dialog', { name: 'Runtime overlay' })).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();
      trigger.focus();
      await pressEscape(trigger);
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Runtime overlay' })).toBeNull(),
      );
      expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it('busy real Dialog refuses Escape and never releases it to an underlying drag', async () => {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const onChange = vi.fn();
    const { document, drag } = escapeHarness(
      <div data-canvas-action="true">
        <DialogMaterial
          title="Busy runtime"
          open
          onOpenChange={onChange}
          showTrigger={false}
          onConfirm={() => pending}
        />
      </div>,
    );
    const before = document.getSnapshot();
    // Public provider begin creates an underlying session without synthetic clicks through modal inert UI.
    act(() => drag().begin({ kind: 'material', component: 'ui.text' }));
    const dialog = screen.getByRole('dialog', { name: 'Busy runtime' });
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(within(dialog).getByRole('button', { name: '处理中…' }).hasAttribute('disabled')).toBe(
      true,
    );
    dialog.focus();
    await pressEscape(dialog);
    expect(screen.getByRole('dialog', { name: 'Busy runtime' })).toBe(dialog);
    expect(drag().isInteracting).toBe(true);
    expect(document.getSnapshot()).toBe(before);
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => {
      complete();
      await pending;
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('genuine confirmation Dialog dismissal cannot cancel an underlying author drag', async () => {
    const { document, drag } = escapeHarness(
      <div data-canvas-action="true">
        <Dialog.Root defaultOpen>
          <Dialog.Portal>
            <Dialog.Popup>
              <Dialog.Title>Confirm replacement</Dialog.Title>
              <Dialog.Close>Keep project</Dialog.Close>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </div>,
    );
    const before = document.getSnapshot();
    act(() => drag().begin({ kind: 'material', component: 'ui.text' }));
    const cancel = screen.getByRole('button', { name: 'Keep project' });
    cancel.focus();
    await pressEscape(cancel);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Confirm replacement' })).toBeNull(),
    );
    expect(drag().isInteracting).toBe(true);
    expect(document.getSnapshot()).toBe(before);
  });
});

describe('actual Renderer design presentation permits author cancellation without authored close', () => {
  it.each(['ui.dialog', 'ui.drawer'])(
    '%s does not swallow Canvas drag Escape or run schema close actions',
    async (component) => {
      const schema = keyboardSchema();
      schema.dependencies.components[component] = '1.0.0';
      schema.pages[0].children.push({
        id: 'design-overlay',
        component,
        props: { title: lit('Design presentation'), open: lit(false) },
        children: [selectionText('design-child', 'Design child')],
        on: {
          onOpenChange: [
            {
              id: 'forbidden-close',
              action: 'state.set',
              input: { stateId: lit('caption'), value: lit('unexpected close') },
            },
          ],
        },
      });
      const { document, drag, runtimes } = keyboardHarness({ schema, ids: ['design-child'] });
      const before = document.getSnapshot();
      const run = vi.spyOn(runtimes[0], 'run');
      await act(async () => {
        await Promise.resolve();
      });
      const host = globalThis.document.querySelector<HTMLElement>(
        '[data-overlay-node="design-overlay"]',
      )!;
      expect(host.getAttribute('data-overlay-presentation')).toBe('expanded');
      const portalHost = host.querySelector('.material-overlay-mount');
      act(() => drag().begin({ kind: 'material', component: 'ui.text' }));
      const destination = screen.getByRole('combobox', { name: '拖放位置' });
      fireEvent.click(destination);
      const option = screen.getByRole('option', { name: '页面末尾' });
      option.focus();
      await pressEscape(option);
      await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
      expect(drag().isInteracting).toBe(true);
      expect(host.getAttribute('data-overlay-presentation')).toBe('expanded');
      canvasRoot().focus();
      await pressEscape(canvasRoot());
      expect(drag().isInteracting).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      expect(host.getAttribute('data-overlay-presentation')).toBe('expanded');
      expect(host.querySelector('.material-overlay-mount')).toBe(portalHost);
      expect(run).not.toHaveBeenCalled();
    },
  );
});
