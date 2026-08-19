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
}): HostAPI {
  const {
    ctx,
    dshVersion,
    factory,
    adapter,
    exposeAllNamespaces = false,
    whitelist,
    hostPackageAliases = {},
  } = opts;

  const base = {
    version: LOADER_VERSION,
    dshVersion,
    adapterVersion: factory.supports,
  };

  // Adapters may override any capability (design.md §4.4 HostAdapter.{settings,
  // web, services}); otherwise the default stable impl is used.
  const settings: SettingsAPI =
    adapter?.settings ?? createSettingsAPI({ ctx, exposeAllNamespaces, whitelist });
  const web: WebAPI = adapter?.web ?? createWebAPI({ ctx });
  const services: ServicesAPI = adapter?.services ?? createServicesAPI({ ctx });

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
    registerPackageAlias,
  };
}
