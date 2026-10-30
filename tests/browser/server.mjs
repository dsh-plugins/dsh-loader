import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigStore } from '../../dist/services/config.js';
import { installConfigBridge } from '../../dist/services/config-bridge.js';
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vitest/package.json'));
const vite = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const { createServer } = vite.default ?? vite;
const profile = resolve('.cache/browser/profile'); await mkdir(profile, { recursive: true });
const store = new ConfigStore(profile), releases = [];
await store.register({ effect(fn) { releases.push(fn()); } }, JSON.parse(await readFile(new URL('../fixtures/config-example.json', import.meta.url), 'utf8')));
const route = [];
const off = installConfigBridge({ register(prefix, handler) { route.push({ prefix, handler }); return () => {}; } }, store, () => true);
const server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 4187, strictPort: true }, esbuild: { jsx: 'automatic' }, plugins: [{ name: 'config-fixture', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url?.startsWith('/api/dshloader/config')) route[0].handler(req, res);
    else next();
  });
} }] });
await server.listen();
console.log('Config fixture: http://127.0.0.1:4187/tests/browser/index.html');
process.on('SIGINT', async () => { off(); for (const release of releases) release?.(); store.dispose(); await server.close(); process.exit(); });
