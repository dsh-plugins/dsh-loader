# dshloader 设计文档

## 0. 依据与参考

| 来源 | 位置 | 结论 | 状态 |
|------|------|------|------|
| 用户访谈 | 当前会话 | dshloader 应作为 bundle plugin 形态的运行时兼容中间层，插件统一使用 loader 暴露的稳定 API；"强制"在原始访谈中指"插件必须只面向稳定 API 编程"这一约定，不代表"加载顺序可被程序强制保证"——后者受限于 cordis 的 patch 机制，v1 只能做到推荐顺序 + 运行时自检告警（见 §1.2、§2.2、§6.2 的修订说明）。 | 已确认（已修订澄清） |
| dsh-upstream-fixes 项目 | `/Users/qdd/codex/workspace/dsh-upstream-fixes/README.md`、`lib/index.js`、`lib/client.js`、`cordis.patch.yml` | dsh 升级已造成 `httpServer` -> `webServer`、settings namespace whitelist、deep source import 等实际不兼容；这些修复可通过统一的适配器模式抽象。 | 已读 |
| betterdshlauncher 项目 | `/Users/qdd/codex/workspace/betterdshlauncher/README.md`、`src/dsh.mjs`、`src/dsh-version.mjs`、`package.json` | dsh profile、多版本管理、`--dump-config` 校验等约定；dshloader 与之独立但可互补。 | 已读 |
| dsh 插件机制（观察） | dsh-upstream-fixes `package.json` 中的 `dsh.bundle` / `dsh.client` 字段；cordis.patch.yml 的 `insert` 规则。 | bundle plugin 通过 `cordis.patch.yml` 插入 profile，client bundle 在 `immediately` tier 预加载，可注册模块工厂和 fetch 拦截器。 | 推断 |
| semver 规范 | npm semver 官方约定（模型知识） | 适配器 `supports` 字段应使用 npm semver 范围语法；dshloader 自身版本遵循 semver。 | 假设 |
| settings RPC 协议多版本差异（§5.4 示例） | 无实际来源，纯构造示例（`jsonrpc: '2.0'` vs `{ type: 'server-response', ... }`） | dsh 是否会在不同版本间切换 client-host RPC 的信封格式，目前**没有任何证据**；`dsh-upstream-fixes` 已验证的 RPC 拦截只涉及 namespace 白名单合并，不涉及信封格式转换。§5.4 仅作为"如果未来出现协议差异，适配器可以如此处理"的**设计模式示例**，不代表已发生或将发生的真实需求，不应作为 v1 必须实现的能力。**但需注意**：namespace 白名单合并本身在"写"方向（`settings.update/mutate/replace`）仍然需要按官方 RPC 信封（`{ type: 'server-response', rpcId, result }`）回显请求携带的 `rpcId` 才能被官方 client 正确解析——这不是"协议版本转换"，而是已验证场景（fix 5）里必须实现的一部分，v1 范围内必须覆盖，见 §3.3.1、§9.2 AC-CM-06 的修订说明。 | 假设（协议版本转换无证据）/ 已验证（rpcId 回显是真实需求的一部分） |
| cordis 服务注入的加载顺序语义 | dsh 自身仓库 `docs/cordis-tutorial/02-lifecycle-and-effects.md`、`03-services.md`（官方教程，随 deepseek-harness 发布） | cordis 是**响应式依赖注入**：声明 `inject: [...]` 的插件会停留在 `PENDING` 状态，直到被依赖的服务出现才会真正 `apply`；官方原文："Load order in `cordis.yml` does not matter — dependencies, not file order, decide when plugins start." 服务提供方注销/替换时，依赖它的插件会自动卸载并在服务恢复后自动重新加载。只有插件放弃 `inject` 改用一次性 `ctx.get()` 探测（cordis 称为 optional dependency，非响应式）时，才会对"provide 时机是否早于探测时机"敏感。§1.2/§2.2/§6.2 已按此证据修订：dshloader 是否排在 `insert` 列表首位，对使用官方 `inject` 惯例的插件（包括 `dsh-upstream-fixes` 自身，见其 `export const inject = ['webServer']`）**不影响**别名/服务能否最终生效；只对少数使用一次性 `ctx.get()` 探测的插件存在时序风险。 | 已验证（一手官方文档） |

## 1. 背景与范围

### 1.1 背景

DeepSeek Harness（dsh）采用 cordis 插件体系：一个 profile 是一组 npm 依赖（`package.json`）加一段层叠补丁（`cordis.patch.yml`），dsh 启动时按补丁顺序实例化各个 bundle plugin，并把它们暴露的函数/服务注入到 cordis 上下文中。插件为了扩展 dsh 功能，必须依赖 dsh 内部暴露的服务、模块或运行时报文格式。

dsh 目前处于快速迭代期，内部 API 和服务键名会变化。例如：

- `dsh-upstream-fixes` 已修复 `httpServer` 服务键被重命名为 `webServer` 的问题：旧插件注入 `httpServer` 会永远挂起，直到有一个兼容层把 `httpServer` 别名到 `webServer`。
- 某些插件直接 `require('@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts')`，一旦 dsh 发布版本不再包含 `src/`，模块表就会报 `missed the module table`。

当这类不兼容出现时，当前做法是为每个 profile 安装一个修复补丁包（如 `dsh-upstream-fixes`），或逐个修改插件源码。profile 数量多、插件数量多时，修复成本高，且容易遗漏。

### 1.2 范围

dshloader 是一个 **运行时兼容中间层**，目标是把插件与真实 dsh 版本之间的直接依赖解耦：

- 插件只面向 dshloader 提供的**稳定 API 集合**编程。
- dshloader 的服务别名/模块重定向依赖 cordis 的**响应式依赖注入**语义生效，而不是依赖它在 `cordis.patch.yml` 的 `insert` 列表中的位次。dsh 自身文档（`docs/cordis-tutorial/03-services.md`）明确："Load order in `cordis.yml` does not matter — dependencies, not file order, decide when plugins start."：只要消费方插件按官方惯例声明 `inject: [...]`，它就会停留在 `PENDING` 直到 dshloader（或任何提供方）把对应服务 provide 出来，与 dshloader 在列表中排第几无关。因此 v1 **不**把"排在 insert 首位"作为安装要求，只在文档中提示；真正需要关注的是**服务别名/模块别名是否成功 provide**，这一点由 §6.3 的安装校验和运行时自检（检查 `ctx.dshLoader` 是否存在、别名是否已注册，见 TC-LOAD-01/TC-LOAD-02 的修订版）覆盖。
  - 唯一的例外场景：极少数插件不使用 `inject`，而是在 `apply` 内部做**一次性** `ctx.get('httpServer')` 探测（cordis 称为 optional dependency，非响应式，探测失败后不会自动重试）。这类插件确实可能因为 dshloader 的 `apply` 尚未执行、别名还未 provide 而探测落空。v1 对此不做强制排序保证，只在文档中提示"若插件使用一次性 `ctx.get()` 探测而非 `inject`，请尽量让 dshloader 更早加载"，属于降低概率的建议，不是可验证的强约束。
