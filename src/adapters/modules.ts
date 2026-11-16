import type { RegistryModules } from '../services/registry.js';
export async function preloadRegistryModules(importModule: (specifier: string) => Promise<unknown> = specifier => import(specifier)): Promise<RegistryModules> {
  const load = async (specifier: string): Promise<Record<string, unknown> | undefined> => {
    try {
      return (await importModule(specifier)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  // The specifiers are held in variables so TypeScript does not try to resolve
  // them at build time: dshloader declares no `@deepseek-ai/*` dependency, and
  // these packages only exist in the dsh runtime that loads the profile.
  const sandboxSpecifier = '@deepseek-ai/dsh-sandbox';
  const permissionPresetsSpecifier = '@deepseek-ai/dsh-permission-presets';
  const settingsSpecifier = '@deepseek-ai/dsh-settings';
  const llmSpecifier = '@deepseek-ai/dsh-llm';
  const toolsSpecifier = '@deepseek-ai/dsh-tools';
  const toolPipelineSpecifier = '@deepseek-ai/dsh-tools/pipeline';
  const timeoutSpecifier = '@deepseek-ai/dsh-timeout';
  const credentialsSpecifier = '@deepseek-ai/dsh-credentials';
  const subagentSpecifier = '@deepseek-ai/dsh-subagent';
  const compactionSpecifier = '@deepseek-ai/dsh-compaction-basic';
  const agentSpecifier = '@deepseek-ai/dsh-agent';
  const agentInstructionsSpecifier = '@deepseek-ai/dsh-agent-instructions';
  const shellSpecifier = '@deepseek-ai/dsh-shell';
  const pwshLocalSpecifier = '@deepseek-ai/dsh-pwsh-local';
  const bashLocalSpecifier = '@deepseek-ai/dsh-bash-local';
  const subprocessSpecifier = '@deepseek-ai/dsh-subprocess';
  const [
    sandbox,
    permissionPresets,
    settings,
    llm,
    tools,
    toolPipeline,
    timeout,
    credentials,
    subagent,
    compaction,
    agent,
    agentInstructions,
    shell,
    pwshLocal,
    bashLocal,
    subprocess,
  ] = await Promise.all([
    load(sandboxSpecifier),
    load(permissionPresetsSpecifier),
    load(settingsSpecifier),
    load(llmSpecifier),
    load(toolsSpecifier),
    load(toolPipelineSpecifier),
    load(timeoutSpecifier),
    load(credentialsSpecifier),
    load(subagentSpecifier),
    load(compactionSpecifier),
    load(agentSpecifier),
    load(agentInstructionsSpecifier),
    load(shellSpecifier),
    load(pwshLocalSpecifier),
    load(bashLocalSpecifier),
    load(subprocessSpecifier),
  ]);
  return {
    agent,
    sandbox: sandbox as RegistryModules['sandbox'],
    permissionPresets: permissionPresets as RegistryModules['permissionPresets'],
    settings: settings as RegistryModules['settings'],
    llm: llm as RegistryModules['llm'],
    tools: tools as RegistryModules['tools'],
    toolPipeline: toolPipeline as RegistryModules['toolPipeline'],
    timeout: timeout as RegistryModules['timeout'],
    credentials: credentials as RegistryModules['credentials'],
    subagent: subagent as RegistryModules['subagent'],
    compaction: compaction as RegistryModules['compaction'],
    agentInstructions: agentInstructions as RegistryModules['agentInstructions'],
    shell: shell as RegistryModules['shell'],
    pwshLocal: pwshLocal as RegistryModules['pwshLocal'],
    bashLocal: bashLocal as RegistryModules['bashLocal'],
    subprocess: subprocess as RegistryModules['subprocess'],
  };
}
