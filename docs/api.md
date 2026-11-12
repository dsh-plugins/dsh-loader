# 公共 API（2.0.0）

[配置模板与存储](config-api.md) · [版本支持](support.md) · [1.x 迁移](migration-2.0.md) · [UI facade](ui.md) · [UI 控件](ui-kit.md)

## 宿主

插件声明 `inject = ['dshLoader']` 后使用 `ctx.dshLoader`。根入口导出 `HostAPI`、`CordisContext`、`SettingsAPI`、`WebAPI`、`ServicesAPI`、`ShellFacade`、`SandboxFacade`、`ShellBaseOptions`、`ShellExecutorClass`、`ShellSpecLike`、`SandboxPolicyLike`、`ConfinedArgvLike`、适配器类型及配置类型；配置模板运行时 helper 在 `@dsh-plugin/dsh-loader/config`。

| 入口 | 用途 |
| --- | --- |
| `config.register(ownerCtx, template)` | 独立配置与统一表单，返回 Promise<ConfigHandle<T>> |
| `settings` | 宿主设置 describe/update/replace/mutate；旧 register/installSection 按实际宿主能力提供 |
| `web` | prefix/exact、GET/POST/PUT/PATCH/DELETE、middleware、WebSocket upgrade，返回 disposer |
| `services` | get 与单跳 alias |
| `sessions` | 按需初始化的会话快照、待发状态、排他历史替换与发送拦截；使用前等待 `ready` |
| `registry` | tools、sandbox、permission presets 兼容 facade |
| `llm` | createUserMessage、deepFreeze |
| `dsh` | tools、timeout、credentials、subagent、compaction、llm、subprocess 模块符号 |
| `shell` | 执行器基类门面：平台词、本地执行器包名、归一化基类、`parseExitStatus`、`candidatePwshPaths` |
| `sandbox` | 沙箱门面：升级词表、参数校验、审批、不可用错误、标记生成器、结果分类、`confine` |
| `patch` | method/global/slot，返回 { dispose, active, original } |
| `registerPackageAlias(from, to, ownerCtx?)` | Promise<disposer>；共享解析表，按注册 token 清理 |

`version` 是 loader 版本，`dshVersion` 是当前宿主版本，`adapterVersion` 是选中的 patch。

## shell 与 sandbox 门面

第三方插件实现自己的 `ctx.shell` 时，需要继承宿主当次安装的本地执行器，才能沿用截止时间、输出上限、溢出文件和进程树终止。宿主在 `0.1.5 … 0.2.2` 之间改过两次接缝，门面把差异收在 `PatchMetadata.shell` 的 `seam` 字段里，插件只实现一个 `shellArgv(spec)` 钩子。

| patch 系列 | `ShellExecutor` 抽象方法 | 本地执行器可覆写点 | `ctx.sandbox.confine` |
|---|---|---|---|
| `0.1.5`、`0.1.6` | `resolve` / `run` / `start` | `pwsh`: `protected argv(spec)`；`bash`: `protected runArgv` / `startArgv` | 0.1.5 同步、0.1.6 起 `Promise` |
| `0.1.7`、`0.2.0`、`0.2.1`、`0.2.2` | `resolve` / `execute` | `protected executeArgv(spec, argvOrPrepare, onStarted?)` | `Promise` |

```ts
export interface ShellFacade {
  /** 当前宿主的执行平台词（与 `ctx.subprocess.terminalEnvironment().platform` 同义）。 */
  platform(): 'windows' | 'posix'
  /** 该平台本地执行器包的导出名，用于诊断。 */
  localPackage(): string
  /**
   * 归一化基类：返回一个可直接 `ctx.plugin()` 的执行器类。
   * 它继承宿主自己的本地执行器（pwsh-local / bash-local），把三种接缝统一成一个钩子：
   *   shellArgv(spec) => readonly string[]
   * 返回 undefined 表示该宿主缺少本地执行器包或该 patch 未声明 shell 元数据，
   * 调用方必须响亮报错。
   */
  base(options: ShellBaseOptions): ShellExecutorClass | undefined
  /** `parseExitStatus`（`@deepseek-ai/dsh-shell` 模块级导出）。 */
  parseExitStatus(text: string): { body: string; exitCode?: number; signal?: string }
  /** `candidatePwshPaths`（`@deepseek-ai/dsh-pwsh-local`）。缺失时返回 []。 */
  candidatePwshPaths(env?: NodeJS.ProcessEnv): string[]
}

export interface ShellBaseOptions {
  /** 构建一次调用的完整 argv（含可执行文件本身）。 */
  shellArgv(spec: ShellSpecLike): readonly string[]
}
```

`base()` 生成的类必须：声明 `static inject = ['subprocess', 'sandbox', 'sandboxPolicy']`；`resolve(request)` 等于父类结果再补 `sandboxPolicy: request.sandboxPolicy ?? ctx.sandboxPolicy.resolve()`；`run`/`start`（老代）与 `execute`（新代）把 argv 换成 `options.shellArgv(spec)`，deadline、输出上限、kill、`onProcessDone` 全部沿用父类；结果与 `proc.sandbox` 都带 `mode`、`denied`、`enforcement`、`runnerFailed` 事实，语义与 `dsh-pwsh-sandbox` 一致。两种接缝的 argv 都只来自 `options.shellArgv`，父类的 `argv`/`runArgv`/`startArgv` 内置 argv 不再被调用。

