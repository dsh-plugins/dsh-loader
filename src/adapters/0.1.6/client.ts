import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.1.6', patch: '0.1.6',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: version => /^0\.1\.6-alpha\.(0|1)(?:\+.*)?$/.test(version) ? 'settings' : 'plugins',
  settingsModel: 'namespaces',
  removedExports: () => ({ llm: ['offloadRequestImagesWithPolicy', 'offloadedImagePrefixCount'] }),
};
