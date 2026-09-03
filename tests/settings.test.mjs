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

// --- installSection: delegation + alpha.2 fallback (dsh >= 0.1.2-alpha.2 --- //
// dropped the installSettingsSection module export; the loader ports the
// alpha.1 semantics against the unchanged settings service register()).

/** Mock settings service with register() returning a watchable scope. */
function makeRegisterableSettings() {
  const calls = [];
  const scopes = [];
  return {
    calls,
    scopes,
    describe: () => [],
    register(ns, schema, options) {
      calls.push({ ns, schema, options });
      const watchers = new Set();
      const scope = {
        value: options?.base,
        get() { return scope.value; },
        watch(cb) { watchers.add(cb); return () => watchers.delete(cb); },
        fire(value) { scope.value = value; for (const cb of watchers) cb(value); },
      };
      scopes.push(scope);
      return scope;
    },
  };
}

function makeHooks(entry) {
  const changes = [];
  const hooks = {
    source: null,
    changes,
    setSource(current) { hooks.source = current; },
    onChange() { changes.push(hooks.source ? hooks.source() : undefined); },
  };
  return hooks;
}

// TC-SET-06: when the module exports installSettingsSection, delegate verbatim.
test('TC-SET-06 installSection delegates to the dsh-settings module export', () => {
  const delegated = [];
  const module = {
    installSettingsSection(...args) { delegated.push(args); },
  };
  const { ctx } = makeMockCtx();
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false, module });
  const hooks = makeHooks({ enabled: false });
  const ok = api.installSection(ctx, 'my-plugin', { type: 'object' }, { enabled: false }, hooks);
  assert.equal(ok, true);
  assert.equal(delegated.length, 1);
  assert.equal(delegated[0][1], 'my-plugin');
  assert.equal(delegated[0][3].enabled, false);
  assert.equal(delegated[0][4], hooks, 'hooks object passed through untouched');
});

// TC-SET-07: fallback registers with base=entry and wires source/onChange/watch.
test('TC-SET-07 installSection fallback registers base layer and live scope', () => {
  const settings = makeRegisterableSettings();
  const { ctx, registerService } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const entry = { enabled: false, model: 'a' };
  const hooks = makeHooks(entry);
  const validate = (v) => v;
  const ok = api.installSection(ctx, 'my-plugin', { type: 'object' }, entry, { ...hooks, validate });

  assert.equal(ok, true);
  assert.equal(settings.calls.length, 1);
  assert.equal(settings.calls[0].ns, 'my-plugin');
  assert.deepEqual(settings.calls[0].options.base, entry);
  assert.equal(settings.calls[0].options.validate, validate);
  assert.deepEqual(hooks.source(), entry, 'source reads through the registered scope');
  assert.deepEqual(hooks.changes, [entry], 'onChange fired once on install');

  settings.scopes[0].fire({ enabled: true, model: 'b' });
  assert.deepEqual(hooks.changes[1], { enabled: true, model: 'b' }, 'scope watch fires onChange');
  assert.deepEqual(hooks.source(), { enabled: true, model: 'b' });
});

// TC-SET-08: fallback teardown restores the entry source and fires onChange.
test('TC-SET-08 installSection fallback teardown restores entry source', () => {
  const settings = makeRegisterableSettings();
  const { ctx, registerService, effects } = makeMockCtx();
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const entry = { enabled: false };
  const hooks = makeHooks(entry);
  api.installSection(ctx, 'my-plugin', { type: 'object' }, entry, hooks);
  settings.scopes[0].fire({ enabled: true });
  assert.equal(hooks.changes.length, 2);

  const teardown = effects.at(-1);
  assert.ok(teardown?.dispose, 'the fallback registers a fiber teardown effect');
  teardown.dispose();
  assert.deepEqual(hooks.source(), entry, 'source falls back to the composition entry');
  assert.deepEqual(hooks.changes.at(-1), entry, 'onChange fired after restore');
});

// TC-SET-09: teardown is inert while the fiber is unloading (cordis FiberState 4/5).
test('TC-SET-09 installSection fallback teardown skips unloading fiber', () => {
  const settings = makeRegisterableSettings();
  const { ctx, registerService, effects } = makeMockCtx();
  ctx.fiber = { state: 2 };
  registerService('settings', settings);
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const entry = { enabled: false };
  const hooks = makeHooks(entry);
  api.installSection(ctx, 'my-plugin', { type: 'object' }, entry, hooks);
  settings.scopes[0].fire({ enabled: true });

  ctx.fiber.state = 5; // UNLOADING
  effects.at(-1).dispose();
  assert.deepEqual(hooks.source(), { enabled: true }, 'source untouched during unload');
  assert.equal(hooks.changes.length, 2, 'no extra onChange during unload');

  ctx.fiber.state = 4; // DISPOSED
  settings.scopes[0].fire({ enabled: 'x' });
  assert.equal(hooks.changes.length, 2, 'watch inert once disposed');
});

// TC-SET-10: fallback without an injectable context reports not-installed.
test('TC-SET-10 installSection fallback without inject returns false', () => {
  const api = createSettingsAPI({ ctx: {}, exposeAllNamespaces: false });
  const hooks = makeHooks({});
  const ok = api.installSection({}, 'my-plugin', {}, {}, hooks);
  assert.equal(ok, false);
});

// TC-SET-11: fallback defers when the settings service has not mounted yet.
test('TC-SET-11 installSection fallback pends until settings service mounts', () => {
  const { ctx } = makeMockCtx(); // no settings service registered
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const hooks = makeHooks({ enabled: false });
  const ok = api.installSection(ctx, 'my-plugin', {}, { enabled: false }, hooks);
  assert.equal(ok, true, 'wiring installed (pending the service)');
  assert.equal(hooks.changes.length, 0, 'nothing fired before the service mounts');
});
