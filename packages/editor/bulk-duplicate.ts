import type { NodeSchema } from '../schema/types';

/** Bulk copies retain their owner, but built-in Tabs still require a closed context. */
export function inspectBulkDuplicateTree(root: NodeSchema): void {
  const visit = (node: NodeSchema, tabs?: Set<string>, crossedFanout = false) => {
    if (node.component === 'ui.tabs') {
      tabs = new Set();
      crossedFanout = false;
    } else if (node.repeat) crossedFanout = true;
    const fail = (reason: string): never => {
      throw new Error(`组件 ${node.id}：${reason}`);
    };
    if (node.component === 'ui.tabPanel') {
      if (!tabs) fail('请复制完整标签页容器');
      if (crossedFanout) fail('标签页面板跨越循环或重复插槽，请复制其中的完整标签页容器');
      const value = node.props.value;
      if (value && (value.kind !== 'literal' || typeof value.value !== 'string'))
        fail('标签页面板值必须是静态文本，暂不支持动态面板值的批量副本');
      if (value?.kind === 'literal' && typeof value.value === 'string' && value.value) {
        if (tabs!.has(value.value)) fail('同一标签页容器内的面板值不能重复');
        tabs!.add(value.value);
      }
    }
    for (const child of node.children ?? []) visit(child, tabs, crossedFanout);
    for (const [name, slot] of Object.entries(node.slots ?? {})) {
      const fanout =
        (node.component === 'ui.list' && name === 'item') ||
        (node.component === 'ui.table' && (name === 'cell' || name === 'actions'));
      for (const child of slot.children) visit(child, tabs, crossedFanout || fanout);
    }
  };
  visit(root);
}
