# dshloader 宿主门面（host facades）

> 面向**插件作者**：如何把一个 DSH 插件的宿主半区改成只经 `ctx.dshLoader` 访问 dsh，从而在 dsh 升级破坏内部面时无需改动插件。
>
> 权威代码：`src/api.ts`（门面组装）、`src/patch.ts`、`src/services/{registry,settings,web,services}.ts`、`src/types.ts`（完整签名）。
> 适用版本：dshloader 1.1+，dsh `>=0.1.0-rc.1 <2.0.0`（适配器 `dsh-1-x`）。

---

## 0. 三条铁律

这是本仓库群踩出来的最重要三条，务必先读。

### 铁律一：门面管运行时，`import type` 管类型 —— 两者同时用

**放宽签名不是解耦，是丢信息。**

最初我把门面签名写松（`defineTool<T>(d: T): T`），结果 `defineTool({ execute(args, exec) {…} })` 里的 `args`/`exec` 失去上下文类型、变成隐式 `any`，一口气报了 12 个错。

正确做法：**值走门面（运行时解耦），类型从真包 `import type`（编译期保真）**。`import type` 在编译期被完全擦除，不进运行时 import 图，因此与「零 `@deepseek-ai` 运行时导入」毫不冲突：

```ts
// src/dsh.ts（dsh-auxiliary 的接入点）
import type * as DshTools from '@deepseek-ai/dsh-tools';   // 编译期，erased

export interface DshSymbols {
  tools: {
    defineTool: typeof DshTools.defineTool;               // 签名与 dsh 本体一致
    readonly ToolArgsError: typeof DshTools.ToolArgsError;
  };
}
```

由此确定依赖安排：

| 位置 | 放什么 |
|---|---|
| `dependencies` | 真正的运行时依赖（如 `schemastery`） |
| `peerDependencies` | 只有 `@deepseek-ai/cordis` 与 `@dsh-plugin/dsh-loader` |
| `devDependencies` | 所有仅用于 `import type` 的 `@deepseek-ai/*` 包 |

**验证方式不是看源码，而是看产物**：

```powershell
# 编译产物里应当一个 @deepseek-ai 引用都没有
Select-String -Path lib/*.js -Pattern "from '@deepseek-ai/|require\('@deepseek-ai/"
```

dsh-auxiliary 迁移后此项为 **0**，而 `import type` 保留了 12 个包的完整类型。

#### 别把类型增强副作用导入当成运行时导入删掉

`import '@deepseek-ai/dsh-fs'` 这种**无绑定**导入携带的是 `declare module 'cordis'` 的 Context 增强（`ctx.fs`、`ctx.tools`、`ctx.credentials`）。我一度把它当普通运行时导入删了，立刻收获一片
`Property 'fs' does not exist on type 'Context'`。正确写法：

```ts
import type {} from '@deepseek-ai/dsh-fs';    // 保留增强，编译期擦除
```

### 铁律二：宿主侧只用门面，不用稳定子路径

dshloader 提供两套访问机制，**用途不可互换**：

| 机制 | 形态 | 适用半区 | 由谁解析 |
|---|---|---|---|
| **门面** | `ctx.dshLoader.{patch,registry,settings,web,services,llm,dsh}` | **宿主（Node）** | dshloader 在启动期动态 import 真实 dsh 模块 |
| **稳定子路径** | `@dsh-plugin/dsh-loader/{ui-primitives,ui-slots,runtime,…}` | **客户端 bundle 的 external** | 浏览器模块表 |

子路径的实现是一行 re-export（`src/stable/settings.js`）：

```js
export * from '@deepseek-ai/dsh-settings';
```

这要求 `@deepseek-ai/dsh-settings` 在**该文件所在位置**可解析。而：

- **构建期**：插件一旦不再依赖 `@deepseek-ai/*`，TypeScript 立刻报
  `Module '"@dsh-plugin/dsh-loader/settings"' has no exported member 'installSettingsSection'`；
