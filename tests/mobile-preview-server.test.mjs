import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  createMobilePreviewMiddleware,
  MOBILE_PREVIEW_PORT,
  MOBILE_PREVIEW_SNAPSHOT_PATH,
} from '../scripts/mobile-preview-server.mjs';
import { listPrivateIpv4Addresses, selectPreviewHost } from '../scripts/preview-lan.mjs';

const host = '192.168.1.80';
const expectedHost = `${host}:${MOBILE_PREVIEW_PORT}`;
const origin = `http://${expectedHost}`;
const application = { id: 'demo', pages: [{ id: 'home' }] };

const interfaces = (addresses) => ({
  Ethernet: addresses.map((address) => ({
    address,
    family: 'IPv4',
    internal: address.startsWith('127.'),
  })),
  IPv6: [{ address: 'fe80::1', family: 'IPv6', internal: false }],
});

async function request(
  middleware,
  {
    method = 'GET',
    path = '/api/mobile-preview',
    remoteAddress = host,
    requestHost = expectedHost,
    requestOrigin = origin,
    authorization,
    body,
    extraHeaders = {},
  } = {},
) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = path;
  req.socket = { remoteAddress };
  req.headers = { host: requestHost };
  if (requestOrigin !== undefined) req.headers.origin = requestOrigin;
  if (authorization) req.headers.authorization = authorization;
  if (body !== undefined) {
    req.headers['content-type'] = 'application/json; charset=utf-8';
    req.headers['content-length'] = String(chunks[0].length);
  }
  Object.assign(req.headers, extraHeaders);

  const headers = {};
  const response = {
    statusCode: 200,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    end(payload = '') {
      this.body = String(payload);
    },
  };
  let passedThrough = false;
  await middleware(req, response, () => {
    passedThrough = true;
  });
  return {
    status: response.statusCode,
    headers,
    body: response.body,
    json: response.body ? JSON.parse(response.body) : undefined,
    passedThrough,
  };
}

test('lists and selects only an unambiguous assigned RFC1918 IPv4', () => {
  assert.deepEqual(listPrivateIpv4Addresses(interfaces(['192.168.1.80', '10.0.0.7'])), [
    '192.168.1.80',
    '10.0.0.7',
  ]);
  assert.equal(selectPreviewHost([], interfaces([host])), host);
  assert.equal(selectPreviewHost(['--host', host], interfaces([host])), host);
  assert.equal(selectPreviewHost(['--host=127.0.0.1'], interfaces([])), '127.0.0.1');
  assert.throws(() => selectPreviewHost([], interfaces([])), /未找到/);
  assert.throws(() => selectPreviewHost([], interfaces([host, '10.0.0.7'])), /多个/);
  assert.throws(
    () => selectPreviewHost(['--host', '192.168.1.81'], interfaces([host])),
    /本机已分配/,
  );
  assert.throws(() => selectPreviewHost(['--host', '0.0.0.0'], interfaces([host])), /RFC1918/);
});

test('publishes availability but limits creation to the actual local socket', async () => {
  const middleware = createMobilePreviewMiddleware(host);
  const local = await request(middleware, { method: 'GET' });
  assert.deepEqual(local.json, { available: true, canCreate: true });
  const availabilityHead = await request(middleware, { method: 'HEAD' });
  assert.equal(availabilityHead.status, 200);
  assert.equal(availabilityHead.body, '');
  const unsupportedMethod = await request(middleware, { method: 'PATCH' });
  assert.equal(unsupportedMethod.status, 405);
  assert.equal(unsupportedMethod.headers.allow, 'GET, HEAD, POST, PUT, DELETE');
  const remote = await request(middleware, { method: 'GET', remoteAddress: '10.0.0.9' });
  assert.deepEqual(remote.json, { available: true, canCreate: false });
  const badOrigin = await request(middleware, {
    method: 'GET',
    requestOrigin: 'http://attacker.example',
  });
  assert.equal(badOrigin.status, 403);
  const badHost = await request(middleware, {
    method: 'GET',
    requestHost: 'attacker.example',
  });
  assert.equal(badHost.status, 403);
  const spoofed = await request(middleware, {
    method: 'POST',
    remoteAddress: '10.0.0.9',
    body: { application, pageId: 'home' },
    extraHeaders: { 'x-forwarded-for': host },
  });
  assert.equal(spoofed.status, 403);
  const badUnknownApiHost = await request(middleware, {
    path: '/api/unknown',
    requestHost: 'attacker.example',
  });
  assert.equal(badUnknownApiHost.status, 403);
  const badUnknownApiOrigin = await request(middleware, {
    path: '/api/unknown',
    requestOrigin: 'http://attacker.example',
  });
  assert.equal(badUnknownApiOrigin.status, 403);
});

