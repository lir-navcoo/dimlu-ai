import type { NodeSchema, Value } from '../schema/types';
import { findNode, type DocumentHost } from './document-context';
import { assertActionScope, assertLogicScope } from './scope';
import { normalizeNodeName, readNodeName, NODE_NAME_EXTENSION } from '../schema/node-name';

/** Node-level authoring: props, editor names, logic (when/repeat) and style. */
export class DocumentNodeProps {
  constructor(private readonly host: DocumentHost) {}

  setProp = (
    pageId: string,
    nodeId: string,
    name: string,
    value: Value | undefined,
    group?: string,
  ) => this.setProps(pageId, nodeId, { [name]: value }, group);

  /** Related property changes share validation and one undo entry. */
  setProps = (
    pageId: string,
    nodeId: string,
    patch: Record<string, Value | undefined>,
    group?: string,
  ) => {
    const { schema, page } = this.host.draft(pageId);
    const location = findNode(page, nodeId);
    if (!location) throw new Error('属性目标节点不存在');
    const props = this.host.registry().components[location.node.component]?.props;
    for (const [name, value] of Object.entries(patch)) {
      if (!props || !Object.hasOwn(props, name)) throw new Error('未知组件属性 ' + name);
      if (value === undefined) delete location.node.props[name];
      else location.node.props[name] = structuredClone(value);
    }
    return this.host.commit(
      schema,
      '修改属性 ' + Object.keys(patch).join('、'),
      { pageId, nodeId },
      group,
    );
  };

  /** Author-only metadata; retain the complete current selection and isolate history. */
  setNodeName = (pageId: string, nodeId: string, input: string): boolean => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('名称目标节点不存在');
    const name = normalizeNodeName(input);
    if (name === readNodeName(node)) return false;
    const extensions = { ...node.extensions };
    if (name === undefined) delete extensions[NODE_NAME_EXTENSION];
    else extensions[NODE_NAME_EXTENSION] = name;
    if (Object.keys(extensions).length) node.extensions = extensions;
    else delete node.extensions;
    return this.host.commit(schema, '修改编辑器名称');
  };

  /** One validated edit changes condition and loop together; absence preserves, undefined deletes. */
  setNodeLogic = (
    pageId: string,
    nodeId: string,
    patch: { when?: Value | undefined; repeat?: NodeSchema['repeat'] | undefined },
  ) => {
    const before = this.host.plan().pages.get(pageId)?.schema;
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('逻辑目标节点不存在');
    for (const key of ['when', 'repeat'] as const)
      if (Object.hasOwn(patch, key)) {
        if (patch[key] === undefined) delete node[key];
        else if (key === 'when') node.when = structuredClone(patch.when!);
        else node.repeat = structuredClone(patch.repeat!);
      }
    assertLogicScope(before!, page);
    return this.host.commit(schema, '修改组件逻辑', { pageId, nodeId });
  };

  /** Patch explicit declarations atomically; empty patches leave legacy props untouched. */
  setStyle = (
    pageId: string,
    nodeId: string,
    patch: Partial<Record<import('../schema/style').StyleProperty, Value | undefined>>,
    group?: string,
  ) => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('样式目标节点不存在');
    assertActionScope(
      page,
      nodeId,
      Object.values(patch).filter((value): value is Value => value !== undefined),
    );
    const style = { ...node.style };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete style[key as keyof typeof style];
      else style[key as keyof typeof style] = structuredClone(value);
    }
    if (Object.keys(style).length) node.style = style;
    else delete node.style;
    return this.host.commit(schema, '修改组件样式', { pageId, nodeId }, group);
  };
}
