import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Copy, QrCode, RefreshCw, X } from 'lucide-react';
import type { ApplicationSchema } from '../../packages/schema/types';
import { Button, Input } from '../ui/primitives';
import './mobile-preview.css';

const endpoint = '/api/mobile-preview';

type Availability = 'checking' | 'unavailable' | 'remote' | 'ready';
type PreviewSession = { url: string; token: string; expiresAt: number; qrDataUrl?: string };
type Operation = 'POST' | 'PUT' | 'DELETE';

async function checkAvailability(signal: AbortSignal): Promise<Availability> {
  try {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    if (!response.ok) return 'unavailable';
    const result: unknown = await response.json();
    if (
      !result ||
      typeof result !== 'object' ||
      !('available' in result) ||
      result.available !== true ||
      !('canCreate' in result) ||
      typeof result.canCreate !== 'boolean'
    )
      return 'unavailable';
    return result.canCreate ? 'ready' : 'remote';
  } catch {
    return 'unavailable';
  }
}

function readSession(value: unknown): PreviewSession {
  const { url, token, expiresAt } = (value ?? {}) as Partial<PreviewSession>;
  if (
    typeof url !== 'string' ||
    !/^https?:\/\//.test(url) ||
    !new URL(url).hash ||
    typeof token !== 'string' ||
    !token ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(new Date(expiresAt).getTime())
  )
    throw new Error('无法读取预览服务响应');
  return { url, token, expiresAt };
}

