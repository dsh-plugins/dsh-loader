/**
 * Adapter registry + dsh version detection (design.md §3.1 / §3.2).
 *
 * Selection rules (mirrors design.md §3.1, five rules):
 *   1. exact match        — adapter.supports === version
 *   2. range match        — semver.satisfies(version, supports); when several
 *                           ranges cover the version, pick the narrowest; ties
 *                           broken by last-registered-wins.
 *   2b. pre-release range match — no exact/range hit and the version carries a
 *                           pre-release tag (e.g. `0.1.1-rc.2`): retry the
 *                           range match with the pre-release tag stripped
 *                           (`0.1.1`). npm semver refuses pre-release versions
 *                           unless the range contains a comparator with the
 *                           same [major,minor,patch] tuple, so `>=0.1.0-rc.1
 *                           <2.0.0` never matches `0.1.1-rc.x` even though the
 *                           intended release line is covered. Stripping the
 *                           tag restores that intent and lets the compat shim
 *                           load on ANY pre-release build of a covered line.
 *   3. nearest-low fallback — no exact/range hit, but some adapters only cover
 *                           versions below the real one: pick the one whose
 *                           upper bound is closest, mark mode 'fallback', warn.
 *   4. version too old    — real version is below every adapter's lower bound:
 *                           throw UnsupportedDshVersionError with a "too old"
 *                           message and the lowest supported version.
 *   5. version too new / empty registry — throw UnsupportedDshVersionError with
 *                           an "upgrade dshloader" message.
 *
 * Version detection priority (design.md §3.2):
 *   1. DSHLOADER_DSH_VERSION env var (highest; for tests/CI override)
 *   2. node_modules/@deepseek-ai/dsh/package.json#version
 *   3. ctx.runtime?.version — reserved for the future, NOT consulted in v1.
 * child_process `dsh --version` is deliberately NOT used (design.md §3.2).
 */
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import semver, { type SemVer } from 'semver';
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

/**
 * Parse a semver range into { lower, upper } bounds. Each bound is
 * { v: SemVer, inc: boolean } or null when unbounded on that side.
 */
function rangeBounds(range: string): {
  lower: { v: SemVer; inc: boolean } | null;
  upper: { v: SemVer; inc: boolean } | null;
} {
  const r = new semver.Range(range);
  let lower: { v: SemVer; inc: boolean } | null = null;
  let upper: { v: SemVer; inc: boolean } | null = null;
  for (const group of r.set) {
    for (const c of group) {
      const op = c.operator;
      const v = c.semver; // parsed SemVer (c.value is the raw comparator string)
      if (op === '' || op === '=') {
        lower = { v, inc: true };
        upper = { v, inc: true };
      } else if (op === '>') {
        lower = { v, inc: false };
      } else if (op === '>=') {
        lower = { v, inc: true };
      } else if (op === '<') {
        upper = { v, inc: false };
      } else if (op === '<=') {
        upper = { v, inc: true };
      }
    }
  }
  return { lower, upper };
}

/** True when every version the range covers is strictly below `version`. */
function isLowerCandidate(range: string, version: string): boolean {
  const { upper } = rangeBounds(range);
  if (!upper) return false; // unbounded above → can cover version, not a lower candidate
  return upper.inc ? semver.gt(version, upper.v) : semver.gte(version, upper.v);
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
      // The stripped release lies outside every adapter range (e.g. a future
      // major like `2.0.0-rc.1` → `2.0.0`). Keep the compat-shim promise of
      // loading on ANY dsh version: fall back to the adapter whose upper
      // bound is closest, same as rule 3 does for release versions.
      const preLowers = this.adapters
        .filter((f) => isLowerCandidate(f.supports, releaseOnly))
        .map((f) => {
          const { upper } = rangeBounds(f.supports);
          return { factory: f, upper };
        });
      if (preLowers.length > 0) {
        preLowers.sort((a, b) => {
          const cmp = semver.compare(b.upper!.v, a.upper!.v);
          if (cmp !== 0) return cmp;
          return (b.upper!.inc ? 0 : 1) - (a.upper!.inc ? 0 : 1);
        });
        const chosen = preLowers[0];
        console.warn(
          `${LOG_PREFIX} dsh ${version} is a pre-release outside every adapter range; falling back to "${chosen.factory.name}" (supports ${chosen.factory.supports})`,
        );
        return { factory: chosen.factory, mode: 'fallback' };
      }
    }

    // Rule 3: nearest-low fallback.
    const lowers = this.adapters
      .filter((f) => isLowerCandidate(f.supports, version))
      .map((f) => {
        const { upper } = rangeBounds(f.supports);
        return { factory: f, upper };
      });
    if (lowers.length > 0) {
      lowers.sort((a, b) => {
        const cmp = semver.compare(b.upper!.v, a.upper!.v);
        if (cmp !== 0) return cmp;
        // exclusive upper is "higher" than inclusive at the same version
        return (b.upper!.inc ? 0 : 1) - (a.upper!.inc ? 0 : 1);
      });
      const chosen = lowers[0];
      console.warn(
        `${LOG_PREFIX} no exact adapter for dsh ${version}; falling back to "${chosen.factory.name}" (supports ${chosen.factory.supports})`,
      );
      return { factory: chosen.factory, mode: 'fallback' };
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
