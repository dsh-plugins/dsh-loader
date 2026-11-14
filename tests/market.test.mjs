import { test } from 'node:test';
import assert from 'node:assert/strict';
import { preferNewestTag, installMarketVersionPolicy } from '../dist/market.js';
import { readLoaderConfig } from '../dist/index.js';

const version = (value, compatible = true, source = { type: 'npm' }) => ({
  version: value, source, compatibility: { compatible }, install: { spec: `example@${value}` },
});
const entry = (versions = [version('2.0.0-rc.2'), version('1.0.0')]) => ({
  name: 'example', versions, defaultVersion: '1.0.0', installation: { status: 'installed', installedVersion: '1.0.0' },
});
test('selects newer latest/next by SemVer and updates installation status without mutating targets', async () => {
  const original = entry();
  const result = await preferNewestTag(original, async () => ({ latest: '1.0.0', next: '2.0.0-rc.2' }));
  assert.equal(result.defaultVersion, '2.0.0-rc.2');
  assert.equal(result.installation.status, 'update-available');
  assert.equal(original.defaultVersion, '1.0.0');
  assert.equal(result.versions, original.versions);
});
test('stable wins over an older prerelease and numbers compare numerically', async () => {
  const result = await preferNewestTag(entry([version('2.0.0-rc.9'), version('2.0.0-rc.10'), version('2.0.0')]),
    async () => ({ latest: '2.0.0-rc.9', next: '2.0.0-rc.10' }));
  assert.equal(result.defaultVersion, '2.0.0-rc.10');
  assert.equal((await preferNewestTag(result, async () => ({ latest: '2.0.0', next: '2.0.0-rc.10' }))).defaultVersion, '2.0.0');
});
test('missing, invalid, incompatible and unindexed tags retain an available default', async () => {
  for (const tags of [{}, { latest: 'bad', next: '3.0.0' }, { latest: '1.0.0', next: '2.0.0-rc.2' }]) {
    const value = entry([version('2.0.0-rc.2', false), version('1.0.0')]);
    assert.equal((await preferNewestTag(value, async () => tags)).defaultVersion, '1.0.0');
  }
  const value = entry();
  assert.equal(await preferNewestTag(value, async () => { throw new Error('offline'); }), value);
});
test('git entries never query npm and configured registries remain separate', async () => {
  const git = entry([version('2.0.0', true, { type: 'git' })]);
  assert.equal(await preferNewestTag(git, () => { throw new Error('must not fetch'); }), git);
  const calls = [];
  const value = entry([version('2.0.0', true, { type: 'npm', registry: 'https://registry.example/npm/' })]);
  assert.equal((await preferNewestTag(value, async (...args) => { calls.push(args); return { next: '2.0.0' }; })).defaultVersion, '2.0.0');
  assert.deepEqual(calls, [['example', 'https://registry.example/npm/']]);
});
test('wraps search and entry, caches tags, changes live, and restores methods on disposal', async () => {
  const original = entry();
  const market = { async search() { return { entries: [original], total: 1 }; }, async entry() { return original; } };
  const search = market.search, detail = market.entry;
  let enabled = false, fetches = 0;
  const dispose = installMarketVersionPolicy({ get: () => market, effect() {} }, () => enabled, async () => {
    fetches++;
    return { ok: true, json: async () => ({ 'dist-tags': { latest: '1.0.0', next: '2.0.0-rc.2' } }) };
  });
  assert.equal(await market.entry(), original);
  assert.equal(fetches, 0);
  enabled = true;
  assert.equal((await market.search()).entries[0].defaultVersion, '2.0.0-rc.2');
  assert.equal((await market.entry()).defaultVersion, '2.0.0-rc.2');
  assert.equal(fetches, 1);
  enabled = false;
  assert.equal(await market.entry(), original);
  dispose();
  assert.equal(market.search, search);
  assert.equal(market.entry, detail);
});
test('loader config defaults off and accepts explicit enable/disable', () => {
  assert.equal(readLoaderConfig({ profileDir: '.' }).preferNewestMarketVersion, false);
  assert.equal(readLoaderConfig({ profileDir: '.', config: { preferNewestMarketVersion: true } }).preferNewestMarketVersion, true);
});
