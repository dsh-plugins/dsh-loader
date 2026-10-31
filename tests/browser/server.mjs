import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ConfigStore } from '../../dist/services/config.js';
import { ConfigError } from '../../dist/config.js';
import { installConfigBridge } from '../../dist/services/config-bridge.js';
import { operationsPanel, registerExampleOperations } from '../../examples/config-plugin/operations.mjs';
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vitest/package.json'));
const vite = await import(pathToFileURL(viteRequire.resolve('vite')).href);
const { createServer } = vite.default ?? vite;
const profile = resolve('.cache/browser/profile'); await mkdir(profile, { recursive: true });
const store = new ConfigStore(profile), releases = [];
const template = JSON.parse(await readFile(new URL('../fixtures/config-example.json', import.meta.url), 'utf8'));
template.fields.push({ type: 'array', key: 'models', label: '可选模型', default: ['example-model'], item: { type: 'text', label: '模型 ID' } });
template.fields.push({ type: 'object', key: 'document', label: '文档配置', dialog: { id: 'document-editor', label: '编辑文档配置' }, fields: [
  { type: 'text', key: 'title', label: '文档标题', default: '示例文档', required: true },
  { type: 'textarea', key: 'content', label: '文档正文', default: '配置弹窗的示例内容', required: true },
] });
template.panels = [structuredClone(operationsPanel)];
template.panels[0].operations.push({ id: 'test.external', input: ['documentId'], button: { label: '模拟其他页面修改' } });
const handle = await store.register({ effect(fn) { releases.push(fn()); } }, template);
const { documents } = registerExampleOperations(handle, ConfigError);
handle.registerOperation('test.external', ({ input }) => { const document = documents.get(input.documentId); if (document) document.revision++; return { value: '外部修订已增加' }; });
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
