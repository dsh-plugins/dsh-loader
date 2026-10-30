import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.2.1', patch: '0.2.1',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: () => 'plugins',
  settingsModel: 'forms',
  removedExports: version => ({ settings: ['SettingsProvider'], llm: ['offloadRequestImagesWithPolicy', 'offloadedImagePrefixCount'], subagent: /-alpha\.1(?:\+.*)?$/.test(version) ? [] : ['resolveChildCwd', 'settleRun', 'validateConfiguredCwd'] }),
};