- **运行时**：dshloader 装在 profile 的 `node_modules`，`@deepseek-ai/*` 在 dsh 的全局安装里，ESM 静态 import 未必解析得到；宿主包名别名（`Module._resolveFilename` 钩子）只作用于 **CJS `require`**，拦不住 ESM 静态 import。

> **结论**：宿主半区里任何 `import … from '@dsh-plugin/dsh-loader/<subpath>'` 都是可疑的。需要某个 dsh 符号时，正确做法是**在 dshloader 里加一个门面转发**（§3.4、§5），而不是让插件去 import。

### 铁律三：子路径的**类型**转发在发布场景下不可用

这条是铁律二的延伸，且**修正了本文档早期的说法**。

`@dsh-plugin/dsh-loader/ui-primitives` 的 `.d.ts` 是 `export * from '@deepseek-ai/dsh-client-ui-primitives'`。这行 re-export 从 **dshloader 自己的位置**解析该包——**不是**从消费者位置。因此：

- 消费者自己装了该包也没用（不在 dshloader 的解析链上）；
- dshloader 发布后不带 `devDependencies`，消费者侧必然报 `has no exported member`。

实测：dsh-auxiliary 想让 `Menu` 走 `/ui-primitives`，得到

```
Module '"@dsh-plugin/dsh-loader/ui-primitives"' has no exported member 'Menu'.
```

（本地表现为 `@dsh-plugin/dsh-loader` 是指向源目录的 Junction，解析基准落在 dsh-loader 侧。）

**因此**：子路径 re-export 上游类型这条路是死的。公开原语有两条活路：

1. **直接从官方包导入**——类型天然保真，但每个插件各自绑定官方导出名与包路径；
2. **经 dshloader 的包装层**（推荐，`Menu` 已落地）：`src/ui/menu.tsx` 手写最小类型声明 + 单点导入平台包，消费方 `import { DshMenu as Menu } from '@dsh-plugin/dsh-loader/client'`。dsh 改名/换包/改 props 时只改 loader 一处；代价是手写声明要跟随上游 props 变化维护（见 docs/ui-kit.md「官方 UI 原语用 DshMenu 包装层」）。

子路径真正适用的只剩**只要值不要类型**的场景。

---

## 1. 接入

```jsonc
// package.json
{
  "peerDependencies": { "@dsh-plugin/dsh-loader": "^1.1.0" },
  "devDependencies":  { "@dsh-plugin/dsh-loader": "file:../dsh-loader" }
}
```

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis';   // 类型 import，编译期擦除

/** 声明服务依赖：cordis 保证 dshloader 先激活，否则本插件保持 PENDING。 */
export const inject = ['dshLoader'];

export function apply(ctx: Context, config: MyConfig): void {
  const loader = (ctx as Context & { dshLoader: DshLoaderHostApi }).dshLoader;
  // ...
}
```

关于 `DshLoaderHostApi` 的类型：推荐**本地建模只声明用到的那一小块**（见 §7），而不是从 dshloader 导入完整 `HostAPI`——这样 dshloader 扩展门面时插件不受影响。

---

## 2. `patch` —— 猴补丁协议

替换宿主方法或全局值时用它，**不要手写标记与还原逻辑**。

### 2.1 为什么必须集中

本仓库群曾有三份手写实现，其中一份是错的：

| 实现 | 还原前身份比对 |
|---|---|
| dshloader 的 `Module._resolveFilename` 钩子 | ✅ |
| dsh-network-settings 的 `globalThis.fetch` | ✅ |
| dsh-better-sidebar 的 `workspaces.openPath` | ❌ 无条件覆写 |

第三份的注释恰恰承诺了「任意卸载顺序下链式 wrapper 都能存活」，但实现是 `workspaces.openPath = original`，**没有** `if (current === ourWrapper)` 判断——另一插件在它之后也包了该方法而它先卸载时，后者的 wrapper 会被静默摧毁。

### 2.2 五条保证

| # | 保证 | 含义 |
|---|---|---|
| 1 | RAW 原值 | 每个补丁捕获**安装时刻槽里的真实值**（可能是别人的 wrapper），还原时原样放回 |
| 2 | 身份比对还原 | 仅当槽里仍是**自己的** wrapper 才还原；否则不动（避免抹掉后来者） |
| 3 | 重复 apply 安全 | 同 `id` 再次安装会先恢复真实原值再包，HMR 不会套娃 |
| 4 | 跨实例持久 | 簿记放在 `globalThis` 上 `Symbol.for` 键的 WeakMap 里，模块重载仍见到前任捕获的原值；**不改写目标对象** |
| 5 | 误用响亮 | 补丁不存在/非函数的槽、只读槽、wrap 不返回函数，一律抛错 |

### 2.3 用法

```ts
// 包一个服务方法
const handle = loader.patch.method(
  workspaces, 'openPath',
  original => (path: string) => takeover(path) ?? original.call(workspaces, path),
  { id: 'better-sidebar:openPath' },
);

