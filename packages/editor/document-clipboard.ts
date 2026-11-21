import { compileApplication, freeze } from '../runtime/engine';
import type { NodeSchema, PageSchema } from '../schema/types';
import {
  collectUsedIds,
  findNode,
  reidentifyTree,
  type DocumentHost,
  type InsertTarget,
  type StaticForest,
} from './document-context';
import { inspectClipboardTree, type ClipboardSummary } from './node-clipboard';
import {
  normalizeSavedFragmentName,
  SAVED_FRAGMENT_LIMIT,
  type SavedFragmentSummary,
  type SavedFragmentsSnapshot,
} from './saved-fragments';
import { assertLocalFieldBindings } from './forms';
import { pageNodeOrder, topSelectedNodeIds, canonicalSelection } from './selection';

/** Component clipboard and session fragments: capture, persist and insert static forests. */
export class DocumentClipboard {
  #clipboard?: StaticForest;
  #savedFragments = new Map<
    string,
    { forest: StaticForest; summary: Readonly<SavedFragmentSummary> }
  >();
  private savedFragmentsSnapshot: Readonly<SavedFragmentsSnapshot> = freeze({ items: [] });
  private savedFragmentListeners = new Set<() => void>();
  private savedFragmentSequence = 0;
  private clipboardSummary: Readonly<ClipboardSummary> = Object.freeze({
    available: false,
    nodeCount: 0,
  });
  private clipboardListeners = new Set<() => void>();

  constructor(private readonly host: DocumentHost) {}

  getSavedFragmentsSnapshot = () => this.savedFragmentsSnapshot;
  subscribeSavedFragments = (notify: () => void) => {
    this.savedFragmentListeners.add(notify);
    return () => {
      this.savedFragmentListeners.delete(notify);
    };
  };
  getClipboardSnapshot = () => this.clipboardSummary;
  subscribeClipboard = (notify: () => void) => {
    this.clipboardListeners.add(notify);
    return () => {
      this.clipboardListeners.delete(notify);
    };
  };
  clearClipboard = () => {
    this.#clipboard = undefined;
    this.clipboardSummary = Object.freeze({ available: false, nodeCount: 0 });
    this.clipboardListeners.forEach((notify) => notify());
  };

  copyNodeToClipboard = (pageId: string, nodeId: string): void => {
    this.copyNodesToClipboard(pageId, [nodeId]);
  };

  copyNodesToClipboard = (pageId: string, ids: readonly string[]): void => {
    const { forest, nodeCount, sourcePageTitle } = this.captureStaticForest(pageId, ids);
    this.#clipboard = forest;
    this.clipboardSummary = Object.freeze({
      available: true,
      nodeCount,
      sourcePageId: pageId,
      sourcePageTitle,
      ...(forest.nodes.length === 1
        ? { component: forest.nodes[0]!.component }
        : { rootCount: forest.nodes.length }),
    });
    this.clipboardListeners.forEach((notify) => notify());
  };

  private captureStaticForest = (pageId: string, ids: readonly string[]) => {
    const page = this.host.plan().pages.get(pageId)?.schema;
    if (!page) throw new Error('未知页面 ' + pageId);
    if (page.code?.enabled) throw new Error('代码页面暂不支持组件剪贴板');
    if (!ids.length) throw new Error('请先选择静态组件');
    const known = new Set(pageNodeOrder(page));
    for (const id of ids) if (!known.has(id)) throw new Error('复制目标节点不存在');
    const nodes = topSelectedNodeIds(page, ids).map((id) =>
      structuredClone(findNode(page, id)!.node),
    );
    const components = new Set<string>();
    let nodeCount = 0;
    for (const node of nodes) {
      const inspected = inspectClipboardTree(node, this.host.plan().registry);
      for (const component of inspected.components) components.add(component);
      nodeCount += inspected.nodeCount;
    }
    const pins = Object.fromEntries(
      [...components].map((component) => [
        component,
        this.host.plan().schema.dependencies.components[component],
      ]),
    );
    return {
      forest: freeze({ nodes, components: pins }),
      nodeCount,
      sourcePageTitle: page.title,
    };
  };

