// Settings stable API (design.md §3.3.1 / §4.1 / §4.2).
//
// Two concerns are deliberately separated:
//   1. naming/shape differences — handled by proxying to ctx.get('settings').
//   2. access scope (security)  — `exposeAllNamespaces` controls whether
//      `describe` returns only the official browser whitelist namespaces
//      (default, matches official behavior) or every registered namespace.
//
// Host-side writes always proxy through to the real settings service: host
// plugin code is already trusted (it runs in the dsh Node process and could
// call ctx.get('settings').update directly). The whitelist is a browser-side
// default-deny boundary owned by dsh-host-apiproxy; the browser path is
// covered separately by the client fetch interceptor (src/client.ts).
import { LOG_PREFIX } from '../version.js';
import type { CordisContext, SettingsAPI, SettingsResult, NamespaceView } from '../types.js';

/**
 * Official browser-writable settings namespaces (dsh-host-apiproxy
 * WEB_SETTINGS_NAMESPACES), as documented in dsh-upstream-fixes/README.md.
 * Product namespaces and dynamic model-provider namespaces are not enumerable
 * without dsh internals; callers may extend this set via `extraWhitelist`.
 */
export const DEFAULT_WEB_SETTINGS_NAMESPACES = new Set([
  'agent-loop',
  'shell',
  'locale',
  'permission',
  'ui-conversation',
  'ui-theme',
  'web-search-deepseek',
]);

/** A raw settings descriptor returned by the real settings service. */
interface SettingsDescriptor {
  ns: string;
  schema: any;
  value: any;
  base?: any;
  user?: any;
  applies?: any;
  secrets?: { path: string[]; set?: any }[];
  revision?: any;
}

/**
 * Shape a raw settings descriptor into the official NamespaceView wire shape
 * (mirrors dsh-upstream-fixes/lib/index.js `namespaceView`).
 */
export function toNamespaceView(descriptor: SettingsDescriptor): NamespaceView {
  const view: NamespaceView = {
    ns: String(descriptor.ns),
    schema: descriptor.schema,
    value: descriptor.value,
    ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    applies: descriptor.applies,
    secrets: (descriptor.secrets ?? []).map((s) => ({ path: [...s.path], set: s.set })),
    revision: descriptor.revision,
  };
  return view;
}

/**
 * Map a thrown settings error into a SettingsResult, preserving the official
 * `settings-conflict` / `settings-rejected` classification.
 */
export function settingsErrorToResult(error: unknown, ns: string, method: string): SettingsResult {
  const isObject = error !== null && typeof error === 'object';
  const isConflict = isObject && ('expected' in error || 'actual' in error);
  if (isConflict) {
    const err = error as { message?: string; expected?: any; actual?: any };
    return {
      ok: false,
      code: 'settings-conflict',
      message: err.message ?? String(error),
      details: {
        ns,
        ...(err.expected === undefined ? {} : { expected: err.expected }),
        ...(err.actual === undefined ? {} : { actual: err.actual }),
      },
    };
  }
  return {
    ok: false,
    code: 'settings-rejected',
    message: error instanceof Error ? error.message : String(error),
    details: { ns, method },
  };
}

/**
 * Internal shape used while building the API: includes the private `_write`
 * helper so `update`/`replace`/`mutate` can share one implementation.
 */
type SettingsAPIBuilder = SettingsAPI & {
  _write(
    method: 'update' | 'replace' | 'mutate',
    ns: string,
    section: any,
    expectedRevision?: number,
  ): Promise<SettingsResult>;
};

/**
 * Build the `ctx.dshLoader.settings` stable API.
 */
