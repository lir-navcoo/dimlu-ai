import { createRegistry, type Registry } from '../packages/runtime/registry';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { registry as builtinRegistry } from '../src/materials';

export const lit = (value: Json): Value => ({ kind: 'literal', value });
export const selectionText = (id: string, value = id): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value: lit(value) },
});
export function selectionRegistry(): Registry {
  return createRegistry(
    Object.fromEntries(
      Object.entries(builtinRegistry.components).map(([name, contract]) => [name, { ...contract }]),
    ),
    builtinRegistry.actions,
    builtinRegistry.computations,
    builtinRegistry.transports,
  );
}
export function selectionApplication(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'multiselection-acceptance',
    title: '多选独立验收',
    entryPageId: 'a',
    dependencies: {
      components: { 'ui.layout': '1.0.0', 'ui.text': '1.0.0', 'ui.card': '1.0.0' },
      actions: { 'state.set': '1.0.0' },
    },
    pages: [
      {
        id: 'a',
        title: '页面 A',
        state: [{ id: 'caption', type: 'string', initial: 'initial' }],
        forms: [
          {
            id: 'model',
            fields: [{ id: 'name', path: ['name'], label: 'Name', type: 'string', initial: '' }],
          },
        ],
        onEnter: [
          {
            id: 'entry-action',
            action: 'state.set',
            input: { stateId: lit('caption'), value: lit('entered') },
          },
        ],
        code: {
          enabled: false,
          language: 'jsx',
          source: 'export default () => <div />;',
          css: '.retained { color: red; }',
        },
        extensions: { 'test:page': { preserve: true } },
        children: [
          {
            id: 'root',
            component: 'ui.layout',
            props: {},
            children: [
              selectionText('alpha', 'Alpha text'),
              {
                id: 'card',
                component: 'ui.card',
                props: { title: lit('Card title') },
                children: [selectionText('body', 'Body text')],
                slots: {
                  header: { params: [], children: [selectionText('header', 'Header text')] },
                  footer: {
                    params: [],
                    children: [
                      {
                        id: 'slot-wrap',
                        component: 'ui.layout',
                        props: {},
                        children: [selectionText('slot-leaf', 'Slot text')],
                      },
                    ],
                  },
                },
              },
            ],
          },
          selectionText('tail', 'Tail text'),
          selectionText('shared', 'Shared A'),
        ],
      },
      {
        id: 'b',
        title: '页面 B',
        state: [],
        children: [
          {
            id: 'b-root',
            component: 'ui.layout',
            props: {},
            children: [selectionText('b-one', 'B one'), selectionText('b-two', 'B two')],
          },
          selectionText('shared', 'Shared B'),
        ],
      },
    ],
  };
}