// 包一个全局（默认 scope 为 globalThis）
ctx.effect(() => {
  const h = loader.patch.global<FetchType>('fetch', buildStack, {
    id: 'network-settings:fetch',
  });
  return () => h.dispose();
}, 'network-settings: fetch stack');
```

`wrap` 收到的 `original` 就是保证 1 里的「安装时刻真实值」，直接闭包住它即可：

```ts
const buildStack = (original: FetchType): FetchType => {
  const inner: FetchType = (input, init) => /* ... 用 original ... */;
  return (input, init) => withRetry(input, init, inner);
};
```

| 成员 | 说明 |
|---|---|
| `patch.method(target, key, wrap, opts?)` | 包对象方法 |
| `patch.global(key, wrap, opts?)` | 包全局；`opts.scope` 可指定 `window` 或测试替身 |
| `patch.slot(target, key, wrap, opts?)` | 底层原语 |
| `patch.isPatched(target, key)` | 槽里当前是否是 dshloader 的补丁 |
| `patch.patchIdOf(target, key)` | 当前补丁的 id |
| 返回的 `PatchHandle` | `.dispose()`（幂等）、`.active`、`.original` |

**务必传 `id`**：它是保证 3 的依据。省略时为 `'anonymous'`，重复 apply 就会套娃。

### 2.4 已知边界

保证 3 只在**自己的补丁位于最外层**时成立。若中途有别人的补丁叠在上面，再次 apply 会变成链式追加（无法在不重建整条链的前提下抽掉中间层）。

---

## 3. `registry` —— 私有注册表门面

dsh 对三件事没有公开 API，插件过去直接伸手进内部：

| 需求 | 过去的做法 | 现在 |
|---|---|---|
| 改写**已注册**的工具定义 | 遍历 `ctx.tools.layers.global.tools`（TS-private） | `registry.tools.patchAll()` |
| 广告新的沙箱升级模式 | 对 readonly 导出 `ESCALATION_TARGETS` 做 `push` | `registry.sandbox.addEscalationTarget()` |
| 注册权限 preset | 直写 `permissionPresets.presets` 活表 | `registry.permissionPresets.define()` |

所有访问器在内部形状变化时**退化为记日志的 no-op**，代价是功能缺失而非崩溃。

### 3.1 `registry.tools`

```ts
const off = loader.registry.tools.patchAll(def => {
  const spec = def.parameters?.sandbox_permissions;
  if (spec === undefined) return;              // 不是升级工具
  spec.enum = [...spec.enum, 'approve-for-me'];
  const original = def.execute!;
  def.execute = async (args, exec) => original(rewrite(args), exec);
}, { id: 'approve-for-me:escalation' });
```

`patchAll` 一次调用承担了原先四件事：

1. 遍历私有注册表（布局变了就 warn + 跳过）；
2. **每个定义对每个 `id` 只交付一次**（定义上挂不可枚举的 `Symbol.for` 标记）——这是防止 `tools/change` 风暴反复包装 `execute` 的关键；
3. 自动在 `tools/change` 上**重放**，于是本插件与工具插件的加载顺序无关；
4. patcher 抛错被兜住并记日志，不影响其他定义。

另有 `registry.tools.list()` / `.get(name)`。

### 3.2 `registry.sandbox`

```ts
ctx.effect(() => loader.registry.sandbox.addEscalationTarget('approve-for-me'));
```

幂等；返回移除该模式的 disposer；`@deepseek-ai/dsh-sandbox` 不可用时 warn 并返回空 disposer。`escalationTargets()` 读当前列表。

### 3.3 `registry.permissionPresets`

```ts
ctx.effect(() => loader.registry.permissionPresets.define('approve-for-me', {
  sandbox: 'workspace-write',
  approval: 'ask',
  name: '替我同意 / Approve For Me',
  description: '...',
}));

