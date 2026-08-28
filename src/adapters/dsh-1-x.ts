// dsh 1.x host adapter (design.md §7.4 / §5.1 / §3.3.1).
//
// Absorbs the verified repairs from dsh-upstream-fixes:
//   - httpServer -> webServer single-hop service alias (fix 2).
//   - settings namespace whitelist bypass bridge, gated behind
//     `exposeAllNamespaces` (fix 5). Two independent paths:
//       * host side: ctx.dshLoader.settings.* (handled by services/settings.ts
//         + the bridge routes registered here for the browser fetch path).
//       * client side: fetch interceptor in src/client.ts.
//   - package-name aliasing for host-side CJS require (createRequire /
//     require()) — intercepts Module._resolveFilename so a renamed dsh
//     package resolves to its new name without plugin rebuilds.
//
// All registrations go through ctx.reflect.provide / ctx.effect so cordis
// auto-recycles them when the dshloader fiber unloads (design.md §4.4). No
// custom dispose() is needed for v1's covered capabilities.
import { LOG_PREFIX } from '../version.js';
import { installBootAliasInjection } from '../boot-injection.js';
import { toNamespaceView, settingsErrorToResult } from '../services/settings.js';
import type { CordisContext, AdapterFactory as Factory, HostAdapterConfig } from '../types.js';

// Covers the real dsh release line (0.1.0-rc.x, verified against
// dsh-upstream-fixes) and the anticipated 1.x line. The adapter name keeps
// the design-doc label "dsh-1-x"; the behavior is identical across both
// ranges since dsh-upstream-fixes confirms httpServer->webServer + settings
// bridge work the same way on 0.1.0-rc.7.
//
// Pre-release builds of covered lines (e.g. `0.1.1-rc.1`, `0.1.1-rc.2`) do
// not satisfy this range under npm semver's pre-release rules even though
// the release line is covered; the AdapterRegistry's rule 2b strips the
// pre-release tag and re-tests, so dshloader loads on ANY build of the
// 0.1.x/1.x lines.
export const supports = '>=0.1.0-rc.1 <2.0.0';
export const name = 'dsh-1-x';

// Browser-facing bridge prefix; the client fetch interceptor (src/client.ts)
// must use the same prefix.
export const BRIDGE_PREFIX = '/api/dshloader';

// Host-side package-name aliases. Maps stable @dshloader/* names to the
// real dsh package names for this version. Plugins should require() from
// the stable names; the Module._resolveFilename hook maps them to the real
// package. When dsh renames a host package, only this table changes.
//
// This intercepts CJS require() (including createRequire) via
// Module._resolveFilename; ESM static imports are build-time resolved and
// cannot be intercepted at runtime (use pnpm overrides / tsconfig paths
// for those).
export const hostPackageAliases: Record<string, string> = {
  '@dsh-plugin/dsh-loader/tools': '@deepseek-ai/dsh-tools',
  '@dsh-plugin/dsh-loader/llm': '@deepseek-ai/dsh-llm',
  '@dsh-plugin/dsh-loader/agent': '@deepseek-ai/dsh-agent',
  '@dsh-plugin/dsh-loader/settings': '@deepseek-ai/dsh-settings',
  '@dsh-plugin/dsh-loader/timeout': '@deepseek-ai/dsh-timeout',
  '@dsh-plugin/dsh-loader/subagent': '@deepseek-ai/dsh-subagent',
  '@dsh-plugin/dsh-loader/credentials': '@deepseek-ai/dsh-credentials',
  '@dsh-plugin/dsh-loader/compaction-basic': '@deepseek-ai/dsh-compaction-basic',
};

// Client-side deep-import module aliases (registered as module-table alias
// factories): deep source imports that break when dsh ships no `src/`
// (fix 1), plus the stable module name form (design.md §3.3.3).
export const clientModuleAliases: Record<string, string> = {
  '@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts':
    '@deepseek-ai/dsh-client-runtime/client',
  'dsh/runtime/context-provenance': '@deepseek-ai/dsh-client-runtime/client',
};

