import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import type { NodeSchema } from '../packages/schema/types';
import { pageNodeOrder } from '../packages/editor/selection';
import { selectionRegistry } from './multiselection-fixture';
import {
  allBulkNodes,
  bulkNode,
  bulkPage,
  bulkSetup,
  bulkText,
  lit,
  stripBulkIdentities,
} from './bulk-duplicate-fixture';

afterEach(() => vi.restoreAllMocks());

describe('atomic original-owner multi-root duplication', () => {
  it('regenerates every child and slot action ID while retaining inputs,result targets and opaque references', () => {
    const { schema, registry } = bulkSetup();
    const execute = vi.fn(() => 'unused');
    registry.actions['test.bulkEffect'] = {
      version: '1.0.0',
      input: { payload: { type: 'json', required: true } },
      output: 'string',
      execute,
    };
    schema.dependencies.actions['test.bulkEffect'] = '1.0.0';
    schema.dependencies.components['ui.button'] = '1.0.0';
    const button = (id: string): NodeSchema => ({
      id,
      component: 'ui.button',
      props: { label: lit(id) },
      on: {
        onClick: [
          {
            id: `${id}-action`,
            action: 'test.bulkEffect',
            input: { payload: { kind: 'fieldRef', formId: 'model', fieldId: 'name' } },
            resultTo: 'caption',
          },
        ],
      },
      extensions: { 'test:opaque': { actionId: `${id}-action`, selector: `#${id}` } },
    });
    const source: NodeSchema = {
      id: 'action-card',
      component: 'ui.card',
      props: {},
      children: [button('child-button')],
      slots: { footer: { params: [], children: [button('slot-button')] } },
    };
    schema.pages[0].children.push(source);
    const document = new EditorDocument(schema, registry);
    const [copyId] = document.duplicateNodes('a', ['action-card']);
    const copy = bulkNode(document, copyId);
    const calls = (node: NodeSchema) =>
      allBulkNodes([node]).flatMap((child) => Object.values(child.on ?? {}).flat());
    expect(calls(copy)).toHaveLength(2);
    expect(calls(copy).map((call) => call.id)).not.toEqual(calls(source).map((call) => call.id));
    expect(new Set([...calls(source), ...calls(copy)].map((call) => call.id)).size).toBe(4);
    expect(stripBulkIdentities(copy)).toEqual(stripBulkIdentities(source));
    expect(execute).not.toHaveBeenCalled();
  });

  it('copied field arrays keep original form,array and field references with unchanged model definitions', () => {
    const { schema, registry } = bulkSetup();
    schema.dependencies.components['ui.form'] = '1.0.0';
    schema.dependencies.components['ui.fieldArray'] = '1.0.0';
    schema.pages[0].forms![0].arrays = [
      {
        id: 'lines',
        path: ['lines'],
        label: 'Lines',
        fields: [{ id: 'title', path: ['title'], label: 'Title', type: 'string', initial: '' }],
        initial: [{ title: 'Initial row' }],
      },
    ];
    schema.pages[0].children.push({
      id: 'bound-form',
      component: 'ui.form',
      formId: 'model',
      props: {},
      children: [
        {
          id: 'bound-array',
          component: 'ui.fieldArray',
          props: { formId: lit('model'), arrayId: lit('lines') },
        },
        {
          id: 'referenced-text',
          component: 'ui.text',
          props: { value: { kind: 'fieldRef', formId: 'model', fieldId: 'name' } },
        },
      ],
    });
    const document = new EditorDocument(schema, registry);
    const models = bulkPage(document).forms;
    const [copyId] = document.duplicateNodes('a', ['bound-form']);
    const copy = bulkNode(document, copyId);
    expect(copy.formId).toBe('model');
    expect(copy.children![0].props).toEqual({ formId: lit('model'), arrayId: lit('lines') });
    expect(copy.children![1].props.value).toEqual({
      kind: 'fieldRef',
      formId: 'model',
      fieldId: 'name',
    });
    expect(bulkPage(document).forms).toEqual(models);
    expect(bulkPage(document).forms).toHaveLength(1);
    expect(bulkPage(document).forms![0].arrays).toHaveLength(1);
  });

  it.each([
    ['adjacent', ['tail', 'shared']],
    ['nonadjacent', ['root', 'shared']],
  ] as const)('inserts each %s copy directly after its own source', (_, ids) => {
    const { document } = bulkSetup();
    const copies = document.duplicateNodes('a', [...ids].reverse());
    const pairs = new Map<string, string>(ids.map((id, index) => [id, copies[index]]));
    expect(bulkPage(document).children.map((node) => node.id)).toEqual(
      ['root', 'tail', 'shared'].flatMap((id) => (pairs.has(id) ? [id, pairs.get(id)] : [id])),
    );
    expect(copies).toHaveLength(2);
    expect(document.getSnapshot().selection.nodeIds).toEqual(copies);
  });

  it('keeps same-index child and named-slot owners independent with structural result order', () => {
    const { document } = bulkSetup();
    const copies = document.duplicateNodes('a', ['slot-leaf', 'header', 'body', 'alpha']);
    expect(copies).toHaveLength(4);
    expect(bulkNode(document, 'root').children!.map((node) => node.id)).toEqual([
      'alpha',
      copies[0],
      'card',
    ]);
    expect(bulkNode(document, 'card').children!.map((node) => node.id)).toEqual([
      'body',
      copies[1],
    ]);
    expect(bulkNode(document, 'card').slots!.header.children.map((node) => node.id)).toEqual([
      'header',
      copies[2],
    ]);
    expect(bulkNode(document, 'slot-wrap').children!.map((node) => node.id)).toEqual([
      'slot-leaf',
      copies[3],
    ]);
  });

  it('absorbs descendants and duplicates once,returning exact single selection shape', () => {
    const { document } = bulkSetup();
    document.selectMany('a', ['card', 'header', 'slot-leaf'], 'slot-leaf');
    const copies = document.duplicateNodes('a', ['slot-leaf', 'card', 'header', 'card']);
    expect(copies).toHaveLength(1);
    expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: copies[0] });
    expect(bulkNode(document, 'root').children!.map((node) => node.id)).toEqual([
      'alpha',
      'card',
      copies[0],
    ]);
    expect(stripBulkIdentities(bulkNode(document, copies[0]))).toEqual(
      stripBulkIdentities(bulkNode(document, 'card')),
    );
  });

  it('maps absorbed descendant primary to its new top root and restores raw selection in one Undo', () => {
    const { document } = bulkSetup();
    document.selectMany('a', ['card', 'header', 'tail'], 'header');
    const before = document.getSnapshot();
    const notify = vi.fn();
    document.subscribe(notify);
    const copies = document.duplicateNodes('a', ['tail', 'header', 'card']);
    const after = document.getSnapshot();
    expect(notify).toHaveBeenCalledOnce();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.selection).toEqual({ pageId: 'a', nodeId: copies[0], nodeIds: copies });
    document.undo();
    expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
    expect(document.getSnapshot().selection).toEqual(before.selection);
    expect(document.getSnapshot().canUndo).toBe(false);
    document.redo();
    expect(document.getSnapshot().plan.schema).toEqual(after.plan.schema);
    expect(document.getSnapshot().selection).toEqual(after.selection);
  });

  it('maps a later source primary without changing canonical result order', () => {
    const { document } = bulkSetup();
    document.selectMany('a', ['alpha', 'tail'], 'tail');
    const copies = document.duplicateNodes('a', ['tail', 'alpha']);
    expect(document.getSnapshot().selection).toEqual({
      pageId: 'a',
      nodeId: copies[1],
      nodeIds: copies,
    });
  });

  it('noncurrent-page success selects copies;Undo restores actual prior-page multi', () => {
    const { document } = bulkSetup();
    document.selectMany('a', ['header', 'tail'], 'tail');
    const old = document.getSnapshot().selection;
    const copies = document.duplicateNodes('b', ['b-two', 'b-one']);
    expect(document.getSnapshot().selection).toEqual({
      pageId: 'b',
      nodeId: copies[0],
      nodeIds: copies,
    });
    expect(bulkNode(document, 'b-root', 'b').children!.map((node) => node.id)).toEqual([
      'b-one',
      copies[0],
      'b-two',
      copies[1],
    ]);
    document.undo();
    expect(document.getSnapshot().selection).toEqual(old);
    document.redo();
    expect(document.getSnapshot().selection.nodeIds).toEqual(copies);
  });

  it.each(['a', 'b'])(
    'empty IDs on existing page %s preserve exact snapshot,redo and future IDs',
    (pageId) => {
      const { schema, document } = bulkSetup();
      const control = new EditorDocument(schema, selectionRegistry());
      for (const candidate of [document, control]) {
        candidate.setProp('a', 'alpha', 'value', lit('temporary'));
        candidate.undo();
        candidate.selectMany('a', ['alpha', 'tail'], 'tail');
      }
      const before = document.getSnapshot();
      const notify = vi.fn();
      document.subscribe(notify);
      expect(document.duplicateNodes(pageId, [])).toEqual([]);
      document.checkDuplicateNodes(pageId, []);
      expect(document.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
      expect(before.canRedo).toBe(true);
      expect(document.duplicateNodes('a', ['alpha', 'tail'])).toEqual(
        control.duplicateNodes('a', ['alpha', 'tail']),
      );
    },
  );

  it.each([
    { pageId: 'missing', ids: [] },
    { pageId: 'missing', ids: ['alpha'] },
    { pageId: 'a', ids: ['alpha', 'missing'] },
    { pageId: 'a', ids: ['b-one', 'tail'] },
  ])('rejects entire invalid group $pageId/$ids without spending identities', ({ pageId, ids }) => {
    const { schema, document } = bulkSetup();
    const control = new EditorDocument(schema, selectionRegistry());
    const before = document.getSnapshot();
    for (const run of [document.checkDuplicateNodes, document.duplicateNodes]) {
      expect(() => run(pageId, ids)).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
    expect(document.duplicateNodes('a', ['alpha'])).toEqual(control.duplicateNodes('a', ['alpha']));
  });

  it('repeated preflight has no document,clipboard,history or allocator side effects', () => {
    const { schema, document } = bulkSetup();
    const control = new EditorDocument(schema, selectionRegistry());
    document.copyNodeToClipboard('a', 'alpha');
    const before = document.getSnapshot();
    const clipboard = document.getClipboardSnapshot();
    const notify = vi.fn();
    const clipNotify = vi.fn();
    document.subscribe(notify);
    document.subscribeClipboard(clipNotify);
    document.checkDuplicateNodes('a', ['card', 'alpha']);
    document.checkDuplicateNodes('a', ['alpha', 'card', 'header']);
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toBe(clipboard);
    expect(notify).not.toHaveBeenCalled();
    expect(clipNotify).not.toHaveBeenCalled();
    expect(document.duplicateNodes('a', ['card', 'alpha'])).toEqual(
      control.duplicateNodes('a', ['card', 'alpha']),
    );
  });

  it('late compile rejection rolls back exact state and local allocator for the next good command', () => {
    const { schema, registry, document } = bulkSetup();
    const control = new EditorDocument(schema, selectionRegistry());
    for (const candidate of [document, control]) {
      candidate.setProp('a', 'alpha', 'value', lit('temporary'));
      candidate.undo();
      candidate.selectMany('a', ['alpha', 'header']);
    }
    const before = document.getSnapshot();
    const previous = registry.components['ui.text'];
    registry.components['ui.text'] = { ...previous, validateProps: () => ['late bulk reject'] };
    for (const run of [document.checkDuplicateNodes, document.duplicateNodes]) {
      expect(() => run('a', ['alpha', 'header', 'tail'])).toThrow();
      expect(document.getSnapshot()).toBe(before);
    }
    registry.components['ui.text'] = previous;
    expect(document.duplicateNodes('a', ['alpha', 'header', 'tail'])).toEqual(
      control.duplicateNodes('a', ['alpha', 'header', 'tail']),
    );
  });

  it('recursive node/action allocation avoids all page node,onEnter and action identities', () => {
    const { schema, registry } = bulkSetup();
    schema.dependencies.components['ui.button'] = '1.0.0';
    schema.pages[0].children.push(bulkText('alpha-copy-1'));
    schema.pages[0].onEnter!.push({
      id: 'tail-copy-4',
      action: 'state.set',
      input: { stateId: lit('caption'), value: lit('entry') },
    });
    schema.pages[0].children.push({
      id: 'event-node',
      component: 'ui.button',
      props: { label: lit('Action') },
      on: {
        onClick: [
          {
            id: 'alpha-copy-2',
            action: 'state.set',
            input: { stateId: lit('caption'), value: lit('event') },
          },
        ],
      },
    });
    const document = new EditorDocument(schema, registry);
    const copies = document.duplicateNodes('a', ['alpha', 'tail', 'event-node', 'card']);
    const nodes = allBulkNodes(bulkPage(document).children);
    const identities = [
      ...nodes.flatMap((node) => [
        node.id,
        ...Object.values(node.on ?? {})
          .flat()
          .map((call) => call.id),
      ]),
      ...bulkPage(document).onEnter!.map((call) => call.id),
    ];
    expect(new Set(identities).size).toBe(identities.length);
    expect(copies).toHaveLength(4);
    const originals = ['alpha', 'card', 'tail', 'event-node'];
    copies.forEach((id, index) => {
      const source = bulkNode(document, originals[index]);
      const copy = bulkNode(document, id);
      expect(stripBulkIdentities(copy)).toEqual(stripBulkIdentities(source));
      expect(copy.props).not.toBe(source.props);
      expect(
        allBulkNodes([copy]).every((node) => !pageNodeOrder(schema.pages[0]).includes(node.id)),
      ).toBe(true);
    });
  });

  it('preserves dynamic binding,repeat scope,styles,extensions and page definitions without hidden-ID rewriting', () => {
    const { schema, registry } = bulkSetup();
    const source = schema.pages[0].children[0];
    source.repeat = {
      items: lit([{ id: 'one', name: 'Alpha' }]),
      item: 'row',
      key: { kind: 'expression', language: 'javascript', source: 'scope.row.id' },
    };
    source.when = lit(true);
    source.extensions = { 'test:hidden': { selector: '#alpha', nodeId: 'alpha' } };
    source.children![0].props.value = {
      kind: 'expression',
      language: 'javascript',
      source: 'scope.row.name',
    };
    source.children![0].style = { color: lit('red') };
    const document = new EditorDocument(schema, registry);
    const { children: ignored, ...pageDefinitions } = bulkPage(document);
    const [copy] = document.duplicateNodes('a', ['root']);
    const { children: copiedChildren, ...afterDefinitions } = bulkPage(document);
    expect(afterDefinitions).toEqual(pageDefinitions);
    expect(stripBulkIdentities(bulkNode(document, copy))).toEqual(stripBulkIdentities(source));
    expect(bulkNode(document, copy).extensions).toEqual(source.extensions);
    expect(document.getSnapshot().plan.schema.dependencies).toEqual(schema.dependencies);
  });
});
