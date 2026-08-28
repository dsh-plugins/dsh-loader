/**
 * Shared TypeScript types for dshloader (host + client).
 *
 * These describe only the shapes dshloader itself relies on from the cordis
 * runtime, the real dsh settings/web services, and the browser client
 * environment. The real dsh services are intentionally typed loosely (`any`)
 * because dshloader's whole job is to absorb dsh's internal shape changes
 * behind a stable API — pinning them here would defeat the compatibility
 * shim's purpose.
 */

/** Minimal cordis context surface dshloader uses. */
export interface CordisContext {
  get(name: string): any;
  reflect: {
    provide(name: string, value: any): void;
  };
  effect(
    fn: () => void | (() => void) | Promise<void | (() => void)>,
    label?: string,
  ): void;
  /** Event registration; optional so a reduced context (tests) still type-checks. */
  on?(
    event: string,
    listener: (...args: any[]) => any,
    options?: Record<string, unknown>,
  ): (() => void) | void;
  /** Cordis logger; optional for the same reason. */
  logger?: {
    info?(...args: unknown[]): void;
    warn?(...args: unknown[]): void;
    error?(...args: unknown[]): void;
  };
}

/** dshloader host adapter factory. */
export interface AdapterFactory {
  supports: string;
  name: string;
  create(ctx: CordisContext, config?: HostAdapterConfig): HostAdapter;
}

/** An instantiated host adapter. */
export interface HostAdapter {
  supports: string;
  name: string;
  apply?: () => Promise<void> | void;
  dispose?: () => void;
  /** Adapter-provided overrides for the stable API capabilities. */
  settings?: any;
  web?: any;
  services?: any;
  /** Optional override for the registry facade (it names private dsh shapes). */
  registry?: any;
}

/** Config passed to an adapter's create(). */
export interface HostAdapterConfig {
  exposeAllNamespaces?: boolean;
  hostPackageAliases?: Record<string, string>;
  /** Extra client module-table aliases merged over the adapter's tables. */
  clientPackageAliases?: Record<string, string>;
}

/** Result of AdapterRegistry.select(). */
export interface AdapterSelection {
  factory: AdapterFactory;
  mode: 'exact' | 'range' | 'fallback';
}

/** dshloader host API exposed as `ctx.dshLoader`. */
export interface HostAPI {
  version: string;
  dshVersion?: string;
  adapterVersion?: string;
  settings: SettingsAPI;
  web: WebAPI;
  services: ServicesAPI;
  /** Monkey-patch protocol: RAW original, identity-checked restore, re-apply safe. */
  patch: import('./patch.js').PatchAPI;
  /** Stable facade over dsh registry internals (tools / sandbox / permission presets). */
  registry: import('./services/registry.js').RegistryAPI;
  /** Module-level LLM helpers that `services.get('llm')` cannot reach. */
  llm: import('./services/llm.js').LlmAPI;
  /** Module-level dsh symbols (defineTool, deadline, BasicCompactionEngine, ...). */
  dsh: import('./services/dsh-symbols.js').DshSymbolsAPI;
  registerPackageAlias(oldName: string, newName: string): void;
}

/** Settings stable API. */
export interface SettingsAPI {
  exposeAllNamespaces: boolean;
  register(ns: string, schema: any, options?: any): any;
  describe(options?: { redactSecrets?: boolean }): any[];
  update(ns: string, section?: any, expectedRevision?: number): Promise<SettingsResult>;
  replace(ns: string, section?: any, expectedRevision?: number): Promise<SettingsResult>;
  mutate(ns: string, ops?: any, expectedRevision?: number): Promise<SettingsResult>;
  /**
   * Build a settings namespace handle (delegates to dsh's `settingsNamespace`).
   * @param id - namespace id; dsh accepts only `[a-z0-9-]`.
   * @returns the namespace handle, or the raw id when the module is unavailable.
   */
  namespace(id: string): any;
  /**
   * Install the canonical optional-settings consumer wiring (delegates to dsh's
   * `installSettingsSection`): register `ns` with `entry` as the `base` layer,
   * point the hooks' source thunk at the resolved scope while a settings service
   * exists, and fall back to `entry` when it goes away.
   *
   * Delegated rather than reimplemented — the fallback and fiber semantics are
   * real upstream behaviour, not something a shim should copy.
   *
   * @returns `true` when the wiring was installed, `false` when dsh-settings is
   *   unavailable (the caller then keeps using its composition entry).
   */
  installSection<T>(
    ctx: any,
    ns: any,
    schema: any,
    entry: T,
    hooks: {
      setSource(current: () => T): void;
      onChange(): void;
      validate(value: T): void;
    },
  ): boolean;
  /** Whether `error` is dsh's optimistic-concurrency `SettingsConflictError`. */
  isConflictError(error: unknown): boolean;
}

/** Settings write result shape. */
export interface SettingsResult {
  ok: boolean;
  value?: NamespaceView;
  code?: string;
  message?: string;
  details?: Record<string, any>;
}

/** Official NamespaceView wire shape. */
export interface NamespaceView {
  ns: string;
  schema: any;
  value: any;
  base?: any;
  user?: any;
  applies?: any;
  secrets: { path: string[]; set?: any }[];
  revision?: any;
}

/** Web stable API. */
export interface WebAPI {
  /** Mount a handler on a path PREFIX (`kind: 'prefix'`), any method. */
  register(prefix: string, handler: any): () => void;
  /**
   * Mount a handler on an EXACT path, any method (`kind: 'exact'`).
   *
   * Use this when one handler dispatches several methods itself — the shape
   * dsh-network-settings' `/_dsh/.../settings` and `/_dsh/.../probe` routes use.
   */
  exact(path: string, handler: any): () => void;
  get(path: string, handler: any): () => void;
  post(path: string, handler: any): () => void;
  put(path: string, handler: any): () => void;
  patch(path: string, handler: any): () => void;
  /** `DELETE` route. Named `del` because `delete` is awkward on a facade. */
  del(path: string, handler: any): () => void;
  use(middleware: any): () => void;
  registerUpgrade(route: { path: string; handler: (req: any, socket: any, head: Buffer) => void }): () => void;
}

/** Services stable API. */
export interface ServicesAPI {
  get(name: string): any;
  alias(from: string, to: string): void;
}

/** Selectable adapter entry exposed for CLI/tests. */
export interface AdapterSelectionResult {
  registry: import('./registry.js').AdapterRegistry;
  factory: AdapterFactory;
  mode: AdapterSelection['mode'];
  dshVersion: string;
}
