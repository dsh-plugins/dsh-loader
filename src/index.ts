// dshloader host bundle entry (design.md §7.3 / §4.4).
//
// Exports the cordis function-plugin shape (`name`, `inject`, `apply`) and
// wires the adapter registry → version detection → stable API onto
// `ctx.dshLoader`. Service aliases / bridge routes register through
// ctx.reflect.provide / ctx.effect so cordis auto-recycles them on fiber
// unload — no manual dispose is required for v1's covered capabilities.
import { LOADER_VERSION, LOG_PREFIX } from './version.js';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AdapterRegistry, detectDshVersion, UnsupportedDshVersionError } from './registry.js';
import { registerHostAdapters } from './adapters/index.js';
import { createHostAPI } from './api.js';
import { preloadRegistryModules } from './services/registry.js';
import type { CordisContext, AdapterFactory, HostAdapterConfig } from './types.js';

export const name = '@dsh-plugin/dsh-loader';
// dshloader itself depends on `webServer` so its fiber only activates once
// the real web server is provided — the alias then points `httpServer` at it.
export const inject = ['webServer'];

interface LoaderConfig {
  exposeAllNamespaces: boolean;
  hostPackageAliases?: Record<string, string>;
}

/**
 * Read the profile-level dshloader config (exposeAllNamespaces etc.).
 * Sources, in priority order:
 *   1. process.env.DSHLOADER_EXPOSE_ALL_SETTINGS=1
 *   2. profile package.json `dsh.dshloader.exposeAllNamespaces`
 *   3. profile package.json `dshLoader.settings.exposeAllNamespaces`
 */
export function readLoaderConfig(opts: { profileDir?: string } = {}): LoaderConfig {
  const envOn = process.env.DSHLOADER_EXPOSE_ALL_SETTINGS === '1' || process.env.DSHLOADER_EXPOSE_ALL_SETTINGS === 'true';
  let pkgOn = false;
  try {
    // Best-effort: read the profile manifest if reachable via cwd.
    const dir = opts.profileDir ?? join(process.env.DSH_HOME ?? '', 'profiles', 'web');
    const manifest = JSON.parse(readFileSync(join(resolve(dir), 'package.json'), 'utf8')) as {
      dsh?: { dshloader?: { exposeAllNamespaces?: boolean } };
      dshLoader?: { settings?: { exposeAllNamespaces?: boolean } };
    };
    pkgOn = Boolean(
      manifest.dsh?.dshloader?.exposeAllNamespaces ??
        manifest.dshLoader?.settings?.exposeAllNamespaces,
    );
  } catch {
    /* ignore */
  }
  return { exposeAllNamespaces: envOn || pkgOn };
}

interface AdapterSelectionResult {
  registry: AdapterRegistry;
  factory: AdapterFactory;
  mode: 'exact' | 'range' | 'fallback';
  dshVersion: string;
}

/**
 * Build the registry + select an adapter for the current dsh version, without
 * touching the cordis context. Exported for tests and the `info` CLI command.
 */
export function selectAdapter(opts: {
  dshVersion?: string;
  registry?: AdapterRegistry;
} = {}): AdapterSelectionResult {
  const reg = opts.registry ?? registerHostAdapters(new AdapterRegistry());
  const version = opts.dshVersion ?? detectDshVersion();
  if (version === undefined) {
    throw new UnsupportedDshVersionError(
      `${LOG_PREFIX} could not detect dsh version; set DSHLOADER_DSH_VERSION or install @deepseek-ai/dsh`,
      { kind: 'too-new' },
    );
  }
  const { factory, mode } = reg.select(version);
  return { registry: reg, factory, mode, dshVersion: version };
}

/**
 * Apply the selected adapter onto a cordis context and expose the stable API.
 * @param ctx cordis context
 * @returns
 */
export async function applyAdapter(
  ctx: CordisContext,
  opts: { dshVersion?: string; config?: LoaderConfig; registry?: AdapterRegistry } = {},
): Promise<{ api: ReturnType<typeof createHostAPI>; factory: AdapterFactory; mode: string; dshVersion: string }> {
  const config = opts.config ?? readLoaderConfig();
  const selection = selectAdapter({ dshVersion: opts.dshVersion, registry: opts.registry });
  const { factory, mode, dshVersion } = selection;

  const adapter = factory.create(ctx, config as HostAdapterConfig);
  await adapter.apply?.();

  // Optional dsh modules the registry facade proxies (sandbox escalation
  // targets, permission-preset folding). Absent modules degrade that facade
  // method to a logged no-op — see services/registry.ts.
  const registryModules = await preloadRegistryModules();

  const api = createHostAPI({
    ctx,
    dshVersion,
    factory,
    adapter,
    exposeAllNamespaces: config.exposeAllNamespaces,
    hostPackageAliases: config.hostPackageAliases,
    registryModules,
  });
  ctx.reflect.provide('dshLoader', api);

  console.log(`${LOG_PREFIX} loaded adapter ${factory.name} for dsh ${dshVersion} (mode: ${mode})`);
  console.log(`${LOG_PREFIX} registered stable API: settings, web, services, patch, registry, llm`);
  if (config.exposeAllNamespaces) {
    console.warn(
      `${LOG_PREFIX} exposeAllNamespaces enabled: bypassing official settings whitelist`,
    );
  }

  return { api, factory, mode, dshVersion };
}

/** cordis function-plugin entry point. */
export async function apply(ctx: CordisContext): Promise<void> {
  if (process.env.DSHLOADER_DISABLE === '1' || process.env.DSHLOADER_DISABLE === 'true') {
    console.log(`${LOG_PREFIX} disabled by env, skipping`);
    return;
  }
  await applyAdapter(ctx);
}

export { LOADER_VERSION };
