// L1 unit tests �?Settings stable API (test-plan.md §4.2, §4.2b, §5.2, §6.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsAPI, DEFAULT_WEB_SETTINGS_NAMESPACES, toNamespaceView, settingsErrorToResult } from '../dist/services/settings.js';
import { makeMockCtx, makeMockSettings } from './helpers/mock.mjs';

function ns(name, extra = {}) {
  return {
    ns: name,
    schema: { type: 'object' },
    value: { enabled: true },
    applies: {},
    secrets: [{ path: ['token'], set: true }],
    revision: 1,
    ...extra,
  };
}

// TC-SET-01: describe returns stable NamespaceView structure.
test('TC-SET-01 describe returns stable NamespaceView[]', () => {
  const settings = makeMockSettings({ namespaces: [ns('shell')] });
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  const views = api.describe();
  assert.ok(Array.isArray(views));
  assert.equal(views.length, 1);
  const v = views[0];
  for (const key of ['ns', 'schema', 'value', 'applies', 'secrets', 'revision']) {
    assert.ok(key in v, `missing ${key}`);
  }
  assert.equal(v.ns, 'shell');
  assert.deepEqual(v.secrets, [{ path: ['token'], set: true }]);
});

// TC-SET-02: update writes and returns ok result with bumped revision.
test('TC-SET-02 update writes and returns SettingsResult ok', async () => {
  const settings = makeMockSettings({ namespaces: [ns('my-plugin', { revision: 0 })] });
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  const result = await api.update('my-plugin', { enabled: true }, 0);
  assert.equal(result.ok, true);
  assert.ok(result.value);
  assert.ok(result.value.revision > 0);
});

// TC-SET-03: settings service unavailable �?internal error with dshloader prefix.
test('TC-SET-03 settings unavailable returns internal error', async () => {
  const { ctx } = makeMockCtx();
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  const result = await api.update('my-plugin', {}, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'internal');
  assert.match(result.message, /settings service unavailable/);
  assert.match(result.message, /dshloader/);
});

// TC-SEC-01: default (exposeAllNamespaces=false) filters to whitelist only.
test('TC-SEC-01 default describe filters to whitelist namespaces', () => {
  const settings = makeMockSettings({ namespaces: [ns('shell'), ns('task-board')] });
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  assert.equal(api.exposeAllNamespaces, false);
  const views = api.describe();
  assert.ok(views.some((v) => v.ns === 'shell'));
  assert.ok(!views.some((v) => v.ns === 'task-board'));
});

// TC-SEC-02: exposeAllNamespaces=true returns all, keeps redactSecrets shape.
test('TC-SEC-02 exposeAllNamespaces returns all namespaces with secrets shape', () => {
  const settings = makeMockSettings({
    namespaces: [ns('shell'), ns('task-board', { secrets: [{ path: ['apiKey'], set: true }] })],
  });
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  const views = api.describe({ redactSecrets: true });
  assert.ok(views.some((v) => v.ns === 'task-board'));
  const tb = views.find((v) => v.ns === 'task-board');
  assert.deepEqual(tb.secrets, [{ path: ['apiKey'], set: true }]); // set:true, no plaintext
});

// TC-BND-SVC-02: settings update conflict mapped to settings-conflict result.
test('TC-BND-SVC-02 conflict exception maps to settings-conflict result', async () => {
  const conflictErr = Object.assign(new Error('rev mismatch'), { expected: 1, actual: 2 });
  const settings = makeMockSettings({ namespaces: [ns('my-plugin')], writesThrow: conflictErr });
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  const result = await api.update('my-plugin', { enabled: true }, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'settings-conflict');
  assert.deepEqual(result.details, { ns: 'my-plugin', expected: 1, actual: 2 });
});

// TC-BND-CON-01: concurrent updates do not cross-pollute parameters.
test('TC-BND-CON-01 concurrent updates keep parameters isolated', async () => {
  const calls = [];
  const settings = {
    describe: () => [ns('a'), ns('b')],
    async update(ns, section, rev) {
      calls.push({ ns, section, rev });
      await Promise.resolve();
      return { ok: true };
    },
    async replace(ns, section, rev) {
      calls.push({ ns, section, rev });
      return { ok: true };
    },
    async mutate(ns, ops, rev) {
      calls.push({ ns, ops, rev });
      return { ok: true };
    },
  };
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  await Promise.all([
    api.update('a', { x: 1 }, 0),
    api.update('b', { y: 2 }, 0),
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { ns: 'a', section: { x: 1 }, rev: 0 });
  assert.deepEqual(calls[1], { ns: 'b', section: { y: 2 }, rev: 0 });
});

// TC-OBS-02: error message includes dshloader prefix.
test('TC-OBS-02 error message includes dshloader prefix', async () => {
  const { ctx } = makeMockCtx();
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: true });
  const result = await api.update('x', {}, 0);
  assert.match(result.message, /\[dshloader/);
});

// toNamespaceView / settingsErrorToResult unit coverage.
test('toNamespaceView omits undefined base/user', () => {
  const v = toNamespaceView(ns('x'));
  assert.ok(!('base' in v));
  assert.ok(!('user' in v));
});

test('settingsErrorToResult maps non-conflict to settings-rejected', () => {
  const r = settingsErrorToResult(new Error('nope'), 'ns', 'update');
  assert.equal(r.code, 'settings-rejected');
  assert.equal(r.details.ns, 'ns');
});

// TC-SET-04: register proxies to settings.register and returns scope.
test('TC-SET-04 settings.register proxies to real settings service', () => {
  let registeredArgs = null;
  const mockSettings = {
    describe: () => [],
    register(ns, schema, options) {
      registeredArgs = { ns, schema, options };
      return {
        get: () => ({ enabled: true }),
        watch: (cb) => () => {},
      };
    },
  };
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', mockSettings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });

  const schema = { type: 'object' };
  const scope = api.register('my-plugin', schema, { base: { enabled: false } });

  assert.equal(registeredArgs.ns, 'my-plugin');
  assert.equal(registeredArgs.schema, schema);
  assert.deepEqual(registeredArgs.options.base, { enabled: false });
  assert.ok(typeof scope.get === 'function');
  assert.ok(typeof scope.watch === 'function');
  assert.deepEqual(scope.get(), { enabled: true });
});

// TC-SET-05: register defers with a stand-in scope when the service is missing,
// then flushes into a real registration once the service mounts (the flush is
// opportunistic here because the mock ctx has no inject fiber).
test('TC-SET-05 settings.register defers and flushes when the service mounts', () => {
  const { ctx, registerService } = makeMockCtx();
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const schema = (value) => value ?? { enabled: false };
  const scope = api.register('my-plugin', schema);
  assert.ok(scope, 'a stand-in scope is returned instead of undefined');
  assert.deepEqual(scope.get(), { enabled: false }, 'reads yield the schema default before flush');
  const seen = [];
  scope.watch((value) => seen.push(value));

  let registeredNs = null;
  const watchers = new Set();
  registerService('settings', {
    describe: () => [],
    register(ns) {
      registeredNs = ns;
      return {
        get: () => ({ enabled: true }),
        watch: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
      };
    },
  });
  api.describe(); // opportunistic flush trigger
  assert.equal(registeredNs, 'my-plugin', 'the deferred registration flushes to the real service');
  assert.equal(watchers.size, 1, 'queued watchers replay onto the real scope');
  assert.deepEqual(scope.get(), { enabled: true }, 'reads proxy to the real scope after flush');
});