- dshloader 内部感知当前真实 dsh 的版本/行为，把插件对稳定 API 的调用翻译为当前 dsh 能理解的调用。
- 当 dsh 升级导致不兼容时，用户只需升级 dshloader（一个包），无需逐个修改插件。

**明确在本项目范围内**：

1. cordis bundle plugin 形态的运行时兼容层。
2. 向插件暴露统一的、版本无关的 host 服务与 client 服务。
3. 对真实 dsh 内部服务名、模块路径、RPC 接口的适配/桥接。
4. 提供一次性的 profile 注入脚本/命令，把 dshloader 加入 `cordis.patch.yml` 的 `insert` 列表；v1 仅保证"注入 + 校验 `ctx.dshLoader` 与关键别名是否成功 provide"（见 §6.2/§6.3），**不**把"排在 insert 列表首位"作为安装目标或强制排序对象——依据 §0 依据表关于 cordis 响应式注入的说明，位次本身对绝大多数消费者（使用 `inject` 惯例的插件）不影响最终结果。

**明确不在范围内**：

1. 多版本 dsh 的安装、切换、锁定（属于 `betterdshlauncher` 的 concern）。
2. 构建期依赖管理或 npm registry 代理。
3. 插件 UI 样式/视觉层面的补丁。
4. 修改 dsh 官方源码或官方插件源码。

### 1.3 目标用户

- 第三方 dsh 插件作者：只需要学习 dshloader 的稳定 API，无需跟踪 dsh 每个版本的内部变化。
- dsh 整合包维护者：升级 dsh 后只需要升级 `dshloader` 这一个依赖，并运行校验。
- 终端用户：无感知；在 profile 初始化/导入时由工具自动注入 loader。

## 2. 术语与架构

### 2.1 核心术语

| 术语 | 定义 |
|------|------|
| **profile** | dsh 的整合包目录，通常位于 `~/.dsh/profiles/<name>`，包含 `package.json`、`cordis.patch.yml` 及 `node_modules`。 |
| **bundle plugin** | 一个声明了 `dsh.bundle` 字段的 npm 包，被 cordis 加载后可以在 host 层注册服务、路由、生命周期钩子。 |
| **client plugin** | 一个声明了 `dsh.client` 字段的 npm 包，其 client bundle 会被浏览器端加载，可注册模块工厂、DOM 补丁、fetch 桥等。 |
| **cordis.patch.yml** | profile 的层叠补丁文件，按 `insert` / `remove` / `replace` 等规则决定哪些 bundle plugin 参与启动顺序。 |
| **稳定 API（Stable API）** | dshloader 向插件承诺的接口集合。插件只应调用稳定 API，不应直接依赖 dsh 内部服务名或模块路径。 |
| **适配器（Adapter）** | dshloader 内部根据当前真实 dsh 版本选择的具体实现，用于把稳定 API 映射到真实 dsh 的当前形态。 |
| **host 层** | dsh Node.js 进程侧，cordis 上下文在 host 层运行。 |
| **client 层** | 浏览器/Web UI 侧，由 dsh 的 client-modules 系统加载。 |

### 2.2 部署结构

```
┌─────────────────────────────────────────────────────────────┐
│                       profile (web / xxx)                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ cordis.patch.yml                                      │  │
│  │   - insert:                                           │  │
│  │       - id: dsh-loader           ← 位次不影响生效      │  │
│  │         name: '@dsh-plugin/dsh-loader'               │  │
│  │       - id: plugin-a                                  │  │
│  │       - id: plugin-b                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ package.json                                          │  │
│  │   dependencies:                                         │  │
│  │     @dsh-plugin/dsh-loader: '^1.0.0'                  │  │
│  │     plugin-a: '^x.x.x'                                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              dshloader bundle (host + client)                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ 版本探测     │  │ 适配器注册表 │  │ 稳定 API 服务    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ 真实 dsh vN     │ │ 真实 dsh vN+1   │ │ 真实 dsh vN+2   │
│ (服务名/路径 X) │ │ (服务名/路径 Y) │ │ (服务名/路径 Z) │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

**关键澄清（依据见 §0 依据表"cordis 服务注入的加载顺序语义"）**：dshloader 在 `cordis.patch.yml` 的 `insert` 列表中的位次**不决定**服务别名/模块重定向能否生效。cordis 是响应式依赖注入：消费方插件只要按官方惯例声明 `inject: [...]`，就会停留在 `PENDING` 直到 dshloader 把对应服务 `provide` 出来，随后自动转为 `ACTIVE`，与谁先谁后无关；`dsh-upstream-fixes` 自身也是这么写的（`export const inject = ['webServer']`）。因此 dshloader **不**建议用户手动调整 `insert` 顺序作为兼容性手段，安装文档只需引导用户确认 `ctx.dshLoader` 与关键别名已经成功 provide（见 §6.3）。唯一的例外是极少数插件用一次性 `ctx.get()`（非 `inject`）探测服务，这类插件确实可能因为 dshloader 的 `apply` 还没跑完而探测落空；对此 v1 只在文档中提示，不作为架构约束或自动化校验目标。

### 2.3 运行时交互

#### host 层调用路径

```
┌────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│  plugin-a  │────▶│ ctx.dshLoader.api   │────▶│ dshloader Adapter   │
│ (旧代码)   │     │   .settings.write() │     │   .settingsWrite()    │
└────────────┘     └─────────────────────┘     └──────────┬──────────┘
                                                          │
                              ┌───────────────────────────┼───────────────────────────┐
                              ▼                           ▼                           ▼
                       ┌─────────────┐            ┌─────────────┐            ┌─────────────┐
                       │ dsh vN      │            │ dsh vN+1    │            │ dsh vN+2    │
                       │ settings    │            │ settings    │            │ configSvc   │
                       └─────────────┘            └─────────────┘            └─────────────┘
```

#### client 层调用路径

```
┌────────────────────┐     ┌────────────────────────────┐     ┌──────────────────────────┐
│ plugin-a client      │────▶│ window.__dshLoader__       │────▶│ dshloader client adapter │
│ bundle (旧模块路径)  │     │   .require('runtime/client')│     │   模块重定向/服务代理      │
└────────────────────┘     └────────────────────────────┘     └─────────────┬────────────┘
                                                                            │
                                                                            ▼
                                                                   ┌────────────────┐
                                                                   │ 真实 dsh client │
                                                                   │ 当前版本入口    │
                                                                   └────────────────┘
