import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { findNode } from '../packages/editor/document';
import App from '../src/App';
import { purchaseManagementExample } from '../src/purchase-management-example';
import type { ApplicationSchema } from '../packages/schema/types';

afterEach(cleanup);

function seed(nodeId: string) {
  localStorage.setItem(
    PROJECT_STORAGE_KEY,
    JSON.stringify({
      storageVersion: 1,
      savedAt: 'fixture',
      schema: purchaseManagementExample,
      selection: { pageId: 'purchases', nodeId },
    }),
  );
  window.history.replaceState({}, '', '/edit/dimlu.purchase-management/purchases');
  render(<App saveDelayMs={1} />);
}

function storedSchema(): ApplicationSchema {
  return JSON.parse(localStorage.getItem(PROJECT_STORAGE_KEY)!).schema;
}

async function openMenu(nodeId: string, x = 20, y = 20) {
  const canvas = window.document.querySelector('[aria-label="页面编辑画布"]');
  expect(canvas, 'canvas host').toBeTruthy();
  const target = canvas!.querySelector<HTMLElement>(`[data-editor-node="${nodeId}"]`);
  expect(target, `canvas node ${nodeId}`).toBeTruthy();
  await act(async () => {
    fireEvent.contextMenu(target!, { clientX: x, clientY: y });
  });
  return screen.findByRole('menu');
}

async function clickMenuItem(name: string) {
  const item = screen.getByRole('menuitem', { name }) as HTMLButtonElement;
  await act(async () => {
    fireEvent.pointerDown(item, { pointerType: 'mouse', button: 0 });
    fireEvent.click(item);
  });
}

async function closeMenu() {
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.queryByRole('menu')).toBeNull();
}

describe('node context menu', () => {
  it('opens on canvas right click and reorders siblings', async () => {
    seed('clear-purchases');
    await openMenu('clear-purchases');
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('上移一层');
    await clickMenuItem('上移一层');
    await closeMenu();
    const toolbar = findNode(storedSchema().pages[0], 'purchase-toolbar-buttons')!.node
      .children!
      .map((node) => (node.props.label as { value: string }).value);
    expect(toolbar[0]).toBe('重置筛选');
  });

  it('enables paste-into after copying and pastes into a container', async () => {
    seed('purchase-heading');
    await openMenu('purchase-heading');
    // Empty clipboard → paste entries disabled.
    expect(
      (screen.getByRole('menuitem', { name: '粘贴为子级' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await clickMenuItem('复制到剪贴板');
    await closeMenu();
    await openMenu('purchase-workspace');
    expect(
      (screen.getByRole('menuitem', { name: '粘贴为子级' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await clickMenuItem('粘贴为子级');
    await closeMenu();
    const workspace = findNode(storedSchema().pages[0], 'purchase-workspace')!.node;
    expect(workspace.children!.filter((child) => child.component === 'ui.heading')).toHaveLength(2);
  });

  it('deletes from the outline context menu', async () => {
    seed('clear-purchases');
    await openMenu('clear-purchases');
    await clickMenuItem('删除');
    await closeMenu();
    expect(findNode(storedSchema().pages[0], 'clear-purchases')).toBeUndefined();
  });
});
