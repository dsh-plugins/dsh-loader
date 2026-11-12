// L1 unit tests for the shell / sandbox facades
// (src/adapters/shared/shell.ts -> dist/adapters/shared/shell.js).
//
// Injected fake base classes stand in for the real executors, so no process is
// ever started; the cases cover argv taking effect on both seams (run/start and
// execute), resolve() stamping sandboxPolicy, the sandbox facts on results and
// procs, and the degradation strategy when an upstream module is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSandboxFacade, createShellFacade } from '../dist/adapters/shared/shell.js';
import { clientAdapters } from '../dist/adapters/client.js';

const WINDOWS_PACKAGE = '@deepseek-ai/dsh-pwsh-local';
const POSIX_PACKAGE = '@deepseek-ai/dsh-bash-local';

/** One confine call record, used to assert whose argv the facade hands the provider. */
function makeConfine({ prefix = ['runner'], denialSignatures = ['denied'], runnerFailureRules = [] } = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      confine(argv, policy) {
        calls.push({ argv: [...argv], policy });
        return { argv: [...prefix, ...argv], enforcement: 'full', denialSignatures, runnerFailureRules };
      },
    },
  };
}

/** A minimal cordis context: a service table plus optional platform probing. */
function makeCtx({ platform = 'windows', policy = { mode: 'workspace-write', workspaceRoot: '/w' }, sandbox, subprocess } = {}) {
  const services = new Map();
  if (sandbox !== undefined) services.set('sandbox', sandbox);
  if (policy !== undefined) services.set('sandboxPolicy', { resolve: () => policy });
  if (subprocess !== undefined) services.set('subprocess', subprocess);
  return { get: name => services.get(name), logger: { warn() {} } };
}

/** Settle a fake process handle; `done` resolves only after onProcessDone, matching the real executor. */
function makeProc({ exitCode, stderr, onDone, onProcessDone }) {
  const proc = {
    status: 'running',
    exitCode: null,
    signal: null,
    kill: () => false,
    readOutput: () => ({ delta: '', lossy: false }),
    observed: {
      stdout: { readFrom: () => ({ text: '', lossy: false, nextOffset: 0 }) },
      stderr: { readFrom: () => ({ text: stderr, lossy: false, nextOffset: stderr.length }) },
    },
  };
  let settle;
  const settled = new Promise(resolve => { settle = resolve; });
  const result = {
    exitCode,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 1_000,
    stdout: { text: '', truncated: false },
    stderr: { text: stderr, truncated: false },
  };
  proc.done = settled;
  proc.result = () => settled.then(() => result);
  // A real executor settles only once the process has actually exited, which
  // fires onProcessDone in a later turn too; a macrotask reproduces that timing,
  // otherwise the facts would already be consumed before start() returns.
  setTimeout(() => {
    proc.status = 'completed';
    proc.exitCode = exitCode;
    onProcessDone(proc, stderr, false);
    if (onDone !== undefined) onDone(proc);
    settle();
  }, 0);
  return proc;
}

/**
 * A fake base class for the newer seam: execute -> executeArgv, with argv as a
 * protected hook.
 */
function makeExecuteBase({ exitCode = 1, stderr = 'denied: read-only', argvPrefix = ['base-pwsh'] } = {}) {
  return class FakePwshLocalExecutor {
    static inject = ['subprocess'];

    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.seenArgv = [];
      this.processes = [];
    }

    resolve(request) {
      return {
        command: request.command,
        workdir: request.workdir ?? '/work',
        timeoutMs: request.timeoutMs ?? 1_000,
        onExpiry: 'kill',
        stdoutMaxBytes: 64,
        ...request,
      };
    }

    argv(spec) {
      return [...argvPrefix, '-Command', spec.command];
    }

    async execute(spec) {
      return this.executeArgv(spec, this.argv(spec));
    }

    async executeArgv(spec, argvOrPrepare, onStarted) {
      const signal = new AbortController().signal;
      const argv = typeof argvOrPrepare === 'function' ? await argvOrPrepare(signal) : argvOrPrepare;
      this.seenArgv.push([...argv]);
      const proc = makeProc({
        exitCode,
        stderr,
        onDone: settled => this.processes.push(settled),
        onProcessDone: (p, text, rejected) => this.onProcessDone(p, text, rejected),
      });
      if (onStarted !== undefined) onStarted(proc);
      return proc;
    }

    onProcessDone() {}
  };
}

