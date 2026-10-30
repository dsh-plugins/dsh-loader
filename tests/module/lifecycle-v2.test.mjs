import { test } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import vm from 'node:vm';
import { installHostPackageAliases } from '../../dist/host-aliases.js';
import { createPatchAPI } from '../../dist/patch.js';
import { createBootDescriptor } from '../../dist/bootstrap.js';
import { installClient, installSettingsFetchInterceptor } from '../../dist/client.js';
import { installBootAliasInjection, buildBootAliasScript } from '../../dist/boot-injection.js';
import { createSettingsAPI } from '../../dist/services/settings.js';
import { makeMockCtx, makeMockWindow, makeMockWebServer } from '../helpers/mock.mjs';
import { applyAdapter } from '../../dist/index.js';

test('host aliases preserve an outer wrapper and remove registrations in either order', async () => {
  const original = Module._resolveFilename; Module._resolveFilename = value => value;
  let a,b; try {
    a = await installHostPackageAliases({ foo: 'first' }); const inner = Module._resolveFilename;
    const outer = function(...args) { return inner.apply(this, args); }; Module._resolveFilename = outer;
    b = await installHostPackageAliases({ foo: 'second' });
    assert.equal(Module._resolveFilename, outer); assert.equal(Module._resolveFilename('foo'), 'second');
    a(); assert.equal(Module._resolveFilename('foo'), 'second'); b(); assert.equal(Module._resolveFilename('foo'), 'foo');
  } finally { a?.(); b?.(); Module._resolveFilename = original; delete globalThis[Symbol.for('dshloader.host-aliases.v2')]; }
});
test('same patch ID under foreign wrapper does not resurrect or recurse', () => {
  const target = { run() { return 'base'; } }, patch = createPatchAPI();
  const first = patch.method(target, 'run', old => () => 'old:' + old(), { id: 'plugin' });
  const previous = target.run; target.run = () => 'foreign:' + previous();
  const second = patch.method(target, 'run', old => () => 'new:' + old(), { id: 'plugin' });
  first.dispose(); assert.equal(target.run(), 'new:foreign:base'); second.dispose(); assert.equal(target.run(), 'foreign:base');
});
test('repeat client installs share aliases, with independently owned cleanup', () => {
  const { window } = makeMockWindow(); const a = installClient({ window }); const b = installClient({ window });
  const off = b.registerPackageAlias('foo', 'bar');
  window.__ModuleLoader__.load({ id: 'probe', factory: require => require('foo') });
  const read = () => window.__ModuleLoader__.registry.get('probe')(name => name);
  assert.equal(read(), 'bar'); a.dispose(); assert.equal(read(), 'bar'); off(); assert.equal(read(), 'foo'); b.dispose();
});
test('disposing fetch interception preserves and bypasses through a later wrapper', async () => {
  let requests = 0; const { window } = makeMockWindow({ fetchImpl: async () => { requests++; return new Response('{}'); } });
  const dispose = installSettingsFetchInterceptor(window); const previous = window.fetch;
  const foreign = (...args) => previous(...args); window.fetch = foreign;
  dispose(); assert.equal(window.fetch, foreign); await window.fetch('/api/settings.describe'); assert.equal(requests, 1);
});
test('deferred watcher cancellation works both before and after service registration', () => {
  const { ctx, registerService } = makeMockCtx(); const callbacks = new Set();
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const scope = api.register('example', () => ({})); let called = 0;
  const offEarly = scope.watch(() => called++); offEarly(); const offLate = scope.watch(() => called++);
  registerService('settings', { register: () => ({ get: () => ({}), watch(callback) { callbacks.add(callback); return () => callbacks.delete(callback); } }), describe: () => [] });
  api.describe(); assert.equal(callbacks.size, 1); offLate(); assert.equal(callbacks.size, 0); assert.equal(called, 0);
});
for (const enabled of [false, true]) test(`host injection reaches client without an option override: ${enabled}`, async () => {
  const { ctx, listeners, registerService } = makeMockCtx(); const { webServer, registrations } = makeMockWebServer(); registerService('webServer', webServer);
  await applyAdapter(ctx, { dshVersion: '0.1.6-alpha.2', config: { exposeAllNamespaces: enabled } });
  const rows = []; for (const listener of listeners.filter(row => row.name === 'webserver/index-inject')) listener.listener(rows);
  const { window } = makeMockWindow(); delete window.__DSHLOADER_BOOT__;
  for (const row of rows) vm.runInNewContext(row.text, { window });
  const original = window.fetch; const api = installClient({ window });
  assert.equal(Boolean(api.rpc), enabled); assert.equal(window.fetch !== original, enabled);
  assert.equal(registrations.some(route => route.path === '/api/dshloader'), enabled);
  assert.equal(api.boot.adapterId, 'dsh-0.1.6'); api.dispose();
});
test('empty aliases still carry boot configuration before the module loader exists', () => {
  const { ctx, listeners } = makeMockCtx(); const boot = createBootDescriptor('0.1.5-alpha.1', 'dsh-0.1.5', true);
  installBootAliasInjection(ctx, {}, boot); const rows = []; listeners[0].listener(rows);
  const window = {}; vm.runInNewContext(rows[0].text, { window }); assert.equal(window.__DSHLOADER_BOOT__.exposeAllNamespaces, true);
  window.__ModuleLoader__ = { load() {} }; assert.deepEqual([...window.__dshLoaderBootAliases__], []);
});
test('boot script safely serializes closing script tags', () => {
  const script = buildBootAliasScript({ '</script>': 'x' }); assert.ok(!script.includes('</script>'));
});
test('client rejects missing and incompatible boot metadata', () => {
  const { window } = makeMockWindow(); delete window.__DSHLOADER_BOOT__;
  assert.throws(() => installClient({ window }), /boot descriptor/);
});

test('a patch owner releases only its own layer after a later registration', () => {
  const target = { run() { return 'base'; } }; const releases = [];
  const owner = { effect(fn) { releases.push(fn()); } };
  const a = patchSlot(target, 'run', original => () => original() + ':a', { owner });
  const b = patchSlot(target, 'run', original => () => original() + ':b');
  releases[0](); assert.equal(a.active, false); assert.equal(target.run(), 'base:b');
  b.dispose(); assert.equal(target.run(), 'base');
});
import { patchSlot } from '../../dist/patch.js';

test('deferred settings scope cannot register or retain listeners after owner unload', () => {
  const { ctx, registerService } = makeMockCtx();
  const disposers = []; ctx.effect = fn => { disposers.push(fn()); };
  const api = createSettingsAPI({ ctx, exposeAllNamespaces: false });
  const pending = api.register('late', () => ({})); pending.watch(() => {});
  for (const off of disposers) off?.();
  let registered = 0; registerService('settings', { register() { registered++; }, describe: () => [] });
  api.describe(); assert.equal(registered, 0);
  assert.throws(() => api.register('again', {}), /disposed/);
});
