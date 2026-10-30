import * as React from 'react';
/** Stable helpers for packages removed before the supported 0.1.5 release line. */
function service(name: string): any {
  const api = (globalThis as any).window?.__dshLoader__;
  const value = api?.services.get(name);
  if (!value) throw new Error(`dshloader: ${name} service unavailable`);
  return value;
}
export type SchemaNode = { [key: string]: unknown };
export function rehydrateSchema(value: unknown): SchemaNode { return service('settingsSchema').rehydrate(value); }
export function validateDraft(schema: SchemaNode, value: unknown): string | undefined { return service('settingsSchema').validate(schema, value); }
export function nodeAtPath(schema: SchemaNode, path: readonly string[]): SchemaNode | undefined { return service('settingsSchema').nodeAtPath(schema, path); }
export function getPath(value: unknown, path: readonly string[]): any { return path.reduce<any>((current, key) => current?.[key], value); }
export function hasPath(value: unknown, path: readonly string[]): boolean { const parent = getPath(value, path.slice(0, -1)); return parent != null && Object.hasOwn(parent, path.at(-1)!); }
export function setPath(value: Record<string, any>, path: readonly string[], next: unknown): Record<string, any> {
  if (!path.length || path.some(key => ['__proto__','constructor','prototype'].includes(key))) throw new Error('Invalid configuration path');
  const result = structuredClone(value); let current = result;
  for (const [index, key] of path.slice(0, -1).entries()) current = current[key] ??= /^\d+$/.test(path[index + 1]) ? [] : {};
  current[path.at(-1)!] = next; return result;
}
export function deletePath(value: Record<string, any>, path: readonly string[]): Record<string, any> {
  if (!path.length || path.some(key => ['__proto__','constructor','prototype'].includes(key))) throw new Error('Invalid configuration path');
  const result = structuredClone(value), parent = getPath(result, path.slice(0, -1)); if (parent != null) delete parent[path.at(-1)!]; return result;
}
function record(source: unknown): Record<string, any> | undefined { return source && typeof source === 'object' && !Array.isArray(source) ? source : undefined; }
function collect(value: unknown, key: string): string[] { return Array.isArray(value) ? [...new Set(value.map(item => record(item)?.[key]).filter((value): value is string => typeof value === 'string' && value.length > 0))] : []; }
export function sessionRecallLabels(source: unknown): string[] { const value = record(source); return value?.kind === 'session-reference' ? collect(value.references, 'label') : []; }
export function contextProvenance(source: unknown): { role: 'inject' | 'recall'; label: string | null } {
  const value = record(source), kind = value?.kind;
  if (typeof kind !== 'string' || !kind) return { role: 'inject', label: null };
  if (kind === 'session-reference') return { role: 'recall', label: sessionRecallLabels(value).join(', ') || kind };
  const label = kind === 'agent-instructions' ? collect(value!.changes, 'path').join(', ') : kind === 'plugin' ? value!.plugin : kind === 'skill-invocation' ? value!.name : kind;
  return { role: 'inject', label: typeof label === 'string' && label ? label : kind };
}
export function contextForm(source: unknown): string | null {
  const form = record(source)?.form;
  return ['instructions','catalog','snapshot','notice','relay','recall'].includes(form) ? form : null;
}
export interface HostObservable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export function bindSnapshotSelector<T>(source: HostObservable<T>) {
  const subscribe = source.subscribe.bind(source), getSnapshot = source.getSnapshot.bind(source);
  return function useSnapshot<R = T>(selector: (snapshot: T) => R = value => value as unknown as R, equal: (a: R, b: R) => boolean = Object.is): R {
    const cache = React.useRef<{ value: R }>();
    const get = () => { const next = selector(getSnapshot()); if (!cache.current || !equal(cache.current.value, next)) cache.current = { value: next }; return cache.current.value; };
    return React.useSyncExternalStore(subscribe, get, get);
  };
}
export function useInvoke(fn: () => Promise<unknown>): [() => void, boolean] {
  const action = React.useRef(fn); action.current = fn;
  const [pending, setPending] = React.useState(0);
  return [React.useCallback(() => { setPending(value => value + 1); void Promise.resolve().then(() => action.current()).catch(error => console.error(error)).finally(() => setPending(value => value - 1)); }, []), pending > 0];
}
