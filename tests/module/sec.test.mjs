// L2 module tests — settings whitelist security warning (design.md §4.2b TC-SEC-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/index.js';
import { makeMockCtx, makeMockWebServer } from '../helpers/mock.mjs';

// TC-SEC-03: exposeAllNamespaces=true → startup logs explicit security warning.
test('TC-SEC-03 exposeAllNamespaces true logs security warning', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  process.env.DSHLOADER_EXPOSE_ALL_SETTINGS = '1';
  const warns = [];
  const origWarn = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    await apply(ctx);
  } finally {
    console.warn = origWarn;
    delete process.env.DSHLOADER_DSH_VERSION;
    delete process.env.DSHLOADER_EXPOSE_ALL_SETTINGS;
  }
  assert.ok(warns.some((w) => /exposeAllNamespaces enabled: bypassing official settings whitelist/.test(w)));
});

// TC-SEC-03 (negative): default does NOT print the warning.
test('TC-SEC-03 default does not print security warning', async () => {
  const { webServer } = makeMockWebServer();
  const { ctx, registerService } = makeMockCtx();
  registerService('webServer', webServer);
  process.env.DSHLOADER_DSH_VERSION = '1.2.3';
  delete process.env.DSHLOADER_EXPOSE_ALL_SETTINGS;
  const warns = [];
  const origWarn = console.warn;
  console.warn = (m) => warns.push(m);
  try {
    await apply(ctx);
  } finally {
    console.warn = origWarn;
    delete process.env.DSHLOADER_DSH_VERSION;
  }
  assert.ok(!warns.some((w) => /exposeAllNamespaces enabled/.test(w)));
});