/**
 * A fake base class for the older seam: run/start -> runArgv/startArgv.
 *
 * `wrapped` reproduces the 0.1.6 generation, where runArgv wraps its result as
 * `{ result, spawnRequested }`; `asyncStartArgv` reproduces a host whose
 * startArgv returns a Promise (for example a provider dispatching the handle
 * asynchronously).
 */
function makeRunStartBase({ exitCode = 1, stderr = 'denied: read-only', wrapped = false, asyncStartArgv = false } = {}) {
  return class FakeLegacyExecutor {
    static inject = ['subprocess'];

    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
      this.seenArgv = [];
      this.processes = [];
    }

    resolve(request) {
      return {
        command: request.command,
        workdir: request.workdir ?? '/work',
        timeoutMs: request.timeoutMs ?? 1_000,
        onExpiry: 'kill',
        stdoutMaxBytes: 64,
        ...request,
      };
    }

    argv(spec) {
      return ['legacy-base', '-c', spec.command];
    }

    async run(spec) {
      return this.runArgv(spec, this.argv(spec));
    }

    async runArgv(spec, argv) {
      this.seenArgv.push([...argv]);
      const result = {
        exitCode,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: spec.timeoutMs,
        stdout: { text: '', truncated: false },
        stderr: { text: stderr, truncated: false },
      };
      return wrapped ? { result, spawnRequested: true } : result;
    }

    start(spec) {
      return this.startArgv(spec, this.argv(spec));
    }

    startArgv(spec, argv) {
      if (argv !== undefined) this.seenArgv.push([...argv]);
      const started = makeProc({
        exitCode,
        stderr,
        onDone: settled => this.processes.push(settled),
        onProcessDone: (p, text, rejected) => this.onProcessDone(p, text, rejected),
      });
      return asyncStartArgv ? Promise.resolve(started) : started;
    }

    onProcessDone() {}
  };
}

/** A fake upstream bag with every module present. */
function makeModules({ base, shellModule, pwshModule, bashModule, sandboxModule } = {}) {
  return {
    shell: shellModule,
    pwshLocal: {
      PwshLocalExecutor: pwshModule?.PwshLocalExecutor ?? base,
      candidatePwshPaths: pwshModule?.candidatePwshPaths ?? (() => ['C:\\pwsh.exe']),
    },
    bashLocal: { LocalBashExecutor: bashModule?.LocalBashExecutor ?? base },
    sandbox: sandboxModule,
  };
}

/** A fake older-generation base class that reports a provider rejection at settlement. */
function makeProviderRejectingBase({ stderr = 'Access Denied', providerError = new Error('spawn refused') } = {}) {
  return class FakeRejectingExecutor {
    static inject = ['subprocess'];

    constructor(ctx, config) {
      this.ctx = ctx;
      this.config = config;
    }

    resolve(request) {
      return {
        command: request.command,
        workdir: request.workdir ?? '/work',
        timeoutMs: 1_000,
        onExpiry: 'kill',
        stdoutMaxBytes: 64,
        ...request,
      };
    }

    argv(spec) {
      return ['legacy-base', '-c', spec.command];
    }

    start() {
      return this.startArgv();
    }

    startArgv() {
      return makeProc({
        exitCode: null,
        stderr,
        onProcessDone: (proc, text) => this.onProcessDone(proc, text, true, providerError),
      });
    }

    onProcessDone() {}
  };
}

const EXECUTE_METADATA = {
  shell: {
    localPackage: { windows: WINDOWS_PACKAGE, posix: POSIX_PACKAGE },
    seam: 'execute',
  },
};
const RUN_START_METADATA = {
  shell: {
    localPackage: { windows: WINDOWS_PACKAGE, posix: POSIX_PACKAGE },
    seam: 'run-start',
  },
};

test('every patch shell metadata uses the same pair of local packages and the matching seam', () => {
  const seams = new Map(
    clientAdapters.map(metadata => [
      metadata.patch,
      { seam: metadata.shell.seam, localPackage: metadata.shell.localPackage },
    ]),
  );
  assert.deepEqual([...seams.keys()], ['0.1.5', '0.1.6', '0.1.7', '0.2.0', '0.2.1', '0.2.2']);
  for (const [patch, entry] of seams) {
    assert.deepEqual(
      entry.localPackage,
      { windows: WINDOWS_PACKAGE, posix: POSIX_PACKAGE },
      `${patch} local executor package name`,
    );
    const expected = patch === '0.1.5' || patch === '0.1.6' ? 'run-start' : 'execute';
    assert.equal(entry.seam, expected, `${patch} executor seam`);
  }
});