```

### 2.4 与周边项目的关系

- **dshloader**（本项目）：运行时兼容中间层，独立平行项目，不依赖 `betterdshlauncher` 或 `dsh-upstream-fixes`。
- **betterdshlauncher**：负责 dsh 多版本安装/切换/锁定。若两者共存，betterdshlauncher 负责选版本，dshloader 负责在该版本下让旧插件继续工作。
- **dsh-upstream-fixes**：已存在的具体修复集合。若某些修复被 dshloader 吸收，则 `dsh-upstream-fixes` 可逐步退役；在过渡期内，dshloader 的适配器可以显式检查 `dsh-upstream-fixes` 是否存在，避免冲突。

## 3. 核心设计

### 3.1 适配器注册表（Adapter Registry）

dshloader 在 host 和 client 两侧各维护一张**适配器注册表**。真实 dsh 版本确定后，loader 按版本匹配最优适配器；若找不到精确版本，则回退到最近的低版本适配器（向后兼容策略），并打印一条 warning。

```
AdapterRegistry
├── adapters: Adapter[]
├── select(version): Adapter | fallback
└── register(range, factory)
```

**版本匹配规则**：

1. 精确匹配：适配器声明 `supports: '1.2.3'`，且真实版本为 `1.2.3`。
2. 范围匹配：适配器声明 `supports: '>=1.0.0 <2.0.0'`，且真实版本落在范围内；若多个适配器的范围都覆盖真实版本，选择 `supports` 范围**更精确/更窄**的一个，范围精确度相同则后注册者优先（见 TC-BND-REG-03）。
3. 最近低版本回退：没有精确/范围命中，但存在版本号 ≤ 真实版本的适配器时，选择其中版本最接近的一个，并标记 `mode: 'fallback'`，同时打印 warning。
4. **真实版本低于所有已注册适配器**：注册表非空，但不存在任何 `supports` 上界 ≤ 真实版本、也不存在覆盖真实版本的适配器（即真实 dsh 版本比 dshloader 目前支持的最低版本还旧）。此时同样抛出 `UnsupportedDshVersionError`，但错误信息必须与规则 5 区分，明确提示"当前 dsh 版本过旧，dshloader 最低支持 `<最低 supports 下界>`，请升级 dsh 或使用更旧的 dshloader 版本"，避免和"版本过新、无人支持"的场景混淆。
5. 完全未知：注册表为空，或真实版本既不满足规则 1-3 也不满足规则 4（即真实版本比所有已注册适配器都新）时，抛出 `UnsupportedDshVersionError`，启动失败并提示升级 dshloader。

**适配器接口（host）**：

```ts
interface HostAdapter {
  version: string;          // 适配器自身适用的 dsh 版本范围
  settings?: {
    describe(redact?: boolean): NamespaceView[];
    update(ns, section, expectedRevision): Promise<SettingsResult>;
    replace(ns, section, expectedRevision): Promise<SettingsResult>;
    mutate(ns, ops, expectedRevision): Promise<SettingsResult>;
  };
  webServer?: {
    register(route): Dispose;
    // 可继续扩展：getRouter、use 等
  };
  serviceAliases?: Record<string, string>; // e.g. { httpServer: 'webServer' }
}
```

**适配器接口（client）**：

```ts
interface ClientAdapter {
  version: string;
  moduleAliases?: Record<string, string>; // 旧模块路径 -> 新模块路径
  serviceFactory?: (require) => object;   // 若插件直接 require dshloader
}
```

### 3.2 版本探测

dshloader 需要在 bundle 初始化阶段尽快知道当前真实 dsh 的版本，以便选择适配器。dshloader 本身就运行在目标 dsh 进程内部（作为 bundle plugin 被同一个进程加载），因此探测应当优先用**同进程内的静态读取**，避免不必要的子进程/IPC 开销。探测来源按优先级：

1. **包元数据（当前唯一可用的默认路径）**：读取 profile `node_modules/@deepseek-ai/dsh/package.json` 的 `version` 字段。这是启动开销最小、无外部依赖的方式，v1 作为默认探测手段。
2. **环境变量**：`DSHLOADER_DSH_VERSION` 用于测试或强制指定，优先级高于包元数据（便于 mock/CI 覆盖）。
3. **运行时环境（预留，当前不可用）**：cordis 上下文上的 `ctx.runtime?.version` 或 dsh 未来可能暴露的 `version` 服务。**当前 dsh 版本未提供该能力**，此项仅作为未来扩展点登记，不在 v1 的探测逻辑中实际调用；一旦 dsh 提供该服务，其优先级应高于包元数据。

**明确不采用的方案**：不通过 `child_process` 调用 `dsh --version` 做版本探测。理由：dshloader 运行时已经身处目标 dsh 进程内部，fork 子进程重新调用同一个 CLI 既不必要（版本信息已能从 (1) 获取），又会引入额外的启动时延（与 §8.1 R-04 的缓解目标矛盾）、潜在的重入/目录锁竞争风险。若未来确有需要 CLI 探测的场景（例如独立于 dsh 进程运行的诊断工具，见 AC-OB-03），应放在 `dshloader doctor` 这类独立命令里，不属于 host bundle `apply()` 的探测路径。

探测结果缓存于进程内存；client 侧通过 host 注入的全局变量 `window.__DSHLOADER_VERSION__` 同步获得版本号，避免重复探测。

### 3.3 稳定 API（Stable API）

稳定 API 是 dshloader 向插件作者承诺的长期接口。v1 版本至少覆盖以下三类能力：

#### 3.3.1 Settings API

Settings API 承担两类不同性质的问题，必须分开设计，不能混为"命名差异"：

1. **命名/形态差异**：屏蔽官方 `settings` 服务与 `configSvc` 等历史命名、参数结构差异（见 §5.2 行为代理）。
2. **访问范围差异（安全相关）**：官方 `dsh-host-apiproxy` 对浏览器可读写的 namespace 使用硬编码白名单（`WEB_SETTINGS_NAMESPACES`），插件注册的 namespace 若不在名单内，浏览器端会收到 `settings-not-exposed`，导致插件自己的设置面板无法显示（已在 `dsh-upstream-fixes` 验证，见 §0 依据表）。dshloader 若要收编这个修复，等价于**移除官方对浏览器可写 namespace 的 default-deny 边界**，是一次安全姿态变更，不是单纯的兼容性桥接。

```ts
ctx.dshLoader.settings.describe(options?: { redactSecrets?: boolean }): NamespaceView[]
ctx.dshLoader.settings.update(ns, section, expectedRevision): SettingsResult
ctx.dshLoader.settings.replace(ns, section, expectedRevision): SettingsResult
ctx.dshLoader.settings.mutate(ns, ops, expectedRevision): SettingsResult
```

返回数据结构保持与官方 `settings.describe` 一致，使插件 UI 可以无缝对接。

**关于白名单绕过的显式开关**：dshloader 默认**不**绕过官方白名单（即默认仅代理白名单允许的 namespace，行为与官方一致）。只有当 profile 显式开启 `dshLoader.settings.exposeAllNamespaces: true`（`package.json` 的 `dsh.profile` 配置或环境变量 `DSHLOADER_EXPOSE_ALL_SETTINGS=1`）时，dshloader 才会像 `dsh-upstream-fixes` fix 5 那样提供"全量 describe + 全量写入"的桥接。默认关闭是为了让用户知情选择是否接受这个安全权衡，而不是随 dshloader 的安装被动继承。相关风险见 §8.1 R-07，验收标准见 §9.2 AC-CM-06 / §9.3 AC-SEC-01。

**两条独立的实现路径，缺一不可**：要在 `exposeAllNamespaces` 开启时完整复现 fix 5 的效果，dshloader 需要同时实现两层桥接，二者职责不同、不能互相替代：

1. **host 侧 `ctx.dshLoader.settings.*`**：供插件代码在 host 层直接调用，返回结构化的 `SettingsResult`/`NamespaceView`，不涉及浏览器 RPC 信封。
2. **client 侧 fetch 拦截器**：真实的官方 Web UI 是通过 `POST /api/settings.describe|update|mutate|replace` 这套 RPC 与 host 通信的，请求体带 `rpcId`，官方响应信封固定为 `{ type: 'server-response', rpcId, result }`（已在 `dsh-upstream-fixes/lib/client.js` 验证，非 §5.4 讨论的"协议版本转换"）。dshloader 的 client 拦截器在把白名单外 namespace 的写请求转发给 host 侧桥接路由后，**必须把请求体中的 `rpcId` 原样回显**到重建的响应信封中，否则官方 client 无法把响应和请求对应起来，写操作在 UI 上会表现为超时/无响应。这一条是 fix 5 真实行为的一部分，不是假设，v1 必须实现并测试（见 test-plan.md TC-CLI-RPC-01c）。

`§4.3` 的 `DshLoaderClientAPI.rpc.settings.*` 是给插件代码直接调用的**独立稳定接口**（不经过官方 RPC 信封，也不需要 rpcId），与上面第 2 点"拦截官方面板自身发出的 fetch 请求"是两条不同的调用路径，实现时不应混淆或只实现其中一条就认为覆盖了 fix 5。

#### 3.3.2 Web Server API

提供与 Express/Koa 风格兼容的注册接口，避免插件直接依赖 `webServer` / `httpServer` 的具体实现。

```ts
ctx.dshLoader.web.register(prefix: string, handler: (req, res) => void): () => void
ctx.dshLoader.web.get(path, handler)
ctx.dshLoader.web.post(path, handler)
ctx.dshLoader.web.use(middleware)
```

内部根据当前适配器决定：

- 当前 dsh 使用 `ctx.webServer.register({ kind: 'prefix', path, handler })`（如 dsh-upstream-fixes 所示）。
- 历史 dsh 使用 `ctx.httpServer.use(path, handler)`。
- 未来 dsh 若提供新的路由注册方式，由新适配器实现。

#### 3.3.3 Module API（client 侧）

在 client bundle 中提供统一的模块解析入口：

```js
const { contextProvenance } = window.__dshLoader__.require('dsh/runtime/context-provenance')
```

`window.__dshLoader__.require` 内部根据适配器把稳定模块名映射到真实 dsh 当前版本的 client 入口，避免插件硬编码 `@deepseek-ai/dsh-client-runtime/src/...`。

### 3.4 服务别名与代理

对于只改了服务键名、行为保持一致的 dsh 升级，适配器采用**服务别名**机制：

```js
// 在 dsh vN+1 适配器中
if (ctx.get('httpServer') === undefined && ctx.webServer !== undefined) {
  ctx.reflect.provide('httpServer', ctx.webServer)
}
```

对于服务行为变化（参数、返回值结构不同），适配器提供**代理包装**：插件调用 `ctx.dshLoader.settings.update`，代理内部把参数转换为当前 dsh 需要的形态，再把结果转换回稳定结构。

**别名生效与加载顺序的关系**：`ctx.reflect.provide('httpServer', ...)` 注册的是一个响应式服务，而不是一次性赋值。按照 cordis 官方语义（见 §0 依据表），任何声明了 `inject: ['httpServer']` 的下游插件在别名注册之前都停留在 `PENDING`，别名一旦 provide 就会自动转为 `ACTIVE`——这与 dshloader 的 bundle 在 `cordis.patch.yml` 的 `insert` 列表中排在下游插件之前还是之后**无关**。这也是本设计不再要求"dshloader 必须排在 insert 首位"的技术依据。

### 3.5 Client 层模块重定向

client bundle 在 `immediately` 层级注册模块工厂，拦截已知的不稳定模块标识符：

```js
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts',
  factory: (require) => ({
    contextProvenance: require('@deepseek-ai/dsh-client-runtime/client').contextProvenance,
  }),
})
```

dshloader 的 client adapter 在启动时读取 `moduleAliases` 表，批量注册此类工厂。插件代码若仍使用旧路径，会被安全重定向到当前版本的公共入口。

### 3.6 注入与升级

dshloader 提供 CLI 命令和程序化 API，把自身写入目标 profile：

- 把 `@dsh-plugin/dsh-loader` 加入 `package.json` 的 `dependencies`（若不存在）。
- 在 `cordis.patch.yml` 的 `insert` 列表最前面插入 dshloader patch。
- 不修改其他插件顺序，不覆盖用户自定义的 `disabled` 配置。

升级 dshloader 时只需执行 `pnpm update @dsh-plugin/dsh-loader`；dsh 升级后，由新版 dshloader 的适配器承担新兼容逻辑，插件无需改动。

## 4. 接口定义

### 4.1 插件可调用 API（host）

插件在 cordis 上下文中通过 `ctx.dshLoader` 访问稳定 API。

```ts
interface DshLoaderHostAPI {
  readonly version: string;       // dshloader 自身版本
  readonly dshVersion: string;    // 探测到的真实 dsh 版本
  readonly adapterVersion: string; // 当前选中的适配器版本范围

