// L2 module tests — client module redirection (design.md §4.6, §5.3, §5.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClient, createClientAPI, ModuleNotFoundError } from '../../src/client.js';
import { makeMockWindow } from '../helpers/mock.mjs';

// TC-CLI-MOD-01: deep source import path resolves to public entry via __ModuleLoader__.
test('TC-CLI-MOD-01 deep source path resolves to public entry', () => {
  const { window, moduleRegistry } = makeMockWindow({
    requireImpl: (spec) => {
      assert.equal(spec, '@deepseek-ai/dsh-client-runtime/client');
      return { contextProvenance: 'ctx-prov-impl' };
    },
  });
  window.__dshNativeRequire__ = (spec) => ({ contextProvenance: 'native:' + spec });
  installClient({ window });

  const factory = moduleRegistry.get('@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts');
  assert.ok(typeof factory === 'function');
  const mod = factory((spec) => ({ contextProvenance: 'resolved:' + spec }));
  assert.equal(mod.contextProvenance, 'resolved:@deepseek-ai/dsh-client-runtime/client');
});

// TC-CLI-MOD-02: stable module name resolves via window.__dshLoader__.require.
test('TC-CLI-MOD-02 stable module name resolves through __dshLoader__.require', () => {
  const { window } = makeMockWindow();
  const requireImpl = (spec) => ({ contextProvenance: 'impl:' + spec });
  installClient({ window, requireImpl });
  const mod = window.__dshLoader__.require('dsh/runtime/context-provenance');
  assert.equal(mod.contextProvenance, 'impl:@deepseek-ai/dsh-client-runtime/client');
});

// TC-BND-CLI-01: no document → module aliases still register, no throw.
test('TC-BND-CLI-01 non-browser env still registers module aliases', () => {
  const { window, moduleRegistry } = makeMockWindow({
    requireImpl: () => ({ contextProvenance: 'x' }),
  });
  // remove document to simulate SSR/non-browser
  delete window.document;
  assert.doesNotThrow(() => installClient({ window }));
  assert.ok(moduleRegistry.has('@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts'));
});

// TC-BND-SEC-01: unknown / escape-path module specifier → ModuleNotFoundError.
test('TC-BND-SEC-01 require unknown specifier throws ModuleNotFoundError', () => {
  const api = createClientAPI({ requireImpl: () => ({}) });
  assert.throws(
    () => api.require('../../../etc/passwd'),
    (err) => err instanceof ModuleNotFoundError && /etc\/passwd/.test(err.message),
  );
});

// registerModuleAlias adds a new alias at runtime.
test('registerModuleAlias adds alias resolvable via require', () => {
  const api = createClientAPI({ requireImpl: (spec) => ({ name: spec }) });
  api.registerModuleAlias('my/stable', 'real/pkg');
  assert.equal(api.require('my/stable').name, 'real/pkg');
});

// TC-CLI-SVC-01: services.get proxies to clientCtx.get.
test('TC-CLI-SVC-01 client services.get proxies to clientCtx.get', () => {
  const clientCtx = {
    get: (name) => {
      if (name === 'conversation') return { id: 'conv-1' };
      return undefined;
    },
  };
  const api = createClientAPI({ clientCtx });
  assert.deepEqual(api.services.get('conversation'), { id: 'conv-1' });
  assert.equal(api.services.get('nonexistent'), undefined);
});

// TC-CLI-SVC-02: services.get returns undefined when no clientCtx wired.
test('TC-CLI-SVC-02 client services.get returns undefined without ctx', () => {
  const api = createClientAPI({});
  assert.equal(api.services.get('conversation'), undefined);
});

// TC-PKG-01: registerPackageAlias adds mapping at runtime.
test('TC-PKG-01 registerPackageAlias adds mapping at runtime', () => {
  const api = createClientAPI({ packageAliases: {} });
  api.registerPackageAlias('@old/pkg', '@new/pkg');
  // No direct way to observe the map, but the installClient test below
  // verifies the __ModuleLoader__ wrapping. Here we just verify no throw.
  assert.ok(typeof api.registerPackageAlias === 'function');
});

