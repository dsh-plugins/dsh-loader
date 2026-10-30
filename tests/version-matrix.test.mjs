import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { registerHostAdapters, hostAdapters } from '../dist/adapters/index.js';
import { clientAdapters } from '../dist/adapters/client.js';
import { AdapterRegistry } from '../dist/registry.js';
import { createBootDescriptor } from '../dist/bootstrap.js';
import { buildBootAliasScript } from '../dist/boot-injection.js';
import { installClient } from '../dist/client.js';
import { createAdaptedWebAPI } from '../dist/adapters/web.js';
import { browserAccess } from '../dist/adapters/http-access.js';
import { makeMockCtx, makeMockWindow } from './helpers/mock.mjs';

const published = JSON.parse(await readFile(new URL('./fixtures/upstream-releases.json', import.meta.url)));
const resolved = JSON.parse(await readFile(new URL('./fixtures/resolved-contracts.json', import.meta.url)));
const lock = JSON.parse(await readFile(new URL('./fixtures/upstream/package-lock.json', import.meta.url)));
const registry = registerHostAdapters(new AdapterRegistry());
test('six independent patch entries exactly cover the frozen release inventory', () => {
  assert.deepEqual(hostAdapters.map(a => a.supports), ['0.1.5','0.1.6','0.1.7','0.2.0','0.2.1','0.2.2']);
  assert.deepEqual(Object.keys(published.versions).sort(), Object.keys(resolved.releases).sort());
  assert.equal(Object.keys(lock.packages[''].dependencies).length, 24);
  for (const value of ['0.1.4','0.1.4-rc.99','0.1.8','0.2.3-alpha.1','1.0.0','2.0.0']) assert.throws(() => registry.select(value), /no adapter|too old/);
});
for (const version of Object.keys(published.versions)) test(`published dsh ${version}: selection, resolved capabilities, boot and client agree`, () => {
  const { factory } = registry.select(version);
  const metadata = clientAdapters.find(a => a.id === factory.name);
  assert.equal(factory.supports, version.split('-')[0]);
  const packages = resolved.releases[version];
  const contracts = name => (packages['@deepseek-ai/dsh-' + name] ?? []).map(key => resolved.contracts[key]);
  for (const [name, symbol] of Object.entries({ tools: 'defineTool', llm: 'createUserMessage', timeout: 'deadline', credentials: 'credentialRef', subagent: 'delegationDepthOf', 'compaction-basic': 'BasicCompactionEngine' })) {
    assert.ok(contracts(name).length, name);
    for (const contract of contracts(name)) { assert.ok(contract.integrity); assert.ok(contract.exports.includes(symbol), `${name}.${symbol}`); }
  }
  for (const contract of contracts('client-connection')) assert.equal(contract.authorizeIndex, true);
  for (const contract of contracts('host-webserver')) assert.deepEqual(contract.webKinds, ['exact', 'prefix']);
  const configUI = metadata.configUI(version);
  const slotOwner = configUI === 'settings' ? 'client-ui-settings' : 'client-ui-plugin-manager';
  const slot = configUI === 'settings' ? 'settings.section' : 'plugins.bundle.config';
  assert.ok(contracts(slotOwner).some(c => c.slots.includes(slot)), slot);
  for (const expose of [false, true]) {
    const boot = createBootDescriptor(version, factory.name, expose);
    const window = makeMockWindow(); delete window.__DSHLOADER_BOOT__;
    const modules = new Map(); window.__ModuleLoader__ = { load(entry) { modules.set(entry.id, entry.factory); } };
    vm.runInNewContext(buildBootAliasScript(boot.aliases, boot), { window });
    const api = installClient({ window });
    assert.equal(api.boot.adapterId, factory.name); assert.equal(Boolean(api.rpc), expose);
    assert.equal(api.boot.capabilities.configUI, configUI); api.dispose();
  }
});
test('native exact routes normalize multiple methods and retain registration ownership', async () => {
  const routes = new Map(); const { ctx, services } = makeMockCtx();
  services.set('webServer', { register(row) { assert.ok(['exact','prefix'].includes(row.kind)); routes.set(row.path, row.handler); return () => routes.delete(row.path); } });
  const web = createAdaptedWebAPI(ctx); const calls = [];
  const a = web.get('/sample', () => calls.push('a')), b = web.get('/sample', () => calls.push('b'));
  const post = web.post('/sample', () => calls.push('post'));
  a(); await routes.get('/sample')({ method: 'GET' }, {}); b();
  await routes.get('/sample')({ method: 'POST' }, {}); assert.deepEqual(calls, ['b','post']);
  post(); assert.equal(routes.size, 0);
});
test('browser configuration access uses host authentication and fails closed while unavailable', () => {
  const { ctx, services } = makeMockCtx(); const access = browserAccess(ctx);
  let status, ended; const response = { writeHead(code) { status = code; }, end(body) { ended = body; } };
  assert.equal(access({}, response), false); assert.equal(status, 503); assert.match(ended, /auth-unavailable/);
  const request = { headers: { cookie: 'test-session' } };
  services.set('connection', { authorizeIndex(req, res) { assert.equal(req, request); assert.equal(res, response); return false; } });
  assert.equal(access(request, response), false);
});

test('HTTP middleware uses a disposable request-only wrapper on supported native servers', async () => {
  const calls = []; const server = { emit(event) { calls.push(event); return true; } };
  const { ctx, services } = makeMockCtx(); services.set('webServer', { server, register() {} });
  const web = createAdaptedWebAPI(ctx);
  const off = web.use((_req, _res, next) => { calls.push('middleware'); next(); next(); });
  server.emit('request', {}, {}); server.emit('upgrade'); off(); server.emit('request', {}, {});
  assert.deepEqual(calls, ['middleware','request','upgrade','request']);
});
