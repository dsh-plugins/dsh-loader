import { ConfigError } from './config.js';
import type { ConfigOperationRequest, ConfigOperationResult, ConfigValues, ConfigView } from './config.js';
export interface ConfigClient {
  list(): Promise<ConfigView[]>;
  read(id: string): Promise<ConfigView>;
  update(id: string, value: ConfigValues, expectedRevision: number): Promise<ConfigView>;
  reset(id: string, expectedRevision: number): Promise<ConfigView>;
  invoke(id: string, operation: string, request: ConfigOperationRequest, signal?: AbortSignal): Promise<ConfigOperationResult>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
interface EventStream { addEventListener(name: string, listener: () => void): void; close(): void }
export function createConfigClient(fetch: (url: string, init?: any) => Promise<any>, createEvents?: (url: string) => EventStream, prefix = '/api/dshloader/config'): ConfigClient {
  const listeners = new Set<() => void>();
  const calls = new Set<AbortController>();
  let disposed = false;
  let stream: EventStream | undefined;
  const notify = () => { for (const listener of listeners) listener(); };
  const request = async (suffix: string, body?: unknown, signal?: AbortSignal) => {
    if (disposed) throw new ConfigError('disposed', 'Config client disposed');
    const response = await fetch(prefix + suffix, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    let result;
    try { result = await response.json(); }
    catch { throw new ConfigError('http', response.status === 401 ? '身份验证已失效，请重新加载页面' : `配置请求失败（HTTP ${response.status ?? 'unknown'}）`); }
    if (!result.ok) throw new ConfigError(result.code, result.message ?? 'Configuration request failed', result.fields);
    return result.value;
  };
  return {
    list: () => request(''), read: id => request('/' + encodeURIComponent(id)),
    update: (id, value, expectedRevision) => request('/' + encodeURIComponent(id), { value, expectedRevision }),
    reset: (id, expectedRevision) => request('/' + encodeURIComponent(id) + '/reset', { expectedRevision }),
    async invoke(id, operation, body, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
      calls.add(controller);
      try { return await request('/' + encodeURIComponent(id) + '/operations/' + encodeURIComponent(operation), body, controller.signal); }
      finally { calls.delete(controller); signal?.removeEventListener('abort', abort); }
    },
    subscribe(listener) {
      listeners.add(listener);
      if (!stream && createEvents) { stream = createEvents(prefix + '/events'); stream.addEventListener('change', notify); stream.addEventListener('open', notify); }
      return () => { listeners.delete(listener); if (!listeners.size) { stream?.close(); stream = undefined; } };
    },
    dispose() { disposed = true; for (const call of calls) call.abort(); calls.clear(); stream?.close(); stream = undefined; listeners.clear(); },
  };
}
