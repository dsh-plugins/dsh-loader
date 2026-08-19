// Web server stable API (design.md §3.3.2 / §4.1).
//
// Routes every registration through the real `webServer` (or `httpServer`
// alias) `register({ kind, ... })` call shape used by dsh 1.x, mirroring
// dsh-upstream-fixes/lib/index.js `registerRoutes`. Each method returns a
// dispose function that removes the registration when the underlying
// service supports it.
import { LOG_PREFIX } from '../version.js';

export class DshLoaderWebError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DshLoaderWebError';
  }
}

/** Resolve the active web server service (webServer preferred, httpServer alias next). */
function resolveWebServer(ctx) {
  return ctx.get('webServer') ?? ctx.get('httpServer');
}

/**
 * Build the `ctx.dshLoader.web` stable API.
 * @param {{ ctx: object }} opts
 */
export function createWebAPI({ ctx }) {
  function server() {
    const web = resolveWebServer(ctx);
    if (web === undefined || typeof web.register !== 'function') {
      throw new DshLoaderWebError(
        `${LOG_PREFIX}:web webServer service unavailable`,
      );
    }
    return web;
  }

  return {
    register(prefix, handler) {
      const web = server();
      return web.register({ kind: 'prefix', path: prefix, handler }) ?? (() => {});
    },
    get(path, handler) {
      const web = server();
      return web.register({ kind: 'route', method: 'GET', path, handler }) ?? (() => {});
    },
    post(path, handler) {
      const web = server();
      return web.register({ kind: 'route', method: 'POST', path, handler }) ?? (() => {});
    },
    use(middleware) {
      const web = server();
      return web.register({ kind: 'middleware', handler: middleware }) ?? (() => {});
    },
    /**
     * Register a WebSocket upgrade route for an exact pathname.
     * Proxies to `webServer.registerUpgrade({ path, handler })`.
     *
     * @param {{ path: string, handler: (req: any, socket: any, head: Buffer) => void }} route
     * @returns {() => void} dispose function that removes the upgrade route
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
