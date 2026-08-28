// L2 module tests — connection.api compatibility bridge (dsh 0.1.2 moved the
// browser RPC face from connection.api to the ctx.remote Typert proxy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  installConnectionApiCompat,
  buildLegacyApiProxy,
} from '../../dist/client-connection-api-compat.js';

function makeCtx({ services = new Map() } = {}) {
  const injectFibers = [];
  const ctx = {
    get: (name) => services.get(name),
    inject: (inject, callback) => {
      injectFibers.push({ inject, callback });
      if (inject.every((name) => services.get(name) !== undefined)) callback(ctx);
    },
  };
  return { ctx, services, injectFibers };
}

function makeRemote() {
  const calls = { update: [], replace: [] };
  const remote = {
    llm: {
      listProviders: async () => ({ ok: true, value: [{ id: 'p1' }, { id: 'p2', label: 'P Two' }] }),
      listConfigurableProviders: async () => ({
        ok: true,
        value: [
          { provider: 'p1', displayName: 'P One', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'] },
          { provider: 'p3', displayName: 'P Three', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p3'] },
        ],
      }),
    },
    session: {
      modelCatalog: async () => ({ ok: true, value: { groups: [{ id: 'p1', models: [] }], failures: [] } }),
    },
    settings: {
      describe: async () => ({
        ok: true,
        value: {
          namespaces: [
            { ns: 'dsh-auxiliary', user: { keep: 1, nested: { x: 1, y: 2 } }, revision: 3 },
          ],
          writable: true,
        },
      }),
      update: async (ns, patch, expectedRevision) => {
        calls.update.push({ ns, section: patch, expectedRevision });
        return { ok: true, value: { ns, value: patch, revision: (expectedRevision ?? 0) + 1 } };
      },
      replace: async (ns, section, expectedRevision) => {
        calls.replace.push({ ns, section, expectedRevision });
        return { ok: true, value: { ns, value: section, revision: (expectedRevision ?? 0) + 1 } };
      },
      mutate: async (ns, ops, expectedRevision) => ({ ok: true, value: { ns, revision: (expectedRevision ?? 0) + 1 } }),
    },
  };
  return { remote, calls };
}

const NESTED_INJECT = ['connection', 'remote.llm', 'remote.session', 'remote.settings'];

/** Register the 0.1.2 nested remote namespace services. */
function registerRemoteFaces(services, remote) {
  services.set('remote.llm', remote.llm);
  services.set('remote.session', remote.session);
  services.set('remote.settings', remote.settings);
}

// Host already carries connection.api (dsh ≤ 0.1.1): synchronous no-op.
test('compat is a synchronous no-op when connection.api exists', () => {
  const existing = { llm: {} };
  const { ctx, services, injectFibers } = makeCtx();
  services.set('connection', { api: existing });
  let ready = false;
  assert.equal(installConnectionApiCompat(ctx, () => { ready = true; }), true);
  assert.equal(ready, true);
  assert.equal(injectFibers.length, 0);
  assert.equal(services.get('connection').api, existing);
});

// dsh ≥ 0.1.2: stage A waits for the connection handle alone (it exists on
// every host version); the proxy is then attached from the stage-B fiber that
// names the 0.1.2-only nested remote namespaces.
test('compat attaches the proxy once connection and remote namespaces exist', () => {
  const { remote } = makeRemote();
  const { ctx, services, injectFibers } = makeCtx();
  const connection = {};
  services.set('connection', connection);
  registerRemoteFaces(services, remote);
  let ready = false;
  assert.equal(installConnectionApiCompat(ctx, () => { ready = true; }), false);
  assert.deepEqual(injectFibers[0].inject, ['connection'], 'stage A waits only for connection');
  assert.deepEqual(injectFibers[1].inject, NESTED_INJECT, 'stage B names the nested remote faces');
  assert.ok(connection.api, 'legacy proxy attached');
  assert.equal(ready, true);
});

// dsh ≤ 0.1.1 with a late-provided connection handle: stage A finds the
// native api and reports ready without arming the 0.1.2-only stage B fiber
// (whose remote.* dependencies would never materialize on a legacy host).
test('compat reports ready from stage A when the late connection already has api', () => {
  const { ctx, services, injectFibers } = makeCtx();
  let ready = false;
  assert.equal(installConnectionApiCompat(ctx, () => { ready = true; }), false);
  assert.equal(ready, false);
  services.set('connection', { api: { llm: {} } });
  injectFibers[0].callback(ctx);
  assert.equal(ready, true);
  assert.equal(injectFibers.length, 1, 'no stage-B fiber when api already exists');
});

// Late-arriving services: ready only fires from the stage-B fiber.
test('compat defers readiness until the inject fiber fires', () => {
  const { remote } = makeRemote();
  const { ctx, services, injectFibers } = makeCtx();
  services.set('connection', {});
  let ready = false;
  installConnectionApiCompat(ctx, () => { ready = true; });
  assert.equal(ready, false);
  assert.equal(injectFibers.length, 2, 'stage B armed but pending on the remote faces');
  registerRemoteFaces(services, remote);
  injectFibers[1].callback(ctx);
  assert.equal(ready, true);
  assert.ok(services.get('connection').api);
});

// A context without inject keeps legacy degraded behaviour (no hang).
test('compat without inject reports ready synchronously and attaches nothing', () => {
  const connection = {};
  let ready = false;
  assert.equal(
    installConnectionApiCompat({ get: () => connection }, () => { ready = true; }),
    true,
  );
  assert.equal(ready, true);
  assert.equal(connection.api, undefined);
});

// llm.providers joins declared rows with live routes, 0.1.2 style.
test('proxy llm.providers joins the directory and wraps in RpcResponse', async () => {
  const { remote } = makeRemote();
  const api = buildLegacyApiProxy(remote);
  const response = await api.llm.providers({});
  assert.equal(response.result.ok, true);
  const providers = response.result.value.providers;
  assert.deepEqual(providers.map((p) => [p.provider, p.active]), [
    ['p1', true],
    ['p3', false],
    ['p2', true],
  ]);
  assert.equal(providers[0].settingsNs, 'llm-pi-ai');
  assert.equal(providers[2].displayName, 'P Two');
});

// llm.models delegates to the session-scoped catalog.
test('proxy llm.models reads remote.session.modelCatalog', async () => {
  const { remote } = makeRemote();
  const api = buildLegacyApiProxy(remote);
  const response = await api.llm.models({});
  assert.equal(response.result.ok, true);
  assert.deepEqual(response.result.value.groups, [{ id: 'p1', models: [] }]);
});

// settings.update({ns, patch}) passes the patch straight through to the
// host-side merge (0.1.2's update IS a deep merge into the user section).
test('proxy settings.update passes the patch through positionally', async () => {
  const { remote, calls } = makeRemote();
  const api = buildLegacyApiProxy(remote);
  const patch = { nested: { y: 9, z: 3 }, added: true };
  const response = await api.settings.update({ ns: 'dsh-auxiliary', patch, expectedRevision: 3 });
  assert.equal(response.result.ok, true);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].ns, 'dsh-auxiliary');
  assert.equal(calls.update[0].expectedRevision, 3);
  // The exact patch object rides through — no client-side merge copy.
  assert.equal(calls.update[0].section, patch);
  assert.equal(response.result.value.revision, 4);
});

