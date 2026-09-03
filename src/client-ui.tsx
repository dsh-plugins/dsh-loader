/**
 * dshloader BROWSER BUNDLE ENTRY.
 *
 * Composes the two browser halves of dshloader:
 *
 *   1. the compatibility infrastructure in `./client.ts` — `window.__dshLoader__`,
 *      the `__ModuleLoader__.load` wrapper that applies package aliases, the
 *      module-alias factories, and the optional settings fetch interceptor;
 *   2. the UI surface in `./ui/` — the virtual slot engine, the curated icon set,
 *      and the base controls.
 *
 * WHY A SEPARATE ENTRY FROM `client.ts`: `client.ts` must keep compiling in the
 * NODE program (`tsconfig.build.json` → `dist/client.js`), because the client
 * unit tests import it from there. The UI modules need `lib.dom` and JSX, which
 * that program does not have. Keeping the entry separate lets each half compile
 * under the program that suits it while both land in one bundle.
 *
 * Consumers import from `@dsh-plugin/dsh-loader/client`, marked external in
 * their bundler: the DSH client module table strips the `/client` suffix to
 * dshloader's registered bundle id and materialises this module recursively, so
 * no package alias and no load-order coordination is required.
 *
 * @module @dsh-plugin/dsh-loader/client
 */
import { ensureDshModulesGlobal, installClient } from './client.js';
import { installConversationEventsCompat } from './client-conversation-compat.js';
import { installConnectionApiCompat } from './client-connection-api-compat.js';
import { createUi, type DshLoaderUi } from './ui/index.js';

// Re-export the whole UI surface so a consumer's
// `import { Button, Switch, Field } from '@dsh-plugin/dsh-loader/client'`
// resolves against this bundle at runtime.
export * from './ui/index.js';
// Re-export the infrastructure surface consumers and tests rely on.
export {
  createClientAPI,
  ensureDshModulesGlobal,
  installClient,
  installSettingsFetchInterceptor,
  ModuleNotFoundError,
} from './client.js';
export { installConversationEventsCompat } from './client-conversation-compat.js';
export { installConnectionApiCompat, buildLegacyApiProxy } from './client-connection-api-compat.js';

/** cordis plugin name (matches the npm package name and the bundle id). */
export const name = '@dsh-plugin/dsh-loader';

/** dshloader consumes no cordis service; it only provides. */
export const inject: string[] = [];

/** The live UI facade, once `apply` has run. */
let ui: DshLoaderUi | undefined;

/**
 * The UI facade for callers that reach dshloader through the module table rather
 * than `window.__dshLoader__`.
 *
 * @returns the facade, or `undefined` before the client plugin has applied.
 */
export function getUi(): DshLoaderUi | undefined {
  return ui;
}

/** The browser `window`, read off `globalThis` so no DOM lib is assumed here. */
function ambientWindow(): (Record<string, unknown> & { __dshLoader__?: Record<string, unknown> }) | undefined {
  const scope = globalThis as { window?: unknown };
  const found = scope.window;
  return typeof found === 'object' && found !== null
    ? (found as Record<string, unknown> & { __dshLoader__?: Record<string, unknown> })
    : undefined;
}

/**
 * The cordis client service name dshloader publishes its UI facade under.
 *
 * Consumers should declare `inject: ['dshLoaderUi']` and read `ctx.dshLoaderUi`:
 * cordis then activates them only after dshloader's client half has applied,
 * which is the only ordering guarantee available on the browser side.
 * `dsh.client.immediately` guarantees the bundle's factory is REGISTERED early,
 * not that its `apply` has run — so a plugin that reads
 * `window.__dshLoader__.ui` without injecting can observe `undefined`.
 */
export const UI_SERVICE = 'dshLoaderUi';

/** Minimal cordis client context surface this entry touches. */
interface ClientContextLike {
  get?: (name: string) => unknown;
  effect?: (fn: () => unknown) => unknown;
  provide?: (name: string, value: unknown) => unknown;
  /** Ordered dependent-fiber hook used by the conversationEvents bridge. */
  inject?: (inject: string[], callback: (ctx: ClientContextLike) => unknown) => unknown;
  /**
   * The cordis plugin-loader service. dsh 0.1.0-rc.8+ carries the client
   * module system here (`ctx.loader.internal`) instead of exposing it as the
   * legacy `window.__DSH_MODULES__` global — see ensureDshModulesGlobal.
   */
  loader?: { internal?: { import(specifier: string): Promise<unknown> } };
}

/**
 * cordis client-plugin entry.
 *
 * Mirrors the client module system back onto `window.__DSH_MODULES__` first
 * (legacy plugins' lazy chunks read the global; dsh 0.1.0-rc.8+ stopped
 * installing it), then mounts the infrastructure (so the `__ModuleLoader__`
 * wrapper is in place before any sibling bundle materialises), then the UI
 * facade, then publishes it both as the `dshLoaderUi` cordis service
 * (ordered access) and on `window.__dshLoader__.ui` (ad-hoc access from
 * non-cordis code).
 *
 * Every patch installClient makes (the load wrapper, the settings fetch
 * interceptor) is registered through `ctx.effect`, so fiber unload / HMR
 * reverts them instead of stacking wrappers on the shared window.
 */
export function apply(ctx: ClientContextLike): void {
  const win = ambientWindow();
  if (win === undefined) return;

  ensureDshModulesGlobal(win as never, ctx);

  const api = installClient({
    window: win as never,
    clientCtx: ctx as never,
    effect: typeof ctx.effect === 'function' ? (fn) => ctx.effect!(fn) : undefined,
  });

  // Bridge the removed `conversationEvents` service name onto 0.1.2's
  // `uiConversation.events` registry so consumers injecting the legacy name
  // activate unchanged on every dsh line.
  installConversationEventsCompat(ctx);

  ui = createUi();
  if (api !== undefined) (api as Record<string, unknown>).ui = ui;
  else if (win.__dshLoader__ !== undefined) win.__dshLoader__.ui = ui;

  // Ordered access for consumers that inject the service. Publication waits
  // for the connection.api bridge: consumers gated on dshLoaderUi read
  // `connection.api` during their own apply, so the legacy RPC proxy must be
  // in place before the service appears (a synchronous no-op on hosts that
  // already carry `connection.api`).
  installConnectionApiCompat(ctx, () => ctx.provide?.(UI_SERVICE, ui));

  // Tear the observer down with the fiber when the host provides `effect`.
  ctx.effect?.(() => () => {
    ui?.destroy();
    ui = undefined;
  });
}
