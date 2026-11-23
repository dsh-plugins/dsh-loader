import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CordisContext } from '../types.js';

/** 插件自有的 HTTP 路由，不接收身份未知的请求。 */
export interface OwnerRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler(request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

type ConnectionAdmission = {
  requestRejection?(request: IncomingMessage): 401 | 403 | undefined;
  admit?: unknown;
};

type BrowserPeer = {
  principal: { kind: string };
  signal: AbortSignal;
};

/**
 * 按宿主认证入口包装具备本机属主权限的路由。
 * 各版本都由宿主执行 Host、Origin 与身份检查；新版另明确拒绝非属主 Peer。
 */
export function ownerRoute(connection: ConnectionAdmission | undefined, route: OwnerRoute) {
  return {
    ...route,
    auth: 'required' as const,
    handler(request: IncomingMessage, response: ServerResponse, peer?: BrowserPeer) {
      let rejection: 401 | 403 | 503 | undefined;
      if (typeof connection?.requestRejection === 'function') {
        rejection = connection.requestRejection(request);
      } else if (typeof connection?.admit !== 'function' || !peer?.signal || !peer.principal) {
        rejection = 503;
      } else if (peer.signal.aborted) {
        rejection = 401;
      } else if (peer.principal.kind !== 'owner') {
        rejection = 403;
      }
      if (rejection !== undefined) {
        response.writeHead(rejection, { 'cache-control': 'no-store' });
        response.end();
        return;
      }
      return route.handler(request, response);
    },
  };
}

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
