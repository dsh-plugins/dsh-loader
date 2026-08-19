// L1 unit tests — AdapterRegistry version selection (design.md §4.5, §5.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry, UnsupportedDshVersionError, InvalidVersionError } from '../src/registry.js';

function adapter(supports, name = 'a-' + supports) {
  return { supports, name, create: () => ({ apply() {}, dispose() {} }) };
}

// TC-REG-01: exact version match.
// NOTE: the test plan literally wrote `^1.2.0` for adapter A and expected
// `mode: 'exact'`, but design.md §3.1 rule 1 defines "exact" as a literal
// `supports === version` equality (a range hit is rule 2). To exercise rule 1
// faithfully we use a literal `supports: '1.2.3'` for adapter A.
test('TC-REG-01 exact version match returns mode exact', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('1.2.3', 'A')); // literal exact
  reg.register(adapter('^2.0.0', 'B'));
  const { factory, mode } = reg.select('1.2.3');
  assert.equal(factory.name, 'A');
  assert.equal(mode, 'exact');
});

// TC-REG-02: no exact match → nearest-low fallback with warning.
// NOTE: the test plan literally wrote `^1.0.0` for adapter A with version
// `1.5.0`, but `^1.0.0` (= >=1.0.0 <2.0.0) *does* satisfy 1.5.0, which would
// be a range match, not a fallback. To genuinely exercise the fallback path
// (the case's stated intent) we use `~1.0.0` (= >=1.0.0 <1.1.0), so 1.5.0
// falls above it.
test('TC-REG-02 no exact match falls back to nearest lower adapter', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('~1.0.0', 'A')); // max 1.0.x
  const warns = [];
  const orig = console.warn;
  console.warn = (msg) => warns.push(msg);
  try {
    const { factory, mode } = reg.select('1.5.0');
    assert.equal(factory.name, 'A');
    assert.equal(mode, 'fallback');
    assert.ok(warns.some((w) => w.includes('falling back')));
  } finally {
    console.warn = orig;
  }
});

// TC-REG-03: empty registry → UnsupportedDshVersionError (too new).
test('TC-REG-03 empty registry throws UnsupportedDshVersionError', () => {
  const reg = new AdapterRegistry();
  assert.throws(
    () => reg.select('9.9.9'),
    (err) => err instanceof UnsupportedDshVersionError && /upgrade @dsh-plugin\/dsh-loader/.test(err.message),
  );
});

// TC-REG-04: version below all adapters → "too old" error, distinct message.
test('TC-REG-04 version too old throws distinct too-old error', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('>=1.0.0', 'A'));
  assert.throws(
    () => reg.select('0.9.0'),
    (err) => {
      assert.ok(err instanceof UnsupportedDshVersionError);
      assert.match(err.message, /too old/i);
      assert.match(err.message, /1\.0\.0/);
      assert.equal(err.kind, 'too-old');
      assert.equal(err.minSupported, '1.0.0');
      return true;
    },
  );
});

// TC-BND-REG-01: empty registry (duplicate coverage of error path).
test('TC-BND-REG-01 empty registry select throws', () => {
  const reg = new AdapterRegistry();
  assert.throws(() => reg.select('1.0.0'), UnsupportedDshVersionError);
});

// TC-BND-REG-02: invalid version string → InvalidVersionError.
test('TC-BND-REG-02 invalid version throws InvalidVersionError', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('^1.0.0'));
  assert.throws(() => reg.select('not-a-version'), InvalidVersionError);
});

// TC-BND-REG-03: overlapping ranges → narrowest wins; tie → last registered.
test('TC-BND-REG-03 narrowest overlapping range wins', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('>=1.0.0 <2.0.0', 'A'));
  reg.register(adapter('>=1.5.0 <2.0.0', 'B'));
  const { factory } = reg.select('1.6.0');
  assert.equal(factory.name, 'B'); // B is a subset of A → narrower
});

test('TC-BND-REG-03 tie on identical ranges picks last registered', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('>=1.0.0 <2.0.0', 'A'));
  reg.register(adapter('>=1.0.0 <2.0.0', 'B'));
  const { factory } = reg.select('1.6.0');
  assert.equal(factory.name, 'B'); // last registered wins
});

// Additional: version newer than all bounded adapters → fallback (rule 3),
// NOT a too-new error. Per design.md §3.1 rule 3, when no exact/range hit
// exists but some adapter only covers versions below the real one, the
// nearest-low fallback applies. A too-new error (rule 5) only happens with an
// empty registry (covered by TC-REG-03).
test('rule 3 version newer than all bounded adapters falls back', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('~1.0.0', 'A')); // upper bound 1.1.0 exclusive
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    const { factory, mode } = reg.select('2.0.0');
    assert.equal(mode, 'fallback');
    assert.equal(factory.name, 'A');
    assert.ok(warns.some((w) => /falling back/.test(w)));
  } finally {
    console.warn = orig;
  }
});

// Additional: fallback picks the closest upper bound when several lowers exist.
test('fallback picks nearest upper bound among lower candidates', () => {
  const reg = new AdapterRegistry();
  reg.register(adapter('~1.0.0', 'A')); // upper ~1.1.0
  reg.register(adapter('~1.2.0', 'B')); // upper ~1.3.0
  const { factory, mode } = reg.select('1.9.0');
  assert.equal(mode, 'fallback');
  assert.equal(factory.name, 'B'); // 1.3.0 is closer to 1.9.0 than 1.1.0
});
