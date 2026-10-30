import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { applyAdapter } from '../../dist/index.js';
import { makeMockCtx, makeMockWebServer, makeTempProfile } from '../helpers/mock.mjs';

test('active Cordis context baseUrl anchors profile selection and config storage', async () => {
  const profile = makeTempProfile({ dshVersion: '0.1.5-alpha.1', manifest: { private: true, dsh: { profile: { bundles: [] } } } });
  try {
    const { ctx, registerService } = makeMockCtx();
    registerService('webServer', makeMockWebServer().webServer);
    registerService('loader', { config: {} });
    ctx.baseUrl = pathToFileURL(join(profile.profileDir, 'cordis.yml')).href;
    const { api, dshVersion } = await applyAdapter(ctx);
    assert.equal(dshVersion, '0.1.5-alpha.1');
    const handle = await api.config.register(ctx, { id: 'profile-context-test', packageName: 'profile-context-test', title: 'Test', fields: [] });
    assert.deepEqual(handle.get(), { value: {}, revision: 0 });
    handle.dispose();
  } finally { profile.cleanup(); }
});
