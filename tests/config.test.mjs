import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../dist/services/config.js';
import { defineConfig } from '../dist/config.js';

const template = defineConfig({ id: 'sample', packageName: '@example/sample', title: 'Sample', fields: [
  { type: 'text', key: 'name', label: 'Name', default: 'first', required: true },
  { type: 'password', key: 'token', label: 'Token', default: 'initial-secret' },
  { type: 'group', label: 'Group', fields: [{ type: 'number', key: 'count', label: 'Count', default: 2, min: 1, max: 5 }] },
  { type: 'array', key: 'servers', label: 'Servers', item: { type: 'object', label: 'Server', fields: [
    { type: 'text', key: 'url', label: 'URL' }, { type: 'password', key: 'password', label: 'Password' },
  ] } },
] });
function owner() { const releases = []; return { effect(fn) { releases.push(fn()); }, dispose() { for (const off of releases) off?.(); } }; }
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-'));
  const store = new ConfigStore(root); const context = owner();
  t.after(async () => { context.dispose(); store.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, store, context, handle: await store.register(context, template) };
}
test('defaults, groups, persistence and reload preserve revisions', async t => {
  const { root, store, context, handle } = await fixture(t);
  assert.equal(handle.get().value.count, 2); assert.equal(handle.get().value.Group, undefined);
  const events = []; handle.watch(snapshot => events.push(snapshot));
  await handle.update({ name: 'changed' }, 0);
  const disk = JSON.parse(await readFile(join(root, 'config/sample/config.json'), 'utf8'));
  assert.equal(disk.revision, 1); assert.equal(disk.value.name, 'changed'); assert.equal(events.length, 1);
  handle.dispose(); assert.deepEqual(store.list(), []);
  const again = await store.register(context, template); assert.equal(again.get().value.name, 'changed'); assert.equal(again.get().revision, 1);
});
test('invalid writes and stale concurrent writes never replace committed state', async t => {
  const { handle } = await fixture(t);
  await assert.rejects(handle.update({ count: 9 }), error => error.code === 'validation');
  const results = await Promise.allSettled([handle.update({ count: 3 }, 0), handle.update({ count: 4 }, 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results[1].reason.code, 'conflict'); assert.equal(handle.get().revision, 1);
});
test('wire secrets stay opaque, survive array removal and can be cleared', async t => {
  const { store, handle } = await fixture(t);
  await handle.update({ servers: [{ url: 'a', password: 'alpha-secret' }, { url: 'b', password: 'beta-secret' }] });
  const view = store.read('sample'); const serialized = JSON.stringify(view);
  for (const secret of ['initial-secret', 'alpha-secret', 'beta-secret']) assert.ok(!serialized.includes(secret));
  view.value.servers.splice(0, 1); await store.write('sample', view.value, view.revision);
  assert.equal(handle.get().value.servers[0].password, 'beta-secret');
  assert.equal(handle.get().value.token, 'initial-secret');
  await store.write('sample', { token: '' }, handle.get().revision);
  assert.equal(handle.get().value.token, '');
});
test('cancelled subscriptions and disposed handles remain inactive', async t => {
  const { context, handle, root } = await fixture(t); let called = 0;
  const off = handle.watch(() => called++); off(); off(); await handle.update({ count: 3 });
  assert.equal(called, 0); context.dispose();
  assert.throws(() => handle.get(), error => error.code === 'disposed');
  await assert.rejects(handle.update({ count: 4 }));
  assert.equal(JSON.parse(await readFile(join(root, 'config/sample/config.json'), 'utf8')).value.count, 3);
});
test('corrupt files are reported and never overwritten', async t => {
  const { root, store, context, handle } = await fixture(t); handle.dispose();
  const file = join(root, 'config/sample/config.json'); await writeFile(file, '{broken');
  await assert.rejects(store.register(context, template));
  assert.equal(await readFile(file, 'utf8'), '{broken');
});
test('failed atomic replacement leaves memory and existing destination intact', async t => {
  const { root, handle } = await fixture(t);
  await mkdir(join(root, 'config/sample/config.json'));
  await assert.rejects(handle.update({ name: 'lost' }));
  assert.equal(handle.get().value.name, 'first'); assert.equal(handle.get().revision, 0);
});
test('invalid IDs, executable templates and prototype keys are rejected', async t => {
  const { store, context } = await fixture(t);
  for (const id of ['../escape', 'a/b', 'CON', 'NUL.txt', 'name.']) await assert.rejects(store.register(context, { ...template, id }));
  await assert.rejects(store.register(context, { ...template, id: 'code', render() {} }));
  await assert.rejects(store.write('sample', JSON.parse('{"__proto__":{"bad":true}}'), 0));
  assert.equal({}.bad, undefined);
});
test('profiles are isolated and ambiguous profile is an explicit failure', async t => {
  const { store, handle } = await fixture(t); const other = await fixture(t);
  await handle.update({ name: 'only-first' }); assert.equal(other.handle.get().value.name, 'first');
  await assert.rejects(new ConfigStore(undefined).register(owner(), template), error => error.code === 'profile-unavailable');
  assert.equal(store.read('sample').value.name, 'only-first');
});
test('unload during initial asynchronous read prevents late registration', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-race-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConfigStore(root), context = owner();
  const pending = store.register(context, template); context.dispose();
  await assert.rejects(pending, error => error.code === 'disposed'); assert.deepEqual(store.list(), []);
});

test('partial object and array defaults fill nested fields on first registration', async t => {
  const { store, context } = await fixture(t);
  const nested = { type: 'object', label: 'Item', fields: [{ type: 'text', key: 'name', label: 'Name', default: 'nested' }] };
  const handle = await store.register(context, defineConfig({ id: 'nested', packageName: 'nested-example', title: 'Nested', fields: [
    { ...nested, key: 'object', default: {} },
    { type: 'array', key: 'rows', label: 'Rows', default: [{}], item: nested },
  ] }));
  assert.deepEqual(handle.get().value, { object: { name: 'nested' }, rows: [{ name: 'nested' }] });
  assert.deepEqual(store.read('nested').defaults, handle.get().value);
});
