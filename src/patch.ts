/**
 * The dshloader PATCH protocol (`ctx.dshLoader.patch` / `__dshLoader__.patch`).
 *
 * Monkey-patching a host method or global is the only way to intervene in
 * behaviour dsh exposes no extension point for. Three plugins in this family
 * each hand-rolled the protocol and they did NOT agree:
 *
 *   - dsh-loader's own `Module._resolveFilename` hook  → identity-checked restore
 *   - dsh-network-settings' `globalThis.fetch` wrapper → identity-checked restore
 *   - dsh-better-sidebar's `workspaces.openPath` wrap  → UNCONDITIONAL restore
 *
 * The last one silently destroys a later plugin's wrapper when it disposes
 * first, even though its own comment promised the opposite. This module is the
 * single correct implementation; every patch site delegates here.
 *
 * The five guarantees:
 *
 *  1. RAW original — each patch captures EXACTLY the value present when it
 *     installed (another plugin's wrapper when one is already there) and
 *     restores that value verbatim, never a bound copy. This is what lets a
 *     chain of wrappers survive disposal in any order.
 *  2. Identity-checked restore — disposal only reverts the slot when it still
 *     holds OUR wrapper. If somebody patched on top afterwards, we leave the
 *     chain alone (reverting would delete their wrapper).
 *  3. Re-apply safety — re-applying the same `id` recovers the true original
 *     first, so HMR / repeated `apply()` can never nest a wrapper in itself.
 *     This holds while our patch is the OUTERMOST one; if a foreign patch was
 *     layered on top in between, re-applying chains instead (un-nesting a
 *     middle wrapper is not possible without rebuilding the whole chain).
 *  4. Cross-instance durability — slot bookkeeping lives in a WeakMap parked on
 *     `globalThis` under a `Symbol.for` key, so a reloaded module instance still
 *     sees the original captured by its predecessor. Targets are never mutated.
 *  5. Loud misuse — patching a non-function method, or a missing target, throws
 *     instead of silently no-op'ing.
 *
 * Pure and environment-agnostic: no DOM, no Node builtins, so the same module
 * serves the host half and the browser half.
 *
 * @module @dsh-plugin/dsh-loader/patch
 */

/** Bookkeeping for one patched slot. */
interface PatchSlot {
  /** The value that was in the slot before ANY dshloader patch touched it. */
  original: unknown;
  /** The wrapper this slot currently carries (identity anchor for restore). */
  wrapper: unknown;
  /** Caller-supplied patch id, used for re-apply detection and diagnostics. */
  id: string;
}

/** Per-target slot table: property key → bookkeeping. */
type SlotTable = Map<PropertyKey, PatchSlot>;

/**
 * Registry key on `globalThis`. `Symbol.for` (not a fresh Symbol) so a
 * re-instantiated module — HMR, a second bundle copy — finds the same registry
 * and therefore the same captured originals.
 */
const REGISTRY_KEY = Symbol.for('dshloader.patch.registry.v1');

/** The process-wide patch registry (targets are keys; nothing is written onto them). */
function registry(): WeakMap<object, SlotTable> {
  const scope = globalThis as unknown as Record<PropertyKey, unknown>;
  let found = scope[REGISTRY_KEY] as WeakMap<object, SlotTable> | undefined;
  if (found === undefined) {
    found = new WeakMap<object, SlotTable>();
    scope[REGISTRY_KEY] = found;
  }
  return found;
}

/** The slot table for one target, created on first use. */
function slotsOf(target: object): SlotTable {
  const reg = registry();
  let table = reg.get(target);
  if (table === undefined) {
    table = new Map<PropertyKey, PatchSlot>();
    reg.set(target, table);
  }
  return table;
}

/** A live patch, disposed through {@link PatchHandle.dispose}. */
export interface PatchHandle {
  /** Remove this patch when the slot still carries its wrapper (idempotent). */
  dispose(): void;
  /** Whether the target slot still carries this patch's wrapper. */
  readonly active: boolean;
  /** The raw value captured before any dshloader patch touched the slot. */
  readonly original: unknown;
}

/** Options shared by every patch entry point. */
export interface PatchOptions {
  /**
   * Stable patch id. Re-applying the same id on the same slot recovers the
   * true original before re-wrapping (guarantee 3), so HMR cannot nest
   * wrappers. Defaults to `'anonymous'` — pass a real id (`'<plugin>:<what>'`)
   * for any patch that can be re-applied.
   */
  id?: string;
}

/** Read the current value of `target[key]` without tripping getters twice. */
function read(target: object, key: PropertyKey): unknown {
  return (target as Record<PropertyKey, unknown>)[key];
}

/** Write `target[key]`, surfacing a frozen / read-only slot as a loud error. */
function write(target: object, key: PropertyKey, value: unknown, what: string): void {
  try {
    (target as Record<PropertyKey, unknown>)[key] = value;
  } catch (cause) {
    throw new Error(
      `dshloader.patch: cannot write ${what} — the slot is read-only or frozen`,
      { cause },
    );
  }
  if (read(target, key) !== value) {
    // A non-writable data property assigns silently in sloppy mode.
    throw new Error(`dshloader.patch: writing ${what} had no effect — the slot is not writable`);
  }
}

/**
 * Build the handle for one installed slot. Kept separate so a re-apply of the
 * same id can hand back a handle over the existing bookkeeping.
 */
