// One-shot profile injection script (design.md §3.6 / §6 / M6).
//
// `dshloader setup <profile>`:
//   - adds `@dsh-plugin/dsh-loader` to the profile package.json dependencies
//     (if missing);
//   - appends the dshloader `insert` entry to cordis.patch.yml (if missing);
//   - does NOT reorder the insert list — cordis is reactive DI, so position
//     does not affect whether service aliases / module redirects take effect
//     (design.md §1.2 / §6.2).
//
// `dshloader dump-config <profile>`: best-effort validation that runs
// `dsh --profile <name> --dump-config` when the dsh CLI is available.
//
// `dshloader info [profile]`: prints dshloader version, detected dsh version,
// selected adapter, and registered aliases (AC-OB-03, P2 — minimal).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOADER_VERSION, LOG_PREFIX } from './version.js';
import { detectDshVersion, AdapterRegistry, UnsupportedDshVersionError } from './registry.js';
import { registerHostAdapters } from './adapters/index.js';

const LOADER_PKG = '@dsh-plugin/dsh-loader';
const PATCH_ENTRY = `- id: dsh-loader\n      name: '${LOADER_PKG}'`;

export function dshHome(): string {
  const env = process.env.DSH_HOME?.trim();
  return env ? resolve(env) : join(process.env.HOME ?? '~', '.dsh');
}

export function profileDir(profileName: string): string {
  // Mirror dsh's own profile-name validation (app-boot profile.ts
  // resolveProfileDir): reject separators and dot segments so a crafted name
  // cannot escape $DSH_HOME/profiles — setupProfile WRITES into the resolved
  // directory, so an unchecked `../../…` is a path-traversal write.
  if (
    profileName === '' ||
    profileName.includes('/') ||
    profileName.includes('\\') ||
    profileName === '.' ||
    profileName === '..' ||
    // The launcher-maintained flat module fallback lives at this sibling path.
    profileName === 'node_modules'
  ) {
    throw new Error(`${LOG_PREFIX} invalid profile name ${JSON.stringify(profileName)}`);
  }
  return join(dshHome(), 'profiles', profileName);
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, undefined, 2) + '\n');
}

/** Ensure dshloader is listed in the profile package.json dependencies. */
export function injectDependency(pkgPath: string): { added: boolean; manifest: any } {
  const manifest = readJson(pkgPath) ?? { name: '', dependencies: {} };
  manifest.dependencies = manifest.dependencies ?? {};
  if (manifest.dependencies[LOADER_PKG] === undefined) {
    manifest.dependencies[LOADER_PKG] = '^' + LOADER_VERSION;
    writeJson(pkgPath, manifest);
    return { added: true, manifest };
  }
  return { added: false, manifest };
}

/** Ensure the dshloader insert entry exists in cordis.patch.yml (no reorder). */
export function injectPatch(patchPath: string): { added: boolean; text: string } {
  let text = '';
  try {
    text = readFileSync(patchPath, 'utf8');
  } catch {
    text = '';
  }
  if (text.includes('id: dsh-loader')) {
    return { added: false, text };
  }
  const insertion = `- insert:\n    ${PATCH_ENTRY}\n`;
  let next: string;
  if (text.trim().length === 0) {
    next = insertion;
  } else if (/^[ \t]*\[\][ \t]*$/m.test(text.replace(/\r\n/g, '\n').trimEnd())) {
    // The scaffold patch file is a single empty-list document. Appending a
    // second YAML document after it without a separator is a parse error
    // ("end of the stream or a document separator is expected"), so replace
    // the empty list with the real entries instead of appending after it.
    next = text.replace(/\[\][ \t]*(\r?\n)?$/, insertion);
  } else if (text.endsWith('\n') || text.endsWith('\r\n')) {
    next = text + '---\n' + insertion;
  } else {
    next = text + '\n---\n' + insertion;
  }
  writeFileSync(patchPath, next);
  return { added: true, text: next };
}

/**
 * Run `dshloader setup <profile>`.
 * @param profileName
 * @returns
 */
export function setupProfile(profileName: string): {
  profileDir: string;
  dependencyAdded: boolean;
  patchAdded: boolean;
} {
  const dir = profileDir(profileName);
  if (!existsSync(dir)) {
    throw new Error(`${LOG_PREFIX} profile directory not found: ${dir}`);
  }
  const pkgPath = join(dir, 'package.json');
  const patchPath = join(dir, 'cordis.patch.yml');
  const dep = injectDependency(pkgPath);
  const patch = injectPatch(patchPath);
  console.log(`${LOG_PREFIX} setup ${profileName}: dependency ${dep.added ? 'added' : 'already present'}, patch ${patch.added ? 'appended' : 'already present'}`);
  console.log(`${LOG_PREFIX} note: insert position is irrelevant — cordis reactive DI resolves aliases regardless of order (design.md §6.2)`);
  return { profileDir: dir, dependencyAdded: dep.added, patchAdded: patch.added };
}

/** Best-effort dump-config validation. Returns { ok, output } (never throws). */
export function dumpConfig(profileName: string): { ok: boolean; output: string } {
  const dir = profileDir(profileName);
  if (!existsSync(dir)) {
    return { ok: false, output: `${LOG_PREFIX} profile directory not found: ${dir}` };
  }
  const result = spawnSync('dsh', ['--profile', profileName, '--dump-config'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  return { ok: result.status === 0, output };
}

/** Print dshloader status for a profile (AC-OB-03, minimal). */
export function info(profileName?: string): { loaderVersion: string; dshVersion?: string } {
  console.log(`${LOG_PREFIX} version ${LOADER_VERSION}`);
  const dir = profileName ? profileDir(profileName) : undefined;
  const dshVersion = detectDshVersion(dir ? { profileDir: dir } : {});
  console.log(`${LOG_PREFIX} detected dsh version: ${dshVersion ?? '<unknown>'}`);
  if (dshVersion) {
    try {
      const reg = registerHostAdapters(new AdapterRegistry());
      const { factory, mode } = reg.select(dshVersion);
      console.log(`${LOG_PREFIX} selected adapter: ${factory.name} (supports ${factory.supports}, mode ${mode})`);
    } catch (error) {
      console.log(`${LOG_PREFIX} adapter selection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { loaderVersion: LOADER_VERSION, dshVersion };
}
