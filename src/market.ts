import { gt, rcompare, valid } from 'semver';
import type { CordisContext } from './types.js';

interface MarketVersion {
  version: string;
  source: { type: string; registry?: string };
  compatibility: { compatible: boolean };
}
interface MarketEntry {
  name: string;
  versions: MarketVersion[];
  defaultVersion?: string;
  installation: { status: string; installedVersion?: string };
}
type Tags = Record<string, unknown>;
type ReadTags = (name: string, registry?: string) => Promise<Tags>;

/** Only tagged, indexed, compatible npm releases can become the default. */
export async function preferNewestTag(entry: MarketEntry, readTags: ReadTags): Promise<MarketEntry> {
  const registries = [...new Set(entry.versions.filter(v => v.source.type === 'npm')
    .map(v => v.source.registry ?? 'https://registry.npmjs.org/'))];
  const candidates = (await Promise.all(registries.map(async registry => {
    try {
      const tags = await readTags(entry.name, registry);
      const tagged = [tags.latest, tags.next].filter((v): v is string => typeof v === 'string' && valid(v) !== null);
      return entry.versions.filter(v => v.source.type === 'npm'
        && (v.source.registry ?? 'https://registry.npmjs.org/') === registry
        && v.compatibility.compatible && tagged.includes(v.version));
    } catch { return []; } // Offline/private registries retain the official default.
  }))).flat().sort((a, b) => rcompare(a.version, b.version));
  const selected = candidates[0];
  if (!selected || selected.version === entry.defaultVersion) return entry;
  const installation = { ...entry.installation };
  if (installation.status !== 'provided' && installation.status !== 'not-installed') {
    const installed = installation.installedVersion;
    installation.status = installed === selected.version ? 'installed'
      : installed && valid(installed) && gt(selected.version, installed) ? 'update-available' : 'different-version';
  }
  return { ...entry, defaultVersion: selected.version, installation };
}

/** Scoped to the market's default selection; explicit install requests stay exact. */
export function installMarketVersionPolicy(
  ctx: CordisContext,
  enabled: () => boolean,
  fetcher: typeof fetch = globalThis.fetch,
): () => void {
  const cache = new Map<string, { expires: number; value: Promise<Tags> }>();
  const abort = new AbortController();
  const readTags: ReadTags = (name, registry = 'https://registry.npmjs.org/') => {
    // Fetch the small tag map, not the package's entire version history.
    const escapedName = encodeURIComponent(name).replace(/^%40/, '@');
    const url = new URL(`-/package/${escapedName}/dist-tags`, registry.endsWith('/') ? registry : registry + '/').href;
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async () => {
      const response = await fetcher(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]),
        headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`npm dist-tags: ${response.status}`);
      return await response.json() as Tags;
    })();
    cache.set(url, { expires: Date.now() + 60_000, value });
    void value.catch(() => {
      // A temporary failure must not pin the official default for a minute.
      if (cache.get(url)?.value === value) cache.delete(url);
    });
    return value;
  };
  const disposers: (() => void)[] = [];
  const attach = (scope: CordisContext): void => {
    const service = scope.get('pluginMarket');
    // Cordis creates a new method proxy on each read. Patch the shared raw
    // service so identity checks on cleanup work and call-site `this` survives.
    const market = service?.[Symbol.for('cordis.original')] ?? service;
    if (!market || typeof market.search !== 'function' || typeof market.entry !== 'function') return;
    for (const method of ['search', 'entry'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(market, method);
      const original = market[method];
      let active = true;
      const wrapped = async function(this: unknown, ...args: unknown[]) {
        const result = await original.apply(this, args);
        if (!active || !enabled() || abort.signal.aborted || !result) return result;
        const selected = method === 'entry' ? await preferNewestTag(result, readTags)
          : { ...result, entries: await Promise.all(result.entries.map((entry: MarketEntry) => preferNewestTag(entry, readTags))) };
        return active && enabled() && !abort.signal.aborted ? selected : result;
      };
      market[method] = wrapped;
      const dispose = () => {
        active = false;
        if (market[method] !== wrapped) return;
        if (descriptor) Object.defineProperty(market, method, descriptor);
        else delete market[method];
      };
      scope.effect(() => dispose);
      disposers.push(dispose);
    }
  };
  const injectable = ctx as CordisContext & { inject?: (names: string[], callback: (scope: CordisContext) => void) => { dispose?: () => unknown } };
  const fork = injectable.inject?.(['pluginMarket'], attach);
  if (!injectable.inject) attach(ctx);
  return () => {
    abort.abort();
    void fork?.dispose?.();
    for (const dispose of disposers.reverse()) dispose();
    cache.clear();
  };
}