test('run-start seam: a provider rejection with no exit code reports no denial, as upstream does', async () => {
  const confine = makeConfine({ denialSignatures: ['access denied'] });
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({
    ctx,
    modules: makeModules({ base: makeProviderRejectingBase({ stderr: 'Access Denied' }) }),
    metadata: RUN_START_METADATA,
  });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const proc = await executor.start(executor.resolve({ command: 'id' }));
  await proc.done;

  // Denial detection requires a nonzero exit code; a provider rejection leaves
  // exitCode null, so no denial is reported, matching upstream.
  assert.deepEqual(proc.sandbox, { mode: 'workspace-write', denied: false, enforcement: 'full' });
});

test('run-start seam: a provider rejection whose error names the runner sets runnerFailed', async () => {
  const confine = makeConfine({ denialSignatures: ['access denied'] });
  const ctx = makeCtx({ sandbox: confine.provider });
  const runnerError = Object.assign(new Error('spawn runner ENOENT'), {
    code: 'ENOENT',
    syscall: 'spawn runner',
    path: 'runner',
  });
  const shell = createShellFacade({
    ctx,
    modules: makeModules({ base: makeProviderRejectingBase({ stderr: '', providerError: runnerError }) }),
    metadata: RUN_START_METADATA,
  });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  // The working directory has to be genuinely usable, otherwise the attribution
  // rule conservatively refuses to conclude anything about the runner.
  const proc = await executor.start(executor.resolve({ command: 'id', workdir: process.cwd() }));
  await proc.done;

  assert.deepEqual(proc.sandbox, {
    mode: 'workspace-write',
    denied: false,
    enforcement: 'full',
    runnerFailed: true,
  });
});

test('execute seam: argv comes from shellArgv, resolve stamps sandboxPolicy, and both the result and the process carry the sandbox facts', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeExecuteBase() }), metadata: EXECUTE_METADATA });

  assert.equal(shell.localPackage(), WINDOWS_PACKAGE);

  const Base = shell.base({ shellArgv: spec => ['my-shell', '-c', spec.command] });
  assert.equal(typeof Base, 'function');

  const executor = new Base(ctx, {});
  const spec = executor.resolve({ command: 'echo hi' });
  assert.equal(spec.sandboxPolicy.mode, 'workspace-write', 'resolve must stamp the deployment policy');
  assert.equal(spec.command, 'echo hi');

  const execution = await executor.execute(spec);
  // Only after the inherited path swaps in the plugin argv does it reach confine.
  assert.deepEqual(confine.calls[0].argv, ['my-shell', '-c', 'echo hi']);
  assert.equal(confine.calls[0].policy.mode, 'workspace-write');
  assert.deepEqual(executor.seenArgv[0], ['runner', 'my-shell', '-c', 'echo hi']);

  const result = await execution.result();
  assert.deepEqual(result.sandbox, { mode: 'workspace-write', denied: true, enforcement: 'full' });
  assert.equal(executor.processes.length, 1);
  assert.deepEqual(executor.processes[0].sandbox, { mode: 'workspace-write', denied: true, enforcement: 'full' });
});

test('execute seam: danger-full-access goes straight to the superclass while argv still comes from shellArgv', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider, policy: { mode: 'danger-full-access', workspaceRoot: '/w' } });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeExecuteBase({ exitCode: 0, stderr: '' }) }), metadata: EXECUTE_METADATA });

  const executor = new (shell.base({ shellArgv: spec => ['my-shell', '-c', spec.command] }))(ctx, {});
  const result = await (await executor.execute(executor.resolve({ command: 'id' }))).result();

  assert.equal(confine.calls.length, 0, 'the full-access mode must not call confine');
  assert.deepEqual(result.sandbox, { mode: 'danger-full-access', denied: false });
  assert.deepEqual(executor.seenArgv[0], ['my-shell', '-c', 'id']);
});

