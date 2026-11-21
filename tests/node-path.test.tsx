import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { nodePath } from '../packages/editor/node-path';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { registry } from '../src/materials';
import { CanvasBreadcrumb } from '../src/editor/CanvasBreadcrumb';
import { TipProvider } from '../src/ui/primitives';

afterEach(cleanup);
it('includes slot ancestry and navigates definitions without changing plans or history', () => {
  const document = new EditorDocument(purchaseManagementExample, registry);
  const page = document.getSnapshot().plan.pages.get('purchases')!.schema;
  const path = nodePath(page, 'edit-purchase');
  expect(path.map(({ node }) => node.id)).toEqual([
    'purchase-workspace',
    'purchase-list-card',
    'purchase-table',
    'edit-purchase',
  ]);
  expect(path.at(-1)!.slot).toBe('actions');
  expect(nodePath(page, 'missing')).toEqual([]);
  const plan = document.getSnapshot().plan;
  document.select('purchases', 'edit-purchase');
  render(
    <TipProvider>
      <CanvasBreadcrumb document={document} snapshot={document.getSnapshot()} />
    </TipProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: '选择层级 数据表格 purchase-table' }));
  expect(document.getSnapshot().selection.nodeId).toBe('purchase-table');
  expect(document.getSnapshot().plan).toBe(plan);
  expect(document.getSnapshot().canUndo).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '选择页面 采购申请管理' }));
  expect(document.getSnapshot().selection.nodeId).toBeNull();
});
