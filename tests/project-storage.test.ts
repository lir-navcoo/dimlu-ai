import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectStorage,
  PROJECT_STORAGE_KEY,
  type ProjectStorageAdapter,
} from '../packages/editor/project-storage';
import { EditorDocument } from '../packages/editor/document';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';

function memory(raw: string | null = null) {
  const data = new Map<string, string>();
  if (raw !== null) data.set(PROJECT_STORAGE_KEY, raw);
  const storage: ProjectStorageAdapter = {
    getItem: vi.fn((key) => data.get(key) ?? null),
    setItem: vi.fn((key, value) => {
      data.set(key, value);
    }),
  };
  return { storage, data, read: () => JSON.parse(data.get(PROJECT_STORAGE_KEY)!) };
}
function title(document: EditorDocument, value: string) {
  document.setProp('purchase', 'purchase-heading', 'title', { kind: 'literal', value });
}
afterEach(() => vi.useRealTimers());

describe('local project persistence', () => {
  it('debounces the latest committed definition, saves Undo and reconstructs without history', () => {
    vi.useFakeTimers();
    const m = memory();
    const p = new ProjectStorage(m.storage, registry, exampleApplication, { debounceMs: 20 });
    p.start();
    title(p.getSnapshot().document, '先前');
    title(p.getSnapshot().document, '最新');
    vi.advanceTimersByTime(19);
    expect(m.storage.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(m.storage.setItem).toHaveBeenCalledTimes(1);
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('最新');
    p.getSnapshot().document.undo();
    p.stop();
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('先前');
    const restored = new ProjectStorage(m.storage, registry, exampleApplication);
    expect(restored.getSnapshot().document.getSnapshot().canUndo).toBe(false);
    expect(Object.keys(m.read()).sort()).toEqual([
      'savedAt',
      'schema',
      'selection',
      'storageVersion',
    ]);
    expect(m.read().schema).not.toHaveProperty('runtime');
  });
  it.each([
    '{ invalid json',
    '{"storageVersion":2,"schema":{}}',
    JSON.stringify({
      storageVersion: 1,
      schema: {
        ...exampleApplication,
        dependencies: { components: { 'unknown.component': '1.0.0' }, actions: {} },
      },
    }),
  ])('protects rejected raw bytes until explicit replacement: %s', (raw) => {
    vi.useFakeTimers();
    const m = memory(raw),
      p = new ProjectStorage(m.storage, registry, exampleApplication, { debounceMs: 1 });
    p.start();
    title(p.getSnapshot().document, '保留在内存');
    p.getSnapshot().document.select('people', 'people-heading');
    vi.runAllTimers();
    p.flush();
    p.stop();
    expect(m.data.get(PROJECT_STORAGE_KEY)).toBe(raw);
    expect(m.storage.setItem).not.toHaveBeenCalled();
    expect(p.getSnapshot()).toMatchObject({ protected: true, raw, status: 'protected' });
    p.start();
    p.confirmReplacement();
    expect(p.getSnapshot()).toMatchObject({ protected: false, status: 'saved', raw: null });
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('保留在内存');
    p.stop();
  });
  it('restores valid Schema independently of malformed selection', () => {
    const saved = {
      storageVersion: 1,
      schema: exampleApplication,
      selection: { pageId: 'people', nodeId: { invalid: true } },
    };
    const m = memory(JSON.stringify(saved)),
      p = new ProjectStorage(m.storage, registry, exampleApplication);
    expect(p.getSnapshot().protected).toBe(false);
    expect(p.getSnapshot().document.getSnapshot().selection).toEqual({
      pageId: 'people',
      nodeId: null,
    });
    expect(p.getSnapshot().document.getSnapshot().canUndo).toBe(false);
  });
  it('protects unreadable storage even when edited, stopped or rebound', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('blocked', 'SecurityError');
      }),
      setItem: vi.fn(),
    };
    const p = new ProjectStorage(storage, registry, exampleApplication);
    p.start();
    const next = new EditorDocument(exampleApplication, registry);
    title(next, 'HMR');
    p.bindDocument(next);
    p.stop();
    expect(p.getSnapshot()).toMatchObject({ protected: true, status: 'protected', raw: null });
    expect(p.getSnapshot().error).toContain('blocked');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('keeps memory and reports quota/security write failures, then retries only the latest definition', () => {
    const m = memory();
    const write = vi.mocked(m.storage.setItem);
    let fail = true;
    write.mockImplementation((key, value) => {
      if (fail) throw new DOMException('full', 'QuotaExceededError');
      m.data.set(key, value);
    });
    const p = new ProjectStorage(m.storage, registry, exampleApplication);
    p.start();
    title(p.getSnapshot().document, '未丢失');
    p.flush();
    expect(p.getSnapshot().status).toBe('error');
    expect(p.getSnapshot().savedAt).toBeNull();
    title(p.getSnapshot().document, '最后修改');
    fail = false;
    p.retry();
    expect(p.getSnapshot().status).toBe('saved');
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('最后修改');
    p.stop();
  });
  it('cancels old timers/subscriptions on document replacement and stop/restart', () => {
    vi.useFakeTimers();
    const m = memory(),
      p = new ProjectStorage(m.storage, registry, exampleApplication, { debounceMs: 10 });
    p.start();
    const old = p.getSnapshot().document;
    title(old, '旧定义');
    const next = new EditorDocument(exampleApplication, registry);
    title(next, '新定义');
    p.bindDocument(next);
    title(old, '旧订阅不能保存');
    vi.advanceTimersByTime(10);
    expect(m.storage.setItem).toHaveBeenCalledTimes(1);
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('新定义');
    title(next, '卸载最新');
    p.stop();
    title(next, '停止后不写');
    vi.runAllTimers();
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('卸载最新');
    p.start();
    title(next, '重新挂载最新');
    vi.advanceTimersByTime(10);
    expect(m.read().schema.pages[0].children[0].props.title.value).toBe('重新挂载最新');
    p.stop();
  });
});