`sandbox` 把 `confine` 归一化为始终返回 Promise（0.1.5 的同步返回值也包成 Promise），`classify` 优先用宿主模块级导出，老版本缺 `classifyRunnerFailure` 时按规则字段自行计算，规则形状为 `{ allowedExitCodes?, informationalLines?, fatalSignatures }`。

```ts
export interface SandboxFacade {
  /** 当前会话/部署可升级到的模式列表；缺失时 []。 */
  escalationTargets(): readonly string[]
  /** `validateEscalationArgs`；缺失时抛能力错误。 */
  validateEscalationArgs(mode: unknown, justification: unknown): void
  /** `approveEscalation`；缺失时抛能力错误。 */
  approveEscalation(request: unknown, context: unknown): Promise<string>
  /** `SandboxUnavailableError`；缺失时退回带 code 的 Error。 */
  unavailableError(mode: string, detail: string): Error
  /** 拒绝/提示标记生成器。 */
  denialMarker(mode: string): string
  escalationHintMarker(subject: string): string
  /** 归一化的结果分类：等价于旧版三个模块级导出。 */
  classify(input: { exitCode: number | null; stderr: string; signatures: readonly string[]; rules: readonly unknown[] }): { denied: boolean; runnerFailure?: string }
  /** 包装 argv 的归一化入口：老版本同步结果也以 Promise 返回。 */
  confine(argv: readonly string[], policy: unknown, signal?: AbortSignal): Promise<ConfinedArgvLike>
}

export interface ConfinedArgvLike {
  argv: string[]
  enforcement: string
  denialSignatures: readonly string[]
  runnerFailureRules: readonly unknown[]
}
```

`@deepseek-ai/dsh-subprocess` 的 `SubprocessExecutableNotFoundError` 是模块级导出，插件用它区分候选不存在与提供方故障，因此放在 `dsh.subprocess.notFoundError` 上：

```ts
dsh.subprocess: {
  /** 构造一个 `SubprocessExecutableNotFoundError` 形状的错误；缺失时返回带同名字段的 Error。 */
  notFoundError(message: string): Error
}
```

上游模块缺失时，`base` 返回 `undefined`（由调用方决定是否响亮失败），`escalationTargets` 返回 `[]`，`validateEscalationArgs`、`approveEscalation`、`denialMarker`、`escalationHintMarker` 抛能力不可用错误，`unavailableError` 退回带 `SANDBOX_UNAVAILABLE` code 的 Error，`classify` 用本地等价实现，`parseExitStatus` 返回原文，`candidatePwshPaths` 返回 `[]`。

适配器声明 `PatchMetadata.shell`（`localPackage: { windows, posix }` 与 `seam: 'run-start' | 'execute'`）。`0.1.5`、`0.1.6` 为 `'run-start'`，其余为 `'execute'`，两代都用 `@deepseek-ai/dsh-pwsh-local` / `@deepseek-ai/dsh-bash-local`。门面只按 `seam` 分派，不认识具体版本号。

## 客户端

`@dsh-plugin/dsh-loader/client` 提供 UI 控件与 facade helper。用 `inject: ['dshLoaderUi']` 等待 UI facade，就绪后读取 `ctx.dshLoaderUi` 或 `window.__dshLoader__.ui`。`window.__dshLoader__` 保留 require、services、别名、patch、可选旧 settings rpc，新增 config 客户端。

`connection.api` 在连接句柄可用时同步提供稳定对象，依赖插件可在激活时读取 `llm` 与 `settings`。远程接口尚未就绪时，首次请求等待最多 15 秒，超时返回 `transport` 错误；服务迟到后，后续请求可继续使用同一对象。桥接卸载会结束等待中的请求并删除自身安装的 API，保留其他插件替换的值。

`registerModuleAlias(from, to, ownerCtx?)` / `registerPackageAlias(from, to, ownerCtx?)` 返回 disposer；忽略返回值的旧代码继续运行。多次 installClient 共用别名表、工厂和包装器，每个安装实例有自己的 dispose。

`config` 客户端提供 `list/read/update/reset/subscribe/dispose`。表单使用 loader 自带客户端，不要求插件编写浏览器配置逻辑。客户端提交必须携带 expectedRevision，密码遮蔽值不能当明文使用。

会话扩展通过 `getSessionClient(ctx).registerMessageExtension({ id, Message, forkedTurnLabels? })` 注册。`forkedTurnLabels` 可提供本地化的 `label` 和 `duration` 标题，后者用于拼接官方用时。启用后，官方原因是 `forked` 的轮次改用这组标题，`turnProcess.hasContent` 为 `false` 时省略提示。有工具、思考或其他处理内容的轮次保留官方展开行为和完整日志；扩展注销后恢复官方标题。

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