const active = loader.registry.permissionPresets.effective(session.events);
```

`define` **不覆盖已存在的键**（`cordis.patch.yml` 层已声明时让它赢），返回的 disposer 只删自己真正添加过的那一项。`effective(events)` 转发到 dsh 的 `effectivePermissionPreset`。

### 3.4 加门面比加子路径更对

`registry.sandbox` / `registry.permissionPresets` 刻意做成**门面**而不是 `/sandbox`、`/permission-presets` 子路径，原因有两层：

- §0 说的解析问题；
- 更重要的是**语义**：这两件事本质是「改写 readonly 导出」和「直写活表」。子路径只是把脆弱性透传给插件；门面能把它吸收掉（幂等、降级、可撤销）。

一般原则：**纯值/纯类用子路径（透传），侵入行为用门面（吸收）**。

---

## 4. `settings`

| 成员 | 说明 |
|---|---|
| `namespace(id)` | 转发 dsh 的 `settingsNamespace`；模块缺席时返回裸 id（等价可用） |
| `installSection(ctx, ns, schema, entry, hooks)` | **转发**到 dsh 的 `installSettingsSection`；返回 `false` 表示 dsh-settings 缺席（调用方继续用组合入口） |
| `isConflictError(error)` | 是否 revision 冲突；先 `instanceof SettingsConflictError`，缺席时退化为结构判定（带 `expected`/`actual`） |
| `register(ns, schema, options?)` | 注册命名空间，返回官方 owner scope；**不受白名单过滤** |
| `describe({redactSecrets})` | 读命名空间视图；**受白名单过滤**；`redactSecrets` 默认 `true` |
| `update` / `replace` / `mutate` | 写；直通真实服务，返回 `SettingsResult` |

```ts
const NS = loader.settings.namespace('my-plugin');