test('execute seam: a runner failure outranks a denial and the foreground result becomes a routable capability error', async () => {
  class SandboxUnavailableError extends Error {
    constructor(mode, detail) {
      super(`unavailable: ${mode}: ${detail}`);
      this.name = 'SandboxUnavailableError';
      this.code = 'SANDBOX_UNAVAILABLE';
    }
  }
  const confine = makeConfine({
    denialSignatures: ['denied'],
    runnerFailureRules: [{ fatalSignatures: ['runner exploded'] }],
  });
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({
    ctx,
    modules: makeModules({
      base: makeExecuteBase({ exitCode: 1, stderr: 'runner exploded before exec' }),
      sandboxModule: { SandboxUnavailableError },
    }),
    metadata: EXECUTE_METADATA,
  });

  const executor = new (shell.base({ shellArgv: spec => ['my-shell', '-c', spec.command] }))(ctx, {});
  await assert.rejects(
    (await executor.execute(executor.resolve({ command: 'id' }))).result(),
    error => {
      assert.equal(error.name, 'SandboxUnavailableError');
      assert.equal(error.code, 'SANDBOX_UNAVAILABLE');
      return true;
    },
  );
});

test('run-start seam: run uses shellArgv and adds the sandbox facts', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeRunStartBase() }), metadata: RUN_START_METADATA });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const spec = executor.resolve({ command: 'ls' });
  assert.equal(spec.sandboxPolicy.mode, 'workspace-write');

  const result = await executor.run(spec);
  assert.deepEqual(confine.calls[0].argv, ['legacy-shell', '-c', 'ls']);
  assert.deepEqual(executor.seenArgv[0], ['runner', 'legacy-shell', '-c', 'ls']);
  assert.deepEqual(result.sandbox, { mode: 'workspace-write', denied: true, enforcement: 'full' });
});

test('run-start seam: 0.1.5 start returns the handle synchronously, with the facts on the handle', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeRunStartBase() }), metadata: RUN_START_METADATA });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const proc = executor.start(executor.resolve({ command: 'sleep 1' }));
  // A 0.1.5 caller reads kill/done straight off the return value, so this
  // cannot be a Promise.
  assert.equal(typeof proc.then, 'undefined', 'a synchronous base class must return the handle synchronously');
  assert.equal(typeof proc.kill, 'function');
  assert.deepEqual(confine.calls[0].argv, ['legacy-shell', '-c', 'sleep 1']);
  await proc.done;
  assert.deepEqual(proc.sandbox, { mode: 'workspace-write', denied: true, enforcement: 'full' });
});

test('run-start seam: when startArgv returns a Promise, start returns a Promise too, with the facts on the handle', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({
    ctx,
    modules: makeModules({ base: makeRunStartBase({ asyncStartArgv: true }) }),
    metadata: RUN_START_METADATA,
  });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const starting = executor.start(executor.resolve({ command: 'sleep 1' }));
  assert.equal(typeof starting.then, 'function', 'an asynchronous base class must keep the Promise');
  const proc = await starting;
  assert.deepEqual(confine.calls[0].argv, ['legacy-shell', '-c', 'sleep 1']);
  await proc.done;
  assert.deepEqual(proc.sandbox, { mode: 'workspace-write', denied: true, enforcement: 'full' });
});

test('run-start seam: a synchronous 0.1.5 confine takes effect directly, with no extra await', async () => {
  const calls = [];
  const ctx = makeCtx({
    sandbox: {
      confine(argv, policy) {
        calls.push({ argv: [...argv], policy });
        // A 0.1.5 provider returns ConfinedArgv synchronously, and the facade
        // has to keep that path synchronous.
        return { argv: ['runner', ...argv], enforcement: 'partial', denialSignatures: [], runnerFailureRules: [] };
      },
    },
  });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeRunStartBase({ exitCode: 0, stderr: '' }) }), metadata: RUN_START_METADATA });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const proc = executor.start(executor.resolve({ command: 'id' }));
  assert.equal(typeof proc.then, 'undefined');
  assert.deepEqual(executor.seenArgv[0], ['runner', 'legacy-shell', '-c', 'id']);
  assert.deepEqual(calls[0].policy.mode, 'workspace-write');
  await proc.done;
  assert.deepEqual(proc.sandbox, { mode: 'workspace-write', denied: false, enforcement: 'partial' });
});

test('run-start seam: the 0.1.6 { result, spawnRequested } wrapper is normalized', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider });
  const shell = createShellFacade({
    ctx,
    modules: makeModules({ base: makeRunStartBase({ wrapped: true }) }),
    metadata: RUN_START_METADATA,
  });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const result = await executor.run(executor.resolve({ command: 'ls' }));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.sandbox, { mode: 'workspace-write', denied: true, enforcement: 'full' });
});

