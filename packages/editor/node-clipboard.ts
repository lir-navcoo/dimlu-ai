import type { NodeSchema } from '../schema/types';
import type { Registry } from '../runtime/registry';
import { NODE_NAME_EXTENSION, isCanonicalNodeName } from '../schema/node-name';

export interface ClipboardSummary {
  available: boolean;
  nodeCount: number;
  sourcePageId?: string;
  sourcePageTitle?: string;
  component?: string;
  /** Present only for multiple captured roots; nodeCount still includes descendants. */
  rootCount?: number;
}

/** A portability check for current built-in visual materials, not general React code analysis. */
export function inspectClipboardTree(root: NodeSchema, registry: Registry) {
  const components = new Set<string>();
  let nodeCount = 0;
  const visit = (node: NodeSchema, tabs?: Set<string>, crossedFanout = false) => {
    const fail = (reason: string): never => {
      throw new Error(`组件 ${node.id}：${reason}`);
    };
    const contract = Object.hasOwn(registry.components, node.component)
      ? registry.components[node.component]
      : undefined;
    if (!contract) fail('未注册组件 ' + node.component);
    if (contract!.form || contract!.fieldArray)
      fail('表单和明细容器暂不支持组件剪贴板，请复制静态布局组件');
    for (const name of ['formId', 'field', 'when', 'repeat'] as const)
      if (Object.hasOwn(node, name)) fail(name + ' 需要页面上下文，当前仅支持静态组件复制');
    if (Object.hasOwn(node.props, 'formId') || Object.hasOwn(node.props, 'arrayId'))
      fail('模型引用属性暂不支持复制，请先解除绑定');
    for (const [name, value] of Object.entries(node.props))
      if (value.kind !== 'literal') fail('props.' + name + ' 使用绑定，当前仅支持静态组件复制');
    for (const [name, value] of Object.entries(node.style ?? {}))
      if (value.kind !== 'literal') fail('style.' + name + ' 使用绑定，当前仅支持静态组件复制');
    if (Object.values(node.on ?? {}).some((calls) => calls.length))
      fail('事件动作暂不支持复制，请选择没有动作的静态组件');
    if (
      Object.entries(node.extensions ?? {}).some(
        ([key, value]) => key !== NODE_NAME_EXTENSION || !isCanonicalNodeName(value),
      )
    )
      fail('扩展数据暂不支持组件剪贴板（仅允许有效的编辑器名称）');
    if (node.component === 'ui.tabs') {
      tabs = new Set();
      crossedFanout = false;
    }
    if (node.component === 'ui.tabPanel') {
      if (!tabs) fail('请复制完整标签页容器');
      if (crossedFanout) fail('标签页面板跨越重复插槽，请将完整标签页容器置于该插槽内');
      const value = node.props.value;
      if (value?.kind === 'literal' && typeof value.value === 'string' && value.value) {
        if (tabs!.has(value.value)) fail('同一标签页容器内的面板值不能重复');
        tabs!.add(value.value);
      }
    }
    components.add(node.component);
    nodeCount++;
    for (const child of node.children ?? []) visit(child, tabs, crossedFanout);
    for (const [name, slot] of Object.entries(node.slots ?? {})) {
      const fanout =
        (node.component === 'ui.list' && name === 'item') ||
        (node.component === 'ui.table' && (name === 'cell' || name === 'actions'));
      for (const child of slot.children) visit(child, tabs, crossedFanout || fanout);
    }
  };
  visit(root);
  return { components, nodeCount };
}
