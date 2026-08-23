// Web server stable API (design.md §3.3.2 / §4.1).
//
// Routes every registration through the real `webServer` (or `httpServer`
// alias) `register({ kind, ... })` call shape used by dsh 1.x, mirroring
// dsh-upstream-fixes/lib/index.js `registerRoutes`. Each method returns a
// dispose function that removes the registration when the underlying
// service supports it.
import { LOG_PREFIX } from '../version.js';
import type { CordisContext, WebAPI } from '../types.js';

export class DshLoaderWebError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DshLoaderWebError';
  }
}

/** Resolve the active web server service (webServer preferred, httpServer alias next). */
function resolveWebServer(ctx: CordisContext) {
  return ctx.get('webServer') ?? ctx.get('httpServer');
}

/**
 * Build the `ctx.dshLoader.web` stable API.
 */
export function createWebAPI(opts: { ctx: CordisContext }): WebAPI {
  const { ctx } = opts;

  function server() {
    const web = resolveWebServer(ctx);
    if (web === undefined || typeof web.register !== 'function') {
      throw new DshLoaderWebError(`${LOG_PREFIX}:web webServer service unavailable`);
    }
    return web;
  }

  /** One `kind: 'route'` registration for a single HTTP method. */
  function route(method: string, path: string, handler: unknown): () => void {
    const web = server();
    return web.register({ kind: 'route', method, path, handler }) ?? (() => {});
  }

  return {
    register(prefix, handler) {
      const web = server();
      return web.register({ kind: 'prefix', path: prefix, handler }) ?? (() => {});
    },
    exact(path, handler) {
      const web = server();
      return web.register({ kind: 'exact', path, handler }) ?? (() => {});
    },
    get(path, handler) {
      return route('GET', path, handler);
    },
    post(path, handler) {
      return route('POST', path, handler);
    },
    put(path, handler) {
      return route('PUT', path, handler);
    },
    patch(path, handler) {
      return route('PATCH', path, handler);
    },
    del(path, handler) {
      return route('DELETE', path, handler);
    },
    use(middleware) {
      const web = server();
      return web.register({ kind: 'middleware', handler: middleware }) ?? (() => {});
    },
    /**
     * Register a WebSocket upgrade route for an exact pathname.
     * Proxies to `webServer.registerUpgrade({ path, handler })`.
     *
     * @returns dispose function that removes the upgrade route
     */
    registerUpgrade(route) {
      const web = server();
      if (typeof web.registerUpgrade !== 'function') {
        throw new DshLoaderWebError(
          `${LOG_PREFIX}:web.registerUpgrade webServer does not support upgrade routes (registerUpgrade missing)`,
        );
      }
      return web.registerUpgrade(route) ?? (() => {});
    },
  };
}
