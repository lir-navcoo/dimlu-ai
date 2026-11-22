import type { NodeSchema, Value } from '../schema/types';
import { applyStyleSource, patchStyleSource } from '../schema/style-source';
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

  /** Author lock/hidden flags; each change is an isolated undoable commit. */
  setNodeFlags = (
    pageId: string,
    nodeId: string,
    patch: { lock?: boolean; hidden?: boolean },
  ): boolean => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('标志目标节点不存在');
    const describe = (key: 'lock' | 'hidden') =>
      key === 'lock' ? (patch.lock ? '锁定' : '解锁') : patch.hidden ? '隐藏' : '显示';
    const keys = (Object.keys(patch) as ('lock' | 'hidden')[]).filter((key) =>
      Object.hasOwn(patch, key),
    );
    if (!keys.length) return false;
    for (const key of keys) {
      if (patch[key]) node[key] = true;
      else delete node[key];
    }
    return this.host.commit(
      schema,
      keys.map((key) => `${describe(key)}组件 ${nodeId}`).join('、'),
      { pageId, nodeId },
    );
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
    if (node.styleCss !== undefined) {
      const css = patchStyleSource(node.styleCss, patch);
      const gaps = ['gap', 'rowGap', 'columnGap'] as const;
      if (gaps.some((key) => Object.hasOwn(patch, key))) {
        // 把简写拆成单轴声明时，同步其余可视设置，避免保留失效的间隙覆盖。
        const before = applyStyleSource(node.styleCss, gaps).style;
        const after = applyStyleSource(css ?? '', gaps, style).style;
        for (const key of gaps) {
          if (Object.hasOwn(patch, key) || !before[key]) continue;
          const resolved = after[key];
          if (resolved === undefined) delete style[key];
          else style[key] = resolved;
        }
      }
      if (css === undefined) delete node.styleCss;
      else node.styleCss = css;
    }
    if (Object.keys(style).length) node.style = style;
    else delete node.style;
    return this.host.commit(schema, '修改组件样式', { pageId, nodeId }, group);
  };

  setStyleSource = (pageId: string, nodeId: string, source: string, clearBindings = false) => {
    const { schema, page } = this.host.draft(pageId);
    const node = findNode(page, nodeId)?.node;
    if (!node) throw new Error('样式目标节点不存在');
    const capability = this.host.registry().components[node.component]?.style;
    if (!capability?.source) throw new Error('该组件未提供 CSS 源码设置');
    const { style, css } = applyStyleSource(
      source,
      capability.properties,
      clearBindings ? undefined : node.style,
    );
    if (Object.keys(style).length) node.style = style;
    else delete node.style;
    if (css === undefined) delete node.styleCss;
    else node.styleCss = css;
    return this.host.commit(schema, clearBindings ? '恢复组件样式' : '应用组件 CSS 源码', {
      pageId,
      nodeId,
    });
  };
}
