// dshloader client bundle entry (design.md §3.5 / §4.3 / §7.3).
//
// Loaded in the `immediately` prefetch tier (package.json `dsh.client`).
// Responsibilities:
//   1. Mount `window.__dshLoader__` with `require` / `registerModuleAlias` /
//      `rpc.settings.*`.
//   2. Register module-alias factories via `window.__ModuleLoader__.load` so
//      deep source imports (fix 1) and stable module names resolve to the
//      public runtime client entry.
//   3. When `exposeAllNamespaces` is on, install a fetch interceptor that
//      merges non-whitelisted namespaces into `/api/settings.describe` and
//      routes non-whitelisted writes through the host bridge, echoing the
//      request `rpcId` in the `{ type: 'server-response', rpcId, result }`
//      envelope (fix 5, path 2 — mirrors dsh-upstream-fixes/lib/client.js).
//
// The module exports an `installClient` function for testability and runs an
// IIFE at the bottom for the real browser bundle.
import { LOADER_VERSION, LOG_PREFIX, BOOT_ALIAS_IDS_FLAG } from './version.js';
import { clientAdapters } from './adapters/index.js';
import { BRIDGE_PREFIX } from './adapters/dsh-1-x.js';

/** Browser-only globals dshloader relies on (typed loosely so the module compiles without DOM lib). */
type FetchImpl = (input: any, init?: any) => Promise<{ clone(): { json(): any }; json(): any }>;
interface DshLoaderWindowLike {
  fetch: FetchImpl;
  location?: { origin?: string };
  Response?: new (body?: string, init?: { status?: number; headers?: Record<string, string> }) => any;
  __ModuleLoader__?: {
    load(handoff: { id: string; factory: (require: (spec: string) => any) => any }): unknown;
  };
  __DSHLOADER_VERSION__?: string;
  __DSHLOADER_CONFIG__?: { exposeAllNamespaces?: boolean };
  __dshNativeRequire__?: (spec: string) => any;
  __dshLoader__?: unknown;
  /** Alias ids the boot injection (src/boot-injection.ts) already registered. */
  [BOOT_ALIAS_IDS_FLAG]?: string[];
}

declare global {
  // Intentionally NOT declaring `window` here: this module must compile in BOTH
  // programs — the Node build (tsconfig.build.json → dist/client.js, which the
  // client tests import) with no DOM lib, and the browser program that also
  // compiles the React UI modules WITH lib.dom. Declaring `window` would
  // collide with lib.dom's own declaration in the latter, so the ambient window
  // is read through `globalThis` by {@link ambientWindow} instead.
}

/** The client module-system surface legacy plugins read off `window.__DSH_MODULES__`. */
interface DshModulesLike {
  import(specifier: string): Promise<unknown>;
}

/**
 * Compatibility shim: mount `window.__DSH_MODULES__` for plugins that read the
 * client module system off the global.
 *
 * dsh ≤ 0.1.0-rc.7 set `globalThis.__DSH_MODULES__ = <ClientModuleSystem>`
 * during web boot; 0.1.0-rc.8+ stopped exposing it globally and instead hands
 * the same instance to the cordis client loader as `ctx.loader.internal`.
 * Plugins built against the old global (e.g. dsh-better-sidebar's lazy chunks)
 * break with "client module system unavailable" on the new versions. dshloader
 * bridges the gap so those plugins need no change across every dsh version:
 * when the global is missing but the cordis loader carries the module system,
 * mirror it back onto the global.
 *
 * Returns true when the global is present after this call (either it already
 * was, or we just mirrored it).
 */
export function ensureDshModulesGlobal(
  win: DshLoaderWindowLike,
  ctx: { loader?: { internal?: DshModulesLike } } | undefined,
): boolean {
  const scope = globalThis as { __DSH_MODULES__?: DshModulesLike };
  if (scope.__DSH_MODULES__ !== undefined) return true;
  const internal = ctx?.loader?.internal;
  if (internal !== undefined && typeof internal.import === 'function') {
    scope.__DSH_MODULES__ = internal;
    return true;
  }
  return false;
}

/**
 * The ambient browser `window`, when this module runs in a browser-like realm.
 * Read off `globalThis` so no DOM lib and no global declaration is required.
 */
