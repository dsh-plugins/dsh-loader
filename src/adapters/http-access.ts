import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CordisContext } from '../types.js';

/** Every supported patch authenticates browser HTTP through Connection. */
export function browserAccess(ctx: CordisContext) {
  return (request: IncomingMessage, response: ServerResponse): boolean => {
    const connection = ctx.get('connection');
    if (typeof connection?.authorizeIndex !== 'function') {
      response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ ok: false, code: 'auth-unavailable', message: 'Host browser authentication is unavailable' }));
      return false;
    }
    return connection.authorizeIndex(request, response);
  };
}

/** 0.2.3+ no longer exposes Connection.authorizeIndex. Use host WebServer
 * admission (its Host/Origin and auth provider checks), and refuse an absent
 * or aborted authenticated Peer even if a future host changes route dispatch.
 */
export function registerNativeProtectedConfigRoute(ctx: CordisContext) {
  return (prefix: string, handler: (request: IncomingMessage, response: ServerResponse) => void): (() => void) => {
    const webServer = ctx.get('webServer');
    if (typeof webServer?.register !== 'function') throw new Error('dshloader: native protected route unavailable');
    return webServer.register({
      kind: 'prefix', path: prefix, auth: 'required',
      handler(request: IncomingMessage, response: ServerResponse, peer?: { signal?: AbortSignal }) {
        if (peer?.signal?.aborted !== false) {
          response.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          response.end(JSON.stringify({ ok: false, code: 'auth-unavailable', message: 'Host browser authentication is unavailable' }));
          return;
        }
        return handler(request, response);
      },
    });
  };
}
