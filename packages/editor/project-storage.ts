import { EditorDocument, findNode, type Selection } from './document';
import type { Registry } from '../runtime/registry';
import type { ApplicationSchema, NodeSchema, Value } from '../schema/types';

export const PROJECT_STORAGE_KEY = 'dimlu.workbench.project.v1';
export function emptyApplicationSchema(id: string, title: string): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id,
    title,
    entryPageId: 'home',
    dependencies: { components: {}, actions: {} },
    pages: [{ id: 'home', title: '首页', state: [], children: [] }],
  };
}
export interface ProjectStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface SavedProject {
  storageVersion: 1;
  savedAt: string;
  schema: ApplicationSchema;
  selection?: Selection;
}
export interface ProjectStorageSnapshot {
  document: EditorDocument;
  status: 'saving' | 'saved' | 'error' | 'protected';
  error: string | null;
  savedAt: string | null;
  protected: boolean;
  raw: string | null;
  session: number;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const object = (input: unknown): input is Record<string, unknown> =>
  !!input && typeof input === 'object' && !Array.isArray(input);

/** Upgrade known legacy titles when reading local projects, without changing the stored bytes. */
export function restoreProjectDocument(input: unknown, registry: Registry): EditorDocument {
  if (
    registry.components['ui.heading'] ||
    !registry.components['ui.text'] ||
    !object(input) ||
    input.schemaVersion !== '0.1.0' ||
    !object(input.dependencies) ||
    !object(input.dependencies.components) ||
    input.dependencies.components['ui.heading'] !== '1.0.0'
  )
    return new EditorDocument(input, registry);

  const schema = structuredClone(input) as unknown as ApplicationSchema;
  const textVersion = registry.components['ui.text'].version;
  if (
    !Array.isArray(schema.pages) ||
    (Object.hasOwn(schema.dependencies.components, 'ui.text') &&
      schema.dependencies.components['ui.text'] !== textVersion)
  )
    return new EditorDocument(input, registry);

  const literal = (value: string | number): Value => ({ kind: 'literal', value });
  for (const page of schema.pages) {
    const ids = new Set<string>();
    const gather = (nodes: NodeSchema[]) => {
      for (const node of nodes) {
        ids.add(node.id);
        if (node.children) gather(node.children);
        for (const slot of Object.values(node.slots ?? {})) gather(slot.children);
      }
    };
    const migrate = (nodes: NodeSchema[]): NodeSchema[] =>
      nodes.flatMap((node) => {
        if (node.children) node.children = migrate(node.children);
        for (const slot of Object.values(node.slots ?? {})) slot.children = migrate(slot.children);
        if (node.component !== 'ui.heading') return [node];
        if (
          !object(node.props) ||
          !Object.hasOwn(node.props, 'title') ||
          Object.keys(node.props).some((key) => key !== 'title' && key !== 'description') ||
          node.children !== undefined ||
          node.slots !== undefined ||
          node.field !== undefined ||
          node.formId !== undefined
        )
          throw new Error(`无法迁移旧标题组件 ${node.id}`);
        const { title, description } = node.props;
        const heading: NodeSchema = {
          ...node,
          component: 'ui.text',
          props: { value: title },
          style: { fontSize: literal(23), fontWeight: literal(600), ...node.style },
        };
        if (description === undefined || (description?.kind === 'literal' && description.value === ''))
          return [heading];
        const base = `${node.id}-note`;
        let noteId = base;
        for (let i = 2; ids.has(noteId); i++) noteId = `${base}-${i}`;
        ids.add(noteId);
        return [
          heading,
          {
            id: noteId,
            component: 'ui.text',
            props: { value: description, tone: literal('muted') },
            ...(node.when !== undefined && { when: node.when }),
            ...(node.repeat !== undefined && { repeat: node.repeat }),
            ...(node.hidden !== undefined && { hidden: node.hidden }),
            ...(node.lock !== undefined && { lock: node.lock }),
          },
        ];
      });
    gather(page.children);
    page.children = migrate(page.children);
  }
  delete schema.dependencies.components['ui.heading'];
  schema.dependencies.components['ui.text'] = textVersion;
  return new EditorDocument(schema, registry);
}

/** Access localStorage lazily, so denied browser access is handled by the same recovery path. */
export const browserProjectStorage = (): ProjectStorageAdapter => ({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});

/** Only committed document definitions are persisted. Runtime and editor drafts never enter this store. */
export class ProjectStorage {
  private snapshot: ProjectStorageSnapshot;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribe?: () => void;
  private active = false;
  private generation = 0;
  private dirty = false;
  private readonly delay: number;
  private readonly now: () => string;
  private readonly storageKey: string;
  readonly resetToEmpty: boolean;
  constructor(
    private adapter: ProjectStorageAdapter,
    private registry: Registry,
    private fallback: ApplicationSchema,
    options: { debounceMs?: number; now?: () => string; storageKey?: string; resetToEmpty?: boolean } = {},
  ) {
    this.resetToEmpty = options.resetToEmpty ?? false;
    this.delay = options.debounceMs ?? 350;
    this.now = options.now ?? (() => new Date().toISOString());
    this.storageKey = options.storageKey ?? PROJECT_STORAGE_KEY;
    let document = new EditorDocument(fallback, registry);
    let raw: string | null = null,
      error: string | null = null,
      savedAt: string | null = null;
    let restored = false;
    try {
      raw = adapter.getItem(this.storageKey);
      if (raw !== null) {
        const saved: unknown = JSON.parse(raw);
        if (!object(saved) || saved.storageVersion !== 1)
          throw new Error('不支持的本地项目存储版本');
        // Construct only after full Schema/dependency validation; failures leave the fallback untouched.
        const candidate = restoreProjectDocument(saved.schema, registry);
        this.restoreSelection(candidate, saved.selection);
        document = candidate;
        savedAt = typeof saved.savedAt === 'string' ? saved.savedAt : null;
        restored = true;
      }
    } catch (reason) {
      error = `本地项目恢复失败：${message(reason)}`;
    }
    this.dirty = !restored && !error;
    this.snapshot = Object.freeze({
      document,
      status: error ? 'protected' : restored ? 'saved' : 'saving',
      error,
      savedAt,
      protected: error !== null,
      raw: error ? raw : null,
      session: 0,
    });
  }
  private restoreSelection(document: EditorDocument, input: unknown) {
    if (!object(input) || typeof input.pageId !== 'string') return;
    const page = document.getSnapshot().plan.pages.get(input.pageId);
    if (!page) return;
    const nodeId =
      typeof input.nodeId === 'string' && findNode(page.schema, input.nodeId) ? input.nodeId : null;
    document.select(input.pageId, nodeId);
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ProjectStorageSnapshot>) {
    this.snapshot = Object.freeze({ ...this.snapshot, ...patch });
    this.listeners.forEach((listener) => listener());
  }
  private cancelTimer() {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private observe() {
    this.unsubscribe = this.snapshot.document.subscribe(() => {
      this.dirty = true;
      this.schedule();
    });
  }
  start = () => {
    if (this.active) return;
    this.active = true;
    this.observe();
    if (this.dirty) this.schedule();
  };
  stop = () => {
    if (!this.active) return;
    this.flush();
    this.active = false;
    this.cancelTimer();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  };
  private schedule() {
    this.cancelTimer();
    if (!this.active || this.snapshot.protected) return;
    this.publish({ status: 'saving', error: null });
    const current = this.generation;
    this.timer = setTimeout(() => {
      if (this.active && current === this.generation) this.flush();
    }, this.delay);
  }
  /** Flush reads the latest committed snapshot, never a revision captured when a timer was scheduled. */
  flush = () => {
    this.cancelTimer();
    if (!this.dirty) return true;
    if (!this.active || this.snapshot.protected) return false;
    try {
      const { plan, selection } = this.snapshot.document.getSnapshot();
      const savedAt = this.now();
      const saved: SavedProject = {
        storageVersion: 1,
        savedAt,
        schema: plan.schema,
        selection: { pageId: selection.pageId, nodeId: selection.nodeId },
      };
      this.adapter.setItem(this.storageKey, JSON.stringify(saved));
      this.dirty = false;
      this.publish({ status: 'saved', error: null, savedAt, raw: null });
      return true;
    } catch (reason) {
      this.publish({ status: 'error', error: `本地保存失败：${message(reason)}` });
      return false;
    }
  };
  retry = () => {
    this.dirty = true;
    this.flush();
  };
  /** Rebind on HMR without letting an old document subscription or timer overwrite the new definition. */
  bindDocument = (
    document: EditorDocument,
    registry = this.registry,
    patch: Partial<ProjectStorageSnapshot> = {},
  ) => {
    if (this.snapshot.document === document) return;
    this.registry = registry;
    this.cancelTimer();
    this.unsubscribe?.();
    this.publish({ ...patch, document });
    this.dirty = true;
    if (this.active) {
      this.observe();
      this.schedule();
    }
  };
  /** UI must obtain explicit confirmation before calling this for a protected stored project. */
  confirmReplacement = () => {
    this.publish({ protected: false, error: null });
    this.dirty = true;
    this.flush();
  };
  /** Confirmed reset uses a new document/session, with no Undo history or unsaved editor drafts. */
  reset = () => {
    const { id, title } = this.snapshot.document.getSnapshot().plan.schema;
    const schema = this.resetToEmpty ? emptyApplicationSchema(id, title) : this.fallback;
    const document = new EditorDocument(schema, this.registry);
    this.bindDocument(document, this.registry, {
      protected: false,
      error: null,
      session: this.snapshot.session + 1,
    });
    this.flush();
  };
}
