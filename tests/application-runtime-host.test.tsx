import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationRuntimeHost } from '../src/ApplicationRuntimeHost';
import { compileApplication } from '../packages/runtime/engine';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
import { applicationRoutePath } from '../packages/runtime/router';

const plan = compileApplication(exampleApplication, registry);

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/editor');
});

describe('application runtime host', () => {
  it('renders the entry page and navigates to another routed page', async () => {
    window.history.replaceState({}, '', applicationRoutePath(plan.schema.id));
    render(<ApplicationRuntimeHost plan={plan} />);
    expect(screen.getByText(plan.schema.title)).toBeTruthy();
    const selector = screen.getByRole('combobox', { name: '切换应用页面' });
    const nextPage = plan.schema.pages.find((page) => page.id !== plan.schema.entryPageId)!;
    fireEvent.change(selector, { target: { value: nextPage.id } });
    await waitFor(() =>
      expect(window.location.pathname).toBe(applicationRoutePath(plan.schema.id, nextPage.id)),
    );
    expect(
      (screen.getByRole('combobox', { name: '切换应用页面' }) as HTMLSelectElement).value,
    ).toBe(nextPage.id);
  });

  it('navigates within a mobile preview while keeping its access fragment and hiding editor actions', () => {
    const fragment = '#preview-test-token';
    window.history.replaceState({}, '', `/mobile-preview${fragment}`);
    const nextPage = plan.schema.pages.find((page) => page.id !== plan.schema.entryPageId)!;
    render(<ApplicationRuntimeHost plan={plan} previewPageId={nextPage.id} />);
    const selector = screen.getByRole<HTMLSelectElement>('combobox', { name: '切换应用页面' });
    expect(selector.value).toBe(nextPage.id);
    expect(screen.queryByRole('button', { name: '编辑应用' })).toBeNull();

    fireEvent.change(selector, { target: { value: plan.schema.entryPageId } });
    expect(window.location.pathname).toBe('/mobile-preview');
    expect(new URLSearchParams(window.location.search).get('page')).toBe(plan.schema.entryPageId);
    expect(window.location.hash).toBe(fragment);
  });

  it('shows a recoverable message when an application is not loaded', () => {
    window.history.replaceState({}, '', '/apps/not-loaded');
    render(<ApplicationRuntimeHost plan={plan} />);
    expect(screen.getByRole('heading', { name: '无法打开应用页面' })).toBeTruthy();
    expect(screen.getByText('应用不存在或当前尚未加载该应用。')).toBeTruthy();
  });
});
