import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ApplicationPlan } from '../packages/runtime/engine';
import { PageRuntime as Runtime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { CodePageCanvas } from './code/CodePage';
import { materials } from './materials';
import { Button } from './ui/primitives';
import {
  applicationRoutePath,
  resolveApplicationRoute,
  type ApplicationRoute,
} from '../packages/runtime/router';
import './application-runtime.css';

function readRoute(plan: ApplicationPlan): ApplicationRoute {
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
  const [runtime] = useState(() => new Runtime(plan, pageId));
  useEffect(() => {
    const unsubscribe = runtime.subscribeEffects((effect) => {
      if (effect.type === 'app.navigate' && typeof effect.data.pageId === 'string')
        onNavigate(effect.data.pageId, effect.data.replace === true);
    });
    void runtime.enter();
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  }, [runtime, onNavigate]);
  const page = runtime.page.schema;
  return (
    <RuntimeRenderer runtime={runtime} materials={materials}>
      {page.code?.enabled ? (
        <CodePageCanvas code={page.code} runtime={runtime} mode="preview" openCode={() => {}} />
      ) : undefined}
    </RuntimeRenderer>
  );
}

export function ApplicationRuntimeHost({
  plan,
  onEditApplication,
}: {
  plan: ApplicationPlan;
  onEditApplication?: (appId: string, pageId: string) => void;
}) {
  const [route, setRoute] = useState(() => readRoute(plan));
  useEffect(() => {
    const update = () => setRoute(readRoute(plan));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [plan]);
  const navigate = useCallback(
    (pageId: string, replace = false) => {
      if (!plan.pages.has(pageId)) return;
      const method = replace ? 'replaceState' : 'pushState';
      window.history[method]({}, '', applicationRoutePath(plan.schema.id, pageId));
      setRoute(readRoute(plan));
    },
    [plan],
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
        <Button onClick={() => window.location.assign('/editor')}>返回搭建工作台</Button>
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
      </header>
      <section className="application-runtime-page" key={`${route.appId}/${route.pageId}`}>
        <RuntimePage plan={plan} pageId={route.pageId} onNavigate={navigate} />
      </section>
    </main>
  );
}
