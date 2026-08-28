// connection.api compatibility bridge (browser half).
//
// dsh ≤ 0.1.1 exposed the browser RPC proxy as `connection.api`: namespace
// objects (`llm` / `settings` / …) whose methods take one request object and
// resolve to an RpcResponse (`{result: {ok, value | error}}`). dsh 0.1.2
// restructured the wire: `connection` is a transport handle (`rpc`,
// `generation`, `start`) and the application RPC face moved to the
// `ctx.remote` Typert proxy, whose methods are positional and resolve to a
// bare RpcResult (`{ok, value | error}`). Method names moved too:
//
//   api.llm.providers({})            → remote.llm.listProviders() +
//                                      remote.llm.listConfigurableProviders()
//   api.llm.models({})               → remote.session.modelCatalog()
//   api.settings.describe({})        → remote.settings.describe()
//   api.settings.update({ns,patch})  → deep-merge into the user section, then
//                                      remote.settings.update(ns, merged, rev)
//
// When `connection.api` is absent this module synthesises the legacy proxy
// from `ctx.remote`, so consumers written against the 0.1.1 face work
// unchanged on 0.1.2. Provision is ordered through
// `ctx.inject(['connection','remote'], …)`: the caller's `onReady` fires only
// after the proxy is in place, letting dependent plugins hold a cordis
// service inject on the ordering signal. On hosts where `connection.api`
// already exists the bridge is a synchronous no-op.

/** The legacy RPC proxy property checked on the connection handle. */
export const CONNECTION_SERVICE = 'connection';

/** The dsh ≥ 0.1.2 Typert application-RPC service. */
export const REMOTE_SERVICE = 'remote';

/** Minimal cordis client context surface this bridge touches. */
export interface ConnectionApiCompatContext {
  get?(name: string): unknown;
  inject?(inject: string[], callback: (ctx: ConnectionApiCompatContext) => unknown): unknown;
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
export function buildLegacyApiProxy(remote: RemoteLike): Record<string, unknown> {
  const missing = (name: string): Promise<RpcResponse<never>> =>
    Promise.resolve({
      result: { ok: false, error: { code: 'transport', message: `[dshloader] connection.api: remote.${name} unavailable` } },
    });

  const llm = {
    providers: async (): Promise<RpcResponse<{ providers: Array<Record<string, unknown>> }>> => {
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
      const catalog = remote.session?.modelCatalog;
      if (catalog === undefined) return missing('session.modelCatalog');
      return wrapRpc(catalog.call(remote.session));
    },
  };

  const settings = {
    describe: async (): Promise<RpcResponse<SettingsDescribeLike>> => {
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
 * Install the legacy `connection.api` proxy when the host's connection
 * handle lacks one.
 *
 * The inject list names every nested Remote service the proxy touches:
 * cordis guards nested service access (`remote.session` etc.) behind the
 * caller fiber's inject declarations, so the namespaces are resolved through
 * `scope.get('remote.<name>')` inside the ordered fiber rather than by
 * walking properties off the `remote` service.
 *
 * @param ctx - the client plugin's cordis context.
 * @param onReady - invoked once the proxy question is settled: synchronously
 *   when no bridge is needed (legacy host, or a context without inject), or
 *   from the ordered inject fiber after the proxy was attached.
 * @returns true when the ready signal was delivered synchronously.
 */
export function installConnectionApiCompat(
  ctx: ConnectionApiCompatContext,
  onReady: () => void,
): boolean {
  const connection = ctx.get?.(CONNECTION_SERVICE) as ConnectionHandleLike | undefined;
  if (connection?.api !== undefined) {
    onReady();
    return true;
  }
  if (typeof ctx.inject !== 'function') {
    // No ordered hook: keep the legacy degraded behaviour rather than
    // blocking a dependent plugin forever on a face that may never exist.
    onReady();
    return true;
  }
  // Stage A: wait for the connection handle alone — it exists on every host
  // version. The remote.* nested services below are 0.1.2+ only, so they must
  // NOT share this fiber: on a 0.1.0/0.1.1 host they never materialize and a
  // combined inject list would pend forever, starving dependents of the
  // ready signal (observed: dshLoaderUi never provided, boot stuck).
  let ready = false;
  const readyOnce = (): void => {
    if (ready) return;
    ready = true;
    onReady();
  };
  ctx.inject([CONNECTION_SERVICE], (scope) => {
    const conn = scope.get?.(CONNECTION_SERVICE) as ConnectionHandleLike | undefined;
    if (conn === undefined || conn.api !== undefined) {
      readyOnce();
      return;
    }
    // Stage B (0.1.2+): bridge from the Typert remote faces. They appear only
    // after the gateway connects, and cordis guards nested service access
    // behind the caller fiber's inject declarations — hence a second fiber
    // naming each nested service.
    ctx.inject?.(
      [CONNECTION_SERVICE, `${REMOTE_SERVICE}.llm`, `${REMOTE_SERVICE}.session`, `${REMOTE_SERVICE}.settings`],
      (inner) => {
        const innerConn = inner.get?.(CONNECTION_SERVICE) as ConnectionHandleLike | undefined;
        if (innerConn !== undefined && innerConn.api === undefined) {
          innerConn.api = buildLegacyApiProxy({
            llm: inner.get?.(`${REMOTE_SERVICE}.llm`) as RemoteLike['llm'],
            session: inner.get?.(`${REMOTE_SERVICE}.session`) as RemoteLike['session'],
            settings: inner.get?.(`${REMOTE_SERVICE}.settings`) as RemoteLike['settings'],
          });
        }
        readyOnce();
      },
    );
    // A host without connection.api AND without the remote faces (so stage B
    // never fires) must not hold dependents forever: release them unbridged
    // after a generous window; their per-call reads then fail loudly instead
    // of the whole boot stalling on a service that will never exist.
    const timer = setTimeout(readyOnce, 15000);
    (timer as { unref?: () => void }).unref?.();
  });
  return false;
}
