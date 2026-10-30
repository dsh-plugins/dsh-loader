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
  "loader": { "loaderVersion": "2.0.0", "dshVersion": "0.1.5-rc.3", "adapter": "0.1.5" }
}
```

The llm/stream review-router half of approve-router.js is intentionally not
carried over; this example focuses on web / services / settings. See the 2.0 API documentation for llm and dsh capabilities.

## Install into a profile

```sh
# profile package.json: add to dsh.profile.bundles and dependencies
"dsh-aux-state-loader": "link:/path/to/dshloader/examples/dsh-aux-state"
pnpm install --dir ~/.dsh/profiles/<profile>
```
