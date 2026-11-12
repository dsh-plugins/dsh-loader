import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import { SHELL_LOCAL_PACKAGES } from '../metadata.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.1.7', patch: '0.1.7',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: () => 'plugins',
  settingsModel: 'forms',
  removedExports: () => ({ llm: ['offloadRequestImagesWithPolicy', 'offloadedImagePrefixCount'], settings: ['SettingsProvider'] }),
  shell: { localPackage: { ...SHELL_LOCAL_PACKAGES }, seam: 'execute' },
};
