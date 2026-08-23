/**
 * dshloader client-bundle build (tsdown).
 *
 * dsh's client-modules requires every client bundle to register itself via
 * window.__ModuleLoader__.load({ id: "<package-name>", factory }) — a plain
 * ESM entry loaded at /plugins/@dsh-plugin/dsh-loader/client.js would otherwise
 * fail with "loaded without registering ... via __ModuleLoader__.load" and take
 * down the whole client plugin boot.
 *
 * The entry is `src/client-ui.tsx`, which composes the compatibility
 * infrastructure (`src/client.ts`) with the UI surface (`src/ui/`). See
 * src/client-ui.tsx for why the entry is separate from client.ts.
 *
 * Externals are the platform seed modules the web shell shares into its frozen
 * module table; everything else — notably the curated @icon-park/react icons —
 * inlines. React MUST stay external: the shell owns the only React instance, and
 * a second copy inside this bundle would break hooks and context for every
 * component dshloader hands to a plugin.
 */
import { fileURLToPath } from 'node:url'

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/cordis',
  // The wrapped platform menu (src/ui/menu.tsx) resolves through the module
  // table at runtime, exactly like react — the wrapper's whole point is that
  // only this bundle names the package.
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default {
  entry: { client: fileURLToPath(new URL('./src/client-ui.tsx', import.meta.url)) },
  outDir: fileURLToPath(new URL('./lib', import.meta.url)),
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // External wins for module-table entries; every other dependency inlines.
  noExternal: (id) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  // CJS output otherwise makes some transitive packages resolve their Node
  // entry even though this bundle runs in the browser. Keep browser conditional
  // exports authoritative for both source import() and generated require().
  inputOptions: {
    resolve: {
      conditionNames: ['browser', 'import', 'require', 'default'],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@dsh-plugin/dsh-loader", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}