  settings: {
    /** 默认只代理官方白名单内的 namespace；exposeAllNamespaces 开启后才代理全部（见 §3.3.1）。 */
    readonly exposeAllNamespaces: boolean;
    describe(options?: { redactSecrets?: boolean }): NamespaceView[] | Promise<NamespaceView[]>;
    update(ns: string, section: object, expectedRevision?: number): Promise<SettingsResult>;
    replace(ns: string, section: object, expectedRevision?: number): Promise<SettingsResult>;
    mutate(ns: string, ops: SettingsOp[], expectedRevision?: number): Promise<SettingsResult>;
  };

  web: {
    register(prefix: string, handler: RequestHandler): Dispose;
    get(path: string, handler: RequestHandler): Dispose;
    post(path: string, handler: RequestHandler): Dispose;
    use(middleware: RequestHandler): Dispose;
  };

  services: {
    get<T = unknown>(name: string): T | undefined;
    alias(from: string, to: string): void;
  };
}
```

### 4.2 数据结构

```ts
interface NamespaceView {
  ns: string;
  schema: object;
  value: object;
  base?: object;
  user?: object;
  applies: object;
  secrets: Array<{ path: string[]; set: boolean }>;
  revision: number;
}

interface SettingsResult {
  ok: boolean;
  code?: 'settings-conflict' | 'settings-rejected' | 'internal';
  message?: string;
  value?: NamespaceView;
  details?: object;
}

