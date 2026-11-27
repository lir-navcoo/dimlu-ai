import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';
import { PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { purchaseManagementExample } from '../src/purchase-management-example';

afterEach(cleanup);

describe('application runtime route regression', () => {
  it('executes onEnter queries and opens the purchase drawer from the New button', async () => {
    localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify({ storageVersion: 1, savedAt: 'route', schema: purchaseManagementExample }),
    );
    window.history.replaceState({}, '', '/apps/dimlu.purchase-management');
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await waitFor(
      () => expect(screen.getByText(/^共 \d+ 条采购申请$/).textContent).not.toBe('共 0 条采购申请'),
      { timeout: 3000 },
    );
    fireEvent.click(screen.getByRole('button', { name: '新建申请' }));
    expect(await screen.findByRole('dialog', { name: '新建采购申请' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '新建采购申请' })).toBeNull());
  });
});
