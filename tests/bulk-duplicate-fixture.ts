import { EditorDocument, findNode } from '../packages/editor/document';
import type { ApplicationSchema, NodeSchema } from '../packages/schema/types';
import { selectionApplication, selectionRegistry, lit } from './multiselection-fixture';

export { lit };
export const bulkText = (id: string): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value: lit(`Text ${id}`) },
});
export const bulkPanel = (
  id: string,
  value = id,
  children = [bulkText(`${id}-text`)],
): NodeSchema => ({
  id,
  component: 'ui.tabPanel',
  props: { label: lit(`Label ${id}`), value: lit(value) },
  children,
});
export const bulkTabs = (
  id: string,
  children = [bulkPanel(`${id}-a`, 'a'), bulkPanel(`${id}-b`, 'b')],
): NodeSchema => ({
  id,
  component: 'ui.tabs',
  props: { label: lit(`Tabs ${id}`), value: lit('') },
  children,
});
export const bulkLayout = (id: string, children: NodeSchema[]): NodeSchema => ({
  id,
  component: 'ui.layout',
  props: {},
  children,
});
export const allBulkNodes = (nodes: readonly NodeSchema[]): NodeSchema[] =>
  nodes.flatMap((node) => [
    node,
    ...allBulkNodes(node.children ?? []),
    ...Object.values(node.slots ?? {}).flatMap((slot) => allBulkNodes(slot.children)),
  ]);
export function bulkSetup(roots?: NodeSchema[]) {
  const schema = selectionApplication();
  const registry = selectionRegistry();
  if (roots) schema.pages[0].children = roots;
  const walk = (node: NodeSchema) => {
    schema.dependencies.components[node.component] = registry.components[node.component].version;
    node.children?.forEach(walk);
    for (const slot of Object.values(node.slots ?? {})) slot.children.forEach(walk);
  };
  schema.pages.forEach((page) => page.children.forEach(walk));
  return { schema, registry, document: new EditorDocument(schema, registry) };
}
export function bulkDocument(schema: ApplicationSchema) {
  return new EditorDocument(schema, selectionRegistry());
}
export const bulkPage = (document: EditorDocument, pageId = 'a') =>
  document.getSnapshot().plan.pages.get(pageId)!.schema;
export const bulkNode = (document: EditorDocument, id: string, pageId = 'a') =>
  findNode(bulkPage(document, pageId), id)!.node;
export function stripBulkIdentities(node: NodeSchema): NodeSchema {
  return {
    ...node,
    id: '<node>',
    ...(node.on
      ? {
          on: Object.fromEntries(
            Object.entries(node.on).map(([event, calls]) => [
              event,
              calls.map((call) => ({ ...call, id: '<action>' })),
            ]),
          ),
        }
      : {}),
    ...(node.children ? { children: node.children.map(stripBulkIdentities) } : {}),
    ...(node.slots
      ? {
          slots: Object.fromEntries(
            Object.entries(node.slots).map(([name, slot]) => [
              name,
              { ...slot, children: slot.children.map(stripBulkIdentities) },
            ]),
          ),
        }
      : {}),
  };
}
