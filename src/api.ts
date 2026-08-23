// DshLoaderHostAPI construction (design.md §4.1 / §4.4).
//
// `createHostAPI` builds the `ctx.dshLoader` object exposed to other plugins.
// Each capability (settings / web / services) is constructed from the active
// adapter's overrides when present, otherwise from the default stable impl in
// src/services/*.ts. The adapter's `apply()` is invoked separately by the
// bundle entry (src/index.ts) so service aliases / bridge routes register via
// cordis effects and auto-recycle on fiber unload (design.md §4.4).
import { LOADER_VERSION } from './version.js';
import { createSettingsAPI } from './services/settings.js';
import { createWebAPI } from './services/web.js';
import { createServicesAPI } from './services/services.js';
import { createRegistryAPI, type RegistryAPI, type RegistryModules } from './services/registry.js';
import { createLlmAPI, type LlmAPI } from './services/llm.js';
import { createDshSymbolsAPI, type DshSymbolsAPI } from './services/dsh-symbols.js';
import { createPatchAPI, type PatchAPI } from './patch.js';
import { installHostPackageAliases } from './adapters/dsh-1-x.js';
import type {
  CordisContext,
  AdapterFactory,
  HostAdapter,
  HostAPI,
  SettingsAPI,
  WebAPI,
  ServicesAPI,
} from './types.js';

/**
 * @param opts
 */
export function createHostAPI(opts: {
  ctx: CordisContext;
  dshVersion: string;
  factory: AdapterFactory;
  adapter?: HostAdapter;
  exposeAllNamespaces?: boolean;
  whitelist?: Set<string>;
  hostPackageAliases?: Record<string, string>;
  registryModules?: RegistryModules;
}): HostAPI {
  const {
    ctx,
    dshVersion,
    factory,
    adapter,
    exposeAllNamespaces = false,
    whitelist,
    hostPackageAliases = {},
    registryModules,
  } = opts;

  const base = {
    version: LOADER_VERSION,
    dshVersion,
    adapterVersion: factory.supports,
  };

  // Adapters may override any capability (design.md §4.4 HostAdapter.{settings,
  // web, services}); otherwise the default stable impl is used.
  const settings: SettingsAPI =
    adapter?.settings ??
    createSettingsAPI({ ctx, exposeAllNamespaces, whitelist, module: registryModules?.settings });
  const web: WebAPI = adapter?.web ?? createWebAPI({ ctx });
  const services: ServicesAPI = adapter?.services ?? createServicesAPI({ ctx });
  // `patch` is environment-agnostic and version-independent (the protocol never
  // touches dsh shapes), so no adapter override seam is needed. `registry` DOES
  // name private dsh shapes, so adapters may replace it wholesale.
  const patch: PatchAPI = createPatchAPI();
  const registry: RegistryAPI =
    (adapter?.registry as RegistryAPI | undefined) ?? createRegistryAPI({ ctx, modules: registryModules });
  const llm: LlmAPI = createLlmAPI({ module: registryModules?.llm });
  const dsh: DshSymbolsAPI = createDshSymbolsAPI({ modules: registryModules });

  // Runtime host package-name alias registration. The adapter's apply()
  // installs the static set at boot; this method lets plugins add more
  // aliases at runtime (e.g. for packages the adapter didn't know about).
  const runtimeHostAliases = new Map(Object.entries(hostPackageAliases));
  const registerPackageAlias = (oldName: string, newName: string): void => {
    runtimeHostAliases.set(oldName, newName);
    // Re-install the hook with the updated map.
    installHostPackageAliases(Object.fromEntries(runtimeHostAliases));
  };

  return {
    ...base,
    settings,
    web,
    services,
    patch,
    registry,
    llm,
    dsh,
    registerPackageAlias,
  };
}
