/** Function patches remain inert even when a foreign wrapper retains them. */
import type { ResourceOwner } from './lifecycle.js';
interface Layer { original: Function; wrapper: Function; active: boolean; id: string }
interface Registry { slots: WeakMap<object, Map<PropertyKey, Set<Layer>>>; layers: WeakMap<Function, Layer> }
const KEY = Symbol.for('dshloader.patch.registry.v2');
function registry(): Registry {
  const scope = globalThis as unknown as Record<symbol, Registry>;
  return scope[KEY] ??= { slots: new WeakMap(), layers: new WeakMap() };
}
function unwrap(fn: Function): Function {
  let layer = registry().layers.get(fn);
  while (layer && !layer.active) { fn = layer.original; layer = registry().layers.get(fn); }
  return fn;
}
export interface PatchHandle {
  dispose(): void;
  /** Active even when a foreign wrapper has been installed on top. */
  readonly active: boolean;
  readonly original: unknown;
}
export interface PatchOptions { id?: string; owner?: ResourceOwner }
export function patchSlot<T = unknown>(target: object, key: PropertyKey, wrap: (original: T) => T, options: PatchOptions = {}): PatchHandle {
  if (target === null || !['object', 'function'].includes(typeof target)) throw new TypeError('dshloader.patch: target must be an object');
  if (typeof wrap !== 'function') throw new TypeError('dshloader.patch: wrap must be a function');
  const object = target as Record<PropertyKey, unknown>;
  const current = object[key];
  if (typeof current !== 'function') throw new TypeError(`dshloader.patch: ${String(key)} is ${typeof current}, not a function`);
  const reg = registry();
  let table = reg.slots.get(target);
  if (!table) reg.slots.set(target, table = new Map());
  let layers = table.get(key);
  if (!layers) table.set(key, layers = new Set());
  const previous = options.id ? [...layers].filter(layer => layer.id === options.id && layer.active) : [];
  const original = unwrap(current);
  const implementation = wrap(original as T);
  if (typeof implementation !== 'function') throw new TypeError('dshloader.patch: wrap must return a function');
  const layer: Layer = { original, wrapper: undefined as unknown as Function, active: true, id: options.id ?? 'anonymous' };
  layer.wrapper = new Proxy(original, {
    apply(_target, self, args) { return Reflect.apply(layer.active ? implementation : unwrap(original), self, args); },
    construct(_target, args, newTarget) { return Reflect.construct(layer.active ? implementation : unwrap(original), args, newTarget); },
  });
  try { object[key] = layer.wrapper; } catch (cause) { throw new Error('dshloader.patch: slot is read-only or frozen', { cause }); }
  if (object[key] !== layer.wrapper) throw new Error('dshloader.patch: slot is not writable');
  for (const old of previous) { old.active = false; layers.delete(old); }
  layers.add(layer);
  reg.layers.set(layer.wrapper, layer);
  const handle: PatchHandle = {
    get active() { return layer.active; },
    get original() { return unwrap(original); },
    dispose() {
      if (!layer.active) return;
      layer.active = false;
      layers!.delete(layer);
      if (object[key] === layer.wrapper) object[key] = unwrap(original);
      if (!layers!.size) table!.delete(key);
    },
  };
  try { options.owner?.effect(() => handle.dispose); } catch (error) { handle.dispose(); throw error; }
  return handle;
}
export function isPatched(target: object, key: PropertyKey): boolean {
  return [...(registry().slots.get(target)?.get(key) ?? [])].some(layer => layer.active);
}
export function patchIdOf(target: object, key: PropertyKey): string | undefined {
  const layer = registry().layers.get((target as Record<PropertyKey, Function>)[key]);
  return layer?.active ? layer.id : undefined;
}
export interface PatchAPI {
  method<T extends object, K extends keyof T>(target: T, key: K, wrap: (original: T[K]) => T[K], options?: PatchOptions): PatchHandle;
  global<T = unknown>(key: PropertyKey, wrap: (original: T) => T, options?: PatchOptions & { scope?: object }): PatchHandle;
  slot: typeof patchSlot;
  isPatched: typeof isPatched;
  patchIdOf: typeof patchIdOf;
}
export function createPatchAPI(owner?: ResourceOwner): PatchAPI {
  return {
    method: (target, key, wrap, options) => patchSlot(target, key, wrap, { owner, ...options }),
    global: (key, wrap, options = {}) => patchSlot(options.scope ?? globalThis, key, wrap, { owner, ...options }),
    slot: (target, key, wrap, options) => patchSlot(target, key, wrap, { owner, ...options }), isPatched, patchIdOf,
  };
}
