import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installConnectionApiCompat, buildLegacyApiProxy } from '../../dist/client-connection-api-compat.js';

function makeScope(services = new Map()) {
  const cleanups = [], children = [];
  const scope = {
    get: name => services.get(name),
    effect: fn => cleanups.push(fn()),
    inject: (names, callback) => {
      const child = makeScope(services);
      child.activate = () => callback(child.scope);
      children.push(child);
      if (names.every(name => services.has(name))) { child.activate(); }
    },
  };
  return {
    scope, services, children,
    dispose() {
      for (const child of children.toReversed()) { child.dispose(); }
      for (const off of cleanups.splice(0).reverse()) { off?.(); }
    },
  };
}
function makeRemote() {
  return {
    llm: {
      listProviders: async () => ({ ok: true, value: [{ id: 'p1' }, { id: 'p2', label: 'P Two' }] }),
      listConfigurableProviders: async () => ({ ok: true, value: [
        { provider: 'p1', displayName: 'P One', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'] },
        { provider: 'p3', displayName: 'P Three', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p3'] },
      ] }),
    },
    session: { modelCatalog: async () => ({ ok: true, value: { groups: [], failures: [] } }) },
    settings: { describe: async () => ({ ok: true, value: { namespaces: [], writable: true } }) },
  };
}
function provideRemote(owner, remote = makeRemote()) {
  for (const [name, value] of Object.entries(remote)) { owner.services.set(`remote.${name}`, value); }
  owner.children[0].activate();
}

// 请求等待与 API 发布分离，锁定冷启动、超时和卸载三个状态转换。
test('API 同步发布，早期请求在远程服务到达后完成且对象身份保持稳定', async t => {
  const owner = makeScope(new Map([['connection', {}]]));
  t.after(() => owner.dispose());
  const conn = owner.services.get('connection');
  let published;
  assert.equal(installConnectionApiCompat(owner.scope, () => { published = conn.api; }), true);
  const api = conn.api;
  assert.equal(published, api);
  let completed = false;
  const pending = api.settings.describe({}).then(response => { completed = true; return response; });
  await Promise.resolve();
  assert.equal(completed, false);
  provideRemote(owner);
  assert.equal((await pending).result.ok, true);
  assert.equal(conn.api, api);
});

test('连接句柄迟到时仍先发布 API，再等待远程服务', async t => {
  const owner = makeScope();
  t.after(() => owner.dispose());
  let notified = 0;
  assert.equal(installConnectionApiCompat(owner.scope, () => { notified++; }), false);
  const connection = {};
  owner.services.set('connection', connection);
  owner.children[0].activate();
  const pending = connection.api.settings.describe({});
  provideRemote(owner.children[0]);
  assert.equal((await pending).result.ok, true);
  assert.equal(notified, 1);
});

test('连接出现前卸载后，迟到的连接回调不会安装 API', () => {
  const owner = makeScope();
  let notified = false;
  installConnectionApiCompat(owner.scope, () => { notified = true; });
  owner.dispose();
  const conn = {};
  owner.services.set('connection', conn);
  owner.children[0].activate();
  assert.equal(conn.api, undefined);
  assert.equal(notified, false);
});

test('等待超时返回 transport 错误，迟到服务可供后续请求使用', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owner = makeScope(new Map([['connection', {}]]));
  t.after(() => owner.dispose());
  installConnectionApiCompat(owner.scope, () => {});
  const api = owner.services.get('connection').api;
  const pending = api.settings.describe({});
  t.mock.timers.tick(15000);
  assert.equal((await pending).result.error.code, 'transport');
  provideRemote(owner);
  assert.equal((await api.settings.describe({})).result.ok, true);
});

test('等待中卸载结束请求，迟到回调不恢复代理且保留其他插件的替换值', async () => {
  const owner = makeScope(new Map([['connection', {}]]));
  const conn = owner.services.get('connection');
  installConnectionApiCompat(owner.scope, () => {});
  const api = conn.api;
  const pending = api.settings.describe({});
  const replacement = { example: true };
  conn.api = replacement;
  owner.dispose();
  assert.equal((await pending).result.error.code, 'transport');
  provideRemote(owner);
  assert.equal((await api.settings.describe({})).result.error.code, 'transport');
  assert.equal(conn.api, replacement);
});

test('远程服务失效后不再调用旧服务，恢复时继续使用原 API', async t => {
  const owner = makeScope(new Map([['connection', {}]]));
  t.after(() => owner.dispose());
  installConnectionApiCompat(owner.scope, () => {});
  const api = owner.services.get('connection').api;
  provideRemote(owner);
  assert.equal((await api.settings.describe({})).result.ok, true);
  owner.children[0].dispose();
  assert.equal((await api.settings.describe({})).result.error.code, 'transport');
  provideRemote(owner);
  assert.equal((await api.settings.describe({})).result.ok, true);
  owner.dispose();
  assert.equal(owner.services.get('connection').api, undefined);
});

test('已就绪服务不会遗留等待计时器，无 inject 时请求立即返回明确错误', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const owner = makeScope(new Map([['connection', {}]]));
  t.after(() => owner.dispose());
  const remote = makeRemote();
  for (const [name, value] of Object.entries(remote)) { owner.services.set(`remote.${name}`, value); }
  installConnectionApiCompat(owner.scope, () => {});
  assert.equal((await owner.services.get('connection').api.settings.describe({})).result.ok, true);
  t.mock.timers.runAll();
  const conn = {};
  installConnectionApiCompat({ get: () => conn }, () => {});
  assert.equal((await conn.api.settings.describe({})).result.error.code, 'transport');
});

test('提供商目录按声明顺序合并，并追加未声明的活动路由', async () => {
  const api = buildLegacyApiProxy(makeRemote());
  const response = await api.llm.providers({});
  assert.deepEqual(response.result.value.providers, [
    { provider: 'p1', displayName: 'P One', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p1'], active: true },
    { provider: 'p3', displayName: 'P Three', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'p3'], active: false },
    { provider: 'p2', displayName: 'P Two', settingsNs: '', settingsPath: [], active: true },
  ]);
});

test('远程失败保留错误码与详情，传输异常转换为响应信封', async () => {
  const remote = makeRemote();
  const error = { code: 'settings-conflict', message: 'revision mismatch', details: { revision: 7 } };
  remote.llm.listProviders = async () => ({ ok: false, error });
  remote.session.modelCatalog = async () => { throw new Error('socket gone'); };
  const api = buildLegacyApiProxy(remote);
  assert.deepEqual(await api.llm.providers({}), { result: { ok: false, error } });
  assert.deepEqual(await api.llm.models({}), { result: { ok: false, error: { code: 'transport', message: 'socket gone' } } });
});
