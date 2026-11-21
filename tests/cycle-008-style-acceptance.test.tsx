import type { CSSProperties, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { ProjectStorage } from '../packages/editor/project-storage';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import type { Registry } from '../packages/runtime/registry';
import type { ApplicationSchema, Json, NodeSchema, Value } from '../packages/schema/types';
import { RuntimeRenderer, type ReactMaterials } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import { catalog } from '../src/editor/catalog';

const runtimes: PageRuntime[] = [];
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
});
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const capabilities: Registry = {
  ...registry,
  components: {
    ...registry.components,
    'acceptance.native': {
      version: '1.0.0',
      props: { text: { type: 'string', required: true } },
      style: { target: 'root', properties: ['width', 'color', 'lineHeight'] },
    },
    'acceptance.slot': {
      version: '1.0.0',
      props: {},
      slots: { body: ['row'] },
    },
  },
  transports: {
    ...registry.transports,
    'acceptance.metrics': {
      version: '1.0.0',
      input: {},
      output: 'object',
      execute: () => ({ width: 48 }),
    },
  },
};
const nativeMaterials: ReactMaterials = {
  ...materials,
  'acceptance.native': ({ text, style }: { text: string; style?: CSSProperties }) => (
    <article data-testid="native-target" style={style}>
      <span>{text}</span>
    </article>
  ),
  'acceptance.slot': ({
    slots,
  }: {
    slots: { body: (params: Record<string, unknown>) => ReactNode };
  }) => <div>{slots.body({ row: { width: 37 } })}</div>,
};
function textNode(id = 'text'): NodeSchema {
  return { id, component: 'ui.text', props: { value: literal(id) } };
}
function application(children: NodeSchema[] = [textNode()]): ApplicationSchema {
  return {
    schemaVersion: '0.1.0',
    id: 'cycle-008-style',
    title: '样式独立验收',
    entryPageId: 'page',
    dependencies: {
      components: Object.fromEntries(
        Object.entries(capabilities.components).map(([id, contract]) => [id, contract.version]),
      ),
      actions: {},
      transports: { 'acceptance.metrics': '1.0.0' },
    },
    pages: [
      {
        id: 'page',
        title: 'page',
        state: [
          { id: 'size', type: 'number', initial: 20 },
          { id: 'tone', type: 'string', initial: 'red' },
          { id: 'items', type: 'array', initial: [{ id: 'one', width: 31 }] },
        ],
        forms: [
          {
            id: 'profile',
            fields: [
              {
                id: 'amount',
                path: ['amount'],
                type: 'number',
                label: '数量',
                initial: 16,
              },
              { id: 'spare', path: ['spare'], type: 'number', label: '保留字段', initial: 0 },
            ],
          },
        ],
        dataSources: [
          {
            id: 'metrics',
            kind: 'query',
            transport: 'acceptance.metrics',
            input: {},
            initial: { width: 24 },
          },
        ],
        children,
      },
    ],
  };
}
function runtime(schema: ApplicationSchema, designMode = false) {
  const next = new PageRuntime(compileApplication(schema, capabilities), 'page', { designMode });
  runtimes.push(next);
  return next;
}
function node(document: EditorDocument, id = 'text') {
  return findNode(document.getSnapshot().plan.pages.get('page')!.schema, id)!.node;
}

