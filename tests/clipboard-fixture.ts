import { createRegistry, type Registry } from '../packages/runtime/registry';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { registry as builtins } from '../src/materials';

export const literal = (value: Json): Value => ({ kind: 'literal', value });
export const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
export const staticLeaf = (id = 'leaf'): NodeSchema => ({
  id,
  component: 'test.leaf',
  props: {
    text: literal('source leaf / scope.record / forms.model / leaf'),
    payload: literal({
      formId: 'model',
      arrayId: 'rows',
      id: 'leaf',
      value: { kind: 'stateRef', stateId: 'caption' },
    }),
  },
  style: { color: literal('red'), width: literal(120) },
});
export const staticTree = (): NodeSchema => ({
  id: 'frame',
  component: 'test.frame',
  props: { payload: literal({ nested: ['leaf', { formId: 'model', arrayId: 'rows' }] }) },
  style: { paddingTop: literal(8), backgroundColor: literal('white') },
  children: [staticLeaf()],
  slots: {
    footer: {
      params: ['record'],
      children: [
        {
          id: 'slot-leaf',
          component: 'test.slotLeaf',
          props: { payload: literal({ nodeId: 'frame', selector: '#leaf' }) },
          style: { color: literal('blue') },
        },
      ],
    },
    empty: { params: [], children: [] },
  },
});
export function fixtureRegistry(): Registry {
  const registry = createRegistry(
    {
      ...Object.fromEntries(
        Object.entries(builtins.components).map(([name, contract]) => [name, { ...contract }]),
      ),
      'test.frame': {
        version: '2.1.0',
        children: true,
        slots: { footer: ['record'], empty: [] },
        props: { payload: { type: 'json' } },
        style: { target: 'root', properties: ['paddingTop', 'backgroundColor'] },
      },
      'test.leaf': {
        version: '3.2.0',
        props: {
          text: { type: 'string', required: true },
          payload: { type: 'json' },
          formId: { type: 'string' },
          arrayId: { type: 'string' },
        },
        style: { target: 'root', properties: ['color', 'width'] },
        events: ['onClick'],
      },
      'test.slotLeaf': {
        version: '4.3.0',
        props: { payload: { type: 'json' } },
        style: { target: 'root', properties: ['color'] },
        events: ['onClick'],
      },
      'test.form': { version: '1.0.0', props: {}, children: true, form: true },
      'test.array': { version: '1.0.0', props: {}, children: true, fieldArray: true },
    },
    { 'test.effect': { version: '1.0.0', input: {}, execute: () => undefined } },
    {},
    { 'test.transport': { version: '1.0.0', input: {}, output: 'object', execute: () => ({}) } },
  );
  return registry;
}
export const nodeIds = (node: NodeSchema): string[] => [
  node.id,
  ...(node.children ?? []).flatMap(nodeIds),
  ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children.flatMap(nodeIds)),
];
export function clipboardApplication(
  nodes: NodeSchema[] = [staticTree()],
  registry = fixtureRegistry(),
): ApplicationSchema {
  const components = new Set<string>(['test.frame', 'test.leaf']);
  const walk = (node: NodeSchema) => {
    components.add(node.component);
    (node.children ?? []).forEach(walk);
    Object.values(node.slots ?? {}).forEach((slot) => slot.children.forEach(walk));
  };
  nodes.forEach(walk);
  return {
    schemaVersion: '0.1.0',
    id: 'clipboard-acceptance',
    title: 'Clipboard acceptance',
    entryPageId: 'source',
    dependencies: {
      components: Object.fromEntries(
        [...components].map((name) => [name, registry.components[name].version]),
      ),
      actions: { 'test.effect': '1.0.0' },
      transports: { 'test.transport': '1.0.0' },
    },
    pages: [
      {
        id: 'source',
        title: '源页面',
        state: [
          { id: 'caption', type: 'string', initial: 'source' },
          { id: 'color', type: 'string', initial: 'red' },
        ],
        forms: [
          {
            id: 'model',
            fields: [{ id: 'name', path: ['name'], label: 'Name', type: 'string', initial: '' }],
          },
        ],
        dataSources: [
          { id: 'records', kind: 'query', transport: 'test.transport', input: {}, initial: {} },
        ],
        code: {
          enabled: false,
          language: 'tsx',
          source: 'globalThis.__clipboardCommandExecuted = true; export default () => <div />;',
          css: '.source-only { color: red; }',
        },
        extensions: { 'test:page': { id: 'leaf' } },
        onEnter: [{ id: 'source-enter', action: 'test.effect', input: {} }],
        children: nodes,
      },
      {
        id: 'target',
        title: '目标页面',
        state: [{ id: 'caption', type: 'string', initial: 'target' }],
        code: {
          enabled: false,
          language: 'jsx',
          source: 'export default () => <div />;',
          css: '.target-only { color: blue; }',
        },
        children: [
          {
            id: 'target-frame',
            component: 'test.frame',
            props: {},
            children: [],
            slots: {
              footer: { params: ['record'], children: [] },
              empty: { params: [], children: [] },
            },
          },
          {
            id: 'target-leaf',
            component: 'test.leaf',
            props: { text: literal('Existing target') },
          },
        ],
      },
    ],
  };
}

export function clipboardUiApplication(): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'component-session-ui',
    title: '组件会话验收',
    entryPageId: 'source',
    dependencies: {
      components: Object.fromEntries(
        ['ui.layout', 'ui.text', 'ui.card', 'ui.input'].map((component) => [
          component,
          builtins.components[component].version,
        ]),
      ),
      actions: {},
    },
    pages: [
      {
        id: 'source',
        title: '源页面',
        state: [{ id: 'caption', type: 'string', initial: 'initial' }],
        code: {
          enabled: false,
          language: 'jsx',
          source: 'export default () => <div />;',
          css: '.source-css { color: red; }',
        },
        children: [
          {
            id: 'source-frame',
            component: 'ui.layout',
            props: {},
            style: { paddingTop: literal(12) },
            children: [
              {
                id: 'source-text',
                component: 'ui.text',
                props: { value: literal('Copied content') },
              },
              {
                id: 'source-card',
                component: 'ui.card',
                props: { title: literal('Static card') },
                slots: {
                  header: { params: [], children: [] },
                  footer: {
                    params: [],
                    children: [
                      {
                        id: 'source-footer',
                        component: 'ui.text',
                        props: { value: literal('Copied footer') },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      {
        id: 'target',
        title: '目标页面',
        state: [],
        children: [
          {
            id: 'target-existing',
            component: 'ui.text',
            props: { value: literal('Existing target content') },
          },
        ],
      },
    ],
  };
}