interface SettingsOp {
  op: 'set' | 'delete' | 'merge' | string;
  path: string[];
  value?: unknown;
}

type RequestHandler = (req: IncomingMessageLike, res: ServerResponseLike) => void | Promise<void>;
type Dispose = () => void;
```

### 4.3 client 侧 API

```ts
interface DshLoaderClientAPI {
  readonly version: string;
  readonly dshVersion: string;
  readonly adapterVersion: string;

  /** 按稳定模块名解析真实 dsh 当前版本的公开模块 */
  require(specifier: string): any;

  /** 注册 client 模块别名 */
  registerModuleAlias(alias: string, target: string): void;

  /** 插件可直接调用 loader 暴露的 rpc/settings 等 client 封装 */
  rpc?: {
    settings?: {
      describe(): Promise<{ namespaces: NamespaceView[] }>;
      update(ns: string, section: object): Promise<SettingsResult>;
      replace(ns: string, section: object): Promise<SettingsResult>;
      mutate(ns: string, ops: SettingsOp[]): Promise<SettingsResult>;
    };
  };
}
```

client bundle 启动时把自身挂载到 `window.__dshLoader__`，并提供给插件使用。插件应优先使用 `window.__dshLoader__.require('dsh/settings')` 而非直接 import dsh 内部模块。

### 4.4 适配器实现接口（host）

```ts
interface HostAdapterFactory {
  /** 该适配器支持的 dsh 版本范围，例如 '^1.2.0' 或 '>=1.0.0 <2.0.0' */
  readonly supports: string;

  /** 适配器名称，用于日志和调试 */
  readonly name: string;

  /**
   * 创建适配器实例。
   * @param ctx cordis 上下文
   * @param api DshLoaderHostAPI 的半成品（不含当前适配器负责的能力）
   */
  create(ctx: CordisContext, api: DshLoaderHostAPIBase): HostAdapter;
}

interface HostAdapter {
  /** 初始化：注册服务别名、探测真实 dsh 服务等 */
  apply(): void | Promise<void>;

  /** 释放：注销本适配器自行管理、且未通过 cordis effect API 注册的资源（见下方说明） */
  dispose(): void | Promise<void>;

  settings?: DshLoaderHostAPI['settings'];
  web?: DshLoaderHostAPI['web'];
  services?: DshLoaderHostAPI['services'];
}
```

**关于 `apply`/`dispose` 与 cordis 生命周期的关系**：cordis 官方文档（`docs/cordis-tutorial/02-lifecycle-and-effects.md`）指出，通过 `ctx.reflect.provide()`、`ctx.effect()`、`ctx.on()` 等 API 注册的资源本身就是 **effect**，会随 dshloader 这个 bundle 的 fiber 卸载而自动回收，不需要使用者手动清理。因此：

- `HostAdapter.apply()` 内部若只调用 `ctx.reflect.provide` / `ctx.effect` / `ctx.on` 等官方 API（v1 的服务别名、web 路由注册均属于这类），**不需要**再实现对应的 `dispose()` 逻辑——cordis 会在 dshloader 整个 bundle 卸载时自动回收。
- `dispose()` 仅在适配器持有 cordis 不感知的资源（例如定时器、外部连接、跨适配器共享的缓存）时才需要实现；这种情况在 v1 覆盖的能力范围内**尚未出现**，`dispose()` 目前是为未来扩展预留的空子。
- `dispose()` 的调用方是 dshloader 内部的 `AdapterRegistry`，仅在**适配器热替换**场景下触发（例如诊断/测试工具在不重启进程的前提下切换适配器）；正常生产环境中 dsh 版本变化必然伴随进程重启，此时依赖 cordis 原生 effect 回收即可，不会调用到这条路径。v1 的单元测试应验证"仅调用 `ctx.reflect.provide`/`ctx.effect` 的适配器可以不实现 `dispose()`"，而不是强制所有适配器都要有自定义清理逻辑。

### 4.5 适配器实现接口（client）

```ts
interface ClientAdapterFactory {
  readonly supports: string;
  readonly name: string;
  create(api: DshLoaderClientAPIBase): ClientAdapter;
}

interface ClientAdapter {
  apply(): void;
  dispose(): void;

  /** 稳定模块名 -> 真实模块路径的映射表 */
  moduleAliases?: Record<string, string>;

