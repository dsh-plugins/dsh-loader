# dsh-aux-state-loader

Transcription of the **approve-state endpoint** from
`@dsh-plugin/dsh-auxiliary` (`lib/approve-router.js`) into a standalone dsh
bundle plugin written purely against **dshloader's stable API**.

| concern | original (dsh-auxiliary) | here |
| --- | --- | --- |
| web server access | probes `ctx.root.webServer`, re-tries on every `internal/service` event | `inject: ['dshLoader']` + `ctx.dshLoader.web.get()` |
| preset service | `ctx.root.permissionPresets` | `ctx.dshLoader.services.get('permissionPresets')` |
| visibility | none | logs `ctx.dshLoader.settings.describe()` namespaces at boot |

Endpoint (default `GET /api/dsh-aux-state`, override via patch `config.path`):

```json
{
  "approvePluginInstalled": false,
  "presetNames": ["default", "yolo"],
  "loader": { "loaderVersion": "1.0.0", "dshVersion": "0.1.0-rc.7", "adapter": ">=0.1.0-rc.1 <2.0.0" }
}
```

The llm/stream review-router half of approve-router.js is intentionally not
carried over: dshloader v1's stable surface covers web / services / settings,
not llm waterfalls.

## Install into a profile

```sh
# profile package.json: add to dsh.profile.bundles and dependencies
"dsh-aux-state-loader": "link:/path/to/dshloader/examples/dsh-aux-state"
pnpm install --dir ~/.dsh/profiles/<profile>
```