export function MobilePreviewDialog({
  application,
  pageId,
}: {
  application: ApplicationSchema;
  pageId: string;
}) {
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<Availability>('checking');
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  const expiresAt = session?.expiresAt;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void checkAvailability(controller.signal).then((status) => {
      if (!controller.signal.aborted) setAvailability(status);
    });
    return () => controller.abort();
  }, [open, availabilityAttempt]);

  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = window.setTimeout(
      () => {
        setSession((current) => (current?.expiresAt === expiresAt ? null : current));
        setNotice('此预览链接已过期，请重新创建。');
      },
      Math.max(0, expiresAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const managePreview = async (method: Operation) => {
    if (busy || (method === 'POST' ? availability !== 'ready' || session : !session)) return;
    setBusy(method);
    setError('');
    setNotice('');
    try {
      const headers = new Headers();
      if (method !== 'DELETE') headers.set('Content-Type', 'application/json');
      if (session) headers.set('Authorization', `Bearer ${session.token}`);
      const response = await fetch(endpoint, {
        method,
        headers,
        cache: 'no-store',
        redirect: 'error',
        ...(method !== 'DELETE' && { body: JSON.stringify({ application, pageId }) }),
      });
      if (response.status === 410 && session) {
        setSession(null);
        setNotice('此预览链接已失效，请重新创建。');
        return;
      }
      if (!response.ok) throw new Error();
      if (method === 'DELETE') {
        setSession(null);
        setNotice('预览链接已撤销。');
        return;
      }

      const metadata = readSession(await response.json());
      const qrDataUrl = session?.url === metadata.url ? session.qrDataUrl : undefined;
      setSession({ ...metadata, qrDataUrl });
      if (method === 'PUT') setNotice('快照已更新，请在手机上刷新预览。');
      if (!qrDataUrl) {
        try {
          const { toDataURL } = await import('qrcode');
          const dataUrl = await toDataURL(metadata.url, { width: 240 });
          setSession((current) =>
            current?.token === metadata.token ? { ...current, qrDataUrl: dataUrl } : current,
          );
        } catch {
          setError('二维码生成失败，可复制预览链接使用。');
        }
      }
    } catch {
      const operation = { POST: '创建预览二维码', PUT: '更新快照', DELETE: '撤销预览' }[method];
      setError(`${operation}失败，请检查预览服务后重试。`);
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!session || !linkInput.current) return;
    const input = linkInput.current;
    try {
      await navigator.clipboard.writeText(session.url);
    } catch {
      // 局域网 HTTP 地址通常不支持现代剪贴板 API。
      input.focus();
      input.select();
      if (!document.execCommand?.('copy')) {
        setError('无法自动复制，请手动复制已选中的链接。');
        setNotice('');
        return;
      }
    }
    setNotice('预览链接已复制。');
    setError('');
  };

  const retryAvailability = () => {
    setAvailability('checking');
    setAvailabilityAttempt((value) => value + 1);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setAvailability('checking');
        setOpen(next);
      }}
    >
      <Dialog.Trigger
        render={<Button className="app-header-nav-button" aria-label="手机扫码预览" />}
      >
        <QrCode size={14} aria-hidden="true" />
        <span>扫码预览</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="material-modal-backdrop" />
        <Dialog.Popup className="material-modal mobile-preview-dialog">
          <header>
            <div>
              <Dialog.Title>手机扫码预览</Dialog.Title>
              <Dialog.Description>生成当前应用的只读快照，从手机打开当前页面。</Dialog.Description>
            </div>
            <Dialog.Close render={<Button variant="ghost" aria-label="关闭手机预览" />}>
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <div className="material-modal-body mobile-preview-body">
            <div className="mobile-preview-lan-note">
              <strong>请让手机和电脑连接到同一可信局域网。</strong>
              <span>
                预览服务默认未启用。运行 <code>npm run build</code> 后执行{' '}
                <code>npm run preview:lan</code>，并在这台电脑上打开终端提示的地址。
              </span>
            </div>

            {session ? (
              <section className="mobile-preview-session" aria-label="当前预览会话">
                {session.qrDataUrl ? (
                  <img src={session.qrDataUrl} alt="手机扫码打开预览链接" />
                ) : (
                  <div className="mobile-preview-qr-placeholder" role="status">
                    {busy ? '正在生成二维码…' : '二维码暂不可用，请复制链接'}
                  </div>
                )}
                <time
                  className="mobile-preview-expiry"
                  dateTime={new Date(session.expiresAt).toISOString()}
                >
                  有效至 {new Date(session.expiresAt).toLocaleString('zh-CN')}
                </time>
                <Input
                  ref={linkInput}
                  className="mobile-preview-link"
                  aria-label="手机预览链接"
                  value={session.url}
                  readOnly
                />
                <div className="mobile-preview-session-actions">
                  <Button onClick={() => void copyLink()} disabled={busy !== null}>
                    <Copy size={13} aria-hidden="true" />
                    复制链接
                  </Button>
                  <Button onClick={() => void managePreview('PUT')} disabled={busy !== null}>
                    <RefreshCw size={13} aria-hidden="true" />
                    {busy === 'PUT' ? '正在更新…' : '更新快照'}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => void managePreview('DELETE')}
                    disabled={busy !== null}
                  >
                    {busy === 'DELETE' ? '正在撤销…' : '撤销预览'}
                  </Button>
                </div>
                <p className="mobile-preview-expiry">
                  编辑改动不会自动同步。扫码链接可访问应用快照，请勿公开分享。
                </p>
              </section>
            ) : (
              <div className="mobile-preview-empty">
                {availability === 'ready' ? (
                  <Button
                    variant="primary"
                    onClick={() => void managePreview('POST')}
                    disabled={busy !== null}
                  >
                    <QrCode size={14} aria-hidden="true" />
                    {busy === 'POST' ? '正在创建…' : '创建预览二维码'}
                  </Button>
                ) : (
                  <>
                    <p className="editor-note" role="status">
                      {availability === 'checking'
                        ? '正在检查预览服务…'
                        : availability === 'remote'
                          ? '请在启动局域网预览服务的电脑上创建二维码。'
                          : '当前工作台未连接局域网预览服务。'}
                    </p>
                    {availability === 'unavailable' && (
                      <Button onClick={retryAvailability}>重新检查</Button>
                    )}
                  </>
                )}
              </div>
            )}
            {error && (
              <p className="mobile-preview-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="mobile-preview-expiry" role="status">
                {notice}
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
