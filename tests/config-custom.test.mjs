import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../dist/services/config.js';
import { defineConfig } from '../dist/config.js';

test('隐藏字段仍参与持久化与脱敏，自定义面板操作可复用当前配置的密钥引用', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'dshl-panel-'));
  const store = new ConfigStore(profile);
  t.after(async () => { store.dispose(); await rm(profile, { recursive: true, force: true }); });
  const template = defineConfig({ id: 'sample', packageName: '@example/sample', title: '管理', fields: [
    { type: 'group', label: '功能', panel: 'manager', fields: [{ type: 'password', key: 'token', label: '凭据', hidden: true }] },
  ], panels: [{ id: 'manager', title: '管理', custom: true, fields: [{ type: 'password', key: 'token', label: '测试凭据' }], operations: [{ id: 'test', readOnly: true }] }] });
  const handle = await store.register(null, template);
  await handle.update({ token: 'example-secret' });
  handle.registerOperation('test', ({ input }) => ({ value: { accepted: input.token === handle.get().value.token } }));
  const view = store.read('sample');
  assert.equal(typeof view.value.token, 'object');
  const result = await store.invoke('sample', 'test', { input: { token: view.value.token } });
  assert.deepEqual(result.value, { accepted: true });
  assert(!JSON.stringify(result).includes('example-secret'));
  assert.equal(handle.get().value.token, 'example-secret');
  await assert.rejects(store.invoke('sample', 'test', { input: { token: { $secret: 'unknown' } } }), /Invalid secret reference/);
  let previous = view.value.token;
  for (const token of ['changed-secret', '']) {
    await handle.update({ token });
    await assert.rejects(store.invoke('sample', 'test', { input: { token: previous } }), /Invalid secret reference/);
    previous = store.read('sample').value.token;
    assert.deepEqual((await store.invoke('sample', 'test', { input: { token: previous } })).value, { accepted: true });
  }
  assert.throws(() => defineConfig({ ...template, panels: [] }), /Embedded panel/);
});
