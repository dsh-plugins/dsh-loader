<div align="center">

![Banner](./docs/banner.png)

# dshloader

**Patch-specific dsh adapters, owned resources, and declarative plugin configuration.**

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

dsh-loader **2.0.0** provides independent adapters for dsh patch releases, stable host capability facades, client UI helpers, and a new configuration API with centrally generated forms.

Supported patch families: `0.1.5`, `0.1.6`, `0.1.7`, `0.2.0`, `0.2.1`, `0.2.2`, including prereleases. The published release inventory and dependency resolution are frozen on 2026-10-30. Unknown patches, majors, and older versions are rejected. Requires Node >=24.9.0.

### Install

```sh
npm run build
npm pack
node bin/dshloader.mjs setup <profile-name>
npm install --prefix <profile-directory> <absolute-path-to-dsh-plugin-dsh-loader-2.0.0.tgz>
```

`setup` writes the dependency and Cordis patch to the named profile. Install the locally packed archive into that same profile, then restart dsh. These commands do not publish the package.

Inject `dshLoader` to access `config`, `settings`, `web`, `services`, `registry`, `llm`, `dsh`, and `patch`. The client entry is `@dsh-plugin/dsh-loader/client`; host module subpaths have explicit ESM and CJS exports.

### Configuration

Register a JSON template through `config.register(ownerCtx, template)`. Values persist at `<profile>/config/<pluginID>/config.json`, independently of host settings and `exposeAllNamespaces`. Templates support groups, objects, arrays, passwords, validation, and declarative visibility.

Templates can also declare transient operation panels with host handlers registered through `handle.registerOperation()`: async options, selection-to-editor bindings, editing/import, read-only Markdown/list/JSON results, cancellable long tasks, and resource revision conflicts. Operation drafts never enter the configuration file.

Fields can also open custom dialogs registered by the client through `dshLoaderUi.config.registerDialog()`. Plugins provide a React UI and a data reader; `.save()` and the Confirm button share revision-checked configuration persistence, retaining editor contents on failure.

Before dsh 0.1.6-alpha.2, forms appear under More → Settings → Plugin configuration. Newer versions use the corresponding native plugin detail page. Every plugin has a collapsed card with measured equal-width labels and fieldset groups. Save, cancel, and restore-defaults work per card; failed or conflicting saves preserve drafts.

- [Configuration API and example](docs/config-api.md)
- [Supported versions and frozen evidence](docs/support.md)
- [Migration from 1.x](docs/migration-2.0.md)
- [API](docs/api.md), [architecture](docs/design.md), [UI facade](docs/ui.md), [controls](docs/ui-kit.md)
- [Verification record](docs/verification-2.0.md)
- [Runnable configuration plugin](examples/config-plugin/index.mjs)

### Validate

```sh
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:browser
```

The browser fixture uses `.cache/browser/profile`, not a user profile. Matrix tests use committed npm dependency and contract snapshots. See the support document for refresh instructions. Existing plugin configuration files are not migrated automatically; build and test never publish the package.