export function createSettingsAPI(opts: {
  ctx: CordisContext;
  exposeAllNamespaces: boolean;
  whitelist?: Set<string>;
  /** The real `@deepseek-ai/dsh-settings` module, when it resolved at boot. */
  module?: {
    installSettingsSection?: (ctx: unknown, ns: unknown, schema: unknown, entry: unknown, hooks: unknown) => void;
    settingsNamespace?: (id: string) => unknown;
    SettingsConflictError?: new (...args: never[]) => Error;
  };
}): SettingsAPI {
  const { ctx, exposeAllNamespaces, whitelist, module } = opts;
  const allowed = whitelist ?? DEFAULT_WEB_SETTINGS_NAMESPACES;

  function getSettings() {
    return ctx.get('settings');
  }

  function filterNamespaces(views: NamespaceView[]) {
    if (exposeAllNamespaces) return views;
    return views.filter((v) => allowed.has(String(v.ns)));
  }

  const api: SettingsAPIBuilder = {
    exposeAllNamespaces: Boolean(exposeAllNamespaces),

    /**
     * Register a settings namespace. Proxies to the real settings service's
     * `register(ns, schema, options)` and returns the owner scope
     * ({ get, watch }) — the same shape the official service returns.
     *
     * Unlike describe/update/replace/mutate, register is NOT filtered by the
     * whitelist: host plugin code is trusted and registering a namespace is
     * a composition-time act, not a browser-facing read/write.
     */
    register(ns, schema, options) {
      const settings = getSettings();
      if (settings === undefined || typeof settings.register !== 'function') {
        console.warn(`${LOG_PREFIX}:settings.register settings service unavailable`);
        return undefined;
      }
      return settings.register(ns, schema, options);
    },

    describe(options: { redactSecrets?: boolean } = {}) {
      const settings = getSettings();
      if (settings === undefined || typeof settings.describe !== 'function') {
        return [];
      }
      const redactSecrets = options.redactSecrets !== false;
      const descriptors = settings.describe({ redactSecrets }) as SettingsDescriptor[];
      const views = (descriptors ?? []).map(toNamespaceView);
      return filterNamespaces(views);
    },

    async _write(
      method: 'update' | 'replace' | 'mutate',
      ns: string,
      section: any,
      expectedRevision?: number,
    ): Promise<SettingsResult> {
      const settings = getSettings();
      if (settings === undefined) {
        return {
          ok: false,
          code: 'internal',
          message: `${LOG_PREFIX}:settings.${method} settings service unavailable`,
          details: { ns },
        };
      }
      try {
        if (method === 'update') await settings.update(ns, section, expectedRevision);
        else if (method === 'replace') await settings.replace(ns, section, expectedRevision);
        else await settings.mutate(ns, section, expectedRevision);
      } catch (error) {
        return settingsErrorToResult(error, ns, method);
      }
      const descriptor = (settings.describe({ redactSecrets: true }) as SettingsDescriptor[]).find(
        (d) => String(d.ns) === String(ns),
      );
      if (descriptor === undefined) {
        return {
          ok: false,
          code: 'internal',
          message: `${LOG_PREFIX}:settings.${method} namespace disposed after write`,
          details: { ns },
        };
      }
      return { ok: true, value: toNamespaceView(descriptor) };
    },

    update(ns, section, expectedRevision) {
      return api._write('update', ns, section, expectedRevision);
    },
    replace(ns, section, expectedRevision) {
      return api._write('replace', ns, section, expectedRevision);
    },
    mutate(ns, ops, expectedRevision) {
      return api._write('mutate', ns, ops, expectedRevision);
    },

    namespace(id: string) {
      const make = module?.settingsNamespace;
      if (typeof make !== 'function') {
        // No dsh-settings: hand back the raw id. Callers only pass it straight
        // back into this facade, so an opaque handle and a string behave alike.
        return id;
      }
      return make(id);
    },

    installSection(consumerCtx, ns, schema, entry, hooks) {
      const install = module?.installSettingsSection;
      if (typeof install !== 'function') {
        console.warn(
          `${LOG_PREFIX}:settings.installSection — @deepseek-ai/dsh-settings is unavailable; ` +
            'the consumer keeps its composition entry (no user-settings layer)',
        );
        return false;
      }
      install(consumerCtx, ns, schema, entry, hooks);
      return true;
    },

    isConflictError(error: unknown) {
      const Ctor = module?.SettingsConflictError;
      if (typeof Ctor === 'function' && error instanceof Ctor) return true;
      // Structural fallback: dsh marks conflicts with expected/actual revisions.
      return (
        error !== null &&
        typeof error === 'object' &&
        ('expected' in error || 'actual' in error)
      );
    },
  };

  return api;
}