test('creates read-only viewer snapshots with separate refresh and revoke credentials', async () => {
  let time = 5000;
  let tokenCounter = 1;
  const middleware = createMobilePreviewMiddleware(host, {
    now: () => time,
    ttlMs: 1000,
    makeToken: () => Buffer.alloc(32, tokenCounter++).toString('base64url'),
  });
  const created = await request(middleware, {
    method: 'POST',
    body: { application, pageId: 'home' },
  });
  assert.equal(created.status, 201);
  assert.match(created.headers['cache-control'], /no-store/);
  assert.equal(created.json.expiresAt, 6000);
  const viewerToken = new URL(created.json.url).hash.slice(1);
  const managementAuthorization = `Bearer ${created.json.token}`;
  assert.notEqual(viewerToken, created.json.token);

  const snapshot = await request(middleware, {
    method: 'GET',
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    remoteAddress: '10.0.0.9',
    authorization: `Bearer ${viewerToken}`,
  });
  assert.equal(snapshot.status, 200);
  assert.deepEqual(snapshot.json, { application, pageId: 'home' });
  const wrongCredential = await request(middleware, {
    method: 'GET',
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    authorization: managementAuthorization,
  });
  assert.equal(wrongCredential.status, 410);
  const sessionCheck = await request(middleware, {
    method: 'HEAD',
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    authorization: `Bearer ${viewerToken}`,
  });
  assert.equal(sessionCheck.status, 204);
  assert.equal(sessionCheck.body, '');

  time += 400;
  const refreshedApplication = { id: 'demo', pages: [{ id: 'home' }], title: 'Updated' };
  const refreshed = await request(middleware, {
    method: 'PUT',
    authorization: managementAuthorization,
    body: { application: refreshedApplication, pageId: 'home' },
  });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.json.url, created.json.url);
  assert.equal(refreshed.json.token, created.json.token);
  assert.equal(refreshed.json.expiresAt, 6400);
  const updatedSnapshot = await request(middleware, {
    method: 'GET',
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    authorization: `Bearer ${viewerToken}`,
  });
  assert.deepEqual(updatedSnapshot.json, { application: refreshedApplication, pageId: 'home' });

  const rejectedOrigin = await request(middleware, {
    method: 'PUT',
    authorization: managementAuthorization,
    requestOrigin: 'http://attacker.example',
    body: { application, pageId: 'home' },
  });
  assert.equal(rejectedOrigin.status, 403);
  const revoked = await request(middleware, {
    method: 'DELETE',
    authorization: managementAuthorization,
  });
  assert.equal(revoked.status, 204);
  assert.equal(revoked.body, '');
  const unavailable = await request(middleware, {
    method: 'GET',
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    authorization: `Bearer ${viewerToken}`,
  });
  assert.equal(unavailable.status, 410);

  const expired = await request(middleware, {
    method: 'POST',
    body: { application, pageId: 'home' },
  });
  const expiredViewerToken = new URL(expired.json.url).hash.slice(1);
  time += 1000;
  const expiredSnapshot = await request(middleware, {
    method: 'GET',
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    authorization: `Bearer ${expiredViewerToken}`,
  });
  assert.equal(expiredSnapshot.status, 410);
});

test('limits LAN pages to read-only methods and scopes the editor to the local desktop', async () => {
  const middleware = createMobilePreviewMiddleware(host);
  const mobilePage = await request(middleware, { path: '/mobile-preview?tab=home#viewer' });
  assert.equal(mobilePage.passedThrough, true);
  assert.equal(mobilePage.headers['referrer-policy'], 'no-referrer');

  for (const path of [
    '/',
    '/editor',
    '/editor/',
    '/editor/page/purchases?panel=logic',
    '/editor/pages',
    '/editor/apps',
    '/editor/application',
    '/canvas-runtime.html',
    '/apps/demo',
    '/apps/demo/pages/home',
  ]) {
    const localEditor = await request(middleware, { path });
    assert.equal(localEditor.passedThrough, true, `local ${path} should load`);
    const localEditorHead = await request(middleware, { path, method: 'HEAD' });
    assert.equal(localEditorHead.passedThrough, true, `local HEAD ${path} should load`);
    const remoteEditor = await request(middleware, {
      path,
      remoteAddress: '10.0.0.9',
    });
    assert.equal(remoteEditor.status, 404, `remote ${path} should be blocked`);
    const remoteEditorWrongOrigin = await request(middleware, {
      path,
      requestOrigin: 'http://attacker.example',
    });
    assert.equal(remoteEditorWrongOrigin.status, 404, `cross-origin ${path} should be blocked`);
  }

  const writeRequest = await request(middleware, {
    path: '/mobile-preview',
    method: 'POST',
  });
  assert.equal(writeRequest.status, 405);
  const writeSnapshot = await request(middleware, {
    path: MOBILE_PREVIEW_SNAPSHOT_PATH,
    method: 'POST',
  });
  assert.equal(writeSnapshot.status, 405);
  const writeAsset = await request(middleware, {
    path: '/assets/main.js',
    method: 'POST',
  });
  assert.equal(writeAsset.status, 405);
});

test('bounds snapshots and fails closed for unknown endpoints and invalid payloads', async () => {
  const middleware = createMobilePreviewMiddleware(host, { maxSessions: 1 });
  const invalid = await request(middleware, {
    method: 'POST',
    body: { application, pageId: 'missing' },
  });
  assert.equal(invalid.status, 400);
  const unsupportedContentType = await request(middleware, {
    method: 'POST',
    body: { application, pageId: 'home' },
    extraHeaders: { 'content-type': 'text/plain' },
  });
  assert.equal(unsupportedContentType.status, 415);
  const created = await request(middleware, {
    method: 'POST',
    body: { application, pageId: 'home' },
  });
  assert.equal(created.status, 201);
  const fullAvailability = await request(middleware, { method: 'GET' });
  assert.equal(fullAvailability.json.canCreate, false);
  const full = await request(middleware, {
    method: 'POST',
    body: { application, pageId: 'home' },
  });
  assert.equal(full.status, 429);
  const unknown = await request(middleware, { path: '/api/not-an-endpoint' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.passedThrough, false);
});
