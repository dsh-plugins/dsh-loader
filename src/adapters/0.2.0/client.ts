import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.2.0', patch: '0.2.0',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: () => 'plugins',
  settingsModel: 'forms',
  removedExports: () => ({ llm: ['offloadRequestImagesWithPolicy', 'offloadedImagePrefixCount'], settings: ['SettingsProvider'] }),
};
