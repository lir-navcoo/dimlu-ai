import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationRuntimeHost } from '../src/ApplicationRuntimeHost';
import { compileApplication } from '../packages/runtime/engine';
import { validateApplication } from '../packages/schema/validate';
import type { ApplicationSchema, Value } from '../packages/schema/types';
import { registry } from '../src/materials';
import { applicationRoutePath } from '../packages/runtime/router';

const literal = (value: string): Value => ({ kind: 'literal', value });
const navigationApplication = (target = 'details'): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'navigation-test-app',
  title: '导航测试应用',
  entryPageId: 'home',
  dependencies: {
    components: {
      'ui.button': registry.components['ui.button'].version,
      'ui.text': registry.components['ui.text'].version,
    },
    actions: { 'ui.notify': registry.actions['ui.notify'].version },
  },
  pages: [
    {
      id: 'home',
      title: '首页',
      state: [],
      children: [
        {
          id: 'go-details',
          component: 'ui.button',
          props: { label: literal('查看详情'), type: literal('button') },
          on: {
            onClick: [
              {
                id: 'navigate-details',
                action: 'app.navigate',
                input: { pageId: literal(target) },
              },
            ],
          },
        },
      ],
    },
    {
      id: 'details',
      title: '详情页',
      state: [],
      children: [
        {
          id: 'details-label',
          component: 'ui.text',
          props: { value: literal('已到达详情页') },
        },
      ],
    },
  ],
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/editor');
});

describe('application page navigation action', () => {
  it('navigates from a page event and updates the browser route', async () => {
    const plan = compileApplication(navigationApplication(), registry);
    window.history.replaceState({}, '', applicationRoutePath(plan.schema.id));
    render(<ApplicationRuntimeHost plan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
    await waitFor(() =>
      expect(window.location.pathname).toBe(applicationRoutePath(plan.schema.id, 'details')),
    );
    expect(await screen.findByText('已到达详情页')).toBeTruthy();
    expect(
      (screen.getByRole('combobox', { name: '切换应用页面' }) as HTMLSelectElement).value,
    ).toBe('details');
    window.history.back();
    await waitFor(() =>
      expect(window.location.pathname).toBe(applicationRoutePath(plan.schema.id)),
    );
    expect(await screen.findByRole('button', { name: '查看详情' })).toBeTruthy();
    window.history.forward();
    await waitFor(() =>
      expect(window.location.pathname).toBe(applicationRoutePath(plan.schema.id, 'details')),
    );
  });

  it('navigates during page entry and can replace the current route', async () => {
    const schema = navigationApplication();
    schema.pages[0].onEnter = [
      {
        id: 'enter-details',
        action: 'app.navigate',
        input: { pageId: literal('details'), replace: { kind: 'literal', value: true } },
      },
    ];
    const plan = compileApplication(schema, registry);
    window.history.replaceState({}, '', applicationRoutePath(plan.schema.id));
    render(<ApplicationRuntimeHost plan={plan} />);
    await waitFor(() =>
      expect(window.location.pathname).toBe(applicationRoutePath(plan.schema.id, 'details')),
    );
    expect(await screen.findByText('已到达详情页')).toBeTruthy();
  });

  it('accepts didMount/willUnmount aliases and normalizes them to onEnter/onLeave', async () => {
    const schema = navigationApplication();
    schema.pages[0].didMount = [
      {
        id: 'enter-details',
        action: 'app.navigate',
        input: { pageId: literal('details'), replace: { kind: 'literal', value: true } },
      },
    ];
    const leaveCall = {
      id: 'leave-notice',
      action: 'ui.notify',
      input: { title: literal('离开详情页'), tone: literal('info') },
    };
    schema.pages[1].willUnmount = [leaveCall];
    // Alias and canonical name must not coexist on the same page.
    schema.pages[1].onLeave = [leaveCall];
    const issues = validateApplication(schema, registry);
    expect(issues.some((issue) => issue.code === 'page.lifecycle.alias')).toBe(true);
    delete schema.pages[1].onLeave;

    const plan = compileApplication(schema, registry);
    const home = plan.pages.get('home')!;
    expect(home.schema.onEnter).toHaveLength(1);
    expect(home.schema.didMount).toBeUndefined();
    expect(plan.pages.get('details')!.schema.onLeave).toEqual([leaveCall]);
    expect(plan.pages.get('details')!.schema.willUnmount).toBeUndefined();
    window.history.replaceState({}, '', applicationRoutePath(plan.schema.id));
    render(<ApplicationRuntimeHost plan={plan} />);
    await waitFor(() =>
      expect(window.location.pathname).toBe(applicationRoutePath(plan.schema.id, 'details')),
    );
    expect(await screen.findByText('已到达详情页')).toBeTruthy();
  });

  it('rejects a literal target that is not an application page', () => {
    expect(
      validateApplication(navigationApplication('missing'), registry).some(
        (issue) => issue.code === 'page.missing',
      ),
    ).toBe(true);
  });
});
