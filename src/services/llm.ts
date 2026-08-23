/**
 * LLM stable API (`ctx.dshLoader.llm`).
 *
 * Message CONSTRUCTION helpers are module-level exports of
 * `@deepseek-ai/dsh-llm`, not methods on a cordis service, so
 * `services.get('llm')` cannot reach them — a plugin that needs
 * `createUserMessage` would otherwise have to import `@deepseek-ai/*`
 * directly and lose its decoupling.
 *
 * Inference itself stays on the service: `services.get('llm').stream(...)`.
 * This facade deliberately covers only the module-level helpers.
 *
 * @module @dsh-plugin/dsh-loader/services/llm
 */
import { LOG_PREFIX } from '../version.js';

/** The `@deepseek-ai/dsh-llm` surface the facades forward to. */
export interface LlmModule {
  createUserMessage?: (input: unknown) => unknown;
  deepFreeze?: <T>(value: T) => T;
  /** Streaming content-block assembler; surfaced through `dshLoader.dsh.llm`. */
  BlockAssembler?: unknown;
}

/** The `llm` facade exposed on the host API. */
export interface LlmAPI {
  /**
   * Build one identified, frozen user-role message.
   *
   * @param input - complete content and source for a new user message.
   * @returns the immutable message.
   * @throws when `@deepseek-ai/dsh-llm` is unavailable — callers building a
   *   message have no meaningful fallback, so this fails loudly rather than
   *   handing back something the agent loop would reject.
   */
  createUserMessage(input: unknown): unknown;
  /**
   * Deep-freeze a value with dsh's own helper (so frozen-ness matches what the
   * runtime expects). Falls back to `Object.freeze` on the top level when the
   * module is unavailable.
   */
  deepFreeze<T>(value: T): T;
}

/** Build the `ctx.dshLoader.llm` facade. */
export function createLlmAPI(opts: { module?: LlmModule }): LlmAPI {
  const { module } = opts;
  return {
    createUserMessage(input) {
      const make = module?.createUserMessage;
      if (typeof make !== 'function') {
        throw new Error(
          `${LOG_PREFIX}:llm.createUserMessage — @deepseek-ai/dsh-llm is unavailable; cannot construct a message`,
        );
      }
      return make(input);
    },
    deepFreeze(value) {
      const freeze = module?.deepFreeze;
      if (typeof freeze === 'function') return freeze(value);
      return Object.freeze(value);
    },
  };
}
