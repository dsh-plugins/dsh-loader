// DshLoaderHostAPI construction (design.md §4.1 / §4.4).
//
// `createHostAPI` builds the `ctx.dshLoader` object exposed to other plugins.
// Each capability (settings / web / services) is constructed from the active
// adapter's overrides when present, otherwise from the default stable impl in
// src/services/*.js. The adapter's `apply()` is invoked separately by the
// bundle entry (src/index.js) so service aliases / bridge routes register via
// cordis effects and auto-recycle on fiber unload (design.md §4.4).
import { LOADER_VERSION } from './version.js';
import { createSettingsAPI } from './services/settings.js';
import { createWebAPI } from './services/web.js';
import { createServicesAPI } from './services/services.js';
import { installHostPackageAliases } from './adapters/dsh-1-x.js';

/**
 * @param {{
 *   ctx: object,
 *   dshVersion: string,
 *   factory: { supports: string, name: string, create: Function },
 *   adapter?: object,
 *   exposeAllNamespaces?: boolean,
 *   whitelist?: Set<string>,
 *   hostPackageAliases?: Record<string, string>,
 * }} opts
 */
export function createHostAPI({ ctx, dshVersion, factory, adapter, exposeAllNamespaces = false, whitelist, hostPackageAliases = {} }) {
  const base = {
    version: LOADER_VERSION,
    dshVersion,
    adapterVersion: factory.supports,
  };

  // Adapters may override any capability (design.md §4.4 HostAdapter.{settings,
  // web, services}); otherwise the default stable impl is used.
  const settings = adapter?.settings ?? createSettingsAPI({ ctx, exposeAllNamespaces, whitelist });
  const web = adapter?.web ?? createWebAPI({ ctx });
  const services = adapter?.services ?? createServicesAPI({ ctx });

  // Runtime host package-name alias registration. The adapter's apply()
  // installs the static set at boot; this method lets plugins add more
  // aliases at runtime (e.g. for packages the adapter didn't know about).
  const runtimeHostAliases = new Map(Object.entries(hostPackageAliases));
  const registerPackageAlias = (oldName, newName) => {
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
