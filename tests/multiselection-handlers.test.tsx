import { Children, type ComponentProps, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { FieldDefinition, Json, NodeSchema } from '../packages/schema/types';
import { PropertyPanel, EditorToolbar } from '../src/editor/Editor';
import { StylePanel } from '../src/editor/StylePanel';
import { NodeLogicPanel } from '../src/editor/NodeLogicPanel';
import { ActionPanel } from '../src/editor/ActionPanel';
import { FormPanel } from '../src/editor/FormPanel';
import { FieldArrayPanel } from '../src/editor/FieldArrayPanel';
import { SelectionControls } from '../src/editor/SelectionControls';
import { ComponentTree } from '../src/editor/ComponentTree';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { EditorSessionProvider } from '../src/editor/session';
import {
  createSetterRegistry,
  SetterRegistryProvider,
  type ReactSetterProps,
} from '../src/editor/Setters';
import { catalog } from '../src/editor/catalog';
import { defaultArrayFields } from '../src/editor/extended-catalog';
import { TipProvider } from '../src/ui/primitives';
import { selectionApplication, selectionRegistry, lit } from './multiselection-fixture';

type Handler = (value?: any) => unknown;
const held = vi.hoisted(() => ({
  buttons: new Map<string, Handler>(),
  selects: new Map<string, Handler>(),
  menu: new Map<string, Handler>(),
}));
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      const label =
        props['aria-label'] ??
        Children.toArray(props.children)
          .filter((child) => typeof child === 'string')
          .join('')
          .trim();
      if (props.onClick) held.buttons.set(label, props.onClick as Handler);
      return <actual.Button {...props} />;
    },
    Select: (props: ComponentProps<typeof actual.Select>) => {
      if (props['aria-label'] && props.onValueChange)
        held.selects.set(props['aria-label'], props.onValueChange as Handler);
      return <actual.Select {...props} />;
    },
  };
});
vi.mock('@base-ui/react/menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@base-ui/react/menu')>();
  return {
    ...actual,
    Menu: {
      ...actual.Menu,
      Item: (props: ComponentProps<typeof actual.Menu.Item>) => {
        const label = Children.toArray(props.children)
          .filter((child) => typeof child === 'string')
          .join('')
          .trim();
        if (props.onClick) held.menu.set(label, props.onClick as Handler);
        return <actual.Menu.Item {...props} />;
      },
    },
  };
});
beforeEach(() => {
  held.buttons.clear();
  held.selects.clear();
  held.menu.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const clickEvent = () => ({
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  ctrlKey: false,
  metaKey: false,
});
type Kind = 'property' | 'style' | 'logic' | 'action' | 'form' | 'field' | 'array';
function setupPanel(kind: Kind) {
  const schema = selectionApplication(),
    registry = selectionRegistry(),
    metadata = structuredClone(catalog);
  let primary = 'alpha',
    captured!: ReactSetterProps;
  schema.pages[0].children[0].children![0].style = { width: lit(80) };
  if (kind === 'action') {
    primary = 'action-node';
    schema.dependencies.components['ui.button'] = registry.components['ui.button'].version;
    schema.pages[0].children.push({
      id: primary,
      component: 'ui.button',
      props: { label: lit('Action') },
      on: {
        onClick: [
          {
            id: 'set-caption',
            action: 'state.set',
            input: { stateId: lit('caption'), value: lit('saved') },
          },
        ],
      },
    });
  }
  if (kind === 'form') {
    primary = 'form-node';
    schema.dependencies.components['ui.form'] = registry.components['ui.form'].version;
    schema.pages[0].children.push({ id: primary, component: 'ui.form', props: {} });
  }
  if (kind === 'field' || kind === 'array') {
    primary = kind + '-node';
    schema.dependencies.components['ui.form'] = registry.components['ui.form'].version;
    const component = kind === 'field' ? 'ui.input' : 'ui.fieldArray';
    schema.dependencies.components[component] = registry.components[component].version;
    const props = Object.fromEntries(
      Object.entries(catalog[component].defaultProps).map(([name, value]) => [name, lit(value)]),
    );
    schema.pages[0].forms![0].arrays = [
      {
        id: 'lines',
        path: ['lines'],
        label: 'Lines',
        fields: structuredClone(defaultArrayFields) as unknown as FieldDefinition[],
        initial: [],
      },
    ];
    schema.pages[0].children.push({
      id: 'bound-form',
      component: 'ui.form',
      formId: 'model',
      props: {},
      children: [{ id: primary, component, props }],
    });
  }
  if (kind === 'property')
    metadata['ui.text'].properties.find((prop) => prop.name === 'value')!.setter = {
      kind: 'custom',
      id: 'multi.property',
    };
  const setters = createSetterRegistry({
    'multi.property': (props) => {
      captured = props;
      return <input aria-label="Captured property" readOnly value={String(props.value ?? '')} />;
    },
    'style.value': (props) => {
      if (props.options.property === 'width') captured = props;
      return <input aria-label={props.label} readOnly value={props.draft} />;
    },
  });
  const document = new EditorDocument(schema, registry);
  document.select('a', primary);
  function Host() {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot),
      node = findNode(snapshot.plan.pages.get('a')!.schema, primary)!.node;
    if (kind === 'property')
      return <PropertyPanel document={document} snapshot={snapshot} materialCatalog={metadata} />;
    if (kind === 'style') return <StylePanel document={document} snapshot={snapshot} node={node} />;
    if (kind === 'logic')
      return <NodeLogicPanel document={document} snapshot={snapshot} node={node} />;
    if (kind === 'action')
      return <ActionPanel document={document} snapshot={snapshot} node={node} />;
    if (kind === 'array')
      return <FieldArrayPanel document={document} snapshot={snapshot} node={node} />;
    return <FormPanel document={document} snapshot={snapshot} node={node} />;
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <SetterRegistryProvider registry={setters}>
          <Host />
        </SetterRegistryProvider>
      </TipProvider>
    </EditorSessionProvider>,
  );
  return { document, primary, view, setter: () => captured };
}

describe('all primary editor callback generations invalidate on same-primary multi', () => {
  it.each(['property', 'style'] as const)(
    'retained %s setter cannot commit/reset before rerender or after multi child unmount',
    (kind) => {
      const { document, primary, setter } = setupPanel(kind),
        old = setter();
      expect(old).toBeDefined();
      act(() => {
        document.selectMany('a', [primary, 'tail'], primary);
        expect(old.onChange(kind === 'style' ? 200 : 'stale')).toBe(false);
        expect(old.onReset()).toBe(false);
      });
      const before = document.getSnapshot();
      act(() => {
        old.onChange(kind === 'style' ? 300 : 'stale-again');
        old.onReset();
      });
      expect(document.getSnapshot()).toBe(before);
    },
  );
  it.each(['logic', 'action', 'form', 'field', 'array'] as const)(
    'retained %s publication rejects same primary plus another selected definition',
    (kind) => {
      const { document, primary } = setupPanel(kind);
      const method =
        kind === 'logic'
          ? 'setNodeLogic'
          : kind === 'action'
            ? 'setEventActions'
            : kind === 'form'
              ? 'bindForm'
              : kind === 'field'
                ? 'bindField'
                : 'bindFieldArray';
      const publish = vi.spyOn(document, method);
      const handler =
        kind === 'logic'
          ? held.buttons.get('应用组件逻辑')
          : kind === 'action'
            ? held.buttons.get('保存事件')
            : held.selects.get(
                kind === 'form' ? '绑定表单' : kind === 'field' ? '绑定字段' : '绑定明细',
              );
      expect(handler).toBeTypeOf('function');
      const value =
        kind === 'form'
          ? 'model'
          : kind === 'field'
            ? JSON.stringify(['model', 'name'])
            : kind === 'array'
              ? 'lines'
              : clickEvent();
      act(() => {
        document.selectMany('a', [primary, 'tail'], primary);
        handler!(value);
      });
      const before = document.getSnapshot();
      act(() => handler!(value));
      expect(document.getSnapshot()).toBe(before);
      expect(publish).not.toHaveBeenCalled();
    },
  );
});

describe('multi command and clipboard retained author guards', () => {
  function setup(multi = true) {
    const document = new EditorDocument(selectionApplication(), selectionRegistry());
    document.selectMany('a', multi ? ['alpha', 'tail'] : ['alpha'], 'alpha');
    let drag!: NonNullable<ReturnType<typeof useDragDrop>>, duringPending: (() => void) | undefined;
    function Probe() {
      drag = useDragDrop()!;
      return (
        <button
          onPointerDown={(event) => {
            drag.begin({ kind: 'material', component: 'ui.text' }, event);
            duringPending?.();
          }}
        >
          Pending material drag
        </button>
      );
    }
    const tree = (target = document, allowed = true) => (
        <EditorSessionProvider>
          <TipProvider>
            <DragDropProvider document={target} snapshot={target.getSnapshot()} enabled={allowed}>
              <Probe />
              <SelectionControls document={target} snapshot={target.getSnapshot()} />
              <ComponentTree document={target} snapshot={target.getSnapshot()} />
              <EditorToolbar
                document={target}
                snapshot={target.getSnapshot()}
                authoringAllowed={allowed}
              />
            </DragDropProvider>
          </TipProvider>
        </EditorSessionProvider>
      ),
      view = render(tree());
    return {
      document,
      view,
      tree,
      getDrag: () => drag,
      setDuringPending: (handler: () => void) => {
        duringPending = handler;
      },
    };
  }
  it.each([
    'same-primary-set',
    'preview',
    'document',
    'unmount',
    'plan',
    'page',
    'active-drag',
  ] as const)('retained bulk delete refuses after %s', (change) => {
    const { document, view, tree, getDrag } = setup(),
      old = held.buttons.get('删除所选组件')!;
    expect(old).toBeTypeOf('function');
    if (change === 'same-primary-set')
      act(() => document.selectMany('a', ['alpha', 'header'], 'alpha'));
    else if (change === 'preview') view.rerender(tree(document, false));
    else if (change === 'document')
      view.rerender(tree(new EditorDocument(selectionApplication(), selectionRegistry())));
    else if (change === 'unmount') view.unmount();
    else if (change === 'plan') act(() => document.renamePage('b', 'new title'));
    else if (change === 'page') act(() => document.selectPage('b'));
    else act(() => getDrag().begin({ kind: 'material', component: 'ui.text' }));
    const before = document.getSnapshot();
    act(() => old(clickEvent()));
    expect(document.getSnapshot()).toBe(before);
  });
  it('same-event pending pointer prevents retained tree selection and bulk deletion', () => {
    const { document, setDuringPending, getDrag } = setup(),
      remove = held.buttons.get('删除所选组件')!,
      select = held.buttons.get('选中 文本 header')!,
      before = document.getSnapshot();
    setDuringPending(() => {
      remove(clickEvent());
      select({ ...clickEvent(), ctrlKey: true });
    });
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    fireEvent(screen.getByRole('button', { name: 'Pending material drag' }), event);
    expect(getDrag().isInteracting).toBe(true);
    expect(document.getSnapshot()).toBe(before);
  });
  it('old030 copy callback invalidates when multi adds a node while preserving primary,including collapse back', async () => {
    const { document } = setup(false);
    fireEvent.click(screen.getByRole('button', { name: '文件菜单' }));
    await screen.findByRole('menuitem', { name: '复制组件到剪贴板' });
    const old = held.menu.get('复制组件到剪贴板')!,
      copy = vi.spyOn(document, 'copyNodeToClipboard');
    act(() => {
      document.selectMany('a', ['alpha', 'tail'], 'alpha');
      old(clickEvent());
    });
    expect(copy).not.toHaveBeenCalled();
    act(() => document.select('a', 'alpha'));
    const before = document.getSnapshot(),
      clipboard = document.getClipboardSnapshot();
    act(() => old(clickEvent()));
    expect(copy).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
    expect(document.getClipboardSnapshot()).toBe(clipboard);
  });
});
