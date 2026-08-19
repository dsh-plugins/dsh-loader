# dshloader API 参考

> 版本：1.0.0 · 对应 `docs/design.md §4` 接口定义
> 本文档描述 dshloader 对外暴露的全部稳定 API、适配器实现接口、CLI、错误类型与数据结构。
> 所有 API 均以 ESM 导出，模块路径相对于包根 `@dsh-external/dshloader`。

---

## 快速上手（插件作者必读）

### 1. 安装

```sh
dsh plugin --profile <name> add /path/to/dshloader
# 或
DSH_HOME=~/.dsh npx dshloader setup <name>
```

插件的 `package.json` **只声明 dshloader 一个依赖**，不声明任何 `@deepseek-ai/*` 包：

```json
{
  "dependencies": {
    "@dsh-external/dshloader": "link:..."
  }
}
```

### 2. Host 侧：用 `ctx.dshLoader`

```js
export const inject = ['dshLoader'];

export async function apply(ctx) {
  // 注册 settings namespace
  const scope = ctx.dshLoader.settings.register('my-plugin', schema);
  const current = scope.get();

  // 注册 web 路由
  ctx.dshLoader.web.get('/api/my-plugin/status', (req, res) => res.json({ ok: true }));

  // WebSocket upgrade
  ctx.dshLoader.web.registerUpgrade({ path: '/ws/my-plugin', handler: (req, socket, head) => { /* ... */ } });

  // 读取 cordis 服务
  const sessions = ctx.dshLoader.services.get('sessions');
}
```

### 3. Host 侧：导入 dsh 包用稳定 subpath

```js
// ❌ 不要这样——dsh 改包名就坏
const { defineTool } = require('@deepseek-ai/dsh-tools');

// ✅ 用 dshloader 的稳定 subpath
const { defineTool } = require('@dsh-external/dshloader/tools');
```

| 稳定 subpath | dsh 1.x 真实包名 |
|---|---|
| `@dsh-external/dshloader/tools` | `@deepseek-ai/dsh-tools` |
| `@dsh-external/dshloader/llm` | `@deepseek-ai/dsh-llm` |
| `@dsh-external/dshloader/agent` | `@deepseek-ai/dsh-agent` |
| `@dsh-external/dshloader/settings` | `@deepseek-ai/dsh-settings` |

### 4. Client 侧：用 `@dsh-external/dshloader/*` subpath 导入 UI 包

```ts
// ❌ 不要这样——dsh 改包名就坏
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives';

// ✅ 用 dshloader 的稳定 subpath
import { IconCloseFill14 } from '@dsh-external/dshloader/ui-primitives';
```

| 稳定 subpath | dsh 1.x 真实包名 |
|---|---|
| `@dsh-external/dshloader/ui-primitives` | `@deepseek-ai/dsh-client-ui-primitives` |
| `@dsh-external/dshloader/ui-slots` | `@deepseek-ai/dsh-client-ui-slots` |
| `@dsh-external/dshloader/ui-settings` | `@deepseek-ai/dsh-client-ui-settings/client` |
| `@dsh-external/dshloader/web-react` | `@deepseek-ai/dsh-client-web-react` |
| `@dsh-external/dshloader/schema-form` | `@deepseek-ai/dsh-client-schema-form` |
| `@dsh-external/dshloader/runtime` | `@deepseek-ai/dsh-client-runtime/client` |

构建配置（tsdown / rollup / esbuild）需要把这些 subpath 加入 `external`：

```ts
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@dsh-external/dshloader/ui-primitives',
  '@dsh-external/dshloader/ui-slots',
  '@dsh-external/dshloader/ui-settings',
  '@dsh-external/dshloader/web-react',
  '@dsh-external/dshloader/schema-form',
  '@dsh-external/dshloader/runtime',
]
```

### 5. Client 侧：用 `window.__dshLoader__`

```js
// 读取 cordis client 服务
const conv = window.__dshLoader__.services.get('conversation');

// 动态注册包名别名（兜底用）
window.__dshLoader__.registerPackageAlias('@old/pkg', '@new/pkg');
```

### 6. 核心原则

- **插件 `package.json` 不允许出现 `@deepseek-ai/*`**——只依赖 `@dsh-external/dshloader`。
- **源码 import 只用 `@dsh-external/dshloader/*`**——dsh 改包名时只改 dshloader 适配器，插件不动。
- **host 侧用 `ctx.dshLoader.{settings,web,services}`**——不直接调 dsh 内部服务。
- **client 侧用 `window.__dshLoader__`**——不直接调 dsh 内部 RPC。

---

## 目录

