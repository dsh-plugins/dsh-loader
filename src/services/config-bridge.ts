import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigError } from '../config.js';
import type { WebAPI } from '../types.js';
import type { ConfigStore } from './config.js';

export function installConfigBridge(web: WebAPI, store: ConfigStore, authorize: (request: IncomingMessage, response: ServerResponse) => boolean): () => void {
  const streams = new Set<ServerResponse>();
  const calls = new Set<AbortController>();
  const offEvents = store.subscribe(() => { for (const response of streams) response.write('event: change\ndata: {}\n\n'); });
  let offRoute: () => void;
  try { offRoute = web.register('/api/dshloader/config', (request: IncomingMessage, response: ServerResponse) => {
    const json = (status: number, value: unknown) => { if (response.destroyed || response.writableEnded) return; response.statusCode = status; response.setHeader('content-type', 'application/json'); response.setHeader('cache-control', 'no-store'); response.end(JSON.stringify(value)); };
    return (async () => {
      if (!authorize(request, response)) return;
      const origin = request.headers.origin;
      if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== request.headers.host)) { json(403, { ok: false, code: 'forbidden', message: 'Cross-origin config access denied' }); return; }
      const path = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (request.method === 'GET' && path === '/api/dshloader/config/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        response.write('event: change\ndata: {}\n\n'); streams.add(response);
        response.on('close', () => streams.delete(response)); return;
      }
      if (request.method === 'GET' && path === '/api/dshloader/config') { json(200, { ok: true, value: store.list() }); return; }
      const match = /^\/api\/dshloader\/config\/([a-z0-9][a-z0-9._-]*)(?:\/(reset)|\/operations\/([a-zA-Z0-9][a-zA-Z0-9._-]*))?$/.exec(path);
      if (!match) { json(404, { ok: false, code: 'not-found' }); return; }
      if (request.method === 'GET' && !match[2] && !match[3]) { json(200, { ok: true, value: store.read(match[1]) }); return; }
      if (request.method !== 'POST') { json(405, { ok: false, code: 'method-not-allowed' }); return; }
      if (!request.headers['content-type']?.startsWith('application/json')) throw new ConfigError('invalid', 'JSON content type required');
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 1024 * 1024) throw new ConfigError('invalid', 'Configuration exceeds 1 MiB'); chunks.push(buffer); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ConfigError('invalid', 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ConfigError('invalid', 'Expected JSON object');
      if (match[3]) {
        const controller = new AbortController(); calls.add(controller);
        const abort = () => { if (!response.writableEnded) controller.abort(); };
        response.on('close', abort);
        try { json(200, { ok: true, value: await store.invoke(match[1], match[3], body, controller.signal) }); }
        finally { calls.delete(controller); response.removeListener('close', abort); }
        return;
      }
      const value = match[2] ? await store.reset(match[1], body.expectedRevision) : await store.write(match[1], body.value, body.expectedRevision);
      json(200, { ok: true, value });
    })().catch(error => json(error.code === 'conflict' ? 409 : error.code === 'not-found' ? 404 : error instanceof ConfigError ? 400 : 500, { ok: false, code: error.code ?? 'internal', message: error.message, fields: error.fields }));
  }); } catch (error) { offEvents(); throw error; }
  let active = true;
  return () => { if (!active) return; active = false; offRoute(); offEvents(); for (const call of calls) call.abort(); calls.clear(); for (const stream of streams) stream.end(); streams.clear(); };
}
