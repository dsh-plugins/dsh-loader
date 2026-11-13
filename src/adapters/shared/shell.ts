/**
 * The shell / sandbox capability facades (`ctx.dshLoader.shell` and
 * `ctx.dshLoader.sandbox`).
 *
 * A third-party plugin that implements its own `ctx.shell` has to subclass the
 * local executor this host actually installed (`@deepseek-ai/dsh-pwsh-local` /
 * `@deepseek-ai/dsh-bash-local`); reimplementing deadlines, output caps, spill
 * files, and process-tree termination is not an option. But the host moved that
 * executor seam twice between 0.1.5 and 0.2.2 (`run`/`start` became `execute`),
 * and `ctx.sandbox.confine` turned from a synchronous return into a Promise.
 * Making every plugin test the host version would bake dsh's internal shapes
 * into each of them.
 *
 * The facades collapse those differences into two entry points:
 *   - `shell.base(options)` returns an executor class a plugin can hand straight
 *     to `ctx.plugin()`; the plugin supplies only `shellArgv(spec)` (which shell
 *     to run and how to build its argv is its own business) and inherits
 *     everything else (deadline, output cap, kill, onProcessDone) from the host
 *     superclass;
 *   - `sandbox` normalizes `confine` (an older synchronous return is still
 *     delivered as a Promise), result classification, and the escalation
 *     vocabulary, so a plugin never imports a value from
 *     `@deepseek-ai/dsh-sandbox`.
 *
 * Upstream modules are resolved dynamically by `preloadRegistryModules` during
 * the adapter's `apply()`, and no specifier takes part in compile-time
 * resolution: dshloader declares no `@deepseek-ai/*` dependency, and these
 * packages exist only inside the dsh runtime that loads this plugin. Absence
 * degrades per capability (the feature is lost, boot is not) and every facade
 * member says so in its own message.
 *
 * @module @dsh-plugin/dsh-loader/shell-facade
 */
import { accessSync, constants, statSync } from 'node:fs';
import { LOG_PREFIX } from '../../version.js';
import type { CordisContext } from '../../types.js';
import type { ShellMetadata } from '../metadata.js';
import { SHELL_LOCAL_PACKAGES } from '../metadata.js';
import type { RegistryModules } from './registry.js';

export type { ShellLocalPackages, ShellMetadata, ShellSeam } from '../metadata.js';

/** The host's execution-platform word, the same one `ctx.subprocess.terminalEnvironment().platform` reports. */
export type ShellPlatform = 'windows' | 'posix';

/** The only part of the patch metadata the facade reads, so the whole PatchMetadata stays out of the runtime. */
export interface ShellMetadataSource {
  shell?: ShellMetadata;
}

/**
 * The complete spec for one call: only the fields the facade can see.
 *
 * The upstream `ShellExecSpec` type is deliberately not used here, because it
 * drifts with the host version while `shellArgv(spec)` is a hook the PLUGIN
 * implements — it only needs to know which fields it may safely read.
 */
export interface ShellSpecLike {
  readonly command: string;
  readonly workdir: string;
  readonly timeoutMs: number;
  readonly onExpiry: 'kill' | 'none';
  readonly stdoutMaxBytes: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  readonly env?: Record<string, string>;
  readonly dshEnv?: Record<string, string>;
  readonly sandboxPolicy?: SandboxPolicyLike;
}

/** The sandbox policy carried per call; the facade interprets only `mode` and passes the rest through. */
export interface SandboxPolicyLike {
  readonly mode: string;
  readonly workspaceRoot: string;
  readonly additionalWritableRoots?: readonly string[];
  readonly sessionId?: unknown;
}

/** An argv already wrapped by `ctx.sandbox.confine`, plus the evidence settlement classification needs. */
export interface ConfinedArgvLike {
  argv: string[];
  enforcement: string;
  denialSignatures: readonly string[];
  runnerFailureRules: readonly unknown[];
}

/** The input to `shell.base()`: the one hook a plugin must supply. */
export interface ShellBaseOptions {
  /** Build the complete argv for one call, executable included. */
  shellArgv(spec: ShellSpecLike): readonly string[];
}

/**
 * The shape of the generated executor class.
 *
 * The loose typing (constructor and members taking/returning `any`) is
 * deliberate: the host superclass's type changes between releases, and pinning
 * one version's exact signature here would make the facade drift with the host,
 * which is the very thing it exists to prevent.
 */
export type ShellExecutorClass = abstract new (ctx: any, config?: any) => any;

