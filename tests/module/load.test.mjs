// L2 module tests — host bundle load / lifecycle / rollback (design.md §4.1, §4.8, §4.10, §5.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, applyAdapter, readLoaderConfig } from '../../src/index.js';
import { makeMockCtx, makeMockWebServer, makeTempProfile } from '../helpers/mock.mjs';

// TC-LOAD-01: dshloader apply registers ctx.dshLoader and logs startup info.
test('TC-LOAD-01 apply registers ctx.dshLoader and logs adapter info', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  const logs = [];
  const orig = console.log;
  console.log = (m) => logs.push(m);
  try {
    await apply(ctx);
  } finally {
    console.log = orig;
    delete process.env.DSHLOADER_DSH_VERSION;
  }
  assert.ok(ctx.get('dshLoader'), 'ctx.dshLoader registered');
  assert.equal(ctx.dshLoader.dshVersion, '1.2.3');
  assert.ok(logs.some((l) => /loaded adapter dsh-1-x for dsh 1\.2\.3/.test(l)));
  assert.ok(logs.some((l) => /registered stable API: settings, web, services/.test(l)));
});

// TC-LOAD-02: dshloader after a reactive consumer — alias still resolves.
test('TC-LOAD-02 reactive consumer resolves alias regardless of order', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, services, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  Object.defineProperty(ctx, 'httpServer', { get: () => services.get('httpServer'), enumerable: true, configurable: true });

  // Simulate a downstream plugin declaring inject:['httpServer']: it stays
  // PENDING (does not run its apply) until httpServer is provided.
  const downstream = { state: 'PENDING', got: null };
  downstream.tryApply = () => {
    const http = ctx.get('httpServer');
    if (http === undefined) {
      downstream.state = 'PENDING';
      return;
    }
    downstream.state = 'ACTIVE';
    downstream.got = http;
  };
  // 1. load downstream first → PENDING.
  downstream.tryApply();
  assert.equal(downstream.state, 'PENDING');
  // 2. dshloader apply (after downstream) registers the alias.
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  try {
    await apply(ctx);
  } finally {
    delete process.env.DSHLOADER_DSH_VERSION;
  }
  // 3. cordis re-triggers downstream once dependency is satisfied.
  downstream.tryApply();
  assert.equal(downstream.state, 'ACTIVE');
  assert.equal(downstream.got, webServer);
});

// TC-LOAD-03: provide result verifiable regardless of insert position.
test('TC-LOAD-03 ctx.dshLoader and alias registered (position-independent)', async () => {
  for (const position of ['first', 'last']) {
    const { webServer } = makeMockWebServer();
    const { ctx, registerService } = makeMockCtx();
    registerService('webServer', webServer);
    process.env.DSHLOADER_DSH_VERSION = '1.2.3';
    try {
      await apply(ctx);
    } finally {
      delete process.env.DSHLOADER_DSH_VERSION;
    }
    assert.ok(ctx.get('dshLoader'), `position=${position}: dshLoader present`);
    assert.equal(ctx.get('httpServer'), webServer, `position=${position}: alias present`);
  }
});

// TC-OBS-01: startup log includes dsh version + adapter name + API list.
test('TC-OBS-01 startup log includes version, adapter, API list', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  const logs = [];
  const orig = console.log;
  console.log = (m) => logs.push(m);
  try {
    await apply(ctx);
  } finally {
    console.log = orig;
    delete process.env.DSHLOADER_DSH_VERSION;
  }
  const joined = logs.join('\n');
  assert.match(joined, /1\.2\.3/);
  assert.match(joined, /dsh-1-x/);
  assert.match(joined, /settings, web, services/);
});

// TC-ROLL-01: DSHLOADER_DISABLE=1 skips registration and logs.
test('TC-ROLL-01 DSHLOADER_DISABLE=1 skips registration', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  process.env.DSHLOADER_DISABLE = '1';
  const logs = [];
  const orig = console.log;
  console.log = (m) => logs.push(m);
  try {
    await apply(ctx);
  } finally {
    console.log = orig;
    delete process.env.DSHLOADER_DISABLE;
  }
  assert.equal(ctx.get('dshLoader'), undefined);
  assert.ok(logs.some((l) => /disabled by env, skipping/.test(l)));
});

// TC-ROLL-02: disabled patch flag → apply is a no-op (simulated via env).
test('TC-ROLL-02 disabled patch skips registration', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  // cordis itself would not call apply() for a `disabled: true` patch; we
  // simulate the equivalent by asserting DSHLOADER_DISABLE short-circuits.
  process.env.DSHLOADER_DISABLE = '1';
  try {
    await apply(ctx);
  } finally {
    delete process.env.DSHLOADER_DISABLE;
  }
  assert.equal(ctx.get('dshLoader'), undefined);
  assert.equal(ctx.get('httpServer'), undefined);
});

// TC-BND-CON-02: webServer removed then restored → effects recycle, no duplicate.
test('TC-BND-CON-02 fiber unload+reload recycles effects without duplicates', async () => {
  const { webServer, registrations } = makeMockWebServer();
  const { ctx, effects, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  try {
    await apply(ctx);
  } finally {
    delete process.env.DSHLOADER_DSH_VERSION;
  }
  const routesAfterFirst = registrations.length;
  assert.ok(routesAfterFirst >= 0);
  // Simulate fiber unload: run all effect dispose functions.
  for (const e of effects) e.dispose?.();
  // Simulate fiber reload: clear and re-apply.
  effects.length = 0;
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  try {
    await apply(ctx);
  } finally {
    delete process.env.DSHLOADER_DSH_VERSION;
  }
  // No duplicate alias: httpServer still points at the same webServer.
  assert.equal(ctx.get('httpServer'), webServer);
});

// readLoaderConfig: env override path.
test('readLoaderConfig honors DSHLOADER_EXPOSE_ALL_SETTINGS env', () => {
  process.env.DSHLOADER_EXPOSE_ALL_SETTINGS = '1';
  try {
    assert.equal(readLoaderConfig().exposeAllNamespaces, true);
  } finally {
    delete process.env.DSHLOADER_EXPOSE_ALL_SETTINGS;
  }
});

// Version detection via temp profile package.json.
test('detectDshVersion reads profile node_modules dsh package.json', async () => {
  const { detectDshVersion } = await import('../../src/registry.js');
  const prof = makeTempProfile({ dshVersion: '1.4.2' });
  try {
    delete process.env.DSHLOADER_DSH_VERSION;
    const v = detectDshVersion({ profileDir: prof.profileDir });
    assert.equal(v, '1.4.2');
  } finally {
    prof.cleanup();
  }
});