loader.settings.installSection<MyConfig>(ctx, NS, Config, base, {
  setSource: (source) => { current = source; },
  onChange:  () => { reconcileEverything(); },
  validate:  resolveConfig,
});
```

> `installSection` 是**转发而非重实现**。`installSettingsSection` 承载真实上游语义（以组合入口作 `base` 层注册、settings 服务在时把 source thunk 指向解析作用域、服务消失时回退到入口、全程挂在 scoped fiber 上）。抄进 shim 就是 bug 农场。

### 4.1 命名空间 id 必须稳定

`namespace()` 只接受 `[a-z0-9-]`，且这个 id 是**用户配置的主键**——改了它等于让所有用户丢配置。把它定成常量并永不修改，即使包改名：

```ts
/** 稳定命名空间 id（仅允许 [a-z0-9-]，保持稳定以保留已保存的用户设置）。 */
export const PLUGIN_ID = 'my-plugin';
```

---

## 5. `llm` 与 `dsh` —— 模块级符号

有些东西是 `@deepseek-ai/*` 的**模块级导出**而非 cordis 服务方法，`services.get(...)` 根本拿不到。它们都在启动期由 `preloadRegistryModules()` 一次性动态 import，因此下面每个访问器都是同步的。

### 5.1 `llm`

| 成员 | 说明 |
|---|---|
| `createUserMessage(input)` | 构造一条带 id、已冻结的 user 消息。dsh-llm 缺席时**抛错**——构造消息没有合理兜底，返回半成品只会让 agent 循环拒收 |
| `deepFreeze(value)` | 用 dsh 自己的深冻结（冻结语义与运行时一致）；缺席时退回顶层 `Object.freeze` |

推理本身仍走服务：`services.get('llm').stream(...)`。本门面只覆盖模块级 helper。

### 5.2 `dsh`

| 分组 | 成员 | 缺失时 |
|---|---|---|
| `dsh.tools` | `defineTool`、`ToolArgsError` | 抛错并点名 `@deepseek-ai/dsh-tools` |
| `dsh.timeout` | `deadline` | 抛错 |
| | `MAX_TIMER_DELAY_MS` | **回退** `2147483647` |
| `dsh.credentials` | `credentialRef` | 抛错 |
| `dsh.subagent` | `delegationDepthOf` | 抛错 |
| `dsh.compaction` | `BasicCompactionEngine` | 抛错 |
| `dsh.llm` | `BlockAssembler` | 抛错 |

**逐符号降级**，不是整包不可用：同一个包里一个符号缺失不影响它的兄弟。错误信息一律带 `[dshloader]` 前缀并点名缺哪个包，方便运维定位。

`MAX_TIMER_DELAY_MS` 是唯一的回退项，因为它是 Node `setTimeout` 的上限（`2**31 - 1`，已核实 dsh 的值就等于它）——平台常量而非 dsh 版本相关值，回退是等价的而不是猜测。

### 5.3 模块求值期拿不到门面怎么办

门面挂在 `ctx` 上，只有 `apply` 之后才存在。**模块求值期**（顶层 `const`、`class X extends Base`、schema 上界）需要的值必须另想办法。实测三类：

| 情形 | 处理 |
|---|---|
| `z.number().max(MAX_TIMER_DELAY_MS)` | 就地定义平台常量 |
| `settingsNamespace('llm-pi-ai')` 顶层调用 | dsh 的实现是**纯校验 + 原样返回**（只在类型层加品牌），改用裸字面量 + 品牌 cast |
| `class CompressEngine extends BasicCompactionEngine` | 改**惰性类工厂**（见下） |

惰性类工厂：类体移进函数，首次调用时才用门面基类构造并缓存；对外只导出 `interface` 作不透明句柄。

```ts
let Cached: (new (...args: any[]) => CompressEngine) | undefined;

function compressEngineClass() {
  if (Cached !== undefined) return Cached;
  const Base = dsh().compaction.BasicCompactionEngine;
  class Impl extends Base { /* …原类体… */ }
  Cached = Impl as never;
  return Cached;
}
```

前提是该类**只在 `apply` 之后实例化**、对外仅作类型持有——dsh-auxiliary 的 `CompressEngine` 正符合。

### 5.4 十个文件都要用怎么办：接入点模式

插件文件多时，逐个把 `loader` 参数往下传会很脏。dsh-auxiliary 的做法是一个接入点模块 `src/dsh.ts`：

```ts
let facade: DshFacade | undefined;
export function setDshFacade(v: DshFacade): void { facade = v; }
export function clearDshFacade(): void { facade = undefined; }

export function dsh(): DshSymbols {
  if (facade === undefined) throw new Error('… 只能在 apply 之后调用');
  return facade.dsh;
}
```

`apply` 开头 `setDshFacade(ctx.dshLoader)` 并用 `ctx.effect` 注册清除；其余 9 个文件一律 `import { dsh, llm } from './dsh.js'`。函数体内取用，天然晚于 `apply`。

---

## 6. `web` 与 `services`
### 5.1 `web`

每个方法都返回 disposer；服务不可用时抛 `DshLoaderWebError`。

| 方法 | 翻译成的真实调用 |
|---|---|
| `register(prefix, handler)` | `{ kind: 'prefix', path, handler }` |
| `exact(path, handler)` | `{ kind: 'exact', path, handler }` —— 任意方法，由 handler 自行分派 |
| `get` / `post` / `put` / `patch` / `del` | `{ kind: 'route', method, path, handler }` |
| `use(middleware)` | `{ kind: 'middleware', handler }` |
| `registerUpgrade({path, handler})` | WebSocket upgrade；底层不支持时抛错 |

**headless profile 没有 web 服务**，注册前先探测，否则门面抛错会中断装配：

```ts
const hasWeb =
  loader.services.get('webServer') !== undefined ||
  loader.services.get('httpServer') !== undefined;
