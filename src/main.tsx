import { lazy, StrictMode, Suspense } from 'react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './materials/materials.css';

function showStartupFailure(error: unknown) {
  const shell = document.getElementById('startup-status');
  if (!shell) return;
  const title = shell.querySelector<HTMLElement>('#startup-title');
  const message = shell.querySelector<HTMLElement>('#startup-message');
  const details = shell.querySelector<HTMLElement>('#startup-details');
  const retry = shell.querySelector<HTMLButtonElement>('#startup-retry');
  if (!title || !message || !details || !retry) return;
  shell.hidden = false;
  shell.setAttribute('role', 'alert');
  title.textContent = '应用启动失败';
  message.textContent = '界面未能正常启动。请重试；本地项目数据保持不变。';
  details.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  details.hidden = false;
  retry.hidden = false;
}

class StartupBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    showStartupFailure(error);
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

const MobilePreview = lazy(() => import('./MobilePreview'));
const isMobilePreview = /^\/mobile-preview\/?$/.test(window.location.pathname);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StartupBoundary>
      {isMobilePreview ? (
        <Suspense fallback={<p role="status">正在加载手机预览…</p>}>
          <MobilePreview />
        </Suspense>
      ) : (
        <App />
      )}
    </StartupBoundary>
  </StrictMode>,
);
