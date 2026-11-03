import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, defaultsFor, validateValues } from '../dist/config.js';
import { ConfigStore } from '../dist/services/config.js';

const field = { type: 'model', key: 'route', label: '辅助模型' };
const route = { provider: 'example', model: 'example-model', reasoningEffort: 'custom-effort' };
const template = fields => defineConfig({ id: 'model-example', packageName: '@example/models', title: '模型', fields });

test('model fields default to null and accept opaque provider, model and effort IDs', () => {
  assert.deepEqual(defaultsFor(template([field]).fields), { route: null });
  assert.deepEqual(validateValues([field], { route }), { route });
  assert.deepEqual(validateValues([field], { route: { provider: 'example', model: 'unlisted-model' } }).route, { provider: 'example', model: 'unlisted-model' });
  assert.equal(validateValues([field], { route: null }).route, null);
});

test('required and malformed model values fail at the field path', () => {
  const required = { ...field, required: true };
  assert.throws(() => validateValues([required], { route: null }), error => error.code === 'validation' && error.fields.route === '请选择模型');
  for (const value of ['', [], {}, { provider: '', model: 'example' }, { provider: 'example', model: ' ' }, { ...route, reasoningEffort: null }, { ...route, reasoningEffort: '' }, { ...route, extra: true }]) {
    assert.throws(() => validateValues([field], { route: value }), error => error.code === 'validation' && Boolean(error.fields.route));
  }
  assert.throws(() => template([{ ...required, default: null }]), error => error.code === 'invalid-template');
  for (const metadata of [{ options: [{ label: 'example', value: 'example' }] }, { optionsFrom: { config: ['models'] } }, { fields: [] }, { item: field }, { min: 1 }, { pattern: '.*' }]) {
    assert.throws(() => template([{ ...field, ...metadata }]), error => error.code === 'invalid-template');
  }
});

test('model values persist atomically inside groups, objects and arrays and survive reload', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-config-'));
  const releases = [];
  const owner = { effect(fn) { releases.push(fn()); } };
  const store = new ConfigStore(root);
  t.after(async () => { for (const off of releases) { off?.(); } store.dispose(); await rm(root, { recursive: true, force: true }); });
  const declaration = template([{ type: 'group', label: '路由', fields: [
    field,
    { type: 'object', key: 'nested', label: '嵌套', fields: [{ ...field, default: route }] },
    { type: 'array', key: 'routes', label: '模型组', item: { ...field, default: route } },
  ] }]);
  const handle = await store.register(owner, declaration);
  await handle.update({ route, routes: [route, null] }, 0);
  const wire = store.read('model-example');
  assert.deepEqual(wire.value, { route, nested: { route }, routes: [route, null] });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'config/model-example/config.json'), 'utf8')).value, wire.value);
  await assert.rejects(handle.update({ routes: [{ provider: 'example' }] }, 1), error => Boolean(error.fields['routes.0']));
  assert.equal(handle.get().revision, 1);
  handle.dispose();
  const again = await store.register(owner, declaration);
  assert.deepEqual(again.get().value, wire.value);
  await again.update({ route: null });
  assert.equal(again.get().value.route, null);
});

test('transient model operations validate input without changing saved configuration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-model-panel-'));
  const store = new ConfigStore(root);
  t.after(async () => { store.dispose(); await rm(root, { recursive: true, force: true }); });
  const handle = await store.register({ effect() {} }, defineConfig({ ...template([field]), panels: [{ id: 'check', title: '检查', fields: [field], operations: [{ id: 'echo', readOnly: true }] }] }));
  handle.registerOperation('echo', ({ input }) => ({ value: input.route }));
  assert.deepEqual((await store.invoke('model-example', 'echo', { input: { route } })).value, route);
  await assert.rejects(store.invoke('model-example', 'echo', { input: { route: { provider: 'example' } } }), error => error.code === 'validation');
  assert.equal(handle.get().value.route, null);
  assert.equal(handle.get().revision, 0);
});
