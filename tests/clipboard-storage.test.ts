import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { ProjectStorage, PROJECT_STORAGE_KEY } from '../packages/editor/project-storage';
import { PageRuntime } from '../packages/runtime/engine';
import { refreshEditorDocument } from '../src/editor/refresh-document';
import { clipboardApplication, fixtureRegistry } from './clipboard-fixture';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe('clipboard remains outside persistence and runtime', () => {
  it.each(['registry', 'retained-class'] as const)(
    'actual HMR refresh %s creates an empty clipboard and preserves authored Schema/selection',
    (kind) => {
      const registry = fixtureRegistry(),
        schema = clipboardApplication();
      class PreviousDocument extends EditorDocument {}
      const previous =
        kind === 'retained-class'
          ? new PreviousDocument(schema, registry)
          : new EditorDocument(schema, registry);
      previous.select('source', 'leaf');
      previous.copyNodeToClipboard('source', 'frame');
      const next = refreshEditorDocument(
        previous,
        kind === 'registry' ? fixtureRegistry() : registry,
      );
      expect(next).not.toBe(previous);
      expect(next.exportJson()).toBe(previous.exportJson());
      expect(next.getSnapshot().selection).toEqual(previous.getSnapshot().selection);
      expect(next.getClipboardSnapshot().available).toBe(false);
      expect(previous.getClipboardSnapshot().available).toBe(true);
    },
  );
  it('copy/check/failed paste never autosave;only successful paste saves normal schema', () => {
    vi.useFakeTimers();
    const registry = fixtureRegistry(),
      schema = clipboardApplication(),
      stored = new Map<string, string>([
        [PROJECT_STORAGE_KEY, JSON.stringify({ storageVersion: 1, savedAt: 'fixture', schema })],
      ]),
      write = vi.fn((key: string, value: string) => stored.set(key, value));
    const storage = new ProjectStorage(
      { getItem: (key) => stored.get(key) ?? null, setItem: write },
      registry,
      schema,
      { debounceMs: 10 },
    );
    storage.start();
    try {
      const doc = storage.getSnapshot().document,
        before = storage.getSnapshot();
      doc.copyNodeToClipboard('source', 'frame');
      doc.checkPasteClipboard('target');
      expect(() => doc.pasteClipboard('target', { index: -1 })).toThrow();
      vi.advanceTimersByTime(20);
      storage.flush();
      expect(write).not.toHaveBeenCalled();
      expect(storage.getSnapshot()).toBe(before);
      doc.pasteClipboard('target');
      vi.advanceTimersByTime(10);
      expect(write).toHaveBeenCalledTimes(1);
      const saved = JSON.parse(stored.get(PROJECT_STORAGE_KEY)!);
      expect(Object.keys(saved).sort()).toEqual([
        'savedAt',
        'schema',
        'selection',
        'storageVersion',
      ]);
      expect(saved).not.toHaveProperty('clipboard');
      expect(saved.schema).not.toHaveProperty('clipboard');
      const restored = new ProjectStorage(
        { getItem: (key) => stored.get(key) ?? null, setItem: write },
        registry,
        schema,
      );
      expect(restored.getSnapshot().document.getClipboardSnapshot().available).toBe(false);
      expect(
        restored.getSnapshot().document.getSnapshot().plan.pages.get('target')!.schema.children,
      ).toHaveLength(3);
    } finally {
      storage.stop();
    }
  });
  it('project reset and fresh HMR document never transfer private clipboard', () => {
    vi.useFakeTimers();
    const registry = fixtureRegistry(),
      schema = clipboardApplication(),
      storage = new ProjectStorage({ getItem: () => null, setItem: vi.fn() }, registry, schema);
    storage.start();
    try {
      const original = storage.getSnapshot().document;
      original.copyNodeToClipboard('source', 'frame');
      storage.reset();
      const reset = storage.getSnapshot().document;
      expect(reset).not.toBe(original);
      expect(reset.getClipboardSnapshot().available).toBe(false);
      reset.copyNodeToClipboard('source', 'frame');
      const hmr = new EditorDocument(JSON.parse(reset.exportJson()), fixtureRegistry());
      storage.bindDocument(hmr);
      expect(storage.getSnapshot().document.getClipboardSnapshot().available).toBe(false);
      expect(reset.getClipboardSnapshot().available).toBe(true);
    } finally {
      storage.stop();
    }
  });
  it('copy/paste commands do not execute source page code,onEnter,transport or runtime state changes', () => {
    const registry = fixtureRegistry(),
      schema = clipboardApplication(),
      effect = vi.spyOn(registry.actions['test.effect'], 'execute'),
      transport = vi.spyOn(registry.transports!['test.transport'], 'execute'),
      doc = new EditorDocument(schema, registry),
      runtime = new PageRuntime(doc.getSnapshot().plan, 'source');
    try {
      runtime.setState('caption', 'runtime value');
      const state = runtime.getState();
      doc.copyNodeToClipboard('source', 'frame');
      doc.checkPasteClipboard('target');
      doc.pasteClipboard('target');
      expect(effect).not.toHaveBeenCalled();
      expect(transport).not.toHaveBeenCalled();
      expect(runtime.getState()).toBe(state);
      expect(runtime.getState().caption).toBe('runtime value');
      expect((globalThis as Record<string, unknown>).__clipboardCommandExecuted).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });
});
