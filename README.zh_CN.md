<div align="center">

![Banner](./docs/banner.png)

# dshloader

**面向 dsh（DeepSeek Harness）的版本感知运行时兼容层：按 patch 适配宿主，统一管理插件配置与资源生命周期。**

[English](README.md) | [简体中文](#中文)

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

## 中文

dsh-loader **2.0.0** 为每个受支持的 dsh patch 提供独立适配器，保留稳定的宿主能力入口和客户端 UI facade，新增独立的 config-api 与统一配置表单。

内置适配层：`0.1.5`、`0.1.6`、`0.1.7`、`0.2.0`、`0.2.1`、`0.2.2`、`0.2.3`（含预发布版）。没有匹配适配层时，尝试同一主版本内严格低于当前版本且最接近的适配层，并记录兼容性警告；低于最低支持版本或不受支持的主版本仍拒绝加载。Node 要求 >=24.9.0。

原生 Responses 动态工具追加接口见 [Responses 声明投影](docs/responses-tools.md)：保持顶层工具列表不变，在可信消息原位置生成 `additional_tools`。

### 安装和使用

```sh
npm run build
npm pack
node bin/dshloader.mjs setup <profile-name>
npm install --prefix <profile-directory> <absolute-path-to-dsh-plugin-dsh-loader-2.0.0.tgz>
```

`setup` 向指定 profile 写入依赖和 Cordis patch；随后在同一 profile 安装本地打包文件并重启 dsh。上述步骤不会发布 npm 包。

插件依赖 `dshLoader` 后可使用 `config`、`settings`、`web`、`services`、`registry`、`llm`、`dsh`、`shell`、`sandbox`、`patch`。客户端入口为 `@dsh-plugin/dsh-loader/client`，宿主模块子路径同时提供 ESM 与 CJS 出口。

`shell` 与 `sandbox` 供需要自己实现 `ctx.shell` 的插件使用：`shell.base({ shellArgv })` 返回一个继承当前宿主本地执行器的类，插件只决定 argv，截止时间、输出上限、溢出文件和进程树终止全部沿用宿主；两代执行器接缝（0.1.5/0.1.6 的 `run`/`start` 与 0.1.7 起的 `execute`）由适配器元数据选择，插件不判版本。`sandbox` 归一化 `confine`、结果分类与升级词表。详见 [API](docs/api.md#shell-与-sandbox-门面)。

### 宿主属主路由

需要浏览器属主权限的插件可以从 `@dsh-plugin/dsh-loader` 导入 `ownerRoute`，在声明 `connection` 和 `webServer` 注入后，用 `ctx.webServer.register(ownerRoute(ctx.connection, route))` 注册 `exact` 或 `prefix` 路由。旧宿主使用 Connection 的请求拒绝结果；新版使用 WebServer 的认证准入，并要求活跃的属主 Peer。保留 `register` 返回的注销函数，由路由所属插件管理生命周期。

### 统一插件配置

配置通过 `config.register(ownerCtx, template)` 声明，保存到 `<profile>/config/<插件ID>/config.json`，不依赖 `exposeAllNamespaces`。模板支持分组、嵌套对象和数组、密码、校验及声明式显隐。

模板也可声明临时操作区，宿主通过 `handle.registerOperation()` 注册处理器。支持异步选项、选择回填、文档编辑/导入、只读 Markdown/列表/JSON、可取消长任务及资源 revision 冲突控制；操作草稿不写入配置文件。

配置项还可关联自定义弹窗。插件客户端通过 `dshLoaderUi.config.registerDialog()` 注册 React 界面与数据读取函数；调用 `.save()` 或点击“确认”都会按配置修订号校验并保存该项，失败时保留编辑内容。

0.1.6-alpha.2 之前在“更多 → 设置 → 插件配置”显示聚合页；此版本起进入对应插件详情页。每个插件一个默认折叠卡片，loader 统一生成字段、等宽 label 和 fieldset 分组。保存、取消修改和恢复默认值按卡片独立操作，冲突保留草稿。

- [config-api 与完整示例](docs/config-api.md)
- [版本支持和冻结依据](docs/support.md)
- [1.x → 2.0 迁移](docs/migration-2.0.md)
- [公共 API](docs/api.md)、[架构](docs/design.md)、[UI](docs/ui.md)、[控件](docs/ui-kit.md)
- [验证记录](docs/verification-2.0.md)
- [可运行配置插件](examples/config-plugin/index.mjs)

### 开发验证

```sh
npm run typecheck
npm run build
npm test
npm run test:package
npm run test:browser
```

浏览器验收服务器使用仓库 `.cache/browser/profile`，不读写用户实际 profile。版本矩阵使用已提交的发布契约与完整 npm 锁文件；更新流程见支持表。不会自动迁移其他插件的旧配置，也不会在构建或测试时发布 npm 包。

## 插件市场默认版本

在 DSH Loader 设置中启用 `preferNewestMarketVersion`，市场列表和详情会默认选择 npm `latest` / `next` 标签中 SemVer 较新的兼容版本。默认关闭，沿用官方选版。只选择已收录在市场索引中的版本；显式选版不受影响。仅请求轻量的 dist-tags 接口，成功结果缓存一分钟；查询超时、失败或无可用候选时保留官方默认值，失败请求会在下次读取时重试。设置影响后续读取，已打开的市场列表需要刷新。

也可在 loader 的 Cordis 配置或 profile `package.json` 的 `dsh.dshloader` 下设置 `preferNewestMarketVersion: true`；已保存的设置页值优先。
