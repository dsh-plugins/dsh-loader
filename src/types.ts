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
}

/** Config passed to an adapter's create(). */
export interface HostAdapterConfig {
  exposeAllNamespaces?: boolean;
  hostPackageAliases?: Record<string, string>;
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
  register(prefix: string, handler: any): () => void;
  get(path: string, handler: any): () => void;
  post(path: string, handler: any): () => void;
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