// A {ns, section} caller (full replacement intent) routes to replace().
test('proxy settings.update with section routes to replace', async () => {
  const { remote, calls } = makeRemote();
  const api = buildLegacyApiProxy(remote);
  const section = { whole: true };
  const response = await api.settings.update({ ns: 'dsh-auxiliary', section, expectedRevision: 1 });
  assert.equal(response.result.ok, true);
  assert.equal(calls.update.length, 0);
  assert.deepEqual(calls.replace, [{ ns: 'dsh-auxiliary', section, expectedRevision: 1 }]);
});

// Remote failure results pass through the envelope untouched.
test('proxy surfaces remote failures as ok:false responses', async () => {
  const { remote } = makeRemote();
  remote.llm.listProviders = async () => ({
    ok: false,
    error: { code: 'settings-conflict', message: 'revision mismatch', details: { revision: 7 } },
  });
  const api = buildLegacyApiProxy(remote);
  const response = await api.llm.providers({});
  assert.equal(response.result.ok, false);
  assert.equal(response.result.error.code, 'settings-conflict');
  assert.equal(response.result.error.details.revision, 7);
});

// A rejecting remote method becomes a transport failure, never a throw.
test('proxy converts transport rejections into failure responses', async () => {
  const { remote } = makeRemote();
  remote.session.modelCatalog = async () => { throw new Error('socket gone'); };
  const api = buildLegacyApiProxy(remote);
  const response = await api.llm.models({});
  assert.equal(response.result.ok, false);
  assert.equal(response.result.error.code, 'transport');
  assert.match(response.result.error.message, /socket gone/);
});

// Missing remote namespaces degrade to a failure response per method.
test('proxy degrades missing namespaces per method', async () => {
  const api = buildLegacyApiProxy({});
  const response = await api.settings.describe({});
  assert.equal(response.result.ok, false);
  assert.match(response.result.error.message, /settings\.describe/);
});

// A non-object patch collapses to an empty merge rather than a throw.
test('proxy settings.update tolerates a missing patch', async () => {
  const { remote, calls } = makeRemote();
  const api = buildLegacyApiProxy(remote);
  const response = await api.settings.update({ ns: 'dsh-auxiliary' });
  assert.equal(response.result.ok, true);
  assert.deepEqual(calls.update[0].section, {});
});
