/**
 * Module-level dsh symbols (`ctx.dshLoader.dsh`).
 *
 * Some things a plugin needs are MODULE-level exports of `@deepseek-ai/*`
 * packages rather than methods on a cordis service, so `services.get(...)`
 * cannot reach them: `defineTool`, `ToolArgsError`, `deadline`,
 * `credentialRef`, `delegationDepthOf`, and the `BasicCompactionEngine` base
 * class a plugin subclasses.
 *
 * WHY A FACADE AND NOT THE STABLE SUBPATHS: the `@dsh-plugin/dsh-loader/tools`
 * style subpaths are `export * from '@deepseek-ai/...'`, which requires that
 * package to be resolvable FROM dshloader's own location — true for a client
 * bundle (the browser module table resolves it) but not reliably true on the
 * host, where dshloader sits in the profile and dsh is installed globally. A
 * failed ESM static import is a hard boot failure; a facade degrades per symbol
 * and says why. See docs/facades.md §0.
 *
 * Resolution happens once at boot (see `preloadRegistryModules`), so every
 * accessor here is synchronous.
 *
 * @module @dsh-plugin/dsh-loader/services/dsh-symbols
 */
import { LOG_PREFIX } from '../version.js';

/** Node's `setTimeout` ceiling (2^31 - 1), used when dsh-timeout is unavailable. */
export const NODE_MAX_TIMER_DELAY_MS = 2147483647;

/** The raw modules this facade forwards to, as resolved at boot. */
export interface DshSymbolModules {
  tools?: { defineTool?: unknown; ToolArgsError?: unknown };
  timeout?: { deadline?: unknown; MAX_TIMER_DELAY_MS?: number };
  credentials?: { credentialRef?: unknown };
  subagent?: { delegationDepthOf?: unknown };
  compaction?: { BasicCompactionEngine?: unknown };
  llm?: { BlockAssembler?: unknown };
}

/**
 * Module-level dsh symbols, grouped by owning package.
 *
 * Types are deliberately loose (`any`-shaped call signatures): pinning dsh's
 * internal shapes here would defeat the shim's purpose, exactly as
 * `src/types.ts` explains for the service surfaces.
 */
export interface DshSymbolsAPI {
  tools: {
    /** `defineTool(definition)` — build a tool definition dsh's registry accepts. */
    defineTool<T>(definition: T): T;
    /** `ToolArgsError` — the error class dsh expects for invalid tool arguments. */
    readonly ToolArgsError: new (messages: string[]) => Error;
  };
  timeout: {
    /** `deadline(...)` — dsh's cancellation-aware deadline helper. */
    deadline<T>(...args: any[]): T;
    /** dsh's timer ceiling; falls back to Node's own 2^31-1 when unavailable. */
    readonly MAX_TIMER_DELAY_MS: number;
  };
  credentials: {
    /** `credentialRef(ref)` — brand a raw reference for `credentials.resolve`. */
    credentialRef(ref: unknown): unknown;
  };
  subagent: {
    /** `delegationDepthOf(agent)` — how deep a delegated agent sits. */
    delegationDepthOf(agent: unknown): number;
  };
  compaction: {
    /**
     * `BasicCompactionEngine` — the base class a plugin subclasses to override
     * `summarize`. Throws when unavailable, because a subclass declaration has
     * no meaningful fallback.
     */
    readonly BasicCompactionEngine: new (...args: any[]) => any;
  };
  llm: {
    /** `BlockAssembler` — dsh's streaming content-block assembler. */
    readonly BlockAssembler: new (...args: any[]) => any;
  };
}

/** Build a loud accessor for one required symbol. */
function required<T>(value: unknown, pkg: string, symbol: string): T {
  if (value === undefined || value === null) {
    throw new Error(
      `${LOG_PREFIX}:dsh.${symbol} — ${pkg} is unavailable in this runtime; ` +
        'the calling plugin cannot proceed without it',
    );
  }
  return value as T;
}

/** Build the `ctx.dshLoader.dsh` facade over boot-resolved modules. */
export function createDshSymbolsAPI(opts: { modules?: DshSymbolModules }): DshSymbolsAPI {
  const m = opts.modules ?? {};
  return {
    tools: {
      defineTool(definition) {
        const fn = required<(d: unknown) => unknown>(
          m.tools?.defineTool,
          '@deepseek-ai/dsh-tools',
          'tools.defineTool',
        );
        return fn(definition) as typeof definition;
      },
      get ToolArgsError() {
        return required<new (messages: string[]) => Error>(
          m.tools?.ToolArgsError,
          '@deepseek-ai/dsh-tools',
          'tools.ToolArgsError',
        );
      },
    },
    timeout: {
      deadline(...args: any[]) {
        const fn = required<(...a: any[]) => any>(
          m.timeout?.deadline,
          '@deepseek-ai/dsh-timeout',
          'timeout.deadline',
        );
        return fn(...args);
      },
      // A platform constant (Node's setTimeout ceiling), not a dsh-versioned
      // value, so falling back to the literal is safe rather than a guess.
      get MAX_TIMER_DELAY_MS() {
        return m.timeout?.MAX_TIMER_DELAY_MS ?? NODE_MAX_TIMER_DELAY_MS;
      },
    },
    credentials: {
      credentialRef(ref) {
        const fn = required<(r: unknown) => unknown>(
          m.credentials?.credentialRef,
          '@deepseek-ai/dsh-credentials',
          'credentials.credentialRef',
        );
        return fn(ref);
      },
    },
    subagent: {
      delegationDepthOf(agent) {
        const fn = required<(a: unknown) => number>(
          m.subagent?.delegationDepthOf,
          '@deepseek-ai/dsh-subagent',
          'subagent.delegationDepthOf',
        );
        return fn(agent);
      },
    },
    compaction: {
      get BasicCompactionEngine() {
        return required<new (...args: any[]) => any>(
          m.compaction?.BasicCompactionEngine,
          '@deepseek-ai/dsh-compaction-basic',
          'compaction.BasicCompactionEngine',
        );
      },
    },
    llm: {
      get BlockAssembler() {
        return required<new (...args: any[]) => any>(
          m.llm?.BlockAssembler,
          '@deepseek-ai/dsh-llm',
          'llm.BlockAssembler',
        );
      },
    },
  };
}
