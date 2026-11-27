import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobilePreview from '../src/MobilePreview';
import { exampleApplication } from './fixtures/examples';

const token = 'v'.repeat(43);
const snapshotPath = '/api/mobile-preview/snapshot';
const validSnapshot = () =>
  new Response(
    JSON.stringify({ application: exampleApplication, pageId: exampleApplication.entryPageId }),
    { headers: { 'Content-Type': 'application/json' } },
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('mobile preview', () => {
  it('requires a link and does not query the server without a token', () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', '/mobile-preview');
    render(<MobilePreview />);
    expect(screen.getByRole('alert').textContent).toContain('链接无效');
    expect(request).not.toHaveBeenCalled();
  });

  it('renders the current snapshot, then closes an already open preview after revocation', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(validSnapshot())
      .mockResolvedValueOnce(new Response(null, { status: 410 }));
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', `/mobile-preview#${token}`);
    render(<MobilePreview />);
    await act(async () => {});
    expect(screen.getByText(exampleApplication.title)).toBeTruthy();
    expect(request).toHaveBeenNthCalledWith(
      1,
      snapshotPath,
      expect.objectContaining({
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(request).toHaveBeenNthCalledWith(
      2,
      snapshotPath,
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(screen.getByRole('alert').textContent).toContain('已被撤销');
    expect(screen.queryByText(exampleApplication.title)).toBeNull();
  });

  it('retries a missing service and loads a fresh snapshot', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(validSnapshot());
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', `/mobile-preview#${token}`);
    render(<MobilePreview />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText(exampleApplication.title)).toBeTruthy();
  });
});
