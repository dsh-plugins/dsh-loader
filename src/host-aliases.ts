import Module from 'node:module';
import { AliasTable } from './lifecycle.js';

type Resolver = (request: string, ...args: any[]) => string;
const nodeModule = Module as unknown as { _resolveFilename: Resolver };
interface State { table: AliasTable; original: Resolver; hooked: Resolver; refs: number; diagnosed?: Resolver }
const KEY = Symbol.for('dshloader.host-aliases.v2');
const global = globalThis as unknown as Record<symbol, State | undefined>;

export async function installHostPackageAliases(aliases: Record<string, string>): Promise<() => void> {
  if (!Object.keys(aliases).length) return () => {};
  let state = global[KEY];
  if (!state) {
    const original = nodeModule._resolveFilename;
    const table = new AliasTable();
    const hooked: Resolver = function(this: unknown, request, ...args) { return original.call(this, table.values.get(request) ?? request, ...args); };
    state = { table, original, hooked, refs: 0 };
    global[KEY] = state;
    nodeModule._resolveFilename = hooked;
  }
  // An outer function may already delegate to us. Never re-anchor this chain.
  if (nodeModule._resolveFilename !== state.hooked && state.diagnosed !== nodeModule._resolveFilename) {
    state.diagnosed = nodeModule._resolveFilename;
    console.warn('[dshloader] Module._resolveFilename was replaced or wrapped externally. Alias updates retain the original delegate; an entirely detached hook requires a loader restart.');
  }
  const current = state;
  const remove = current.table.register(aliases);
  current.refs++;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    remove();
    if (--current.refs === 0 && nodeModule._resolveFilename === current.hooked) {
      nodeModule._resolveFilename = current.original;
      delete global[KEY];
    }
  };
}
