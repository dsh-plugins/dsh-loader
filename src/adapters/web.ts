import type { CordisContext } from '../types.js';
import { createWebAPI } from '../services/web.js';
import { ownedScope, type ResourceScope } from '../lifecycle.js';
import { patchSlot } from '../patch.js';

/** Native supported hosts have exact/prefix routes, not method-scoped routes. */
export function createAdaptedWebAPI(ctx: CordisContext, resources: ResourceScope = ownedScope(ctx)) {
  const methods = new Map<string, { handlers: Map<string, { handler: any }[]>; dispose(): void }>();
  const service = {
    register(route: any): () => void {
      const native = ctx.get('webServer') ?? ctx.get('httpServer');
      if (!native?.register) throw new Error('dshloader: host webServer is unavailable');
      if (route.kind === 'middleware') {
        // Supported WebServer implementations own the Node server at this seat.
        // Intercept only HTTP request dispatch; preserve all other EventEmitter events.
        if (typeof native.server?.emit !== 'function') throw new Error('dshloader: HTTP middleware requires an active host listener');
        const patch = patchSlot<(event: string, ...args: any[]) => boolean>(native.server, 'emit', original => function(this: unknown, event: string, ...args: any[]) {
          if (event !== 'request') return original.call(this, event, ...args);
          const [request, response] = args; let called = false;
          const fail = () => { if (!response.headersSent) response.writeHead(500); response.end(); };
          const next = (error?: unknown) => { if (called) return; called = true; if (error) fail(); else original.call(this, event, ...args); };
          try { Promise.resolve(route.handler(request, response, next)).catch(fail); } catch { fail(); }
          return true;
        });
        return resources.add(() => patch.dispose());
      }
      if (route.kind !== 'route') return resources.add(native.register(route));
      let entry = methods.get(route.path);
      if (!entry) {
        const handlers = new Map<string, { handler: any }[]>();
        const dispose = native.register({ kind: 'exact', path: route.path, handler(request: any, response: any) {
          const row = handlers.get(request.method)?.at(-1);
          if (row) return row.handler(request, response);
          response.writeHead(405, { allow: [...handlers.keys()].join(', ') }); response.end();
        } });
        entry = { handlers, dispose }; methods.set(route.path, entry);
      }
      const current = entry, row = { handler: route.handler };
      const rows = current.handlers.get(route.method) ?? [];
      rows.push(row); current.handlers.set(route.method, rows);
      return resources.add(() => {
        rows.splice(rows.indexOf(row), 1);
        if (!rows.length) current.handlers.delete(route.method);
        if (!current.handlers.size) { current.dispose(); methods.delete(route.path); }
      });
    },
    registerUpgrade(route: any) { return resources.add(ctx.get('webServer').registerUpgrade(route)); },
  };
  return createWebAPI({ ctx: { ...ctx, get: name => name === 'webServer' ? service : ctx.get(name) } });
}
