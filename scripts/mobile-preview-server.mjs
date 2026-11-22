import { randomBytes, timingSafeEqual } from 'node:crypto';

export const MOBILE_PREVIEW_PATH = '/api/mobile-preview';
export const MOBILE_PREVIEW_SNAPSHOT_PATH = '/api/mobile-preview/snapshot';
export const MOBILE_PREVIEW_PORT = 4173;
export const MOBILE_PREVIEW_TTL_MS = 15 * 60 * 1000;
export const MOBILE_PREVIEW_MAX_SESSIONS = 8;
export const MOBILE_PREVIEW_MAX_BODY_BYTES = 2 * 1024 * 1024;

const bearerToken = (request) => {
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === 'string' && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
  return match?.[1] ?? null;
};

const equalToken = (actual, expected) => {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
};

const setResponseHeaders = (response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
};

const sendJson = (response, status, value) => {
  setResponseHeaders(response);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
};

const sendEmpty = (response, status) => {
  setResponseHeaders(response);
  response.statusCode = status;
  response.end();
};

const privateJson = (value, depth = 0) => {
  if (depth > 100) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => privateJson(item, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(
    ([key, item]) =>
      key !== '__proto__' &&
      key !== 'prototype' &&
      key !== 'constructor' &&
      privateJson(item, depth + 1),
  );
};

const readJson = async (request) => {
  const contentType = request.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
  ) {
    return { error: [415, 'Content-Type must be application/json'] };
  }

  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MOBILE_PREVIEW_MAX_BODY_BYTES) {
    request.resume();
    return { error: [413, 'Request body is too large'] };
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MOBILE_PREVIEW_MAX_BODY_BYTES) {
      request.resume();
      return { error: [413, 'Request body is too large'] };
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!privateJson(value)) return { error: [400, 'Invalid JSON payload'] };
    return { value };
  } catch {
    return { error: [400, 'Invalid JSON payload'] };
  }
};

const normalizeAddress = (address) =>
  typeof address === 'string' && address.startsWith('::ffff:') ? address.slice(7) : address;

const isDesktopDocumentPath = (pathname) =>
  pathname === '/' ||
  pathname === '/canvas-runtime.html' ||
  /^\/editor(?:\/(?:pages|apps|application|page\/[^/]+))?\/?$/.test(pathname) ||
  /^\/apps\/[^/]+(?:\/pages\/[^/]+)?\/?$/.test(pathname);

const validSnapshot = ({ application, pageId }) =>
  application !== null &&
  typeof application === 'object' &&
  !Array.isArray(application) &&
  typeof pageId === 'string' &&
  /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(pageId) &&
  Array.isArray(application.pages) &&
  application.pages.some((page) => page && page.id === pageId);