/** The host facade `ctx.dshLoader.shell`. */
export interface ShellFacade {
  /** The host's execution-platform word (same as `ctx.subprocess.terminalEnvironment().platform`). */
  platform(): ShellPlatform;
  /** The package name of this platform's local executor, for diagnostics. */
  localPackage(): string;
  /**
   * The normalized base class: an executor class ready for `ctx.plugin()`.
   *
   * It subclasses the host's own local executor (pwsh-local / bash-local) and
   * unifies the seams behind one hook,
   * `shellArgv(spec) => readonly string[]`. `undefined` means this host lacks
   * the local executor package or the patch declares no shell metadata, and the
   * caller must fail loudly.
   */
  base(options: ShellBaseOptions): ShellExecutorClass | undefined;
  /** `parseExitStatus` (a module-level export of `@deepseek-ai/dsh-shell`). Returns the text alone when absent. */
  parseExitStatus(text: string): { body: string; exitCode?: number; signal?: string };
  /** `candidatePwshPaths` (`@deepseek-ai/dsh-pwsh-local`). Returns `[]` when absent. */
  candidatePwshPaths(env?: NodeJS.ProcessEnv): string[];
}

/** The input to `sandbox.classify`: equivalent to the three module-level exports of older hosts. */
export interface SandboxClassifyInput {
  exitCode: number | null;
  stderr: string;
  signatures: readonly string[];
  rules: readonly unknown[];
}

/** The sandbox facade `ctx.dshLoader.sandbox`. */
export interface SandboxFacade {
  /** The modes this session/deployment may escalate to; `[]` when absent. */
  escalationTargets(): readonly string[];
  /** `validateEscalationArgs`; throws a capability error when absent. */
  validateEscalationArgs(mode: unknown, justification: unknown): void;
  /** `approveEscalation`; throws a capability error when absent. */
  approveEscalation(request: unknown, context: unknown): Promise<string>;
  /** `SandboxUnavailableError`; falls back to an Error carrying the `SANDBOX_UNAVAILABLE` code. */
  unavailableError(mode: string, detail: string): Error;
  /** The denial-marker builder; throws a capability error when absent, since a host without a sandbox cannot produce that fact. */
  denialMarker(mode: string): string;
  /** The escalation-hint-marker builder; throws a capability error when absent. */
  escalationHintMarker(subject: string): string;
  /** Normalized result classification: equivalent to the three module-level exports of older hosts. */
  classify(input: SandboxClassifyInput): { denied: boolean; runnerFailure?: string };
  /** The normalized argv-wrapping entry: an older synchronous result is still delivered as a Promise. */
  confine(argv: readonly string[], policy: unknown, signal?: AbortSignal): Promise<ConfinedArgvLike>;
}

/** The error code `@deepseek-ai/dsh-sandbox` uses; the facade carries it itself when the module is absent. */
const SANDBOX_UNAVAILABLE_CODE = 'SANDBOX_UNAVAILABLE';

/** The rule shape `classifyRunnerFailure` takes on older hosts. */
interface RunnerFailureRuleLike {
  readonly allowedExitCodes?: readonly number[];
  readonly informationalLines?: readonly string[];
  readonly fatalSignatures: readonly string[];
}

/** Whether a rule is safe to use for local classification; a rule missing fields is ignored so a failed command is never misread as a runner failure. */
function isRunnerFailureRule(value: unknown): value is RunnerFailureRuleLike {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { allowedExitCodes?: unknown; informationalLines?: unknown; fatalSignatures?: unknown };
  if (!Array.isArray(candidate.fatalSignatures)) return false;
  if (!candidate.fatalSignatures.every(entry => typeof entry === 'string')) return false;
  if (candidate.allowedExitCodes !== undefined && !Array.isArray(candidate.allowedExitCodes)) return false;
  if (candidate.informationalLines !== undefined && !Array.isArray(candidate.informationalLines)) return false;
  return true;
}

/** Render an arbitrary error value as a single log line. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A local implementation of `matchesSignature`, which older dsh-sandbox releases do not export. */
function localMatchesSignature(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null || exitCode === 0) return false;
  const lowered = stderr.toLowerCase();
  return signatures.some(signature => lowered.includes(signature.toLowerCase()));
}

/**
 * A local implementation of `classifyRunnerFailure`.
 *
 * The rule semantics must match upstream case for case: a nonzero exit, the
 * optional exit-code gate, informational lines excluded by whole-line equality,
 * and a case-insensitive substring match per line. Getting the gate wrong would
 * report a command's own failure as a runner failure and send the tool layer
 * down a repair path that does not exist.
 */
