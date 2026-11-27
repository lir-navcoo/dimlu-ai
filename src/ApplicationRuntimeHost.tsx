import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ApplicationPlan } from '../packages/runtime/engine';
import { PageRuntime as Runtime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { CodePageCanvas } from './code/CodePage';
import { materials } from './materials';
import { MaterialEffects } from './materials/feedback';
import { Button, TipProvider } from './ui/primitives';
import {
  applicationRoutePath,
  resolveApplicationRoute,
  type ApplicationRoute,
} from '../packages/runtime/router';
import './application-runtime.css';

function readRoute(plan: ApplicationPlan, previewPageId?: string): ApplicationRoute {
  if (previewPageId !== undefined) {
    const pageId = new URLSearchParams(window.location.search).get('page') || previewPageId;
    return plan.pages.has(pageId)
      ? { kind: 'page', appId: plan.schema.id, pageId }
      : { kind: 'invalid', reason: 'unknown-page' };
  }
  return resolveApplicationRoute(window.location, plan);
}

function RuntimePage({
  plan,
  pageId,
  onNavigate,
}: {
  plan: ApplicationPlan;
  pageId: string;
  onNavigate: (pageId: string, replace: boolean) => void;
}) {
  const [runtime, setRuntime] = useState(() => new Runtime(plan, pageId));
  if (runtime.plan !== plan) setRuntime(new Runtime(plan, pageId));
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  useEffect(() => {
    if (runtime.disposed) {
      setRuntime(new Runtime(plan, pageId));
      return;
    }
    const unsubscribe = runtime.subscribeEffects((effect) => {
      if (effect.type === 'app.navigate' && typeof effect.data.pageId === 'string')
        navigateRef.current(effect.data.pageId, effect.data.replace === true);
    });
    let lifecycle: 'pending' | 'entered' | 'cancelled' = 'pending';
    // 等通知视口订阅完成。StrictMode 的首次清理也会在进入动作前取消这次启动。
    queueMicrotask(() => {
      if (lifecycle !== 'pending') return;
      lifecycle = 'entered';
      void runtime.enter();
    });
    return () => {
      unsubscribe();
      // 离开动作需要运行时仍可用。没有离开动作时立即销毁，以保留焦点间隙行为。
      if (lifecycle === 'entered' && runtime.willRunLeaveActions())
        void runtime.leave().finally(() => runtime.dispose());
      else runtime.dispose();
      lifecycle = 'cancelled';
    };
  }, [runtime, plan, pageId]);
  const page = runtime.page.schema;
  return (
    <TipProvider key={runtime.instanceId} delay={350}>
      <MaterialEffects runtime={runtime} />
      <RuntimeRenderer runtime={runtime} materials={materials}>
        {page.code?.enabled ? (
          <CodePageCanvas code={page.code} runtime={runtime} mode="preview" />
        ) : undefined}
      </RuntimeRenderer>
    </TipProvider>
  );
}

export function ApplicationRuntimeHost({
  plan,
  onEditApplication,
  previewPageId,
}: {
  plan: ApplicationPlan;
  onEditApplication?: (appId: string, pageId: string) => void;
  previewPageId?: string;
}) {
  const isMobilePreview = previewPageId !== undefined;
  const [, updateRoute] = useReducer((revision: number) => revision + 1, 0);
  const route = readRoute(plan, previewPageId);
  useEffect(() => {
    window.addEventListener('popstate', updateRoute);
    return () => window.removeEventListener('popstate', updateRoute);
  }, []);
  const navigate = useCallback(
    (pageId: string, replace = false) => {
      if (!plan.pages.has(pageId)) return;
      const method = replace ? 'replaceState' : 'pushState';
      let path = applicationRoutePath(plan.schema.id, pageId);
      if (isMobilePreview) {
        const url = new URL(window.location.href);
        url.searchParams.set('page', pageId);
        path = `${url.pathname}${url.search}${url.hash}`;
      }
      window.history[method]({}, '', path);
      updateRoute();
    },
    [plan, isMobilePreview],
  );
  if (route.kind !== 'page')
    return (
      <main className="application-runtime-error" role="alert">
        <h1>无法打开应用页面</h1>
        <p>
          {route.kind === 'outside'
            ? '当前地址不是应用运行页面。'
            : route.reason === 'unknown-application'
              ? '应用不存在或当前尚未加载该应用。'
              : route.reason === 'unknown-page'
                ? '页面不存在或已被删除。'
                : '应用页面地址格式无效。'}
        </p>
        {isMobilePreview ? (
          <Button onClick={() => navigate(previewPageId, true)}>返回预览起始页</Button>
        ) : (
          <Button onClick={() => window.location.assign('/editor')}>返回搭建工作台</Button>
        )}
      </main>
    );
  const title = plan.schema.title;
  const pages = plan.schema.pages;
  return (
    <main className="application-runtime">
      <header className="application-runtime-header">
        <strong>{title}</strong>
        <label>
          <span className="sr-only">切换应用页面</span>
          <select value={route.pageId} onChange={(event) => navigate(event.target.value)}>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        </label>
        {!isMobilePreview && (
          <Button
            variant="ghost"
            onClick={() =>
              onEditApplication
                ? onEditApplication(plan.schema.id, route.pageId)
                : window.location.assign('/editor')
            }
          >
            <ArrowLeft size={15} />
            编辑应用
          </Button>
        )}
      </header>
      <section className="application-runtime-page" key={`${route.appId}/${route.pageId}`}>
        <RuntimePage plan={plan} pageId={route.pageId} onNavigate={navigate} />
      </section>
    </main>
  );
}
