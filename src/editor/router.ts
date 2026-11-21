import { editorPanelRoute, type EditorPanelId } from './panel-routes';

export type EditorRoute = {
  pageId?: string;
  panel: EditorPanelId;
};

const editorRoot = '/editor';

function decodePageId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export function editorRoutePath(pageId: string, panel: EditorPanelId) {
  const path = `${editorRoot}/page/${encodeURIComponent(pageId)}`;
  return panel === 'structure' ? path : `${path}?panel=${encodeURIComponent(panel)}`;
}

export function parseEditorLocation(location: Location): EditorRoute {
  const match = location.pathname.match(/^\/editor\/page\/(.+)$/);
  const pageId = match ? decodePageId(match[1]) : undefined;
  const panel = location.search
    ? (new URLSearchParams(location.search).get('panel') ?? 'structure')
    : 'structure';
  return {
    pageId,
    panel: panel === 'materials' ? panel : (editorPanelRoute(panel)?.id ?? 'structure'),
  };
}

export function writeEditorRoute(pageId: string, panel: EditorPanelId, replace = false) {
  const next = editorRoutePath(pageId, panel);
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === next) return;
  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({}, '', next);
}

export function editorRootPath() {
  return editorRoot;
}

export function editorPagesPath() {
  return `${editorRoot}/pages`;
}

export function editorApplicationsPath() {
  return `${editorRoot}/apps`;
}

export function editorApplicationPath() {
  return `${editorRoot}/application`;
}

export function isEditorPagesLocation(location: Pick<Location, 'pathname'>) {
  return location.pathname === editorPagesPath();
}

export function isEditorApplicationLocation(location: Pick<Location, 'pathname'>) {
  return location.pathname === editorApplicationPath();
}

export function isEditorLocation(location: Pick<Location, 'pathname'>) {
  return location.pathname === editorRoot || location.pathname.startsWith(`${editorRoot}/page/`);
}