function localRunnerFailure(exitCode: number | null, stderr: string, rules: readonly unknown[]): string | undefined {
  if (exitCode === null || exitCode === 0) return undefined;
  const lines = stderr.split(/\r?\n/);
  for (const rule of rules.filter(isRunnerFailureRule)) {
    if (rule.allowedExitCodes !== undefined && !rule.allowedExitCodes.includes(exitCode)) continue;
    const informational = new Set((rule.informationalLines ?? []).map(line => line.toLowerCase()));
    const fatal = rule.fatalSignatures
      .filter(signature => signature.trim().length > 0)
      .map(signature => signature.toLowerCase());
    for (const line of lines) {
      const lowered = line.toLowerCase();
      if (informational.has(lowered)) continue;
      if (fatal.some(signature => lowered.includes(signature))) return line;
    }
  }
  return undefined;
}

/** The classification entry point: prefer the host module-level export, fall back to the local equivalent. */
function classifyRunnerFailureDetail(
  modules: RegistryModules,
  exitCode: number | null,
  stderr: string,
  rules: readonly unknown[],
): string | undefined {
  const classify = modules.sandbox?.classifyRunnerFailure;
  if (typeof classify === 'function') {
    const match = classify(exitCode, stderr, rules);
    return match === undefined ? undefined : match.detail;
  }
  return localRunnerFailure(exitCode, stderr, rules);
}

/** Denial detection: likewise prefer the module-level export. */
function matchesDenialSignature(
  modules: RegistryModules,
  exitCode: number | null,
  stderr: string,
  signatures: readonly string[],
): boolean {
  const matches = modules.sandbox?.matchesSignature;
  if (typeof matches === 'function') return matches(exitCode, stderr, signatures);
  return localMatchesSignature(exitCode, stderr, signatures);
}

/** Whether the caller's spawn working directory is usable right now; when it is not, an errno cannot be attributed to the runner. */
function isUsableWorkdir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    // The directory is missing or not enterable, so this spawn's failure may come
    // from the cwd; with no such evidence the runner attribution is withheld.
    return false;
  }
}

/**
 * A local implementation of the runner-spawn-failure test.
 *
 * Older dsh-sandbox releases do not export `isRunnerSpawnFailure`, yet the fact
 * decides whether a foreground call throws `SANDBOX_UNAVAILABLE` or rethrows the
 * original error, so its semantics cannot be dropped. It is recomputed here
 * from the same evidence: Node's EACCES/ENOENT, an error path that names
 * argv[0] exactly, and an independently usable cwd.
 */
function localRunnerSpawnFailure(error: unknown, runnerProgram: string | undefined, workdir: string): boolean {
  if (runnerProgram === undefined || !isUsableWorkdir(workdir)) return false;
  if (typeof error !== 'object' || error === null) return false;
  const { code, path, syscall } = error as { code?: unknown; path?: unknown; syscall?: unknown };
  if (typeof code !== 'string' || (code !== 'EACCES' && code !== 'ENOENT')) return false;
  if (typeof syscall !== 'string') return false;
  const exactSyscall = `spawn ${runnerProgram}`;
  if (path === undefined) return syscall === exactSyscall;
  if (typeof path !== 'string' || path.length === 0 || path !== runnerProgram) return false;
  return syscall === 'spawn' || syscall === exactSyscall;
}

/** Dispatch to the module-level export or the local equivalent. */
function isRunnerSpawnFailure(
  modules: RegistryModules,
  error: unknown,
  runnerProgram: string | undefined,
  workdir: string,
): boolean {
  const detect = modules.sandbox?.isRunnerSpawnFailure;
  if (typeof detect === 'function') return detect(error, runnerProgram, workdir);
  return localRunnerSpawnFailure(error, runnerProgram, workdir);
}

/** A capability-absence error whose message names the package, so an operator knows what is missing. */
function capabilityError(what: string, pkg: string): Error {
  return new Error(`${LOG_PREFIX}:${what} — ${pkg} is unavailable in this runtime; the calling plugin cannot proceed without it`);
}

/**
 * Build `ctx.dshLoader.sandbox`.
 *
 * The interface document writes the input as `{ modules }`, but `confine` needs
 * the `ctx.sandbox` service itself, so `ctx` is required as well; every other
 * member still depends only on the modules resolved at boot.
 *
 * @param opts.ctx - the cordis context, used to reach the `ctx.sandbox` provider.
 * @param opts.modules - the `preloadRegistryModules` result.
 */