if (hasWeb) {
  ctx.effect(() => {
    const offs = [loader.web.exact('/_dsh/my-plugin/state', handler)];
    return () => { for (const off of offs) off(); };
  }, 'my-plugin: routes');
}
```

### 5.2 `services`

- `services.get(name)` → `ctx.get(name)` 直通。**任意 cordis 服务都能拿到**，所以服务型访问从来不是迁移障碍。
- `services.alias(from, to)` → 单跳别名；`from` 已存在则 warn 跳过（**绝不覆盖**），`to` 不可用则 warn 跳过。

---

## 7. 本地建模门面类型

推荐只声明用到的那一小块，而不是导入完整 `HostAPI`：

```ts
/**
 * `ctx.dshLoader` 的最小视图。本地建模让插件在 loader 扩展门面时不受影响，
 * 也避免为宿主半引入构建期硬类型耦合。
 */
interface DshLoaderHostApi {
  patch: {
    global<T>(key: string, wrap: (original: T) => T,
              options?: { id?: string; scope?: object }): { dispose(): void };
  };
  web: { exact(path: string, handler: unknown): () => void };
  services: { get(name: string): unknown };
  settings: {
    namespace(id: string): unknown;
    installSection<T>(ctx: unknown, ns: unknown, schema: unknown, entry: T,
      hooks: { setSource(c: () => T): void; onChange(): void; validate(v: T): void }): boolean;
    isConflictError(error: unknown): boolean;
  };
}
```

完整签名见 `src/types.ts` 的 `HostAPI`。

---

## 8. 迁移清单

把一个既有插件的宿主半改成 dshloader 附属：

```
□ package.json
  □ 移除所有 @deepseek-ai/* 依赖（peer 与 dev 都移除）
  □ 加 peerDependencies: { "@dsh-plugin/dsh-loader": "^1.1.0" }
  □ 加 devDependencies:  { "@dsh-plugin/dsh-loader": "file:../dsh-loader" }
  □ schemastery：@deepseek-ai/schemastery → 普通 schemastery（API 等价，见下）
□ src/index.ts
  □ export const inject = ['dshLoader']
  □ 取 loader = ctx.dshLoader，本地建模其类型
  □ import type { Context } from '@deepseek-ai/cordis' 可以保留（编译期擦除）
  □ 任何 import { X } from '@deepseek-ai/*' 的值导入：
      - 服务型     → loader.services.get(...)
      - 侵入行为   → 找对应门面；没有就去 dshloader 加一个转发
      - 纯值/纯类  → 也用门面转发（宿主侧不要用子路径，见 §0）
  □ 手写猴补丁 → loader.patch.*
  □ webServer.register(...) → loader.web.*（先探测服务是否存在）
  □ installSettingsSection → loader.settings.installSection
□ 验证
  □ npx tsc --noEmit 干净
  □ 仓库自带 test 全绿
  □ 审计：Select-String 'import ' src 里不应再有 @deepseek-ai 的值导入
```

### schemastery 换包

`@deepseek-ai/schemastery@3.18.1` → 普通 `schemastery@3.18.0`。已核实所需 API 全部具备：

```
natural(): Schema<number>
percent(): Schema<number>
union<const X>(list: readonly X[]): Schema<TypeS<X>, TypeT<X>>
step(value: number): Schema<S, T>
```

`dsh-better-sidebar-loader` 已在生产中用普通 `schemastery` 走 `dshLoader.settings.register()`，这条路是验证过的。

---

## 9. 实测收益（dsh-network-settings）

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| 全局 fetch 接管 | 约 50 行（全局标记键、原值/wrapper 配对、还原前身份比对） | 1 次 `loader.patch.global(...)` |
| 路由注册 | `ctx.inject(['webServer','settings'], ...)` + 本地 `WebServerLike` 建模 | `loader.web.exact(...)` ×2 |
| 运行时 `@deepseek-ai` 值导入 | 2 处 | **0** |
| 测试 | 35/35 | 35/35（未放宽任何断言） |
