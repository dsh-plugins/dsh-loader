/** Host-only adapter selection. Built-ins match one patch (including prereleases).
 * Unknown patches never fall back. Environment override is available for tests and diagnostics.
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import semver from 'semver';
import { LOG_PREFIX } from './version.js';
import type { AdapterFactory, AdapterSelection } from './types.js';

const require = createRequire(import.meta.url);

interface DshVersionOptions {
  profileDir?: string;
  dshPkgPath?: string;
  env?: typeof process.env;
}

export class UnsupportedDshVersionError extends Error {
  kind?: string; // 'too-old' | 'too-new'
  version?: string;
  minSupported?: string | null;

  constructor(
    message: string,
    opts: { kind?: string; version?: string; minSupported?: string | null } = {},
  ) {
    super(message);
    this.name = 'UnsupportedDshVersionError';
    this.kind = opts.kind;
    this.version = opts.version;
    this.minSupported = opts.minSupported;
  }
}

export class InvalidVersionError extends Error {
  version?: string;

  constructor(message: string, opts: { version?: string } = {}) {
    super(message);
    this.name = 'InvalidVersionError';
    this.version = opts.version;
  }
}

/**
 * Resolve the installed dsh version.
 *
 * @returns semver version string, or undefined when unreachable
 */
export function detectDshVersion(opts: DshVersionOptions = {}): string | undefined {
  const env = opts.env ?? process.env;
  const envVal = env.DSHLOADER_DSH_VERSION;
  if (typeof envVal === 'string' && envVal.trim() !== '') {
    return envVal.trim();
  }
  const candidates: string[] = [];
  if (opts.dshPkgPath) candidates.push(opts.dshPkgPath);
  if (opts.profileDir) {
    candidates.push(join(opts.profileDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));
  }
  // Resolve from the loader's own location (profile node_modules sits beside it).
  try {
    candidates.push(require.resolve('@deepseek-ai/dsh/package.json'));
  } catch { /* not installed — skip */ }
  // Global node_modules — dsh is typically installed globally (the runtime
  // that loads profiles, not a profile dependency). Derive from the Node.js
  // executable: /opt/homebrew/bin/node → /opt/homebrew/lib/node_modules.
  const globalRoot = resolve(dirname(process.execPath), '..', 'lib', 'node_modules');
  candidates.push(join(globalRoot, '@deepseek-ai', 'dsh', 'package.json'));
  // Walk up from cwd as a last resort.
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    candidates.push(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'));
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  for (const path of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string' && pkg.version.trim() !== '') {
        return pkg.version.trim();
      }
    } catch { /* try next */ }
  }
  return undefined;
}

/** Lowest version that satisfies the range (semver.minVersion). */
function rangeMinVersion(range: string): string | null {
  const min = semver.minVersion(range);
  return min ? min.version : null;
}

export class AdapterRegistry {
  adapters: AdapterFactory[];

  constructor() {
    this.adapters = [];
  }

  register(factory: AdapterFactory): this {
    if (!factory || typeof factory.supports !== 'string' || typeof factory.create !== 'function') {
      throw new TypeError('AdapterFactory must expose { supports: string, create: function }');
    }
    this.adapters.push(factory);
    return this;
  }

  select(version: string): AdapterSelection {
    if (!semver.valid(version)) {
      throw new InvalidVersionError(
        `${LOG_PREFIX} cannot parse dsh version "${version}" as semver`,
        { version },
      );
    }
    if (this.adapters.length === 0) {
      throw new UnsupportedDshVersionError(
        `${LOG_PREFIX} no adapter registered for dsh ${version}; please upgrade @dsh-plugin/dsh-loader`,
        { kind: 'too-new', version },
      );
    }

    // Rule 1 + 2: exact and range matches.
    const matches: AdapterSelection[] = [];
    for (const factory of this.adapters) {
      if (factory.supports === version) {
        matches.push({ factory, mode: 'exact' });
      } else if (semver.satisfies(version, factory.supports)) {
        matches.push({ factory, mode: 'range' });
      }
    }
    if (matches.length > 0) {
      // Narrowest range wins; tie → last registered.
      let best = matches[matches.length - 1];
      for (let i = matches.length - 1; i >= 0; i -= 1) {
        const candidate = matches[i];
        const narrowest = matches.every((other, j) => {
          if (i === j) return true;
          try {
            return semver.subset(candidate.factory.supports, other.factory.supports);
          } catch {
            return false;
          }
        });
        if (narrowest) {
          best = candidate;
          break;
        }
      }
      // Exact match always beats a range match on the same version.
      const exact = matches.find((m) => m.mode === 'exact');
      if (exact) best = exact;
      return { factory: best.factory, mode: best.mode };
    }

    // Rule 2b: pre-release range match. npm semver refuses a pre-release
    // version unless the range carries a comparator with the same
    // [major,minor,patch] tuple, so `>=0.1.0-rc.1 <2.0.0` never matches
    // `0.1.1-rc.x` even though the release line is intended to be covered.
    // Retry with the pre-release tag stripped so ANY pre-release build of a
    // covered line loads (compat-shim guarantee).
    const parsed = semver.parse(version);
    if (parsed !== null && parsed.prerelease.length > 0) {
      const releaseOnly = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
      const prereleaseMatches: AdapterSelection[] = [];
      for (const factory of this.adapters) {
        if (semver.satisfies(releaseOnly, factory.supports)) {
          prereleaseMatches.push({ factory, mode: 'range' });
        }
      }
      if (prereleaseMatches.length > 0) {
        let best = prereleaseMatches[prereleaseMatches.length - 1];
        for (let i = prereleaseMatches.length - 1; i >= 0; i -= 1) {
          const candidate = prereleaseMatches[i];
          const narrowest = prereleaseMatches.every((other, j) => {
            if (i === j) return true;
            try {
              return semver.subset(candidate.factory.supports, other.factory.supports);
            } catch {
              return false;
            }
          });
          if (narrowest) {
            best = candidate;
            break;
          }
        }
        console.warn(
          `${LOG_PREFIX} dsh ${version} is a pre-release; matched adapter "${best.factory.name}" via release ${releaseOnly} (supports ${best.factory.supports})`,
        );
        return { factory: best.factory, mode: 'range' };
      }
    }

    // Rule 4 vs 5: too old vs too new.
    const minVersions = this.adapters
      .map((f) => rangeMinVersion(f.supports))
      .filter((v): v is string => v !== null)
      .map((v) => semver.parse(v)!);
    if (minVersions.length > 0) {
      const lowest = minVersions.reduce((acc, v) => (semver.lt(v, acc) ? v : acc));
      if (semver.lt(version, lowest)) {
        throw new UnsupportedDshVersionError(
          `${LOG_PREFIX} current dsh version ${version} is too old; dshloader minimum supported is ${lowest.version}. Please upgrade dsh or use an older dshloader release.`,
          { kind: 'too-old', version, minSupported: lowest.version },
        );
      }
    }
    throw new UnsupportedDshVersionError(
      `${LOG_PREFIX} no adapter covers dsh ${version}; please upgrade @dsh-plugin/dsh-loader`,
      { kind: 'too-new', version },
    );
  }
}
