/**
 * dshloader client-bundle build (tsdown).
 *
 * dsh's client-modules requires every client bundle to register itself via
 * window.__ModuleLoader__.load({ id: "<package-name>", factory }) — a plain
 * ESM entry (src/client.ts) loaded at /plugins/@dsh-plugin/dsh-loader/client.js
 * would otherwise fail with "loaded without registering ... via
 * __ModuleLoader__.load" and take down the whole client plugin boot.
 *
 * This bundles src/client.ts into a single CJS closure in that exact format.
 * The factory's require() is unused (the loader client has no module-table
 * deps — it talks to the host bridge and window.__ModuleLoader__ directly).
 */
import { fileURLToPath } from 'node:url'

export default {
  entry: { client: fileURLToPath(new URL('./src/client.ts', import.meta.url)) },
  outDir: fileURLToPath(new URL('./lib', import.meta.url)),
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-plugin/dsh-loader", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}
