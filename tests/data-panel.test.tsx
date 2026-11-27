import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { EditorDocument } from '../packages/editor/document';
import { DataPanel } from '../src/editor/DataPanel';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { dataSourceExample } from './fixtures/data-source-example';
import { changeControl } from './ui-helpers';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
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
}
describe('data configuration panels', () => {
  it('authors dataRef properties through the shared source and reversible path controls', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    doc.select('query', 'query-error');
    function Inspector() {
      const snapshot = useSyncExternalStore(doc.subscribe, doc.getSnapshot);
      return <PropertyPanel document={doc} snapshot={snapshot} />;
    }
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Inspector />
        </EditorSessionProvider>
      </TipProvider>,
    );
    changeControl(screen.getByLabelText('文本内容绑定方式'), 'dataRef');
    changeControl(screen.getByLabelText('文本内容数据源'), 'people');
    changeControl(screen.getByRole('textbox', { name: '文本内容数据路径' }), '["rows"]');
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('query')!
        .schema.children.find((node) => node.id === 'query-error')!.props.value,
    ).toEqual({ kind: 'dataRef', sourceId: 'people', path: ['rows'] });
    changeControl(screen.getByRole('textbox', { name: '文本内容数据路径' }), '[');
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => doc.select('query', 'heading'));
    act(() => doc.select('query', 'query-error'));
    expect(
      (screen.getByRole('textbox', { name: '文本内容数据路径' }) as HTMLInputElement).value,
    ).toBe('[');
  });
  it('creates a state with one undoable save and keeps invalid source drafts across tabs', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    expect(screen.getByText('本页状态 · 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新建状态' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '新建状态' }));
    const dialog = screen.getByRole('dialog', { name: '新建状态' });
    const scroll = dialog.querySelector('.workbench-dialog-scroll');
    const actions = dialog.querySelector('.workbench-dialog-actions');
    expect(dialog.classList.contains('state-definition-dialog')).toBe(true);
    expect(scroll?.contains(screen.getByRole('textbox', { name: '状态 ID' }))).toBe(true);
    expect(scroll?.contains(screen.getByRole('button', { name: '关闭状态编辑' }))).toBe(false);
    expect(actions?.contains(screen.getByRole('button', { name: '创建状态' }))).toBe(true);
    changeControl(screen.getByRole('textbox', { name: '状态 ID' }), 'selected');
    changeControl(screen.getByRole('textbox', { name: '状态初始值' }), '"新状态"');
    fireEvent.click(screen.getByRole('button', { name: '创建状态' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭状态编辑' }));
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('query')!
        .schema.state.some((state) => state.id === 'selected'),
    ).toBe(true);
    act(() => doc.undo());
    expect(
      doc
        .getSnapshot()
        .plan.pages.get('query')!
        .schema.state.some((state) => state.id === 'selected'),
    ).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    const sourceDialog = screen.getByRole('dialog', { name: '编辑数据源 · people' });
    const sourceScroll = sourceDialog.querySelector('.workbench-dialog-scroll');
    expect(sourceDialog.classList.contains('data-source-dialog')).toBe(true);
    expect(sourceDialog.classList.contains('drawer')).toBe(true);
    expect(screen.getByRole('heading', { name: '基础信息' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '加载方式' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '默认数据' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '请求参数' })).toBeTruthy();
    expect(sourceScroll?.contains(screen.getByRole('textbox', { name: '数据源初始值' }))).toBe(
      true,
    );
    expect(
      sourceDialog
        .querySelector('.data-source-toolbar')
        ?.contains(screen.getByRole('button', { name: '保存数据源' })),
    ).toBe(true);
    expect(
      sourceDialog
        .querySelector('.data-source-toolbar')
        ?.contains(screen.getByRole('button', { name: '关闭数据源编辑' })),
    ).toBe(true);
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{');
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭数据源编辑' }));
    fireEvent.click(screen.getByRole('tab', { name: '页面状态配置' }));
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    expect(
      (screen.getByRole('textbox', { name: '数据源初始值' }) as HTMLTextAreaElement).value,
    ).toBe('{');
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0].initial).toEqual({
      rows: [],
      total: 0,
    });
  });
  it('creates a default GET request without reading an undefined body binding', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '新建数据源' }));
    changeControl(screen.getByRole('combobox', { name: '数据源 Transport' }), 'http.request');
    changeControl(screen.getByRole('textbox', { name: '数据源 ID' }), 'httpGet');
    fireEvent.click(screen.getByRole('button', { name: '创建数据源' }));
    expect(screen.getByRole('alert').textContent).toContain('URL 必须是合法的 http(s) 地址');
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources).toHaveLength(1);
    changeControl(
      screen.getByRole('textbox', { name: '请求 URL' }),
      'https://api.example.com/check',
    );
    fireEvent.click(screen.getByRole('button', { name: '创建数据源' }));
    const saved = doc
      .getSnapshot()
      .plan.pages.get('query')!
      .schema.dataSources!.find((item) => item.id === 'httpGet');
    expect(saved).toMatchObject({ id: 'httpGet', kind: 'query', transport: 'http.request' });
    expect(saved?.input).not.toHaveProperty('body');
    expect(saved?.input).not.toHaveProperty('timeout');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('creates and sends an HTTP request with Params and displays non-2xx response details', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{"error":"unavailable"}', { status: 503, statusText: 'Service Unavailable' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '新建数据源' }));
    changeControl(screen.getByRole('combobox', { name: '数据源 Transport' }), 'http.request');
    changeControl(screen.getByRole('textbox', { name: '数据源 ID' }), 'httpCheck');
    changeControl(
      screen.getByRole('textbox', { name: '请求 URL' }),
      'https://api.example.com/check',
    );
    changeControl(screen.getByRole('combobox', { name: '请求方法' }), 'POST');
    changeControl(screen.getByRole('spinbutton', { name: '请求超时' }), '2500');
    expect(screen.queryByRole('combobox', { name: '数据源执行类型' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '添加参数' }));
    changeControl(screen.getByRole('textbox', { name: 'Params 键 1' }), 'q');
    changeControl(screen.getByRole('textbox', { name: 'Params 值 1' }), 'one');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('503 Service Unavailable');
    expect(screen.getByRole('textbox', { name: '响应 Body' })).toHaveProperty(
      'value',
      '{\n  "error": "unavailable"\n}',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.com/check?q=one');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建数据源' }));
    const saved = doc
      .getSnapshot()
      .plan.pages.get('query')!
      .schema.dataSources!.find((item) => item.id === 'httpCheck');
    expect(saved?.transport).toBe('http.request');
    expect(saved?.kind).toBe('mutation');
    expect(saved?.input.params).toEqual({ kind: 'literal', value: { q: 'one' } });
    expect(saved?.input.timeout).toEqual({ kind: 'literal', value: 2500 });
    expect(saved?.input.body).toEqual({ kind: 'literal', value: {} });
  });
  it('clears completed responses and prevents discarded requests from updating the next draft', async () => {
    let lateBody!: (text: string) => void;
    const readBody = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          lateBody = resolve;
        }),
    );
    let finishNext!: (response: Response) => void;
    const nextResponse = new Promise<Response>((resolve) => {
      finishNext = resolve;
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('old response', { status: 200, statusText: 'Old' }))
      .mockResolvedValueOnce({
        status: 200,
        statusText: 'Discarded',
        text: readBody,
      } as unknown as Response)
      .mockReturnValueOnce(nextResponse);
    vi.stubGlobal('fetch', fetchMock);
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '新建数据源' }));
    const send = () => {
      changeControl(
        screen.getByRole('textbox', { name: '请求 URL' }),
        'https://api.example.com/check',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    };
    const discard = () => fireEvent.click(screen.getByRole('button', { name: '放弃草稿' }));
    send();
    await screen.findByText('200 Old');
    discard();
    expect(screen.queryByRole('textbox', { name: '响应 Body' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '请求 URL' })).toHaveProperty('value', '');

    await act(async () => {
      send();
    });
    expect(readBody).toHaveBeenCalledOnce();
    const signal = fetchMock.mock.calls[1][1]?.signal;
    discard();
    expect(signal?.aborted).toBe(true);
    send();
    await act(async () => {
      lateBody('discarded response');
    });
    expect(screen.queryByText('200 Discarded')).toBeNull();
    expect(screen.queryByRole('textbox', { name: '响应 Body' })).toBeNull();
    expect(screen.getByRole('button', { name: '发送中…' })).toHaveProperty('disabled', true);
    await act(async () => {
      finishNext(new Response('fresh response', { status: 200, statusText: 'Fresh' }));
    });
    expect(screen.getByRole('textbox', { name: '响应 Body' })).toHaveProperty(
      'value',
      'fresh response',
    );
  });
  it('preserves HTTP expression bindings when reopening and saving without edits', () => {
    const app = structuredClone(dataSourceExample);
    const source = app.pages[0].dataSources![0];
    source.transport = 'http.request';
    source.input = {
      url: { kind: 'expression', language: 'javascript', source: 'state.query' },
      method: { kind: 'literal', value: 'GET' },
      headers: { kind: 'literal', value: {} },
    };
    app.dependencies.transports!['http.request'] = '1.0.0';
    const doc = new EditorDocument(app, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    expect(screen.getByRole('textbox', { name: '请求 URL' })).toHaveProperty('value', '');
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0].input.url).toEqual({
      kind: 'expression',
      language: 'javascript',
      source: 'state.query',
    });
  });
  it('preserves the custom transport flow from a new HTTP designer draft', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '新建数据源' }));
    expect(screen.getByRole('combobox', { name: '请求方法' })).toBeTruthy();
    changeControl(screen.getByRole('combobox', { name: '数据源 Transport' }), 'demo.peopleQuery');
    expect(screen.queryByRole('combobox', { name: '请求方法' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'query取值方式' })).toBeTruthy();
  });
  it('shows and saves page overrides for a referenced shared transport', () => {
    const app = structuredClone(dataSourceExample);
    app.sharedDataSources = [
      {
        id: 'sharedPeople',
        kind: 'query',
        transport: 'demo.peopleQuery',
        input: { query: { kind: 'literal', value: 'default' } },
        initial: { rows: [], total: 0 },
      },
    ];
    const doc = new EditorDocument(app, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '新建数据源' }));
    changeControl(screen.getByRole('textbox', { name: '数据源 ID' }), 'sharedPage');
    changeControl(screen.getByRole('combobox', { name: '数据源共享引用' }), 'sharedPeople');
    expect(
      (screen.getByRole('combobox', { name: '数据源共享引用' }) as HTMLButtonElement).dataset.value,
    ).toBe('sharedPeople');
    expect(screen.getByRole('combobox', { name: 'query取值方式' })).toBeTruthy();
    expect(
      (screen.getByRole('combobox', { name: 'query取值方式' }) as HTMLButtonElement).dataset.value,
    ).toBe('unset');
    changeControl(screen.getByRole('combobox', { name: 'query取值方式' }), 'literal');
    changeControl(screen.getByRole('textbox', { name: 'query' }), 'override');
    fireEvent.click(screen.getByRole('button', { name: '创建数据源' }));
    const saved = JSON.parse(doc.exportJson()).pages[0].dataSources.find(
      (item: { id: string }) => item.id === 'sharedPage',
    );
    expect(saved?.ref).toBe('sharedPeople');
    expect(saved?.input).toEqual({ query: { kind: 'literal', value: 'override' } });
  });
  it('requires conflict confirmation before replacing updated source definitions', () => {
    const doc = new EditorDocument(dataSourceExample, registry);
    mount(doc);
    fireEvent.click(screen.getByRole('tab', { name: '数据源' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑数据源 people' }));
    changeControl(screen.getByRole('textbox', { name: '数据源初始值' }), '{"rows":[],"total":5}');
    const source = doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0];
    act(() =>
      doc.updateDataSource('query', 'people', { ...source, initial: { rows: [], total: 2 } }),
    );
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0].initial).toEqual({
      rows: [],
      total: 2,
    });
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    fireEvent.click(screen.getByRole('button', { name: '保存数据源' }));
    expect(doc.getSnapshot().plan.pages.get('query')!.schema.dataSources![0].initial).toEqual({
      rows: [],
      total: 5,
    });
  });
});
