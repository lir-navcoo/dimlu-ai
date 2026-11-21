import { describe, expect, it } from 'vitest';
import {
  ApplicationDirectory,
  APPLICATION_DIRECTORY_KEY,
  applicationProjectStorageKey,
} from '../packages/editor/application-directory';
import {
  ProjectStorage,
  PROJECT_STORAGE_KEY,
  type ProjectStorageAdapter,
} from '../packages/editor/project-storage';
import type { ApplicationSchema } from '../packages/schema/types';
import { purchaseManagementExample } from '../src/purchase-management-example';
import { registry } from '../src/materials';

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const adapter: ProjectStorageAdapter = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
  return { adapter, data };
}

function secondApplication(): ApplicationSchema {
  return {
    ...structuredClone(purchaseManagementExample),
    id: 'second-application',
    title: '第二个应用',
  };
}

describe('application directory', () => {
  it('migrates the legacy single-project key without deleting the original', () => {
    const saved = JSON.stringify({
      storageVersion: 1,
      savedAt: 'old-save',
      schema: purchaseManagementExample,
      selection: { pageId: purchaseManagementExample.entryPageId, nodeId: null },
    });
    const { adapter, data } = memoryStorage({ [PROJECT_STORAGE_KEY]: saved });
    const directory = new ApplicationDirectory(adapter, registry, purchaseManagementExample);
    expect(directory.activeAppId).toBe(purchaseManagementExample.id);
    expect(directory.getApplications()).toEqual([
      {
        key: purchaseManagementExample.id,
        id: purchaseManagementExample.id,
        title: purchaseManagementExample.title,
        pageCount: purchaseManagementExample.pages.length,
        active: true,
      },
    ]);
    expect(data.get(PROJECT_STORAGE_KEY)).toBe(saved);
    expect(data.get(applicationProjectStorageKey(purchaseManagementExample.id))).toBe(saved);
    expect(JSON.parse(data.get(APPLICATION_DIRECTORY_KEY)!).directoryVersion).toBe(1);
  });

  it('keeps application project data isolated when switching active applications', () => {
    const { adapter } = memoryStorage();
    const directory = new ApplicationDirectory(adapter, registry, purchaseManagementExample);
    const firstKey = directory.storageKey;
    const first = new ProjectStorage(adapter, registry, purchaseManagementExample, {
      storageKey: firstKey,
      debounceMs: 0,
    });
    first.start();
    first.getSnapshot().document.renameApplication('采购应用已修改');
    first.flush();
    first.stop();

    directory.addApplication(secondApplication());
    expect(directory.activeAppId).toBe('second-application');
    const second = new ProjectStorage(adapter, registry, purchaseManagementExample, {
      storageKey: directory.storageKey,
      debounceMs: 0,
    });
    expect(second.getSnapshot().document.getSnapshot().plan.schema.title).toBe('第二个应用');

    directory.setActive(purchaseManagementExample.id);
    const restoredFirst = new ProjectStorage(adapter, registry, purchaseManagementExample, {
      storageKey: directory.storageKey,
    });
    expect(restoredFirst.getSnapshot().document.getSnapshot().plan.schema.title).toBe(
      '采购应用已修改',
    );
    expect(second.getSnapshot().document.getSnapshot().plan.schema.title).toBe('第二个应用');
  });

  it('duplicates definitions with a new application identity and removes entries safely', () => {
    const { adapter, data } = memoryStorage();
    const directory = new ApplicationDirectory(adapter, registry, purchaseManagementExample);
    const source = directory.getApplication(purchaseManagementExample.id);
    const copyKey = directory.duplicateApplication(source.id);
    expect(directory.activeAppId).toBe(copyKey);
    const duplicate = directory.getApplication(copyKey);
    expect(duplicate.id).toBe(copyKey);
    expect(duplicate.title).toBe(`${source.title} 副本`);
    expect(duplicate.pages).toEqual(source.pages);

    directory.setActive(source.id);
    expect(() => directory.removeApplication(source.id)).toThrow(/替代/);
    directory.removeApplication(source.id, copyKey);
    expect(directory.activeAppId).toBe(copyKey);
    expect(directory.getApplications().map((application) => application.key)).toEqual([copyKey]);
    expect(data.has(applicationProjectStorageKey(source.id))).toBe(true);
    expect(() => directory.removeApplication(copyKey)).toThrow(/至少保留一个应用/);
  });

  it('renames an application ID by migrating the directory pointer and retaining the old bytes', () => {
    const { adapter, data } = memoryStorage();
    const directory = new ApplicationDirectory(adapter, registry, purchaseManagementExample);
    const oldKey = applicationProjectStorageKey(purchaseManagementExample.id);
    const originalBytes = data.get(oldKey);
    const newStorageId = directory.renameApplicationId(
      purchaseManagementExample.id,
      'renamed-purchase-app',
    );
    expect(newStorageId).toBe('renamed-purchase-app');
    expect(directory.activeAppId).toBe(newStorageId);
    expect(directory.getApplication('renamed-purchase-app').id).toBe('renamed-purchase-app');
    expect(data.get(oldKey)).toBe(originalBytes);
    expect(data.has(applicationProjectStorageKey(newStorageId))).toBe(true);
    expect(() => directory.renameApplicationId(newStorageId, 'bad/id')).toThrow(/应用 ID/);
    const next = directory.createApplication('第二应用');
    expect(() => directory.renameApplicationId(newStorageId, 'application-1')).toThrow(/已存在/);
    expect(directory.activeAppId).toBe(next);
    expect(directory.getApplications().map((item) => item.id)).toContain('renamed-purchase-app');
  });

  it('preserves an invalid directory instead of silently rebuilding it', () => {
    const corrupt = '{"directoryVersion":2,"activeAppId":"x","appIds":["x"]}';
    const { adapter, data } = memoryStorage({ [APPLICATION_DIRECTORY_KEY]: corrupt });
    expect(() => new ApplicationDirectory(adapter, registry, purchaseManagementExample)).toThrow(
      /原始目录数据已保留/,
    );
    expect(data.get(APPLICATION_DIRECTORY_KEY)).toBe(corrupt);
  });

  it('keeps the directory storage identity stable when imported Schema changes application id', () => {
    const { adapter } = memoryStorage();
    const directory = new ApplicationDirectory(adapter, registry, purchaseManagementExample);
    const storageId = directory.activeAppId;
    const project = new ProjectStorage(adapter, registry, purchaseManagementExample, {
      storageKey: directory.storageKey,
    });
    const imported = structuredClone(purchaseManagementExample);
    imported.id = 'imported-schema-id';
    project.start();
    project.getSnapshot().document.importJson(JSON.stringify(imported));
    project.flush();
    project.stop();

    const restoredDirectory = new ApplicationDirectory(
      adapter,
      registry,
      purchaseManagementExample,
    );
    expect(restoredDirectory.activeAppId).toBe(storageId);
    expect(restoredDirectory.getApplications()).toEqual([
      expect.objectContaining({ key: storageId, id: 'imported-schema-id' }),
    ]);
    const restoredProject = new ProjectStorage(
      restoredDirectory.storageAdapterFor(storageId),
      registry,
      purchaseManagementExample,
      { storageKey: restoredDirectory.storageKey },
    );
    expect(restoredProject.getSnapshot().document.getSnapshot().plan.schema.id).toBe(
      'imported-schema-id',
    );
  });

  it('keeps malformed legacy project bytes visible to the protected-project recovery flow', () => {
    const malformed = '{"storageVersion":1,"schema":{"broken":true}}';
    const { adapter, data } = memoryStorage({ [PROJECT_STORAGE_KEY]: malformed });
    const directory = new ApplicationDirectory(adapter, registry, purchaseManagementExample);
    const project = new ProjectStorage(
      directory.storageAdapterFor(directory.activeAppId),
      registry,
      purchaseManagementExample,
      { storageKey: directory.storageKey },
    );
    expect(project.getSnapshot().protected).toBe(true);
    expect(project.getSnapshot().error).toMatch(/恢复失败/);
    expect(data.get(PROJECT_STORAGE_KEY)).toBe(malformed);
    expect(data.get(directory.storageKey)).toBe(malformed);
    project.start();
    project.confirmReplacement();
    expect(JSON.parse(data.get(PROJECT_STORAGE_KEY)!).storageVersion).toBe(1);
    project.stop();
  });
});
