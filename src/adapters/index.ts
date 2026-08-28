// Adapter registration (design.md §7.4). Imports every host adapter and
// registers it on the provided AdapterRegistry. Kept as a function so tests
// can build a fresh registry per case.
import * as dsh1x from './dsh-1-x.js';
import type { AdapterFactory } from '../types.js';
import type { AdapterRegistry } from '../registry.js';

/** All host adapter factories, in registration order. */
export const hostAdapters: AdapterFactory[] = [
  { supports: dsh1x.supports, name: dsh1x.name, create: dsh1x.create },
];

/** Register every built-in host adapter onto a registry. */
export function registerHostAdapters(registry: AdapterRegistry): AdapterRegistry {
  for (const factory of hostAdapters) registry.register(factory);
  return registry;
}

// Client adapter metadata for dsh 1.x (consumed by src/client.ts).
//
// packageAliases serves TWO roles:
//   1. **Stable name → real name** (primary): plugins import from stable
//      names like '@dshloader/ui-primitives' and the adapter maps them to
//      the real dsh package name for this version. When dsh renames a
//      package, only the adapter changes — plugin source and bundle stay
//      the same.
//   2. **Old real name → new real name** (fallback): if a plugin bundle
//      was built before adopting stable names and still has
//      `require('@deepseek-ai/dsh-client-ui-primitives')` baked in, the
//      adapter can map the old real name to the new real name as a
//      transition measure.
export const clientAdapters = [
  {
    supports: dsh1x.supports,
    name: dsh1x.name,
    // Alias tables live on the dsh-1-x adapter module (consumed there by the
    // host-side boot-alias injection) so host and client share one source of
    // truth without a module cycle.
    moduleAliases: dsh1x.clientModuleAliases,
    packageAliases: dsh1x.clientPackageAliases,
  },
];
