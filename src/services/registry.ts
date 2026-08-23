/**
 * The dshloader REGISTRY facade (`ctx.dshLoader.registry`).
 *
 * dsh exposes no public API for three things plugins legitimately need, so
 * today they reach into internals directly:
 *
 *   - replacing / augmenting an ALREADY REGISTERED tool definition
 *     (`ctx.tools.layers.global.tools` — TS-private `ToolRuntime.layers` /
 *     `ScopedLayers.global` / `ToolLayer.tools`),
 *   - advertising a new sandbox escalation mode
 *     (`push` onto the readonly `ESCALATION_TARGETS` export),
 *   - registering a permission preset
 *     (writing straight into the `permissionPresets` live table).
 *
 * Absorbing them here means the private shapes are named in ONE place: when dsh
 * moves them, only this file and the adapter change. Every accessor degrades to
 * a documented no-op / empty result instead of throwing, so a layout change
 * costs the feature, never the boot.
 *
 * The optional dsh modules (`dsh-sandbox`, `dsh-permission-presets`) are loaded
 * through {@link preloadRegistryModules} during the adapter's `apply()`, which
 * keeps every facade method synchronous for callers.
 *
 * @module @dsh-plugin/dsh-loader/registry-facade
 */
import { LOG_PREFIX } from '../version.js';
import type { CordisContext } from '../types.js';

/** A live tool definition as the tools registry holds it (shape kept loose on purpose). */
export interface ToolDefinitionLike {
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute?: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>;
  [key: string]: unknown;
}

