import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileApplication } from '../packages/runtime/engine';
import { buildHttpRequest, httpRequestTransport } from '../packages/runtime/http-transport';
import { registry } from '../src/materials';
import type { ApplicationSchema } from '../packages/schema/types';
import { validateApplication } from '../packages/schema/validate';

const literal = (value: unknown) =>
  ({ kind: 'literal' as const, value }) as { kind: 'literal'; value: never };

const httpApp = (declared = true): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'http-app',
  title: 'HTTP 数据源',
  entryPageId: 'one',
  dependencies: {
    components: { 'ui.text': '1.0.0' },
    actions: {},
    transports: declared ? { 'http.request': '1.0.0' } : {},
    computations: {},
  },
  pages: [
    {
      id: 'one',
      title: 'one',
      state: [],
      children: [],
      dataSources: [
        {
          id: 'remote',
          kind: 'query',
          transport: 'http.request',
          input: {
            url: literal('https://api.example.com/orders'),
            method: literal('GET'),
            headers: literal({ Accept: 'application/json' }),
          },
          initial: {},
        },
      ],
    },
  ],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('http.request transport', () => {
  it('executes a JSON GET request through the platform registry', async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response('{"ok":true,"items":[1,2]}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const contract = registry.transports!['http.request'];
    expect(contract).toBeTruthy();
    const result = await contract.execute(
      { url: 'https://api.example.com/orders', method: 'GET' },
      { signal: new AbortController().signal },
    );
    expect(result).toEqual({ ok: true, items: [1, 2] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    const built = buildHttpRequest({
      url: 'https://api.example.com/path',
      params: { q: 'one' },
    });
    expect(built.url).toBe('https://api.example.com/path?q=one');
  });

  it('does not add duplicate content type when header casing differs', () => {
    const built = buildHttpRequest({
      url: 'https://api.example.com/orders',
      method: 'POST',
      headers: { 'content-type': 'application/custom' },
      body: { ok: true },
    });
    expect(Object.keys(built.init.headers as Record<string, string>)).toEqual(['content-type']);
  });

  it('serializes a JSON body and defaults the content type for POST', async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) => new Response('{"id":7}', { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await httpRequestTransport.execute(
      {
        url: 'https://api.example.com/orders',
        method: 'POST',
        headers: { Authorization: 'Bearer t' },
        body: { name: '键盘', quantity: 2 },
      },
      { signal: new AbortController().signal },
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: '键盘', quantity: 2 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer t');
  });

  it('rejects invalid urls, unsupported methods, GET bodies and bad headers', async () => {
    const signal = new AbortController().signal;
    await expect(httpRequestTransport.execute({ url: 'ftp://x' }, { signal })).rejects.toThrow(
      'http(s)',
    );
    await expect(
      httpRequestTransport.execute({ url: 'https://a.com', method: 'TRACE' }, { signal }),
    ).rejects.toThrow('不支持的请求方法');
    await expect(
      httpRequestTransport.execute(
        { url: 'https://a.com', method: 'GET', body: { x: 1 } },
        { signal },
      ),
    ).rejects.toThrow('GET 请求不能携带 body');
    await expect(
      httpRequestTransport.execute({ url: 'https://a.com', headers: { token: 5 } }, { signal }),
    ).rejects.toThrow('请求头 token');
  });

  it('surfaces non-2xx responses and times out stalled requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
    await expect(
      httpRequestTransport.execute(
        { url: 'https://a.com' },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('HTTP 503');

    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit | undefined) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      ),
    );
    await expect(
      httpRequestTransport.execute(
        { url: 'https://a.com', timeout: 30 },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('超时');
  });

  it('times out while the response body is pending', async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response(null, { status: 200 });
      response.text = () => new Promise<string>(() => {});
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      httpRequestTransport.execute(
        { url: 'https://a.com', timeout: 20 },
        { signal: new AbortController().signal },
      ),
    ).rejects.toThrow('超时');
  });

  it('cancels response body consumption when the caller aborts', async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response(null, { status: 200 });
      response.text = () => new Promise<string>(() => {});
      return response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    const request = httpRequestTransport.execute(
      { url: 'https://a.com', timeout: 1000 },
      { signal: caller.signal },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    caller.abort();
    await expect(request).rejects.toThrow('中止');
  });

  it('does not call fetch for a pre-aborted signal', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const caller = new AbortController();
    caller.abort();
    await expect(
      httpRequestTransport.execute({ url: 'https://a.com' }, { signal: caller.signal }),
    ).rejects.toThrow('中止');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('compiles an app using http.request without declaring a transport dependency', () => {
    const plan = compileApplication(httpApp(false), registry);
    expect(plan.pages.get('one')!.schema.dataSources![0].transport).toBe('http.request');
  });

  it('still flags undeclared custom transports', () => {
    const app = httpApp(false);
    (app.pages[0].dataSources![0] as { transport: string }).transport = 'custom.thing';
    const issues = validateApplication(app, registry);
    expect(issues.some((issue) => issue.message.includes('custom.thing 未声明依赖'))).toBe(true);
  });
});
