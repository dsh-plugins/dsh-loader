import type { RegistryModules } from '../services/registry.js';
export async function preloadRegistryModules(importModule: (specifier: string) => Promise<unknown> = specifier => import(specifier)): Promise<RegistryModules> {
  const load = async (specifier: string): Promise<Record<string, unknown> | undefined> => {
    try {
      return (await importModule(specifier)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  const [sandbox, permissionPresets, settings, llm, tools, timeout, credentials, subagent, compaction, agent] =
    await Promise.all([
      load('@deepseek-ai/dsh-sandbox'),
      load('@deepseek-ai/dsh-permission-presets'),
      load('@deepseek-ai/dsh-settings'),
      load('@deepseek-ai/dsh-llm'),
      load('@deepseek-ai/dsh-tools'),
      load('@deepseek-ai/dsh-timeout'),
      load('@deepseek-ai/dsh-credentials'),
      load('@deepseek-ai/dsh-subagent'),
      load('@deepseek-ai/dsh-compaction-basic'),
      load('@deepseek-ai/dsh-agent'),
    ]);
  return {
    agent,
    sandbox: sandbox as RegistryModules['sandbox'],
    permissionPresets: permissionPresets as RegistryModules['permissionPresets'],
    settings: settings as RegistryModules['settings'],
    llm: llm as RegistryModules['llm'],
    tools: tools as RegistryModules['tools'],
    timeout: timeout as RegistryModules['timeout'],
    credentials: credentials as RegistryModules['credentials'],
    subagent: subagent as RegistryModules['subagent'],
    compaction: compaction as RegistryModules['compaction'],
  };
}
