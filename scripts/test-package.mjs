/** Verify the packed archive, outside this repository's dependency tree. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const temp = mkdtempSync(join(tmpdir(), 'dsh-loader-package-'));
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
const npm = process.env.npm_execpath;
assert(npm, 'Run through npm run test:package');
const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--pack-destination', temp], { cwd: root }))[0];
const packageDir = join(temp, 'node_modules/@dsh-plugin/dsh-loader');
mkdirSync(packageDir, { recursive: true });
run('tar', ['-xf', join(temp, packed.filename), '-C', packageDir, '--strip-components=1']);
assert.equal(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version, '2.0.0');
for (const file of ['README.zh_CN.md', 'docs/config-api.md', 'docs/support.md', 'examples/config-plugin/index.mjs']) {
  assert(packed.files.some(entry => entry.path === file), `Missing packed documentation: ${file}`);
}
const link = (name) => {
  const target = dirname(require.resolve(`${name}/package.json`));
  const destination = join(temp, 'node_modules', name);
  mkdirSync(dirname(destination), { recursive: true });
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
};
for (const name of ['semver', '@icon-park/react', '@types/node', '@types/react', '@types/react-dom', '@types/prop-types', 'csstype', 'undici-types']) link(name);
writeFileSync(join(temp, 'package.json'), JSON.stringify({ type: 'module', private: true }));

function walk(folder) { return readdirSync(folder, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(folder, item.name)) : [join(folder, item.name)]); }
for (const file of walk(packageDir).filter(file => file.endsWith('.d.ts'))) {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert(!/(?:from\s*|import\s*\()\s*['"]@deepseek-ai\//.test(source), `Upstream type dependency: ${file}`);
}
const subpaths = Object.keys(JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).exports)
  .filter(name => !['./package.json', './cordis.patch.yml'].includes(name));
writeFileSync(join(temp, 'consumer.mts'), subpaths.map((path, index) => `import type * as Entry${index} from '@dsh-plugin/dsh-loader${path === '.' ? '' : path.slice(1)}';`).join('\n') + `
import { defineConfig, type ConfigHandle } from '@dsh-plugin/dsh-loader/config';
import type { HostAPI, CordisContext } from '@dsh-plugin/dsh-loader';
import type { ToolArgsError } from '@dsh-plugin/dsh-loader/tools';
import type { SlotCore } from '@dsh-plugin/dsh-loader/ui-slots';
interface Example { title: string }
declare const api: HostAPI, ctx: CordisContext;
const handle: Promise<ConfigHandle<Example>> = api.config.register<Example>(ctx, defineConfig({ id: 'example', packageName: '@example/plugin', title: 'Example', fields: [{ type: 'text', key: 'title', label: 'Title' }] }));
`);
writeFileSync(join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: false, module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023', jsx: 'react-jsx', types: ['node', 'react'] }, files: ['consumer.mts'] }));
const typescriptPackage = require.resolve('typescript/package.json');
const typescript = JSON.parse(readFileSync(typescriptPackage, 'utf8'));
try { run(process.execPath, [resolve(dirname(typescriptPackage), typescript.bin.tsc), '-p', join(temp, 'tsconfig.json')]); }
catch (error) { console.error(String(error.stdout)); process.exit(1); }
console.log('Packed declarations: all public subpaths typecheck without dsh installed.');

// Only runtime ABI fixtures are installed after the no-upstream type test.
const names = ['tools', 'llm', 'agent', 'settings', 'timeout', 'subagent', 'credentials', 'compaction-basic'];
for (const name of names) {
  const dir = join(temp, 'node_modules/@deepseek-ai/dsh-' + name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-' + name, type: 'module', exports: './index.js' }));
  const source = readFileSync(join(packageDir, 'src/stable', name + '.js'), 'utf8');
  const exports = [...source.matchAll(/export const (\w+) =/g)].map(match => match[1]);
  writeFileSync(join(dir, 'index.js'), exports.map(name => name === 'defineTool' ? 'export function defineTool(value) { return value; }' : `export const ${name} = {};`).join('\n') + (source.includes('export default') ? '\nexport default {};' : ''));
}
writeFileSync(join(temp, 'runtime.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Module = require('node:module');
const original = Module._resolveFilename;
const root = await import('@dsh-plugin/dsh-loader');
assert.equal(root.name, '@dsh-plugin/dsh-loader');
for (const name of ${JSON.stringify(names)}) {
  const esm = await import('@dsh-plugin/dsh-loader/' + name);
  const cjs = require('@dsh-plugin/dsh-loader/' + name);
  for (const name of Object.keys(esm)) assert.equal(esm[name], cjs[name]);
}
const { defineTool } = await import('@dsh-plugin/dsh-loader/tools');
const sample = { name: 'test' }; assert.equal(defineTool(sample), sample);
const { defineConfig } = require('@dsh-plugin/dsh-loader/config'); assert.equal(typeof defineConfig, 'function');
assert.equal(typeof require('@dsh-plugin/dsh-loader/patch').patchSlot, 'function');
assert.equal(Module._resolveFilename, original, 'ESM/CJS exports must work without installing resolver hooks');
`);
console.log(run(process.execPath, ['runtime.mjs'], { env: { ...process.env, DSHLOADER_DSH_VERSION: '0.1.5-rc.3' } }));
let rejected = false;
try { run(process.execPath, ['runtime.mjs'], { env: { ...process.env, DSHLOADER_DSH_VERSION: '0.9.0' } }); }
catch (error) { rejected = /no adapter covers/.test(String(error.stderr)); }
assert(rejected, 'Unknown patch must reject stable imports');
const browser = readFileSync(join(packageDir, 'lib/client.js'), 'utf8');
assert(!/from\s*['"]node:|require\(['"]node:/.test(browser), 'Browser bundle imports Node modules');
console.log(`Packed ESM/CJS imports, unsupported-version rejection and browser separation passed (${packed.files.length} files).\nArchive: ${join(temp, packed.filename)}`);