export function createSandboxFacade(opts: { ctx: CordisContext; modules?: RegistryModules }): SandboxFacade {
  const { ctx, modules = {} } = opts;

  const required = <T>(value: unknown, member: string): T => {
    if (typeof value !== 'function') throw capabilityError(`sandbox.${member}`, '@deepseek-ai/dsh-sandbox');
    return value as T;
  };

  return {
    escalationTargets() {
      // A copy: a caller holding the readonly array must not be able to reach
      // back into the host's escalation vocabulary.
      return [...(modules.sandbox?.ESCALATION_TARGETS ?? [])];
    },
    validateEscalationArgs(mode, justification) {
      const validate = required<(m: unknown, j: unknown) => void>(
        modules.sandbox?.validateEscalationArgs,
        'validateEscalationArgs',
      );
      validate(mode, justification);
    },
    async approveEscalation(request, context) {
      const approve = required<(r: unknown, c: unknown) => Promise<string>>(
        modules.sandbox?.approveEscalation,
        'approveEscalation',
      );
      return approve(request, context);
    },
    unavailableError(mode, detail) {
      const Ctor = modules.sandbox?.SandboxUnavailableError;
      if (typeof Ctor === 'function') return new Ctor(mode, detail);
      // Without the module a routable error is still required: `code` is the only
      // thing the tool layer can branch on to tell "no sandbox" from "the command
      // failed".
      const error = new Error(
        `sandbox mode "${mode}" is requested but no sandbox backend is usable on this host; `
          + `refusing to run the command unconfined. Runner failure: ${detail}`,
      ) as Error & { code: string };
      error.name = 'SandboxUnavailableError';
      error.code = SANDBOX_UNAVAILABLE_CODE;
      return error;
    },
    denialMarker(mode) {
      const marker = required<(m: string) => string>(modules.sandbox?.sandboxDenialMarker, 'denialMarker');
      return marker(mode);
    },
    escalationHintMarker(subject) {
      const marker = required<(s: string) => string>(modules.sandbox?.escalationHintMarker, 'escalationHintMarker');
      return marker(subject);
    },
    classify(input) {
      // A runner failure and a denial are two independent facts: the first says
      // the command never ran, the second says confinement blocked it.
      const runnerFailure = classifyRunnerFailureDetail(modules, input.exitCode, input.stderr, input.rules);
      const denied = matchesDenialSignature(modules, input.exitCode, input.stderr, input.signatures);
      return runnerFailure === undefined ? { denied } : { denied, runnerFailure };
    },
    async confine(argv, policy, signal) {
      // 0.1.5's confine returns synchronously and 0.1.6 on return a Promise:
      // `await Promise.resolve` covers both, so callers always get a Promise and
      // never have to test for synchronicity themselves.
      return normalizeConfined(await Promise.resolve(confineRaw(ctx, argv, policy, signal)));
    },
  };
}

/**
 * Call the `ctx.sandbox` provider, returning its synchronous result or its
 * Promise exactly as it produced it.
 *
 * The facade's `confine` unifies the result into a Promise, but the `start()`
 * member on the `run-start` seam has to return the process handle
 * synchronously on 0.1.5. That path can only take the provider's raw return
 * value and normalize it with `normalizeConfined`.
 */
function confineRaw(ctx: CordisContext, argv: readonly string[], policy: unknown, signal?: AbortSignal): unknown {
  const provider = ctx.get('sandbox') as
    | { confine?: (a: readonly string[], p: unknown, s?: AbortSignal) => unknown }
    | undefined;
  if (typeof provider?.confine !== 'function') {
    throw new Error(
      `${LOG_PREFIX}:sandbox.confine — the ctx.sandbox provider is not composed in this runtime; `
        + 'no confinement argv can be produced',
    );
  }
  return provider.confine(argv, policy, signal);
}

/** Fill a provider result out into a `ConfinedArgvLike`, using the most conservative value for a missing field. */
function normalizeConfined(value: unknown): ConfinedArgvLike {
  const prepared = (value ?? {}) as Partial<ConfinedArgvLike>;
  return {
    argv: [...(prepared.argv ?? [])],
    enforcement: String(prepared.enforcement ?? 'partial'),
    denialSignatures: [...(prepared.denialSignatures ?? [])],
    runnerFailureRules: [...(prepared.runnerFailureRules ?? [])],
  };
}

/** Whether a value is thenable; used to choose between the two provider shapes. */
function isThenable(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === 'function';
}

/** One process's confinement facts, kept until settlement writes them onto the result or `proc.sandbox`. */
interface ProcessConfinementFacts {
  mode: string;
  enforcement: string;
  denialSignatures: readonly string[];
  runnerFailureRules: readonly unknown[];
  runnerProgram: string | undefined;
  workdir: string;
}

/** The superclass entry the generated class calls; one per seam, and `seam` decides which exists. */
type AnyExecutorConstructor = new (ctx: any, config?: any) => any;

/** Read the sandbox policy off the spec; a missing one means the caller skipped `resolve()`, and the mode must not be guessed. */
function requiredSandboxPolicy(spec: ShellSpecLike): SandboxPolicyLike {
  const policy = spec.sandboxPolicy;
  if (policy === undefined || typeof policy.mode !== 'string') {
    throw new Error(
      `${LOG_PREFIX}:shell.base — the spec carries no sandboxPolicy; run resolve() before execute/run/start`,
    );
  }
  return policy;
}