  /** 需要额外暴露给插件的 client 服务 */
  services?: Record<string, any>;
}
```

### 4.6 版本约定

- dshloader 自身版本遵循 semver。
- 适配器 `supports` 字段使用 npm semver 范围语法。
- 稳定 API 的 major 版本与 dshloader 的 major 版本对齐；minor 新增能力，patch 修复 bug。
- 插件在 `package.json` 中可声明 `peerDependency`：`@dsh-plugin/dsh-loader: '^1.0.0'`，但运行时仍通过 cordis 上下文访问，不强制 npm 依赖。

## 5. 兼容适配策略

### 5.1 服务键名适配（Service Alias）

当 dsh 升级把某个内部服务的键名从 `A` 改为 `B`，旧插件仍注入 `A` 会导致挂起。dshloader 的适配器在初始化时检查旧键是否存在；若不存在而新键存在，则把旧键别名到新键实例。

**示例**（dsh-upstream-fixes 已验证的场景）：

```js
// adapter-for-dsh-1-x.ts
export function apply(ctx) {
  if (ctx.get('httpServer') === undefined && ctx.webServer !== undefined) {
    ctx.reflect.provide('httpServer', ctx.webServer);
    console.log('[dshloader] aliased httpServer -> webServer');
  }
}
```

**规则**：

1. 只在旧键缺失且新键存在时注册别名，避免覆盖官方真实服务。
2. 别名使用 `ctx.reflect.provide`，保持 cordis 反射语义，便于后续 `ctx.get` 命中。
3. **【P2 / 预留，v1 不实现】** 链式别名（A -> B -> C）：当前所有已验证的真实案例（`httpServer -> webServer`）都只有一跳，v1 只实现单跳别名。链式别名涉及循环检测、深度限制、多跳失败时的回退策略，目前没有真实场景驱动其设计，暂不纳入正式规则，避免未经验证的复杂度进入 v1。若后续出现真实的多跳改名案例，再补充具体算法、AC 与测试用例后单独立项实现。

### 5.2 行为代理（Behavior Proxy）

当服务键名未变、但参数结构或返回值结构变化时，需要代理包装。

**示例**：假设 dsh v2 的 `settings.update` 要求参数为 `{ section, expectedRevision }`，而 dsh v3 改为 `{ ns, ops, expectedRevision }`。

```js
export const settings = {
  async update(ns, section, expectedRevision) {
    const settings = ctx.get('settings');
    if (!settings) throw new Error('settings service unavailable');
    if (semver.satisfies(dshVersion, '^3.0.0')) {
      return settings.update(ns, { op: 'set', path: [], value: section }, expectedRevision);
    }
    // v2 and earlier
    return settings.update(ns, section, expectedRevision);
  }
}
```

**原则**：

- 稳定 API 的参数/返回值结构一旦发布不得破坏；内部转换由适配器承担。
- 代理内部必须捕获异常并转换为 `SettingsResult` 的错误结构，保持插件侧错误处理一致。
- 尽量使用 duck-typing 而非精确版本号判断，减少 future-proof 成本。

### 5.3 模块路径适配（Module Path Adapter）

插件 client bundle 或 host 代码中可能硬编码 dsh 内部源码路径。真实 dsh 升级后，这些路径可能失效。dshloader 在两侧分别提供模块别名：

#### host 侧

通过 Node.js 的 `module` 替换风险较高，建议仅对插件内部的 `require` 进行拦截。更安全的做法是在 dshloader 内部导出一个 `compatRequire`，并在稳定 API 中提供：

```js
ctx.dshLoader.modules.require('@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts')
```

内部映射到：

```js
require('@deepseek-ai/dsh-client-runtime/client').contextProvenance
```

#### client 侧

在 `immediately` tier 注册 `__ModuleLoader__` 工厂：

```js
window.__ModuleLoader__.load({
  id: '@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts',
  factory: (require) => ({
    contextProvenance: require('@deepseek-ai/dsh-client-runtime/client').contextProvenance,
  }),
});
```

**映射表来源**：当前适配器的 `moduleAliases`。

### 5.4 RPC / 协议适配（设计模式预留，非 v1 必须能力）

> **依据状态**：本节场景在 §0 依据表中标注为"假设（无证据，纯示例）"。目前唯一已验证的 client fetch 拦截需求是 §3.3.1 描述的 settings namespace 白名单合并，**不涉及**信封/协议格式转换。以下内容作为适配器可扩展的设计模式登记，v1 不要求实现，也不纳入 §9 验收标准；若未来出现真实的协议版本差异，再补充对应 AC 和测试用例。

dsh 的 client-host 通信可能通过内部 RPC（如 `/api/settings.*`）或事件总线。若消息类型、字段名、channel 名变化，dshloader client 侧的 fetch 拦截器可以承担转换职责。

**假设性示例**（非真实案例，仅演示模式）：假设 dsh v2 的 settings describe RPC 返回 `{ type: 'server-response', rpcId, result }`，而 v3 返回 `{ jsonrpc: '2.0', id, result }`。

```js
window.fetch = async function (input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
  if (url.pathname === '/api/settings.describe') {
    const res = await originalFetch(input, init);
    const body = await res.json();
    // 统一转换为稳定形状
    return new Response(JSON.stringify({
      type: 'server-response',
      rpcId: body.rpcId ?? body.id,
      result: body.result ?? body
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
};
```

**原则**：

- client 侧拦截器只负责协议格式转换，不修改业务语义。
- host 侧适配器负责把稳定语义转换为当前 dsh 可接受的调用。
- 优先复用官方接口；只有官方接口变化时才启用转换路径。

### 5.5 适配器新增流程

当发现新的 dsh 版本破坏某稳定 API 时：

1. 在 dshloader 仓库新增一个适配器文件（如 `src/adapters/dsh-3-0-x.mjs`）。
2. 在注册表中声明 `supports: '>=3.0.0 <3.1.0'`。
3. 编写对应的单元测试和集成测试。
4. 发布 dshloader 新版本。
5. 用户/CI 在 profile 中 `pnpm update @dsh-plugin/dsh-loader` 并重启 dsh web。

插件代码无需改动。

## 6. 安装与部署

### 6.1 作为 dsh 插件部署

dshloader 本身是一个标准的 dsh bundle plugin，因此最简部署方式就是使用 dsh 自带的插件管理命令：

```bash
# 从本地路径安装（开发期）
dsh plugin --profile web add /path/to/dshloader

# 从 git 仓库安装
dsh plugin --profile web add https://github.com/dsh-external/dshloader.git

# 从 npm 安装（发布后）
dsh plugin --profile web add @dsh-plugin/dsh-loader@^1.0.0
```

执行后，dsh 会自动：

1. 把包加入 `~/.dsh/profiles/web/package.json` 的 `dependencies`。
2. 把 bundle patch 加入 `cordis.patch.yml`。

### 6.2 关于加载顺序（不需要手动调整）

`cordis.patch.yml` 中 `insert` 列表只决定 bundle 被加载的先后顺序，**不决定**服务是否/何时能被下游插件用上。依据 §0 依据表引用的官方 cordis 文档，cordis 的服务消费是响应式的：下游插件只要按惯例声明 `inject: [...]`，就会在依赖服务出现之前停留在 `PENDING`，一旦 dshloader 把别名 `provide` 出来即自动激活，与 dshloader 在 `insert` 列表中排第几**无关**。

因此 v1 **不要求、也不建议**用户手动编辑 `~/.dsh/profiles/web/cordis.patch.yml` 去调整 dshloader 的位置；`dsh plugin ... add` 默认把新条目追加在 `insert` 列表末尾即可，无需额外脚本或安装后步骤。

**唯一需要用户注意的例外**：如果某个插件是用一次性 `ctx.get()`（而非 `inject`）探测服务，理论上存在极小概率的时序窗口。这种插件在 dsh 生态中并非推荐写法（官方教程称之为 optional dependency），v1 不为其设计自动化排序或校验机制；如遇到具体案例，建议先推动该插件改用 `inject`，而不是反过来要求所有用户手动维护 `insert` 顺序。

### 6.3 验证安装

安装后，使用 dsh 的 dump-config 命令校验 profile 是否能正常启动：

```bash
dsh --profile web --dump-config
```

如果 dshloader 成功加载，dsh 启动日志中应出现类似：

```
[dshloader] loaded adapter for dsh x.y.z
[dshloader] registered stable API: settings, web, services
```

### 6.4 升级

当 dsh 升级导致不兼容时，只需要升级 dshloader：

```bash
cd ~/.dsh/profiles/web
pnpm update @dsh-plugin/dsh-loader
```

然后重启 dsh web。

### 6.5 移除

```bash
dsh plugin --profile web rm @dsh-plugin/dsh-loader
```

移除后，依赖 dshloader 稳定 API 的插件会报错，需要在移除前确认这些插件已迁移到原生 dsh API 或有其它兼容方案。

## 7. 实施步骤

### 7.1 里程碑

| 里程碑 | 目标 | 产出 |
|--------|------|------|
| M1 | 项目骨架 | `package.json`、目录结构、基础 CI、测试框架 |
| M2 | host 适配器注册表 | 版本探测、`AdapterRegistry`、第一个回退策略 |
| M3 | host 稳定 API | `ctx.dshLoader.settings` / `ctx.dshLoader.web` / `ctx.dshLoader.services` 最小实现 |
| M4 | dsh 1.x 适配器 | 实现 `httpServer -> webServer` 别名和 settings 桥接 |
| M5 | client 模块重定向 | `immediately` client bundle、模块别名注册 |
| M6 | 安装/验证命令 | `dshloader setup <profile>` 脚本、日志输出、dump-config 校验 |
| M7 | 文档与测试 | 开发文档、测试文档、README、示例插件 |
| M8 | 发布 | 发布到 npm/GitHub，提供 tag 与 changelog |

### 7.2 建议目录结构

```
dshloader/
├── package.json
├── README.md
├── cordis.patch.yml
├── docs/
│   ├── design.md          # 本文档
│   └── test-plan.md       # 测试文档
├── src/
│   ├── index.js           # host bundle 入口：export name / inject / apply
│   ├── client.js          # client bundle 入口（immediately）
│   ├── api.js             # DshLoaderHostAPI 实现
│   ├── registry.js        # AdapterRegistry + 版本探测
│   ├── services/
│   │   ├── settings.js    # settings 稳定 API 实现
│   │   └── web.js         # web 稳定 API 实现
│   ├── adapters/
│   │   ├── dsh-1-x.js     # 适配 dsh 1.x 系列
│   │   └── index.js       # 注册所有适配器
│   └── setup.mjs          # 一次性 profile 注入脚本（可选）
├── tests/
│   ├── adapter.test.mjs
│   ├── registry.test.mjs
│   ├── settings.test.mjs
│   └── integration.test.mjs
└── examples/
    └── sample-plugin/     # 演示插件如何使用稳定 API
```

### 7.3 关键模块职责

| 模块 | 职责 |
|------|------|
| `src/index.js` | cordis bundle 入口；导出 `name`、`inject`、`apply`；在 `apply` 中初始化适配器并注册 `ctx.dshLoader`。 |
| `src/api.js` | 构造 `ctx.dshLoader` 对象，把 `settings`、`web`、`services` 等稳定 API 暴露给其它插件。 |
| `src/registry.js` | 探测真实 dsh 版本，维护 `AdapterRegistry`，选择最合适的适配器。 |
| `src/adapters/*.js` | 每个适配器实现一个 dsh 版本范围的兼容逻辑；必须导出 `supports`、`name`、`create`。 |
| `src/client.js` | 在浏览器端立即执行，挂载 `window.__dshLoader__`，注册模块别名和 fetch 拦截器。 |
| `cordis.patch.yml` | bundle patch 定义，使 dshloader 作为 bundle plugin 被加载。 |

### 7.4 首个适配器的最小实现建议

第一个适配器建议直接吸收 `dsh-upstream-fixes` 中已被验证的修复，作为 dsh 1.x 适配器：

- host 侧：把 `httpServer` 别名到 `webServer`（若后者存在）。
- host 侧：settings 读写默认与官方白名单行为一致；仅当 profile 显式开启 `exposeAllNamespaces` 时，才提供 `dsh-host-apiproxy` whitelist 绕过桥接（对应 §3.3.1、AC-SEC-01，需要在 README 中明确安全权衡后再吸收）。
- client 侧：注册 `context-provenance.ts` 的模块别名。
- client 侧：提供 RPC fetch 拦截器；v1 只负责 namespace 白名单合并等**已验证**场景，不引入 §5.4 中尚无真实案例支撑的"协议版本转换"（jsonrpc 等），后者留待出现真实证据后再实现。

这样 dshloader 从第一天起就能替代 `dsh-upstream-fixes` 的核心修复，后续新适配器按相同模式追加即可。

## 8. 风险与回滚

### 8.1 核心风险

| 风险编号 | 风险描述 | 影响 | 缓解措施 |
|----------|----------|------|----------|
| R-01 | 适配器缺失：dsh 升级后 dshloader 尚未发布对应适配器。 | dshloader 无法启动，profile 加载失败。 | 提供 fallback 到最近低版本适配器；fallback 失败时给出明确错误并提示升级 dshloader。 |
| R-02 | 服务别名冲突：新 dsh 版本重新引入旧服务名，loader 的别名覆盖官方服务。 | 官方行为被篡改，可能引入安全或功能问题。 | 别名注册前检查 `ctx.get(from) === undefined`；优先使用 `ctx.reflect.provide` 的不可覆盖语义。 |
| R-03 | client fetch 拦截器污染：拦截逻辑错误导致正常请求失败。 | Web UI 功能异常。 | 拦截器采用白名单匹配，非目标 URL 直接 `originalFetch`；所有转换都通过 try/catch 降级到原始响应。 |
| R-04 | 启动时延增加：版本探测、适配器初始化、模块别名注册需要时间。 | profile 启动变慢。 | 版本探测结果缓存于进程内存；client bundle 使用 `immediately` tier 预加载，避免阻塞 UI。 |
| R-05 | 稳定 API 设计不当：早期 API 未能覆盖未来场景，导致后续需要 breaking change。 | 插件需要跟随升级。 | 稳定 API 按 major 版本管理；新增能力用 minor 扩展，不破坏已有方法签名。 |
| R-06 | 插件仍直接依赖 dsh 内部：dshloader 无法拦截所有硬编码 import/service 注入。 | 部分插件仍会在 dsh 升级后损坏。 | 文档明确推荐插件只使用 `ctx.dshLoader` / `window.__dshLoader__`；对常见内部 import 提供模块别名覆盖。 |
| R-07 | Settings 白名单绕过：`exposeAllNamespaces` 开启后，dshloader 会移除官方 `dsh-host-apiproxy` 对浏览器可写 namespace 的 default-deny 边界（见 §3.3.1）。 | 任何插件注册的 namespace（包括本不该被浏览器写入的内部/敏感配置）都可能被 Web UI 读写，扩大攻击面。 | 默认关闭该开关，仅显式配置后生效；`describe` 结果始终保持 `redactSecrets` 语义；README 与安装文档必须明确标注该开关的安全含义；对应验收标准 AC-SEC-01。 |

### 8.2 回滚策略

#### 禁用 dshloader

临时把 dshloader 从 `cordis.patch.yml` 中移除或设置为 `disabled`：

```yaml
insert:
  - id: dsh-loader
    name: '@dsh-plugin/dsh-loader'
    disabled: true
```

重启 dsh web 后，dshloader 不再加载，依赖它的插件会报错，但可以快速验证问题是否由 loader 引入。

#### 降级 dshloader

```bash
cd ~/.dsh/profiles/web
pnpm install @dsh-plugin/dsh-loader@1.0.0
```

#### 回滚 dsh 版本

若 dshloader 尚未支持新 dsh 版本，可临时回滚 dsh（使用 betterdshlauncher 的多版本锁定功能）。

#### 紧急绕过

在启动命令中设置环境变量：

```bash
DSHLOADER_DISABLE=1 dsh web
```

若 dshloader 检测到该环境变量，可在 `apply` 中提前退出，不注册任何服务和别名。该环境变量仅作为开发/排查手段，不建议长期开启。

### 8.3 与 dsh-upstream-fixes 的过渡

在过渡期内，用户可能同时安装 `dsh-upstream-fixes` 和 `dshloader`。两者功能重叠时：

1. 服务别名：若 dshloader 已注册 `httpServer -> webServer`，dsh-upstream-fixes 应跳过（检查 `ctx.get('httpServer')`）。
2. client 拦截：两者都拦截 `window.fetch` 时，后加载的拦截器会先执行；dshloader 的目标请求应透传给原始 fetch，避免双重转换。
3. 长期方向：dsh-upstream-fixes 中通用性强的修复迁移到 dshloader 适配器，dsh-upstream-fixes 逐步退役为历史项目。

## 9. 验收标准

### 9.1 功能验收（AC-FN-*）

| 编号 | 验收项 | 验收标准 |
|------|--------|----------|
| AC-FN-01 | dshloader 能作为 bundle plugin 被 dsh 加载 | `dsh --profile web --dump-config` 在 dshloader 安装后成功退出，cordis 上下文中存在 `ctx.dshLoader`。 |
| AC-FN-02 | 插件可通过 `ctx.dshLoader.settings` 读写 settings | 调用 `ctx.dshLoader.settings.update(ns, section)` 成功写入，调用 `describe` 能返回包含该 namespace 的结构化数据。 |
| AC-FN-03 | 插件可通过 `ctx.dshLoader.web.register` 注册路由 | 注册 `/api/my-plugin/*` 前缀路由后，浏览器请求能命中 handler 并返回预期响应。 |
| AC-FN-04 | client 侧可通过 `window.__dshLoader__.require` 解析稳定模块 | 插件代码 `window.__dshLoader__.require('dsh/runtime/context-provenance')` 在当前 dsh 版本下能解析到有效模块。 |

### 9.2 兼容性验收（AC-CM-*）

| 编号 | 验收项 | 验收标准 |
|------|--------|----------|
| AC-CM-01 | 服务别名自动生效 | 在 `httpServer` 已不存在、`webServer` 存在的新版 dsh 下，旧插件注入 `httpServer` 不再挂起，能成功获得 `webServer` 实例。 |
| AC-CM-02 | 行为代理转换正确 | 模拟 dsh 某版本 `settings.update` 参数结构变化，插件调用稳定 API 仍成功，返回值结构与官方文档一致。 |
| AC-CM-03 | 适配器版本匹配正确 | 给定不同 `package.json` 版本，dshloader 选择对应的适配器；无精确匹配时回退到最近的低版本适配器并打印 warning（对应 §3.1 规则 1-3）。 |
| AC-CM-04 | 适配器缺失时给出明确错误，且区分"版本过新"与"版本过旧" | 模拟一个超出所有适配器范围（更新）的 dsh 版本，启动时抛出 `UnsupportedDshVersionError` 并提示升级 dshloader（§3.1 规则 5）；模拟一个低于所有已注册适配器支持范围（更旧）的 dsh 版本，同样抛出 `UnsupportedDshVersionError`，但错误信息需明确指出"版本过旧"并给出最低支持版本（§3.1 规则 4）。 |
| AC-CM-05 | client 模块重定向生效 | 插件仍使用旧的 deep source import 路径时，dshloader client bundle 能把它重定向到当前版本的公共入口。 |
| AC-CM-06 | Settings 白名单绕过默认关闭、按需开启 | 默认配置下，`ctx.dshLoader.settings.describe/update` 只覆盖官方白名单内的 namespace，行为与未安装 dshloader 时一致；显式设置 `exposeAllNamespaces: true` 后，才能读写白名单外的 namespace，且 `describe` 仍保持 `redactSecrets` 语义。 |

### 9.3 可观测性验收（AC-OB-*）

| 编号 | 验收项 | 验收标准 |
|------|--------|----------|
| AC-OB-01 | 启动日志包含关键信息 | dshloader 初始化后打印真实 dsh 版本、选中适配器版本、已注册稳定 API 列表。 |
| AC-OB-02 | 错误信息可追溯 | 当稳定 API 调用失败时，错误消息包含 `dshloader` 前缀、调用方法和底层错误原因。 |
| AC-OB-03 | 提供诊断命令 | `dshloader` 提供 `doctor` / `info` 命令（或 `setup --dry-run`），输出 profile 中 dshloader 状态、适配器选择、潜在冲突。 |

### 9.4 安全验收（AC-SEC-*）

| 编号 | 验收项 | 验收标准 |
|------|--------|----------|
| AC-SEC-01 | Settings 白名单绕过需显式开启且有安全提示 | 未配置 `exposeAllNamespaces` 时，dshloader 不得让任何白名单外 namespace 对浏览器可读写；README/安装文档必须包含该开关的安全影响说明；启动日志在该开关开启时打印明确的安全警告（如 `[dshloader] exposeAllNamespaces enabled: bypassing official settings whitelist`）。 |

### 9.5 性能验收（AC-PF-*）

| 编号 | 验收项 | 验收标准 |
|------|--------|----------|
| AC-PF-01 | 启动时延增量可控 | 在已安装依赖的 profile 中，加入 dshloader 后 `dsh --profile web --dump-config` 耗时增加不超过 500ms（单测冷启动）或 200ms（热启动）。 |
| AC-PF-02 | client bundle 体积可控 | dshloader client bundle 经过 minify 后大小不超过 50KB（首屏加载关键路径）。 |

### 9.6 综合验收（AC-OV-*）

| 编号 | 验收项 | 验收标准 |
|------|--------|----------|
| AC-OV-01 | 升级 dshloader 即可恢复兼容性 | 模拟 dsh 新版本破坏某稳定 API，通过新增适配器并发布新版 dshloader，旧插件无需修改即可恢复工作。 |
| AC-OV-02 | 回滚机制有效 | 设置 `DSHLOADER_DISABLE=1` 或 disabled patch 后，dshloader 不注册任何服务；降级 dshloader 版本后原行为恢复。 |
