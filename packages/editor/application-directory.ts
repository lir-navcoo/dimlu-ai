import { EditorDocument } from './document';
import {
  PROJECT_STORAGE_KEY,
  emptyApplicationSchema,
  restoreProjectDocument,
  type ProjectStorageAdapter,
  type SavedProject,
} from './project-storage';
import type { Registry } from '../runtime/registry';
import type { ApplicationSchema } from '../schema/types';

export const APPLICATION_DIRECTORY_KEY = 'dimlu.workbench.applications.v1';
export const applicationProjectStorageKey = (appId: string) =>
  `dimlu.workbench.application.v1:${encodeURIComponent(appId)}`;

interface DirectoryRecord {
  directoryVersion: 1;
  activeAppId: string;
  appIds: string[];
  legacyAppId?: string;
}

export interface ApplicationDirectoryEntry {
  key: string;
  id: string;
  title: string;
  pageCount: number;
  active: boolean;
}

function parseObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export class ApplicationDirectory {
  private record: DirectoryRecord;
  private readonly now: () => string;
  private legacyAppIdValue: string | null = null;

  constructor(
    private readonly adapter: ProjectStorageAdapter,
    private readonly registry: Registry,
    fallback: ApplicationSchema,
    options: { now?: () => string } = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.record = this.restoreOrInitialize(fallback);
  }

  private saveRecord(record: DirectoryRecord) {
    this.adapter.setItem(APPLICATION_DIRECTORY_KEY, JSON.stringify(record));
    this.record = record;
  }

  private savedProject(
    schema: ApplicationSchema,
    selection?: SavedProject['selection'],
  ): SavedProject {
    return {
      storageVersion: 1,
      savedAt: this.now(),
      schema,
      ...(selection ? { selection } : {}),
    };
  }

  private readApplication(appId: string): ApplicationSchema {
    const raw = this.adapter.getItem(applicationProjectStorageKey(appId));
    if (raw === null) throw new Error(`应用目录损坏：找不到应用 ${appId} 的项目数据`);
    const stored: unknown = JSON.parse(raw);
    if (!parseObject(stored) || stored.storageVersion !== 1)
      throw new Error(`应用目录损坏：应用 ${appId} 的项目版本无效`);
    const document = restoreProjectDocument(stored.schema, this.registry);
    return document.getSnapshot().plan.schema;
  }

  private restoreOrInitialize(fallback: ApplicationSchema): DirectoryRecord {
    const directoryRaw = this.adapter.getItem(APPLICATION_DIRECTORY_KEY);
    if (directoryRaw !== null) {
      const parsed: unknown = JSON.parse(directoryRaw);
      if (
        !parseObject(parsed) ||
        parsed.directoryVersion !== 1 ||
        !Array.isArray(parsed.appIds) ||
        !parsed.appIds.every((id) => typeof id === 'string') ||
        typeof parsed.activeAppId !== 'string' ||
        new Set(parsed.appIds).size !== parsed.appIds.length ||
        !parsed.appIds.includes(parsed.activeAppId)
      )
        throw new Error('应用目录格式无效；原始目录数据已保留，请勿覆盖');
      const record = parsed as unknown as DirectoryRecord;
      record.appIds.forEach((id) => {
        if (this.adapter.getItem(applicationProjectStorageKey(id)) === null)
          throw new Error(`应用目录损坏：找不到应用 ${id} 的项目数据`);
      });
      if (record.legacyAppId && record.appIds.includes(record.legacyAppId))
        this.legacyAppIdValue = record.legacyAppId;
      const legacyRaw = this.adapter.getItem(PROJECT_STORAGE_KEY);
      if (legacyRaw !== null && !this.legacyAppIdValue) {
        this.legacyAppIdValue =
          record.appIds.find(
            (id) => this.adapter.getItem(applicationProjectStorageKey(id)) === legacyRaw,
          ) ?? null;
      }
      return record;
    }

    const legacyRaw = this.adapter.getItem(PROJECT_STORAGE_KEY);
    if (legacyRaw !== null) {
      let appId = fallback.id;
      try {
        const saved: unknown = JSON.parse(legacyRaw);
        if (!parseObject(saved) || saved.storageVersion !== 1) throw new Error('存储版本无效');
        appId = restoreProjectDocument(saved.schema, this.registry).getSnapshot().plan.schema.id;
      } catch {
        appId = fallback.id;
      }
      const key = applicationProjectStorageKey(appId);
      if (this.adapter.getItem(key) === null) this.adapter.setItem(key, legacyRaw);
      const record: DirectoryRecord = {
        directoryVersion: 1,
        activeAppId: appId,
        appIds: [appId],
        legacyAppId: appId,
      };
      this.legacyAppIdValue = appId;
      this.saveRecord(record);
      return record;
    }

    const app = new EditorDocument(fallback, this.registry).getSnapshot().plan.schema;
    this.legacyAppIdValue = app.id;
    const record: DirectoryRecord = {
      directoryVersion: 1,
      activeAppId: app.id,
      appIds: [app.id],
      legacyAppId: app.id,
    };
    this.adapter.setItem(
      applicationProjectStorageKey(app.id),
      JSON.stringify(this.savedProject(app, { pageId: app.entryPageId, nodeId: null })),
    );
    this.saveRecord(record);
    return record;
  }

  get activeAppId() {
    return this.record.activeAppId;
  }

  get storageKey() {
    return applicationProjectStorageKey(this.record.activeAppId);
  }

  get legacyCompatibilityAppId() {
    return this.legacyAppIdValue;
  }

  storageAdapterFor(appId: string): ProjectStorageAdapter {
    const appKey = applicationProjectStorageKey(appId);
    const mirrorLegacy = this.legacyAppIdValue === appId;
    return {
      getItem: (key) => {
        const value = this.adapter.getItem(key);
        return value === null && key === appKey && mirrorLegacy
          ? this.adapter.getItem(PROJECT_STORAGE_KEY)
          : value;
      },
      setItem: (key, value) => {
        this.adapter.setItem(key, value);
        if (key === appKey && mirrorLegacy) this.adapter.setItem(PROJECT_STORAGE_KEY, value);
      },
    };
  }

  getApplications(): ApplicationDirectoryEntry[] {
    return this.record.appIds.map((id) => {
      try {
        const schema = this.readApplication(id);
        return {
          key: id,
          id: schema.id,
          title: schema.title,
          pageCount: schema.pages.length,
          active: id === this.record.activeAppId,
        };
      } catch {
        return { key: id, id, title: id, pageCount: 0, active: id === this.record.activeAppId };
      }
    });
  }

  getApplication(appId: string): ApplicationSchema {
    if (this.record.appIds.includes(appId)) return this.readApplication(appId);
    const matches = this.record.appIds.filter((key) => {
      try {
        return this.readApplication(key).id === appId;
      } catch {
        return false;
      }
    });
    if (matches.length > 1) throw new Error(`应用 ID 不唯一：${appId}`);
    if (matches.length === 1) return this.readApplication(matches[0]);
    throw new Error(`应用不存在：${appId}`);
  }

  renameApplicationId(storageId: string, nextApplicationId: string): string {
    if (!this.record.appIds.includes(storageId)) throw new Error(`应用不存在：${storageId}`);
    const normalizedId = nextApplicationId.trim();
    const schema = this.readApplication(storageId);
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(normalizedId))
      throw new Error('应用 ID 必须以字母开头，且只能包含字母、数字、点、下划线和连字符');
    if (schema.id === normalizedId) return storageId;
    if (this.getApplications().some((entry) => entry.id === normalizedId))
      throw new Error(`应用 ID 已存在：${normalizedId}`);
    const nextSchema = { ...schema, id: normalizedId };
    const validated = new EditorDocument(nextSchema, this.registry).getSnapshot().plan.schema;
    const oldKey = applicationProjectStorageKey(storageId);
    const nextStorageId = normalizedId;
    const newKey = applicationProjectStorageKey(nextStorageId);
    if (this.adapter.getItem(newKey) !== null) throw new Error(`应用存储键已存在：${newKey}`);
    const savedRaw = this.adapter.getItem(oldKey);
    if (savedRaw === null) throw new Error(`应用项目数据不存在：${storageId}`);
    const saved = JSON.parse(savedRaw) as SavedProject;
    const nextSaved = { ...saved, schema: validated, savedAt: this.now() };
    this.adapter.setItem(newKey, JSON.stringify(nextSaved));
    const nextRecord: DirectoryRecord = {
      ...this.record,
      activeAppId: this.record.activeAppId === storageId ? nextStorageId : this.record.activeAppId,
      appIds: this.record.appIds.map((id) => (id === storageId ? nextStorageId : id)),
      legacyAppId: this.record.legacyAppId === storageId ? nextStorageId : this.record.legacyAppId,
    };
    this.saveRecord(nextRecord);
    if (this.legacyAppIdValue === storageId) this.legacyAppIdValue = nextStorageId;
    return nextStorageId;
  }

  hasApplication(appId: string): boolean {
    return this.record.appIds.includes(appId);
  }

  setActive(appId: string): boolean {
    if (!this.hasApplication(appId)) throw new Error(`应用不存在：${appId}`);
    if (this.record.activeAppId === appId) return false;
    this.saveRecord({ ...this.record, activeAppId: appId });
    return true;
  }

  addApplication(input: ApplicationSchema): string {
    const app = new EditorDocument(input, this.registry).getSnapshot().plan.schema;
    if (
      this.record.appIds.includes(app.id) ||
      this.getApplications().some((entry) => entry.id === app.id)
    )
      throw new Error(`应用 ID 已存在：${app.id}`);
    this.adapter.setItem(
      applicationProjectStorageKey(app.id),
      JSON.stringify(this.savedProject(app, { pageId: app.entryPageId, nodeId: null })),
    );
    this.saveRecord({
      ...this.record,
      activeAppId: app.id,
      appIds: [...this.record.appIds, app.id],
    });
    return app.id;
  }

  createApplication(title = '新建应用'): string {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error('应用名称不能为空');
    let index = 1;
    while (
      this.adapter.getItem(applicationProjectStorageKey(`application-${index}`)) !== null ||
      this.getApplications().some((entry) => entry.id === `application-${index}`)
    )
      index++;
    return this.addApplication(emptyApplicationSchema(`application-${index}`, normalizedTitle));
  }

  duplicateApplication(appId: string): string {
    const source = this.getApplication(appId);
    const copy = structuredClone(source);
    let index = 1;
    let nextId = `${source.id}-copy-${index}`;
    while (
      this.adapter.getItem(applicationProjectStorageKey(nextId)) !== null ||
      this.getApplications().some((entry) => entry.id === nextId)
    ) {
      index++;
      nextId = `${source.id}-copy-${index}`;
    }
    copy.id = nextId;
    copy.title = `${source.title} 副本`;
    return this.addApplication(copy);
  }

  removeApplication(appId: string, replacementAppId?: string): boolean {
    if (!this.record.appIds.includes(appId)) throw new Error(`应用不存在：${appId}`);
    if (this.record.appIds.length === 1) throw new Error('至少保留一个应用');
    const activeAppId = this.record.activeAppId;
    if (appId === activeAppId) {
      if (
        !replacementAppId ||
        replacementAppId === appId ||
        !this.record.appIds.includes(replacementAppId)
      )
        throw new Error('删除当前应用前请选择其他应用作为替代');
    } else if (replacementAppId !== undefined) {
      throw new Error('仅删除当前应用时可以指定替代应用');
    }
    const remaining = this.record.appIds.filter((id) => id !== appId);
    const next: DirectoryRecord = {
      ...this.record,
      activeAppId: appId === activeAppId ? replacementAppId! : activeAppId,
      appIds: remaining,
      ...(this.record.legacyAppId === appId ? { legacyAppId: undefined } : {}),
    };
    this.saveRecord(next);
    return true;
  }
}