describe('cycle 008 independent style contract acceptance', () => {
  it('treats empty command patches as no-ops and rejects undeclared material keys/targets', () => {
    const document = new EditorDocument(application(), capabilities);
    const before = document.getSnapshot();
    expect(document.setStyle('page', 'text', {})).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    const explicitEmpty = application();
    explicitEmpty.pages[0].children[0].style = {};
    expect(() => compileApplication(explicitEmpty, capabilities)).not.toThrow();
    const noTarget: NodeSchema = {
      id: 'no-style',
      component: 'acceptance.slot',
      props: {},
      style: {},
    };
    expect(() => compileApplication(application([noTarget]), capabilities)).toThrow(/样式/);
    const native: NodeSchema = {
      id: 'native',
      component: 'acceptance.native',
      props: { text: literal('limited') },
    };
    const limited = new EditorDocument(application([native]), capabilities);
    const snapshot = limited.getSnapshot();
    expect(() => limited.setStyle('page', 'native', { paddingLeft: literal(2) })).toThrow(/样式/);
    expect(limited.getSnapshot()).toBe(snapshot);
  });

  it('patches literals/removals atomically with grouped history and preserves redo on rejection', () => {
    const document = new EditorDocument(application(), capabilities);
    document.setStyle('page', 'text', { width: literal(100), paddingLeft: literal(8) }, 'style');
    document.setStyle('page', 'text', { width: literal(120) }, 'style');
    document.endGroup();
    document.undo();
    expect(node(document).style).toBeUndefined();
    document.redo();
    expect(node(document).style?.width).toEqual(literal(120));
    document.setProp('page', 'text', 'value', literal('temp'));
    document.undo();
    const before = document.getSnapshot();
    expect(() =>
      document.setStyle('page', 'text', {
        width: undefined,
        paddingLeft: literal(-1),
      }),
    ).toThrow();
    expect(document.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    document.setStyle('page', 'text', {
      width: undefined,
      paddingLeft: literal(12),
    });
    expect(node(document).style).toEqual({ paddingLeft: literal(12) });
    document.undo();
    expect(node(document).style).toEqual({
      width: literal(120),
      paddingLeft: literal(8),
    });
    document.redo();
    document.setStyle('page', 'text', { paddingLeft: undefined });
    expect(Object.hasOwn(node(document), 'style')).toBe(false);
  });

  it.each([
    { width: literal(-1) },
    { paddingTop: literal('-1px') },
    { width: literal('calc(100% - 2px)') },
    { color: literal('var(--brand)') },
    { flexGrow: literal('2') },
    { position: literal('fixed') },
  ])('rejects unsupported/invalid style declarations atomically: %j', (patch) => {
    const document = new EditorDocument(application(), capabilities);
    const before = document.getSnapshot();
    expect(() => document.setStyle('page', 'text', patch as never)).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });

  const references: {
    name: string;
    value: Value;
    remove: (document: EditorDocument) => void;
  }[] = [
    {
      name: 'stateRef',
      value: { kind: 'stateRef', stateId: 'size' },
      remove: (d) => d.removeState('page', 'size'),
    },
    {
      name: 'state expression',
      value: expression('state.size'),
      remove: (d) => d.removeState('page', 'size'),
    },
    {
      name: 'dataRef',
      value: { kind: 'dataRef', sourceId: 'metrics', path: ['width'] },
      remove: (d) => d.removeDataSource('page', 'metrics'),
    },
    {
      name: 'source expression',
      value: expression('sources.metrics.data.width'),
      remove: (d) => d.removeDataSource('page', 'metrics'),
    },
    {
      name: 'fieldRef',
      value: { kind: 'fieldRef', formId: 'profile', fieldId: 'amount' },
      remove: (d) => d.removeField('page', 'profile', 'amount'),
    },
    {
      name: 'form expression',
      value: expression('forms.profile.values.amount'),
      remove: (d) => d.removeForm('page', 'profile'),
    },
  ];
  it.each(references)(
    'protects $name referenced only from style during deletion',
    ({ value, remove }) => {
      const document = new EditorDocument(application(), capabilities);
      document.setStyle('page', 'text', { width: value });
      const before = document.getSnapshot();
      expect(() => remove(document)).toThrow();
      expect(document.getSnapshot()).toBe(before);
      document.setStyle('page', 'text', { width: undefined });
      expect(remove(document)).not.toBe(false);
    },
  );

  it('protects repeat style scopes while allowing whole-subtree moves and duplicates', () => {
    const child = textNode('repeated-text');
    child.style = { width: expression('scope.row.width') };
    const repeated: NodeSchema = {
      id: 'repeat',
      component: 'ui.layout',
      props: {},
      repeat: {
        items: { kind: 'stateRef', stateId: 'items' },
        item: 'row',
        key: expression('scope.row.id'),
      },
      children: [child],
    };
    const document = new EditorDocument(application([repeated, textNode('other')]), capabilities);
    const before = document.getSnapshot();
    expect(() => document.moveNode('page', child.id)).toThrow('scope.row');
    expect(() => document.duplicateNode('page', child.id, {})).toThrow('scope.row');
    expect(document.getSnapshot()).toBe(before);
    const copyId = document.duplicateNode('page', repeated.id);
    expect(node(document, copyId).children?.[0].style).toEqual(child.style);
    expect(() => document.moveNode('page', repeated.id, { index: 2 })).not.toThrow();
  });

  it('checks newly authored and moved style references against actual slot parameters', () => {
    const child = textNode('slot-text');
    child.style = { width: expression('scope.row.width') };
    const makeSlot = (id: string, children: NodeSchema[]): NodeSchema => ({
      id,
      component: 'acceptance.slot',
      props: {},
      slots: { body: { params: ['row'], children } },
    });
    const document = new EditorDocument(
      application([makeSlot('one', [child]), makeSlot('two', []), textNode()]),
      capabilities,
    );
    const before = document.getSnapshot();
    expect(() =>
      document.setStyle('page', 'text', {
        width: expression('scope.row.width'),
      }),
    ).toThrow('scope.row');
    expect(() => document.moveNode('page', child.id)).toThrow('scope.row');
    expect(document.getSnapshot()).toBe(before);
    document.moveNode('page', child.id, { parentId: 'two', slot: 'body' });
    expect(node(document, child.id).style).toEqual(child.style);
  });

  it('evaluates repeat and render-slot style scopes in their own runtime instances', () => {
    const repeatedChild = textNode('repeated');
    repeatedChild.style = { width: expression('scope.row.width') };
    const slotChild = textNode('slotted');
    slotChild.style = { width: expression('scope.row.width') };
    const repeated: NodeSchema = {
      id: 'repeat',
      component: 'ui.layout',
      props: {},
      repeat: {
        items: { kind: 'stateRef', stateId: 'items' },
        item: 'row',
        key: expression('scope.row.id'),
      },
      children: [repeatedChild],
    };
    const slotted: NodeSchema = {
      id: 'slot',
      component: 'acceptance.slot',
      props: {},
      slots: { body: { params: ['row'], children: [slotChild] } },
    };
    const rt = runtime(application([repeated, slotted]));
    const view = render(<RuntimeRenderer runtime={rt} materials={nativeMaterials} />);
    const text = () => Array.from(view.container.querySelectorAll<HTMLElement>('.material-text'));
    expect(text().map((element) => element.style.width)).toEqual(['31px', '37px']);
    act(() => rt.setState('items', [{ id: 'one', width: 55 }]));
    expect(text().map((element) => element.style.width)).toEqual(['55px', '37px']);
  });

  it('applies style as an ordinary React prop without a generic DOM wrapper', () => {
    const native: NodeSchema = {
      id: 'native',
      component: 'acceptance.native',
      props: { text: literal('普通 React') },
      style: {
        width: literal(123),
        color: literal('red'),
        lineHeight: literal(1.5),
      },
    };
    const rt = runtime(application([native]));
    const view = render(<RuntimeRenderer runtime={rt} materials={nativeMaterials} />);
    expect(view.container.children).toHaveLength(1);
    const article = view.container.firstElementChild as HTMLElement;
    expect(article.tagName).toBe('ARTICLE');
    expect(article.style.width).toBe('123px');
    expect(article.style.lineHeight).toBe('1.5');
    expect(article.textContent).toBe('普通 React');
  });

  it('omits each bad dynamic declaration, keeps the material alive, deduplicates and recovers', () => {
    const schema = application([
      {
        id: 'native',
        component: 'acceptance.native',
        props: { text: literal('仍然可见') },
        style: {
          width: { kind: 'stateRef', stateId: 'size' },
          color: { kind: 'stateRef', stateId: 'tone' },
          lineHeight: literal(2),
        },
      },
    ]);
    schema.pages[0].state.find((state) => state.id === 'size')!.initial = -1;
    schema.pages[0].state.find((state) => state.id === 'tone')!.initial = 'not-a-color';
    const rt = runtime(schema);
    const view = render(<RuntimeRenderer runtime={rt} materials={nativeMaterials} />);
    const target = screen.getByTestId('native-target');
    const errors = () => rt.getRecords().filter((record) => record.kind === 'style.error');
    expect(target.textContent).toBe('仍然可见');
    expect(target.style.width).toBe('');
    expect(target.style.color).toBe('');
    expect(target.style.lineHeight).toBe('2');
    expect(errors()).toHaveLength(2);
    expect(
      errors().every((error) => error.nodeId === 'native' && error.message.includes('style.')),
    ).toBe(true);
    view.rerender(<RuntimeRenderer runtime={rt} materials={{ ...nativeMaterials }} />);
    expect(errors()).toHaveLength(2);
    act(() => {
      rt.setState('size', 25);
      rt.setState('tone', 'blue');
    });
    expect(target.style.width).toBe('25px');
    expect(target.style.color).toBe('blue');
    act(() => rt.setState('size', -1));
    expect(errors()).toHaveLength(3);
    expect(target.style.width).toBe('');
  });

  it('updates style when only a source snapshot or form field changes', async () => {
    const source = textNode('source');
    source.style = {
      width: { kind: 'dataRef', sourceId: 'metrics', path: ['width'] },
    };
    const field = textNode('field');
    field.style = {
      width: { kind: 'fieldRef', formId: 'profile', fieldId: 'amount' },
    };
    const rt = runtime(application([source, field]));
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
    const [sourceTarget, fieldTarget] = Array.from(
      view.container.querySelectorAll<HTMLElement>('.material-text'),
    );
    expect(sourceTarget.style.width).toBe('24px');
    expect(fieldTarget.style.width).toBe('16px');
    await act(async () => {
      await rt.getDataSource('metrics').execute();
    });
    act(() => rt.getForm('profile').setValue('amount', 32));
    expect(sourceTarget.style.width).toBe('48px');
    expect(fieldTarget.style.width).toBe('32px');
  });

  it('restores Layout props-derived longhands after deleting explicit overrides', () => {
    const layout: NodeSchema = {
      id: 'layout',
      component: 'ui.layout',
      props: { gap: literal(8), padding: literal(12) },
      style: { gap: literal(20), paddingLeft: literal(30) },
    };
    const document = new EditorDocument(application([layout]), capabilities);
    const view = render(
      <RuntimeRenderer
        runtime={runtime(document.getSnapshot().plan.schema)}
        materials={materials}
      />,
    );
    const target = view.container.querySelector<HTMLElement>('.material-layout')!;
    expect(target.style.rowGap).toBe('20px');
    expect(target.style.columnGap).toBe('20px');
    expect(target.style.paddingLeft).toBe('30px');
    expect(target.style.paddingRight).toBe('12px');
    document.setStyle('page', 'layout', {
      gap: undefined,
      paddingLeft: undefined,
    });
    view.rerender(
      <RuntimeRenderer
        runtime={runtime(document.getSnapshot().plan.schema)}
        materials={materials}
      />,
    );
    const restored = view.container.querySelector<HTMLElement>('.material-layout')!;
    expect(restored.style.rowGap).toBe('8px');
    expect(restored.style.paddingLeft).toBe('12px');
    expect(node(document, 'layout').props).toEqual(layout.props);
  });

  it('keeps an input width on its existing field root, rather than just the native input', () => {
    const input: NodeSchema = {
      id: 'input',
      component: 'ui.input',
      props: { label: literal('验收输入'), value: literal('') },
      style: { width: literal(240), paddingLeft: literal(12) },
    };
    const view = render(
      <RuntimeRenderer runtime={runtime(application([input]))} materials={materials} />,
    );
    const control = screen.getByRole('textbox', { name: '验收输入' });
    const target = control.closest<HTMLElement>('.material-field')!;
    expect(target.style.width).toBe('240px');
    expect(target.style.paddingLeft).toBe('12px');
    expect(view.container.firstElementChild).toBe(target);
    expect(control.style.width).toBe('');
  });

  it('forwards a declared width for every general material default in design mode', () => {
    for (const [component, contract] of Object.entries(registry.components)) {
      const metadata = catalog[component];
      if (
        !contract.style ||
        !metadata ||
        metadata.palette === false ||
        metadata.insertable === false
      )
        continue;
      const material: NodeSchema = {
        id: 'material',
        component,
        props: Object.fromEntries(
          Object.entries(metadata.defaultProps).map(([key, value]) => [
            key,
            literal(structuredClone(value)),
          ]),
        ),
        style: { width: literal(177) },
      };
      const rt = runtime(application([material]), true);
      const view = render(<RuntimeRenderer runtime={rt} materials={materials} designMode />);
      const applied = Array.from(view.container.querySelectorAll<HTMLElement>('*')).some(
        (element) => element.style.width === '177px',
      );
      expect({ component, applied }).toEqual({ component, applied: true });
      view.unmount();
      rt.dispose();
    }
  });

  it.each(['ui.dialog', 'ui.drawer'])(
    'targets %s popup and retains styles while closed',
    async (component) => {
      const overlay: NodeSchema = {
        id: 'overlay',
        component,
        props: {
          title: literal('验收弹层'),
          triggerLabel: literal('打开验收弹层'),
        },
        style: {
          width: { kind: 'stateRef', stateId: 'size' },
          paddingLeft: literal(12),
        },
      };
      const schema = application([overlay]);
      schema.pages[0].state.find((state) => state.id === 'size')!.initial = 320;
      const rt = runtime(schema);
      const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
      const trigger = screen.getByRole('button', { name: '打开验收弹层' });
      fireEvent.click(trigger);
      const popup = await screen.findByRole('dialog', { name: '验收弹层' });
      expect(popup.style.width).toBe('320px');
      expect(popup.style.paddingLeft).toBe('12px');
      expect(view.container.querySelector<HTMLElement>('.material-overlay-host')!.style.width).toBe(
        '',
      );
      expect(trigger.style.width).toBe('');
      fireEvent.click(screen.getByRole('button', { name: '关闭验收弹层' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: '验收弹层' })).toBeNull());
      act(() => rt.setState('size', 360));
      fireEvent.click(trigger);
      expect((await screen.findByRole('dialog', { name: '验收弹层' })).style.width).toBe('360px');
    },
  );

  it('preserves styles on hidden tab panels and exposes all panels in design mode', () => {
    const panel = (id: string): NodeSchema => ({
      id,
      component: 'ui.tabPanel',
      props: { value: literal(id), label: literal(id) },
      style: { width: literal(211) },
      children: [textNode(id + '-text')],
    });
    const tabs: NodeSchema = {
      id: 'tabs',
      component: 'ui.tabs',
      props: {},
      children: [panel('one'), panel('two')],
    };
    const rt = runtime(application([tabs]));
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
    const hiddenPanel = view.container.querySelectorAll<HTMLElement>('.material-tab-panel')[1];
    expect(hiddenPanel.hidden).toBe(true);
    expect(hiddenPanel.style.width).toBe('211px');
    view.rerender(<RuntimeRenderer runtime={rt} materials={materials} designMode />);
    expect(hiddenPanel.hidden).toBe(false);
    expect(hiddenPanel.style.width).toBe('211px');
  });

  it('roundtrips style through duplicate, JSON and local project recovery', () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const project = new ProjectStorage(adapter, capabilities, application());
    project.start();
    const document = project.getSnapshot().document;
    document.setStyle('page', 'text', {
      width: { kind: 'stateRef', stateId: 'size' },
      marginLeft: literal('-2px'),
    });
    const copy = document.duplicateNode('page', 'text');
    expect(node(document, copy).style).toEqual(node(document).style);
    const restoredJson = new EditorDocument(JSON.parse(document.exportJson()), capabilities);
    expect(node(restoredJson, copy).style).toEqual(node(document).style);
    project.stop();
    const restored = new ProjectStorage(adapter, capabilities, application()).getSnapshot()
      .document;
    expect(node(restored, copy).style).toEqual(node(document).style);
    expect(restored.getSnapshot().canUndo).toBe(false);
  });
});
