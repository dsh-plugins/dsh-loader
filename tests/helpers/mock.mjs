// Shared test helpers (test-plan.md §3.3.2 / §3.3.3).
//
// The mock cordis context MUST keep `ctx.get(name)` and direct property access
// (`ctx.webServer`) backed by the same `services` Map, otherwise alias tests
// can pass while masking a "direct property path not synced" defect.
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

/**
 * Build a mock cordis context with a shared services Map.
 *
 * @param {{ services?: Map, aliases?: string[], withPropertyGetters?: string[] }} [opts]
 * @returns {{ ctx: object, services: Map, effects: Array<{fn: Function, label: string, dispose?: Function}>, registerService: (name:string, value:any)=>void }}
 */
export function makeMockCtx(opts = {}) {
  const services = opts.services ?? new Map();
  const effects = [];

  const ctx = {
    get: (name) => services.get(name),
    reflect: {
      provide: (name, value) => {
        services.set(name, value);
      },
    },
    effect: (fn, label) => {
      const entry = { fn, label };
      effects.push(entry);
      // cordis effects return a dispose function; mimic by recording one.
      if (typeof fn === 'function') {
        const maybeDispose = fn();
        if (typeof maybeDispose === 'function') entry.dispose = maybeDispose;
      }
      return () => {
        entry.dispose?.();
      };
    },
    on: () => () => {},
  };

  // Direct property access for known service keys reads the same Map.
  // By default, expose getters for the keys used across the test plan; tests
  // can add more via `withPropertyGetters`.
  const keys = new Set([
    'webServer',
    'httpServer',
    'settings',
    'dshLoader',
    ...(opts.withPropertyGetters ?? []),
  ]);
  for (const key of keys) {
    Object.defineProperty(ctx, key, {
      get: () => services.get(key),
      enumerable: true,
      configurable: true,
    });
  }

  const registerService = (name, value) => services.set(name, value);

  return { ctx, services, effects, registerService };
}

/** Build a mock settings service with describe/update/replace/mutate. */
export function makeMockSettings({ namespaces = [], writesThrow } = {}) {
  const store = new Map(namespaces.map((n) => [String(n.ns), n]));
  let nextRevision = namespaces.reduce((acc, n) => Math.max(acc, n.revision ?? 0), 0);
  return {
    describe({ redactSecrets } = {}) {
      return Array.from(store.values()).map((n) => ({
        ...n,
        revision: n.revision ?? 0,
        secrets: (n.secrets ?? []).map((s) => ({ path: [...s.path], set: s.set })),
      }));
    },
    async update(ns, section, expectedRevision) {
      if (writesThrow) throw writesThrow;
      const cur = store.get(String(ns));
      nextRevision += 1;
      const revision = nextRevision;
      store.set(String(ns), { ...cur, ns: String(ns), value: section, revision });
      return { ok: true, value: store.get(String(ns)) };
    },
    async replace(ns, section, expectedRevision) {
      if (writesThrow) throw writesThrow;
      nextRevision += 1;
      const revision = nextRevision;
      store.set(String(ns), { ns: String(ns), value: section, revision });
      return { ok: true, value: store.get(String(ns)) };
    },
    async mutate(ns, ops, expectedRevision) {
      if (writesThrow) throw writesThrow;
      const cur = store.get(String(ns)) ?? { ns: String(ns), value: {} };
      nextRevision += 1;
      const revision = nextRevision;
      store.set(String(ns), { ...cur, value: { ...cur.value, ...ops }, revision });
      return { ok: true, value: store.get(String(ns)) };
    },
  };
}

/** Build a mock webServer that records register() calls. */
export function makeMockWebServer() {
  const registrations = [];
  const webServer = {
    register(route) {
      registrations.push(route);
      const disposed = { disposed: false };
      return () => {
        disposed.disposed = true;
        const idx = registrations.indexOf(route);
        if (idx >= 0) registrations.splice(idx, 1);
      };
    },
  };
  return { webServer, registrations };
}

/** Build a mock window + __ModuleLoader__ for client tests (§3.3.3). */
export function makeMockWindow({ fetchImpl } = {}) {
  const moduleRegistry = new Map();
  const window = {
    __ModuleLoader__: {
      registry: moduleRegistry,
      load(entry) {
        moduleRegistry.set(entry.id, entry.factory);
      },
    },
    fetch: fetchImpl ?? (async () => new Response(JSON.stringify({ ok: true }))),
    location: { origin: 'http://localhost:8080' },
    document: { head: { appendChild: () => {} }, querySelector: () => null, createElement: () => ({}) },
    Response,
  };
  return { window, moduleRegistry };
}

/** Create a temp profile dir layout (§3.2) and return cleanup + paths. */
export function makeTempProfile({ dshVersion, manifest } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dshloader-test-'));
  const home = join(root, 'home');
  const profileDir = join(home, 'profiles', 'web');
  mkdirSync(profileDir, { recursive: true });
  const dshDir = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh');
  mkdirSync(dshDir, { recursive: true });
  writeFileSync(
    join(dshDir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version: dshVersion ?? '1.2.3' }),
  );
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify(
      manifest ?? {
        name: '@dsh/profile-web-test',
        version: '1.0.0',
        dependencies: { '@dsh-external/dshloader': 'file:../../..' },
      },
      undefined,
      2,
    ),
  );
  writeFileSync(join(profileDir, 'cordis.patch.yml'), "- insert:\n    - id: dshloader\n      name: '@dsh-external/dshloader'\n");
  return {
    root,
    home,
    profileDir,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
