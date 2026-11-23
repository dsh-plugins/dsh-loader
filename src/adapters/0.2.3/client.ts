import { clientModuleAliases, clientPackageAliases } from '../tables.js';
import { SHELL_LOCAL_PACKAGES } from '../metadata.js';
import type { PatchMetadata } from '../metadata.js';
export const client: PatchMetadata = {
  id: 'dsh-0.2.3', patch: '0.2.3',
  moduleAliases: { ...clientModuleAliases }, packageAliases: { ...clientPackageAliases },
  configUI: () => 'plugins',
  settingsModel: 'forms',
  auth: 'native-route',
  removedExports: () => ({
    settings: ['SettingsProvider'],
    llm: ['offloadRequestImagesWithPolicy', 'offloadedImagePrefixCount', 'assertUsableApiKey', 'normalizeApiKey'],
    subagent: ['resolveChildCwd', 'settleRun', 'validateConfiguredCwd'],
    tools: ['CodeRunFailedError', 'TOOL_RUNTIME_SCHEDULER', 'defineContentToolFixture', 'jsonSchemaToPy', 'jsonSchemaToTs', 'renderToolsSdk', 'renderToolsSdkPy'],
  }),
  shell: { localPackage: { ...SHELL_LOCAL_PACKAGES }, seam: 'execute' },
};
