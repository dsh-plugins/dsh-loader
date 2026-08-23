// L1 unit tests for the module-level dsh symbol facade
// (src/services/dsh-symbols.ts → dist/services/dsh-symbols.js).
//
// These pin the two behaviours that matter for a consumer: a required symbol
// that is missing must fail LOUDLY and name the package (so the operator knows
// what to install), and the one genuinely platform-level constant must fall back
// rather than guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDshSymbolsAPI,
  NODE_MAX_TIMER_DELAY_MS,
} from '../dist/services/dsh-symbols.js';

/** A fully-populated module bag, standing in for a real dsh runtime. */
function fullModules() {
  class FakeEngine {}
  class FakeAssembler {}
  class FakeToolArgsError extends Error {}
  return {
    tools: { defineTool: (d) => ({ ...d, defined: true }), ToolArgsError: FakeToolArgsError },
    timeout: { deadline: (...a) => ({ deadline: a }), MAX_TIMER_DELAY_MS: 1234 },
    credentials: { credentialRef: (r) => ({ ref: r }) },
    subagent: { delegationDepthOf: () => 3 },
    compaction: { BasicCompactionEngine: FakeEngine },
    llm: { BlockAssembler: FakeAssembler },
  };
}

test('forwards every symbol to the resolved module', () => {
  const modules = fullModules();
  const dsh = createDshSymbolsAPI({ modules });

  assert.deepEqual(dsh.tools.defineTool({ name: 't' }), { name: 't', defined: true });
  assert.equal(dsh.tools.ToolArgsError, modules.tools.ToolArgsError);
  assert.deepEqual(dsh.timeout.deadline(1, 2), { deadline: [1, 2] });
  assert.equal(dsh.timeout.MAX_TIMER_DELAY_MS, 1234);
  assert.deepEqual(dsh.credentials.credentialRef('r'), { ref: 'r' });
  assert.equal(dsh.subagent.delegationDepthOf({}), 3);
  assert.equal(dsh.compaction.BasicCompactionEngine, modules.compaction.BasicCompactionEngine);
  assert.equal(dsh.llm.BlockAssembler, modules.llm.BlockAssembler);
});

test('the compaction base class is usable as a superclass', () => {
  const dsh = createDshSymbolsAPI({ modules: fullModules() });
  class Sub extends dsh.compaction.BasicCompactionEngine {
    summarize() {
      return 'ok';
    }
  }
  assert.equal(new Sub().summarize(), 'ok');
});

test('MAX_TIMER_DELAY_MS falls back to the Node ceiling when dsh-timeout is absent', () => {
  const dsh = createDshSymbolsAPI({ modules: {} });
  assert.equal(dsh.timeout.MAX_TIMER_DELAY_MS, NODE_MAX_TIMER_DELAY_MS);
  assert.equal(NODE_MAX_TIMER_DELAY_MS, 2 ** 31 - 1, 'must be Node\u2019s setTimeout ceiling');
});

test('every other missing symbol throws loudly and names its package', () => {
  const dsh = createDshSymbolsAPI({ modules: {} });
  const cases = [
    [() => dsh.tools.defineTool({}), /@deepseek-ai\/dsh-tools/],
    [() => dsh.tools.ToolArgsError, /@deepseek-ai\/dsh-tools/],
    [() => dsh.timeout.deadline(), /@deepseek-ai\/dsh-timeout/],
    [() => dsh.credentials.credentialRef('r'), /@deepseek-ai\/dsh-credentials/],
    [() => dsh.subagent.delegationDepthOf({}), /@deepseek-ai\/dsh-subagent/],
    [() => dsh.compaction.BasicCompactionEngine, /@deepseek-ai\/dsh-compaction-basic/],
    [() => dsh.llm.BlockAssembler, /@deepseek-ai\/dsh-llm/],
  ];
  for (const [call, pkg] of cases) {
    assert.throws(call, (error) => {
      assert.match(error.message, /\[dshloader\]/, 'errors carry the dshloader prefix');
      assert.match(error.message, pkg, 'errors name the missing package');
      return true;
    });
  }
});

test('a partially populated bag degrades per symbol, not wholesale', () => {
  const dsh = createDshSymbolsAPI({ modules: { tools: { defineTool: (d) => d } } });
  // Present symbol works ...
  assert.deepEqual(dsh.tools.defineTool({ name: 'x' }), { name: 'x' });
  // ... while a sibling from the same package still reports its absence.
  assert.throws(() => dsh.tools.ToolArgsError, /ToolArgsError/);
});
