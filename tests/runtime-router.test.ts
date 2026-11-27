import { describe, expect, it } from 'vitest';
import { compileApplication } from '../packages/runtime/engine';
import { applicationRoutePath, resolveApplicationRoute } from '../packages/runtime/router';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';

const plan = compileApplication(exampleApplication, registry);

describe('application runtime routes', () => {
  it('builds application entry and explicit page routes with encoded identities', () => {
    expect(applicationRoutePath(plan.schema.id)).toBe(`/apps/${plan.schema.id}`);
    expect(applicationRoutePath('my/app', 'page detail')).toBe(
      '/apps/my%2Fapp/pages/page%20detail',
    );
  });

  it('resolves the application route to its entry page and explicit page route', () => {
    expect(
      resolveApplicationRoute({ pathname: applicationRoutePath(plan.schema.id) }, plan),
    ).toEqual({ kind: 'page', appId: plan.schema.id, pageId: plan.schema.entryPageId });
    const pageId = plan.schema.pages.find((page) => page.id !== plan.schema.entryPageId)!.id;
    expect(
      resolveApplicationRoute({ pathname: applicationRoutePath(plan.schema.id, pageId) }, plan),
    ).toEqual({ kind: 'page', appId: plan.schema.id, pageId });
  });

  it('keeps unknown and malformed paths explicit instead of silently falling back', () => {
    expect(resolveApplicationRoute({ pathname: '/apps' }, plan)).toEqual({
      kind: 'invalid',
      reason: 'malformed',
    });
    expect(resolveApplicationRoute({ pathname: '/apps/other' }, plan)).toEqual({
      kind: 'invalid',
      reason: 'unknown-application',
    });
    expect(
      resolveApplicationRoute({ pathname: applicationRoutePath(plan.schema.id, 'missing') }, plan),
    ).toEqual({ kind: 'invalid', reason: 'unknown-page' });
    expect(resolveApplicationRoute({ pathname: '/apps/%E0%A4%A' }, plan)).toEqual({
      kind: 'invalid',
      reason: 'malformed',
    });
    expect(resolveApplicationRoute({ pathname: '/editor/pages' }, plan)).toEqual({
      kind: 'outside',
    });
  });
});
