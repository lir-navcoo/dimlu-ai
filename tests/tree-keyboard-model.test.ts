import { describe, expect, it } from 'vitest';
import {
  buildTreeNavigation,
  treeNavigationAction,
  type TreeNavigationKey,
} from '../src/editor/tree-navigation';
import type { NodeSchema } from '../packages/schema/types';

const leaf = (id: string): NodeSchema => ({ id, component: 'leaf', props: {} });
const roots: NodeSchema[] = [
  {
    id: 'root',
    component: 'box',
    props: {},
    children: [
      leaf('a'),
      { id: 'group', component: 'box', props: {}, children: [leaf('b'), leaf('q')] },
    ],
    slots: {
      header: { params: [], children: [leaf('hs')] },
      footer: {
        params: [],
        children: [{ id: 'wrap', component: 'box', props: {}, children: [leaf('slotq')] }],
      },
    },
  },
  leaf('tail'),
  { id: 'empty', component: 'box', props: {} },
  { ...leaf('hidden'), when: { kind: 'literal', value: false } },
  {
    ...leaf('repeated'),
    repeat: {
      items: { kind: 'literal', value: [1, 2] },
      item: 'item',
      key: { kind: 'expression', language: 'javascript', source: 'scope.item' },
    },
  },
];
const build = (query = '', closed: string[] = []) =>
  buildTreeNavigation({
    roots,
    query,
    closed,
    searchText: (node) => `${node.id} caption`,
    canExpand: (node) => node.component === 'box',
  });
const ids = (model: ReturnType<typeof build>) => model.rows.map((row) => row.node.id);
const order = [
  'root',
  'a',
  'group',
  'b',
  'q',
  'hs',
  'wrap',
  'slotq',
  'tail',
  'empty',
  'hidden',
  'repeated',
];

describe('pure visible definition model matches each rendered list', () => {
  it('uses children before ordered slots and one row for hidden/repeated definitions without mutating input', () => {
    const original = structuredClone(roots),
      model = build();
    expect(ids(model)).toEqual(order);
    expect([...model.byId.keys()]).toEqual(order);
    expect(roots).toEqual(original);
    expect(model.byId.get('root')!.node).toBe(roots[0]);
    expect(model.byId.get('hs')!.parentId).toBe('root');
    expect(model.byId.get('wrap')!.parentId).toBe('root');
    expect(model.byId.get('slotq')!.parentId).toBe('wrap');
    expect(model.byId.get('tail')!.parentId).toBeNull();
    expect(model.byId.get('empty')!.expandable).toBe(true);
  });
  it('closed descriptors keep structural descendants while rows and byId only expose visible definitions', () => {
    const model = build('', ['group', 'root']);
    expect(ids(model)).toEqual(['root', 'tail', 'empty', 'hidden', 'repeated']);
    expect(model.byId.has('group')).toBe(false);
    expect(model.byId.has('q')).toBe(false);
    expect(model.roots[0].children.map((row) => row.node.id)).toEqual(['a', 'group']);
    expect(model.roots[0].open).toBe(false);
  });
  it.each(['q', 'Q'])('independently filters every list by descendant-aware query %s', (query) => {
    const model = build(query, ['root', 'group', 'wrap']);
    expect(ids(model)).toEqual(['root', 'group', 'q', 'wrap', 'slotq']);
    expect(model.rows.every((row) => row.open)).toBe(true);
    expect(
      model.roots[0].slots.map((slot) => [slot.name, slot.children.map((row) => row.node.id)]),
    ).toEqual([
      ['header', []],
      ['footer', ['wrap']],
    ]);
  });
  it.each(['root', 'group'])(
    'a parent self-match %s does not expose nonmatching descendants',
    (query) => {
      expect(ids(build(query))).toEqual(query === 'root' ? ['root'] : ['root', 'group']);
    },
  );
  it('raw-space truthiness forces open; query is never trimmed', () => {
    expect(ids(build(' ', ['root', 'group', 'wrap']))).toEqual(order);
    expect(ids(build('   ', ['root']))).toEqual([]);
    expect(build('   ').query).toBe('   ');
  });
  it('empty roots and no matches do not invent a primary/root fallback', () => {
    const model = buildTreeNavigation({
      roots: [],
      query: '',
      closed: [],
      searchText: () => '',
      canExpand: () => true,
    });
    expect(model.rows).toEqual([]);
    expect(model.roots).toEqual([]);
    expect(model.byId.size).toBe(0);
    for (const key of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
    ] as TreeNavigationKey[])
      expect(treeNavigationAction(model, 'missing', key)).toEqual({ kind: 'none' });
  });
});

describe('six-key visible traversal decisions', () => {
  it.each([
    ['a', 'ArrowDown', 'group'],
    ['a', 'ArrowUp', 'root'],
    ['tail', 'Home', 'root'],
    ['root', 'End', 'repeated'],
    ['group', 'ArrowRight', 'b'],
    ['hs', 'ArrowLeft', 'root'],
    ['slotq', 'ArrowLeft', 'wrap'],
    ['wrap', 'ArrowRight', 'slotq'],
    ['repeated', 'ArrowUp', 'hidden'],
  ])('%s %s moves to %s', (from, key, destination) =>
    expect(treeNavigationAction(build(), from, key as TreeNavigationKey)).toEqual({
      kind: 'move',
      nodeId: destination,
    }),
  );
  it.each([
    ['root', 'ArrowUp'],
    ['repeated', 'ArrowDown'],
    ['root', 'Home'],
    ['repeated', 'End'],
    ['tail', 'ArrowLeft'],
    ['a', 'ArrowRight'],
    ['empty', 'ArrowRight'],
    ['missing', 'End'],
  ])('%s %s is a nonwrapping exact none', (from, key) =>
    expect(treeNavigationAction(build(), from, key as TreeNavigationKey)).toEqual({ kind: 'none' }),
  );
  it('Right opens only; next Right can enter a rendered child, while Left collapses only', () => {
    expect(treeNavigationAction(build('', ['root']), 'root', 'ArrowRight')).toEqual({
      kind: 'expand',
      nodeId: 'root',
    });
    expect(treeNavigationAction(build(), 'root', 'ArrowRight')).toEqual({
      kind: 'move',
      nodeId: 'a',
    });
    expect(treeNavigationAction(build(), 'group', 'ArrowLeft')).toEqual({
      kind: 'collapse',
      nodeId: 'group',
    });
    expect(treeNavigationAction(build('', ['group']), 'group', 'ArrowLeft')).toEqual({
      kind: 'move',
      nodeId: 'root',
    });
  });
  it('query uses visible parent/actual visible children and never returns collapse/expand', () => {
    const model = build('q', ['root', 'group']);
    expect(treeNavigationAction(model, 'group', 'ArrowLeft')).toEqual({
      kind: 'move',
      nodeId: 'root',
    });
    expect(treeNavigationAction(model, 'root', 'ArrowRight')).toEqual({
      kind: 'move',
      nodeId: 'group',
    });
    expect(treeNavigationAction(build('root'), 'root', 'ArrowRight')).toEqual({ kind: 'none' });
    expect(treeNavigationAction(build('root'), 'root', 'ArrowLeft')).toEqual({ kind: 'none' });
  });
});