function ambientWindow(): DshLoaderWindowLike | undefined {
  const scope = globalThis as { window?: unknown };
  const found = scope.window;
  return typeof found === 'object' && found !== null ? (found as DshLoaderWindowLike) : undefined;
}

export class ModuleNotFoundError extends Error {
  specifier: string;

  constructor(specifier: string) {
    super(`${LOG_PREFIX} module not found: ${specifier}`);
    this.name = 'ModuleNotFoundError';
    this.specifier = specifier;
  }
}

interface ClientAdapter {
  supports: string;
  name: string;
  moduleAliases?: Record<string, string>;
  packageAliases?: Record<string, string>;
}

/**
 * Pick the client adapter for the given dsh version. v1 ships a single
 * client adapter (dsh 1.x); when more are added, swap this for a semver-based
 * selection mirroring the host AdapterRegistry.
 */
function pickClientAdapter(dshVersion?: string): ClientAdapter {
  return clientAdapters[0];
}

interface CreateClientAPIOpts {
  dshVersion?: string;
  adapterVersion?: string;
  moduleAliases?: Record<string, string>;
  packageAliases?: Map<string, string> | Record<string, string>;
  requireImpl?: (spec: string) => any;
  fetchBridge?: {
    describe: () => Promise<any>;
    write: (mode: string, payload: object) => Promise<any>;
  };
  clientCtx?: { get?: (name: string) => any };
}

/**
 * Build the `window.__dshLoader__` API object.
 */
export function createClientAPI(opts: CreateClientAPIOpts = {}) {
  const aliases = new Map(Object.entries(opts.moduleAliases ?? {}));
  const requireImpl = opts.requireImpl ?? ((spec: string) => {
    throw new ModuleNotFoundError(spec);
  });
  const clientCtx = opts.clientCtx;
  // Reuse the Map from installClient when provided so registerPackageAlias
  // mutations are visible to the __ModuleLoader__ wrapper. Otherwise create
  // a fresh Map from a plain object.
  const packageAliases = opts.packageAliases instanceof Map
    ? opts.packageAliases
    : new Map(Object.entries(opts.packageAliases ?? {}));

  const api = {
    version: LOADER_VERSION,
    dshVersion: opts.dshVersion,
    adapterVersion: opts.adapterVersion,

    require(specifier: string) {
      if (typeof specifier !== 'string') throw new ModuleNotFoundError(String(specifier));
      const target = aliases.get(specifier);
      if (target === undefined) {
        throw new ModuleNotFoundError(specifier);
      }
      return requireImpl(target);
    },

    registerModuleAlias(alias: string, target: string) {
      aliases.set(alias, target);
    },

    /**
     * Register a package-name alias for the client module loader's
     * require(). When a plugin's bundle calls require('@old/pkg-name'),
     * the loader's wrapped require remaps it to '@new/pkg-name' before
     * hitting the module table. This lets dsh rename client packages
     * across versions without forcing plugin bundles to rebuild.
     */
    registerPackageAlias(oldName: string, newName: string) {
      packageAliases.set(oldName, newName);
    },

    /**
     * Read a client-side cordis service by name.
     * Proxies to `clientCtx.get(name)` — the same ctx.get plugins use
     * inside their client `apply(ctx)`, but exposed through the stable
     * dshloader surface so plugins don't depend on the cordis context
     * shape directly.
     *
     * Only available when dshloader's client apply() received a ctx
     * (cordis client boot). Returns undefined when ctx is not wired.
     */
    services: {
      get(name: string) {
        if (clientCtx === undefined || typeof clientCtx.get !== 'function') return undefined;
        return clientCtx.get(name);
      },
    },

    rpc: opts.fetchBridge
      ? {
          settings: {
            describe: () => opts.fetchBridge!.describe(),
            update: (ns: string, section: unknown) => opts.fetchBridge!.write('update', { ns, section }),
            replace: (ns: string, section: unknown) => opts.fetchBridge!.write('replace', { ns, section }),
            mutate: (ns: string, ops: unknown) => opts.fetchBridge!.write('mutate', { ns, ops }),
          },
        }
      : undefined,
  };

  return api;
}

interface InstallClientOpts {
  window?: DshLoaderWindowLike;
  dshVersion?: string;
  exposeAllNamespaces?: boolean;
  requireImpl?: (spec: string) => any;
  hostBridgePrefix?: string;
  packageAliases?: Record<string, string>;
  clientCtx?: { get?: (name: string) => any };
}

