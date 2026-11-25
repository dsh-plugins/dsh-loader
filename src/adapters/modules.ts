import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RegistryModules } from '../services/registry.js';

const typertSpecifier = '@deepseek-ai/dsh-typert-protocol';

/** 从 CLI 的实际安装解析 Typert，避免 profile 中的副本使用另一套 Cordis。 */
function hostTypertUrl(version: string | undefined): URL | undefined {
  if (!version || !process.argv[1]) return;
  try {
    const manifest = join(dirname(dirname(realpathSync(process.argv[1]))), 'package.json');
    const installed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string; version?: string };
    if (installed.name !== '@deepseek-ai/dsh' || installed.version !== version) return;
    return pathToFileURL(createRequire(manifest).resolve(typertSpecifier));
  } catch {
    return undefined;
  }
}

export async function preloadRegistryModules(
  importModule: (specifier: string) => Promise<unknown> = specifier => import(specifier),
  version?: string,
): Promise<RegistryModules> {
  const load = async (specifier: string, loadModule = importModule): Promise<Record<string, unknown> | undefined> => {
    try {
      return (await loadModule(specifier)) as Record<string, unknown>;
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
  const typertUrl = hostTypertUrl(version);
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
    typert,
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
    typertUrl ? load(typertUrl.href, specifier => import(specifier)) : load(typertSpecifier),
  ]);
  return {
    agent,
    sandbox: sandbox as RegistryModules['sandbox'],
    permissionPresets: permissionPresets as RegistryModules['permissionPresets'],
    settings: settings as RegistryModules['settings'],
    llm: llm as RegistryModules['llm'],
    tools: tools as RegistryModules['tools'],
    typert: typert as RegistryModules['typert'],
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
