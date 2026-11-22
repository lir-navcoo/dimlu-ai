import { useEffect, useState } from 'react';
import { compileApplication, type ApplicationPlan } from '../packages/runtime/engine';
import { ApplicationRuntimeHost } from './ApplicationRuntimeHost';
import { registry } from './materials';
import { Button, TipProvider } from './ui/primitives';

const endpoint = '/api/mobile-preview/snapshot';
const refreshIntervalMs = 15_000;

type PreviewState =
  | { kind: 'loading' | 'expired' | 'unavailable' | 'invalid-link' | 'invalid-snapshot' }
  | { kind: 'ready'; plan: ApplicationPlan; pageId: string };

const messages = {
  loading: '正在加载预览…',
  expired: '预览已过期或已被撤销，请重新扫码。',
  unavailable: '暂时无法连接预览服务。请确认手机与电脑处于同一局域网，且电脑上的预览服务仍在运行。',
  'invalid-link': '此预览链接无效，请从搭建工作台重新扫码。',
  'invalid-snapshot': '此预览的应用定义无法运行，请在工作台更新快照后重试。',
};

function viewerToken() {
  const token = window.location.hash.slice(1);
  return /^[a-zA-Z0-9_-]{32,128}$/.test(token) ? token : null;
}

export default function MobilePreview() {
  const [token, setToken] = useState(viewerToken);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  useEffect(() => {
    const updateToken = () => setToken(viewerToken());
    window.addEventListener('hashchange', updateToken);
    return () => window.removeEventListener('hashchange', updateToken);
  }, []);

  useEffect(() => {
    if (!token) {
      setState({ kind: 'invalid-link' });
      return;
    }
    const controller = new AbortController();
    const options: RequestInit = {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    };
    let timer: number | undefined;
    const set = (next: PreviewState) => {
      if (!controller.signal.aborted) setState(next);
    };
    function statusFailure(response: Response): PreviewState {
      if (response.status === 410 || response.status === 401 || response.status === 403)
        return { kind: 'expired' };
      return { kind: 'unavailable' };
    }
    async function checkSession() {
      try {
        const response = await fetch(endpoint, { ...options, method: 'HEAD' });
        if (response.status !== 204) {
          set(statusFailure(response));
          return;
        }
        if (!controller.signal.aborted) timer = window.setTimeout(checkSession, refreshIntervalMs);
      } catch {
        set({ kind: 'unavailable' });
      }
    }
    async function load() {
      set({ kind: 'loading' });
      try {
        const response = await fetch(endpoint, options);
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          set(statusFailure(response));
          return;
        }
        try {
          const payload = await response.json();
          const plan = compileApplication(payload.application, registry);
          const pageId: unknown = payload.pageId;
          if (typeof pageId !== 'string' || !plan.pages.has(pageId)) {
            set({ kind: 'invalid-snapshot' });
            return;
          }
          set({ kind: 'ready', plan, pageId });
          if (!controller.signal.aborted)
            timer = window.setTimeout(checkSession, refreshIntervalMs);
        } catch {
          set({ kind: 'invalid-snapshot' });
        }
      } catch {
        set({ kind: 'unavailable' });
      }
    }
    void load();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [token, attempt]);

  if (state.kind === 'ready') {
    return (
      <TipProvider delay={350}>
        <ApplicationRuntimeHost plan={state.plan} previewPageId={state.pageId} />
      </TipProvider>
    );
  }
  return (
    <main
      className="application-runtime-error"
      role={state.kind === 'loading' ? 'status' : 'alert'}
    >
      <h1>手机预览</h1>
      <p>{messages[state.kind]}</p>
      {(state.kind === 'unavailable' || state.kind === 'invalid-snapshot') && (
        <Button onClick={() => setAttempt((value) => value + 1)}>重试</Button>
      )}
    </main>
  );
}
