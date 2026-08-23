// L1 unit tests for the dshloader PATCH protocol (src/patch.ts → dist/patch.js).
//
// These pin the five guarantees documented on the module, with special
// attention to the two failure modes found in the wild:
//   - unconditional restore destroying a later plugin's wrapper
//     (dsh-better-sidebar's wrapOpenPath)
//   - re-apply nesting a wrapper inside itself (HMR / repeated apply)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPatchAPI, isPatched, patchIdOf, patchSlot } from '../dist/patch.js';

/** A fresh service-like target per case. */
function service() {
  return {
    calls: [],
    greet(name) {
      this.calls.push(name);
      return `hello ${name}`;
    },
  };
}

test('patch.method wraps and dispose restores the raw original', () => {
  const patch = createPatchAPI();
  const target = service();
  const raw = target.greet;

  const handle = patch.method(target, 'greet', original => function (name) {
    return `[wrapped] ${original.call(this, name)}`;
  }, { id: 'test:greet' });

  assert.equal(target.greet('a'), '[wrapped] hello a');
  assert.equal(handle.active, true);
  assert.equal(handle.original, raw);
  assert.equal(isPatched(target, 'greet'), true);
  assert.equal(patchIdOf(target, 'greet'), 'test:greet');

  handle.dispose();
  assert.equal(target.greet, raw, 'the RAW original must be back, not a bound copy');
  assert.equal(target.greet('b'), 'hello b');
  assert.equal(handle.active, false);
  assert.equal(isPatched(target, 'greet'), false);
  assert.equal(patchIdOf(target, 'greet'), undefined);
});

test('dispose is idempotent and never throws', () => {
  const patch = createPatchAPI();
  const target = service();
  const handle = patch.method(target, 'greet', o => o, { id: 'test:noop' });
  handle.dispose();
  handle.dispose();
  handle.dispose();
  assert.equal(isPatched(target, 'greet'), false);
});

// ── guarantee 2: identity-checked restore ──────────────────────────────────
//
// This is the exact scenario dsh-better-sidebar's wrapOpenPath got wrong:
// plugin A patches, plugin B patches on top, then A disposes FIRST.
// B's wrapper must survive.
test('ordered disposal: inner patch disposing first must not destroy the outer wrapper', () => {
  const patch = createPatchAPI();
  const target = service();
  const raw = target.greet;

  const a = patch.method(target, 'greet', original => function (name) {
    return `A(${original.call(this, name)})`;
  }, { id: 'plugin-a:greet' });

  const b = patch.method(target, 'greet', original => function (name) {
    return `B(${original.call(this, name)})`;
  }, { id: 'plugin-b:greet' });

  assert.equal(target.greet('x'), 'B(A(hello x))', 'wrappers chain outward');

  // A disposes first — its slot no longer holds A's wrapper (B does), so A
  // MUST leave the chain untouched.
  a.dispose();
  assert.equal(a.active, false);
  assert.equal(
    target.greet('y'),
    'B(A(hello y))',
    "plugin B's wrapper must still be installed and still reach A's",
  );

  // Now B disposes: it restores what it captured, which is A's wrapper.
  b.dispose();
  assert.equal(target.greet('z'), 'A(hello z)');
  assert.notEqual(target.greet, raw, "B restores A's wrapper, not the raw original");
});

test('ordered disposal: outer patch disposing first unwinds to the inner wrapper', () => {
  const patch = createPatchAPI();
  const target = service();
  const raw = target.greet;

  const a = patch.method(target, 'greet', original => function (n) { return `A(${original.call(this, n)})`; }, { id: 'a' });
  const b = patch.method(target, 'greet', original => function (n) { return `B(${original.call(this, n)})`; }, { id: 'b' });

  b.dispose();
  assert.equal(target.greet('x'), 'A(hello x)');
  a.dispose();
  assert.equal(target.greet, raw, 'unwinding in LIFO order reaches the raw original');
});

// ── guarantee 3: re-apply safety ───────────────────────────────────────────
test('re-applying the same id recovers the original instead of nesting', () => {
  const patch = createPatchAPI();
  const target = service();
  const raw = target.greet;

  const wrap = original => function (name) { return `W(${original.call(this, name)})`; };

  const first = patch.method(target, 'greet', wrap, { id: 'hmr:greet' });
  assert.equal(target.greet('x'), 'W(hello x)');

  // Simulates HMR: apply() runs again with the same id.
  const second = patch.method(target, 'greet', wrap, { id: 'hmr:greet' });
  assert.equal(target.greet('x'), 'W(hello x)', 'must NOT become W(W(hello x))');
  assert.equal(second.original, raw);

  second.dispose();
  assert.equal(target.greet, raw);
  assert.equal(first.active, false, 'the superseded handle is inert');
});

