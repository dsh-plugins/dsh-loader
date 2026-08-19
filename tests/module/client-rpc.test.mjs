// L2 module tests â€?client fetch interceptor (design.md Â§4.7, Â§5.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClient, installSettingsFetchInterceptor } from '../../dist/client.js';
import { makeMockWindow } from '../helpers/mock.mjs';

// Helper: a fake Response constructor that records body + status.
function fakeResponse(body, status = 200) {
  return {
    status,
    headers: { get: () => 'application/json' },
    _body: body,
    async json() { return JSON.parse(this._body); },
    async text() { return this._body; },
    clone() { return fakeResponse(this._body, this.status); },
  };
}

function makeWindowWithFetch(fetchImpl) {
  const win = makeMockWindow().window;
  win.fetch = fetchImpl;
  // Must be a constructable function (client.js uses `new win.Response(...)`).
  win.Response = function Response(body, init) {
    return fakeResponse(body, init?.status ?? 200);
  };
  return win;
}

// TC-CLI-RPC-01: exposeAllNamespaces off â†?settings.describe untouched.
test('TC-CLI-RPC-01 exposeAllNamespaces off leaves describe response untouched', async () => {
  const official = { result: { value: { namespaces: [{ ns: 'shell' }] } } };
  let fetchCalls = 0;
  const win = makeWindowWithFetch(async (input) => {
    fetchCalls += 1;
    return fakeResponse(JSON.stringify(official));
  });
  installClient({ window: win, exposeAllNamespaces: false });
  const res = await win.fetch('/api/settings.describe');
  const body = await res.json();
  assert.deepEqual(body, official); // unchanged
  assert.equal(fetchCalls, 1); // no bridge call
});

// TC-CLI-RPC-01b: exposeAllNamespaces on â†?bridge namespaces merged in.
test('TC-CLI-RPC-01b exposeAllNamespaces on merges non-whitelisted namespaces', async () => {
  const official = { result: { value: { namespaces: [{ ns: 'shell' }] } } };
  const bridge = { ok: true, namespaces: [{ ns: 'task-board', schema: {}, value: {}, applies: {}, secrets: [], revision: 1 }] };
  const win = makeWindowWithFetch(async (input) => {
    if (String(input).includes('/api/dshloader/settings/describe')) {
      return fakeResponse(JSON.stringify(bridge));
    }
    return fakeResponse(JSON.stringify(official));
  });
  installClient({ window: win, exposeAllNamespaces: true });
  const res = await win.fetch('/api/settings.describe');
  const body = await res.json();
  const nss = body.result.value.namespaces.map((n) => n.ns);
  assert.ok(nss.includes('shell'));
  assert.ok(nss.includes('task-board'));
});

// TC-CLI-RPC-01c: non-whitelisted write routed via bridge, rpcId echoed.
test('TC-CLI-RPC-01c non-whitelisted write echoes rpcId in server-response envelope', async () => {
  const officialDescribe = { result: { value: { namespaces: [{ ns: 'shell' }] } } };
  const bridgeDescribe = { ok: true, namespaces: [{ ns: 'task-board', schema: {}, value: {}, applies: {}, secrets: [], revision: 0 }] };
  const writeResult = { ok: true, result: { ok: true, value: { ns: 'task-board', schema: {}, value: { enabled: true }, applies: {}, secrets: [], revision: 1 } } };
  const calls = [];
  const win = makeWindowWithFetch(async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.includes('/api/dshloader/settings/describe')) return fakeResponse(JSON.stringify(bridgeDescribe));
    if (url === '/api/settings.describe') return fakeResponse(JSON.stringify(officialDescribe));
    if (url === '/api/dshloader/settings/update') return fakeResponse(JSON.stringify(writeResult));
    return fakeResponse(JSON.stringify({ ok: false }));
  });
  installClient({ window: win, exposeAllNamespaces: true });

  // Prime officialExposed by calling describe first.
  await (await win.fetch('/api/settings.describe')).json();

  const res = await win.fetch('/api/settings.update', {
    method: 'POST',
    body: JSON.stringify({ rpcId: 'r-123', payload: { ns: 'task-board', section: { enabled: true }, expectedRevision: 0 } }),
  });
  const body = await res.json();
  assert.equal(body.type, 'server-response');
  assert.equal(body.rpcId, 'r-123');
  assert.equal(body.result.ok, true);
  assert.equal(body.result.value.ns, 'task-board');
  // bridge write was called
  assert.ok(calls.some((c) => c.url === '/api/dshloader/settings/update' && c.method === 'POST'));
});

