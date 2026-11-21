import { compileApplication } from '../runtime/engine';
import type { NodeSchema } from '../schema/types';
import {
  collectUsedIds,
  containsNode,
  findNode,
  reidentifyTree,
  type DocumentHost,
  type InsertTarget,
} from './document-context';
import { cloneMaterialTemplate, type MaterialTemplate } from './material-template';
import { inspectBulkDuplicateTree } from './bulk-duplicate';
import { assertLocalFieldBindings } from './forms';
import { assertMoveScope } from './scope';
import { pageNodeOrder, topSelectedNodeIds, canonicalSelection } from './selection';

/** Tree structure: insert, move, duplicate, remove and material instantiation. */
export class DocumentNodes {
  constructor(private readonly host: DocumentHost) {}

  private prepareInsert = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
    preview = false,
  ) => {
    const { schema, page } = this.host.draft(pageId);
    const components = this.host.registry().components;
    const contract = Object.hasOwn(components, input.component)
      ? components[input.component]
      : undefined;
    if (!contract) throw new Error('未注册组件 ' + input.component);
    let id = input.id;
    let sequence = this.host.idSequence();
    if (!id)
      do {
        id = input.component.replaceAll('.', '-') + '-' + ++sequence;
      } while (findNode(page, id));
    if (!preview) this.host.setIdSequence(sequence);
    const node: NodeSchema = { ...structuredClone(input), id };
    if (contract.slots && !node.slots)
      node.slots = Object.fromEntries(
        Object.entries(contract.slots).map(([name, params]) => [
          name,
          { params: [...params], children: [] },
        ]),
      );
    this.host.insertInto(this.host.targetList(page, target), node, target.index);
    assertLocalFieldBindings(page, node, this.host.registry());
    schema.dependencies.components[node.component] = contract.version;
    return { schema, node };
  };

  checkInsert = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
  ) => {
    compileApplication(this.prepareInsert(pageId, input, target, true).schema, this.host.registry());
  };

  insertNode = (
    pageId: string,
    input: Omit<NodeSchema, 'id'> & { id?: string },
    target: InsertTarget = {},
  ): string => {
    const { schema, node } = this.prepareInsert(pageId, input, target);
    this.host.commit(schema, '新增组件 ' + node.component, { pageId, nodeId: node.id });
    return node.id;
  };

  /** index is the destination position after the source has been removed. */
  private prepareMove = (pageId: string, nodeId: string, target: InsertTarget = {}) => {
    const { schema, page } = this.host.draft(pageId);
    const source = findNode(page, nodeId);
    if (!source) throw new Error('移动目标节点不存在');
    if (target.parentId && containsNode(source.node, target.parentId))
      throw new Error('不能移动到自身或自己的子树');
    this.host.targetList(page, target);
    assertMoveScope(page, source.node, target);
    source.list.splice(source.index, 1);
    this.host.insertInto(this.host.targetList(page, target), source.node, target.index);
    assertLocalFieldBindings(page, source.node, this.host.registry());
    return schema;
  };

  checkMove = (pageId: string, nodeId: string, target: InsertTarget = {}) => {
    compileApplication(this.prepareMove(pageId, nodeId, target), this.host.registry());
  };

  moveNode = (pageId: string, nodeId: string, target: InsertTarget = {}): boolean => {
    const schema = this.prepareMove(pageId, nodeId, target);
    return this.host.commit(schema, '移动组件 ' + nodeId, { pageId, nodeId });
  };

  duplicateNode = (pageId: string, nodeId: string, target?: InsertTarget): string => {
    const { schema, page } = this.host.draft(pageId);
    const source = findNode(page, nodeId);
    if (!source) throw new Error('复制目标节点不存在');
    const destination = target ?? {
      parentId: source.parentId,
      slot: source.slot,
      index: source.index + 1,
    };
    const list = this.host.targetList(page, destination);
    assertMoveScope(page, source.node, destination);
    const used = collectUsedIds(page);
    let sequence = this.host.idSequence();
    const allocate = (base: string) => {
      let id: string;
      do {
        id = `${base}-copy-${++sequence}`;
      } while (used.has(id));
      used.add(id);
      return id;
    };
    const copy = structuredClone(source.node);
    reidentifyTree(
      copy,
      (node) => {
        const id = allocate(node.id);
        return id;
      },
      (call) => allocate(call.id),
    );
    this.host.setIdSequence(sequence);
    this.host.insertInto(list, copy, destination.index);
    assertLocalFieldBindings(page, copy, this.host.registry());
    this.host.commit(schema, '复制组件 ' + nodeId, { pageId, nodeId: copy.id });
    return copy.id;
  };

  private prepareDuplicateNodes = (pageId: string, nodeIds: readonly string[]) => {
    const before = this.host.plan().pages.get(pageId)?.schema;
    if (!before) throw new Error('未知页面 ' + pageId);
    const known = new Set(pageNodeOrder(before));
    if (nodeIds.some((id) => !known.has(id))) throw new Error('复制目标节点不存在');
    if (!nodeIds.length) return null;
    const roots = topSelectedNodeIds(before, nodeIds);
    const sources = roots.map((id) => findNode(before, id)!);
    for (const source of sources) {
      inspectBulkDuplicateTree(source.node);
      assertMoveScope(before, source.node, { parentId: source.parentId, slot: source.slot });
    }
    const { schema, page } = this.host.draft(pageId);
    const used = collectUsedIds(before);
    let sequence = this.host.idSequence();
    const allocate = (base: string) => {
      let id: string;
      do {
        id = `${base}-copy-${++sequence}`;
      } while (used.has(id));
      used.add(id);
      return id;
    };
    const copies = new Map<string, NodeSchema>();
    for (const source of sources) {
      const copy = structuredClone(source.node);
      reidentifyTree(
        copy,
        (node) => allocate(node.id),
        (call) => allocate(call.id),
      );
      copies.set(source.node.id, copy);
    }
    // Rebuild every original owner list once; inserted copies are never revisited.
    const insertCopies = (nodes: NodeSchema[]): NodeSchema[] =>
      nodes.flatMap((node) => {
        const copy = copies.get(node.id);
        if (copy) return [node, copy];
        if (node.children) node.children = insertCopies(node.children);
        for (const slot of Object.values(node.slots ?? {}))
          slot.children = insertCopies(slot.children);
        return [node];
      });
    page.children = insertCopies(page.children);
    for (const copy of copies.values()) assertLocalFieldBindings(page, copy, this.host.registry());
    const copiedIds = [...copies.values()].map((node) => node.id);
    const previous = this.host.selection();
    const primarySource =
      previous.pageId === pageId && previous.nodeId
        ? sources.find((source) => containsNode(source.node, previous.nodeId!))
        : undefined;
    const primary = primarySource ? copies.get(primarySource.node.id)!.id : copiedIds[0];
    return { schema, copiedIds, selection: canonicalSelection(page, copiedIds, primary), sequence };
  };

  checkDuplicateNodes = (pageId: string, nodeIds: readonly string[]): void => {
    const candidate = this.prepareDuplicateNodes(pageId, nodeIds);
    if (candidate) compileApplication(candidate.schema, this.host.registry());
  };

  duplicateNodes = (pageId: string, nodeIds: readonly string[]): string[] => {
    const candidate = this.prepareDuplicateNodes(pageId, nodeIds);
    if (!candidate) return [];
    if (this.host.commit(candidate.schema, '创建所选组件副本', candidate.selection))
      this.host.setIdSequence(candidate.sequence);
    return candidate.copiedIds;
  };

  removeNode = (pageId: string, nodeId: string) => {
    const { schema, page } = this.host.draft(pageId),
      location = findNode(page, nodeId);
    if (!location) throw new Error('删除目标节点不存在');
    location.list.splice(location.index, 1);
    const selected = this.host.selection();
    const nodeStillExists =
      selected.pageId !== pageId || !selected.nodeId || !!findNode(page, selected.nodeId);
    const selection = nodeStillExists
      ? selected
      : {
          pageId,
          nodeId:
            location.parentId ??
            location.list[location.index]?.id ??
            location.list[location.index - 1]?.id ??
            null,
        };
    return this.host.commit(schema, '删除组件 ' + nodeId, selection);
  };

  removeNodes = (pageId: string, nodeIds: readonly string[]): boolean => {
    const before = this.host.plan().pages.get(pageId)?.schema;
    if (!before) throw new Error('未知页面 ' + pageId);
    const known = new Set(pageNodeOrder(before));
    if (nodeIds.some((id) => !known.has(id))) throw new Error('删除目标节点不存在');
    if (!nodeIds.length) return false;
    const roots = new Set(topSelectedNodeIds(before, nodeIds));
    const { schema, page } = this.host.draft(pageId);
    const remove = (list: NodeSchema[]): NodeSchema[] =>
      list.filter((node) => {
        if (roots.has(node.id)) return false;
        if (node.children) node.children = remove(node.children);
        for (const slot of Object.values(node.slots ?? {})) slot.children = remove(slot.children);
        return true;
      });
    page.children = remove(page.children);
    return this.host.commit(schema, '删除所选组件', { pageId, nodeId: null });
  };

  /** Prepare an editor-owned literal tree without consuming IDs or changing editor state. */
  private prepareFragment = (
    pageId: string,
    input: MaterialTemplate,
    target: InsertTarget = {},
  ) => {
    const registry = this.host.registry();
    const template = cloneMaterialTemplate(input, registry);
    const { schema, page } = this.host.draft(pageId);
    const used = collectUsedIds(page);
    let sequence = this.host.idSequence();
    const instantiate = (fragment: MaterialTemplate): NodeSchema => {
      const contract = registry.components[fragment.component];
      if (
        Object.hasOwn(schema.dependencies.components, fragment.component) &&
        schema.dependencies.components[fragment.component] !== contract.version
      )
        throw new Error('组件依赖版本冲突 ' + fragment.component);
      let id: string;
      do {
        id = fragment.component.replaceAll('.', '-') + '-' + ++sequence;
      } while (used.has(id));
      used.add(id);
      schema.dependencies.components[fragment.component] = contract.version;
      const node: NodeSchema = {
        id,
        component: fragment.component,
        props: Object.fromEntries(
          Object.entries(fragment.props).map(([name, value]) => [name, { kind: 'literal', value }]),
        ),
      };
      if (fragment.children) node.children = fragment.children.map(instantiate);
      if (contract.slots)
        node.slots = Object.fromEntries(
          Object.entries(contract.slots).map(([name, params]) => [
            name,
            {
              params: [...params],
              children: (fragment.slots?.[name]?.children ?? []).map(instantiate),
            },
          ]),
        );
      return node;
    };
    const node = instantiate(template);
    this.host.insertInto(this.host.targetList(page, target), node, target.index);
    assertLocalFieldBindings(page, node, registry);
    return { schema, node, sequence };
  };

  checkInsertFragment = (pageId: string, input: MaterialTemplate, target: InsertTarget = {}) => {
    compileApplication(this.prepareFragment(pageId, input, target).schema, this.host.registry());
  };

  insertFragment = (pageId: string, input: MaterialTemplate, target: InsertTarget = {}): string => {
    const { schema, node, sequence } = this.prepareFragment(pageId, input, target);
    if (this.host.commit(schema, '新增组件 ' + node.component, { pageId, nodeId: node.id }))
      this.host.setIdSequence(sequence);
    return node.id;
  };
}
