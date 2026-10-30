import { createRequire } from 'node:module';
import { detectDshVersion, AdapterRegistry } from '../registry.js';
import { registerHostAdapters } from './index.js';
import { hostPackageAliases } from './tables.js';

const require = createRequire(import.meta.url);
interface StableRuntime { version: string; adapterId: string; modules: Record<string, unknown> }
const RUNTIME = Symbol.for('dshloader.stable-host.v2');
const state = globalThis as unknown as Record<symbol, Set<StableRuntime> | undefined>;
export function installStableRuntime(runtime: StableRuntime): () => void {
  const runtimes = state[RUNTIME] ??= new Set(); runtimes.add(runtime);
  return () => { runtimes.delete(runtime); };
}
/** Both ESM and CJS entries resolve explicitly on Node 24.9+. */
export function resolveStableModule(name: string): Record<string, any> {
  const runtimes = [...(state[RUNTIME] ?? [])];
  if (new Set(runtimes.map(runtime => runtime.version)).size > 1) throw new Error('dshloader: stable import is ambiguous across active runtimes; use the owner HostAPI');
  const runtime = runtimes.at(-1);
  const version = runtime?.version ?? detectDshVersion();
  if (!version) throw new Error('dshloader: cannot detect the active dsh version for stable imports');
  const { factory } = registerHostAdapters(new AdapterRegistry()).select(version);
  const target = hostPackageAliases[`@dsh-plugin/dsh-loader/${name}`];
  if (!target) throw new Error(`dshloader: unknown stable module ${name}`);
  const module = (runtime?.modules[name === 'compaction-basic' ? 'compaction' : name] ?? require(target)) as Record<string, any>;
  return new Proxy(module, {
    get(object, symbol) {
      if (symbol === 'then') return undefined;
      if (symbol in object) return Reflect.get(object, symbol);
      return function unavailableCapability() { throw new Error(`dshloader: ${name}.${String(symbol)} is unavailable in ${factory.name} (${version})`); };
    },
  });
}
