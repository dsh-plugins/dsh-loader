// dsh 1.x host adapter (design.md §7.4 / §5.1 / §3.3.1).
//
// Absorbs the verified repairs from dsh-upstream-fixes:
//   - httpServer -> webServer single-hop service alias (fix 2).
//   - settings namespace whitelist bypass bridge, gated behind
//     `exposeAllNamespaces` (fix 5). Two independent paths:
//       * host side: ctx.dshLoader.settings.* (handled by services/settings.js
//         + the bridge routes registered here for the browser fetch path).
//       * client side: fetch interceptor in src/client.js.
//   - package-name aliasing for host-side CJS require (createRequire /
//     require()) — intercepts Module._resolveFilename so a renamed dsh
//     package resolves to its new name without plugin rebuilds.
//
// All registrations go through ctx.reflect.provide / ctx.effect so cordis
// auto-recycles them when the dshloader fiber unloads (design.md §4.4). No
// custom dispose() is needed for v1's covered capabilities.
import { LOG_PREFIX } from '../version.js';
import { toNamespaceView, settingsErrorToResult } from '../services/settings.js';

// Covers the real dsh release line (0.1.0-rc.x, verified against
// dsh-upstream-fixes) and the anticipated 1.x line. The adapter name keeps
// the design-doc label "dsh-1-x"; the behavior is identical across both
// ranges since dsh-upstream-fixes confirms httpServer->webServer + settings
// bridge work the same way on 0.1.0-rc.7.
export const supports = '>=0.1.0-rc.1 <2.0.0';
export const name = 'dsh-1-x';

// Browser-facing bridge prefix; the client fetch interceptor (src/client.js)
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
export const hostPackageAliases = {
  '@dsh-external/dshloader/tools': '@deepseek-ai/dsh-tools',
  '@dsh-external/dshloader/llm': '@deepseek-ai/dsh-llm',
  '@dsh-external/dshloader/agent': '@deepseek-ai/dsh-agent',
  '@dsh-external/dshloader/settings': '@deepseek-ai/dsh-settings',
};

/**
 * Install a Module._resolveFilename hook that maps old package names to
 * new ones for CJS require() calls. Returns a dispose function that
 * removes the hook.
 */
export async function installHostPackageAliases(aliases) {
  const entries = Object.entries(aliases);
  if (entries.length === 0) return () => {};
  const aliasMap = new Map(entries);
  // Lazy-import Module to avoid loading it in browser/test contexts.
  let Module;
  try {
    const mod = await import('node:module');
    Module = mod.default ?? mod.Module ?? mod;
  } catch {
    return () => {};
  }
  if (!Module || typeof Module._resolveFilename !== 'function') return () => {};
  const original = Module._resolveFilename;
  const hooked = function dshloaderResolve(request, parent, ...rest) {
    const mapped = aliasMap.get(request);
    if (mapped !== undefined) return original.call(this, mapped, parent, ...rest);
    return original.call(this, request, parent, ...rest);
  };
  Module._resolveFilename = hooked;
  return () => {
    if (Module._resolveFilename === hooked) Module._resolveFilename = original;
  };
}

/**
 * @param {object} ctx cordis context
 * @param {{ exposeAllNamespaces?: boolean, hostPackageAliases?: Record<string,string> }} [config]
 */
export function create(ctx, config = {}) {
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

/**
 * Register host bridge routes that the client fetch interceptor forwards
 * non-whitelisted settings requests to. Mirrors dsh-upstream-fixes/lib/index.js
 * `registerRoutes` (settings section).
 */
function registerSettingsBridgeRoutes(ctx) {
  const webServer = ctx.get('webServer') ?? ctx.get('httpServer');
  if (webServer === undefined || typeof webServer.register !== 'function') return () => {};
  return webServer.register({
    kind: 'prefix',
    path: BRIDGE_PREFIX,
    handler: (req, res) => {
      const json = (status, body) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body));
      };
      const readBody = () =>
        new Promise((done, fail) => {
          let body = '';
          req.on?.('data', (chunk) => {
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
            let parsed = {};
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

async function runSettingsWrite(settings, mode, ns, section, expectedRevision) {
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
    .find((d) => String(d.ns) === String(ns));
  if (descriptor === undefined) {
    return { ok: false, code: 'internal', message: 'settings namespace disposed after write', details: { ns } };
  }
  return { ok: true, value: toNamespaceView(descriptor) };
}
