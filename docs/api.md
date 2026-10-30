# 公共 API（2.0.0）

[配置模板与存储](config-api.md) · [版本支持](support.md) · [1.x 迁移](migration-2.0.md) · [UI facade](ui.md) · [UI 控件](ui-kit.md)

## 宿主

插件声明 `inject = ['dshLoader']` 后使用 `ctx.dshLoader`。根入口导出 `HostAPI`、`CordisContext`、`SettingsAPI`、`WebAPI`、`ServicesAPI`、适配器类型及配置类型；配置模板运行时 helper 在 `@dsh-plugin/dsh-loader/config`。

| 入口 | 用途 |
| --- | --- |
| `config.register(ownerCtx, template)` | 独立配置与统一表单，返回 Promise<ConfigHandle<T>> |
| `settings` | 宿主设置 describe/update/replace/mutate；旧 register/installSection 按实际宿主能力提供 |
| `web` | prefix/exact、GET/POST/PUT/PATCH/DELETE、middleware、WebSocket upgrade，返回 disposer |
| `services` | get 与单跳 alias |
| `registry` | tools、sandbox、permission presets 兼容 facade |
| `llm` | createUserMessage、deepFreeze |
| `dsh` | tools、timeout、credentials、subagent、compaction、llm 模块符号 |
| `patch` | method/global/slot，返回 { dispose, active, original } |
| `registerPackageAlias(from, to, ownerCtx?)` | Promise<disposer>；共享解析表，按注册 token 清理 |

`version` 是 loader 版本，`dshVersion` 是当前宿主版本，`adapterVersion` 是选中的 patch。

## 客户端

`@dsh-plugin/dsh-loader/client` 提供 UI 控件与 facade helper。用 `inject: ['dshLoaderUi']` 等待 UI facade，就绪后读取 `ctx.dshLoaderUi` 或 `window.__dshLoader__.ui`。`window.__dshLoader__` 保留 require、services、别名、patch、可选旧 settings rpc，新增 config 客户端。

`registerModuleAlias(from, to, ownerCtx?)` / `registerPackageAlias(from, to, ownerCtx?)` 返回 disposer；忽略返回值的旧代码继续运行。多次 installClient 共用别名表、工厂和包装器，每个安装实例有自己的 dispose。

`config` 客户端提供 `list/read/update/reset/subscribe/dispose`。表单使用 loader 自带客户端，不要求插件编写浏览器配置逻辑。客户端提交必须携带 expectedRevision，密码遮蔽值不能当明文使用。

## 稳定模块子路径

宿主：`tools`、`llm`、`agent`、`settings`、`timeout`、`subagent`、`credentials`、`compaction-basic`，分别有 import/require 出口。实际可用符号受所选 patch 和已安装模块能力约束，缺失时报明确错误。新的跨版本业务优先使用 HostAPI facade。

浏览器：`ui-primitives`、`ui-slots`、`ui-settings`、`runtime`、`schema-form`、`web-react`。打包插件客户端时将这些子路径 external，运行时由启动工厂映射。UI/slot 公共声明由 loader 维护；不需要安装上游 dsh 包才能编译。原始 ABI 中未标准化部分使用宽松类型，详细边界见迁移说明。

## loader 入口配置

```yaml
- insert:
    - id: dsh-loader
      name: '@dsh-plugin/dsh-loader'
      config:
        exposeAllNamespaces: false
        # 自动定位失败时才需要：
        # profileDir: '/absolute/path/to/profile'
```

可选 `hostPackageAliases` 增加显式宿主 CJS 重命名。`DSHLOADER_EXPOSE_ALL_SETTINGS=1` 可开启旧 settings 桥接；`DSHLOADER_DSH_VERSION` 用于测试和诊断覆盖版本检测；`DSHLOADER_DISABLE=1` 跳过加载。不要用版本覆盖变量强行运行未知 patch。

## CLI

`dshloader setup <profile>` 安装入口，`dshloader dump-config <profile>` 验证组合，`dshloader info [profile]` 打印版本和选定适配器。本次实施不发布 npm 包。
