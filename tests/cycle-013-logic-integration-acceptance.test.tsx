import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer, type NodeRenderProps } from '../packages/react-runtime/Renderer';
import type { ApplicationSchema, Json, Value } from '../packages/schema/types';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import { registry, materials } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const fixture: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'independent.logic.integration',
  title: '逻辑组合验收',
  entryPageId: 'page',
  dependencies: { components: { 'ui.text': '1.0.0', 'ui.layout': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: '逻辑组合验收',
      state: [
        {
          id: 'rows',
          type: 'array',
          initial: [
            { id: 0, visible: true },
            { id: '0', visible: false },
          ],
        },
      ],
      children: [
        {
          id: 'target',
          component: 'ui.text',
          props: { value: literal('真实运行文本') },
          style: { color: literal('#123456') },
        },
      ],
    },
  ],
};
function Decorator({ children, node, inactiveReason }: NodeRenderProps) {
  return (
    <div data-independent-node={node.id} data-inactive-reason={inactiveReason}>
      {children}
    </div>
  );
}
function Host({
  document,
  design = true,
  onRuntime,
}: {
  document: EditorDocument;
  design?: boolean;
  onRuntime: (runtime: PageRuntime) => void;
}) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const runtime = useMemo(
    () => new PageRuntime(snapshot.plan, 'page', { designMode: design }),
    [snapshot.plan, design],
  );
  useEffect(() => () => runtime.dispose(), [runtime]);
  onRuntime(runtime);
  return (
    <>
      <PropertyPanel document={document} snapshot={snapshot} />
      <section aria-label="独立运行画布">
        <RuntimeRenderer
          runtime={runtime}
          materials={materials}
          designMode={design}
          nodeDecorator={design ? Decorator : undefined}
        />
      </section>
    </>
  );
}
function setup(document = new EditorDocument(fixture, registry)) {
  let runtime!: PageRuntime;
  const node = (design = true) => (
    <TipProvider>
      <EditorSessionProvider>
        <Host
          document={document}
          design={design}
          onRuntime={(next) => {
            runtime = next;
          }}
        />
      </EditorSessionProvider>
    </TipProvider>
  );
  const view = render(node());
  fireEvent.click(screen.getByRole('tab', { name: '逻辑' }));
  return { document, view, node, runtime: () => runtime };
}
function bind(label: string, mode: Value['kind'], source: string) {
  changeControl(screen.getByRole('combobox', { name: `${label}取值方式` }), mode);
  if (mode === 'literal' && (source === 'true' || source === 'false')) {
    const checkbox = screen.getByRole('checkbox', { name: label });
    if (checkbox.getAttribute('aria-checked') !== source) fireEvent.click(checkbox);
  } else {
    changeControl(screen.getByRole('textbox', { name: label }), source);
  }
}

describe('cycle 013 independent inspector/runtime logic integration', () => {
  it('publishes new local aliases and condition together, renders placeholders and undoes the same declaration', () => {
    const { document, view, node, runtime } = setup();
    const initial = document.getSnapshot();
    bind('显示条件', 'expression', 'scope.record.visible');
    fireEvent.click(screen.getByRole('checkbox', { name: '启用循环' }));
    changeControl(screen.getByRole('combobox', { name: '循环数据取值方式' }), 'stateRef');
    changeControl(screen.getByRole('combobox', { name: '循环数据页面状态' }), 'rows');
    changeControl(screen.getByRole('textbox', { name: '记录变量' }), 'record');
    bind('记录标识', 'expression', 'scope.record.id');
    expect(document.getSnapshot()).toBe(initial);
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    const applied = findNode(document.getSnapshot().plan.pages.get('page')!.schema, 'target')!.node;
    expect(applied.when).toEqual(expression('scope.record.visible'));
    expect(applied.repeat?.item).toBe('record');
    expect(applied.props).toEqual(fixture.pages[0].children[0].props);
    expect(applied.style).toEqual(fixture.pages[0].children[0].style);
    expect(screen.getAllByText('真实运行文本')).toHaveLength(1);
    expect(view.container.querySelector('[data-inactive-reason="condition"]')).toBeTruthy();
    act(() => runtime().setState('rows', []));
    expect(view.container.querySelector('[data-inactive-reason="empty-repeat"]')).toBeTruthy();
    view.rerender(node(false));
    expect(screen.getAllByText('真实运行文本')).toHaveLength(1);
    expect(view.container.querySelector('[data-independent-node]')).toBeNull();
    act(() => runtime().setState('rows', []));
    expect(screen.queryByText('真实运行文本')).toBeNull();
    act(() => document.undo());
    const restored = findNode(
      document.getSnapshot().plan.pages.get('page')!.schema,
      'target',
    )!.node;
    expect(restored.when).toBeUndefined();
    expect(restored.repeat).toBeUndefined();
    expect(document.getSnapshot().canUndo).toBe(false);
    expect(screen.getByText('真实运行文本')).toBeTruthy();
  });

  it('keeps an applied false node selectable in design and clears all logic in one reversible edit', () => {
    const { document, view, node } = setup();
    bind('显示条件', 'literal', 'false');
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    expect(
      view.container.querySelector(
        '[data-independent-node="target"][data-inactive-reason="condition"]',
      ),
    ).toBeTruthy();
    expect(document.getSnapshot().selection.nodeId).toBe('target');
    view.rerender(node(false));
    expect(screen.queryByText('真实运行文本')).toBeNull();
    view.rerender(node());
    fireEvent.click(screen.getByRole('button', { name: '恢复全部组件逻辑' }));
    expect(screen.getByText('真实运行文本')).toBeTruthy();
    act(() => document.undo());
    expect(view.container.querySelector('[data-inactive-reason="condition"]')).toBeTruthy();
    expect(
      findNode(document.getSnapshot().plan.pages.get('page')!.schema, 'target')!.node.when,
    ).toEqual(literal(false));
  });

  it('retains the real rendered subtree and both panel drafts when removal would orphan a child scope', () => {
    const schema = structuredClone(fixture);
    schema.pages[0].children[0] = {
      id: 'target',
      component: 'ui.layout',
      props: {},
      repeat: {
        items: literal([{ id: 'one', visible: true }]),
        item: 'record',
        key: expression('scope.record.id'),
      },
      children: [
        {
          id: 'consumer',
          component: 'ui.text',
          props: { value: expression('scope.record.id') },
          when: expression('scope.record.visible'),
        },
      ],
    };
    const { document, view } = setup(new EditorDocument(schema, registry));
    bind('显示条件', 'literal', 'false');
    changeControl(screen.getByRole('textbox', { name: '记录变量' }), 'replacement');
    const before = document.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '恢复循环渲染' }));
    expect(document.getSnapshot()).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain('scope.record');
    expect(
      screen.getByRole('checkbox', { name: '显示条件' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect((screen.getByRole('textbox', { name: '记录变量' }) as HTMLInputElement).value).toBe(
      'replacement',
    );
    expect(view.container.querySelector('[data-independent-node="consumer"]')?.textContent).toBe(
      'one',
    );
  });
});