/**
 * The mode a generated executor confines under.
 *
 * `ShellExecutor.sandboxMode` answers `undefined` on every release, because the
 * shipped sandboxing executors override it themselves. A generated class
 * subclasses the *local* executor, so it would inherit that empty answer — and
 * from 0.2.2 on `dsh-permission-presets` refuses to compose at all unless
 * `ctx.shell.sandboxMode` names a mode. The deployment policy is the same fact
 * `SandboxPwshExecutor` reports, so it is read from there rather than guessed.
 * @param ctx - the executor's context.
 * @returns the configured default mode, or undefined when the service is absent.
 */
function sandboxModeOf(ctx: CordisContext): string | undefined {
  const service = ctx.get('sandboxPolicy') as
    | { defaultMode?: unknown; resolve?: () => { mode?: unknown } }
    | undefined;
  if (typeof service?.defaultMode === 'string') return service.defaultMode;
  if (typeof service?.resolve !== 'function') return undefined;
  const resolved = service.resolve();
  return typeof resolved?.mode === 'string' ? resolved.mode : undefined;
}

/** Resolve the deployment policy from `ctx.sandboxPolicy`; a missing service fails loudly. */
function resolveSandboxPolicy(ctx: CordisContext): SandboxPolicyLike {
  const policy = ctx.get('sandboxPolicy') as { resolve?: () => SandboxPolicyLike } | undefined;
  if (typeof policy?.resolve !== 'function') {
    throw new Error(
      `${LOG_PREFIX}:shell.resolve — the ctx.sandboxPolicy service is not composed in this runtime; `
        + 'a shell executor cannot run without a resolved sandbox mode',
    );
  }
  return policy.resolve();
}

/** The stderr text on a result; `CollectedOutput` names the field the same way across releases, and a missing one reads as empty. */
function stderrText(result: any): string {
  const text = result?.stderr?.text;
  return typeof text === 'string' ? text : '';
}

/** The exit code on a result; `null` means signal termination or a preparation-phase expiry. */
function exitCodeOf(result: any): number | null {
  return typeof result?.exitCode === 'number' ? result.exitCode : null;
}

/**
 * The sandbox facts for a foreground result.
 *
 * A runner failure outranks a denial: when the command never started at all,
 * reporting "blocked by the sandbox" would send the caller into a retry loop.
 * `confined` is absent only on paths such as a preparation-phase expiry, where
 * the process never started, so the result reports no denial.
 */
function foregroundSandboxFacts(
  sandbox: SandboxFacade,
  confined: ConfinedArgvLike | undefined,
  result: any,
  mode: string,
): { mode: string; denied: boolean; enforcement?: string } {
  if (confined === undefined) return { mode, denied: false };
  const verdict = sandbox.classify({
    exitCode: exitCodeOf(result),
    stderr: stderrText(result),
    signatures: confined.denialSignatures,
    rules: confined.runnerFailureRules,
  });
  if (verdict.runnerFailure !== undefined) throw sandbox.unavailableError(mode, verdict.runnerFailure);
  return { mode, denied: verdict.denied, enforcement: confined.enforcement };
}

/** Remember one call's confinement facts until the process settles. */
function rememberFacts(
  facts: Map<unknown, ProcessConfinementFacts>,
  process: unknown,
  mode: string,
  confined: ConfinedArgvLike | undefined,
  workdir: string,
): void {
  if (confined === undefined) return;
  facts.set(process, {
    mode,
    enforcement: confined.enforcement,
    denialSignatures: confined.denialSignatures,
    runnerFailureRules: confined.runnerFailureRules,
    runnerProgram: confined.argv[0],
    workdir,
  });
}

/** Stamp the confinement facts onto `proc.sandbox` at settlement, with the semantics `dsh-pwsh-sandbox` uses. */
function stampProcessFacts(
  facts: Map<unknown, ProcessConfinementFacts>,
  modules: RegistryModules,
  process: any,
  stderr: string,
  providerRejected: boolean,
  providerError: unknown,
): void {
  const recorded = facts.get(process);
  if (recorded === undefined) return;
  facts.delete(process);
  // A provider rejection carries no failure stage, so the runner is blamed only
  // when the error itself names argv[0]; every other case goes through the
  // settled diagnostics. Denial detection is independent of runner attribution:
  // a terminated process can still leave stderr in the denial dialect, and
  // dropping that fact would make the tool layer report an ordinary command
  // failure.
  const runnerFailed = providerRejected
    ? isRunnerSpawnFailure(modules, providerError, recorded.runnerProgram, recorded.workdir)
    : classifyRunnerFailureDetail(modules, exitCodeOf(process), stderr, recorded.runnerFailureRules) !== undefined;
  const denied = !runnerFailed
    && matchesDenialSignature(modules, exitCodeOf(process), stderr, recorded.denialSignatures);
  process.sandbox = {
    mode: recorded.mode,
    denied,
    enforcement: recorded.enforcement,
    ...(runnerFailed ? { runnerFailed: true } : {}),
  };
}

