// L1 unit tests โ€?Web stable API + service alias (design.md ยง4.3, ยง4.4, ยง5.2, ยง5.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebAPI, DshLoaderWebError } from '../dist/services/web.js';
import { createServicesAPI } from '../dist/services/services.js';
import { makeMockCtx, makeMockWebServer } from './helpers/mock.mjs';
import { create as createDsh1xAdapter, installHostPackageAliases } from '../dist/adapters/dsh-1-x.js';

// TC-WEB-01: register prefix route โ?webServer.register called with kind prefix.
test('TC-WEB-01 web.register registers prefix route', () => {
  const { webServer, registrations } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  const web = createWebAPI({ ctx });
  const dispose = web.register('/api/demo', () => {});
  assert.equal(typeof dispose, 'function');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].kind, 'prefix');
  assert.equal(registrations[0].path, '/api/demo');
});

// TC-WEB-02: use middleware โ?webServer.register called with kind middleware.
test('TC-WEB-02 web.use registers middleware kind', () => {
  const { webServer, registrations } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  const web = createWebAPI({ ctx });
  const mw = () => {};
  web.use(mw);
  assert.equal(registrations[0].kind, 'middleware');
  assert.equal(registrations[0].handler, mw);
});

// TC-BND-SVC-01: webServer missing โ?error with dshloader prefix.
test('TC-BND-SVC-01 web.register without webServer throws dshloader error', () => {
  const { ctx } = makeMockCtx();
  const web = createWebAPI({ ctx });
  assert.throws(
    () => web.register('/api/x', () => {}),
    (err) => err instanceof DshLoaderWebError && /webServer service unavailable/.test(err.message) && /\[dshloader/.test(err.message),
  );
});

// TC-ALIAS-01: httpServer -> webServer alias; both access paths return same instance.
test('TC-ALIAS-01 adapter aliases httpServer to webServer (both access paths)', async () => {
  const { webServer, registrations } = makeMockWebServer();
  const { ctx, services, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  // expose a direct property getter for httpServer too, mirroring ยง3.3.2.
  Object.defineProperty(ctx, 'httpServer', { get: () => services.get('httpServer'), enumerable: true, configurable: true });

  const adapter = createDsh1xAdapter(ctx, { exposeAllNamespaces: false });
  await adapter.apply();

  assert.equal(ctx.get('httpServer'), ctx.get('webServer'));
  assert.equal(ctx.httpServer, ctx.webServer); // direct property path synced
  assert.equal(ctx.httpServer, webServer);
});

// TC-ALIAS-02: existing real httpServer is not overwritten; logs skip.
test('TC-ALIAS-02 existing httpServer is not overwritten', async () => {
  const { webServer } = makeMockWebServer();
  const realHttp = { register: () => () => {} };
  const { ctx, services, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  registerService('httpServer', realHttp);
  Object.defineProperty(ctx, 'httpServer', { get: () => services.get('httpServer'), enumerable: true, configurable: true });

  const logs = [];
  const orig = console.log;
  console.log = (m) => logs.push(m);
  try {
    const adapter = createDsh1xAdapter(ctx, { exposeAllNamespaces: false });
    await adapter.apply();
  } finally {
    console.log = orig;
  }
  assert.equal(ctx.get('httpServer'), realHttp);
  assert.ok(logs.some((l) => /httpServer already exists, skip alias/.test(l)));
});

// TC-BND-SEC-02: alias does not cover official service (same as TC-ALIAS-02 path).
test('TC-BND-SEC-02 alias skipped when official httpServer present', async () => {
  const { webServer } = makeMockWebServer();
  const realHttp = { register: () => () => {} };
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  registerService('httpServer', realHttp);
  const adapter = createDsh1xAdapter(ctx, { exposeAllNamespaces: false });
  await adapter.apply();
  assert.equal(ctx.get('httpServer'), realHttp);
});

// services.alias low-level helper.
test('services.alias provides one-hop alias and skips when source exists', () => {
  const { ctx, registerService } = makeMockCtx();
  const target = { x: 1 };
  registerService('webServer', target);
  const services = createServicesAPI({ ctx });
  services.alias('httpServer', 'webServer');
  assert.equal(ctx.get('httpServer'), target);
  // second call: source now exists โ?skip, no overwrite
  services.alias('httpServer', 'webServer');
  assert.equal(ctx.get('httpServer'), target);
});

// TC-WEB-03: registerUpgrade proxies to webServer.registerUpgrade.
test('TC-WEB-03 web.registerUpgrade proxies to webServer.registerUpgrade', () => {
  const upgrades = [];
  const webServer = {
    register: () => () => {},
    registerUpgrade(route) {
      upgrades.push(route);
      return () => { const i = upgrades.indexOf(route); if (i >= 0) upgrades.splice(i, 1); };
    },
  };
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  const web = createWebAPI({ ctx });
  const handler = (req, socket, head) => {};
  const dispose = web.registerUpgrade({ path: '/ws/test', handler });
  assert.equal(typeof dispose, 'function');
  assert.equal(upgrades.length, 1);
  assert.equal(upgrades[0].path, '/ws/test');
  assert.equal(upgrades[0].handler, handler);
  dispose();
  assert.equal(upgrades.length, 0);
});

// TC-WEB-04: registerUpgrade throws when webServer lacks registerUpgrade.
test('TC-WEB-04 web.registerUpgrade throws when webServer lacks method', () => {
  const { webServer } = makeMockWebServer(); // no registerUpgrade
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  const web = createWebAPI({ ctx });
  assert.throws(
    () => web.registerUpgrade({ path: '/ws/x', handler: () => {} }),
    (err) => err instanceof DshLoaderWebError && /registerUpgrade/.test(err.message),
  );
});

// TC-HOST-PKG-01: installHostPackageAliases intercepts CJS require.
test('TC-HOST-PKG-01 installHostPackageAliases maps CJS require', async () => {
  const Module = await import('node:module').then((m) => m.default ?? m.Module ?? m);
  const original = Module._resolveFilename;
  const resolved = [];
  // Monkey-patch _resolveFilename to record calls without actually resolving.
  Module._resolveFilename = function(request, ...rest) {
    resolved.push(request);
    return `/fake/${request}`;
  };
  try {
    const dispose = await installHostPackageAliases({
      '@old/host-pkg': '@new/host-pkg',
    });
    // Simulate a require('@old/host-pkg') โ€?the hook should map it.
    Module._resolveFilename('@old/host-pkg');
    Module._resolveFilename('node:fs');
    assert.deepEqual(resolved, ['@new/host-pkg', 'node:fs']);
    dispose();
    // After dispose, mapping is gone.
    resolved.length = 0;
    Module._resolveFilename('@old/host-pkg');
    assert.deepEqual(resolved, ['@old/host-pkg']);
  } finally {
    Module._resolveFilename = original;
  }
});

// TC-HOST-PKG-02: empty aliases is a no-op.
test('TC-HOST-PKG-02 empty host package aliases is no-op', async () => {
  const dispose = await installHostPackageAliases({});
  assert.equal(typeof dispose, 'function');
  dispose(); // should not throw
});

// TC-HOST-PKG-03: stable @dsh-plugin/dsh-loader/* subpaths map to real
// dsh package names via the adapter's default hostPackageAliases.
test('TC-HOST-PKG-03 stable @dsh-plugin/dsh-loader/* maps to real dsh packages', async () => {
  const Module = await import('node:module').then((m) => m.default ?? m.Module ?? m);
  const original = Module._resolveFilename;
  const resolved = [];
  Module._resolveFilename = function(request, ...rest) {
    resolved.push(request);
    return `/fake/${request}`;
  };
  try {
    const { hostPackageAliases } = await import('../dist/adapters/dsh-1-x.js');
    const dispose = await installHostPackageAliases(hostPackageAliases);
    Module._resolveFilename('@dsh-plugin/dsh-loader/tools');
    Module._resolveFilename('@dsh-plugin/dsh-loader/llm');
    Module._resolveFilename('@dsh-plugin/dsh-loader/agent');
    assert.deepEqual(resolved, [
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-agent',
    ]);
    dispose();
  } finally {
    Module._resolveFilename = original;
  }
});
