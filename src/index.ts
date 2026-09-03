// dshloader host bundle entry (design.md §7.3 / §4.4).
//
// Exports the cordis function-plugin shape (`name`, `inject`, `apply`) and
// wires the adapter registry → version detection → stable API onto
// `ctx.dshLoader`. Service aliases / bridge routes register through
// ctx.reflect.provide / ctx.effect so cordis auto-recycles them on fiber
// unload — no manual dispose is required for v1's covered capabilities.
import { LOADER_VERSION, LOG_PREFIX } from './version.js';
import { readFileSync, realpathSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/** The npm package name profiles depend on (used by profile detection). */
const LOADER_PACKAGE = '@dsh-plugin/dsh-loader';

/**
 * Locate the profile directory this loader instance is mounted into.
 *
 * Strategy, in order:
 *   1. Self-location: under pnpm the entry's realpath resolves inside
 *      `<profileDir>/node_modules/...`, so walk up for an ancestor
 *      `node_modules` whose parent manifest declares `dsh.profile`.
 *   2. Dependency scan (covers `link:` installs whose realpath escapes the
 *      profile): the profile manifests under `$DSH_HOME/profiles` that depend
 *      on this package. Unambiguous only when exactly one matches — with
 *      several, per-profile manifest config stays unread rather than reading
 *      the wrong profile (env and cordis entry config still apply).
 *
 * @returns the absolute profile directory, or undefined when undetectable.
 */
export function detectProfileDir(opts: { moduleUrl?: string; dshHome?: string } = {}): string | undefined {
  try {
    let dir = dirname(realpathSync(fileURLToPath(opts.moduleUrl ?? import.meta.url)));
    for (let depth = 0; depth < 16; depth++) {
      if (basename(dir) === 'node_modules') {
        const parent = dirname(dir);
        try {
          const manifest = JSON.parse(readFileSync(join(parent, 'package.json'), 'utf8')) as {
            dsh?: { profile?: unknown };
          };
          if (manifest?.dsh?.profile !== undefined) return parent;
        } catch {
          /* keep walking */
        }
      }
      const next = dirname(dir);
      if (next === dir) break;
      dir = next;
    }
  } catch {
    /* fall through to the dependency scan */
  }

  const home = opts.dshHome ?? process.env.DSH_HOME;
  if (home === undefined || home.trim() === '') return undefined;
  try {
    const profilesDir = join(resolve(home), 'profiles');
    const matches = readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .filter((entry) => {
        try {
          const manifest = JSON.parse(readFileSync(join(profilesDir, entry.name, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, unknown>;
            devDependencies?: Record<string, unknown>;
          };
          const deps = { ...manifest.dependencies, ...manifest.devDependencies };
          return Object.keys(deps).includes(LOADER_PACKAGE);
        } catch {
          return false;
        }
      });
    if (matches.length === 1) return join(profilesDir, matches[0]!.name);
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Read the profile-level dshloader config (exposeAllNamespaces etc.).
 * Sources, in priority order (first true wins):
 *   1. process.env.DSHLOADER_EXPOSE_ALL_SETTINGS=1
 *   2. cordis entry config (`- id: dsh-loader` row's `config:`) — per-profile
 *      by construction, the officially sanctioned channel
 *   3. the ACTIVE profile's package.json `dsh.dshloader.exposeAllNamespaces`
 *      (or legacy `dshLoader.settings.exposeAllNamespaces`), located via
 *      {@link detectProfileDir} — never a hardcoded profile name
 */
export function readLoaderConfig(opts: { profileDir?: string; config?: Partial<LoaderConfig> } = {}): LoaderConfig {
  const envOn = process.env.DSHLOADER_EXPOSE_ALL_SETTINGS === '1' || process.env.DSHLOADER_EXPOSE_ALL_SETTINGS === 'true';
  const entryOn = Boolean(opts.config?.exposeAllNamespaces);
  let pkgOn = false;
  const dir = opts.profileDir ?? detectProfileDir();
  if (dir !== undefined) {
    try {
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
  } else if (!envOn && !entryOn) {
    console.warn(
      `${LOG_PREFIX} could not locate the active profile directory; profile package.json config is unread. ` +
        `Set DSHLOADER_EXPOSE_ALL_SETTINGS=1 or the cordis entry config (config: { exposeAllNamespaces: true }) instead.`,
    );
  }
  return {
    exposeAllNamespaces: envOn || entryOn || pkgOn,
    hostPackageAliases: opts.config?.hostPackageAliases,
  };
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
export async function apply(ctx: CordisContext, entryConfig?: Partial<LoaderConfig>): Promise<void> {
  if (process.env.DSHLOADER_DISABLE === '1' || process.env.DSHLOADER_DISABLE === 'true') {
    console.log(`${LOG_PREFIX} disabled by env, skipping`);
    return;
  }
  // Merge the cordis entry row's `config:` with env/profile-manifest sources —
  // the entry config is per-profile by construction, so it outranks the
  // best-effort located profile manifest.
  await applyAdapter(ctx, { config: readLoaderConfig({ config: entryConfig }) });
}

export { LOADER_VERSION };
