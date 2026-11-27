import type { TransportContract } from './registry';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TIMEOUT_MS = 15000;

export type HttpRequestInput = Record<string, unknown>;
export type BuiltHttpRequest = { url: string; init: RequestInit; timeout: number };

const parseHeaders = (raw: unknown): Record<string, string> => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('headers 必须是 JSON 对象');
  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries)
    if (typeof value !== 'string') throw new Error(`请求头 ${key} 的值必须是文本`);
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)])) as Record<
    string,
    string
  >;
};

export function buildHttpRequest(input: HttpRequestInput): BuiltHttpRequest {
  const rawUrl = String(input.url ?? '').trim();
  if (!/^https?:\/\/\S+$/.test(rawUrl))
    throw new Error('URL 必须是合法的 http(s) 地址，且不能包含空白');
  const method =
    String(input.method ?? 'GET')
      .trim()
      .toUpperCase() || 'GET';
  if (!METHODS.has(method))
    throw new Error(`不支持的请求方法 ${method}，可用：GET / POST / PUT / PATCH / DELETE`);
  const headers = parseHeaders(input.headers);
  if (input.body !== undefined && input.body !== null && method === 'GET')
    throw new Error('GET 请求不能携带 body');
  const timeout =
    typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout > 0
      ? input.timeout
      : DEFAULT_TIMEOUT_MS;
  const url = new URL(rawUrl);
  if (input.params !== undefined && input.params !== null) {
    if (typeof input.params !== 'object' || Array.isArray(input.params))
      throw new Error('params 必须是 JSON 对象');
    for (const [key, value] of Object.entries(input.params as Record<string, unknown>))
      if (value !== undefined && value !== null)
        url.searchParams.set(
          key,
          typeof value === 'object' ? JSON.stringify(value) : String(value),
        );
  }
  const hasBody = input.body !== undefined && input.body !== null;
  const hasContentType = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
  return {
    url: url.toString(),
    timeout,
    init: {
      method,
      headers:
        hasBody && !hasContentType ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: hasBody ? JSON.stringify(input.body) : undefined,
    },
  };
}

/** 平台内置 HTTP 请求 transport：应用作者在数据源面板即可配置远程 API，无需宿主代码。 */
export async function performHttpRequest<T>(
  input: HttpRequestInput,
  signal: AbortSignal,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  if (signal.aborted) throw new Error('请求已被中止');
  const { url, timeout, init } = buildHttpRequest(input);
  const controller = new AbortController();
  let rejectInterrupted!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectInterrupted = reject;
  });
  const interrupt = (reason: Error) => {
    rejectInterrupted(reason);
    controller.abort(reason);
  };
  const abort = () => interrupt(new Error('请求已被中止'));
  const timer = setTimeout(() => interrupt(new Error(`请求超时（${timeout}ms）`)), timeout);
  signal.addEventListener('abort', abort, { once: true });
  try {
    const request = async () => {
      const response = await fetch(url, { ...init, signal: controller.signal });
      controller.signal.throwIfAborted();
      return consume(response);
    };
    return await Promise.race([interrupted, request()]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export const httpRequestTransport: TransportContract = {
  version: '1.0.0',
  input: {
    url: { type: 'string', required: true },
    method: { type: 'string' },
    headers: { type: 'json' },
    params: { type: 'json' },
    body: { type: 'json' },
    timeout: { type: 'number' },
  },
  output: 'json',
  execute(input, { signal }) {
    return performHttpRequest(input, signal, async (response) => {
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status} ${response.statusText || '请求失败'}`);
      }
      const text = await response.text();
      try {
        return text ? (JSON.parse(text) as never) : null;
      } catch {
        return text;
      }
    });
  },
};