test('run-start seam: danger-full-access bypasses confine and still reports the unconfined facts', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider, policy: { mode: 'danger-full-access', workspaceRoot: '/w' } });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeRunStartBase({ exitCode: 0, stderr: '' }) }), metadata: RUN_START_METADATA });

  const executor = new (shell.base({ shellArgv: spec => ['legacy-shell', '-c', spec.command] }))(ctx, {});
  const result = await executor.run(executor.resolve({ command: 'ls' }));
  assert.equal(confine.calls.length, 0);
  assert.deepEqual(result.sandbox, { mode: 'danger-full-access', denied: false });
  assert.deepEqual(executor.seenArgv[0], ['legacy-shell', '-c', 'ls']);
});

test('when the local executor module is missing, base() returns undefined and the rest keeps safe empty values', () => {
  const ctx = makeCtx({ sandbox: makeConfine().provider });
  const shell = createShellFacade({ ctx, modules: {}, metadata: EXECUTE_METADATA });

  assert.equal(shell.base({ shellArgv: () => ['x'] }), undefined);
  assert.deepEqual(shell.candidatePwshPaths(), []);
  assert.deepEqual(shell.parseExitStatus('output\n[exit code: 2]'), { body: 'output\n[exit code: 2]' });
});

test('a patch that declares no shell metadata does not guess a seam: base() returns undefined', () => {
  const ctx = makeCtx({ sandbox: makeConfine().provider });
  const shell = createShellFacade({ ctx, modules: makeModules({ base: makeExecuteBase() }) });
  assert.equal(shell.base({ shellArgv: () => ['x'] }), undefined);
});

test('parseExitStatus and candidatePwshPaths forward to the real modules', () => {
  const ctx = makeCtx({ sandbox: makeConfine().provider });
  const shell = createShellFacade({
    ctx,
    modules: {
      ...makeModules({ base: makeExecuteBase() }),
      shell: { parseExitStatus: text => ({ body: text.replace(/\n\[exit code: 3\]$/, ''), exitCode: 3 }) },
      pwshLocal: {
        PwshLocalExecutor: makeExecuteBase(),
        candidatePwshPaths: env => [`${env?.ProgramFiles ?? 'C:\\Program Files'}\\PowerShell\\7\\pwsh.exe`],
      },
    },
    metadata: EXECUTE_METADATA,
  });

  assert.deepEqual(shell.parseExitStatus('oops\n[exit code: 3]'), { body: 'oops', exitCode: 3 });
  assert.deepEqual(shell.candidatePwshPaths({ ProgramFiles: 'D:\\Apps' }), ['D:\\Apps\\PowerShell\\7\\pwsh.exe']);
});

test('the platform word can be overridden by ctx.subprocess.terminalEnvironment, selecting the bash base class', async () => {
  const ctx = makeCtx({
    sandbox: makeConfine().provider,
    subprocess: { terminalEnvironment: async () => ({ platform: 'posix', defaultShell: '/bin/bash' }) },
  });
  const shell = createShellFacade({
    ctx,
    modules: makeModules({ base: makeExecuteBase(), bashModule: { LocalBashExecutor: makeExecuteBase({ argvPrefix: ['bash'] }) } }),
    metadata: EXECUTE_METADATA,
  });

  // Platform probing is asynchronous: let one event-loop turn pass before reading.
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(shell.platform(), 'posix');
  assert.equal(shell.localPackage(), POSIX_PACKAGE);
  assert.equal(typeof shell.base({ shellArgv: () => ['x'] }), 'function');
});

test('sandbox.confine normalizes to a Promise and copies the provider result', async () => {
  const confine = makeConfine();
  const ctx = makeCtx({ sandbox: confine.provider });
  const sandbox = createSandboxFacade({ ctx, modules: {} });

  const prepared = sandbox.confine(['my-shell', '-c', 'id'], { mode: 'read-only', workspaceRoot: '/w' });
  assert.ok(prepared instanceof Promise, 'an older synchronous return must be a Promise too');
  const resolved = await prepared;
  assert.deepEqual(resolved.argv, ['runner', 'my-shell', '-c', 'id']);
  assert.equal(resolved.enforcement, 'full');
  assert.deepEqual(resolved.denialSignatures, ['denied']);
  assert.deepEqual(resolved.runnerFailureRules, []);
});

