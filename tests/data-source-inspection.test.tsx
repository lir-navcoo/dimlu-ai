import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, type EditorSnapshot } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import { createRegistry } from '../packages/runtime/registry';
import type { ApplicationSchema, Json } from '../packages/schema/types';
import { DebugDock } from '../src/editor/DebugDock';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

const runtimes: PageRuntime[] = [];
afterEach(() => {
  cleanup();
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  vi.restoreAllMocks();
});
function deferred() {
  let resolve!: (value: Json) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Json>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup(initial: Record<string, Json> = { people: { rows: [], total: 0 } }) {
  const requests: ReturnType<typeof deferred>[] = [];
  const signals: AbortSignal[] = [];
  const execute = vi.fn((_input: Record<string, Json>, context: { signal: AbortSignal }) => {
    const request = deferred();
    requests.push(request);
    signals.push(context.signal);
    return request.promise;
  });
  const registry = createRegistry(
    {},
    {},
    {},
    { 'local.query': { version: '1.0.0', input: {}, output: 'json', execute } },
  );
  const schema: ApplicationSchema = {
    schemaVersion: '0.1.0',
    id: 'source-inspection',
    title: 'Inspect',
    entryPageId: 'page',
    dependencies: { components: {}, actions: {}, transports: { 'local.query': '1.0.0' } },
    pages: ['page', 'second'].map((id) => ({
      id,
      title: id,
      state: [{ id: 'query', type: 'string' as const, initial: id }],
      forms: [
        {
          id: 'form',
          fields: [
            { id: 'name', path: ['name'], label: 'Name', type: 'string' as const, initial: id },
          ],
        },
      ],
      dataSources: Object.entries(initial).map(([sourceId, data]) => ({
        id: sourceId,
        kind: 'query' as const,
        transport: 'local.query',
        input: {},
        initial: id === 'page' ? data : { owner: 'second' },
      })),
      children: [],
    })),
  };
  const document = new EditorDocument(schema, registry);
  const runtime = new PageRuntime(document.getSnapshot().plan, 'page');
  runtimes.push(runtime);
  function Scene({
    current,
    plan,
    author,
  }: {
    current: PageRuntime;
    plan: PageRuntime['plan'];
    author?: EditorSnapshot;
  }) {
    const [open, setOpen] = useState(true);
    return (
      <DebugDock
        document={document}
        runtime={current}
        plan={plan}
        authorSnapshot={author}
        open={open}
        setOpen={setOpen}
        height={240}
        maxHeight={500}
        setHeight={() => {}}
        mobile={false}
      />
    );
  }
  const tree = (current = runtime, plan = current.plan, author?: EditorSnapshot) => (
    <EditorSessionProvider>
      <TipProvider>
        <Scene current={current} plan={plan} author={author} />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree());
  const fresh = (page = 'page') => {
    const next = new PageRuntime(document.getSnapshot().plan, page);
    runtimes.push(next);
    return next;
  };
  return { document, runtime, view, tree, fresh, requests, signals, execute };
}
function stateTab() {
  fireEvent.click(screen.getByRole('tab', { name: '页面状态' }));
}
function section() {
  return screen.getByRole('region', { name: '数据源状态' });
}
function displayed(id = 'people') {
  return JSON.parse(screen.getByLabelText(`数据源 ${id} 当前快照`).textContent!);
}
function exact(runtime: PageRuntime, id = 'people', label?: string) {
  expect(displayed(id)).toEqual(runtime.getDataSource(id).getSnapshot());
  if (label)
    expect(
      within(screen.getByLabelText(`数据源 ${id} 当前快照`).closest('article')!).getByRole(
        'heading',
        {
          name: `${id} · ${label}`,
        },
      ),
    ).toBeTruthy();
}
function oldJson(heading: string) {
  return JSON.parse(
    screen.getByRole('heading', { name: heading }).parentElement!.querySelector('pre')!
      .textContent!,
  );
}

describe('045 independent current page data-source snapshot inspection', () => {
  it('distinguishes the empty page from real null/false/zero/empty-string sources and preserves original page/form blocks', () => {
    const empty = setup({});
    stateTab();
    expect(within(section()).getByText('当前页面暂无数据源')).toBeTruthy();
    expect(oldJson('页面状态 · page')).toEqual(empty.runtime.getState());
    expect(oldJson('表单状态')).toEqual(empty.runtime.getFormsSnapshot());
    expect(empty.execute).not.toHaveBeenCalled();
    empty.view.unmount();
    const initial = { nil: null, flag: false, count: 0, text: '' };
    const actual = setup(initial);
    stateTab();
    expect(within(section()).queryByText('当前页面暂无数据源')).toBeNull();
    for (const id of Object.keys(initial)) exact(actual.runtime, id, '空闲');
    expect(actual.execute).not.toHaveBeenCalled();
  });

  it('updates from actual source meta publications through loading/success/loading/error while retaining exact successful data', async () => {
    const h = setup({ people: { rows: [], total: 0 }, alternate: { owner: 'untouched' } });
    stateTab();
    const source = h.runtime.getDataSource('people');
    const original = h.runtime.getState();
    exact(h.runtime, 'people', '空闲');
    exact(h.runtime, 'alternate', '空闲');
    let first!: Promise<Json>;
    act(() => {
      first = source.execute();
    });
    exact(h.runtime, 'people', '加载中');
    expect(h.execute).toHaveBeenCalledTimes(1);
    await act(async () => {
      h.requests[0].resolve({ rows: [{ id: 1, name: 'Local record' }], total: 1 });
      await first;
    });
    exact(h.runtime, 'people', '成功');
    const successful = source.getSnapshot().data;
    let second!: Promise<Json>;
    act(() => {
      second = source.execute();
    });
    expect(displayed().data).toEqual(successful);
    exact(h.runtime, 'people', '加载中');
    const error = new TypeError('Local <failed> "request"');
    await act(async () => {
      h.requests[1].reject(error);
      await expect(second).rejects.toThrow(error.message);
    });
    exact(h.runtime, 'people', '失败');
    expect(displayed()).toMatchObject({
      data: successful,
      loading: false,
      error: { name: 'TypeError', message: error.message },
    });
    expect(section().textContent).not.toContain('[object Object]');
    exact(h.runtime, 'alternate', '空闲');
    expect(h.runtime.getState()).toBe(original);
    expect(h.execute).toHaveBeenCalledTimes(2);
  });

  it('shows actual cancellation as idle with retained data and never executes, refreshes or cancels from diagnostic controls', async () => {
    const h = setup({ people: { retained: true } });
    stateTab();
    const source = h.runtime.getDataSource('people');
    const execute = vi.spyOn(source, 'execute');
    const refresh = vi.spyOn(source, 'refresh');
    const cancel = vi.spyOn(source, 'cancel');
    let pending!: Promise<Json>;
    act(() => {
      pending = source.execute();
    });
    const result = pending.catch((error) => error as Error);
    exact(h.runtime, 'people', '加载中');
    act(() => source.cancel());
    await act(async () => {
      expect(await result).toMatchObject({ name: 'AbortError' });
    });
    exact(h.runtime, 'people', '空闲');
    expect(displayed().data).toEqual({ retained: true });
    expect(section().textContent).not.toMatch(/已取消|未执行|从未/);
    expect(h.signals[0].aborted).toBe(true);
    const snapshot = source.getSnapshot();
    fireEvent.click(screen.getByRole('button', { name: '最大化调试区' }));
    fireEvent.click(screen.getByRole('button', { name: '还原调试区' }));
    fireEvent.click(screen.getByRole('tab', { name: '执行记录' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    stateTab();
    fireEvent.click(screen.getByRole('button', { name: '关闭调试区' }));
    stateTab();
    await act(async () => {
      h.requests[0].resolve({ late: 'must not publish' });
      await Promise.resolve();
    });
    expect(source.getSnapshot()).toBe(snapshot);
    exact(h.runtime, 'people', '空闲');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched owners and replaces same-ID runtime/page values without listening to the old source after replacement', async () => {
    const h = setup({ people: { owner: 'initial' } });
    stateTab();
    const source = h.runtime.getDataSource('people');
    let first!: Promise<Json>;
    act(() => {
      first = source.execute();
    });
    await act(async () => {
      h.requests[0].resolve({ owner: 'old-success' });
      await first;
    });
    const next = h.fresh();
    h.view.rerender(h.tree(next));
    exact(next);
    expect(section().textContent).not.toContain('old-success');
    const currentRead = vi.spyOn(next, 'getDataSourcesSnapshot');
    currentRead.mockClear();
    let stale!: Promise<Json>;
    act(() => {
      stale = source.execute();
    });
    await act(async () => {
      h.requests[1].resolve({ owner: 'late-old' });
      await stale;
    });
    expect(currentRead).not.toHaveBeenCalled();
    expect(section().textContent).not.toContain('late-old');
    const prior = h.document.getSnapshot();
    act(() => h.document.select('second', null));
    h.view.rerender(h.tree(next, next.plan, prior));
    expect(within(section()).getByText('数据源状态正在更新')).toBeTruthy();
    expect(within(section()).queryByLabelText('数据源 people 当前快照')).toBeNull();
    expect(section().textContent).not.toContain('当前页面暂无数据源');
    const second = h.fresh('second');
    h.view.rerender(h.tree(second, second.plan, h.document.getSnapshot()));
    exact(second);
    expect(displayed().data).toEqual({ owner: 'second' });
    h.view.rerender(
      h.tree(second, next.plan, { ...h.document.getSnapshot(), plan: { ...second.plan } }),
    );
    expect(within(section()).getByText('数据源状态正在更新')).toBeTruthy();
    h.view.rerender(h.tree(second, second.plan, h.document.getSnapshot()));
    const read = vi.spyOn(second, 'getDataSourcesSnapshot');
    h.view.unmount();
    read.mockClear();
    let unmounted!: Promise<Json>;
    act(() => {
      unmounted = second.getDataSource('people').execute();
    });
    // execute evaluates the source input in its own runtime context, which
    // legitimately reads source snapshots once even with no view mounted.
    // Isolate notifications after that explicit test-arranged business read.
    read.mockClear();
    await act(async () => {
      h.requests[2].resolve({ owner: 'unmounted' });
      await unmounted;
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('preserves dirty Schema editor identity/text/caret and existing page/form updates during source notifications with no author mutation', async () => {
    const h = setup();
    const editor = screen.getByRole('textbox', { name: '应用定义 · JSON' }) as HTMLTextAreaElement;
    const draft = editor.value + '\n ';
    changeControl(editor, draft);
    editor.setSelectionRange(9, 9);
    stateTab();
    act(() => {
      h.runtime.setState('query', 'changed page');
      h.runtime.getForm('form').setValue('name', 'changed form');
    });
    expect(oldJson('页面状态 · page')).toEqual(h.runtime.getState());
    expect(oldJson('表单状态')).toEqual(h.runtime.getFormsSnapshot());
    const original = h.document.getSnapshot();
    const publications = vi.fn();
    const stop = h.document.subscribe(publications);
    const form = h.runtime.getForm('form').getSnapshot();
    const page = h.runtime.getState();
    let pending!: Promise<Json>;
    act(() => {
      pending = h.runtime.getDataSource('people').execute();
    });
    await act(async () => {
      h.requests[0].resolve({ rows: [{ value: 'meta only' }] });
      await pending;
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(screen.getByRole('textbox', { name: '应用定义 · JSON' })).toBe(editor);
    expect(editor.value).toBe(draft);
    expect(editor.selectionStart).toBe(9);
    expect(editor.selectionEnd).toBe(9);
    stateTab();
    exact(h.runtime, 'people', '成功');
    expect(h.document.getSnapshot()).toBe(original);
    expect(publications).not.toHaveBeenCalled();
    expect(h.runtime.getState()).toBe(page);
    expect(h.runtime.getForm('form').getSnapshot()).toBe(form);
    expect(h.execute).toHaveBeenCalledTimes(1);
    stop();
  });
});