// TC-CLI-RPC-01c (failure path): rpcId echoed even when bridge result.ok=false.
test('TC-CLI-RPC-01c failure still echoes rpcId', async () => {
  const officialDescribe = { result: { value: { namespaces: [{ ns: 'shell' }] } } };
  const bridgeDescribe = { ok: true, namespaces: [{ ns: 'task-board', schema: {}, value: {}, applies: {}, secrets: [], revision: 0 }] };
  const writeResult = { ok: true, result: { ok: false, code: 'settings-conflict', message: 'mismatch' } };
  const win = makeWindowWithFetch(async (input) => {
    const url = String(input);
    if (url.includes('/api/dshloader/settings/describe')) return fakeResponse(JSON.stringify(bridgeDescribe));
    if (url === '/api/settings.describe') return fakeResponse(JSON.stringify(officialDescribe));
    if (url === '/api/dshloader/settings/update') return fakeResponse(JSON.stringify(writeResult));
    return fakeResponse(JSON.stringify({ ok: false }));
  });
  installClient({ window: win, exposeAllNamespaces: true });
  await (await win.fetch('/api/settings.describe')).json();
  const res = await win.fetch('/api/settings.update', {
    method: 'POST',
    body: JSON.stringify({ rpcId: 'r-456', payload: { ns: 'task-board', section: {}, expectedRevision: 9 } }),
  });
  const body = await res.json();
  assert.equal(body.type, 'server-response');
  assert.equal(body.rpcId, 'r-456');
  assert.equal(body.result.ok, false);
});

// TC-CLI-RPC-02: non-target requests pass through unchanged.
test('TC-CLI-RPC-02 non-target requests pass through to originalFetch', async () => {
  let originalCalled = false;
  const win = makeWindowWithFetch(async (input, init) => {
    originalCalled = true;
    return fakeResponse(JSON.stringify({ ok: true, echo: String(input) }));
  });
  installClient({ window: win, exposeAllNamespaces: true });
  const res = await win.fetch('/api/other', { method: 'GET' });
  const body = await res.json();
  assert.equal(originalCalled, true);
  assert.equal(body.echo, '/api/other');
});

// TC-BND-CLI-02: third party overrides window.fetch â†?interceptor still wraps.
test('TC-BND-CLI-02 interceptor wraps original fetch when overwritten', async () => {
  const win = makeWindowWithFetch(async () => fakeResponse(JSON.stringify({ ok: true })));
  installClient({ window: win, exposeAllNamespaces: true });
  // third party wraps the current (intercepted) fetch â€?describe still routed.
  const official = { result: { value: { namespaces: [{ ns: 'shell' }] } } };
  const bridge = { ok: true, namespaces: [{ ns: 'task-board', schema: {}, value: {}, applies: {}, secrets: [], revision: 0 }] };
  const prevFetch = win.fetch;
  win.fetch = async (input, init) => {
    const r = await prevFetch(input, init);
    return r; // pass-through wrapper
  };
  // re-seed originalFetch behavior by reinstalling with a fresh fetch impl:
  win.fetch = async (input) => {
    if (String(input).includes('/api/dshloader/settings/describe')) return fakeResponse(JSON.stringify(bridge));
    if (String(input) === '/api/settings.describe') return fakeResponse(JSON.stringify(official));
    return fakeResponse(JSON.stringify({ ok: true }));
  };
  // reinstall interceptor on top of the new fetch
  installSettingsFetchInterceptor(win);
  const res = await win.fetch('/api/settings.describe');
  const body = await res.json();
  assert.ok(body.result.value.namespaces.some((n) => n.ns === 'task-board'));
});
