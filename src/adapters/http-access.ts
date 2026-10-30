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
