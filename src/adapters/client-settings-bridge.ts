import { patchSlot } from '../patch.js';
import { BRIDGE_PREFIX } from '../bootstrap.js';
interface SettingsWindow {
  fetch: (input: any, init?: any) => Promise<{ clone(): { json(): any }; json(): any }>;
  location?: { origin?: string };
  Response?: new (body?: string, init?: { status?: number; headers?: Record<string, string> }) => any;
}
/**
 * Fetch interceptor for settings namespace whitelist bypass (fix 5, path 2).
 * Mirrors dsh-upstream-fixes/lib/client.js (127-223).
 *
 * - /api/settings.describe: merge non-whitelisted namespaces from the host
 *   bridge into the official response (rpcId/official fields preserved).
 * - /api/settings.{update,mutate,replace}: route writes for namespaces the
 *   official proxy does NOT expose through the host bridge, and rebuild the
 *   response envelope as `{ type: 'server-response', rpcId, result }` so the
 *   official client can correlate the response with the request.
 */
export function installSettingsFetchInterceptor(
  win: SettingsWindow,
  bridgePrefix = BRIDGE_PREFIX,
): () => void {
  if (typeof win.fetch !== 'function') return () => {};
  const originalFetch = win.fetch;
  /** Namespaces the official proxy itself exposed (learned from describe). */
  const officialExposed = new Set<string>();

  const handle = patchSlot(win, 'fetch', () => async function dshloaderFetch(this: unknown, input: any, init?: any) {
    let pathname = '';
    try {
      const urlLike = typeof input === 'string' ? input : (input as { url?: string }).url;
      pathname = new URL(urlLike as string, win.location?.origin ?? 'http://localhost').pathname;
    } catch {
      pathname = String(input).split('?')[0];
    }
    const method = (init?.method ?? 'GET').toUpperCase();

    // describe: merge bridge namespaces into the official response.
    if (pathname === '/api/settings.describe') {
      const response = await originalFetch.call(this, input, init);
      try {
        const body = await response.clone().json();
        const namespaces = body?.result?.value?.namespaces;
        if (!Array.isArray(namespaces)) return response;
        for (const row of namespaces) {
          if (typeof row?.ns === 'string') officialExposed.add(row.ns);
        }
        const extra = await originalFetch.call(this, `${bridgePrefix}/settings/describe`, {
          headers: { accept: 'application/json' },
        });
        const extraBody = await extra.json();
        if (extraBody?.ok !== true || !Array.isArray(extraBody.namespaces)) return response;
        const seen = new Set(namespaces.map((row: { ns: string }) => row.ns));
        const merged = [...namespaces, ...extraBody.namespaces.filter((row: { ns: string }) => !seen.has(row.ns))];
        const ResponseCtor = win.Response!;
        return new ResponseCtor(
          JSON.stringify({ ...body, result: { ...body.result, value: { ...body.result.value, namespaces: merged } } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      } catch {
        return response;
      }
    }

    // writes: route non-whitelisted namespaces through the bridge, echo rpcId.
    if (
      (pathname === '/api/settings.update' || pathname === '/api/settings.mutate' || pathname === '/api/settings.replace') &&
      method === 'POST'
    ) {
      let rpcId: unknown = null;
      let payload: { ns?: string; [k: string]: unknown } | null = null;
      try {
        const parsed = JSON.parse(String(init?.body ?? '{}'));
        rpcId = parsed.rpcId;
        payload = parsed.payload;
      } catch {
        /* fall through to the original endpoint */
      }
      const ns = typeof payload?.ns === 'string' ? payload.ns : '';
      if (rpcId !== null && ns !== '' && officialExposed.size > 0 && !officialExposed.has(ns)) {
        try {
          const mode = pathname.slice('/api/settings.'.length);
          const res = await originalFetch.call(this, `${bridgePrefix}/settings/${mode}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const body = await res.json();
          if (body?.result) {
            const ResponseCtor = win.Response!;
            return new ResponseCtor(
              JSON.stringify({ type: 'server-response', rpcId, result: body.result }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          }
        } catch {
          /* fall back to the original endpoint */
        }
      }
    }

    return originalFetch.call(this, input, init);
  }, { id: 'dshloader:settings-fetch' });

  return () => handle.dispose();
}
