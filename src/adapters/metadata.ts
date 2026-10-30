/** Browser-safe metadata: each patch owns its own selection and breakpoints. */
export interface PatchMetadata {
  id: string;
  patch: string;
  moduleAliases: Record<string, string>;
  packageAliases: Record<string, string>;
  configUI(version: string): 'settings' | 'plugins';
  settingsModel: 'namespaces' | 'forms';
  removedExports(version: string): Record<string, string[]>;
}
