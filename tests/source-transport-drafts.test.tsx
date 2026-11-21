import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema, PageSchema } from '../packages/schema/types';
import type { Registry } from '../packages/runtime/registry';
import { registry as baseRegistry } from '../src/materials';
import { DataPanel } from '../src/editor/DataPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
const literal = (value: string | number) => ({ kind: 'literal' as const, value });
function fixture() {
  const execute = vi.fn(() => ({}));
  const registry: Registry = {
    ...baseRegistry,
    transports: {
      'test.a': {
        version: '1.0.0',
        input: { query: { type: 'string', required: true }, special: { type: 'json' } },
        output: 'object',
        execute,
      },
      'test.b': {
        version: '1.0.0',
        input: { query: { type: 'number', required: true }, only: { type: 'object' } },
        output: 'object',
        execute,
      },
    },
  };
  const schema: ApplicationSchema = {
    schemaVersion: '0.1.0',
    id: 'transport-drafts',
    title: '草稿',
    entryPageId: 'a',
    dependencies: {
      components: { 'ui.text': '1.0.0' },
      actions: {},
      transports: { 'test.a': '1.0.0' },
    },
    pages: ['a', 'b'].map((id): PageSchema => ({
      id,
      title: id,
      state: [],
      dataSources: [
        {
          id: 'main',
          kind: 'query',
          transport: 'test.a',
          input: {
            query: literal(`original-${id}`),
            special: { kind: 'dataRef', sourceId: 'lookup', path: ['first.name', ''] },
          },
          initial: {},
        },
        {
          id: 'lookup',
          kind: 'query',
          transport: 'test.a',
          input: { query: literal(`lookup-${id}`) },
          initial: { 'first.name': { '': 'special' } },
        },
      ],
      children: [{ id: 'text', component: 'ui.text', props: { value: literal(id) } }],
    })),
  };
  return { document: new EditorDocument(schema, registry), execute, schema, registry };
}
function Harness({ document }: { document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  return <DataPanel document={document} snapshot={snapshot} />;
}
function mount(document: EditorDocument) {
  render(
    <TipProvider>
      <EditorSessionProvider>
        <Harness document={document} />
      </EditorSessionProvider>
    </TipProvider>,
  );
  showSources();
}
function showSources() {
  fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
}
const transport = (id: string) => changeControl(screen.getByLabelText('数据源 Transport'), id);
const text = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const incompleteA = () => {
  changeControl(screen.getByLabelText('query取值方式'), 'expression');
  changeControl(screen.getByLabelText('query'), 'state.');
};
const setB = (value: string) => {
  transport('test.b');
  changeControl(screen.getByLabelText('query取值方式'), 'literal');
  changeControl(screen.getByLabelText('query'), value);
};

describe('transport-specific source parameter drafts', () => {
  it('requires an explicit conflict decision if a cached transport contract changes during HMR', () => {
    const { document, schema, registry } = fixture();
    const view = render(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={document} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    showSources();
    incompleteA();
    setB('7');
    transport('test.a');
    const nextRegistry: Registry = {
      ...registry,
      transports: {
        ...registry.transports,
        'test.b': {
          ...registry.transports!['test.b'],
          input: { query: { type: 'boolean', required: true } },
        },
      },
    };
    const next = new EditorDocument(schema, nextRegistry);
    view.rerender(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={next} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    expect((screen.getByRole('button', { name: '保存数据源' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: '确认使用草稿' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    transport('test.b');
    expect(screen.getByLabelText('query取值方式').getAttribute('data-value')).toBe('unset');
  });
  it('restores raw unfinished expressions/paths and never leaks same-name typed inputs or hidden invalid drafts into a save', () => {
    const { document, execute } = fixture();
    mount(document);
    incompleteA();
    changeControl(screen.getByLabelText('special数据路径'), '["first.name","",');
    transport('test.b');
    expect(screen.getByLabelText('query取值方式').getAttribute('data-value')).toBe('unset');
    changeControl(screen.getByLabelText('query取值方式'), 'literal');
    expect(text('query')).toBe('');
    changeControl(screen.getByLabelText('query'), '42');
    changeControl(screen.getByLabelText('only取值方式'), 'literal');
    changeControl(screen.getByLabelText('only'), '{"b":true}');
    transport('test.a');
    expect(screen.getByLabelText('query取值方式').getAttribute('data-value')).toBe('expression');
    expect(text('query')).toBe('state.');
    expect(text('special数据路径')).toBe('["first.name","",');
    transport('test.b');
    expect(text('query')).toBe('42');
    expect(text('only')).toBe('{"b":true}');
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const saved = document.getSnapshot().plan.schema.pages[0].dataSources![0];
    expect(saved.transport).toBe('test.b');
    expect(saved.input).toEqual({
      query: literal(42),
      only: { kind: 'literal', value: { b: true } },
    });
    expect(execute).not.toHaveBeenCalled();
    transport('test.a');
    expect(screen.getByLabelText('query取值方式').getAttribute('data-value')).toBe('unset');
    expect(screen.queryByLabelText('special数据路径')).toBeNull();
  });
  it('discards all transport caches and rebases the whole draft group on external changes', () => {
    const { document } = fixture();
    mount(document);
    incompleteA();
    setB('42');
    act(() =>
      document.updateDataSource('a', 'main', {
        kind: 'query',
        transport: 'test.a',
        input: { query: literal('external') },
        initial: {},
      }),
    );
    expect((screen.getByRole('button', { name: '保存数据源' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    transport('test.a');
    expect(text('query')).toBe('state.');
    transport('test.b');
    expect(text('query')).toBe('42');
    fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    expect(text('query')).toBe('external');
    transport('test.b');
    expect(screen.getByLabelText('query取值方式').getAttribute('data-value')).toBe('unset');
  });
  it('keeps the same group across panel/source/page switches and isolates other sources and pages', () => {
    const { document } = fixture();
    mount(document);
    incompleteA();
    setB('7');
    changeControl(screen.getByLabelText('管理数据源'), 'lookup');
    expect(text('query')).toBe('lookup-a');
    changeControl(screen.getByLabelText('管理数据源'), 'main');
    expect(text('query')).toBe('7');
    act(() => document.selectPage('b'));
    showSources();
    expect(text('query')).toBe('original-b');
    act(() => document.selectPage('a'));
    expect(text('query')).toBe('7');
    transport('test.a');
    expect(text('query')).toBe('state.');
    fireEvent.click(screen.getByRole('tab', { name: '表单模型' }));
    showSources();
    expect(text('query')).toBe('state.');
  });
});