test('a different id chains instead of resetting', () => {
  const patch = createPatchAPI();
  const target = service();
  patch.method(target, 'greet', o => function (n) { return `A(${o.call(this, n)})`; }, { id: 'a' });
  patch.method(target, 'greet', o => function (n) { return `B(${o.call(this, n)})`; }, { id: 'b' });
  assert.equal(target.greet('x'), 'B(A(hello x))');
});

// ── guarantee 4: cross-instance durability ─────────────────────────────────
test('bookkeeping survives a second module instance via the globalThis registry', () => {
  const patchA = createPatchAPI();
  const patchB = createPatchAPI(); // stands in for a reloaded module copy
  const target = service();
  const raw = target.greet;

  patchA.method(target, 'greet', o => function (n) { return `A(${o.call(this, n)})`; }, { id: 'shared:greet' });
  // The "other instance" observes the same slot and the same id.
  assert.equal(patchB.isPatched(target, 'greet'), true);
  assert.equal(patchB.patchIdOf(target, 'greet'), 'shared:greet');

  // Re-apply through the other instance must still find the true original.
  const handle = patchB.method(target, 'greet', o => function (n) { return `A(${o.call(this, n)})`; }, { id: 'shared:greet' });
  assert.equal(target.greet('x'), 'A(hello x)', 'no nesting across instances');
  assert.equal(handle.original, raw);
  handle.dispose();
  assert.equal(target.greet, raw);
});

test('targets are never mutated by the registry', () => {
  const patch = createPatchAPI();
  const target = service();
  const before = Reflect.ownKeys(target).length;
  const handle = patch.method(target, 'greet', o => o, { id: 'clean' });
  assert.equal(Reflect.ownKeys(target).length, before, 'no bookkeeping property added to the target');
  handle.dispose();
});

// ── guarantee 5: loud misuse ───────────────────────────────────────────────
test('patching a missing or non-function slot throws', () => {
  const patch = createPatchAPI();
  const target = service();
  assert.throws(() => patch.method(target, 'nope', o => o), /not a function/);
  target.data = 42;
  assert.throws(() => patch.method(target, 'data', o => o), /number, not a function/);
});

test('a non-object target throws', () => {
  const patch = createPatchAPI();
  assert.throws(() => patch.slot(null, 'x', o => o), /target must be an object/);
  assert.throws(() => patch.slot(7, 'x', o => o), /target must be an object/);
});

test('a wrap that does not return a function throws and leaves the slot intact', () => {
  const patch = createPatchAPI();
  const target = service();
  const raw = target.greet;
  assert.throws(() => patch.method(target, 'greet', () => 'not a function'), /must return a function/);
  assert.equal(target.greet, raw, 'a rejected patch must not disturb the slot');
});

test('a non-writable slot fails loudly rather than silently', () => {
  const patch = createPatchAPI();
  const target = {};
  Object.defineProperty(target, 'frozen', { value: () => 1, writable: false, configurable: false });
  assert.throws(() => patch.method(target, 'frozen', o => o), /dshloader\.patch/);
});

// ── patch.global ───────────────────────────────────────────────────────────
test('patch.global wraps a scoped global and restores it', () => {
  const patch = createPatchAPI();
  const scope = { fetch: async url => `raw:${url}` };
  const raw = scope.fetch;

  const handle = patch.global('fetch', original => async url => `wrapped:${await original(url)}`, {
    scope,
    id: 'network-settings:fetch',
  });

  assert.equal(patch.patchIdOf(scope, 'fetch'), 'network-settings:fetch');
  handle.dispose();
  assert.equal(scope.fetch, raw);
});

test('patch.global defaults to globalThis', () => {
  const patch = createPatchAPI();
  globalThis.__dshloaderPatchProbe__ = () => 'raw';
  try {
    const handle = patch.global('__dshloaderPatchProbe__', o => () => `w:${o()}`, { id: 'probe' });
    assert.equal(globalThis.__dshloaderPatchProbe__(), 'w:raw');
    handle.dispose();
    assert.equal(globalThis.__dshloaderPatchProbe__(), 'raw');
  } finally {
    delete globalThis.__dshloaderPatchProbe__;
  }
});

test('patchSlot is exported directly for callers without a facade', () => {
  const target = service();
  const raw = target.greet;
  const handle = patchSlot(target, 'greet', o => function (n) { return `S(${o.call(this, n)})`; }, { id: 'direct' });
  assert.equal(target.greet('x'), 'S(hello x)');
  handle.dispose();
  assert.equal(target.greet, raw);
});
