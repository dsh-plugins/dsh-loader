import { AsyncLocalStorage } from 'node:async_hooks';
import type { CordisContext } from './types.js';
import type { PatchAPI } from './patch.js';
import { ResponsesToolProjection, type ResponsesToolProjector, type ResponsesToolRequest } from './responses-tools.js';

interface RequestScope {
  readonly request: ResponsesToolRequest;
  readonly projection: ResponsesToolProjection;
  readonly abort: AbortController;
  handled: boolean;
}

/** 用公开 llm/stream 事件包住迭代器的全部异步操作，不访问适配器私有字段。 */
export function registerResponsesToolAdditions(
  patch: PatchAPI,
  owner: CordisContext,
  project: ResponsesToolProjector,
): () => void {
  if (!owner.on) { throw new Error('dsh-loader: 注册 Responses 声明需要 llm/stream 事件'); }
  const storage = new AsyncLocalStorage<RequestScope>();
  const active = new Set<RequestScope>();
  let disposed = false;
  const withoutScope = (next: () => AsyncIterable<unknown>): AsyncIterableIterator<unknown> => {
    let iterator: AsyncIterator<unknown> | undefined;
    const invoke = (method: 'next' | 'return' | 'throw', value?: unknown): Promise<IteratorResult<unknown>> => storage.exit(async () => {
      iterator ??= next()[Symbol.asyncIterator]();
      return iterator[method]?.(value) ?? { done: true, value };
    });
    return {
      [Symbol.asyncIterator]() { return this; },
      next: value => invoke('next', value),
      return: value => invoke('return', value),
      throw: error => invoke('throw', error),
    };
  };
  const handle = patch.global<typeof fetch>('fetch', original => async (input, init) => {
    const scope = storage.getStore();
    if (!scope) { return original(input, init); }
    scope.abort.signal.throwIfAborted();
    scope.request.signal?.throwIfAborted();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() === 'POST' && /\/chat\/completions\/?$/.test(url.pathname)) {
      throw new Error('dsh-loader: additional_tools 路由实际使用 Chat Completions，请移除该原生路由配置');
    }
    if (method.toUpperCase() !== 'POST' || !/\/responses\/?$/.test(url.pathname)) { return original(input, init); }
    const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof body !== 'string') { throw new Error('dsh-loader: Responses additional_tools 需要 JSON 字符串请求体'); }
    const rewritten = scope.projection.rewrite(body);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete('content-length');
    const signals = [scope.abort.signal, scope.request.signal, init?.signal, input instanceof Request ? input.signal : undefined]
      .filter((signal): signal is AbortSignal => signal != null);
    scope.handled = true;
    const response = await original(input, { ...init, body: rewritten, headers, signal: AbortSignal.any(signals) });
    if (!response.ok) {
      const raw = await response.text();
      let payload: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(raw);
        payload = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
      } catch { payload = {}; }
      const originalError = typeof payload.error === 'object' && payload.error !== null ? payload.error as Record<string, unknown> : {};
      const detail = String(originalError.message ?? raw);
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      headers.set('content-type', 'application/json');
      const message = `dsh-loader: ${scope.request.provider}/${scope.request.model} 拒绝 Responses additional_tools（HTTP ${response.status}）：${detail.slice(0, 512)}；不会回退为顶层工具声明`;
      return new Response(JSON.stringify({ ...payload, error: { ...originalError, message } }), { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  // 卸载先取消请求，迭代器退出前保留拦截器，防止 SDK 重试绕过转换。
  }, { id: `responses-tools:${crypto.randomUUID()}`, owner: undefined });

  const releaseIfIdle = (): void => {
    if (!disposed || active.size) { return; }
    handle.dispose();
    storage.disable();
  };
  let off: (() => void) | void;
  try {
    off = owner.on('llm/stream', (request: ResponsesToolRequest, next: () => AsyncIterable<unknown>) => {
      if (disposed) { return withoutScope(next); }
      const records = project(request);
      if (!records?.length) { return withoutScope(next); }
      if (!request.sessionId) { throw new Error('dsh-loader: Responses 声明缺少 sessionId'); }
      const scope: RequestScope = { request, projection: new ResponsesToolProjection(request.messages, records), abort: new AbortController(), handled: false };
      let iterator: AsyncIterator<unknown> | undefined;
      let finished = false;
      const finish = (): void => { finished = true; active.delete(scope); releaseIfIdle(); };
      const invoke = async (method: 'next' | 'return' | 'throw', value?: unknown): Promise<IteratorResult<unknown>> => {
        if (finished) { return { done: true, value: undefined }; }
        return storage.run(scope, async () => {
          try {
            if (disposed) { throw new Error('dsh-loader: Responses 声明插件已卸载，请重新发起请求'); }
            scope.request.signal?.throwIfAborted();
            active.add(scope);
            iterator ??= next()[Symbol.asyncIterator]();
            const result = await (iterator[method]?.(value) ?? Promise.resolve({ done: true, value }));
            scope.abort.signal.throwIfAborted();
            scope.request.signal?.throwIfAborted();
            if (result.done) {
              if (method === 'next' && !scope.handled) { throw new Error('dsh-loader: 未观察到 Responses HTTP 请求；此声明接口不支持 WebSocket 或 Chat Completions'); }
              finish();
            }
            return result;
          } catch (error) {
            scope.abort.abort(error);
            try { await iterator?.return?.(); }
            catch (cleanupError) { throw new AggregateError([error, cleanupError], 'dsh-loader: Responses 迭代器失败且清理失败'); }
            finally { finish(); }
            throw error;
          }
        });
      };
      return {
        [Symbol.asyncIterator]() { return this; },
        next: (value?: unknown) => invoke('next', value),
        return: (value?: unknown) => invoke('return', value),
        throw: (error?: unknown) => invoke('throw', error),
      };
    });
  } catch (error) {
    handle.dispose();
    storage.disable();
    throw error;
  }
  const dispose = (): void => {
    if (disposed) { return; }
    disposed = true;
    off?.();
    for (const scope of active) { scope.abort.abort(new Error('dsh-loader: Responses 声明插件已卸载')); }
    releaseIfIdle();
  };
  try { owner.effect(() => dispose); } catch (error) { dispose(); throw error; }
  return dispose;
}