function makeHandle(target: object, key: PropertyKey, slot: PatchSlot): PatchHandle {
  return {
    get active(): boolean {
      return read(target, key) === slot.wrapper;
    },
    get original(): unknown {
      return slot.original;
    },
    dispose(): void {
      // Guarantee 2: only revert while the slot still carries OUR wrapper.
      if (read(target, key) !== slot.wrapper) return;
      write(target, key, slot.original, `${String(key)} (restore)`);
      const table = registry().get(target);
      if (table?.get(key) === slot) table.delete(key);
    },
  };
}

/**
 * Patch one slot of `target`. The low-level primitive behind
 * {@link PatchAPI.method} and {@link PatchAPI.global}.
 *
 * @param target - object owning the slot (a service instance, `globalThis`, …).
 * @param key - property key to wrap.
 * @param wrap - receives the value currently in the slot (the previous wrapper
 *   when another patch is already installed — chaining is intended) and returns
 *   the replacement.
 * @param options - see {@link PatchOptions}.
 * @returns the handle whose `dispose()` reverts this patch.
 */
export function patchSlot<T = unknown>(
  target: object,
  key: PropertyKey,
  wrap: (original: T) => T,
  options: PatchOptions = {},
): PatchHandle {
  if (target === null || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError(`dshloader.patch: target must be an object, received ${typeof target}`);
  }
  if (typeof wrap !== 'function') {
    throw new TypeError('dshloader.patch: wrap must be a function');
  }
  const id = options.id ?? 'anonymous';
  const table = slotsOf(target);
  const existing = table.get(key);

  // Guarantee 3: a re-apply of the same id must not wrap our own wrapper.
  // Restore the captured original first, then patch the pristine slot.
  if (existing !== undefined && existing.id === id && read(target, key) === existing.wrapper) {
    write(target, key, existing.original, `${String(key)} (re-apply reset)`);
    table.delete(key);
  }

  const current = read(target, key);
  if (typeof current !== 'function') {
    throw new TypeError(
      `dshloader.patch: ${String(key)} is ${current === undefined ? 'missing' : typeof current}, not a function`,
    );
  }

  // Guarantee 1: capture EXACTLY the value present at install time. When another
  // plugin already wrapped this slot, that wrapper is our original and restoring
  // it is what keeps their patch alive (see the ordered-disposal tests).
  const original = current;

  const wrapper = wrap(current as T);
  if (typeof wrapper !== 'function') {
    throw new TypeError('dshloader.patch: wrap must return a function');
  }
  write(target, key, wrapper, String(key));

  const slot: PatchSlot = { original, wrapper, id };
  table.set(key, slot);
  return makeHandle(target, key, slot);
}

/** Whether a dshloader patch is currently installed on `target[key]`. */
export function isPatched(target: object, key: PropertyKey): boolean {
  const slot = registry().get(target)?.get(key);
  return slot !== undefined && read(target, key) === slot.wrapper;
}

/** The patch id currently installed on `target[key]`, or `undefined`. */
export function patchIdOf(target: object, key: PropertyKey): string | undefined {
  const slot = registry().get(target)?.get(key);
  return slot !== undefined && read(target, key) === slot.wrapper ? slot.id : undefined;
}

/** The stable `patch` facade exposed on the host and browser APIs. */
export interface PatchAPI {
  /**
   * Wrap a method of a service / object.
   *
   * ```ts
   * const handle = ctx.dshLoader.patch.method(
   *   workspaces, 'openPath',
   *   original => (path: string) => takeover(path) ?? original.call(workspaces, path),
   *   { id: 'better-sidebar:openPath' },
   * )
   * ```
   */
  method<T extends object, K extends keyof T>(
    target: T,
    key: K,
    wrap: (original: T[K]) => T[K],
    options?: PatchOptions,
  ): PatchHandle;
  /**
   * Wrap a global function such as `fetch`. Defaults to `globalThis`; pass
   * `scope` for `window` or a test double.
   *
   * ```ts
   * ctx.dshLoader.patch.global('fetch',
   *   original => (input, init) => original(rewrite(input), init),
   *   { id: 'network-settings:fetch' })
   * ```
   */
  global<T = unknown>(
    key: PropertyKey,
    wrap: (original: T) => T,
    options?: PatchOptions & { scope?: object },
  ): PatchHandle;
  /** Low-level primitive; `method`/`global` are thin wrappers over it. */
  slot<T = unknown>(
    target: object,
    key: PropertyKey,
    wrap: (original: T) => T,
    options?: PatchOptions,
  ): PatchHandle;
  /** Whether a dshloader patch currently occupies `target[key]`. */
  isPatched(target: object, key: PropertyKey): boolean;
  /** The patch id currently occupying `target[key]`, if any. */
  patchIdOf(target: object, key: PropertyKey): string | undefined;
}

/** Build the `patch` facade. Stateless — all bookkeeping is in the global registry. */
export function createPatchAPI(): PatchAPI {
  return {
    method(target, key, wrap, options) {
      return patchSlot(target, key as PropertyKey, wrap as (original: unknown) => unknown, options);
    },
    global(key, wrap, options = {}) {
      const scope = options.scope ?? (globalThis as unknown as object);
      return patchSlot(scope, key, wrap as (original: unknown) => unknown, options);
    },
    slot(target, key, wrap, options) {
      return patchSlot(target, key, wrap as (original: unknown) => unknown, options);
    },
    isPatched,
    patchIdOf,
  };
}
