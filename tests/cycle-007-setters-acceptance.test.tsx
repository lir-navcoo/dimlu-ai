import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import {
  createSetterRegistry,
  SetterRegistryProvider,
  type ReactSetterProps,
} from '../src/editor/Setters';
import { catalog } from '../src/editor/catalog';
import { exampleApplication } from '../src/examples';
import { materials, registry } from '../src/materials';

afterEach(cleanup);

const title = (document: EditorDocument) =>
  findNode(document.getSnapshot().plan.pages.get('purchase')!.schema, 'purchase-heading')!.node
    .props.title;

function Harness({
  document,
  capture,
}: {
  document: EditorDocument;
  capture?: (props: ReactSetterProps) => void;
}) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const runtime = useMemo(
    () => new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true }),
    [snapshot.plan, snapshot.selection.pageId],
  );
  useEffect(() => () => runtime.dispose(), [runtime]);
  const metadata = useMemo(() => {
    const next = structuredClone(catalog);
    next['ui.heading'].properties.find((property) => property.name === 'title')!.setter = {
      kind: 'custom',
      id: 'acceptance.native',
    };
    return next;
  }, []);
  const setters = useMemo(
    () =>
      createSetterRegistry({
        'acceptance.native': function NativeSetter(props: ReactSetterProps) {
          capture?.(props);
          return (
            <input
              id={props.id}
              value={props.error ? props.draft : String(props.value ?? '')}
              onChange={(event) => {
                const next = event.target.value;
                props.onDraftChange(next);
                if (next.startsWith('#')) props.onError('验收无效草稿');
                else props.onChange(next);
              }}
            />
          );
        },
      }),
    [capture],
  );
  return (
    <SetterRegistryProvider registry={setters}>
      <EditorSessionProvider>
        <PropertyPanel document={document} snapshot={snapshot} materialCatalog={metadata} />
        <RuntimeRenderer runtime={runtime} materials={materials} designMode />
      </EditorSessionProvider>
    </SetterRegistryProvider>
  );
}

describe('cycle 007 independent setter acceptance', () => {
  it('updates actual runtime output through a native TSX setter and groups a focus session', () => {
    const document = new EditorDocument(exampleApplication, registry);
    render(<Harness document={document} />);
    const control = screen.getByRole('textbox', { name: '标题' });
    fireEvent.focus(control);
    fireEvent.change(control, { target: { value: '验' } });
    fireEvent.change(control, { target: { value: '验收原生 TSX' } });
    fireEvent.blur(control);
    expect(screen.getByRole('heading', { name: '验收原生 TSX' })).toBeTruthy();
    act(() => document.undo());
    expect(screen.getByRole('heading', { name: '创建采购申请' })).toBeTruthy();
    expect(document.getSnapshot().canUndo).toBe(false);
    act(() => document.redo());
    expect(screen.getByRole('heading', { name: '验收原生 TSX' })).toBeTruthy();
    expect(document.exportJson()).not.toContain('acceptance.native');
  });

  it('retains invalid custom drafts across selection without changing accepted output/history', () => {
    const document = new EditorDocument(exampleApplication, registry);
    render(<Harness document={document} />);
    const before = document.getSnapshot();
    fireEvent.change(screen.getByRole('textbox', { name: '标题' }), {
      target: { value: '#无效草稿' },
    });
    expect(document.getSnapshot()).toBe(before);
    expect(screen.getByRole('heading', { name: '创建采购申请' })).toBeTruthy();
    act(() => document.select('purchase', 'purchase-name'));
    expect(screen.queryByText('验收无效草稿')).toBeNull();
    act(() => document.select('purchase', 'purchase-heading'));
    expect((screen.getByRole('textbox', { name: '标题' }) as HTMLInputElement).value).toBe(
      '#无效草稿',
    );
    expect(screen.getByRole('alert').textContent).toBe('验收无效草稿');
    fireEvent.click(screen.getByRole('button', { name: '标题放弃草稿' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(title(document)).toEqual({ kind: 'literal', value: '创建采购申请' });
  });

  it('rejects an async callback from an unmounted setter after node selection changes', () => {
    const document = new EditorDocument(exampleApplication, registry);
    let retained: ReactSetterProps | undefined;
    render(<Harness document={document} capture={(props) => (retained = props)} />);
    const previous = retained!;
    act(() => document.select('purchase', 'purchase-name'));
    const before = document.getSnapshot();
    let accepted: boolean | undefined;
    act(() => {
      accepted = previous.onChange('迟到的旧组件写入');
    });
    expect({ accepted, selection: document.getSnapshot().selection }).toEqual({
      accepted: false,
      selection: before.selection,
    });
    expect(document.getSnapshot()).toBe(before);
    expect(document.getSnapshot().selection.nodeId).toBe('purchase-name');
  });
});
