import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { inspectBulkDuplicateTree } from '../packages/editor/bulk-duplicate';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import type { NodeSchema } from '../packages/schema/types';
import { materials } from '../src/materials';
import {
  bulkLayout,
  bulkNode,
  bulkPage,
  bulkPanel,
  bulkSetup,
  bulkTabs,
  bulkText,
  lit,
} from './bulk-duplicate-fixture';

const runtimes: PageRuntime[] = [];
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
});
const renderPage = (document: EditorDocument) => {
  const runtime = new PageRuntime(document.getSnapshot().plan, 'a');
  runtimes.push(runtime);
  render(<RuntimeRenderer runtime={runtime} materials={materials} />);
  return runtime;
};
const repeat = (count = 2) => ({
  items: lit(Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }))),
  item: 'row',
  key: { kind: 'expression' as const, language: 'javascript' as const, source: 'scope.row.id' },
});
const fanoutCases = [
  { component: 'ui.list', slot: 'item' },
  { component: 'ui.table', slot: 'cell' },
  { component: 'ui.table', slot: 'actions' },
];
function fanout(
  component: string,
  slot: string,
  children: NodeSchema[],
  count: number,
): NodeSchema {
  const registry = bulkSetup().registry;
  return {
    id: 'fanout',
    component,
    props: {
      data: lit(Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, name: 'Row' }))),
      ...(component === 'ui.table' ? { columns: lit([{ key: 'name', title: 'Name' }]) } : {}),
    },
    slots: Object.fromEntries(
      Object.entries(registry.components[component].slots!).map(([name, params]) => [
        name,
        { params: [...params], children: name === slot ? children : [] },
      ]),
    ),
  };
}

