// connection.api 兼容桥保留旧请求与响应格式。连接句柄出现后立即提供
// 稳定的 API 对象，具体请求等待 remote 服务就绪，避免客户端启动依赖网络。

/** The legacy RPC proxy property checked on the connection handle. */
export const CONNECTION_SERVICE = 'connection';

/** The dsh ≥ 0.1.2 Typert application-RPC service. */
export const REMOTE_SERVICE = 'remote';

/** Minimal cordis client context surface this bridge touches. */
export interface ConnectionApiCompatContext {
  get?(name: string): unknown;
  inject?(inject: string[], callback: (ctx: ConnectionApiCompatContext) => unknown): unknown;
  /** 注册连接桥与等待中的请求的清理函数。 */
  effect?(fn: () => (() => void) | void): unknown;
}

/** Bare RpcResult the 0.1.2 Typert remote resolves to. */
export interface RpcResultOk<T> {
  ok: true;
  value: T;
}
export interface RpcResultError {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}
export type RpcResult<T> = RpcResultOk<T> | RpcResultError;

/** The legacy 0.1.1 response envelope consumers unwrap with `valueOf`. */
export interface RpcResponse<T> {
  result: RpcResult<T>;
}

/** The connection handle shape this bridge reads and patches. */
interface ConnectionHandleLike {
  api?: unknown;
}

interface LlmProviderInfoLike {
  id: string;
  label?: string;
}

interface LlmConfigurableProviderLike {
  provider: string;
  displayName: string;
  settingsNs: string;
  settingsPath?: readonly string[];
  declared?: boolean;
}