/** Decorate the foreground result projection: the handle keeps its identity and only `result()` carries the sandbox facts. */
function decorateResult(
  execution: any,
  map: (result: any) => any,
  mapError?: (error: unknown) => never,
): any {
  const base = execution.result.bind(execution);
  let decorated: Promise<any> | undefined;
  execution.result = () => {
    decorated ??= mapError === undefined ? base().then(map) : base().then(map, mapError);
    return decorated;
  };
  return execution;
}

/**
 * 0.1.6's `runArgv` wraps the result as `{ result, spawnRequested }` while 0.1.5
 * returns the result directly. The facade normalizes by whether the field is
 * present, never by version number.
 */
function unwrapRunResult(outcome: any): any {
  return outcome !== null && typeof outcome === 'object' && 'result' in outcome ? outcome.result : outcome;
}

/** 0.1.6 reports whether the argv actually reached subprocess; a preparation-phase expiry means the process never started. */
function spawned(outcome: any): boolean {
  return !(outcome !== null && typeof outcome === 'object' && 'spawnRequested' in outcome)
    || outcome.spawnRequested !== false;
}

/** An unconfined process still reports `denied: false`, so callers read one sandbox shape in both modes. */
function markUnconfined(process: any, mode: string): any {
  process.sandbox = { mode, denied: false };
  return process;
}

/**
 * Build the generated executor class.
 *
 * Each seam gets its own class body: the older generation must override
 * `run`/`start` and the newer one overrides `execute`. The shared parts (the
 * argv hook, resolve's policy stamping, settlement facts) live in functions
 * outside the factory, so a class body keeps only the entries that generation
 * of the host actually has.
 */