describe('bulk-only nearest Tabs context', () => {
  it.each(['orphan', 'wrapped', 'several-external-panels'] as const)(
    'rejects %s atomically without changing old single duplicate or static clipboard rules',
    (kind) => {
      const root =
        kind === 'orphan'
          ? bulkPanel('panel')
          : kind === 'wrapped'
            ? bulkLayout('wrapper', [bulkPanel('panel')])
            : bulkTabs('owner', [bulkPanel('first', 'a'), bulkPanel('second', 'b')]);
      const { document } = bulkSetup([root]);
      const ids = kind === 'several-external-panels' ? ['first', 'second'] : [root.id];
      const before = document.getSnapshot();
      expect(() => document.checkDuplicateNodes('a', ids)).toThrow('请复制完整标签页容器');
      expect(() => document.duplicateNodes('a', ids)).toThrow('请复制完整标签页容器');
      expect(document.getSnapshot()).toBe(before);
      expect(() => document.copyNodeToClipboard('a', ids[0])).toThrow('请复制完整标签页容器');
      expect(() => document.duplicateNode('a', ids[0])).not.toThrow();
    },
  );

  it.each(['siblings', 'panel-descendant', 'card-slot'] as const)(
    'rejects duplicate nonempty values through %s even when mutually hidden',
    (kind) => {
      const first = bulkPanel('first', 'same');
      const second = bulkPanel('second', 'same');
      first.when = lit(false);
      second.when = lit(false);
      const children =
        kind === 'siblings'
          ? [first, second]
          : kind === 'panel-descendant'
            ? [{ ...first, children: [second] }]
            : [
                first,
                {
                  id: 'card',
                  component: 'ui.card',
                  props: {},
                  slots: { footer: { params: [], children: [second] } },
                },
              ];
      const { document } = bulkSetup([bulkTabs('owner', children)]);
      const before = document.getSnapshot();
      expect(() => document.duplicateNodes('a', ['owner'])).toThrow(/重复/);
      expect(document.getSnapshot()).toBe(before);
    },
  );

  it.each(['expression', 'stateRef'] as const)('rejects dynamic %s Panel values', (kind) => {
    const panel = bulkPanel('dynamic');
    panel.props.value =
      kind === 'expression'
        ? { kind, language: 'javascript', source: 'state.caption' }
        : { kind, stateId: 'caption' };
    const { document } = bulkSetup([bulkTabs('owner', [panel])]);
    const before = document.getSnapshot();
    expect(() => document.duplicateNodes('a', ['owner'])).toThrow(/静态文本/);
    expect(document.getSnapshot()).toBe(before);
  });

  it('helper supports omitted defaults without loosening the built-in required-value Schema contract', () => {
    const first = bulkPanel('first');
    const second = bulkPanel('second');
    delete first.props.value;
    delete second.props.value;
    const root = bulkTabs('owner', [first, second]);
    expect(() => inspectBulkDuplicateTree(root)).not.toThrow();
    expect(() => bulkSetup([root])).toThrow(/缺少属性 value/);
  });

  it('allows empty fallback identities and two complete copied Tabs remain independent', () => {
    const { document } = bulkSetup([
      bulkTabs('owner', [bulkPanel('first', ''), bulkPanel('second', '')]),
    ]);
    document.duplicateNodes('a', ['owner']);
    const runtime = renderPage(document);
    const lists = screen.getAllByRole('tablist', { name: 'Tabs owner' });
    expect(lists).toHaveLength(2);
    const first = within(lists[0]).getAllByRole('tab');
    const second = within(lists[1]).getAllByRole('tab');
    expect(first[0].id).not.toBe(second[0].id);
    fireEvent.click(first[1]);
    expect(first[1].getAttribute('aria-selected')).toBe('true');
    expect(second[0].getAttribute('aria-selected')).toBe('true');
    expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
  });

  it('nested complete owners reset value sets and copied runtime instances switch independently', () => {
    const { document } = bulkSetup([
      bulkTabs('outer', [
        bulkPanel('outer-a', 'a', [bulkTabs('inner')]),
        bulkPanel('outer-b', 'b'),
      ]),
    ]);
    document.duplicateNodes('a', ['outer']);
    const runtime = renderPage(document);
    const outer = screen.getAllByRole('tablist', { name: 'Tabs outer' });
    const inner = screen.getAllByRole('tablist', { name: 'Tabs inner' });
    expect(outer).toHaveLength(2);
    expect(inner).toHaveLength(2);
    fireEvent.click(within(inner[0]).getAllByRole('tab')[1]);
    expect(within(inner[1]).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    expect(within(outer[0]).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
  });

  it.each(
    fanoutCases.flatMap((owner) =>
      [0, 2].flatMap((count) => ['', 'a'].map((value) => ({ ...owner, count, value }))),
    ),
  )(
    'rejects crossed $component.$slot with $count rows and value "$value"',
    ({ component, slot, count, value }) => {
      const { document } = bulkSetup([
        bulkTabs('owner', [
          fanout(component, slot, [bulkLayout('wrap', [bulkPanel('panel', value)])], count),
        ]),
      ]);
      expect(() => document.duplicateNodes('a', ['owner'])).toThrow(/重复插槽/);
    },
  );

  it.each(fanoutCases)(
    'nested complete Tabs resets $component.$slot fanout',
    ({ component, slot }) => {
      const { document } = bulkSetup([
        bulkTabs('outer', [fanout(component, slot, [bulkTabs('inner')], 2)]),
      ]);
      expect(() => document.duplicateNodes('a', ['outer'])).not.toThrow();
    },
  );

  it.each(['panel', 'wrapper'] as const)(
    'rejects internal repeated %s even with empty rows',
    (kind) => {
      const panel = bulkPanel('panel', '');
      const node = kind === 'panel' ? panel : bulkLayout('repeat-wrap', [panel]);
      node.repeat = repeat(0);
      const { document } = bulkSetup([bulkTabs('owner', [node])]);
      expect(() => document.duplicateNodes('a', ['owner'])).toThrow(/循环|重复插槽/);
    },
  );

  it('complete repeated Tabs is a context boundary and renders four independent owners after copy', () => {
    const root = bulkTabs('repeated');
    root.repeat = repeat();
    const { document } = bulkSetup([root]);
    document.duplicateNodes('a', ['repeated']);
    const runtime = renderPage(document);
    const lists = screen.getAllByRole('tablist', { name: 'Tabs repeated' });
    expect(lists).toHaveLength(4);
    fireEvent.click(within(lists[0]).getAllByRole('tab')[1]);
    expect(within(lists[3]).getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('true');
    expect(runtime.getRecords().filter((record) => record.kind === 'node.error')).toEqual([]);
  });

  it('does not reject unrelated imported Tabs defects outside selected roots', () => {
    const { document } = bulkSetup([
      bulkTabs('unrelated', [bulkPanel('bad-a', 'same'), bulkPanel('bad-b', 'same')]),
      bulkText('safe'),
    ]);
    expect(() => document.duplicateNodes('a', ['safe'])).not.toThrow();
    expect(bulkPage(document).children[0].id).toBe('unrelated');
  });
});

describe('bulk copies preserve actual shared model semantics', () => {
  it('copied bound forms share the original field model rather than creating model or runtime data copies', () => {
    const root: NodeSchema = {
      id: 'form',
      component: 'ui.form',
      formId: 'model',
      props: {},
      children: [
        {
          id: 'input',
          component: 'ui.input',
          props: {},
          field: { formId: 'model', fieldId: 'name' },
        },
      ],
    };
    const { document } = bulkSetup([root]);
    const [copy] = document.duplicateNodes('a', ['form']);
    expect(bulkNode(document, copy).formId).toBe('model');
    expect(bulkNode(document, copy).children![0].field).toEqual({
      formId: 'model',
      fieldId: 'name',
    });
    expect(bulkPage(document).forms).toHaveLength(1);
    const runtime = renderPage(document);
    const inputs = screen.getAllByRole('textbox', { name: 'Name' }) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[0], { target: { value: 'Shared original model' } });
    expect(inputs[1].value).toBe('Shared original model');
    expect(runtime.getForm('model').getSnapshot().values.name).toBe('Shared original model');
    act(() => runtime.getForm('model').setValue('name', 'Both controls'));
    expect(inputs.map((input) => input.value)).toEqual(['Both controls', 'Both controls']);
  });
});
