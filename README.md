<div align="center">

![Banner](./docs/banner.png)

# dshloader

**A version-aware runtime compatibility shim that keeps third-party plugins working unchanged across dsh (DeepSeek Harness) upgrades.**

[English](#english) | [简体中文](README.zh_CN.md)

[![DSH Plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4f7cff)](https://github.com/topics/dsh-plugin)
<a href="https://github.com/dsh-plugins/dsh-loader/actions/workflows/npm-publish.yml">
  <img src="https://github.com/dsh-plugins/dsh-loader/actions/workflows/npm-publish.yml/badge.svg" alt="Build Status">
</a>
<a href="https://www.npmjs.com/package/@dsh-plugin/dsh-loader">
  <img src="https://img.shields.io/npm/v/@dsh-plugin/dsh-loader.svg?sanitize=true" alt="Version">
</a>
<a href="https://www.npmjs.com/package/@dsh-plugin/dsh-loader">
  <img src="https://img.shields.io/npm/l/@dsh-plugin/dsh-loader.svg?sanitize=true" alt="License">
</a>

</div>

## English

A runtime compatibility shim for **dsh** (DeepSeek Harness) cordis bundle
plugins. dshloader decouples third-party plugins from dsh's internal service
names, module paths, package names, and RPC details through a version-aware
**adapter registry**, so that when dsh upgrades and breaks internal APIs, you
only upgrade dshloader — plugins keep working unchanged.

### Why

dsh is moving fast and its internal surface changes between releases:

- `httpServer` was renamed to `webServer` — old plugins that inject
  `httpServer` hang forever.
- Deep source imports like
  `@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts`
  break when dsh ships no `src/`.
- Client UI packages like `@deepseek-ai/dsh-client-ui-primitives` could be
  renamed in future dsh versions, breaking every plugin that imports them
  directly.
- The official `dsh-host-apiproxy` hardcodes a settings namespace whitelist,
  so third-party settings cards never appear in the Web UI.

dshloader absorbs these (and future) breaks behind a **stable API**:
`ctx.dshLoader` on the host, `window.__dshLoader__` in the browser, and
`@dsh-plugin/dsh-loader/*` stable subpaths for package imports.

### Quick start

#### 1. Install dshloader into a profile

```sh
dsh plugin --profile <name> add /path/to/dshloader
# or
DSH_HOME=~/.dsh npx dshloader setup <name>
```

#### 2. Plugin `package.json` — only depend on dshloader

```json
{
  "dependencies": {
    "@dsh-plugin/dsh-loader": "link:..."
  }
}
```

> **Plugins must NOT declare any `@deepseek-ai/*` dependency.** All dsh
> packages are accessed through dshloader's stable subpaths.

#### 3. Host side — use `ctx.dshLoader`

```js
export const inject = ['dshLoader'];

export async function apply(ctx) {
  // Settings: register a namespace
  const scope = ctx.dshLoader.settings.register('my-plugin', schema);

  // Web: register routes and WebSocket upgrades
  ctx.dshLoader.web.get('/api/my-plugin/status', (req, res) => res.json({ ok: true }));
  ctx.dshLoader.web.registerUpgrade({ path: '/ws/my-plugin', handler: fn });

  // Services: read cordis services
  const sessions = ctx.dshLoader.services.get('sessions');
}
```

#### 4. Import dsh packages via stable subpaths

```js
// Host packages
const { defineTool } = require('@dsh-plugin/dsh-loader/tools');

// Client UI packages (in client bundle source)
import { IconCloseFill14 } from '@dsh-plugin/dsh-loader/ui-primitives';
```

**Stable subpath → real dsh package mapping (dsh 1.x):**

| Stable subpath | Real dsh package |
|---|---|
| `@dsh-plugin/dsh-loader/tools` | `@deepseek-ai/dsh-tools` |
| `@dsh-plugin/dsh-loader/llm` | `@deepseek-ai/dsh-llm` |
| `@dsh-plugin/dsh-loader/agent` | `@deepseek-ai/dsh-agent` |
| `@dsh-plugin/dsh-loader/settings` | `@deepseek-ai/dsh-settings` |
| `@dsh-plugin/dsh-loader/ui-primitives` | `@deepseek-ai/dsh-client-ui-primitives` |
| `@dsh-plugin/dsh-loader/ui-slots` | `@deepseek-ai/dsh-client-ui-slots` |
| `@dsh-plugin/dsh-loader/ui-settings` | `@deepseek-ai/dsh-client-ui-settings/client` |
| `@dsh-plugin/dsh-loader/web-react` | `@deepseek-ai/dsh-client-web-react` |
| `@dsh-plugin/dsh-loader/schema-form` | `@deepseek-ai/dsh-client-schema-form` |
| `@dsh-plugin/dsh-loader/runtime` | `@deepseek-ai/dsh-client-runtime/client` |

When dsh renames a package, only the dshloader adapter changes — plugin
source and bundle stay the same.

#### 5. Client side — use `window.__dshLoader__`

```js
// Read cordis client services
const conv = window.__dshLoader__.services.get('conversation');

// Register a package alias at runtime (fallback)
window.__dshLoader__.registerPackageAlias('@old/pkg', '@new/pkg');
```

#### 6. Build config — mark stable subpaths as external

```ts
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@dsh-plugin/dsh-loader/ui-primitives',
  '@dsh-plugin/dsh-loader/ui-slots',
  '@dsh-plugin/dsh-loader/ui-settings',
  '@dsh-plugin/dsh-loader/web-react',
  '@dsh-plugin/dsh-loader/schema-form',
  '@dsh-plugin/dsh-loader/runtime',
]
```

### How it works

```
plugin ──▶ ctx.dshLoader.{settings,web,services} ──▶ dshloader adapter
                                                         │
                                                         ▼
                                               real dsh (current version)

plugin bundle ──▶ require('@dsh-plugin/dsh-loader/ui-primitives')
                         │
                         ▼ (__ModuleLoader__ wrapper maps stable name)
                   require('@deepseek-ai/dsh-client-ui-primitives')
                         │
                         ▼
                   dsh module table
```

1. **Version detection** reads `node_modules/@deepseek-ai/dsh/package.json`
   (or `DSHLOADER_DSH_VERSION` for tests/override).
2. **AdapterRegistry** selects the best adapter for the detected version
   (exact → range → nearest-low fallback → clear error).
3. The selected **adapter** registers service aliases, installs package-name
   mapping hooks (host: `Module._resolveFilename`; client:
   `__ModuleLoader__.load` wrapper), and (only when opted in) the settings
   whitelist bypass bridge. All registrations use `ctx.reflect.provide` /
   `ctx.effect`, so cordis auto-recycles them on fiber unload.

> **Load order does not matter.** cordis is reactive dependency injection:
> plugins declaring `inject: [...]` stay `PENDING` until the alias is
> provided, regardless of where dshloader sits in `cordis.patch.yml`.

### Settings whitelist bypass (`exposeAllNamespaces`)

By default dshloader **does not** bypass the official settings namespace
whitelist. Opt in explicitly:

- env: `DSHLOADER_EXPOSE_ALL_SETTINGS=1`
- profile `package.json`: `dsh.dshloader.exposeAllNamespaces: true`

> **Security trade-off**: enabling this removes the official default-deny
> boundary for browser settings access. Only enable it in profiles where you
> trust every installed plugin.

### CLI

```
dshloader setup <profile>        Inject dshloader into a profile (dep + patch).
dshloader dump-config <profile>  Run `dsh --profile <name> --dump-config`.
dshloader info [profile]         Print loader version, detected dsh version,
                                 selected adapter.
```

### Rollback / disable

- Disable per launch: `DSHLOADER_DISABLE=1 dsh web`
- Remove: `dsh plugin --profile <name> rm @dsh-plugin/dsh-loader`

### Project layout

```
src/
  index.ts            host bundle entry (name / inject / apply)
  client.ts           client bundle entry (immediately tier)
  api.ts              DshLoaderHostAPI construction
  registry.ts         AdapterRegistry + version detection
  types.ts            shared host/client TypeScript types
  version.ts          loader version + log prefix
  stable/             stable subpath re-exports (ui-primitives, tools, ...)
  services/
    settings.ts       settings stable API
    web.ts            web stable API
    services.ts       services stable API (get / alias)
  adapters/
    dsh-1-x.ts        dsh 1.x adapter
    index.ts          adapter registration
  setup.ts            profile injection + dump-config + info
bin/dshloader.mjs     CLI entry
dist/                 compiled host build (tsc output, git-ignored)
lib/                  compiled client bundle (tsdown output, git-ignored)
tsconfig.json         typecheck config
tsconfig.build.json   host build config (emits dist/)
tsdown.client.config.mjs  client bundle build config
docs/
  api.md              full API reference (Chinese)
  design.md           design document (Chinese)
tests/                L1 (unit) / module (L2) / integration (L3)
examples/
  sample-plugin/      minimal example plugin
  dsh-aux-state/      example using ctx.dshLoader only
```

### Develop

```sh
pnpm install
npm run typecheck   # type-check src/**/*.ts
npm run build       # compile host (dist/) + client bundle (lib/)
npm test            # all tests
npm run test:l1     # unit
npm run test:l2     # module
npm run test:l3     # integration
```

Node.js >= 18, `node --test`, no extra test framework.

### License

LGPL-3.0-only (GNU Lesser General Public License v3 only). See [LICENSE](./LICENSE).