1. [Host 稳定 API（插件面向）](#1-host-稳定-api插件面向)
2. [Client 稳定 API（插件面向）](#2-client-稳定-api插件面向)
3. [数据结构](#3-数据结构)
4. [错误类型](#4-错误类型)
5. [Host 适配器实现接口](#5-host-适配器实现接口)
6. [Client 适配器实现接口](#6-client-适配器实现接口)
7. [AdapterRegistry 与版本探测](#7-adapterregistry-与版本探测)
8. [Host bundle 入口](#8-host-bundle-入口)
9. [Client bundle 入口](#9-client-bundle-入口)
10. [CLI](#10-cli)
11. [安装与配置](#11-安装与配置)
12. [环境变量](#12-环境变量)

---

## 1. Host 稳定 API（插件面向）

插件在 cordis 上下文中通过 `ctx.dshLoader` 访问。该对象由 dshloader 在 `apply()` 时通过 `ctx.reflect.provide('dshLoader', api)` 注册，任何声明 `inject: ['dshLoader']` 的下游插件会自动获得。

### 1.1 对象总览

```ts
interface DshLoaderHostAPI {
  readonly version: string;          // dshloader 自身版本（如 "1.0.0"）
  readonly dshVersion: string;       // 探测到的真实 dsh 版本（如 "0.1.0-rc.7"）
  readonly adapterVersion: string;   // 当前选中适配器的 supports 范围（如 ">=0.1.0-rc.1 <2.0.0"）

  settings: DshLoaderSettingsAPI;
  web: DshLoaderWebAPI;
  services: DshLoaderServicesAPI;

  /** 运行时注册 host 侧包名别名（拦截 CJS require） */
  registerPackageAlias(oldName: string, newName: string): void;
}
```

### 1.2 `ctx.dshLoader.settings`

```ts
interface DshLoaderSettingsAPI {
  /** 是否绕过官方白名单（只读，启动时确定） */
  readonly exposeAllNamespaces: boolean;

  /** 注册一个 settings namespace，返回 owner scope（{ get, watch }） */
  register(ns: string, schema: object, options?: SettingsRegisterOptions): SettingsScope | undefined;

  /** 列出所有可见的 namespace（默认仅白名单内，开启 exposeAllNamespaces 后为全部） */
  describe(options?: { redactSecrets?: boolean }): NamespaceView[];

  /** 写入一个 namespace 的 section（部分更新） */
  update(ns: string, section: object, expectedRevision?: number): Promise<SettingsResult>;

  /** 替换一个 namespace 的完整值 */
  replace(ns: string, section: object, expectedRevision?: number): Promise<SettingsResult>;

  /** 对一个 namespace 应用一组操作（set/delete/merge） */
  mutate(ns: string, ops: SettingsOp[], expectedRevision?: number): Promise<SettingsResult>;
}
```

**`register(ns, schema, options?)`**

注册一个 settings namespace。代理到官方 `settings.register(ns, schema, options)`，返回 owner scope。**不受白名单过滤**——host 插件代码是可信的，注册 namespace 是组合期行为，不是浏览器侧读写。

| 参数 | 类型 | 说明 |
|------|------|------|
| `ns` | `string` | 唯一 namespace（小写 kebab-case，如 `'my-plugin'`） |
| `schema` | `object` | schemastery schema，定义 namespace 的值结构 |
| `options.base` | `object` | 组合层 base 值（优先级低于 user layer） |
| `options.applies` | `'live' \| 'restart'` | 生效时机，默认 `'live'` |
| `options.validate` | `(value: any) => void` | 跨字段校验（schema 无法表达的约束），抛错拒绝写入 |

返回 `SettingsScope | undefined`：

```ts
interface SettingsScope {
  get(): any;                              // 当前 resolved value
  watch(callback: (value: any) => void): () => void;  // 监听变更，返回取消函数
}
```

settings 服务不存在时返回 `undefined` 并打印警告。

**`describe(options)`**

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `options.redactSecrets` | `boolean` | `true` | 是否对 secret 字段脱敏（`secrets[].set: true` 但不泄露明文） |

返回 `NamespaceView[]`。当 `settings` 服务不存在时返回 `[]`。

**`update` / `replace` / `mutate`**

三个写方法都返回 `Promise<SettingsResult>`。底层调用 `ctx.get('settings')` 的同名方法；若 settings 服务不存在，返回 `{ ok: false, code: 'internal', message: '[dshloader]:settings.<method> settings service unavailable' }`。冲突异常（带 `expected`/`actual` 字段）映射为 `code: 'settings-conflict'`，其它异常映射为 `code: 'settings-rejected'`。

**白名单行为**

| `exposeAllNamespaces` | `describe` 返回范围 | 写方法行为 |
|------------------------|---------------------|------------|
| `false`（默认） | 仅 `DEFAULT_WEB_SETTINGS_NAMESPACES` 内的 namespace | 代理到官方 `settings` 服务（host 插件本就可信，不改变安全姿态） |
| `true` | 全部已注册 namespace | 同上，但 `describe` 不做白名单过滤 |

> ⚠️ `exposeAllNamespaces` 是安全相关开关，默认关闭。开启时启动日志会打印 `[dshloader] exposeAllNamespaces enabled: bypassing official settings whitelist`。浏览器侧的 default-deny 边界由 client fetch 拦截器独立覆盖（见 §2.2）。

### 1.3 `ctx.dshLoader.web`

```ts
interface DshLoaderWebAPI {
  /** 注册前缀路由，返回 dispose 函数 */
  register(prefix: string, handler: RequestHandler): Dispose;

  /** 注册 GET 路由 */
  get(path: string, handler: RequestHandler): Dispose;

  /** 注册 POST 路由 */
  post(path: string, handler: RequestHandler): Dispose;

  /** 注册中间件 */
  use(middleware: RequestHandler): Dispose;

  /** 注册 WebSocket upgrade 路由（精确 pathname 匹配） */
  registerUpgrade(route: WebUpgradeRoute): Dispose;
}
```

内部通过 `ctx.get('webServer') ?? ctx.get('httpServer')` 解析当前 web 服务，调用 `webServer.register({ kind, ... })`。`webServer` 不存在时抛出 `DshLoaderWebError`（消息含 `[dshloader]:web webServer service unavailable`）。

| 方法 | `register` 调用的 `kind` |
|------|--------------------------|
| `register(prefix, handler)` | `'prefix'`，`path: prefix` |
| `get(path, handler)` | `'route'`，`method: 'GET'` |
| `post(path, handler)` | `'route'`，`method: 'POST'` |
| `use(middleware)` | `'middleware'` |

**`registerUpgrade(route)`**

注册 WebSocket upgrade 路由。代理到 `webServer.registerUpgrade(route)`。`webServer` 不支持 upgrade 路由时抛出 `DshLoaderWebError`。

```ts
interface WebUpgradeRoute {
  /** 精确 pathname（无尾斜杠） */
  path: string;
  /** 拥有协议协商和升级后的 socket */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `route.path` | `string` | 精确 pathname，如 `'/sidebar/ws/terminal'` |
| `route.handler` | `(req, socket, head) => void` | 处理 upgrade 请求，拥有 socket 生命周期 |

返回 dispose 函数，调用后移除 upgrade 路由。

### 1.4 `ctx.dshLoader.services`

```ts
interface DshLoaderServicesAPI {
  /** 读取一个 cordis 服务（等价于 ctx.get(name)） */
  get<T = unknown>(name: string): T | undefined;

  /** 注册单跳服务别名（from -> to），不覆盖已存在的服务 */
  alias(from: string, to: string): void;
}
```

`alias` 的安全规则（与适配器别名一致，design.md §5.1）：
- 若 `ctx.get(from)` 已存在，打印 `[dshloader] services.alias: "<from>" already exists, skip alias` 并跳过。
- 若 `ctx.get(to)` 不存在，打印警告并跳过。
- 否则调用 `ctx.reflect.provide(from, target)`。

### 1.5 `ctx.dshLoader.registerPackageAlias(oldName, newName)`

注册 host 侧包名别名，拦截 CJS `require()` / `createRequire()` 调用。

**推荐用法——稳定 subpath（主路径）**：

插件不要直接 `require('@deepseek-ai/dsh-tools')`，而是从 dshloader 的 subpath 导入 `require('@dsh-external/dshloader/tools')`。dshloader 在 `package.json` 的 `exports` 里暴露这些 subpath，内部 re-export 真实 dsh 包。适配器同时在 `Module._resolveFilename` 安装映射，把稳定名解析到当前 dsh 版本的真实包名。dsh 改包名时只改 dshloader，插件不动。

| 稳定 subpath | dsh 1.x 真实包名 |
|--------------|------------------|
| `@dsh-external/dshloader/tools` | `@deepseek-ai/dsh-tools` |
| `@dsh-external/dshloader/llm` | `@deepseek-ai/dsh-llm` |
| `@dsh-external/dshloader/agent` | `@deepseek-ai/dsh-agent` |
| `@dsh-external/dshloader/settings` | `@deepseek-ai/dsh-settings` |

```js
// 插件代码（稳定 subpath，不随 dsh 版本变）：
const { defineTool } = require('@dsh-external/dshloader/tools')
```

插件的 `package.json` 只需要声明 dshloader 一个依赖，不需要声明任何 `@deepseek-ai/*` 包：

```json
{
  "dependencies": {
    "@dsh-external/dshloader": "link:..."
  }
}
```

**兜底用法——旧真实名→新真实名（过渡）**：

如果插件 bundle 已经构建好了，里面固化了 `require('@deepseek-ai/dsh-tools')`，dsh 改名后可以加一条旧名→新名的映射作为过渡：

```js
ctx.dshLoader.registerPackageAlias('@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool-cordis')
```

**工作原理**：dshloader 在适配器 `apply()` 时安装 `Module._resolveFilename` 钩子，在 CJS require 解析阶段做包名映射。钩子通过 `ctx.effect` 注册，fiber unload 时自动卸载。

> **限制**：`Module._resolveFilename` 只拦截 CJS `require()`（包括 `createRequire()` 产生的 require），**不拦截 ESM static `import`**——ESM static import 是构建期解析的，运行时无法拦截。host 侧插件如果用 ESM static import 引用 dsh 包，需要在构建时通过 pnpm `overrides` 或 tsconfig `paths` 做包名映射，或者改用 CJS `require()` + dshloader 稳定 subpath。

---

## 2. Client 稳定 API（插件面向）

client bundle 在 `immediately` tier 执行，挂载 `window.__dshLoader__`。

### 2.1 对象总览

```ts
interface DshLoaderClientAPI {
  readonly version: string;          // dshloader 自身版本
  readonly dshVersion: string;       // 探测到的真实 dsh 版本（来自 window.__DSHLOADER_VERSION__）
  readonly adapterVersion: string;   // 当前 client 适配器的 supports 范围

  /** 按稳定模块名或旧源码路径解析真实 dsh 当前版本的公开模块 */
  require(specifier: string): any;

  /** 运行时注册新的模块别名 */
  registerModuleAlias(alias: string, target: string): void;

  /** 运行时注册新的包名别名（拦截 __ModuleLoader__ 的 require） */
  registerPackageAlias(oldName: string, newName: string): void;

  /** 读取 client 侧 cordis 服务（代理到 clientCtx.get(name)） */
  services: {
    get<T = unknown>(name: string): T | undefined;
  };

  /** 插件可直接调用的 client 封装（仅 exposeAllNamespaces 开启时存在） */
  rpc?: {
    settings?: {
      describe(): Promise<{ ok: boolean; namespaces: NamespaceView[] }>;
      update(ns: string, section: object): Promise<{ ok: boolean; result: SettingsResult }>;
      replace(ns: string, section: object): Promise<{ ok: boolean; result: SettingsResult }>;
      mutate(ns: string, ops: SettingsOp[]): Promise<{ ok: boolean; result: SettingsResult }>;
    };
  };
}
```

### 2.2 `window.__dshLoader__.services.get(name)`

读取 client 侧 cordis 服务。代理到 dshloader client `apply(ctx)` 收到的 cordis client context 的 `ctx.get(name)`——与插件在自己的 client `apply(ctx)` 中调 `ctx.get(name)` 等价，但通过 dshloader 稳定 surface 暴露，插件不直接依赖 cordis context 形状。

```js
// 不再写：const conversation = ctx.get('conversation');
// 改成：
const conversation = window.__dshLoader__.services.get('conversation');
```

> **注意**：`services.get` 仅在 dshloader client `apply(ctx)` 收到 cordis context 时可用（即 cordis client boot 路径）。`installClient` 在非 cordis 环境（如直接在浏览器中加载）调用时 `services.get` 始终返回 `undefined`，不抛错。

### 2.3 `window.__dshLoader__.require(specifier)`

按适配器的 `moduleAliases` 表把稳定模块名/旧源码路径映射到真实入口，再调用底层 `require`。

| 输入 | 映射目标（dsh 1.x 适配器） |
|------|----------------------------|
| `'@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts'` | `'@deepseek-ai/dsh-client-runtime/client'` |
| `'dsh/runtime/context-provenance'` | `'@deepseek-ai/dsh-client-runtime/client'` |

未在别名表中的 specifier 抛出 `ModuleNotFoundError`（不会触达文件系统，防止路径逃逸）。

### 2.4 `window.__dshLoader__.registerModuleAlias(alias, target)`

运行时追加模块别名，立即对后续 `require(alias)` 生效。

### 2.5 `window.__dshLoader__.registerPackageAlias(oldName, newName)`

运行时追加**包名别名**，立即对 `__ModuleLoader__` 内所有后续 `require(oldName)` 调用生效。

**推荐用法——稳定 subpath（主路径）**：

插件源码不要直接 `import { IconX } from '@deepseek-ai/dsh-client-ui-primitives'`，而是从 dshloader 的 subpath 导入 `import { IconX } from '@dsh-external/dshloader/ui-primitives'`。构建器把 `@dsh-external/dshloader/ui-primitives` 列为 external，bundle 里是 `require('@dsh-external/dshloader/ui-primitives')`，运行时 dshloader 的 `__ModuleLoader__` wrapper 把它映射到当前 dsh 版本的真实包名。

| 稳定 subpath | dsh 1.x 真实包名 |
|--------------|------------------|
| `@dsh-external/dshloader/ui-primitives` | `@deepseek-ai/dsh-client-ui-primitives` |
| `@dsh-external/dshloader/ui-slots` | `@deepseek-ai/dsh-client-ui-slots` |
| `@dsh-external/dshloader/web-react` | `@deepseek-ai/dsh-client-web-react` |
| `@dsh-external/dshloader/schema-form` | `@deepseek-ai/dsh-client-schema-form` |
| `@dsh-external/dshloader/runtime` | `@deepseek-ai/dsh-client-runtime/client` |

```ts
// 插件源码（稳定 subpath，不随 dsh 版本变）：
import { IconCloseFill14, Tooltip } from '@dsh-external/dshloader/ui-primitives'
```

构建配置（tsdown 等）需要把 `@dsh-external/dshloader/*` 加入 external 列表，让构建器不内联这些包：

```ts
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  // ... 其他平台包 ...
  '@dsh-external/dshloader/ui-primitives',
  '@dsh-external/dshloader/ui-slots',
  '@dsh-external/dshloader/web-react',
  '@dsh-external/dshloader/schema-form',
  '@dsh-external/dshloader/runtime',
]
```

插件的 `package.json` 只需要声明 dshloader 一个依赖：

```json
{
  "dependencies": {
    "@dsh-external/dshloader": "link:..."
  }
}
```

**兜底用法——旧真实名→新真实名（过渡）**：

已构建好的 bundle 里固化了 `require('@deepseek-ai/dsh-client-ui-primitives')`，dsh 改名后可以加一条旧名→新名的映射：

```js
window.__dshLoader__.registerPackageAlias(
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-components',
)
```

与 `registerModuleAlias` 的区别：

| | `registerModuleAlias` | `registerPackageAlias` |
|---|---|---|
| 拦截层 | `window.__dshLoader__.require()` | `__ModuleLoader__` 的 factory `require()` |
| 用途 | 模块路径重定向（deep source path → 公开入口） | npm 包名重定向（稳定 subpath/旧名 → 真实名） |
| 影响范围 | 只有显式调 `window.__dshLoader__.require()` 的代码 | 所有插件 bundle 内的 `require()` 调用 |

**工作原理**：dshloader 在 `immediately` 层包装 `window.__ModuleLoader__.load`，把每个 factory 收到的 `require` 函数包一层——先查 `packageAliases` 表做包名映射，再调原始 `require`。

> **注意**：包名映射只在 `require(spec)` 的 `spec` 精确匹配时生效，不做子路径拆分（`require('@dsh-external/dshloader/pkg/sub')` 不会命中 `@dsh-external/dshloader/pkg` 的映射）。dsh 的 client bundle 构建器把包名整体作为一个模块 ID 传给 factory 的 require，不存在子路径拆分问题。

### 2.6 `window.__dshLoader__.rpc.settings.*`（仅 `exposeAllNamespaces: true`）

直接调用 host 桥接路由 `/api/dshloader/settings/*`，返回结构化结果（不经过官方 RPC 信封，不需要 rpcId）。默认关闭时 `rpc` 为 `undefined`。

### 2.7 fetch 拦截器（自动安装，仅 `exposeAllNamespaces: true`）

拦截 `window.fetch`，处理两类请求（design.md §3.3.1 路径 2）：

| 请求 | 行为 |
|------|------|
| `GET /api/settings.describe` | 调用官方接口获取白名单内 namespace，再调用 `/api/dshloader/settings/describe` 获取全量，合并后返回（官方 `rpcId`/字段保持不变） |
| `POST /api/settings.{update,mutate,replace}` | 若请求体 `payload.ns` 不在官方白名单内，转发到 `/api/dshloader/settings/<mode>`，重建响应信封为 `{ type: 'server-response', rpcId, result }`（`rpcId` 原样回显） |
| 其它请求 | 原样透传 `originalFetch` |

非目标请求和拦截异常都降级到原始 fetch，不抛出（design.md R-03）。

---

## 3. 数据结构

### 3.1 `NamespaceView`

```ts
interface NamespaceView {
  ns: string;
  schema: object;
  value: object;
  base?: object;        // 仅当 descriptor.base !== undefined 时存在
  user?: object;        // 仅当 descriptor.user !== undefined 时存在
  applies: object;
  secrets: Array<{ path: string[]; set: boolean }>;
  revision: number;
}
```

与官方 `settings.describe` 的 wire shape 一致（mirrors `dsh-upstream-fixes/lib/index.js` `namespaceView`）。

### 3.2 `SettingsResult`

```ts
interface SettingsResult {
  ok: boolean;
  code?: 'settings-conflict' | 'settings-rejected' | 'internal';
  message?: string;
  value?: NamespaceView;       // ok:true 时存在
  details?: object;            // ok:false 时存在，含 ns + 可选 expected/actual
}
```

### 3.3 `SettingsOp`

```ts
interface SettingsOp {
  op: 'set' | 'delete' | 'merge' | string;
  path: string[];
  value?: unknown;
}
```

### 3.4 `RequestHandler` / `Dispose`

```ts
type RequestHandler = (req: IncomingMessageLike, res: ServerResponseLike) => void | Promise<void>;
type Dispose = () => void;
```

### 3.5 `SettingsScope`

```ts
interface SettingsScope {
  /** 当前 resolved value（schema defaults + base + user layer 合并后） */
  get(): any;
  /** 监听 namespace 变更，返回取消监听函数 */
  watch(callback: (value: any) => void): () => void;
}
```

### 3.6 `SettingsRegisterOptions`

```ts
interface SettingsRegisterOptions<T = any> {
  /** 组合层 base 值（优先级低于 user layer） */
  base?: Partial<T>;
  /** 生效时机，默认 'live' */
  applies?: 'live' | 'restart';
  /** 跨字段校验（schema 无法表达的约束），抛错拒绝写入 */
  validate?: (value: T) => void;
}
```

### 3.7 `WebUpgradeRoute`

```ts
interface WebUpgradeRoute {
  /** 精确 pathname（无尾斜杠），如 '/sidebar/ws/terminal' */
  path: string;
  /** 拥有协议协商和升级后的 socket */
  handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>;
}
```

---

## 4. 错误类型

所有错误均带 `name` 属性，可在 `instanceof` 判断中使用。

### 4.1 `UnsupportedDshVersionError`

```ts
class UnsupportedDshVersionError extends Error {
  name: 'UnsupportedDshVersionError';
  kind: 'too-old' | 'too-new';   // 区分版本过旧 vs 过新/空注册表
  version?: string;              // 触发错误的 dsh 版本
  minSupported?: string;         // kind='too-old' 时给出最低支持版本
}
```

| `kind` | 触发条件 | 消息特征 |
|--------|----------|----------|
| `'too-old'` | 真实版本低于所有适配器的最低下界 | 含 "too old" + 最低支持版本 |
| `'too-new'` | 注册表为空，或版本既不命中任何规则也不属于 too-old | 含 "upgrade @dsh-external/dshloader" |

### 4.2 `InvalidVersionError`

```ts
class InvalidVersionError extends Error {
  name: 'InvalidVersionError';
  version?: string;
}
```

当 `registry.select(version)` 收到无法解析为 semver 的字符串时抛出。

### 4.3 `DshLoaderWebError`

```ts
class DshLoaderWebError extends Error {
  name: 'DshLoaderWebError';
}
```

`ctx.dshLoader.web.*` 在 `webServer`/`httpServer` 服务缺失时抛出，消息含 `[dshloader]:web` 前缀。

### 4.4 `ModuleNotFoundError`

```ts
class ModuleNotFoundError extends Error {
  name: 'ModuleNotFoundError';
  specifier: string;
}
```

`window.__dshLoader__.require(unknownSpecifier)` 时抛出，不会触达文件系统。

---

## 5. Host 适配器实现接口

新增 dsh 版本适配器时实现此接口（design.md §4.4）。

### 5.1 `HostAdapterFactory`

```ts
interface HostAdapterFactory {
  /** 支持的 dsh 版本范围，npm semver 语法（如 '>=0.1.0-rc.1 <2.0.0'） */
  readonly supports: string;
  /** 适配器名称，用于日志和调试 */
  readonly name: string;
  /** 创建适配器实例 */
  create(ctx: CordisContext, config: LoaderConfig): HostAdapter;
}
```

### 5.2 `HostAdapter`

```ts
interface HostAdapter {
  /** 初始化：注册服务别名、桥接路由等。返回 void 或 Promise */
  apply(): void | Promise<void>;

  /** 释放 cordis 不感知的资源（v1 通常为空实现，effect 自动回收） */
  dispose(): void | Promise<void>;

  /** 可选：覆盖默认 settings API */
  settings?: DshLoaderSettingsAPI;
  /** 可选：覆盖默认 web API */
  web?: DshLoaderWebAPI;
  /** 可选：覆盖默认 services API */
  services?: DshLoaderServicesAPI;
}
```

> **dispose 的触发场景**：仅在适配器热替换（诊断/测试）时由 `AdapterRegistry` 调用。正常生产环境 dsh 版本变化伴随进程重启，依赖 cordis 原生 effect 回收即可。v1 覆盖的能力（别名、web 路由、settings 桥接）全部通过 `ctx.reflect.provide`/`ctx.effect` 注册，**不需要**自定义 `dispose()`。

### 5.3 `LoaderConfig`

```ts
interface LoaderConfig {
  exposeAllNamespaces: boolean;
}
```

由 `readLoaderConfig()` 从环境变量和 profile `package.json` 解析后传入适配器 `create()`。

### 5.4 内置适配器：`dsh-1-x`

| 字段 | 值 |
|------|----|
| `supports` | `'>=0.1.0-rc.1 <2.0.0'` |
| `name` | `'dsh-1-x'` |
| `BRIDGE_PREFIX` | `'/api/dshloader'` |

`apply()` 行为：
1. 若 `ctx.get('httpServer') === undefined` 且 `ctx.get('webServer') !== undefined`，执行 `ctx.reflect.provide('httpServer', ctx.get('webServer'))`，打印 `[dshloader] aliased httpServer -> webServer`。
2. 若 `httpServer` 已存在，打印 `[dshloader] httpServer already exists, skip alias`。
3. 若 `config.exposeAllNamespaces === true`，通过 `ctx.effect` 注册 host 桥接路由（`/api/dshloader/settings/{describe,update,mutate,replace}`）。

---

## 6. Client 适配器实现接口

### 6.1 `ClientAdapterFactory`

```ts
interface ClientAdapterFactory {
  readonly supports: string;
  readonly name: string;
  create(api: DshLoaderClientAPIBase): ClientAdapter;
}
```

### 6.2 `ClientAdapter`

```ts
interface ClientAdapter {
  apply(): void;
  dispose(): void;
  /** 稳定模块名/旧源码路径 -> 真实模块路径 */
  moduleAliases?: Record<string, string>;
  /** 额外暴露的 client 服务 */
  services?: Record<string, any>;
}
```

### 6.3 内置 client 适配器

`moduleAliases`：
```js
{
  '@deepseek-ai/dsh-client-runtime/src/client/sessions/context-provenance.ts':
    '@deepseek-ai/dsh-client-runtime/client',
  'dsh/runtime/context-provenance': '@deepseek-ai/dsh-client-runtime/client',
}
```

---

## 7. AdapterRegistry 与版本探测

模块路径：`@dsh-external/dshloader/registry`

### 7.1 `detectDshVersion(opts?)`

```ts
function detectDshVersion(opts?: {
  profileDir?: string;
  dshPkgPath?: string;
  env?: NodeJS.ProcessEnv;
}): string | undefined;
```

按优先级探测真实 dsh 版本：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `opts.env.DSHLOADER_DSH_VERSION` / `process.env.DSHLOADER_DSH_VERSION` | 测试/CI 覆盖，最高优先 |
| 2 | `opts.dshPkgPath` 指定的 package.json | 显式路径 |
| 3 | `{opts.profileDir}/node_modules/@deepseek-ai/dsh/package.json` | profile 内安装的 dsh |
| 4 | `require.resolve('@deepseek-ai/dsh/package.json')` | 从 dshloader 自身位置解析 |
| 5 | `{dirname(process.execPath)}/../lib/node_modules/@deepseek-ai/dsh/package.json` | 全局安装的 dsh（如 `/opt/homebrew/lib/node_modules/...`） |
| 6 | 从 `process.cwd()` 向上逐级查找 `node_modules/@deepseek-ai/dsh/package.json` | 最后回退 |

> 不使用 `child_process` 调用 `dsh --version`（design.md §3.2）。

### 7.2 `AdapterRegistry`

```ts
class AdapterRegistry {
  adapters: HostAdapterFactory[];

  /** 注册一个适配器工厂 */
  register(factory: HostAdapterFactory): this;

  /** 按版本选择适配器，返回 { factory, mode } */
  select(version: string): { factory: HostAdapterFactory; mode: 'exact' | 'range' | 'fallback' };
}
```

**`select(version)` 五条规则**（design.md §3.1）：

| 规则 | 条件 | 结果 |
|------|------|------|
| 1 精确匹配 | `factory.supports === version` | `mode: 'exact'` |
| 2 范围匹配 | `semver.satisfies(version, supports)` | `mode: 'range'`；多个命中时选最窄范围，并列时后注册者优先 |
| 3 最近低版本回退 | 无精确/范围命中，但存在上界 < version 的适配器 | `mode: 'fallback'`，打印 warning，选上界最接近者 |
| 4 版本过旧 | version 低于所有适配器最低下界 | 抛 `UnsupportedDshVersionError`（`kind: 'too-old'`） |
| 5 版本过新/空注册表 | 注册表为空，或上述都不满足 | 抛 `UnsupportedDshVersionError`（`kind: 'too-new'`） |

`version` 不是合法 semver 时抛 `InvalidVersionError`。

### 7.3 `registerHostAdapters(registry)`

```ts
function registerHostAdapters(registry: AdapterRegistry): AdapterRegistry;
```

把所有内置 host 适配器注册到给定 registry。来自 `@dsh-external/dshloader/adapters`。

### 7.4 `hostAdapters` / `clientAdapters`

```ts
const hostAdapters: HostAdapterFactory[];
const clientAdapters: ClientAdapterFactory[];
```

内置适配器列表，按注册顺序排列。

---

## 8. Host bundle 入口

模块路径：`@dsh-external/dshloader`（即 `src/index.js`）

### 8.1 cordis 函数插件导出

```ts
export const name: string;           // 'dshloader'
export const inject: string[];       // ['webServer']
export async function apply(ctx: CordisContext): Promise<void>;
```

`apply(ctx)` 是 cordis 调用入口：
1. 若 `DSHLOADER_DISABLE=1`，打印 `[dshloader] disabled by env, skipping` 并返回。
2. 否则调用 `applyAdapter(ctx)`。

### 8.2 `applyAdapter(ctx, opts?)`

```ts
async function applyAdapter(ctx, opts?: {
  dshVersion?: string;
  config?: LoaderConfig;
  registry?: AdapterRegistry;
}): Promise<{ api: DshLoaderHostAPI; factory: HostAdapterFactory; mode: string; dshVersion: string }>;
```

完整流程：探测版本 → 选择适配器 → `adapter.apply()` → 构造 `DshLoaderHostAPI` → `ctx.reflect.provide('dshLoader', api)` → 打印启动日志。

### 8.3 `selectAdapter(opts?)`

```ts
function selectAdapter(opts?: {
  dshVersion?: string;
  registry?: AdapterRegistry;
}): { registry: AdapterRegistry; factory: HostAdapterFactory; mode: string; dshVersion: string };
```

不触碰 cordis 上下文，仅做版本探测 + 适配器选择。供 `info` 命令和测试使用。

### 8.4 `readLoaderConfig(opts?)`

```ts
function readLoaderConfig(opts?: { profileDir?: string }): LoaderConfig;
```

解析 `exposeAllNamespaces` 配置，优先级：
1. `process.env.DSHLOADER_EXPOSE_ALL_SETTINGS`（`'1'` 或 `'true'`）
2. profile `package.json` 的 `dsh.dshloader.exposeAllNamespaces`
3. profile `package.json` 的 `dshLoader.settings.exposeAllNamespaces`

### 8.5 `LOADER_VERSION`

```ts
export const LOADER_VERSION: string;  // '1.0.0'
```

---

## 9. Client bundle 入口

模块路径：`@dsh-external/dshloader/client`（即 `src/client.js`）

### 9.1 `installClient(opts?)`

```ts
function installClient(opts?: {
  window?: any;
  dshVersion?: string;
  exposeAllNamespaces?: boolean;
  requireImpl?: (spec: string) => any;
  hostBridgePrefix?: string;
}): DshLoaderClientAPI | undefined;
```

在浏览器环境安装 dshloader：
1. 挂载 `window.__dshLoader__`（`createClientAPI`）。
2. 通过 `window.__ModuleLoader__.load` 注册所有 `moduleAliases` 工厂。
3. 若 `exposeAllNamespaces` 开启，安装 fetch 拦截器并打印安全警告。

非浏览器环境（`window` 未定义）返回 `undefined`。文件末尾的 IIFE 会在真实浏览器中自动调用 `installClient({ window })`。

### 9.2 `createClientAPI(opts?)`

```ts
function createClientAPI(opts?: {
  dshVersion?: string;
  adapterVersion?: string;
  moduleAliases?: Record<string, string>;
  requireImpl?: (spec: string) => any;
  fetchBridge?: { describe(): Promise<any>; write(mode: string, payload: object): Promise<any> };
}): DshLoaderClientAPI;
```

构造 `window.__dshLoader__` 对象，不触碰全局。供测试使用。

### 9.3 `installSettingsFetchInterceptor(win, bridgePrefix?)`

```ts
function installSettingsFetchInterceptor(win: any, bridgePrefix?: string): () => void;
```

安装 settings fetch 拦截器，返回卸载函数（恢复 `win.fetch`）。bridgePrefix 默认 `'/api/dshloader'`。

---

## 10. CLI

入口：`bin/dshloader.mjs`（`package.json` bin 字段）。

```
dshloader <command> [args]

Commands:
  setup <profile>        注入 dshloader 到 profile（依赖 + patch，不调整顺序）
  dump-config <profile>  运行 dsh --profile <name> --dump-config 校验
  info [profile]         打印 dshloader 版本、探测到的 dsh 版本、选中适配器
```

### 10.1 `dshloader setup <profile>`

- 把 `@dsh-external/dshloader` 加入 profile `package.json` 的 `dependencies`（若不存在）。
- 在 `cordis.patch.yml` 追加 dshloader 的 `insert` 条目（若不存在）。
- **不调整** `insert` 列表顺序（cordis 响应式 DI，位次不影响生效）。
- 幂等：重复运行不会重复添加。

### 10.2 `dshloader dump-config <profile>`

调用 `dsh --profile <profile> --dump-config`，退出码反映校验结果。dsh 未安装时返回非零退出码。

### 10.3 `dshloader info [profile]`

输出：
```
[dshloader] version 1.0.0
[dshloader] detected dsh version: 0.1.0-rc.7
[dshloader] selected adapter: dsh-1-x (supports >=0.1.0-rc.1 <2.0.0, mode range)
```

### 10.4 程序化 API（`src/setup.mjs`）

```ts
function dshHome(): string;
function profileDir(profileName: string): string;
function injectDependency(pkgPath: string): { added: boolean; manifest: object };
function injectPatch(patchPath: string): { added: boolean; text: string };
function setupProfile(profileName: string): { profileDir: string; dependencyAdded: boolean; patchAdded: boolean };
function dumpConfig(profileName: string): { ok: boolean; output: string };
function info(profileName?: string): { loaderVersion: string; dshVersion?: string };
```

---

## 11. 安装与配置

### 11.1 作为 dsh 插件安装

```sh
# 从本地路径
dsh plugin --profile <name> add /path/to/dshloader

# 从 npm（发布后）
dsh plugin --profile <name> add @dsh-external/dshloader@^1.0.0

# 或用 setup 脚本（仅注入依赖 + patch，不调用 pnpm）
DSH_HOME=~/.dsh npx dshloader setup <name>
```

`dsh plugin add` 会自动：
1. 把包加入 `package.json` 的 `dependencies`。
2. 把包名加入 `dsh.profile.bundles`。
3. dsh 启动时根据 `dsh.bundle.patch` 自动加载 `cordis.patch.yml`。

### 11.2 profile `package.json` 字段

```jsonc
{
  "dependencies": {
    "@dsh-external/dshloader": "^1.0.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["@dsh-external/dshloader"]
    },
    "dshloader": {
      "exposeAllNamespaces": false   // 可选，默认 false
    }
  }
}
```

### 11.3 dshloader 自身 `package.json` 字段

```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },  // host bundle
    "client": { "platform": "web", "immediately": true }  // client bundle，immediately tier
  }
}
```

---

## 12. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DSHLOADER_DSH_VERSION` | — | 覆盖版本探测结果（测试/CI 用），最高优先级 |
| `DSHLOADER_EXPOSE_ALL_SETTINGS` | — | `1` 或 `true` 时开启 settings 白名单绕过 |
| `DSHLOADER_DISABLE` | — | `1` 或 `true` 时 dshloader `apply()` 提前退出，不注册任何服务/别名 |
| `DSH_HOME` | `~/.dsh` | dsh home 目录，影响 profile 路径解析 |

---

## 附录：模块路径速查

| 用途 | import 路径 |
|------|-------------|
| host bundle 入口 | `@dsh-external/dshloader` |
| client bundle 入口 | `@dsh-external/dshloader/client` |
| AdapterRegistry + 版本探测 | `@dsh-external/dshloader/registry` |
| 适配器注册 | `@dsh-external/dshloader/adapters`（内部模块 `src/adapters/index.js`） |
| cordis patch 文件 | `@dsh-external/dshloader/cordis.patch.yml` |
| package.json | `@dsh-external/dshloader/package.json` |
