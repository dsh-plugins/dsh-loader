import { clientAdapters } from './adapters/client.js';
import { nearestLowerPatch, patchFamily } from './adapters/patch-fallback.js';
import { LOADER_VERSION } from './version.js';
export const BRIDGE_PREFIX = '/api/dshloader';
export interface BootDescriptor {
  protocolVersion: 2;
  loaderVersion: string;
  dshVersion: string;
  adapterId: string;
  exposeAllNamespaces: boolean;
  bridgePrefix: string;
  aliases: Record<string, string>;
  capabilities: { config: true; configUI: 'settings' | 'plugins' };
}
export function createBootDescriptor(dshVersion: string, adapterId: string, exposeAllNamespaces = false): BootDescriptor {
  const family = patchFamily(dshVersion);
  const adapter = clientAdapters.find(entry => entry.patch === family)
    ?? nearestLowerPatch(dshVersion, clientAdapters, entry => entry.patch);
  if (!adapter || adapter.id !== adapterId) throw new Error(`Unsupported adapter ${adapterId} for dsh ${dshVersion}`);

  return {
    protocolVersion: 2, loaderVersion: LOADER_VERSION, dshVersion, adapterId, exposeAllNamespaces,
    bridgePrefix: BRIDGE_PREFIX, aliases: { ...adapter.moduleAliases, ...adapter.packageAliases },
    capabilities: { config: true, configUI: adapter.configUI(dshVersion) },
  };
}
export function validateBoot(value: unknown): BootDescriptor {
  const boot = value as BootDescriptor | undefined;
  if (!boot || boot.protocolVersion !== 2 || boot.loaderVersion !== LOADER_VERSION) throw new Error('dshloader: missing or incompatible host boot descriptor; reload the page');
  if (typeof boot.dshVersion !== 'string' || typeof boot.adapterId !== 'string' || typeof boot.exposeAllNamespaces !== 'boolean' || !boot.aliases || typeof boot.aliases !== 'object' || Array.isArray(boot.aliases) || Object.values(boot.aliases).some(value => typeof value !== 'string')) throw new Error('dshloader: malformed host boot descriptor');
  const expected = createBootDescriptor(boot.dshVersion, boot.adapterId, boot.exposeAllNamespaces);
  if (boot.capabilities?.config !== true || boot.capabilities.configUI !== expected.capabilities.configUI || boot.bridgePrefix !== BRIDGE_PREFIX) throw new Error('dshloader: invalid host capabilities');
  return boot;
}
