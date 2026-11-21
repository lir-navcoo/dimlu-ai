import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  editorPagesPath,
  editorApplicationPath,
  editorRoutePath,
  isEditorPagesLocation,
  isEditorApplicationLocation,
  parseEditorLocation,
  writeEditorRoute,
} from '../src/editor/router';

describe('editor router', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/editor');
  });

  it('uses structure on the editor root', () => {
    expect(parseEditorLocation(window.location)).toEqual({ panel: 'structure' });
  });

  it('recognizes the standalone page-management route', () => {
    expect(editorPagesPath()).toBe('/editor/pages');
    expect(isEditorPagesLocation({ pathname: '/editor/pages' })).toBe(true);
    expect(isEditorPagesLocation({ pathname: '/editor/page/orders' })).toBe(false);
  });

  it('recognizes the application-level settings route separately from page management', () => {
    expect(editorApplicationPath()).toBe('/editor/application');
    expect(isEditorApplicationLocation({ pathname: '/editor/application' })).toBe(true);
    expect(isEditorApplicationLocation({ pathname: '/editor/pages' })).toBe(false);
  });

  it('parses a page and panel', () => {
    window.history.replaceState({}, '', '/editor/page/orders?panel=data');
    expect(parseEditorLocation(window.location)).toEqual({ pageId: 'orders', panel: 'data' });
  });

  it('retains a direct component library link', () => {
    window.history.replaceState({}, '', editorRoutePath('orders', 'materials'));
    expect(parseEditorLocation(window.location)).toEqual({ pageId: 'orders', panel: 'materials' });
  });

  it('round trips the page logic panel', () => {
    const path = editorRoutePath('orders', 'logic');
    expect(path).toBe('/editor/page/orders?panel=logic');
    window.history.replaceState({}, '', path);
    expect(parseEditorLocation(window.location)).toEqual({ pageId: 'orders', panel: 'logic' });
  });

  it('falls back to structure for an unknown panel', () => {
    window.history.replaceState({}, '', '/editor/page/orders?panel=unknown');
    expect(parseEditorLocation(window.location)).toEqual({
      pageId: 'orders',
      panel: 'structure',
    });
  });

  it('round trips page IDs containing slashes', () => {
    const path = editorRoutePath('page/detail', 'code');
    expect(path).toBe('/editor/page/page%2Fdetail?panel=code');
    window.history.replaceState({}, '', path);
    expect(parseEditorLocation(window.location)).toEqual({
      pageId: 'page/detail',
      panel: 'code',
    });
  });

  it('writes push and replace history entries', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    writeEditorRoute('orders', 'materials');
    writeEditorRoute('orders', 'code', true);
    expect(push).toHaveBeenCalledWith({}, '', '/editor/page/orders?panel=materials');
    expect(replace).toHaveBeenCalledWith({}, '', '/editor/page/orders?panel=code');
  });

  it('does not write the same URL twice', () => {
    window.history.replaceState({}, '', '/editor/page/orders');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    writeEditorRoute('orders', 'structure');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
