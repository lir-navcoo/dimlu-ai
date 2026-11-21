import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer, type NodeRenderProps } from '../packages/react-runtime/Renderer';
import type { ApplicationSchema, Value } from '../packages/schema/types';
import { registry, materials } from '../src/materials';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const localRegistry = {
  ...registry,
  components: {
    ...registry.components,
    'test.counter': { version: '1.0.0', props: { label: { type: 'string' as const } } },
  },
};
function Counter({ label }: { label: string }) {
  const [count, set] = useState(0);
  return (
    <button onClick={() => set(count + 1)}>
      {label}:{count}
    </button>
  );
}
const make = () =>
  new EditorDocument(
    {
      schemaVersion: '0.1.0',
      id: 'render-logic',
      title: 'Logic',
      entryPageId: 'page',
      dependencies: { components: { 'test.counter': '1.0.0' }, actions: {} },
      pages: [
        {
          id: 'page',
          title: 'Logic',
          state: [
            {
              id: 'rows',
              type: 'array',
              initial: [
                { id: 1, label: 'number', visible: true },
                { id: '1', label: 'string', visible: true },
              ],
            },
          ],
          children: [
            {
              id: 'row',
              component: 'test.counter',
              props: { label: expr('scope.item.label') },
              repeat: {
                items: { kind: 'stateRef', stateId: 'rows' },
                item: 'item',
                key: expr('scope.item.id'),
              },
            },
          ],
        },
      ],
    } satisfies ApplicationSchema,
    localRegistry,
  );

describe('authored logic in the real React runtime', () => {
  it('preserves keyed native state when records reorder and distinguishes number/string identity', () => {
    const doc = make();
    doc.setNodeLogic('page', 'row', {
      when: expr('scope.item.visible'),
      repeat: {
        items: { kind: 'stateRef', stateId: 'rows' },
        item: 'item',
        key: expr('scope.item.id'),
      },
    });
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    render(
      <RuntimeRenderer runtime={runtime} materials={{ ...materials, 'test.counter': Counter }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'number:0' }));
    act(() =>
      runtime.setState('rows', [
        { id: '1', label: 'string', visible: true },
        { id: 1, label: 'number', visible: true },
      ]),
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'string:0',
      'number:1',
    ]);
    runtime.dispose();
  });
  it('keeps false/empty definitions in design and enforces runtime key errors independently of visibility', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const doc = make();
    doc.setNodeLogic('page', 'row', {
      when: { kind: 'literal', value: false },
      repeat: {
        items: { kind: 'stateRef', stateId: 'rows' },
        item: 'item',
        key: expr('scope.item.id'),
      },
    });
    const runtime = new PageRuntime(doc.getSnapshot().plan, 'page');
    const inactive: string[] = [];
    function Decorator({ inactiveReason, children }: NodeRenderProps) {
      if (inactiveReason) inactive.push(inactiveReason);
      return <div>{children}</div>;
    }
    const view = render(
      <RuntimeRenderer
        runtime={runtime}
        materials={{ ...materials, 'test.counter': Counter }}
        nodeDecorator={Decorator}
        designMode
      />,
    );
    expect(inactive).toContain('condition');
    view.rerender(
      <RuntimeRenderer runtime={runtime} materials={{ ...materials, 'test.counter': Counter }} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    act(() =>
      runtime.setState('rows', [
        { id: 1, label: 'a' },
        { id: 1, label: 'b' },
      ]),
    );
    expect(screen.getByRole('alert').textContent).toMatch(/重复/);
    act(() => runtime.setState('rows', []));
    view.rerender(
      <RuntimeRenderer
        runtime={runtime}
        materials={{ ...materials, 'test.counter': Counter }}
        nodeDecorator={Decorator}
        designMode
      />,
    );
    expect(inactive).toContain('empty-repeat');
    runtime.dispose();
  });
});
