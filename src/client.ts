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
import { clientAdapters } from './adapters/client.js';
import { AliasTable, ResourceScope, type ResourceOwner } from './lifecycle.js';
import { patchSlot, type PatchHandle } from './patch.js';
import { validateBoot, type BootDescriptor } from './bootstrap.js';
import { installSettingsFetchInterceptor } from './adapters/client-settings-bridge.js';
export { installSettingsFetchInterceptor } from './adapters/client-settings-bridge.js';

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
  __DSHLOADER_BOOT__?: BootDescriptor;
  __DSHLOADER_ALIAS_MAP__?: Map<string, string>;
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

interface CreateClientAPIOpts {
  dshVersion?: string;
  adapterVersion?: string;
  moduleAliases?: Record<string, string>;
  aliasTable?: AliasTable;
  resources?: ResourceScope;
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
  const moduleTable = opts.aliasTable ?? new AliasTable();
  if (!opts.aliasTable) moduleTable.register(opts.moduleAliases ?? {});
  const aliases = moduleTable.values;
  const requireImpl = opts.requireImpl ?? ((spec: string) => {
    throw new ModuleNotFoundError(spec);
  });
  const clientCtx = opts.clientCtx;
  // Reuse the Map from installClient when provided so registerPackageAlias
  // mutations are visible to the __ModuleLoader__ wrapper. Otherwise create
  // a fresh Map from a plain object.
  const packageTable = opts.aliasTable ?? new AliasTable();
  if (!opts.aliasTable) packageTable.register(Object.fromEntries(opts.packageAliases instanceof Map
    ? opts.packageAliases : Object.entries(opts.packageAliases ?? {})));

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

    registerModuleAlias(alias: string, target: string, owner?: ResourceOwner) {
      const release = moduleTable.register({ [alias]: target });
      const off = opts.resources?.add(release) ?? release;
      owner?.effect(() => off);
      return off;
    },

    /**
     * Register a package-name alias for the client module loader's
     * require(). When a plugin's bundle calls require('@old/pkg-name'),
     * the loader's wrapped require remaps it to '@new/pkg-name' before
     * hitting the module table. This lets dsh rename client packages
     * across versions without forcing plugin bundles to rebuild.
     */
    registerPackageAlias(oldName: string, newName: string, owner?: ResourceOwner) {
      const release = packageTable.register({ [oldName]: newName });
      const off = opts.resources?.add(release) ?? release;
      owner?.effect(() => off);
      return off;
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
  boot?: BootDescriptor;
  window?: DshLoaderWindowLike;
  dshVersion?: string;
  exposeAllNamespaces?: boolean;
  requireImpl?: (spec: string) => any;
  hostBridgePrefix?: string;
  packageAliases?: Record<string, string>;
  clientCtx?: { get?: (name: string) => any };
  /**
   * cordis effect hook (`ctx.effect`): the load wrapper and fetch
   * interceptor register their disposers through it so fiber unload / HMR
   * tears the patches down instead of leaking them. Absent in bare test
   * environments, where patches simply live for the process.
   */
  effect?: (fn: () => (() => void) | void) => unknown;
}

const CLIENT_STATE_KEY = Symbol.for('dshloader.client.v2');
interface ClientState {
  aliases: AliasTable;
  factories: Set<string>;
  refs: number;
  load?: PatchHandle;
  fetch?: () => void;
  apis: Set<ReturnType<typeof createClientAPI>>;
}
/** The host selects the adapter; every install shares one alias table. */
export function installClient(opts: InstallClientOpts = {}) {
  const win = opts.window ?? ambientWindow();
  if (!win) return undefined;
  const boot = validateBoot(opts.boot ?? win.__DSHLOADER_BOOT__);
  const adapter = clientAdapters.find(entry => entry.id === boot.adapterId)!;
  const holder = win as DshLoaderWindowLike & { [CLIENT_STATE_KEY]?: ClientState };
  const state = holder[CLIENT_STATE_KEY] ??= { aliases: new AliasTable(), factories: new Set(win[BOOT_ALIAS_IDS_FLAG] ?? []), refs: 0, apis: new Set() };
  const resources = new ResourceScope();
  opts.effect?.(() => resources.dispose);
  state.refs++;
  resources.add(() => {
    if (--state.refs === 0) { state.load?.dispose(); state.fetch?.(); state.fetch = undefined; }
  });
  try {
    resources.add(state.aliases.register({ ...adapter.moduleAliases, ...adapter.packageAliases, ...boot.aliases, ...opts.packageAliases }));
    win.__DSHLOADER_ALIAS_MAP__ = state.aliases.values;
    const loader = win.__ModuleLoader__;
    if (!loader || typeof loader.load !== 'function') throw new Error('dshloader: module loader unavailable');
    if (!state.load?.active) {
      state.load = patchSlot<typeof loader.load>(loader, 'load', original => function(handoff) {
        return original.call(loader, { ...handoff, factory: require => handoff.factory(spec => require(state.aliases.values.get(spec) ?? spec)) });
      }, { id: 'dshloader:module-load' });
    }
    const expose = boot.exposeAllNamespaces;
    const bridgePrefix = boot.bridgePrefix;
    const fetchBridge = expose ? {
      describe: () => win.fetch(`${bridgePrefix}/settings/describe`, { headers: { accept: 'application/json' } }).then(r => r.json()),
      write: (mode: string, payload: object) => win.fetch(`${bridgePrefix}/settings/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    } : undefined;
    const api = createClientAPI({
      dshVersion: boot.dshVersion, adapterVersion: adapter.patch, aliasTable: state.aliases, resources,
      packageAliases: state.aliases.values, requireImpl: opts.requireImpl ?? (spec => win.__dshNativeRequire__?.(spec)),
      fetchBridge, clientCtx: opts.clientCtx,
    });
    state.apis.add(api);
    win.__dshLoader__ = api;
    resources.add(() => {
      state.apis.delete(api);
      if (win.__dshLoader__ === api) win.__dshLoader__ = [...state.apis].at(-1);
    });
    for (const aliasId of state.aliases.values.keys()) {
      if (state.factories.has(aliasId)) continue;
      loader.load({ id: aliasId, factory: require => {
        const target = state.aliases.values.get(aliasId);
        if (!target) throw new ModuleNotFoundError(aliasId);
        const mod = require(target);
        return aliasId.endsWith('context-provenance.ts') || aliasId.endsWith('context-provenance') ? { contextProvenance: mod.contextProvenance } : mod;
      } });
      state.factories.add(aliasId);
    }
    if (expose && !state.fetch) state.fetch = installSettingsFetchInterceptor(win, bridgePrefix);
    return Object.assign(api, { boot, dispose: resources.dispose });
  } catch (error) { resources.dispose(); throw error; }
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
export function apply(ctx: {
  get?: (name: string) => any;
  loader?: { internal?: DshModulesLike };
  effect?: (fn: () => (() => void) | void) => unknown;
}) {
  const win = ambientWindow();
  if (win === undefined) return;
  ensureDshModulesGlobal(win, ctx);
  installClient({ window: win, clientCtx: ctx, effect: ctx.effect?.bind(ctx) as InstallClientOpts['effect'] });
}