export function createMobilePreviewMiddleware(host, options = {}) {
  const now = options.now ?? Date.now;
  const makeToken = options.makeToken ?? (() => randomBytes(32).toString('base64url'));
  const ttlMs = options.ttlMs ?? MOBILE_PREVIEW_TTL_MS;
  const maxSessions = options.maxSessions ?? MOBILE_PREVIEW_MAX_SESSIONS;
  const sessions = new Map();
  const origin = `http://${host}:${MOBILE_PREVIEW_PORT}`;
  const expectedHost = `${host}:${MOBILE_PREVIEW_PORT}`;

  const purgeExpired = () => {
    for (const [viewerToken, session] of sessions) {
      if (session.expiresAt <= now()) sessions.delete(viewerToken);
    }
  };
  const findByManagementToken = (token) => {
    for (const session of sessions.values()) {
      if (equalToken(token, session.managementToken)) return session;
    }
    return null;
  };
  const trustedLocalRequest = (request) => {
    const address = normalizeAddress(request.socket?.remoteAddress);
    return (
      (address === host || address === '127.0.0.1') &&
      request.headers.host === expectedHost &&
      request.headers.origin === origin
    );
  };

  return async (request, response, next) => {
    let pathname;
    try {
      pathname = new URL(request.url ?? '/', origin).pathname;
    } catch {
      sendJson(response, 400, { error: 'Invalid request URL' });
      return;
    }

    const isApiPath = pathname === '/api' || pathname.startsWith('/api/');
    if (isApiPath) {
      if (request.headers.host !== expectedHost) {
        sendJson(response, 403, { error: 'Invalid host' });
        return;
      }
      if (request.headers.origin && request.headers.origin !== origin) {
        sendJson(response, 403, { error: 'Invalid origin' });
        return;
      }
    }

    if (pathname === MOBILE_PREVIEW_PATH) {
      purgeExpired();
      if (request.method === 'GET' || request.method === 'HEAD') {
        const address = normalizeAddress(request.socket?.remoteAddress);
        if (request.method === 'HEAD') {
          sendEmpty(response, 200);
          return;
        }
        sendJson(response, 200, {
          available: true,
          canCreate: (address === host || address === '127.0.0.1') && sessions.size < maxSessions,
        });
        return;
      }
      if (request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'DELETE') {
        response.setHeader('Allow', 'GET, HEAD, POST, PUT, DELETE');
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (!trustedLocalRequest(request)) {
        sendJson(response, 403, { error: 'Local desktop connection required' });
        return;
      }

      if (request.method === 'DELETE') {
        const token = bearerToken(request);
        const session = findByManagementToken(token);
        if (!session) {
          sendJson(response, 410, { error: 'Preview is no longer available' });
          return;
        }
        sessions.delete(session.viewerToken);
        sendEmpty(response, 204);
        return;
      }

      const parsed = await readJson(request);
      if (parsed.error) {
        sendJson(response, parsed.error[0], { error: parsed.error[1] });
        return;
      }
      const { application, pageId } = parsed.value ?? {};
      if (!validSnapshot({ application, pageId })) {
        sendJson(response, 400, { error: 'Invalid application or pageId' });
        return;
      }

      let session;
      if (request.method === 'POST') {
        if (sessions.size >= maxSessions) {
          sendJson(response, 429, { error: 'Too many active previews' });
          return;
        }
        session = {
          application,
          pageId,
          viewerToken: makeToken(),
          managementToken: makeToken(),
          expiresAt: now() + ttlMs,
        };
        while (sessions.has(session.viewerToken)) session.viewerToken = makeToken();
        sessions.set(session.viewerToken, session);
      } else {
        const managementToken = bearerToken(request);
        session = findByManagementToken(managementToken);
        if (!session) {
          sendJson(response, 410, { error: 'Preview is no longer available' });
          return;
        }
        session.application = application;
        session.pageId = pageId;
        session.expiresAt = now() + ttlMs;
      }

      sendJson(response, request.method === 'POST' ? 201 : 200, {
        url: `${origin}/mobile-preview#${session.viewerToken}`,
        token: session.managementToken,
        expiresAt: session.expiresAt,
      });
      return;
    }

    if (pathname === MOBILE_PREVIEW_SNAPSHOT_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      purgeExpired();
      const token = bearerToken(request);
      const session = token
        ? [...sessions.values()].find((candidate) => equalToken(token, candidate.viewerToken))
        : null;
      if (!session) {
        sendJson(response, 410, { error: 'Preview is no longer available' });
        return;
      }
      if (request.method === 'HEAD') {
        sendEmpty(response, 204);
        return;
      }
      sendJson(response, 200, { application: session.application, pageId: session.pageId });
      return;
    }

    if (isApiPath) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    const isMobilePreviewDocument =
      pathname === '/mobile-preview' || pathname === '/mobile-preview/';
    const isDesktopDocument = isDesktopDocumentPath(pathname);
    const isBuiltAsset = pathname.startsWith('/assets/');
    if (!isMobilePreviewDocument && !isDesktopDocument && !isBuiltAsset) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      sendJson(response, 405, { error: 'Method not allowed' });
      return;
    }

    if (isDesktopDocument) {
      const address = normalizeAddress(request.socket?.remoteAddress);
      const localAddress = address === host || address === '127.0.0.1';
      const validOrigin = !request.headers.origin || request.headers.origin === origin;
      if (request.headers.host !== expectedHost || !localAddress || !validOrigin) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }
    }

    if (isMobilePreviewDocument) response.setHeader('Referrer-Policy', 'no-referrer');
    next();
  };
}

export function createMobilePreviewPlugin(host, options) {
  return {
    name: 'dimlu-mobile-preview',
    configurePreviewServer(server) {
      server.middlewares.use(createMobilePreviewMiddleware(host, options));
    },
  };
}
