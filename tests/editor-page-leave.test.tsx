import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type {
  ActionCall,
  ApplicationSchema,
  Json,
  PageSchema,
  Value,
} from '../packages/schema/types';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { EditorSessionProvider } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { changeControl, closeActionConfig, openActionConfig } from './ui-helpers';

const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const notify = (id = 'leave-notice', title: Value = literal('页面离开')): ActionCall => ({
  id,
  action: 'ui.notify',
  input: { title },
});
const execute = (id = 'leave-query', sourceId = 'people'): ActionCall => ({
  id,
  action: 'data.execute',
  input: { sourceId: literal(sourceId) },
});
const application = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'page-leave-acceptance',
  title: '页面离开独立验收',
  entryPageId: 'a',
  dependencies: {
    components: { 'ui.text': '1.0.0' },
    actions: {},
    transports: { 'demo.peopleQuery': '1.0.0' },
  },
  pages: ['a', 'b'].map((id): PageSchema => ({
    id,
    title: `页面 ${id}`,
    state: [{ id: 'label', type: 'string', initial: '初始状态' }],
    dataSources: [
      {
        id: 'people',
        kind: 'query',
        transport: 'demo.peopleQuery',
        input: { query: literal('') },
        initial: {},
      },
    ],
    children: [{ id: `text-${id}`, component: 'ui.text', props: { value: literal(`内容 ${id}`) } }],
  })),
});
const page = (document: EditorDocument, id = 'a') =>
  document.getSnapshot().plan.pages.get(id)!.schema;
const savedLeave = (document: EditorDocument, id = 'a') => page(document, id).onLeave;
const runtimes: PageRuntime[] = [];

afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
});

describe('atomic page-leave action commands', () => {
  it('saves the whole chain with dependencies, clones callers and supports undo', () => {
    const document = new EditorDocument(application(), registry);
    const calls = [notify(), execute()];
    const expected = structuredClone(calls);
    expect(document.setPageLeaveActions('a', calls)).toBe(true);
    expect(savedLeave(document)).toEqual(expected);
    expect(Object.isFrozen(savedLeave(document))).toBe(true);
    expect(document.getSnapshot().plan.schema.dependencies.actions).toEqual({
      'ui.notify': registry.actions['ui.notify'].version,
      'data.execute': registry.actions['data.execute'].version,
    });
    const before = document.getSnapshot();
    expect(document.setPageLeaveActions('a', [])).toBe(true);
    expect(savedLeave(document)).toBeUndefined();
    document.undo();
    expect(document.getSnapshot().plan.schema).toEqual(before.plan.schema);
    const imported = new EditorDocument(JSON.parse(document.exportJson()), registry);
    expect(savedLeave(imported, 'b')).toBeUndefined();
  });

  it('rejects unavailable context and invalid chains without changing the schema', () => {
    const document = new EditorDocument(application(), registry);
    const before = document.getSnapshot();
    expect(() =>
      document.setPageLeaveActions('a', [notify('bad-scope', expression('scope'))]),
    ).toThrow('页面离开动作不能访问 event 或 scope');
    expect(() =>
      document.setPageLeaveActions('a', [notify('bad-scope', expression('event'))]),
    ).toThrow('页面离开动作不能访问 event 或 scope');
    expect(() => document.setPageLeaveActions('missing', [notify()])).toThrow();
    expect(document.getSnapshot()).toBe(before);
  });
});

describe('page-leave panel authoring', () => {
  function mount(document: EditorDocument) {
    function Panel() {
      return (
        <PageLifecyclePanel
          document={document}
          snapshot={document.getSnapshot()}
          authoringAllowed
        />
      );
    }
    return render(
      <EditorSessionProvider>
        <TipProvider>
          <Panel />
        </TipProvider>
      </EditorSessionProvider>,
    );
  }

  it('saves leave actions through the dedicated 页面离开时 chain', () => {
    const document = new EditorDocument(application(), registry);
    mount(document);
    const leave = within(screen.getByRole('region', { name: '页面离开动作' }));
    fireEvent.click(leave.getByRole('button', { name: '添加动作' }));
    openActionConfig(1);
    changeControl(screen.getByLabelText('动作 1 类型'), 'ui.notify');
    changeControl(screen.getByLabelText('title取值方式'), 'literal');
    changeControl(screen.getByLabelText('title'), '离开提醒');
    closeActionConfig();
    fireEvent.click(leave.getByRole('button', { name: '保存离开动作' }));
    expect(savedLeave(document)?.[0].input.title).toEqual(literal('离开提醒'));
    expect(page(document).onEnter).toBeUndefined();
  });
});

describe('page-leave execution boundaries', () => {
  it('runs leave actions once when a preview runtime exits, and never in design mode', async () => {
    const query = vi
      .spyOn(registry.transports!['demo.peopleQuery'], 'execute')
      .mockResolvedValue({ rows: [] });
    const document = new EditorDocument(application(), registry);
    document.setPageLeaveActions('a', [execute(), execute('leave-second')]);
    const preview = new PageRuntime(document.getSnapshot().plan, 'a');
    runtimes.push(preview);
    await preview.enter();
    expect(query).not.toHaveBeenCalled();
    await preview.leave();
    await preview.leave();
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toEqual({ query: '' });
    expect(query.mock.calls[1][0]).toEqual({ query: '' });
    query.mockClear();

    const design = new PageRuntime(document.getSnapshot().plan, 'a', { designMode: true });
    runtimes.push(design);
    await design.enter();
    await design.leave();
    expect(query).not.toHaveBeenCalled();
  });

  it('skips leave actions when the runtime never entered or is already disposed', async () => {
    const query = vi
      .spyOn(registry.transports!['demo.peopleQuery'], 'execute')
      .mockResolvedValue({ rows: [] });
    const document = new EditorDocument(application(), registry);
    document.setPageLeaveActions('a', [execute()]);
    const cold = new PageRuntime(document.getSnapshot().plan, 'a');
    runtimes.push(cold);
    await cold.leave();
    expect(query).not.toHaveBeenCalled();
    await cold.enter();
    await cold.dispose();
    await cold.leave();
    expect(query).not.toHaveBeenCalled();
  });
});
