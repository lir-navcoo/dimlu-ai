import { useSyncExternalStore } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
import { NodeLogicPanel } from '../src/editor/NodeLogicPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import type { BindingDraft, ValueInput } from '../src/editor/ValueEditor';
import { changeControl } from './ui-helpers';

const retained = vi.hoisted(
  () => [] as { label: string; draft: BindingDraft; onChange: (draft: BindingDraft) => void }[],
);
vi.mock('../src/editor/ValueEditor', async (original) => {
  const actual = await original<typeof import('../src/editor/ValueEditor')>();
  return {
    ...actual,
    ValueInput: (props: Parameters<typeof ValueInput>[0]) => {
      retained.push(props);
      return <actual.ValueInput {...props} />;
    },
  };
});
afterEach(() => {
  cleanup();
  retained.length = 0;
});
function Host({ doc }: { doc: EditorDocument }) {
  const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
  const node = findNode(
    snapshot.plan.pages.get(snapshot.selection.pageId)!.schema,
    snapshot.selection.nodeId!,
  )!.node;
  return (
    <NodeLogicPanel
      key={`${snapshot.selection.pageId}/${node.id}`}
      document={doc}
      snapshot={snapshot}
      node={node}
    />
  );
}
it('silently rejects retained value handlers after mode/target changes and unmount, including switching back', () => {
  const doc = new EditorDocument(exampleApplication, registry);
  const view = render(
    <TipProvider>
      <EditorSessionProvider>
        <Host doc={doc} />
      </EditorSessionProvider>
    </TipProvider>,
  );
  changeControl(screen.getByRole('combobox', { name: '显示条件取值方式' }), 'expression');
  const old = retained.filter((props) => props.label === '显示条件').at(-1)!;
  changeControl(screen.getByRole('combobox', { name: '显示条件取值方式' }), 'literal');
  changeControl(screen.getByRole('combobox', { name: '显示条件取值方式' }), 'expression');
  act(() => old.onChange({ ...old.draft, text: 'stale handler' }));
  expect((screen.getByRole('textbox', { name: '显示条件' }) as HTMLTextAreaElement).value).toBe('');
  const current = retained.filter((props) => props.label === '显示条件').at(-1)!;
  act(() => doc.select('purchase', 'purchase-form'));
  act(() => current.onChange({ ...current.draft, text: 'wrong target' }));
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => doc.select('purchase', 'purchase-heading'));
  expect((screen.getByRole('textbox', { name: '显示条件' }) as HTMLTextAreaElement).value).toBe('');
  const last = retained.filter((props) => props.label === '显示条件').at(-1)!;
  view.unmount();
  act(() => last.onChange({ ...last.draft, text: 'unmounted' }));
  expect(doc.getSnapshot().canUndo).toBe(false);
});
