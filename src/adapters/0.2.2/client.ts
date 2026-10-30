import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.2.2', patch: '0.2.2',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: () => 'plugins',
  settingsModel: 'forms',
  removedExports: version => ({ settings: ['SettingsProvider'], llm: ['offloadRequestImagesWithPolicy', 'offloadedImagePrefixCount'], subagent: ['resolveChildCwd', 'settleRun', 'validateConfiguredCwd'], tools: /-alpha\.1(?:\+.*)?$/.test(version) ? [] : ['CodeRunFailedError', 'TOOL_RUNTIME_SCHEDULER', 'defineContentToolFixture', 'jsonSchemaToPy', 'jsonSchemaToTs', 'renderToolsSdk', 'renderToolsSdkPy'] }),
};
