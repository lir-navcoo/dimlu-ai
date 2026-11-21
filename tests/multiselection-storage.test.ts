import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { ProjectStorage, PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { refreshEditorDocument } from '../src/editor/refresh-document';
import { selectionApplication, selectionRegistry } from './multiselection-fixture';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('multi-selection stays transient across storage and reconstructed HMR', () => {
  it('saves only explicit primary fields under unchanged storageVersion1', () => {
    vi.useFakeTimers();
    const registry = selectionRegistry(),
      schema = selectionApplication(),
      data = new Map<string, string>([
        [PROJECT_STORAGE_KEY, JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema })],
      ]),
      write = vi.fn((key: string, value: string) => data.set(key, value)),
      adapter = { getItem: (key: string) => data.get(key) ?? null, setItem: write },
      storage = new ProjectStorage(adapter, registry, schema, { debounceMs: 1 });
    storage.start();
    try {
      const doc = storage.getSnapshot().document;
      doc.selectMany('a', ['alpha', 'header', 'tail'], 'header');
      vi.advanceTimersByTime(1);
      expect(write).toHaveBeenCalledTimes(1);
      const saved = JSON.parse(data.get(PROJECT_STORAGE_KEY)!);
      expect(saved.storageVersion).toBe(1);
      expect(saved.selection).toEqual({ pageId: 'a', nodeId: 'header' });
      expect(saved.selection).not.toHaveProperty('nodeIds');
      expect(doc.getSnapshot().selection.nodeIds).toEqual(['alpha', 'header', 'tail']);
      const restored = new ProjectStorage(adapter, registry, schema);
      expect(restored.getSnapshot().document.getSnapshot().selection).toEqual({
        pageId: 'a',
        nodeId: 'header',
      });
      expect(restored.getSnapshot().document.getSnapshot().canUndo).toBe(false);
    } finally {
      storage.stop();
    }
  });
  it('ignores extra stored nodeIds and restores only a valid primary', () => {
    const registry = selectionRegistry(),
      schema = selectionApplication(),
      raw = JSON.stringify({
        storageVersion: 1,
        savedAt: 'fixture',
        schema,
        selection: { pageId: 'a', nodeId: 'tail', nodeIds: ['alpha', 'tail'] },
      }),
      storage = new ProjectStorage({ getItem: () => raw, setItem: vi.fn() }, registry, schema);
    expect(storage.getSnapshot().document.getSnapshot().selection).toEqual({
      pageId: 'a',
      nodeId: 'tail',
    });
  });
  it.each(['registry', 'retained-class'] as const)(
    'actual reconstructed HMR %s reduces to valid primary and keeps Schema',
    (kind) => {
      const registry = selectionRegistry(),
        schema = selectionApplication();
      class OldDocument extends EditorDocument {}
      const previous =
        kind === 'retained-class'
          ? new OldDocument(schema, registry)
          : new EditorDocument(schema, registry);
      previous.selectMany('a', ['alpha', 'header', 'tail'], 'header');
      const next = refreshEditorDocument(
        previous,
        kind === 'registry' ? selectionRegistry() : registry,
      );
      expect(next).not.toBe(previous);
      expect(next.exportJson()).toBe(previous.exportJson());
      expect(next.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'header' });
      expect(previous.getSnapshot().selection.nodeIds).toHaveLength(3);
    },
  );
  it('same-class same-registry refresh fast path retains exact live multi-selection', () => {
    const registry = selectionRegistry(),
      document = new EditorDocument(selectionApplication(), registry);
    document.selectMany('a', ['alpha', 'tail'], 'tail');
    const before = document.getSnapshot();
    expect(refreshEditorDocument(document, registry)).toBe(document);
    expect(document.getSnapshot()).toBe(before);
  });
  it('ordinary application export contains no selection or transient nodeIds', () => {
    const document = new EditorDocument(selectionApplication(), selectionRegistry());
    document.selectMany('a', ['alpha', 'tail']);
    const exported = JSON.parse(document.exportJson());
    expect(exported).not.toHaveProperty('selection');
    expect(JSON.stringify(exported)).not.toContain('nodeIds');
  });
});
