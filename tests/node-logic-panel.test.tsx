import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { ApplicationSchema, Json, Value } from '../packages/schema/types';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
const lit = (value: Json): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const schema: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'logic-panel',
  title: 'Logic',
  entryPageId: 'page',
  dependencies: { components: { 'ui.text': '1.0.0', 'ui.layout': '1.0.0' }, actions: {} },
  pages: [
    {
      id: 'page',
      title: 'Logic',
      state: [
        { id: 'shown', type: 'boolean', initial: true },
        { id: 'rows', type: 'array', initial: [] },
      ],
      children: [
        { id: 'target', component: 'ui.text', props: { value: lit('Hello') } },
        { id: 'other', component: 'ui.text', props: { value: lit('Other') } },
      ],
    },
  ],
};
const selected = (doc: EditorDocument) =>
  findNode(doc.getSnapshot().plan.pages.get('page')!.schema, 'target')!.node;
function Host({ doc }: { doc: EditorDocument }) {
  const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  return (
    <PropertyPanel
      key={`${snapshot.selection.pageId}/${snapshot.selection.nodeId}`}
      document={doc}
      snapshot={snapshot}
    />
  );
}
function setup(input = schema) {
  const doc = new EditorDocument(input, registry);
  render(
    <TipProvider>
      <EditorSessionProvider>
        <Host doc={doc} />
      </EditorSessionProvider>
    </TipProvider>,
  );
  return doc;
}
const show = () => fireEvent.click(screen.getByRole('tab', { name: '逻辑' }));
function binding(label: string, mode: Value['kind'], text: string) {
  changeControl(screen.getByRole('combobox', { name: `${label}取值方式` }), mode);
  changeControl(screen.getByRole('textbox', { name: label }), text);
}

describe('node logic inspector', () => {
  it('preserves both drafts and history when removing a consumed loop is rejected', () => {
    const input = structuredClone(schema);
    input.pages[0].children[0] = {
      id: 'target',
      component: 'ui.layout',
      props: {},
      repeat: { items: lit([{ id: 'a' }]), item: 'item', key: expr('scope.item.id') },
      children: [{ id: 'consumer', component: 'ui.text', props: { value: expr('scope.item.id') } }],
    };
    const doc = setup(input);
    show();
    binding('显示条件', 'literal', 'false');
    changeControl(screen.getByRole('textbox', { name: '记录变量' }), 'record');
    const before = doc.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '恢复循环渲染' }));
    expect(screen.getByRole('alert').textContent).toContain('scope.item');
    expect(doc.getSnapshot()).toBe(before);
    expect((screen.getByRole('textbox', { name: '显示条件' }) as HTMLTextAreaElement).value).toBe(
      'false',
    );
    expect((screen.getByRole('textbox', { name: '记录变量' }) as HTMLInputElement).value).toBe(
      'record',
    );
  });
  it('lazily mounts an unset editor and commits a combined loop+condition in one undo', () => {
    const doc = setup();
    expect(screen.queryByRole('button', { name: '应用组件逻辑' })).toBeNull();
    show();
    binding('显示条件', 'expression', 'scope.record.visible');
    fireEvent.click(screen.getByRole('checkbox', { name: '启用循环' }));
    binding('循环数据', 'literal', '[{"id":"a","visible":true}]');
    changeControl(screen.getByRole('textbox', { name: '记录变量' }), 'record');
    binding('记录标识', 'expression', 'scope.record.id');
    expect(doc.getSnapshot().canUndo).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    expect(selected(doc).when).toEqual(expr('scope.record.visible'));
    expect(selected(doc).repeat!.item).toBe('record');
    act(() => doc.undo());
    expect(selected(doc).when).toBeUndefined();
    expect(selected(doc).repeat).toBeUndefined();
    expect(doc.getSnapshot().canUndo).toBe(false);
  });
  it('preserves incomplete drafts across tabs and selections and requires rebase after undo', () => {
    const doc = setup();
    show();
    binding('显示条件', 'literal', 'false');
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    binding('显示条件', 'expression', 'state.shown &&');
    fireEvent.click(screen.getByRole('tab', { name: '属性' }));
    expect(screen.queryByRole('button', { name: '应用组件逻辑' })).toBeNull();
    show();
    expect((screen.getByRole('textbox', { name: '显示条件' }) as HTMLTextAreaElement).value).toBe(
      'state.shown &&',
    );
    act(() => doc.select('page', 'other'));
    act(() => doc.select('page', 'target'));
    show();
    expect((screen.getByRole('textbox', { name: '显示条件' }) as HTMLTextAreaElement).value).toBe(
      'state.shown &&',
    );
    act(() => doc.undo());
    expect(
      (screen.getByRole('button', { name: '应用组件逻辑' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    changeControl(screen.getByRole('textbox', { name: '显示条件' }), 'state.shown');
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    expect(selected(doc).when).toEqual(expr('state.shown'));
  });
  it('resets only its section, preserves the other incomplete draft and clears folded drafts on reset-all', () => {
    const doc = setup();
    show();
    binding('显示条件', 'literal', 'false');
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '启用循环' }));
    binding('循环数据', 'literal', '[incomplete');
    fireEvent.click(screen.getByRole('button', { name: '恢复显示条件' }));
    expect(selected(doc).when).toBeUndefined();
    expect((screen.getByRole('textbox', { name: '循环数据' }) as HTMLTextAreaElement).value).toBe(
      '[incomplete',
    );
    expect(screen.queryByRole('button', { name: '确认使用草稿' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '循环渲染' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复全部组件逻辑' }));
    fireEvent.click(screen.getByRole('button', { name: '循环渲染' }));
    expect(
      (screen.getByRole('checkbox', { name: '启用循环' }) as HTMLButtonElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
    fireEvent.click(screen.getByRole('checkbox', { name: '启用循环' }));
    expect(screen.queryByRole('textbox', { name: '循环数据' })).toBeNull();
  });
  it('retains invalid inputs and redo, requires deliberate key setup and updates hints after undo', () => {
    const doc = setup();
    doc.setNodeLogic('page', 'target', { when: lit(false) });
    act(() => doc.undo());
    show();
    fireEvent.click(screen.getByRole('checkbox', { name: '启用循环' }));
    binding('循环数据', 'literal', '[{"id":"a"}]');
    const before = doc.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    expect(screen.getByRole('alert').textContent).toContain('必填参数');
    expect(doc.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    binding('记录标识', 'expression', 'scope.item.id');
    fireEvent.click(screen.getByRole('button', { name: '应用组件逻辑' }));
    expect(selected(doc).repeat!.item).toBe('item');
    act(() => doc.undo());
    const section = screen.getByRole('button', { name: '显示条件' }).parentElement!;
    expect(within(section).getByText(/可用作用域：无行作用域/)).toBeTruthy();
  });
});
