import type { ApplicationPlan } from './engine';

const applicationRoot = '/apps';

export type ApplicationRoute =
  | { kind: 'outside' }
  | { kind: 'invalid'; reason: 'malformed' | 'unknown-application' | 'unknown-page' }
  | { kind: 'page'; appId: string; pageId: string };

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function applicationIdFromLocation(location: Pick<Location, 'pathname'>): string | null {
  if (!location.pathname.startsWith(`${applicationRoot}/`)) return null;
  const match = location.pathname.match(/^\/apps\/([^/]+)/);
  return match ? decodeSegment(match[1]) : null;
}

export function applicationRoutePath(appId: string, pageId?: string): string {
  const root = `${applicationRoot}/${encodeURIComponent(appId)}`;
  return pageId === undefined ? root : `${root}/pages/${encodeURIComponent(pageId)}`;
}

export function resolveApplicationRoute(
  location: Pick<Location, 'pathname'>,
  plan: ApplicationPlan,
): ApplicationRoute {
  if (location.pathname === applicationRoot) return { kind: 'invalid', reason: 'malformed' };
  if (!location.pathname.startsWith(`${applicationRoot}/`)) return { kind: 'outside' };
  const match = location.pathname.match(/^\/apps\/([^/]+)(?:\/pages\/([^/]+))?\/?$/);
  if (!match) return { kind: 'invalid', reason: 'malformed' };

  const appId = decodeSegment(match[1]);
  const requestedPageId = match[2] === undefined ? undefined : decodeSegment(match[2]);
  if (appId === null || (match[2] !== undefined && requestedPageId === null))
    return { kind: 'invalid', reason: 'malformed' };
  if (appId !== plan.schema.id) return { kind: 'invalid', reason: 'unknown-application' };

  const pageId = requestedPageId ?? plan.schema.entryPageId;
  if (!plan.pages.has(pageId)) return { kind: 'invalid', reason: 'unknown-page' };
  return { kind: 'page', appId, pageId };
}