/** One permission preset row as the `permissionPresets` table stores it. */
export interface PermissionPresetLike {
  sandbox: string;
  approval: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

/** The optional dsh modules the facades need, resolved once at boot. */
export interface RegistryModules {
  /** `@deepseek-ai/dsh-sandbox` — for `ESCALATION_TARGETS`. */
  sandbox?: { ESCALATION_TARGETS?: readonly string[] };
  /** `@deepseek-ai/dsh-permission-presets` — for `effectivePermissionPreset`. */
  permissionPresets?: { effectivePermissionPreset?: (events: readonly unknown[]) => string | undefined };
  /**
   * `@deepseek-ai/dsh-settings` — the settings facade DELEGATES to these rather
   * than reimplementing them. `installSettingsSection` in particular carries
   * real upstream behaviour (register `base` from the composition entry, point
   * the source thunk at the resolved scope, fall back to the entry when the
   * service goes away, all riding the scoped fiber); copying that into a shim
   * would be a bug farm.
   */
  settings?: {
    installSettingsSection?: (
      ctx: unknown,
      ns: unknown,
      schema: unknown,
      entry: unknown,
      hooks: unknown,
    ) => void;
    settingsNamespace?: (id: string) => unknown;
    SettingsConflictError?: new (...args: never[]) => Error;
  };
  /**
   * `@deepseek-ai/dsh-llm` — message-construction helpers are MODULE-level
   * exports, not service methods, so `services.get('llm')` cannot reach them.
   */
  llm?: import('./llm.js').LlmModule;
  /** `@deepseek-ai/dsh-tools` — `defineTool` / `ToolArgsError` are module-level. */
  tools?: { defineTool?: unknown; ToolArgsError?: unknown };
  /** `@deepseek-ai/dsh-timeout` — `deadline` / `MAX_TIMER_DELAY_MS`. */
  timeout?: { deadline?: unknown; MAX_TIMER_DELAY_MS?: number };
  /** `@deepseek-ai/dsh-credentials` — `credentialRef`. */
  credentials?: { credentialRef?: unknown };
  /** `@deepseek-ai/dsh-subagent` — `delegationDepthOf`. */
  subagent?: { delegationDepthOf?: unknown };
  /** `@deepseek-ai/dsh-compaction-basic` — the `BasicCompactionEngine` base class. */
  compaction?: { BasicCompactionEngine?: unknown };
}

/**
 * Load the optional dsh modules the facades proxy.
 *
 * The specifiers are held in variables so TypeScript does not try to resolve
 * them at build time: dshloader declares no `@deepseek-ai/*` dependency, and
 * these packages only exist in the dsh runtime that loads the profile.
 *
 * @returns whatever resolved; a missing module simply stays `undefined`.
 */
export async function preloadRegistryModules(): Promise<RegistryModules> {
  const load = async (specifier: string): Promise<Record<string, unknown> | undefined> => {
    try {
      return (await import(specifier)) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  };
  const [sandbox, permissionPresets, settings, llm, tools, timeout, credentials, subagent, compaction] =
    await Promise.all([
      load('@deepseek-ai/dsh-sandbox'),
      load('@deepseek-ai/dsh-permission-presets'),
      load('@deepseek-ai/dsh-settings'),
      load('@deepseek-ai/dsh-llm'),
      load('@deepseek-ai/dsh-tools'),
      load('@deepseek-ai/dsh-timeout'),
      load('@deepseek-ai/dsh-credentials'),
      load('@deepseek-ai/dsh-subagent'),
      load('@deepseek-ai/dsh-compaction-basic'),
    ]);
  return {
    sandbox: sandbox as RegistryModules['sandbox'],
    permissionPresets: permissionPresets as RegistryModules['permissionPresets'],
    settings: settings as RegistryModules['settings'],
    llm: llm as RegistryModules['llm'],
    tools: tools as RegistryModules['tools'],
    timeout: timeout as RegistryModules['timeout'],
    credentials: credentials as RegistryModules['credentials'],
    subagent: subagent as RegistryModules['subagent'],
    compaction: compaction as RegistryModules['compaction'],
  };
}

/** Marker recording which patch ids already ran against one tool definition. */
const PATCHED_BY = Symbol.for('dshloader.registry.tools.patchedBy.v1');

/** The set of patch ids already applied to a definition (created on demand). */
function patchedBy(def: ToolDefinitionLike): Set<string> {
  const holder = def as unknown as Record<PropertyKey, unknown>;
  let marks = holder[PATCHED_BY] as Set<string> | undefined;
  if (marks === undefined) {
    marks = new Set<string>();
    try {
      Object.defineProperty(def, PATCHED_BY, {
        value: marks,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    } catch {
      // Frozen definition: fall back to "always patch", which the caller's own
      // guard must then make idempotent. Better than refusing to patch at all.
      return new Set<string>();
    }
  }
  return marks;
}

/** Tool-registry accessors. */
export interface ToolsRegistryAPI {
  /** Every registered tool definition; `[]` when the registry shape is unreachable. */
  list(): ToolDefinitionLike[];
  /** One definition by tool name. */
  get(name: string): ToolDefinitionLike | undefined;
  /**
   * Run `patcher` over every registered definition now and after every
   * `tools/change`, so load order between this plugin and the tool plugins does
   * not matter.
   *
   * A definition is handed to a given `id` at most once (a non-enumerable
   * `Symbol.for` marker on the definition), which is what stops a `tools/change`
   * storm from wrapping `execute` again and again.
   *
   * @param patcher - mutates one live definition; throwing is contained and logged.
   * @param options.id - stable patch id, used for the once-per-definition marker.
   * @returns a disposer that stops the replay (already-applied patches stay).
   */
  patchAll(patcher: (def: ToolDefinitionLike) => void, options: { id: string }): () => void;
}

/** Sandbox-registry accessors. */
export interface SandboxRegistryAPI {
  /** The escalation modes escalation tools advertise; `[]` when unreachable. */
  escalationTargets(): readonly string[];
  /**
   * Advertise one extra escalation mode (idempotent).
   * @returns a disposer removing the mode again; a no-op when unreachable.
   */
  addEscalationTarget(mode: string): () => void;
}

/** Permission-preset registry accessors. */
export interface PermissionPresetsRegistryAPI {
  /** The live preset table, or `undefined` when the service is absent. */
  table(): Record<string, PermissionPresetLike> | undefined;
  /**
   * Define a preset unless the key already exists (declaration in a
   * `cordis.patch.yml` layer wins).
   * @returns a disposer removing only a preset this call actually added.
   */
  define(key: string, preset: PermissionPresetLike): () => void;
  /**
   * Fold a session's effective permission-preset key from its event log.
   * @returns the preset key, or `undefined` when the helper is unavailable.
   */
  effective(events: readonly unknown[]): string | undefined;
}

/** The `registry` facade exposed on the host API. */
export interface RegistryAPI {
  tools: ToolsRegistryAPI;
  sandbox: SandboxRegistryAPI;
  permissionPresets: PermissionPresetsRegistryAPI;
}

/** Minimal view of the private tools-registry path this facade walks. */
interface ToolsServiceLike {
  layers?: { global?: { tools?: Map<string, ToolDefinitionLike> } };
}

/**
 * Build the `ctx.dshLoader.registry` facade.
 *
 * @param opts.ctx - the cordis context (services are read lazily, never cached,
 *   so a service arriving later is still picked up).
 * @param opts.modules - optional dsh modules from {@link preloadRegistryModules}.
 */
export function createRegistryAPI(opts: {
  ctx: CordisContext;
  modules?: RegistryModules;
}): RegistryAPI {
  const { ctx, modules = {} } = opts;

  /** The private tool table, or undefined when the layout moved. */
  const toolTable = (): Map<string, ToolDefinitionLike> | undefined => {
    const tools = ctx.get('tools') as ToolsServiceLike | undefined;
    return tools?.layers?.global?.tools;
  };

  const tools: ToolsRegistryAPI = {
    list() {
      const table = toolTable();
      return table === undefined ? [] : [...table.values()];
    },
    get(name) {
      return toolTable()?.get(name);
    },
    patchAll(patcher, options) {
      const id = options.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new TypeError('dshloader.registry.tools.patchAll: options.id is required');
      }
      let warned = false;
      const run = (): void => {
        const table = toolTable();
        if (table === undefined) {
          if (!warned) {
            warned = true;
            ctx.logger?.warn?.(
              `${LOG_PREFIX}:registry.tools.patchAll("${id}") — the tool registry layout is unreachable; skipping (feature lost, boot intact)`,
            );
          }
          return;
        }
        for (const def of table.values()) {
          if (def === null || typeof def !== 'object') continue;
          const marks = patchedBy(def);
          if (marks.has(id)) continue;
          try {
            patcher(def);
            marks.add(id);
          } catch (error) {
            ctx.logger?.warn?.(
              `${LOG_PREFIX}:registry.tools.patchAll("${id}") failed on "${String(def.name)}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }
      };
      run();
      // Replay so tools registered after this plugin are patched too.
      const off = ctx.on?.('tools/change', () => run(), { prepend: true });
      return () => {
        if (typeof off === 'function') off();
      };
    },
  };

  const sandbox: SandboxRegistryAPI = {
    escalationTargets() {
      return modules.sandbox?.ESCALATION_TARGETS ?? [];
    },
    addEscalationTarget(mode) {
      const targets = modules.sandbox?.ESCALATION_TARGETS;
      if (targets === undefined) {
        ctx.logger?.warn?.(
          `${LOG_PREFIX}:registry.sandbox.addEscalationTarget("${mode}") — @deepseek-ai/dsh-sandbox is unavailable; skipping`,
        );
        return () => {};
      }
      // ESCALATION_TARGETS ships readonly; appending at runtime is exactly what
      // the escalation tools read when they build their parameter enum.
      const list = targets as unknown as string[];
      if (list.includes(mode)) return () => {};
      list.push(mode);
      return () => {
        const at = list.indexOf(mode);
        if (at >= 0) list.splice(at, 1);
      };
    },
  };

  const permissionPresets: PermissionPresetsRegistryAPI = {
    table() {
      const service = ctx.get('permissionPresets') as
        | { presets?: Record<string, PermissionPresetLike> }
        | undefined;
      return service?.presets;
    },
    define(key, preset) {
      const table = this.table();
      if (table === undefined) {
        ctx.logger?.warn?.(
          `${LOG_PREFIX}:registry.permissionPresets.define("${key}") — the permissionPresets service is absent; skipping`,
        );
        return () => {};
      }
      if (Object.hasOwn(table, key)) return () => {};
      table[key] = preset;
      return () => {
        if (table[key] === preset) delete table[key];
      };
    },
    effective(events) {
      const fold = modules.permissionPresets?.effectivePermissionPreset;
      if (typeof fold !== 'function') return undefined;
      try {
        return fold(events);
      } catch {
        return undefined;
      }
    },
  };

  return { tools, sandbox, permissionPresets };
}