/**
 * Install dshloader into a browser-like environment.
 */
export function installClient(opts: InstallClientOpts = {}) {
  const win = opts.window ?? ambientWindow();
  if (win === undefined) return undefined;

  const dshVersion = opts.dshVersion ?? win.__DSHLOADER_VERSION__;
  const adapter = pickClientAdapter(dshVersion);
  const moduleAliases = { ...(adapter.moduleAliases ?? {}) };
  // Merge adapter-declared package aliases with any passed via opts (opts
  // win on conflict, so tests / runtime can override adapter defaults).
  const packageAliases = new Map(Object.entries(adapter.packageAliases ?? {}));
  if (opts.packageAliases) {
    for (const [k, v] of Object.entries(opts.packageAliases)) packageAliases.set(k, v);
  }

  // fetch bridge (only meaningful when exposeAllNamespaces is on).
  const exposeAllNamespaces = Boolean(
    opts.exposeAllNamespaces ?? win.__DSHLOADER_CONFIG__?.exposeAllNamespaces,
  );
  const bridgePrefix = opts.hostBridgePrefix ?? BRIDGE_PREFIX;

  const fetchBridge = exposeAllNamespaces
    ? {
        describe: () =>
          win.fetch(`${bridgePrefix}/settings/describe`, { headers: { accept: 'application/json' } }).then((r) => r.json()),
        write: (mode: string, payload: object) =>
          win.fetch(`${bridgePrefix}/settings/${mode}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }).then((r) => r.json()),
      }
    : undefined;

  const api = createClientAPI({
    dshVersion,
    adapterVersion: adapter.supports,
    moduleAliases,
    packageAliases,
    requireImpl: opts.requireImpl ?? ((spec) => win.__dshNativeRequire__?.(spec)),
    fetchBridge,
    clientCtx: opts.clientCtx,
  });
  win.__dshLoader__ = api;

  // Wrap __ModuleLoader__.load so every factory's require() function
  // applies package-name aliases before hitting the module table. This
  // must happen BEFORE registering module-alias factories below, because
  // those factories also receive the wrapped require.
  const loader = win.__ModuleLoader__;
  if (loader && typeof loader.load === 'function') {
    const originalLoad = loader.load.bind(loader);
    loader.load = function dshloaderLoad(handoff: { id: string; factory: (require: (spec: string) => any) => any }) {
      const wrappedFactory = (require: (spec: string) => any) => {
        const aliasedRequire = (spec: string) => {
          const mapped = packageAliases.get(spec);
          return require(mapped ?? spec);
        };
        return handoff.factory(aliasedRequire);
      };
      return originalLoad({ id: handoff.id, factory: wrappedFactory });
    };
  }

  // Register module-alias factories with the client module loader (fix 1).
  // Skip ids the boot-alias injection already registered: the live module
  // system throws on a duplicate factory id, and the injected factories are
  // registered before any entry materializes regardless of activation order.
  const bootAliased = new Set(
    Array.isArray(win[BOOT_ALIAS_IDS_FLAG]) ? win[BOOT_ALIAS_IDS_FLAG] : [],
  );
  if (loader && typeof loader.load === 'function') {
    for (const [aliasId, target] of Object.entries(moduleAliases)) {
      if (bootAliased.has(aliasId)) continue;
      loader.load({
        id: aliasId,
        factory: (require: (spec: string) => any) => {
          const mod = require(target);
          // Preserve the deep import's expected named export shape.
          if (aliasId.endsWith('context-provenance.ts') || aliasId.endsWith('context-provenance')) {
            return { contextProvenance: mod.contextProvenance };
          }
          return mod;
        },
      });
    }
  }

  if (exposeAllNamespaces) {
    installSettingsFetchInterceptor(win, bridgePrefix);
    console.warn(`${LOG_PREFIX} exposeAllNamespaces enabled: bypassing official settings whitelist`);
  }

  return api;
}

/**
 * Fetch interceptor for settings namespace whitelist bypass (fix 5, path 2).
 * Mirrors dsh-upstream-fixes/lib/client.js (127-223).
 *
 * - /api/settings.describe: merge non-whitelisted namespaces from the host
 *   bridge into the official response (rpcId/official fields preserved).
 * - /api/settings.{update,mutate,replace}: route writes for namespaces the
 *   official proxy does NOT expose through the host bridge, and rebuild the
 *   response envelope as `{ type: 'server-response', rpcId, result }` so the
 *   official client can correlate the response with the request.
 */
export function installSettingsFetchInterceptor(
  win: DshLoaderWindowLike,
  bridgePrefix = BRIDGE_PREFIX,
): () => void {
  if (typeof win.fetch !== 'function') return () => {};
  const originalFetch = win.fetch;
  /** Namespaces the official proxy itself exposed (learned from describe). */
  const officialExposed = new Set<string>();

  win.fetch = async function dshloaderFetch(this: unknown, input: any, init?: any) {
    let pathname = '';
    try {
      const urlLike = typeof input === 'string' ? input : (input as { url?: string }).url;
      pathname = new URL(urlLike as string, win.location?.origin ?? 'http://localhost').pathname;
    } catch {
      pathname = String(input).split('?')[0];
    }
    const method = (init?.method ?? 'GET').toUpperCase();

    // describe: merge bridge namespaces into the official response.
    if (pathname === '/api/settings.describe') {
      const response = await originalFetch.call(this, input, init);
      try {
        const body = await response.clone().json();
        const namespaces = body?.result?.value?.namespaces;
        if (!Array.isArray(namespaces)) return response;
        for (const row of namespaces) {
          if (typeof row?.ns === 'string') officialExposed.add(row.ns);
        }
        const extra = await originalFetch.call(this, `${bridgePrefix}/settings/describe`, {
          headers: { accept: 'application/json' },
        });
        const extraBody = await extra.json();
        if (extraBody?.ok !== true || !Array.isArray(extraBody.namespaces)) return response;
        const seen = new Set(namespaces.map((row: { ns: string }) => row.ns));
        const merged = [...namespaces, ...extraBody.namespaces.filter((row: { ns: string }) => !seen.has(row.ns))];
        const ResponseCtor = win.Response!;
        return new ResponseCtor(
          JSON.stringify({ ...body, result: { ...body.result, value: { ...body.result.value, namespaces: merged } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      } catch {
        return response;
      }
    }

    // writes: route non-whitelisted namespaces through the bridge, echo rpcId.
    if (
      (pathname === '/api/settings.update' || pathname === '/api/settings.mutate' || pathname === '/api/settings.replace') &&
      method === 'POST'
    ) {
      let rpcId: unknown = null;
      let payload: { ns?: string; [k: string]: unknown } | null = null;
      try {
        const parsed = JSON.parse(String(init?.body ?? '{}'));
        rpcId = parsed.rpcId;
        payload = parsed.payload;
      } catch {
        /* fall through to the original endpoint */
      }
      const ns = typeof payload?.ns === 'string' ? payload.ns : '';
      if (rpcId !== null && ns !== '' && officialExposed.size > 0 && !officialExposed.has(ns)) {
        try {
          const mode = pathname.slice('/api/settings.'.length);
          const res = await originalFetch.call(this, `${bridgePrefix}/settings/${mode}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const body = await res.json();
          if (body?.result) {
            const ResponseCtor = win.Response!;
            return new ResponseCtor(
              JSON.stringify({ type: 'server-response', rpcId, result: body.result }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
        } catch {
          /* fall back to the original endpoint */
        }
      }
    }

    return originalFetch.call(this, input, init);
  };

  return () => {
    win.fetch = originalFetch;
  };
}

// ── cordis client-plugin entry ─────────────────────────────────────────
// dsh's client boot applies every registered bundle as a cordis plugin:
// the module must expose `apply` (third-party plugins / dsh-client-runtime
// all do `exports.apply = apply`). Without it the client boot fails with
// "invalid plugin, expect function or object with an \"apply\" method".
// `installClient` mounts window.__dshLoader__, registers module aliases,
// wires the client cordis ctx for `services.get`, and (when opted in)
// installs the settings fetch interceptor. The __DSH_MODULES__ shim keeps
// legacy global readers working on dsh 0.1.0-rc.8+ (see ensureDshModulesGlobal).
export const name = '@dsh-plugin/dsh-loader'
export const inject: string[] = []
export function apply(ctx: { get?: (name: string) => any; loader?: { internal?: DshModulesLike } }) {
  const win = ambientWindow();
  if (win === undefined) return;
  ensureDshModulesGlobal(win, ctx);
  installClient({ window: win, clientCtx: ctx });
}