/** The remote namespaces this bridge adapts. */
interface RemoteLike {
  llm?: {
    listProviders?(): Promise<RpcResult<readonly LlmProviderInfoLike[]>>;
    listConfigurableProviders?(): Promise<RpcResult<readonly LlmConfigurableProviderLike[]>>;
  };
  session?: {
    modelCatalog?(): Promise<RpcResult<unknown>>;
  };
  settings?: {
    describe?(): Promise<RpcResult<SettingsDescribeLike>>;
    /** 0.1.2: merge a patch into the namespace's stored user section. */
    update?(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<RpcResult<unknown>>;
    /** 0.1.2: replace the namespace's stored user section wholesale. */
    replace?(ns: string, section: Record<string, unknown>, expectedRevision?: number): Promise<RpcResult<unknown>>;
    mutate?(ns: string, ops: readonly unknown[], expectedRevision?: number): Promise<RpcResult<unknown>>;
  };
}

interface SettingsNamespaceViewLike {
  ns: string;
  user?: unknown;
  revision?: number;
}

interface SettingsDescribeLike {
  namespaces: readonly SettingsNamespaceViewLike[];
  writable?: boolean;
}

/** Wrap a bare RpcResult promise into the legacy RpcResponse envelope. */
async function wrapRpc<T>(operation: Promise<RpcResult<T>>): Promise<RpcResponse<T>> {
  try {
    return { result: await operation };
  } catch (error) {
    return {
      result: {
        ok: false,
        error: {
          code: 'transport',
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Join the registered route list with the declared configurable-provider
 * directory, mirroring 0.1.2's joinProviderDirectory: declared rows in
 * declaration order, then live routes with no declaration.
 */
function joinProviderDirectory(
  registered: readonly LlmProviderInfoLike[],
  declared: readonly LlmConfigurableProviderLike[],
): Array<Record<string, unknown>> {
  const active = new Set(registered.map((provider) => provider.id));
  const declaredKeys = new Set(declared.map((entry) => entry.provider));
  const rows: Array<Record<string, unknown>> = declared.map((entry) => ({
    provider: entry.provider,
    displayName: entry.displayName,
    settingsNs: entry.settingsNs,
    settingsPath: [...(entry.settingsPath ?? [])],
    active: active.has(entry.provider),
    ...(entry.declared === undefined ? {} : { declared: entry.declared }),
  }));
  for (const provider of registered) {
    if (declaredKeys.has(provider.id)) continue;
    rows.push({
      provider: provider.id,
      displayName: provider.label ?? provider.id,
      settingsNs: '',
      settingsPath: [],
      active: true,
    });
  }
  return rows;
}

/**
 * Build the legacy `connection.api` proxy over a 0.1.2 `ctx.remote` face.
 * Namespaces or methods missing from the remote degrade to a `transport`
 * failure response rather than a synchronous throw, so one absent method does
 * not take down the whole proxy.
 */
export function buildLegacyApiProxy(remote: RemoteLike, ready: Promise<void> = Promise.resolve()): Record<string, unknown> {
  const missing = (name: string): Promise<RpcResponse<never>> =>
    Promise.resolve({
      result: { ok: false, error: { code: 'transport', message: `[dshloader] connection.api: remote.${name} unavailable` } },
    });

  const llm = {
    providers: async (): Promise<RpcResponse<{ providers: Array<Record<string, unknown>> }>> => {
      await ready;
      const list = remote.llm?.listProviders;
      const listConfigurable = remote.llm?.listConfigurableProviders;
      if (list === undefined || listConfigurable === undefined) return missing('llm.listProviders');
      const [registered, declared] = await Promise.all([
        wrapRpc(list.call(remote.llm)),
        wrapRpc(listConfigurable.call(remote.llm)),
      ]);
      if (!registered.result.ok) return { result: registered.result };
      if (!declared.result.ok) return { result: declared.result };
      return {
        result: {
          ok: true,
          value: { providers: joinProviderDirectory(registered.result.value, declared.result.value) },
        },
      };
    },
    models: async (): Promise<RpcResponse<unknown>> => {
      await ready;
      const catalog = remote.session?.modelCatalog;
      if (catalog === undefined) return missing('session.modelCatalog');
      return wrapRpc(catalog.call(remote.session));
    },
  };

  const settings = {
    describe: async (): Promise<RpcResponse<SettingsDescribeLike>> => {
      await ready;
      const describe = remote.settings?.describe;
      if (describe === undefined) return missing('settings.describe');
      return wrapRpc(describe.call(remote.settings));
    },
    /**
     * Legacy patch write: `{ns, patch, expectedRevision}` maps straight onto
     * 0.1.2's `update(ns, patch, expectedRevision)` — a host-side deep merge
     * into the stored user section, so unknown keys survive and the revision
     * CAS guards the merge with no client read-modify-write window. A caller
     * passing `{ns, section}` (full replacement intent) is routed to
     * `replace(ns, section, expectedRevision)`.
     */
    update: async (request: {
      ns?: string;
      patch?: unknown;
      section?: unknown;
      expectedRevision?: number;
    }): Promise<RpcResponse<unknown>> => {
      await ready;
      const update = remote.settings?.update;
      const replace = remote.settings?.replace;
      if (update === undefined) return missing('settings.update');
      if (typeof request?.ns !== 'string') {
        return {
          result: { ok: false, error: { code: 'invalid-request', message: '[dshloader] connection.api: settings.update requires an ns string' } },
        };
      }
      if (request.section !== undefined && replace !== undefined) {
        const section = isPlainRecord(request.section) ? request.section : {};
        return wrapRpc(replace.call(remote.settings, request.ns, section, request.expectedRevision));
      }
      const patch = request.section !== undefined ? request.section : request.patch;
      return wrapRpc(update.call(
        remote.settings,
        request.ns,
        isPlainRecord(patch) ? patch : {},
        request.expectedRevision,
      ));
    },
    mutate: async (request: {
      ns?: string;
      ops?: readonly unknown[];
      expectedRevision?: number;
    }): Promise<RpcResponse<unknown>> => {
      await ready;
      const mutate = remote.settings?.mutate;
      if (mutate === undefined) return missing('settings.mutate');
      if (typeof request?.ns !== 'string' || !Array.isArray(request.ops)) {
        return {
          result: { ok: false, error: { code: 'invalid-request', message: '[dshloader] connection.api: settings.mutate requires ns and ops' } },
        };
      }
      return wrapRpc(mutate.call(remote.settings, request.ns, request.ops, request.expectedRevision));
    },
  };

  return { llm, settings };
}

/**
 * 在连接句柄上安装稳定的旧版 API；网络就绪只影响请求，不阻塞插件激活。
 * 原生 API 存在时直接复用，宿主仍支持旧接口期间保留此桥。
 * @param ctx - 连接桥所属的客户端上下文。
 * @param onReady - API 可读取时调用一次，不等待远程服务。
 * @returns 是否已在返回前通知 API 就绪。
 */
export function installConnectionApiCompat(
  ctx: ConnectionApiCompatContext,
  onReady: () => void,
): boolean {
  let closed = false;
  ctx.effect?.(() => () => { closed = true; });
  let notified = false;
  const notify = (): void => {
    if (notified) { return; }
    notified = true;
    onReady();
  };
  const install = (scope: ConnectionApiCompatContext, conn: ConnectionHandleLike): void => {
    if (closed) { return; }
    if (conn.api !== undefined) {
      notify();
      return;
    }
    const remote: RemoteLike = {};
    let disposed = false;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      release();
    };
    const clearRemote = (): void => {
      delete remote.llm;
      delete remote.session;
      delete remote.settings;
    };
    const proxy = buildLegacyApiProxy(remote, ready);
    scope.effect?.(() => () => {
      disposed = true;
      clearRemote();
      settle();
      if (conn.api === proxy) { delete conn.api; }
    });
    conn.api = proxy;
    // 超时只结束当前请求的等待；迟到的服务仍可供后续请求使用。
    timer = setTimeout(settle, 15000);
    (timer as { unref?: () => void }).unref?.();
    if (scope.inject === undefined) {
      settle();
    } else {
      scope.inject(
        [CONNECTION_SERVICE, `${REMOTE_SERVICE}.llm`, `${REMOTE_SERVICE}.session`, `${REMOTE_SERVICE}.settings`],
        (inner) => {
          if (disposed) { return; }
          const current: RemoteLike = {
            llm: inner.get?.(`${REMOTE_SERVICE}.llm`) as RemoteLike['llm'],
            session: inner.get?.(`${REMOTE_SERVICE}.session`) as RemoteLike['session'],
            settings: inner.get?.(`${REMOTE_SERVICE}.settings`) as RemoteLike['settings'],
          };
          Object.assign(remote, current);
          inner.effect?.(() => () => {
            if (remote.llm === current.llm && remote.session === current.session && remote.settings === current.settings) {
              clearRemote();
            }
          });
          settle();
        },
      );
    }
    notify();
  };
  const connection = ctx.get?.(CONNECTION_SERVICE) as ConnectionHandleLike | undefined;
  if (connection !== undefined) {
    install(ctx, connection);
  } else if (ctx.inject !== undefined) {
    ctx.inject([CONNECTION_SERVICE], (scope) => {
      if (closed) { return; }
      const conn = scope.get?.(CONNECTION_SERVICE) as ConnectionHandleLike | undefined;
      if (conn !== undefined) { install(scope, conn); }
    });
  } else {
    notify();
  }
  return notified;
}
