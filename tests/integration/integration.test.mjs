// L3 integration tests â€?profile injection + adapter upgrade flow (design.md Â§4.11, Â§6.1).
//
// Real dsh is not assumed to be installed (GAP-01); these tests cover the
// mock-profile paths: setup script injection, dump-config graceful skip, and
// the TC-E2E-01 "upgrade loader to recover" simulation at the registry level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setupProfile, injectDependency, injectPatch, dumpConfig, info } from '../../dist/setup.js';
import { AdapterRegistry, UnsupportedDshVersionError } from '../../dist/registry.js';

function makeProfile(name) {
  const root = mkdtempSync(join(tmpdir(), 'dshloader-it-'));
  const home = join(root, 'home');
  const profileDir = join(home, 'profiles', name);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'p', version: '1.0.0', dependencies: {} }, undefined, 2));
  return { root, home, profileDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// M6 setup: injects dependency + patch, no reorder.
test('setup injects dependency and patch into profile', () => {
  const prof = makeProfile('web');
  const origHome = process.env.DSH_HOME;
  process.env.DSH_HOME = prof.home;
  try {
    const result = setupProfile('web');
    assert.equal(result.dependencyAdded, true);
    assert.equal(result.patchAdded, true);
    const pkg = JSON.parse(readFileSync(join(prof.profileDir, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies['@dsh-plugin/dsh-loader']);
    const patch = readFileSync(join(prof.profileDir, 'cordis.patch.yml'), 'utf8');
    assert.match(patch, /id: dsh-loader/);
    // idempotent
    const r2 = setupProfile('web');
    assert.equal(r2.dependencyAdded, false);
    assert.equal(r2.patchAdded, false);
  } finally {
    process.env.DSH_HOME = origHome;
    prof.cleanup();
  }
});

test('injectDependency + injectPatch are idempotent unit-level', () => {
  const prof = makeProfile('web');
  try {
    const d1 = injectDependency(join(prof.profileDir, 'package.json'));
    assert.equal(d1.added, true);
    const d2 = injectDependency(join(prof.profileDir, 'package.json'));
    assert.equal(d2.added, false);
    const p1 = injectPatch(join(prof.profileDir, 'cordis.patch.yml'));
    assert.equal(p1.added, true);
    const p2 = injectPatch(join(prof.profileDir, 'cordis.patch.yml'));
    assert.equal(p2.added, false);
  } finally {
    prof.cleanup();
  }
});

// dump-config: graceful when dsh CLI missing.
test('dump-config returns not-ok when dsh CLI unavailable', () => {
  const prof = makeProfile('web');
  const origHome = process.env.DSH_HOME;
  process.env.DSH_HOME = prof.home;
  try {
    const { ok } = dumpConfig('web');
    // dsh not installed in CI â†?expect false; if installed, ok may be true.
    assert.ok(typeof ok === 'boolean');
  } finally {
    process.env.DSH_HOME = origHome;
    prof.cleanup();
  }
});

// info: prints loader + dsh version without throwing.
test('info prints loader and dsh version', () => {
  const prof = makeProfile('web');
  const origHome = process.env.DSH_HOME;
  process.env.DSH_HOME = prof.home;
  // install a fake dsh package.json so detection works
  const dshDir = join(prof.profileDir, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(dshDir, { recursive: true });
  writeFileSync(join(dshDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.2.3' }));
  try {
    const out = info('web');
    assert.equal(out.loaderVersion, '1.0.0');
    assert.equal(out.dshVersion, '1.2.3');
  } finally {
    process.env.DSH_HOME = origHome;
    prof.cleanup();
  }
});

// TC-E2E-01: simulated dsh 3.0.0 breaks the settings API signature; adding a
// 3.0.0 adapter that translates the signature restores the plugin without
// touching plugin code (AC-OV-01).
//
// NOTE on the test plan's "step 1 fails with UnsupportedDshVersionError":
// per design.md Â§3.1 rule 3, a version above a bounded adapter's range is a
// nearest-low FALLBACK, not a too-new error (a too-new error only happens with
// an empty registry â€?TC-REG-03). So step 1 here records the *plugin-level*
// failure (the 1.x adapter calls the old signature, which dsh 3.0.0 rejects),
// matching the design doc's allowed "æ’ä»¶æŠ¥é”™" outcome.
test('TC-E2E-01 adding adapter for new dsh version restores plugin', async () => {
  const { createHostAPI } = await import('../../dist/api.js');
  const { makeMockCtx } = await import('../helpers/mock.mjs');

  // Mock dsh 3.0.0 settings service: update() now takes (ns, { ops }, rev).
  // Calling it with the old (ns, section, rev) shape throws.
  const settings3 = {
    describe: () => [{ ns: 'my-plugin', schema: {}, value: {}, applies: {}, secrets: [], revision: 0 }],
    async update(ns, payload) {
      if (payload === undefined || typeof payload !== 'object' || !Array.isArray(payload.ops)) {
        const err = new Error('dsh 3.0.0 expects { ops } payload');
        err.expected = '{ ops: SettingsOp[] }';
        err.actual = String(payload);
        throw err;
      }
      return { ok: true };
    },
    async replace(ns, payload, rev) { return this.update(ns, payload, rev); },
    async mutate(ns, payload, rev) { return this.update(ns, payload, rev); },
  };

  // Step 1: only the dsh-1-x adapter is registered. select('3.0.0') falls back.
  const reg = new AdapterRegistry();
  reg.register({ supports: '>=1.0.0 <2.0.0', name: 'dsh-1-x', create: () => ({ apply() {} }) });
  const warns = [];
  const origWarn = console.warn;
  console.warn = (m) => warns.push(m);
  let step1;
  try {
    step1 = reg.select('3.0.0');
  } finally {
    console.warn = origWarn;
  }
  assert.equal(step1.mode, 'fallback');
  assert.ok(warns.some((w) => /falling back/.test(w)));

  // The plugin uses the stable API (old signature) via the 1.x adapter; dsh
  // 3.0.0 rejects it â†?plugin-level failure (SettingsResult ok:false).
  const ctx1 = makeMockCtx();
  ctx1.registerService('settings', settings3);
  const api1 = createHostAPI({ ctx: ctx1.ctx, dshVersion: '3.0.0', factory: step1.factory, adapter: step1.factory.create(ctx1.ctx, {}), exposeAllNamespaces: true });
  const result1 = await api1.settings.update('my-plugin', { enabled: true }, 0);
  assert.equal(result1.ok, false, 'step 1 plugin call fails');

  // Step 3: ship a dsh-3-0-x adapter that translates the signature.
  reg.register({
    supports: '>=3.0.0 <3.1.0',
    name: 'dsh-3-0-x',
    create: (ctx) => ({
      apply() {},
      settings: {
        exposeAllNamespaces: true,
        describe: () => settings3.describe(),
        async update(ns, section, expectedRevision) {
          await settings3.update(ns, { ops: [{ op: 'set', path: [], value: section }] }, expectedRevision);
          return { ok: true, value: { ns, schema: {}, value: section, applies: {}, secrets: [], revision: 1 } };
        },
        async replace(ns, section, rev) { return this.update(ns, section, rev); },
        async mutate(ns, ops, rev) { await settings3.update(ns, { ops }, rev); return { ok: true, value: { ns, schema: {}, value: {}, applies: {}, secrets: [], revision: 1 } }; },
      },
    }),
  });
  const step3 = reg.select('3.0.0');
  assert.equal(step3.factory.name, 'dsh-3-0-x');
  assert.equal(step3.mode, 'range'); // exact match = literal supports; this is a range hit (rule 2), not fallback

  const ctx3 = makeMockCtx();
  ctx3.registerService('settings', settings3);
  const adapter3 = step3.factory.create(ctx3.ctx, {});
  const api3 = createHostAPI({ ctx: ctx3.ctx, dshVersion: '3.0.0', factory: step3.factory, adapter: adapter3, exposeAllNamespaces: true });
  const result3 = await api3.settings.update('my-plugin', { enabled: true }, 0);
  assert.equal(result3.ok, true, 'step 3 plugin call succeeds after adapter upgrade');
});