  saveFragment = (pageId: string, explicitIds: readonly string[], input: string): string => {
    const name = normalizeSavedFragmentName(input);
    if (this.savedFragmentsSnapshot.items.some((item) => item.name === name))
      throw new Error('已存在同名会话片段，请使用其他名称');
    if (this.#savedFragments.size >= SAVED_FRAGMENT_LIMIT)
      throw new Error(`最多保存 ${SAVED_FRAGMENT_LIMIT} 个会话片段，请先删除不需要的片段`);
    const { forest, nodeCount, sourcePageTitle } = this.captureStaticForest(pageId, explicitIds);
    const sequence = this.savedFragmentSequence + 1;
    const id = `fragment-${sequence}`;
    const summary = freeze({
      id,
      name,
      sourcePageId: pageId,
      sourcePageTitle,
      rootCount: forest.nodes.length,
      nodeCount,
      ...(forest.nodes.length === 1 ? { component: forest.nodes[0]!.component } : {}),
    });
    const next = freeze({ items: [...this.savedFragmentsSnapshot.items, summary] });
    this.#savedFragments.set(id, { forest, summary });
    this.savedFragmentSequence = sequence;
    this.savedFragmentsSnapshot = next;
    this.savedFragmentListeners.forEach((notify) => notify());
    return id;
  };

  removeSavedFragment = (itemId: string): void => {
    this.savedFragment(itemId);
    const next = freeze({
      items: this.savedFragmentsSnapshot.items.filter((item) => item.id !== itemId),
    });
    this.#savedFragments.delete(itemId);
    this.savedFragmentsSnapshot = next;
    this.savedFragmentListeners.forEach((notify) => notify());
  };

  private savedFragment = (itemId: string) => {
    const item = this.#savedFragments.get(itemId);
    if (!item) throw new Error('会话片段不存在，请重新选择');
    return item;
  };

  private prepareClipboardPaste = (pageId: string, target: InsertTarget = {}) => {
    if (!this.#clipboard) throw new Error('组件剪贴板为空，请先复制一个静态组件');
    return this.prepareStaticForestInsertion(pageId, this.#clipboard, target);
  };

  prepareStaticForestInsertion = (
    pageId: string,
    forest: StaticForest,
    target: InsertTarget = {},
  ) => {
    const { schema, page } = this.host.draft(pageId);
    if (page.code?.enabled) throw new Error('代码页面暂不支持粘贴组件');
    const nodes = structuredClone(forest.nodes);
    for (const node of nodes) inspectClipboardTree(node, this.host.registry());
    for (const [component, version] of Object.entries(forest.components)) {
      if (
        this.host.registry().components[component].version !== version ||
        (Object.hasOwn(schema.dependencies.components, component) &&
          schema.dependencies.components[component] !== version)
      )
        throw new Error('组件依赖版本冲突 ' + component);
      schema.dependencies.components[component] = version;
    }
    const list = this.host.targetList(page, target);
    const index = target.index === undefined ? list.length : target.index;
    if (!Number.isInteger(index) || index < 0 || index > list.length)
      throw new Error('插入位置超出范围');
    const used = collectUsedIds(page);
    let sequence = this.host.idSequence();
    const allocate = (node: NodeSchema) => {
      let id: string;
      do {
        id = node.component.replaceAll('.', '-') + '-' + ++sequence;
      } while (used.has(id));
      used.add(id);
      return id;
    };
    // Call ids keep their copied identities, matching historical paste behavior.
    nodes.forEach((node) => reidentifyTree(node, allocate));
    list.splice(index, 0, ...nodes);
    for (const node of nodes) assertLocalFieldBindings(page, node, this.host.registry());
    return { schema, page, nodes, sequence };
  };

  checkPasteClipboard = (pageId: string, target: InsertTarget = {}): void => {
    if (this.#clipboard && this.#clipboard.nodes.length > 1)
      throw new Error('剪贴板包含多个顶层组件，请使用 checkPasteClipboardNodes');
    this.checkPasteClipboardNodes(pageId, target);
  };

  pasteClipboard = (pageId: string, target: InsertTarget = {}): string => {
    if (this.#clipboard && this.#clipboard.nodes.length > 1)
      throw new Error('剪贴板包含多个顶层组件，请使用 pasteClipboardNodes');
    return this.pasteClipboardNodes(pageId, target)[0]!;
  };

  checkPasteClipboardNodes = (pageId: string, target: InsertTarget = {}): void => {
    compileApplication(this.prepareClipboardPaste(pageId, target).schema, this.host.registry());
  };

  pasteClipboardNodes = (pageId: string, target: InsertTarget = {}): string[] => {
    const { schema, page, nodes, sequence } = this.prepareClipboardPaste(pageId, target);
    const ids = nodes.map((node) => node.id);
    const selection = canonicalSelection(page, ids, ids[0]);
    if (
      this.host.commit(
        schema,
        nodes.length === 1 ? '粘贴组件 ' + nodes[0]!.component : '粘贴组件组',
        selection,
      )
    )
      this.host.setIdSequence(sequence);
    return ids;
  };

  checkInsertSavedFragment = (pageId: string, itemId: string, target: InsertTarget = {}): void => {
    const { forest } = this.savedFragment(itemId);
    compileApplication(
      this.prepareStaticForestInsertion(pageId, forest, target).schema,
      this.host.registry(),
    );
  };

  insertSavedFragment = (pageId: string, itemId: string, target: InsertTarget = {}): string[] => {
    const { forest, summary } = this.savedFragment(itemId);
    const { schema, page, nodes, sequence } = this.prepareStaticForestInsertion(
      pageId,
      forest,
      target,
    );
    const ids = nodes.map((node) => node.id);
    if (this.host.commit(schema, '插入会话片段 ' + summary.name, canonicalSelection(page, ids, ids[0])))
      this.host.setIdSequence(sequence);
    return ids;
  };
}