function createExecutorClass(opts: {
  base: AnyExecutorConstructor;
  seam: 'run-start' | 'execute';
  shellArgv: (spec: ShellSpecLike) => readonly string[];
  sandbox: SandboxFacade;
  modules: RegistryModules;
}): ShellExecutorClass {
  const { base, seam, shellArgv, sandbox, modules } = opts;

  if (seam === 'execute') {
    return class ExecuteSeamExecutor extends base {
      // From 0.1.7 on, sandboxPolicy is a service of its own and the superclass
      // no longer resolves a default mode itself.
      static inject = ['subprocess', 'sandbox', 'sandboxPolicy'];

      private readonly processFacts = new Map<unknown, ProcessConfinementFacts>();

      /**
       * The mode this executor confines under.
       *
       * `ShellExecutor` answers `undefined` and the shipped sandboxing executors
       * override it; a class extending the *local* executor would otherwise claim
       * "does not confine", which 0.2.2+ treats as a composition error.
       */
      get sandboxMode(): string | undefined {
        return sandboxModeOf(this.ctx);
      }

      // The superclass's execute() still calls this.argv(spec); overriding it
      // guarantees every inherited path uses the plugin's argv and never falls
      // back to the host's own pwsh/bash invocation.
      protected argv(spec: ShellSpecLike): string[] {
        return [...shellArgv(spec)];
      }

      resolve(request: ShellSpecLike): any {
        const policy = request.sandboxPolicy ?? resolveSandboxPolicy(this.ctx);
        return { ...super.resolve(request), sandboxPolicy: policy };
      }

      async execute(spec: ShellSpecLike): Promise<any> {
        const policy = requiredSandboxPolicy(spec);
        const mode = policy.mode;
        if (mode === 'danger-full-access') {
          // Straight through to the superclass: argv is already overridden, so the
          // shell the plugin chose still takes effect.
          return decorateResult(await super.execute(spec), (result: any) => ({
            ...result,
            sandbox: { mode, denied: false },
          }));
        }

        let confined: ConfinedArgvLike | undefined;
        const execution = await this.executeArgv(
          spec,
          async (signal: AbortSignal) => {
            // The facade is the one confinement entry: it normalizes both the old
            // host's synchronous return and the new host's asynchronous one.
            const prepared = await sandbox.confine(this.argv(spec), policy, signal);
            signal.throwIfAborted();
            confined = prepared;
            return prepared.argv;
          },
          (process: unknown) => {
            // onStarted runs synchronously before the handle can settle, so the
            // facts have to land here first.
            rememberFacts(this.processFacts, process, mode, confined, spec.workdir);
          },
        );

        return decorateResult(
          execution,
          (result: any) => ({ ...result, sandbox: foregroundSandboxFacts(sandbox, confined, result, mode) }),
          (error: unknown) => {
            // An upstream abort is still a cancellation even when it fires before
            // spawn, so it must never be reported as a runner failure.
            if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
            if (confined !== undefined && isRunnerSpawnFailure(modules, error, confined.argv[0], spec.workdir)) {
              throw sandbox.unavailableError(mode, String(error));
            }
            throw error;
          },
        );
      }

      protected onProcessDone(process: any, stderr: string, providerRejected: boolean, providerError?: unknown): void {
        stampProcessFacts(this.processFacts, modules, process, stderr, providerRejected, providerError);
        super.onProcessDone(process, stderr, providerRejected, providerError);
      }
    };
  }

  return class RunStartSeamExecutor extends base {
    // The older generation needs the sandboxPolicy service too; its superclass
    // only declares `subprocess` itself.
    static inject = ['subprocess', 'sandbox', 'sandboxPolicy'];

    private readonly processFacts = new Map<unknown, ProcessConfinementFacts>();

    /** The mode this executor confines under; see the execute seam's own getter. */
    get sandboxMode(): string | undefined {
      return sandboxModeOf(this.ctx);
    }

    protected argv(spec: ShellSpecLike): string[] {
      return [...shellArgv(spec)];
    }

    resolve(request: ShellSpecLike): any {
      const policy = request.sandboxPolicy ?? resolveSandboxPolicy(this.ctx);
      return { ...super.resolve(request), sandboxPolicy: policy };
    }

    async run(spec: ShellSpecLike): Promise<any> {
      const policy = requiredSandboxPolicy(spec);
      const mode = policy.mode;
      if (mode === 'danger-full-access') {
        return { ...(await super.run(spec)), sandbox: { mode, denied: false } };
      }

      const confined = await sandbox.confine(this.argv(spec), policy, spec.signal);
      let outcome: any;
      try {
        // Hand over the exact argv only: 0.1.5's runArgv accepts no preparation
        // function, and 0.1.6's return value carries one extra wrapper level.
        outcome = await this.runArgv(spec, confined.argv);
      } catch (error) {
        if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
        if (isRunnerSpawnFailure(modules, error, confined.argv[0], spec.workdir)) {
          throw sandbox.unavailableError(mode, String(error));
        }
        throw error;
      }
      const result = unwrapRunResult(outcome);
      // A preparation-phase expiry means the process never started, so the run
      // shows neither a denial nor a runner failure.
      const facts = spawned(outcome) ? foregroundSandboxFacts(sandbox, confined, result, mode) : { mode, denied: false };
      return { ...result, sandbox: facts };
    }

    /**
     * 0.1.5's `start` returns the handle synchronously and 0.1.6 on return a
     * Promise, and the caller (`dsh-tool-bash`) reads `kill`/`done` straight off
     * the return value. So this member must not be declared `async`: it returns
     * synchronously on a synchronous base class and forwards along the Promise
     * chain on an asynchronous one, preserving each host's own callable shape.
     */
    start(spec: ShellSpecLike): any {
      const policy = requiredSandboxPolicy(spec);
      const mode = policy.mode;
      if (mode === 'danger-full-access') {
        const process = super.start(spec);
        return isThenable(process) ? process.then(p => markUnconfined(p, mode)) : markUnconfined(process, mode);
      }

      const raw = confineRaw(this.ctx, this.argv(spec), policy, spec.signal);
      if (isThenable(raw)) {
        return raw.then(prepared => this.startConfined(spec, mode, normalizeConfined(prepared)));
      }
      return this.startConfined(spec, mode, normalizeConfined(raw));
    }

    /**
     * Start a background process with an already-confined argv.
     *
     * On a synchronous base class a spawn throw is converted into the capability
     * error right here; on an asynchronous one the rejection handler does the
     * same, so both hosts share one failure semantics.
     */
    private startConfined(spec: ShellSpecLike, mode: string, confined: ConfinedArgvLike): any {
      let process: any;
      try {
        process = this.startArgv(spec, confined.argv);
      } catch (error) {
        throw this.startFailure(spec, mode, confined, error);
      }
      if (isThenable(process)) {
        return (process as Promise<any>).then(
          (started: any) => {
            rememberFacts(this.processFacts, started, mode, confined, spec.workdir);
            return started;
          },
          (error: unknown) => {
            throw this.startFailure(spec, mode, confined, error);
          },
        );
      }
      rememberFacts(this.processFacts, process, mode, confined, spec.workdir);
      return process;
    }

    /** Attribute a failed background start: an upstream cancellation stays a cancellation, a runner spawn failure becomes the capability error. */
    private startFailure(spec: ShellSpecLike, mode: string, confined: ConfinedArgvLike, error: unknown): unknown {
      if (spec.signal?.aborted === true) spec.signal.throwIfAborted();
      if (isRunnerSpawnFailure(modules, error, confined.argv[0], spec.workdir)) {
        return sandbox.unavailableError(mode, String(error));
      }
      return error;
    }

    protected onProcessDone(process: any, stderr: string, providerRejected: boolean, providerError?: unknown): void {
      stampProcessFacts(this.processFacts, modules, process, stderr, providerRejected, providerError);
      super.onProcessDone(process, stderr, providerRejected, providerError);
    }
  };
}

