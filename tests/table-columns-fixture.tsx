import { useSyncExternalStore, type ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { MaterialCatalog } from '../packages/editor/metadata';
import type { Json } from '../packages/schema/types';
import { catalog } from '../src/editor/catalog';
import { DragDropProvider, useDragDrop } from '../src/editor/DragDrop';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import {
  createSetterRegistry,
  LiteralSetter,
  SetterRegistryProvider,
  type ReactSetterProps,
  type ReactSetterRegistry,
} from '../src/editor/Setters';
import { TipProvider } from '../src/ui/primitives';
import { lit, selectionApplication, selectionRegistry } from './multiselection-fixture';

export const baseColumns: Json[] = [
  { key: 'name', title: 'Name' },
  { key: 'amount', title: 'Amount', width: 80.5, sortable: false, align: 'right' },
];
export const columnInput = (index: number, field: '字段路径' | '标题' | '宽度') =>
  screen.getByRole('textbox', { name: `列 ${index} ${field}` }) as HTMLInputElement;
export const columnSelect = (index: number, field: '排序' | '对齐') =>
  screen.getByRole('combobox', { name: `列 ${index} ${field}` });
export const columnsGroup = () => screen.getByRole('group', { name: '表格列设置' });
export const applyColumns = () => screen.getByRole('button', { name: '应用列' });
export const jsonColumns = () =>
  screen.getByRole('textbox', { name: '表格列 JSON' }) as HTMLTextAreaElement;

export function tableAuthor(columns: Json = structuredClone(baseColumns)) {
  const schema = selectionApplication();
  schema.dependencies.components['ui.table'] = '1.0.0';
  schema.pages[0].children.push({
    id: 'table',
    component: 'ui.table',
    props: {
      ...Object.fromEntries(
        Object.entries(catalog['ui.table'].defaultProps).map(([key, value]) => [key, lit(value)]),
      ),
      columns: lit(columns),
      data: lit([
        { id: 'row-one', alternate: 'alternate-one', final: 'final-one', name: 'Name', amount: 3 },
      ]),
    },
    on: {
      onRowClick: [
        {
          id: 'keep-action',
          action: 'state.set',
          input: { stateId: lit('caption'), value: lit('clicked') },
        },
      ],
    },
  });
  const author = new EditorDocument(schema, selectionRegistry());
  author.select('a', 'table');
  return author;
}
export function acceptedColumns(author: EditorDocument): Json {
  const value = findNode(author.getSnapshot().plan.pages.get('a')!.schema, 'table')!.node.props
    .columns;
  if (value.kind !== 'literal') throw new Error('Expected literal table columns in this test');
  return value.value;
}

/** Real PropertyInput/document/session/drag permissions with an observing host renderer. */
export function tableHarness(
  options: {
    columns?: Json;
    override?: ComponentType<ReactSetterProps>;
    frozenSnapshot?: boolean;
  } = {},
) {
  const author = tableAuthor(options.columns);
  const initial = author.getSnapshot();
  const metadata = structuredClone(catalog);
  metadata['ui.table'].properties = metadata['ui.table'].properties.filter((property) =>
    ['columns', 'rowKey'].includes(property.name),
  );
  const builtin = createSetterRegistry().columns;
  let captured!: ReactSetterProps;
  let session!: ReturnType<typeof useEditorSession>;
  let drag!: NonNullable<ReturnType<typeof useDragDrop>>;
  const Capture = (props: ReactSetterProps) => {
    captured = props;
    const Renderer = options.override ?? builtin;
    return <Renderer {...props} />;
  };
  const registry = createSetterRegistry({ columns: Capture });
  let pending: (() => void) | undefined;
  function Probe() {
    drag = useDragDrop()!;
    session = useEditorSession();
    return (
      <button
        onPointerDown={(event) => {
          drag.begin({ kind: 'material', component: 'ui.text' }, event);
          pending?.();
        }}
      >
        Prepare columns pointer
      </button>
    );
  }
  function Scene({
    target,
    enabled,
    setters,
    currentMetadata,
  }: {
    target: EditorDocument;
    enabled: boolean;
    setters: ReactSetterRegistry;
    currentMetadata: MaterialCatalog;
  }) {
    const live = useSyncExternalStore(target.subscribe, target.getSnapshot);
    const snapshot = options.frozenSnapshot && target === author ? initial : live;
    return (
      <DragDropProvider
        document={target}
        snapshot={snapshot}
        enabled={
          enabled && !snapshot.plan.pages.get(snapshot.selection.pageId)?.schema.code?.enabled
        }
      >
        <Probe />
        <SetterRegistryProvider registry={setters}>
          <PropertyPanel document={target} snapshot={snapshot} materialCatalog={currentMetadata} />
        </SetterRegistryProvider>
        <input aria-label="Columns external input" />
      </DragDropProvider>
    );
  }
  const tree = (
    target = author,
    enabled = true,
    setters = registry,
    currentMetadata = metadata,
  ) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene
          target={target}
          enabled={enabled}
          setters={setters}
          currentMetadata={currentMetadata}
        />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return {
    author,
    view,
    tree,
    registry,
    metadata,
    session: () => session,
    drag: () => drag,
    props: () => captured,
    duringPending: (next: () => void) => {
      pending = next;
    },
  };
}

/** Older hosts may omit canEdit; no document API is injected into this standalone Setter. */
export function literalColumnsHarness(
  options: {
    value?: Json;
    onChange?: (value: Json) => boolean;
    canEdit?: () => boolean;
    registry?: ReactSetterRegistry;
  } = {},
) {
  const initial = Object.hasOwn(options, 'value') ? options.value! : structuredClone(baseColumns);
  let session!: ReturnType<typeof useEditorSession>;
  const commit = vi.fn(options.onChange ?? (() => true));
  const error = vi.fn();
  const props: ReactSetterProps = {
    id: 'independent-columns',
    label: '表格列',
    value: initial,
    onChange: commit,
    error: '',
    onError: error,
    onReset: () => true,
    onDiscardDraft: () => {},
    field: { type: 'array', required: true },
    setter: { kind: 'columns' },
    options: {},
    draft: JSON.stringify(initial),
    onDraftChange: () => {},
    draftKey: 'independent/columns',
    ...(options.canEdit ? { canEdit: options.canEdit } : {}),
  };
  function Probe({
    source,
    setters,
    draftKey,
  }: {
    source: Json;
    setters: ReactSetterRegistry;
    draftKey: string;
  }) {
    session = useEditorSession();
    return (
      <SetterRegistryProvider registry={setters}>
        <LiteralSetter
          {...props}
          value={source}
          draft={JSON.stringify(source)}
          draftKey={draftKey}
        />
      </SetterRegistryProvider>
    );
  }
  const registry = options.registry ?? createSetterRegistry();
  const tree = (source = initial, setters = registry, draftKey = 'independent/columns') => (
    <EditorSessionProvider>
      <TipProvider>
        <Probe source={source} setters={setters} draftKey={draftKey} />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  return { props, view, tree, commit, error, session: () => session };
}