test('sandbox.confine fails loudly when there is no provider', async () => {
  const sandbox = createSandboxFacade({ ctx: makeCtx({}), modules: {} });
  await assert.rejects(sandbox.confine(['x'], {}), /ctx\.sandbox provider is not composed/);
});

test('sandbox classification computes from the rule fields itself when the module is missing', () => {
  const sandbox = createSandboxFacade({ ctx: makeCtx({}), modules: {} });

  const denied = sandbox.classify({ exitCode: 1, stderr: 'Access Denied: EACCES', signatures: ['eacces'], rules: [] });
  assert.deepEqual(denied, { denied: true });

  const runner = sandbox.classify({
    exitCode: 127,
    stderr: 'runner: profile missing',
    signatures: ['denied'],
    rules: [{ allowedExitCodes: [127], informationalLines: ['benign'], fatalSignatures: ['profile missing'] }],
  });
  assert.deepEqual(runner, { denied: false, runnerFailure: 'runner: profile missing' });

  // A mismatched exit-code gate must not report a runner failure.
  const gated = sandbox.classify({
    exitCode: 1,
    stderr: 'runner: profile missing',
    signatures: [],
    rules: [{ allowedExitCodes: [127], fatalSignatures: ['profile missing'] }],
  });
  assert.deepEqual(gated, { denied: false });

  // A malformed rule with no fatalSignatures is not trusted.
  const malformed = sandbox.classify({ exitCode: 1, stderr: 'boom', signatures: [], rules: [{ informationalLines: [] }] });
  assert.deepEqual(malformed, { denied: false });
});

test('sandbox throws a capability error for a missing module symbol, or falls back to an Error carrying the code', () => {
  const sandbox = createSandboxFacade({ ctx: makeCtx({}), modules: {} });

  assert.throws(() => sandbox.denialMarker('read-only'), /@deepseek-ai\/dsh-sandbox/);
  assert.throws(() => sandbox.escalationHintMarker('command'), /@deepseek-ai\/dsh-sandbox/);
  assert.throws(() => sandbox.validateEscalationArgs(undefined, 'x'), /@deepseek-ai\/dsh-sandbox/);

  const unavailable = sandbox.unavailableError('workspace-write', 'runner missing');
  assert.equal(unavailable.name, 'SandboxUnavailableError');
  assert.equal(unavailable.code, 'SANDBOX_UNAVAILABLE');
  assert.match(unavailable.message, /runner missing/);

  assert.deepEqual(sandbox.escalationTargets(), []);
});

test('sandbox forwards the escalation vocabulary and the module-level classifiers', async () => {
  const targets = ['workspace-write', 'danger-full-access'];
  const calls = [];
  const modules = {
    sandbox: {
      ESCALATION_TARGETS: targets,
      validateEscalationArgs: (mode, justification) => calls.push(['validate', mode, justification]),
      approveEscalation: async request => `granted:${request.mode}`,
      sandboxDenialMarker: mode => `[denied:${mode}]`,
      escalationHintMarker: subject => `[hint:${subject}]`,
      matchesSignature: (exitCode, stderr, signatures) => exitCode !== 0 && signatures.some(s => stderr.includes(s)),
      classifyRunnerFailure: (exitCode, stderr, rules) => {
        for (const rule of rules) if (rule.fatalSignatures.some(sig => stderr.includes(sig))) return { detail: stderr };
        return undefined;
      },
    },
  };
  const sandbox = createSandboxFacade({ ctx: makeCtx({}), modules });

  assert.deepEqual(sandbox.escalationTargets(), targets);
  // A copy is returned: a caller cannot reach the host's escalation vocabulary.
  sandbox.escalationTargets().push('nope');
  assert.deepEqual(targets, ['workspace-write', 'danger-full-access']);

  sandbox.validateEscalationArgs(undefined, 'reason');
  assert.deepEqual(calls, [['validate', undefined, 'reason']]);
  assert.equal(await sandbox.approveEscalation({ mode: 'workspace-write' }, {}), 'granted:workspace-write');
  assert.equal(sandbox.denialMarker('read-only'), '[denied:read-only]');
  assert.equal(sandbox.escalationHintMarker('command'), '[hint:command]');
  assert.deepEqual(
    sandbox.classify({
      exitCode: 1,
      stderr: 'EACCES',
      signatures: ['EACCES'],
      rules: [{ fatalSignatures: ['EACCES'] }],
    }),
    { denied: true, runnerFailure: 'EACCES' },
  );
});
