// L1 regression tests for the setup CLI's patch injection (src/setup.ts → dist/setup.js).
//
// Bug found on a real profile: the scaffold cordis.patch.yml ships as a single
// empty-list document (`[]`), and injectPatch appended the insert entry after
// it WITHOUT a `---` separator — producing two YAML documents in one stream,
// which dsh rejects at profile boot ("end of the stream or a document separator
// is expected"). The fix replaces the empty list with the entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { injectPatch } from '../dist/setup.js';

const SCAFFOLD = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '[]',
  '',
].join('\n');

/** A throwaway "profile" directory with just the files injectPatch touches. */
function makeProfileDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dshloader-patch-'));
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('injectPatch REPLACES the scaffold empty list instead of appending a second document', () => {
  const prof = makeProfileDir();
  try {
    writeFileSync(prof.patchPath, SCAFFOLD);
    const r = injectPatch(prof.patchPath);
    assert.equal(r.added, true);

    const text = readFileSync(prof.patchPath, 'utf8');
    // Exactly one YAML document: the empty `[]` must be gone…
    assert.ok(!/^\[\]\s*$/m.test(text), 'the empty-list document must be replaced');
    // …and the entry must be present.
    assert.match(text, /- insert:/);
    assert.match(text, /id: dsh-loader/);
    // Single-document invariant: no bare document boundary may appear.
    assert.ok(!/^---\s*$/m.test(text), 'must not introduce a --- separator');
  } finally {
    prof.cleanup();
  }
});

test('injectPatch appends WITH a --- separator to a non-empty patch file', () => {
  const prof = makeProfileDir();
  try {
    const existing = [
      '- id: some-other-loader',
      '  name: "@other/plugin"',
      '',
    ].join('\n');
    writeFileSync(prof.patchPath, existing);
    const r = injectPatch(prof.patchPath);
    assert.equal(r.added, true);

    const text = readFileSync(prof.patchPath, 'utf8');
    assert.match(text, /id: some-other-loader/, 'existing entries preserved');
    assert.match(text, /---\n- insert:/, 'a proper document separator precedes our entry');
    assert.match(text, /id: dsh-loader/);
  } finally {
    prof.cleanup();
  }
});

test('injectPatch is idempotent (second run is a no-op)', () => {
  const prof = makeProfileDir();
  try {
    writeFileSync(prof.patchPath, SCAFFOLD);
    injectPatch(prof.patchPath);
    const before = readFileSync(prof.patchPath, 'utf8');
    const r2 = injectPatch(prof.patchPath);
    assert.equal(r2.added, false);
    assert.equal(readFileSync(prof.patchPath, 'utf8'), before);
  } finally {
    prof.cleanup();
  }
});

test('injectPatch handles an absent file by creating one', () => {
  const prof = makeProfileDir();
  try {
    const r = injectPatch(prof.patchPath);
    assert.equal(r.added, true);
    const text = readFileSync(prof.patchPath, 'utf8');
    assert.match(text, /- insert:/);
    assert.doesNotMatch(text, /^---/m);
  } finally {
    prof.cleanup();
  }
});
