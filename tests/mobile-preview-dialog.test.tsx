import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobilePreviewDialog } from '../src/editor/MobilePreviewDialog';
import { exampleApplication } from './fixtures/examples';

const { toDataURL } = vi.hoisted(() => ({ toDataURL: vi.fn() }));
vi.mock('qrcode', () => ({ toDataURL }));

const url = 'http://192.168.1.80:4173/mobile-preview#viewer-token';
const token = 'management-token';
const responseJson = (payload: unknown) =>
  new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });

const button = (name: string) => screen.getByRole('button', { name });
const props = { application: exampleApplication, pageId: exampleApplication.entryPageId };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  toDataURL.mockReset();
});

describe('桌面扫码预览', () => {
  it('服务未启用时仅检查状态，并展示本机启动说明', async () => {
    const request = vi.fn().mockResolvedValue(new Response('<!doctype html>'));
    vi.stubGlobal('fetch', request);
    render(<MobilePreviewDialog {...props} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(button('手机扫码预览'));
    expect(screen.getByRole('dialog', { name: '手机扫码预览' })).toBeTruthy();
    expect(await screen.findByText('当前工作台未连接局域网预览服务。')).toBeTruthy();
    expect(screen.getByText('npm run preview:lan')).toBeTruthy();
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/mobile-preview', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(screen.queryByRole('button', { name: '创建预览二维码' })).toBeNull();
  });

  it('远程连接不能创建预览', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(responseJson({ available: true, canCreate: false })),
    );
    render(<MobilePreviewDialog {...props} />);
    fireEvent.click(button('手机扫码预览'));
    expect(await screen.findByText('请在启动局域网预览服务的电脑上创建二维码。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '创建预览二维码' })).toBeNull();
  });

  it('只在创建或更新时上传当前快照，关闭后保留链接并允许撤销', async () => {
    const expiresAt = Date.now() + 60_000;
    const request = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST' || init.method === 'PUT')
        return responseJson({ url, token, expiresAt });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      return responseJson({ available: true, canCreate: true });
    });
    vi.stubGlobal('fetch', request);
    toDataURL.mockResolvedValue('data:image/png;base64,AA==');
    const { rerender } = render(<MobilePreviewDialog {...props} />);
    fireEvent.click(button('手机扫码预览'));
    fireEvent.click(await screen.findByRole('button', { name: '创建预览二维码' }));
    expect(await screen.findByRole('img', { name: '手机扫码打开预览链接' })).toBeTruthy();
    expect(toDataURL).toHaveBeenCalledExactlyOnceWith(url, { width: 240 });
    expect(screen.getByText(/^有效至 /).getAttribute('datetime')).toBe(
      new Date(expiresAt).toISOString(),
    );

    fireEvent.click(button('关闭手机预览'));
    expect(screen.queryByRole('dialog')).toBeNull();
    const next = { application: { ...props.application, title: '已更新' }, pageId: 'next' };
    rerender(<MobilePreviewDialog {...next} />);
    fireEvent.click(button('手机扫码预览'));
    const link = screen.getByRole<HTMLInputElement>('textbox', { name: '手机预览链接' });
    expect(link.value).toBe(url);
    fireEvent.click(button('复制链接'));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '无法自动复制，请手动复制已选中的链接。',
    );
    expect(link.selectionStart).toBe(0);
    expect(link.selectionEnd).toBe(url.length);
    const mutations = () =>
      request.mock.calls.map(([, init]) => init).filter((init) => init.method);
    expect(mutations()).toHaveLength(1);

    fireEvent.click(button('更新快照'));
    expect(await screen.findByText('快照已更新，请在手机上刷新预览。')).toBeTruthy();
    fireEvent.click(button('撤销预览'));
    expect(await screen.findByText('预览链接已撤销。')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();

    const [create, update, revoke] = mutations();
    expect(mutations().map((init) => init.method)).toEqual(['POST', 'PUT', 'DELETE']);
    expect(JSON.parse(create.body as string)).toEqual(props);
    expect(new Headers(create.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(update.body as string)).toEqual(next);
    expect(new Headers(update.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(revoke.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(revoke.body).toBeUndefined();
  });

  it('到期后隐藏二维码和链接', async () => {
    vi.useFakeTimers();
    const expiresAt = Date.now() + 1000;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === 'POST'
          ? responseJson({ url, token, expiresAt })
          : responseJson({ available: true, canCreate: true }),
      ),
    );
    toDataURL.mockResolvedValue('data:image/png;base64,AA==');
    render(<MobilePreviewDialog {...props} />);
    await act(async () => {
      fireEvent.click(button('手机扫码预览'));
    });
    await act(async () => {
      fireEvent.click(button('创建预览二维码'));
    });
    expect(screen.getByRole('img')).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText('此预览链接已过期，请重新创建。')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(button('创建预览二维码')).toBeTruthy();
  });
});