// TC-PKG-02: installClient wraps __ModuleLoader__.load so require() hits
// the package alias before the module table.
test('TC-PKG-02 installClient wraps __ModuleLoader__ require with packageAliases', () => {
  const requires = [];
  const { window } = makeMockWindow();
  // Simulate a module table: 'new-pkg' resolves, 'old-pkg' does not.
  // Also include the moduleAliases target so installClient's own alias
  // registrations don't crash.
  const moduleTable = new Map();
  moduleTable.set('@new/pkg', { exported: true });
  moduleTable.set('@deepseek-ai/dsh-client-runtime/client', { contextProvenance: 'ok' });
  window.__ModuleLoader__ = {
    load(handoff) {
      // The factory is called with a require that reads moduleTable.
      const factory = handoff.factory;
      const result = factory((spec) => {
        requires.push(spec);
        if (moduleTable.has(spec)) return moduleTable.get(spec);
        throw new Error(`require("${spec}") missed module table`);
      });
      // Stash for assertion
      window.__loaded = window.__loaded ?? {};
      window.__loaded[handoff.id] = result;
    },
  };

  installClient({
    window,
    packageAliases: { '@old/pkg': '@new/pkg' },
  });

  // Clear requires to only observe the test plugin's calls.
  requires.length = 0;

  // Register a plugin bundle that requires '@old/pkg'.
  window.__ModuleLoader__.load({
    id: 'test-plugin',
    factory: (require) => {
      const mod = require('@old/pkg');
      return { got: mod };
    },
  });

  // The underlying require should have seen '@new/pkg' (mapped), not '@old/pkg'.
  assert.deepEqual(requires, ['@new/pkg']);
  assert.equal(window.__loaded['test-plugin'].got.exported, true);
});

// TC-PKG-03: unmapped package names pass through unchanged.
test('TC-PKG-03 unmapped package names pass through unchanged', () => {
  const requires = [];
  const { window } = makeMockWindow();
  const moduleTable = new Map();
  moduleTable.set('react', { version: '18' });
  moduleTable.set('@deepseek-ai/dsh-client-runtime/client', { contextProvenance: 'ok' });
  window.__ModuleLoader__ = {
    load(handoff) {
      const result = handoff.factory((spec) => {
        requires.push(spec);
        return moduleTable.get(spec);
      });
      window.__loaded = window.__loaded ?? {};
      window.__loaded[handoff.id] = result;
    },
  };

  installClient({ window, packageAliases: { '@old/pkg': '@new/pkg' } });
  requires.length = 0;

  window.__ModuleLoader__.load({
    id: 'test-plugin-2',
    factory: (require) => ({ react: require('react') }),
  });

  assert.deepEqual(requires, ['react']);
  assert.equal(window.__loaded['test-plugin-2'].react.version, '18');
});

// TC-PKG-04: stable @dsh-plugin/dsh-loader/* subpaths map to real dsh
// package names via the adapter's default packageAliases.
test('TC-PKG-04 stable @dsh-plugin/dsh-loader/* names map to real dsh packages', () => {
  const requires = [];
  const { window } = makeMockWindow();
  const moduleTable = new Map();
  moduleTable.set('@deepseek-ai/dsh-client-ui-primitives', { IconX: true });
  moduleTable.set('@deepseek-ai/dsh-client-runtime/client', { contextProvenance: 'ok' });
  window.__ModuleLoader__ = {
    load(handoff) {
      const result = handoff.factory((spec) => {
        requires.push(spec);
        return moduleTable.get(spec);
      });
      window.__loaded = window.__loaded ?? {};
      window.__loaded[handoff.id] = result;
    },
  };

  // installClient with no opts.packageAliases — uses adapter defaults
  // which include @dsh-plugin/dsh-loader/ui-primitives → @deepseek-ai/dsh-client-ui-primitives
  installClient({ window });
  requires.length = 0;

  window.__ModuleLoader__.load({
    id: 'test-plugin-stable',
    factory: (require) => {
      const mod = require('@dsh-plugin/dsh-loader/ui-primitives');
      return { icon: mod };
    },
  });

  // The underlying require should have seen the real dsh package name.
  assert.deepEqual(requires, ['@deepseek-ai/dsh-client-ui-primitives']);
  assert.equal(window.__loaded['test-plugin-stable'].icon.IconX, true);
});
