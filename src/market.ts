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
    const url = new URL(encodeURIComponent(name), registry.endsWith('/') ? registry : registry + '/').href;
    const cached = cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = (async () => {
      const response = await fetcher(url, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
        headers: { accept: 'application/vnd.npm.install-v1+json' } });
      if (!response.ok) throw new Error(`npm metadata: ${response.status}`);
      const manifest = await response.json() as { 'dist-tags'?: Tags };
      return manifest['dist-tags'] ?? {};
    })();
    cache.set(url, { expires: Date.now() + 60_000, value });
    return value;
  };
  const disposers: (() => void)[] = [];
  const attach = (scope: CordisContext): void => {
    const market = scope.get('pluginMarket');
    if (!market || typeof market.search !== 'function' || typeof market.entry !== 'function') return;
    for (const method of ['search', 'entry'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(market, method);
      const original = market[method];
      const wrapped = async function(this: unknown, ...args: unknown[]) {
        const result = await original.apply(this, args);
        if (!enabled() || abort.signal.aborted || !result) return result;
        if (method === 'entry') return preferNewestTag(result, readTags);
        return { ...result, entries: await Promise.all(result.entries.map((entry: MarketEntry) => preferNewestTag(entry, readTags))) };
      };
      market[method] = wrapped;
      const dispose = () => {
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
