// Shared host mechanisms; only the six patch entry points are registered.
import { LOG_PREFIX } from '../version.js';
import { installBootAliasInjection } from '../boot-injection.js';
import { toNamespaceView, settingsErrorToResult } from '../services/settings.js';
import type { CordisContext, AdapterFactory as Factory, HostAdapterConfig } from '../types.js';

export const supports = '0.1.5';
export const name = 'dsh-0.1.5';

// Browser-facing bridge prefix; the client fetch interceptor (src/client.ts)
// must use the same prefix.
export const BRIDGE_PREFIX = '/api/dshloader';

export { hostPackageAliases, clientModuleAliases, clientPackageAliases } from './tables.js';
import { hostPackageAliases, clientModuleAliases, clientPackageAliases } from './tables.js';
export { installHostPackageAliases } from '../host-aliases.js';
import { installHostPackageAliases } from '../host-aliases.js';
import { ownedScope } from '../lifecycle.js';
/**
 * @param ctx cordis context
 * @param config
 */
export function create(ctx: CordisContext, config: HostAdapterConfig = {}): HostAdapterType {
  const exposeAllNamespaces = Boolean(config.exposeAllNamespaces);
  const packageAliases = { ...(config.hostPackageAliases ?? {}) };

  const resources = ownedScope(ctx);
  async function apply() {
    try {
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
      resources.add(await installHostPackageAliases(packageAliases));
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
    resources.add(installBootAliasInjection(ctx, clientAliases, config.boot ? { ...config.boot, aliases: clientAliases } : undefined));

    // --- Session.events accessor polyfill (dsh ≥ 0.1.2-alpha.2) ---
    resources.add(installSessionEventsAccessor(ctx));

    // --- settings bridge routes for the browser fetch path (fix 5, path 2) ---
    // Only registered when the profile explicitly opts in. The host-side
    // stable API (ctx.dshLoader.settings.*) is unaffected by this gate and
    // always available to host plugin code.
    if (exposeAllNamespaces) {
      resources.add(registerSettingsBridgeRoutes(ctx));
    }
    } catch (error) { resources.dispose(); throw error; }
  }

  const dispose = resources.dispose;

  return { supports, name, apply, dispose };
}

interface HostAdapterType {
  supports: string;
  name: string;
  apply: () => Promise<void>;
  dispose: () => void;
}

/**
 * Restore the pre-0.1.2 `Session.events` read-only accessor.
 *
 * dsh-session 0.1.2（随 dsh 0.1.2-alpha.2 起捆绑进 meta 包）把 `Session` 的
 * `events` 只读访问器换成了 `snapshotEvents(fromSeq?, toSeqExclusive?)` 方法
 * （无参全量调用复用宿主自身的缓存快照，语义与旧访问器一致）。直接迭代
 * `session.events` 的旧插件（dsh-code-review 等）会在 `agent/created` 同步
 * 监听器里抛 `session.events is not iterable`，被创建路径包装后整个
 * session/create 失败。
 *
 * 这里按特性探测在 Session 原型上补回访问器（委托 snapshotEvents()）：
 * 访问器已存在（旧版 dsh）或 snapshotEvents 缺失（更远的未来版本）时都不
 * 安装。已存活会话立即补齐（live reload 场景）；之后创建的会话经
 * `session/created` 钩子补齐——创建流程中 session/created 先于
 * agent/created 派发（agent-loop 的 enter → sessions.announce →
 * agents.announce），因此 agent/created 监听器读到的是旧契约。
 *
 * 返回的 disposer 摘除监听器并移除我们安装的访问器（identity 校验，
 * 不碰他人后来覆盖的实现）。
 */
export function installSessionEventsAccessor(ctx: CordisContext): () => void {
  /** Our getter, identity-checked on dispose. */
  const eventsGetter = function events(this: { snapshotEvents(): unknown }): unknown {
    return this.snapshotEvents();
  };
  /** Prototypes we patched (normally one; a dual-instance runtime may show two). */
  const patched = new Set<object>();

  const ensure = (session: unknown): void => {
    if (session === null || typeof session !== 'object') return;
    const proto = Object.getPrototypeOf(session) as object | null;
    if (proto === null || patched.has(proto)) return;
    // 旧版自带访问器——不动。
    if (Object.getOwnPropertyDescriptor(proto, 'events') !== undefined) return;
    // 没有委托目标——保持原状，让旧插件响亮失败而不是静默拿到空数组。
    if (typeof (session as { snapshotEvents?: unknown }).snapshotEvents !== 'function') return;
    Object.defineProperty(proto, 'events', {
      configurable: true,
      enumerable: false,
      get: eventsGetter,
    });
    patched.add(proto);
    console.log(`${LOG_PREFIX} polyfilled Session.events accessor via snapshotEvents() (dsh-session 0.1.2+)`);
  };

  // 已存活会话（live patch reload 时插件重挂但会话不重建）。
  const store = ctx.get('sessions') as { list?: () => unknown } | undefined;
  const live = store?.list?.();
  if (Array.isArray(live)) for (const session of live) ensure(session);

  const disposeListener = typeof ctx.on === 'function'
    ? ctx.on('session/created', ensure, { global: true })
    : undefined;

  return () => {
    if (typeof disposeListener === 'function') disposeListener();
    for (const proto of patched) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'events');
      if (descriptor?.get === eventsGetter) {
        delete (proto as Record<string, unknown>).events;
      }
    }
    patched.clear();
  };
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
