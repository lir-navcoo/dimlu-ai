import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationRuntimeHost } from '../src/ApplicationRuntimeHost';
import { PageRuntime, compileApplication } from '../packages/runtime/engine';
import type { ApplicationSchema, Value } from '../packages/schema/types';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';
import { applicationRoutePath } from '../packages/runtime/router';

const plan = compileApplication(exampleApplication, registry);
const literal = (value: string | number): Value => ({ kind: 'literal', value });

function notificationApplication(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'notification-app',
    title: '通知应用',
    entryPageId: 'home',
    dependencies: {
      components: { 'ui.button': registry.components['ui.button'].version },
      actions: { 'ui.notify': registry.actions['ui.notify'].version },
    },
    pages: [
      {
        id: 'home',
        title: '首页',
        state: [],
        onEnter: [
          {
            id: 'welcome',
            action: 'ui.notify',
            input: { title: literal('欢迎访问'), timeout: literal(0) },
          },
        ],
        children: [
          {
            id: 'notify',
            component: 'ui.button',
            props: { label: literal('发送通知') },
            on: {
              onClick: [
                {
                  id: 'notify-click',
                  action: 'ui.notify',
                  input: {
                    title: literal('操作成功'),
                    description: literal('通知内容'),
                    tone: literal('success'),
                    timeout: literal(0),
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

  it.each([false, true])(
    'shows entry and interaction notifications in mobile preview=%s',
    async (mobilePreview) => {
      const notificationPlan = compileApplication(notificationApplication(), registry);
      const enter = vi.spyOn(PageRuntime.prototype, 'enter');
      window.history.replaceState(
        {},
        '',
        mobilePreview
          ? '/mobile-preview#test-token'
          : applicationRoutePath(notificationPlan.schema.id),
      );
      render(
        <StrictMode>
          <ApplicationRuntimeHost
            plan={notificationPlan}
            previewPageId={mobilePreview ? notificationPlan.schema.entryPageId : undefined}
          />
        </StrictMode>,
      );
      expect(await screen.findAllByText('欢迎访问')).toHaveLength(1);
      expect(enter).toHaveBeenCalledOnce();

      fireEvent.click(screen.getByRole('button', { name: '发送通知' }));
      expect(await screen.findAllByText('操作成功')).toHaveLength(1);
      expect(screen.getByText('通知内容')).toBeTruthy();
    },
  );

  it('resolves the current location immediately when the application plan changes', () => {
    window.history.replaceState({}, '', applicationRoutePath(plan.schema.id));
    const view = render(<ApplicationRuntimeHost plan={plan} />);

    const next = notificationApplication();
    delete next.pages[0].onEnter;
    const nextPlan = compileApplication(next, registry);
    window.history.replaceState({}, '', applicationRoutePath(next.id));
    view.rerender(<ApplicationRuntimeHost plan={nextPlan} />);

    expect(screen.getByText(next.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: '发送通知' })).toBeTruthy();
  });

  it('rebuilds the runtime when an updated plan has the same application and page IDs', () => {
    const schema = notificationApplication();
    delete schema.pages[0].onEnter;
    window.history.replaceState({}, '', applicationRoutePath(schema.id));
    const view = render(<ApplicationRuntimeHost plan={compileApplication(schema, registry)} />);
    expect(screen.getByRole('button', { name: '发送通知' })).toBeTruthy();

    schema.pages[0].children[0].props.label = literal('新版本按钮');
    view.rerender(<ApplicationRuntimeHost plan={compileApplication(schema, registry)} />);

    expect(screen.getByRole('button', { name: '新版本按钮' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '发送通知' })).toBeNull();
  });

  it('shows a recoverable message when an application is not loaded', () => {
    window.history.replaceState({}, '', '/apps/not-loaded');
    render(<ApplicationRuntimeHost plan={plan} />);
    expect(screen.getByRole('heading', { name: '无法打开应用页面' })).toBeTruthy();
    expect(screen.getByText('应用不存在或当前尚未加载该应用。')).toBeTruthy();
  });
});
