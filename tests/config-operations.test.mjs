import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore } from '../dist/services/config.js';
import { ConfigError, defineConfig } from '../dist/config.js';
import { createConfigClient } from '../dist/config-client.js';
import { operationsPanel, registerExampleOperations } from '../examples/config-plugin/operations.mjs';

const template = () => defineConfig({ id: 'operations', packageName: '@example/operations', title: 'Operations', fields: [
  { type: 'array', key: 'models', label: 'Models', default: ['first', 'second'], item: { type: 'text', label: 'Model' } },
  { type: 'password', key: 'secret', label: 'Secret', default: 'host-secret' },
], panels: [{ ...structuredClone(operationsPanel), operations: [...structuredClone(operationsPanel.operations), { id: 'host.snapshot', input: [], readOnly: true }, { id: 'test.save', input: [], requiresRevision: true }, { id: 'test.delete', input: [], requiresRevision: true }] }] });
function owner() { const releases = []; return { effect(fn) { releases.push(fn()); }, dispose() { for (const off of releases) off?.(); } }; }
async function fixture(t) {
  const profile = await mkdtemp(join(tmpdir(), 'dsh-operations-')), store = new ConfigStore(profile), context = owner();
  t.after(async () => { context.dispose(); store.dispose(); await rm(profile, { force: true, recursive: true }); });
  const handle = await store.register(context, template()); const example = registerExampleOperations(handle, ConfigError);
  return { profile, store, context, handle, ...example };
}
test('operations validate inputs without writing config, emitting changes or notifying configuration watchers', async t => {
  const { profile, store, handle } = await fixture(t); let changed = 0, watched = 0;
  store.subscribe(() => changed++); handle.watch(() => watched++);
  const invoke = (id, input) => store.invoke('operations', id, { input });
  assert.equal((await invoke('documents.list', { query: '', content: 'not-an-input' })).value.items.length, 2);
  const loaded = await invoke('documents.load', { documentId: 'intro' }); assert.equal(loaded.resource.revision, 1);
  assert.equal((await invoke('documents.import', { importText: 'temporary draft' })).value.content, 'temporary draft');
  assert.equal((await invoke('documents.preview', { content: '# Heading' })).value, '# Heading');
  assert.equal(handle.get().revision, 0); assert.equal(changed, 0); assert.equal(watched, 0);
  await assert.rejects(readFile(join(profile, 'config/operations/config.json')), { code: 'ENOENT' });
  await assert.rejects(invoke('documents.preview', { content: 4 }), error => error.code === 'validation' && Boolean(error.fields.content));
  await assert.rejects(invoke('unknown', {}), error => error.code === 'not-found');
});
test('save/delete require resource identity and revision and preserve both persisted config and conflicting resource', async t => {
  const { store, handle, documents, profile } = await fixture(t);
  await handle.update({ models: ['third'] });
  const file = join(profile, 'config/operations/config.json'), before = await readFile(file, 'utf8');
  const loaded = await store.invoke('operations', 'documents.load', { input: { documentId: 'intro' } });
  const save = { input: { documentId: 'intro', content: 'saved document' }, resource: loaded.resource };
  await assert.rejects(store.invoke('operations', 'documents.save', { input: save.input }), error => error.code === 'revision-required');
  const results = await Promise.allSettled([store.invoke('operations', 'documents.save', save), store.invoke('operations', 'documents.save', save)]);
  assert.equal(results[0].value.resource.revision, 2); assert.equal(results[1].reason.code, 'conflict');
  assert.equal(documents.get('intro').content, 'saved document');
  await assert.rejects(store.invoke('operations', 'documents.delete', { input: { documentId: 'intro' }, resource: loaded.resource }), error => error.code === 'conflict');
  await assert.rejects(store.invoke('operations', 'documents.save', { ...save, input: { documentId: 'tool', content: 'bad' }, resource: results[0].value.resource }), error => error.code === 'conflict');
  const deleted = await store.invoke('operations', 'documents.delete', { input: { documentId: 'intro' }, resource: results[0].value.resource });
  assert.equal(deleted.resource, null); assert.equal(documents.has('intro'), false);
  assert.equal(await readFile(file, 'utf8'), before); assert.equal(handle.get().revision, 1);
});
test('saved option binding is validated against saved config and handlers receive a cloned host snapshot', async t => {
  const { store, handle } = await fixture(t);
  await assert.rejects(store.invoke('operations', 'models.download', { input: { model: 'unsaved' } }), error => error.code === 'validation');
  assert.throws(() => handle.registerOperation('unknown', () => ({ value: null })), error => error.code === 'not-found');
  handle.registerOperation('host.snapshot', ({ config }) => { const secret = config.value.secret; config.value.models.push('local-only'); return { value: { hasSecret: secret === 'host-secret', revision: config.revision } }; });
  const result = await store.invoke('operations', 'host.snapshot', { input: {} });
  assert.deepEqual(result.value, { hasSecret: true, revision: 0 });
  assert.deepEqual(handle.get().value.models, ['first', 'second']);
  assert.ok(!JSON.stringify(store.read('operations')).includes('host-secret'));
});
test('owner disposal, explicit unregister and cancellation abort in-flight handlers without reviving an older registration', async t => {
  const { store, handle, context } = await fixture(t);
  let received;
  const off = handle.registerOperation('host.snapshot', ({ signal }) => { received = signal; return new Promise(() => {}); });
  const pending = store.invoke('operations', 'host.snapshot', { input: {} });
  off(); off(); await assert.rejects(pending, error => error.code === 'cancelled'); assert.equal(received.aborted, true);
  handle.registerOperation('host.snapshot', () => ({ value: 'new' })); off();
  assert.equal((await store.invoke('operations', 'host.snapshot', { input: {} })).value, 'new');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(store.invoke('operations', 'host.snapshot', { input: {} }, controller.signal), error => error.code === 'cancelled');
  const slow = store.invoke('operations', 'models.download', { input: { model: 'first' } });
  context.dispose(); await assert.rejects(slow, error => error.code === 'cancelled');
  assert.deepEqual(store.list(), []);
});
test('late handler completion after unloading never returns a result and old handles cannot revoke new handlers', async t => {
  const { store, context, handle } = await fixture(t); let complete;
  const release = handle.registerOperation('host.snapshot', () => new Promise(resolve => { complete = resolve; }));
  const pending = store.invoke('operations', 'host.snapshot', { input: {} }); handle.dispose();
  await assert.rejects(pending, error => error.code === 'cancelled');
  complete({ value: 'late' });
  const next = await store.register(context, template()); next.registerOperation('host.snapshot', () => ({ value: 'new owner' })); release();
  assert.equal((await store.invoke('operations', 'host.snapshot', { input: {} })).value, 'new owner');
});
test('async save/delete serialize by resource revision while other resources proceed and cancelled queued calls never execute', async t => {
  const { store, handle } = await fixture(t); let finish, started, deleting = 0;
  const gate = new Promise(resolve => finish = resolve), begin = new Promise(resolve => started = resolve), revisions = new Map([['a', 1], ['b', 1]]);
  handle.registerOperation('test.save', async ({ resource }) => {
    if (revisions.get(resource.id) !== resource.revision) throw new ConfigError('conflict', 'stale');
    if (resource.id === 'a') { started(); await gate; }
    revisions.set(resource.id, resource.revision + 1); return { value: 'saved', resource: { ...resource, revision: resource.revision + 1 } };
  });
  handle.registerOperation('test.delete', ({ resource }) => { deleting++; if (revisions.get(resource.id) !== resource.revision) throw new ConfigError('conflict', 'stale'); revisions.delete(resource.id); return { value: 'deleted', resource: null }; });
  const request = id => ({ input: {}, resource: { id, revision: 1 } });
  const first = store.invoke('operations', 'test.save', request('a')); await begin;
  const stale = store.invoke('operations', 'test.delete', request('a')); const staleCheck = assert.rejects(stale, error => error.code === 'conflict');
  const controller = new AbortController(); const cancelled = store.invoke('operations', 'test.delete', request('a'), controller.signal);
  controller.abort(); await assert.rejects(cancelled, error => error.code === 'cancelled');
  assert.equal((await store.invoke('operations', 'test.save', request('b'))).resource.revision, 2); assert.equal(deleting, 0);
  finish(); await first; await staleCheck; assert.equal(deleting, 1); assert.equal(revisions.get('a'), 2);
});
test('operation template rejects executable or unsafe bindings, automatic mutations, missing sources and secret options', () => {
  const invalid = change => { const next = template(); change(next); assert.throws(() => defineConfig(next), error => error.code === 'invalid-template' || error.code === 'invalid'); };
  invalid(next => next.panels[0].operations[0].readOnly = false);
  invalid(next => next.panels[0].operations[0].input = ['missing']);
  invalid(next => next.panels[0].operations[1].fill[0].to = ['__proto__']);
  invalid(next => next.panels[0].operations[0].refresh = ['documents.load']);
  invalid(next => next.panels[0].fields[1].optionsFrom.operation = 'missing');
  invalid(next => next.panels[0].fields[1].optionsFrom = 'invalid-source');
  invalid(next => next.panels[0].fields[1].optionsFrom.config = ['models']);
  invalid(next => next.panels[0].fields[3].optionsFrom = { config: ['models'] });
  invalid(next => next.panels[0].fields[4].optionsFrom.config = ['secret']);
  invalid(next => next.panels[0].operations[0].result[0].type = 'html');
  invalid(next => next.panels[0].operations[0].button.onClick = () => {});
  invalid(next => next.fields.push({ type: 'array', key: 'private', label: 'Private', item: { type: 'password', label: 'Secret' } }) && (next.panels[0].fields[4].optionsFrom.config = ['private']));
  invalid(next => next.panels[0].fields.push({ type: 'object', key: 'nested', label: 'Nested', default: { secret: 'hidden-default' }, fields: [{ type: 'password', key: 'secret', label: 'Secret' }] }));
});
test('client uses an independent POST, propagates errors, and has caller-controlled cancellation without a deadline', async t => {
  const calls = [];
  const client = createConfigClient(async (url, init) => { calls.push({ url, init }); return { json: async () => ({ ok: true, value: { value: 'done', resource: { id: 'doc', revision: 8 } } }) }; });
  const request = { input: { content: 'temporary' }, resource: { id: 'doc', revision: 7 } };
  const result = await client.invoke('example', 'save', request);
  assert.equal(calls[0].url, '/api/dshloader/config/example/operations/save'); assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), request); assert.equal(result.resource.revision, 8);
  const conflict = createConfigClient(async () => ({ json: async () => ({ ok: false, code: 'conflict', message: 'keep draft', fields: { content: 'stale' } }) }));
  await assert.rejects(conflict.invoke('example', 'save', request), error => error instanceof ConfigError && error.code === 'conflict' && error.fields.content === 'stale');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal, complete;
  const slow = createConfigClient((_url, init) => { signal = init.signal; return new Promise((resolve, reject) => { complete = () => resolve({ json: async () => ({ ok: true, value: { value: 'downloaded' } }) }); signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }); }); });
  const pending = slow.invoke('example', 'download', { input: {} });
  t.mock.timers.tick(60 * 60 * 1000); assert.equal(signal.aborted, false); complete(); assert.equal((await pending).value, 'downloaded');
  const caller = new AbortController();
  const byCaller = slow.invoke('example', 'download', { input: {} }, caller.signal); caller.abort(); assert.equal(signal.aborted, true); await assert.rejects(byCaller, { name: 'AbortError' });
  const byDispose = slow.invoke('example', 'download', { input: {} }); slow.dispose(); assert.equal(signal.aborted, true); await assert.rejects(byDispose, { name: 'AbortError' });
  await assert.rejects(slow.invoke('example', 'download', { input: {} }), error => error.code === 'disposed');
});
