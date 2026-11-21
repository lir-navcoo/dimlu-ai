import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import type { NodeSchema } from '../packages/schema/types';
import { materials } from '../src/materials';
import { clipboardApplication, fixtureRegistry, literal } from './clipboard-fixture';

afterEach(cleanup);
const text = (id: string): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value: literal(`Content ${id}`) },
});
const panel = (id: string, value = id, children = [text(`${id}-text`)]): NodeSchema => ({
  id,
  component: 'ui.tabPanel',
  props: { label: literal(`Label ${id}`), value: literal(value) },
  children,
});
const tabs = (
  id: string,
  children = [panel(`${id}-a`, 'a'), panel(`${id}-b`, 'b')],
): NodeSchema => ({
  id,
  component: 'ui.tabs',
  props: { label: literal(`Tabs ${id}`), value: literal('') },
  children,
});
const layout = (id: string, children: NodeSchema[]): NodeSchema => ({
  id,
  component: 'ui.layout',
  props: {},
  children,
});
const fanoutCases = [
  { component: 'ui.list', slot: 'item' },
  { component: 'ui.table', slot: 'cell' },
  { component: 'ui.table', slot: 'actions' },
];
function fanout(
  id: string,
  component: string,
  slot: string,
  children: NodeSchema[],
  count = 2,
): NodeSchema {
  const registry = fixtureRegistry();
  return {
    id,
    component,
    props: {
      data: literal(
        Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` })),
      ),
      ...(component === 'ui.table' ? { columns: literal([{ key: 'name', title: 'Name' }]) } : {}),
    },
    slots: Object.fromEntries(
      Object.entries(registry.components[component].slots!).map(([name, params]) => [
        name,
        { params: [...params], children: name === slot ? children : [] },
      ]),
    ),
  };
}
function setup(root: NodeSchema) {
  const registry = fixtureRegistry(),
    schema = clipboardApplication([root], registry);
  schema.pages[1].children = [];
  return new EditorDocument(schema, registry);
}
function renderPasted(document: EditorDocument) {
  const runtime = new PageRuntime(document.getSnapshot().plan, 'target');
  const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
  return { runtime, view };
}

describe('clipboard nearest built-in Tabs closure', () => {
  it.each(['orphan', 'wrapped-orphan', 'outer-owner-outside-capture'] as const)(
    'rejects %s without changing imported fallback behavior',
    (kind) => {
      const orphan = panel('orphan'),
        root =
          kind === 'orphan'
            ? orphan
            : kind === 'wrapped-orphan'
              ? layout('wrapper', [orphan])
              : tabs('external-tabs', [layout('wrapper', [orphan])]);
      const document = setup(root),
        targetId = kind === 'outer-owner-outside-capture' ? 'wrapper' : root.id,
        before = document.getSnapshot();
      expect(() => document.copyNodeToClipboard('source', targetId)).toThrow(
        '请复制完整标签页容器',
      );
      expect(document.getSnapshot()).toBe(before);
      expect(() => document.duplicateNode('source', targetId)).not.toThrow();
    },
  );
  it.each(['direct', 'outer-layout', 'wrapped-panels', 'card-slot', 'nested-tabs'] as const)(
    'accepts and renders self-contained %s tree',
    (kind) => {
      let root = tabs('complete');
      if (kind === 'outer-layout') root = layout('outer', [root]);
      if (kind === 'wrapped-panels')
        root = tabs('complete', [layout('panel-wrap', [panel('a', 'a'), panel('b', 'b')])]);
      if (kind === 'card-slot')
        root = tabs('complete', [
          {
            id: 'card',
            component: 'ui.card',
            props: { title: literal('Card') },
            slots: {
              footer: { params: [], children: [panel('a', 'a'), panel('b', 'b')] },
              header: { params: [], children: [] },
            },
          },
        ]);
      if (kind === 'nested-tabs')
        root = tabs('complete', [panel('outer-a', 'a', [tabs('inner')]), panel('outer-b', 'b')]);
      const document = setup(root);
      expect(() => document.copyNodeToClipboard('source', root.id)).not.toThrow();
      document.pasteClipboard('target');
      const { runtime } = renderPasted(document);
      try {
        expect(screen.getAllByRole('tab').length).toBeGreaterThanOrEqual(2);
        expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
      } finally {
        runtime.dispose();
      }
    },
  );
  it.each(['sibling', 'below-panel', 'slot-descendant'] as const)(
    'rejects duplicate nearest-context nonempty values in %s location',
    (kind) => {
      const nested =
        kind === 'below-panel'
          ? [panel('first', 'same', [panel('descendant', 'same')])]
          : kind === 'slot-descendant'
            ? [
                panel('first', 'same'),
                {
                  id: 'card',
                  component: 'ui.card',
                  props: {},
                  slots: {
                    footer: { params: [], children: [panel('second', 'same')] },
                    header: { params: [], children: [] },
                  },
                },
              ]
            : [panel('first', 'same'), panel('second', 'same')];
      const root = tabs('duplicate', nested),
        document = setup(root);
      expect(() => document.copyNodeToClipboard('source', root.id)).toThrow(/重复/);
    },
  );
  it('allows independent nested duplicate values and actual isolated tab selection', () => {
    const root = tabs('outer', [
        panel('outer-first', 'a', [tabs('inner')]),
        panel('outer-second', 'b'),
      ]),
      document = setup(root);
    document.copyNodeToClipboard('source', root.id);
    document.pasteClipboard('target');
    const { runtime } = renderPasted(document);
    try {
      const outer = screen.getByRole('tablist', { name: 'Tabs outer' }),
        inner = screen.getByRole('tablist', { name: 'Tabs inner' });
      const outerTabs = within(outer).getAllByRole('tab'),
        innerTabs = within(inner).getAllByRole('tab');
      fireEvent.click(innerTabs[1]);
      expect(innerTabs[1].getAttribute('aria-selected')).toBe('true');
      expect(outerTabs[0].getAttribute('aria-selected')).toBe('true');
      fireEvent.click(outerTabs[1]);
      expect(outerTabs[1].getAttribute('aria-selected')).toBe('true');
      expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
  it('allows empty values with distinct runtime fallback identities', () => {
    const root = tabs('empty-values', [panel('empty-a', ''), panel('empty-b', '')]),
      document = setup(root);
    document.copyNodeToClipboard('source', root.id);
    document.pasteClipboard('target');
    const { runtime } = renderPasted(document);
    try {
      const choices = screen.getAllByRole('tab');
      expect(choices).toHaveLength(2);
      expect(choices[0].getAttribute('aria-selected')).toBe('true');
      fireEvent.click(choices[1]);
      expect(choices[1].getAttribute('aria-selected')).toBe('true');
      expect(choices[0].getAttribute('aria-selected')).toBe('false');
      expect(choices[0].id).not.toBe(choices[1].id);
      expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
});

describe('clipboard built-in slot fanout closure', () => {
  it.each(
    fanoutCases.flatMap(({ component, slot }) =>
      [0, 1, 2].flatMap((count) =>
        ['', 'explicit'].map((value) => ({ component, slot, count, value })),
      ),
    ),
  )(
    'rejects crossed $component.$slot with $count rows and Panel value "$value"',
    ({ component, slot, count, value }) => {
      const root = tabs('owner', [
          fanout('fanout', component, slot, [layout('wrapper', [panel('crossed', value)])], count),
        ]),
        document = setup(root);
      expect(() => document.copyNodeToClipboard('source', root.id)).toThrow(/重复插槽|完整标签页/);
    },
  );
  it.each(fanoutCases)(
    'allows a full Tabs owner inside $component.$slot and renders independent instances',
    ({ component, slot }) => {
      const root = fanout('fanout', component, slot, [tabs('inside')]),
        document = setup(root);
      document.copyNodeToClipboard('source', root.id);
      document.pasteClipboard('target');
      const { runtime } = renderPasted(document);
      try {
        const lists = screen.getAllByRole('tablist', { name: 'Tabs inside' });
        expect(lists).toHaveLength(2);
        const first = within(lists[0]).getAllByRole('tab'),
          second = within(lists[1]).getAllByRole('tab');
        fireEvent.click(first[1]);
        expect(first[1].getAttribute('aria-selected')).toBe('true');
        expect(second[0].getAttribute('aria-selected')).toBe('true');
        expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
      } finally {
        runtime.dispose();
      }
    },
  );
  it.each(['ui.card', 'ui.dialog', 'ui.drawer'])(
    'permits normal %s footer slots without fanout restrictions',
    (component) => {
      const root = tabs('owner', [
          {
            id: 'normal-slot',
            component,
            props: { title: literal('Normal slot') },
            slots: {
              footer: { params: [], children: [panel('panel', 'a')] },
              ...(component === 'ui.card' ? { header: { params: [], children: [] } } : {}),
            },
          },
        ]),
        document = setup(root);
      expect(() => document.copyNodeToClipboard('source', root.id)).not.toThrow();
      expect(() => document.pasteClipboard('target')).not.toThrow();
    },
  );
});
