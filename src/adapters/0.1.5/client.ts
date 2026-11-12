import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import { SHELL_LOCAL_PACKAGES } from '../metadata.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.1.5', patch: '0.1.5',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: () => 'settings',
  settingsModel: 'namespaces',
  removedExports: () => ({}),
  shell: { localPackage: { ...SHELL_LOCAL_PACKAGES }, seam: 'run-start' },
};