// Client-side stable package names → real dsh package names for dsh 1.x.
// Plugins import from @dsh-plugin/dsh-loader/* subpaths (e.g.
// '@dsh-plugin/dsh-loader/ui-primitives'); the boot-alias injection
// (src/boot-injection.ts) pre-registers an alias factory per entry before
// any client entry materializes, and the apply-time __ModuleLoader__ load
// wrapper (installClient) covers late arrivals. When dsh renames a package,
// only this table changes — plugin source and bundle stay the same.
//
// The table ALSO accepts old-real-name → new-real-name entries as a
// transition measure for plugin bundles built before adopting stable names.
export const clientPackageAliases: Record<string, string> = {
  // Client UI component libraries
  '@dsh-plugin/dsh-loader/ui-primitives': '@deepseek-ai/dsh-client-ui-primitives',
  '@dsh-plugin/dsh-loader/ui-slots': '@deepseek-ai/dsh-client-ui-slots',
  '@dsh-plugin/dsh-loader/web-react': '@deepseek-ai/dsh-client-web-react',
  '@dsh-plugin/dsh-loader/schema-form': '@deepseek-ai/dsh-client-schema-form',
  '@dsh-plugin/dsh-loader/ui-settings': '@deepseek-ai/dsh-client-ui-settings/client',
  // Client runtime
  '@dsh-plugin/dsh-loader/runtime': '@deepseek-ai/dsh-client-runtime/client',
};

/** Loosely-typed node:module NodeModule for the _resolveFilename hook. */
interface NodeModuleLike {
  _resolveFilename?: (...args: any[]) => string;
}

/**
 * Install a Module._resolveFilename hook that maps old package names to
 * new ones for CJS require() calls. Returns a dispose function that
 * removes the hook.
 */
export async function installHostPackageAliases(
  aliases: Record<string, string>,
): Promise<() => void> {
  const entries = Object.entries(aliases);
  if (entries.length === 0) return () => {};
  const aliasMap = new Map(entries);
  // Lazy-import Module to avoid loading it in browser/test contexts.
  let Module: NodeModuleLike | undefined;
  try {
    const mod = await import('node:module');
    const nodeModule = mod.default ?? mod.Module ?? mod;
    Module = nodeModule as NodeModuleLike;
  } catch {
    return () => {};
  }
  if (!Module || typeof Module._resolveFilename !== 'function') return () => {};
  const original = Module._resolveFilename;
  const hooked = function dshloaderResolve(this: unknown, request: string, parent: unknown, ...rest: unknown[]) {
    const mapped = aliasMap.get(request);
    if (mapped !== undefined) return original.call(this, mapped, parent, ...rest);
    return original.call(this, request, parent, ...rest);
  };
  Module._resolveFilename = hooked;
  return () => {
    if (Module && Module._resolveFilename === hooked) Module._resolveFilename = original;
  };
}

/**
 * @param ctx cordis context
 * @param config
 */
export function create(ctx: CordisContext, config: HostAdapterConfig = {}): HostAdapterType {
  const exposeAllNamespaces = Boolean(config.exposeAllNamespaces);
  const packageAliases = { ...hostPackageAliases, ...(config.hostPackageAliases ?? {}) };

  async function apply() {
    // --- service alias: httpServer -> webServer (fix 2) ---
    if (ctx.get('httpServer') === undefined) {
      const webServer = ctx.get('webServer');
      if (webServer !== undefined) {
        ctx.reflect.provide('httpServer', webServer);
        console.log(`${LOG_PREFIX} aliased httpServer -> webServer`);
      }
    } else {
      console.log(`${LOG_PREFIX} httpServer already exists, skip alias`);
    }

    // --- host package-name aliases (CJS require interception) ---
    if (Object.keys(packageAliases).length > 0) {
      ctx.effect(
        () => installHostPackageAliases(packageAliases),
        'dshloader: host package-name aliases',
      );
      console.log(`${LOG_PREFIX} installed host package aliases: ${Object.keys(packageAliases).join(', ')}`);
    }

    // --- client boot-alias injection (order-independent alias factories) ---
    // dsh ≥ 0.1.2 imports every client entry concurrently, so a dependent can
    // materialize before dshloader's client apply registers the alias
    // factories. Injecting them into the index page removes the ordering
    // dependency on every covered version.
    const clientAliases = {
      ...clientModuleAliases,
      ...clientPackageAliases,
      ...(config.clientPackageAliases ?? {}),
    };
    ctx.effect(
      () => installBootAliasInjection(ctx, clientAliases),
      'dshloader: client boot-alias injection',
    );

    // --- settings bridge routes for the browser fetch path (fix 5, path 2) ---
    // Only registered when the profile explicitly opts in. The host-side
    // stable API (ctx.dshLoader.settings.*) is unaffected by this gate and
    // always available to host plugin code.
    if (exposeAllNamespaces) {
      ctx.effect(
        () => registerSettingsBridgeRoutes(ctx),
        'dshloader: settings namespace bridge routes',
      );
    }
  }

  function dispose() {
    // No cordis-unaware resources held in v1; effect auto-recycle covers
    // everything registered in apply(). Implemented as a no-op to satisfy
    // the HostAdapter interface and future hot-swap scenarios.
  }

  return { supports, name, apply, dispose };
}

