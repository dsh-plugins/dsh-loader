// L2 module tests — client boot-alias injection (order-independent alias
// factories for dsh ≥ 0.1.2 concurrent client-entry imports).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildBootAliasScript, installBootAliasInjection } from '../../dist/boot-injection.js';
import { installClient } from '../../dist/client.js';
import { BOOT_ALIAS_IDS_FLAG } from '../../dist/version.js';
import { create as createDsh1xAdapter } from '../../dist/adapters/dsh-1-x.js';
import { makeMockCtx, makeMockWindow } from '../helpers/mock.mjs';

const ALIASES = {
  '@dsh-plugin/dsh-loader/ui-primitives': '@deepseek-ai/dsh-client-ui-primitives',
  'dsh/runtime/context-provenance': '@deepseek-ai/dsh-client-runtime/client',
};

function makeFacade() {
  const registrations = [];
  return { facade: { load: (entry) => registrations.push(entry) }, registrations };
}

function runInRealm(script, window) {
  vm.runInNewContext(script, { window });
}

// Boot script registers every alias factory when the facade already exists.
test('boot-alias script registers all factories against an existing facade', () => {
  const { facade, registrations } = makeFacade();
  const window = { __ModuleLoader__: facade };
  runInRealm(buildBootAliasScript(ALIASES), window);
  assert.deepEqual(registrations.map((r) => r.id).sort(), Object.keys(ALIASES).sort());
  // The flag array is created inside the vm realm (foreign Array prototype):
  // compare through a plain join instead of deep identity.
  assert.equal(
    Array.from(window[BOOT_ALIAS_IDS_FLAG]).sort().join('\n'),
    Object.keys(ALIASES).sort().join('\n'),
  );
});

// Alias factory resolves the real module through the handed require.
test('boot-alias factory requires the real package name', () => {
  const { facade, registrations } = makeFacade();
  const window = { __ModuleLoader__: facade };
  runInRealm(buildBootAliasScript(ALIASES), window);
  const entry = registrations.find((r) => r.id === '@dsh-plugin/dsh-loader/ui-primitives');
  const mod = entry.factory((spec) => `resolved:${spec}`);
  assert.equal(mod, 'resolved:@deepseek-ai/dsh-client-ui-primitives');
});

// The context-provenance deep-import alias keeps its named-export reshape.
test('boot-alias context-provenance alias reshapes the named export', () => {
  const { facade, registrations } = makeFacade();
  const window = { __ModuleLoader__: facade };
  runInRealm(buildBootAliasScript(ALIASES), window);
  const entry = registrations.find((r) => r.id === 'dsh/runtime/context-provenance');
  const mod = entry.factory(() => ({ contextProvenance: 'impl', other: 1 }));
  // The factory closure is created inside the vm realm, so its result carries
  // that realm's prototype — assert members, not deep identity.
  assert.deepEqual(Object.keys(mod), ['contextProvenance']);
  assert.equal(mod.contextProvenance, 'impl');
});

// Facade arriving AFTER the script (queue script emitted later in the page)
// is captured by the property interceptor, then restored to a plain global.
test('boot-alias script intercepts a later facade assignment', () => {
  const { facade, registrations } = makeFacade();
  const window = {};
  runInRealm(buildBootAliasScript(ALIASES), window);
  assert.equal(registrations.length, 0);
  window.__ModuleLoader__ = facade;
  assert.deepEqual(registrations.map((r) => r.id).sort(), Object.keys(ALIASES).sort());
  assert.equal(window.__ModuleLoader__, facade);
  // Restored as a plain data property: re-assignment must not re-register.
  const { facade: second, registrations: secondRegistrations } = makeFacade();
  window.__ModuleLoader__ = second;
  assert.equal(window.__ModuleLoader__, second);
  assert.equal(secondRegistrations.length, 0);
  assert.equal(registrations.length, Object.keys(ALIASES).length);
});

// A window that never gains a facade stays inert (pre-module-system dsh).
test('boot-alias script stays inert without any facade', () => {
  const window = {};
  runInRealm(buildBootAliasScript(ALIASES), window);
  assert.equal(window.__ModuleLoader__, undefined);
  assert.equal(window[BOOT_ALIAS_IDS_FLAG], undefined);
});

// Double injection (defensive) registers once.
test('boot-alias script is idempotent', () => {
  const { facade, registrations } = makeFacade();
  const window = { __ModuleLoader__: facade };
  const script = buildBootAliasScript(ALIASES);
  runInRealm(script, window);
  runInRealm(script, window);
  assert.equal(registrations.length, Object.keys(ALIASES).length);
});

// installClient skips the factories the injection already registered (the
// live module system throws on duplicate factory ids).
test('installClient skips boot-registered alias factories', () => {
  const { window, moduleRegistry } = makeMockWindow();
  window[BOOT_ALIAS_IDS_FLAG] = Object.keys(ALIASES);
  assert.doesNotThrow(() => installClient({ window }));
  for (const id of Object.keys(ALIASES)) {
    assert.equal(moduleRegistry.has(id), false, `${id} must not be re-registered`);
  }
  // The require wrapper still installs for late-arriving bundles.
  assert.equal(typeof window.__ModuleLoader__.load, 'function');
});

// Without the flag, installClient keeps its legacy factory registration.
test('installClient registers alias factories when no boot injection ran', () => {
  const { window, moduleRegistry } = makeMockWindow();
  installClient({ window });
  assert.equal(moduleRegistry.has('dsh/runtime/context-provenance'), true);
});

// The host-side installer contributes one head script row per index render.
test('installBootAliasInjection pushes a head script row onto the injection table', () => {
  const { ctx } = makeMockCtx();
  const listeners = [];
  ctx.on = (event, listener) => {
    listeners.push({ event, listener });
    return () => listeners.splice(listeners.findIndex((l) => l.listener === listener), 1);
  };
  const dispose = installBootAliasInjection(ctx, ALIASES);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].event, 'webserver/index-inject');
  const table = [];
  listeners[0].listener(table);
  assert.equal(table.length, 1);
  assert.equal(table[0].kind, 'script');
  assert.equal(table[0].placement, 'head');
  assert.ok(table[0].text.includes('@dsh-plugin/dsh-loader/ui-primitives'));
  assert.ok(!table[0].text.includes('</script'), 'script text must not close its own tag');
  dispose();
  assert.equal(listeners.length, 0);
});

// Empty alias table: no subscription, no row.
test('installBootAliasInjection with no aliases stays inert', () => {
  const { ctx } = makeMockCtx();
  let subscribed = 0;
  ctx.on = () => {
    subscribed += 1;
    return () => {};
  };
  installBootAliasInjection(ctx, {});
  assert.equal(subscribed, 0);
});

// The dsh-1-x host adapter wires the injection as a labeled effect.
test('dsh-1-x adapter apply installs the boot-alias injection effect', async () => {
  const { ctx, effects } = makeMockCtx();
  const adapter = createDsh1xAdapter(ctx);
  await adapter.apply();
  const effect = effects.find((e) => e.label === 'dshloader: client boot-alias injection');
  assert.ok(effect, 'boot-alias injection effect is registered');
});