/**
 * Build `ctx.dshLoader.shell`.
 *
 * @param opts.ctx - the cordis context: platform probing, sandboxPolicy resolution, and the sandbox facade.
 * @param opts.modules - the `@deepseek-ai/*` modules resolved at boot.
 * @param opts.metadata - the selected patch's metadata; the facade reads only its `shell` section.
 */
export function createShellFacade(opts: {
  ctx: CordisContext;
  modules?: RegistryModules;
  metadata?: ShellMetadataSource;
}): ShellFacade {
  const { ctx, modules = {} } = opts;
  const metadata = opts.metadata?.shell;
  const sandbox = createSandboxFacade({ ctx, modules });
  const localPackages = metadata?.localPackage ?? SHELL_LOCAL_PACKAGES;

  const localPlatform = (): ShellPlatform => (process.platform === 'win32' ? 'windows' : 'posix');
  let probed: ShellPlatform | undefined;
  let probing = false;
  let probedService: unknown;

  /**
   * Probe the execution world's platform word.
   *
   * `base()` must return a class synchronously, so the probe can only fill the
   * word in afterwards and the platform reads as the local one until it lands.
   * `ctx.subprocess` may not be composed yet when the facade is created, so one
   * attempt is recorded per service instance: a late provider still gets probed,
   * while a provider that keeps failing is not called — and its warning not
   * logged — again on every platform read.
   */
  const probePlatform = (): void => {
    if (probing || probed !== undefined) return;
    const service = ctx.get('subprocess') as
      | { terminalEnvironment?: (signal?: AbortSignal) => Promise<{ platform?: unknown }> }
      | undefined;
    if (service === undefined || service === probedService) return;
    const terminalEnvironment = service.terminalEnvironment;
    if (typeof terminalEnvironment !== 'function') return;
    probedService = service;
    probing = true;
    void (async () => {
      try {
        const environment = await terminalEnvironment();
        if (environment?.platform === 'windows' || environment?.platform === 'posix') probed = environment.platform;
      } catch (error) {
        ctx.logger?.warn?.(
          `${LOG_PREFIX}:shell.platform — terminalEnvironment() failed (${describeError(error)}); `
            + 'falling back to process.platform for the executor package choice',
        );
      } finally {
        probing = false;
      }
    })();
  };

  const platform = (): ShellPlatform => {
    probePlatform();
    return probed ?? localPlatform();
  };
  probePlatform();

  return {
    platform,
    localPackage() {
      return localPackages[platform()];
    },
    base(options) {
      if (metadata === undefined) {
        ctx.logger?.warn?.(
          `${LOG_PREFIX}:shell.base — the selected adapter declares no shell metadata; `
            + 'returning undefined so the caller can fail loudly instead of guessing a seam',
        );
        return undefined;
      }
      const localPackage = localPackages[platform()];
      const localExecutor = platform() === 'windows'
        ? modules.pwshLocal?.PwshLocalExecutor
        : modules.bashLocal?.LocalBashExecutor;
      if (typeof localExecutor !== 'function') {
        ctx.logger?.warn?.(
          `${LOG_PREFIX}:shell.base — ${localPackage} is unavailable in this runtime; returning undefined`,
        );
        return undefined;
      }
      return createExecutorClass({
        base: localExecutor as AnyExecutorConstructor,
        seam: metadata.seam,
        shellArgv: options.shellArgv,
        sandbox,
        modules,
      });
    },
    parseExitStatus(text) {
      const parse = modules.shell?.parseExitStatus;
      if (typeof parse !== 'function') {
        // Without the parser only the original text is returned: never claim exit
        // 0 and never guess at a marker.
        return { body: text };
      }
      return parse(text);
    },
    candidatePwshPaths(env) {
      const candidates = modules.pwshLocal?.candidatePwshPaths;
      if (typeof candidates !== 'function') return [];
      return [...candidates(env)];
    },
  };
}