interface HostAdapterType {
  supports: string;
  name: string;
  apply: () => Promise<void>;
  dispose: () => void;
}

/**
 * Register host bridge routes that the client fetch interceptor forwards
 * non-whitelisted settings requests to. Mirrors dsh-upstream-fixes/lib/index.js
 * `registerRoutes` (settings section).
 */
function registerSettingsBridgeRoutes(ctx: CordisContext): () => void {
  const webServer = ctx.get('webServer') ?? ctx.get('httpServer');
  if (webServer === undefined || typeof webServer.register !== 'function') return () => {};
  return webServer.register({
    kind: 'prefix',
    path: BRIDGE_PREFIX,
    handler: (req: any, res: any) => {
      const json = (status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      const readBody = () =>
        new Promise<string>((done, fail) => {
          let body = '';
          req.on?.('data', (chunk: Buffer | string) => {
            body += chunk.toString('utf8');
          });
          req.on?.('end', () => done(body));
          req.on?.('error', fail);
        });
      const url = req.url ?? '/';
      const method = (req.method ?? 'GET').toUpperCase();
      const path = url.split('?')[0] ?? '/';

      void (async () => {
        try {
          // GET /api/dshloader/settings/describe — full redacted namespace list.
          if (method === 'GET' && (path === `${BRIDGE_PREFIX}/settings/describe` || path === `${BRIDGE_PREFIX}/settings/describe/`)) {
            const settings = ctx.get('settings');
            if (settings === undefined) {
              json(200, { ok: false, message: 'settings service unavailable' });
              return;
            }
            json(200, {
              ok: true,
              namespaces: settings.describe({ redactSecrets: true }).map(toNamespaceView),
            });
            return;
          }

          // POST /api/dshloader/settings/{update,mutate,replace} — write seam.
          const writeMatch = /^\/api\/dshloader\/settings\/(update|mutate|replace)$/.exec(path);
          if (method === 'POST' && writeMatch !== null) {
            const mode = writeMatch[1];
            let parsed: { ns?: unknown; section?: unknown; ops?: unknown; expectedRevision?: number } = {};
            try {
              parsed = JSON.parse(await readBody());
            } catch {
              /* keep {} */
            }
            const ns = typeof parsed.ns === 'string' ? parsed.ns : '';
            if (ns.length === 0) {
              json(200, {
                ok: true,
                result: {
                  ok: false,
                  code: 'settings-rejected',
                  message: 'settings write needs a namespace',
                  details: {},
                },
              });
              return;
            }
            const settings = ctx.get('settings');
            const result = await runSettingsWrite(
              settings,
              mode,
              ns,
              mode === 'mutate' ? parsed.ops : parsed.section,
              parsed.expectedRevision,
            );
            json(200, { ok: true, result });
            return;
          }

          json(404, { ok: false, message: 'not found' });
        } catch (error) {
          json(500, { ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      })();
    },
  });
}

async function runSettingsWrite(
  settings: any,
  mode: string,
  ns: string,
  section: unknown,
  expectedRevision?: number,
) {
  if (settings === undefined) {
    return { ok: false, code: 'internal', message: 'settings service unavailable', details: {} };
  }
  try {
    if (mode === 'update') await settings.update(ns, section, expectedRevision);
    else if (mode === 'replace') await settings.replace(ns, section, expectedRevision);
    else await settings.mutate(ns, section, expectedRevision);
  } catch (error) {
    return settingsErrorToResult(error, ns, mode);
  }
  const descriptor = settings
    .describe({ redactSecrets: true })
    .find((d: { ns: unknown }) => String(d.ns) === String(ns));
  if (descriptor === undefined) {
    return { ok: false, code: 'internal', message: 'settings namespace disposed after write', details: { ns } };
  }
  return { ok: true, value: toNamespaceView(descriptor) };
}
