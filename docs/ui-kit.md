# dshloader UI 套件（slot 注入 · 图标 · 基础控件）

> 面向**插件作者**：如何把浏览器半区的 UI 注入点改成向 dshloader 注册 slot，并使用统一的基础控件与图标，从而让全家桶插件共享一套设计语言。
>
> 权威代码：`src/ui/slots.tsx`（注入引擎）、`src/ui/anchors.ts`（锚点表）、`src/ui/components.tsx`（控件）、`src/ui/icons.tsx`（图标）、`src/ui/style.ts`（令牌）。
> 测试：`tests/ui/slots.spec.tsx`（17 例）、`tests/ui/components.spec.tsx`（33 例）。

---

## 1. 取用方式（唯一正确的通道）

浏览器半区从 **`@dsh-plugin/dsh-loader/client`** 取用，并在打包时标为 external：

```ts
import { Button, Card, Field, Switch, TextInput, Select, Icon } from '@dsh-plugin/dsh-loader/client';
import type { DshLoaderUi } from '@dsh-plugin/dsh-loader/client';
```

```ts
// 打包配置（tsdown / rolldown / esbuild 同理）
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'cordis',
  '@dsh-plugin/dsh-loader/client',   // ← 关键
];
```

### 为什么必须是 `/client` 而不是别的子路径

DSH 客户端模块表的同步 `require` 解析顺序是「seed 词 → 已物化记录 → shell 静态模块 → **已注册工厂** → 抛错」，并且在查表前只做一件归一化：**剥掉 `/client` 后缀**（`dsh-client-modules/lib/client.js:126` 的 `stripClientSuffix`）。

因此：

| 写法 | 运行时结果 |
|---|---|
| `require('@dsh-plugin/dsh-loader/client')` | 剥后缀 → 裸 id → 命中 dshloader 已注册工厂 → **递归物化**，顺序安全 ✅ |
| `require('@dsh-plugin/dsh-loader')` | 同上 ✅ |
| `require('@dsh-plugin/dsh-loader/ui')` | id 不匹配任何工厂 → 需要 dshloader 先物化并注册别名 → **有竞态** ❌ |

`dsh.client.immediately: true` 只保证 dshloader 的**工厂已注册**，不保证它的 `apply` 已跑完，所以别名路径不可靠；而「已注册工厂 + 递归物化」这条路径自带顺序自解析。

### 类型

`exports["./client"].types` 指向 `lib/types/client-ui.d.ts`（由 `tsconfig.client.types.json` 发出），所以上面的 `import type` 是**真实类型**，不需要手写 cast。

### ⚠️ 必须加入 externals（否则构建直接失败）

```
[MISSING_EXPORT] "Icon" is not exported by "../dsh-loader/lib/client.js"
```

见到这个报错，就是漏了 externals。dsh-loader 的客户端产物是被
`window.__ModuleLoader__.load({ factory })` 包裹的 **CJS 闭包**，静态分析看不到任何
`export`；一旦被当成可内联依赖，rolldown/esbuild 必然报 `MISSING_EXPORT`。

```ts
const CLIENT_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@dsh-plugin/dsh-loader/client',          // ← 少了这行就上面那个错
];
```

纯脚本插件（只用 `tsc`、在工厂里 `require`）无需改打包配置——工厂的 `require` 直接可用。

### ⚠️ 不要用子路径转发官方 UI 原语

`@dsh-plugin/dsh-loader/ui-primitives` 的 `.d.ts` 是 `export * from '@deepseek-ai/dsh-client-ui-primitives'`，而这行 re-export 从 **dsh-loader 自己的位置**解析——不是消费者位置。dsh-loader 发布后不带 `devDependencies`，于是消费者侧必然：

```
Module '"@dsh-plugin/dsh-loader/ui-primitives"' has no exported member 'Menu'.
```

**所以 `Menu` 这类 shell 主动共享进模块表的公开原语，直接从官方包导入**：

```ts
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives';  // 官方公开原语
import { Icon } from '@dsh-plugin/dsh-loader/client';                          // loader 策划图标
```

它们不是 dsh 的私有内部面，运行时由模块表可靠解析；绕子路径既无收益又会坏掉类型。

**图标相反，改用 loader 策划集确有收益**：消除手写 SVG、统一设计语言、`currentColor` 跟随主题、不依赖具体官方图标导出名。详见 §4。

---

## 2. slot 注入引擎

### 2.1 它替你做了什么

四个插件曾各自手写同一套样板。现在这些全归引擎：

| 职责 | 说明 |
|---|---|
| MutationObserver | **整个引擎只挂一个**，服务所有锚点与所有 mount |
| rAF 合流节流 | 一批 mutation 只触发一次 sweep（测试断言 40 次 mutation ≤ 2 次解析） |
| 宿主选择器 | 移进锚点表，由 dshloader 按 dsh 版本维护 |
| 每宿主幂等 | 同一 `(host, mount id)` 只 render 一次 |
| 自愈补回 | React 重渲染清掉挂载节点后，下一批 mutation 自动补回 |
| 生命周期清理 | 宿主脱离文档 → 跑 cleanup 并遗忘；disposer → 移除节点 + 跑 cleanup |
| 失败兜住 | render 抛错被记日志，不留孤儿节点，不影响其他 mount |

插件只需保留**真正属于自己的判断**。

### 2.2 拿到 facade：`inject: ['dshLoaderUi']`

```ts
export const inject = ['dshLoaderUi'];

export function apply(ctx: ClientContext): void {
  const ui = ctx.dshLoaderUi;          // 或 ctx.get('dshLoaderUi')
  if (ui === undefined) return;        // 防御：loader 缺席时静默不启用
  ctx.effect(() => ui.mount(/* ... */));
}
```

**必须 `inject` 而不是读 `window.__dshLoader__.ui`**：后者在 dshloader 的 `apply` 跑完前是 `undefined`，而 `immediately` 不保证这一点。声明服务依赖让 cordis 负责顺序（`src/client-ui.tsx` 的 `ctx.provide('dshLoaderUi', ui)`）。

### 2.3 命令式 mount

```ts
ctx.effect(() =>
  ui.mount('conversation.status', {
    id: 'thought-buddy:buddy',              // '<插件>:<用途>'，也是 data-dshl-slot 的值
    when: host => /diving/i.test(host.textContent ?? ''),
    render: (mount, host) => {
      const handle = renderInto(mount, host);
      return () => handle.stop();           // 返回 cleanup
    },
  }),
);
```

- `mount` 是引擎创建并按锚点声明放好的节点——**往里 append 就行，不要自己 insertBefore**；
- `host` 是宿主元素，需要读它的文本/属性时用；
- 返回的 cleanup 在「节点被移除」「宿主脱离」「disposer 调用」「引擎 destroy」时都会跑。

**动画/循环的存活基准应该用 `mount` 而不是 `host`**：引擎在卸载或宿主重渲染时移除 `mount`，于是 `mount.isConnected === false` 能同时覆盖「宿主脱离」和「React 只清空了宿主子节点」两种情况。

### 2.4 React mount

```ts
ctx.effect(() =>
  ui.mountReact('models.row', {
    id: 'auxiliary:capabilities',
    component: ({ host }) => <CapabilityRow row={host} />,
  }),
);
```

每个宿主一个 React root，teardown 时 `unmount()`。组件收到 `{ host: Element }`。

### 2.5 读型锚点
有些锚点是**读**而不是装饰（例如布局帧的折叠态与栅格宽度）：

```ts
const [frame] = ui.hosts('layout.frame');
const state = ui.layoutFrame();   // { collapsed, firstColumnPx }
```

### 2.6 内置锚点表

每条都注明了出处插件与它原来硬编码的选择器（`src/ui/anchors.ts`）：

| 锚点 | 选择器 | 出处 |
|---|---|---|
| `conversation.status` | `[data-conversation-scroll] [role="status"]`，兜底 `[role="status"]`，`prepend` | dsh-thought-buddy |
| `conversation.column` | `#root [data-slot="conversation"]` | dsh-better-sidebar |
| `shell.overlay` | `[data-shell-overlay]` | dsh-code-review |
| `desktop.detailsSurface` | `.dshDesktopDetailsSurface` —— **类名，最脆** | dsh-code-review |
| `layout.frame` | `[data-sidebar-collapsed], [data-shell-frame]`（只读） | dsh-code-review |
| `settings.nav` | `[data-settings-nav]`，兜底 `[role="tablist"]` | dsh-better-sidebar |

### 2.7 `onDomSettled` —— 锚点表达不了的注入

**不是所有注入都适合锚点模型。** `mount` 的模型是「锚点解析出宿主集合 → 每宿主挂一个节点」；当**宿主识别本身就是业务逻辑**时，硬塞进 `AnchorSpec.find()` 只会把业务代码倒进锚点表。

dsh-auxiliary 的模型目录就是这种：它按 `aria-label` 跨卡片关联 provider directory、去抖重读 settings、还要监听受控输入的 `input` 事件（受控输入不改子节点，mutation 观察不到）。这套识别逻辑有两百行，`find()` 永远表达不了。

但其中**「整文档 MutationObserver + rAF 合流」是与其他插件重复的样板**。于是引擎给出一个正交原语，让这类调用方保留自己的 sweep、只把观察与节流交出去：

```ts
ctx.effect(() => ui.onDomSettled(() => {
  mySweep();          // 必须幂等
}));
```

- 每个**合流后的 mutation 批次**调用一次，与 mount sweep 同一个 observer、同一帧；
- 在 mount sweep **之后**触发，所以监听者能看到本批次刚挂上的节点；
- 监听者**必须幂等**：它自己的写入会引发新批次，从而再次被调用；
- 抛错被兜住并记日志，不影响兄弟监听者；
- 返回取消订阅函数；`destroy()` 会清空所有订阅。

判断该用哪个：

| 情形 | 用 |
|---|---|
| 宿主能用选择器（+ 可选谓词）表达 | `mount` / `mountReact` |
| 宿主识别需要跨元素关联、异步数据、非 mutation 事件 | `onDomSettled` + 自己的 sweep |
| 只需读取 shell 状态，不装饰 | `hosts()` / `layoutFrame()` |

### 2.8 自定义锚点

dshloader 不认识的 shell 区域，插件可以自己声明：

```ts
ctx.effect(() =>
  ui.defineAnchor('my-plugin:panel', {
    describe: 'My panel host',
    find: () => document.querySelectorAll('[data-my-host]'),
    fallback: () => document.querySelectorAll('.my-fallback'),
    accept: el => el.isConnected,
    insert: 'append',      // 'prepend' | 'append' | 'before' | 'after'
    tagName: 'div',        // 生成的挂载节点标签，默认 span
  }),
);
```

若这个锚点其实是**通用**的（别的插件也会要），更好的做法是给 dshloader 的内置表提 PR——那才是「dsh 改 DOM 只改一处」的意义。

### 2.9 排障：`ui.diagnose()`

注入失效时先看这个，而不是逐个插件调试：

```ts
console.table(ui.diagnose());
// [{ anchor, describe, hosts, usedFallback, mounts, live }, ...]
```

- `hosts: 0` → 锚点在当前 shell 里找不到宿主（dsh 改了 DOM，改锚点表）
- `usedFallback: true` → 主选择器已失效，正在靠兜底路径运转（该修主选择器了）
- `mounts` 非空但 `live: 0` → 宿主存在但 `when` 全部否决，或 render 一直抛错（看 warn 日志）

### 2.10 诚实的边界

集中化能把「N 处各自静默失效」变成「1 处可诊断失效」，**但不能让 DOM 注入变得健壮**。锚点被官方删掉，任何适配器都救不回来。长期正解仍是把锚点推成官方 slot；本引擎是过渡层。

---

## 3. 基础控件

12 个组件，一套 `dshl-` 前缀的样式表。设计约束：

- **样式只注入一次**，带 DSH 归属属性 `data-plugin` / `data-plugin-css`，HMR 可回收；
- **每个颜色都是 DSH 令牌 + 回退值**，自动跟随 shell 主题（含深色模式），无需 JS 主题管线；
- **透传原生 props 与 `className`**，随时可以逃出默认样式而不必 fork 组件；
- 带 `prefers-reduced-motion` 降级。

| 组件 | 要点 |
|---|---|
| `Button` | `variant`: `default`/`primary`/`ghost`/`danger`；`small`；`icon`（图标名）；`loading`（自动 disabled + 转圈）；默认 `type="button"` |
| `IconButton` | `icon` + **必填 `label`**（作为 `aria-label` 与 `title`，因为没有可见文字） |
| `TextInput` | `mono`（等宽，用于路径/命令）、`invalid`（同时置 `aria-invalid`） |
| `Textarea` | 同上，`min-height: 72px`，可竖向 resize |
| `Select` | 基于**原生 `<select>`**，白拿平台键盘/移动端选择器/无障碍；`options`、`placeholder`（渲染为 disabled 空选项） |
| `Checkbox` | 样式化方框 + 可选 `label`；装饰方框带 `aria-hidden` |
| `Switch` | `role="switch"`；用于「即时生效」类设置 |
| `Field` | label + 控件 + `description`/`error`（`role="alert"`）；`htmlFor` 关联 |
| `Card` | 带边框的分区容器，`title` 渲染为 `h3` |
| `Row` / `Col` | 标准 gap 的 flex 容器 |
| `Spinner` | `role="status"` + `aria-label="loading"` |

```tsx
<Card title="网络代理">
  <Switch checked={cfg.proxyEnabled} onChange={onToggle} label="启用代理" />
  <Field label="协议" htmlFor="proto">
    <Select id="proto" options={PROTOCOLS} value={cfg.proxyProtocol} onChange={onProto} />
  </Field>
  <Field label="地址" description="仅影响走 global fetch 的请求">
    <TextInput mono value={cfg.proxyHost} onChange={onHost} />
  </Field>
  <Row>
    <Button variant="primary" icon="Save" loading={saving} onClick={save}>保存</Button>
    <Button variant="ghost" onClick={reset}>重置</Button>
  </Row>
</Card>
```

想要 DSH 的富弹出菜单而不是原生下拉时，用 `@dsh-plugin/dsh-loader/ui-primitives` 的 `Menu`（那是官方组件的稳定子路径转发）。

### 3.1 设计令牌

`src/ui/style.ts` 的 `T` 是 shell 令牌 + 回退值，`G` 是共用几何量（控件高度 30/24、圆角 8、字号 13/12 等）。自定义样式请用它们，别写死颜色：

```ts
import { T, G, cx, injectStyle } from '@dsh-plugin/dsh-loader/client';
const style = { color: T.labelTertiary, borderRadius: G.radius };
```

`injectStyle(pluginId, cssId, css)` 是幂等注入器，自动打上归属属性——插件自己注入样式表时请用它，而不是手搓 `<style>`。

---

## 4. 图标

```tsx
import { Icon, Icons, ICON_NAMES, DshIconProvider } from '@dsh-plugin/dsh-loader/client';

<Icon name="Settings" size={18} />          // 数据驱动
<Icons.GitBranch />                          // 直接引用组件
```

来自 `@icon-park/react`，**策划子集**（当前 52 个），意图命名（`Settings`/`Warning`/`GitBranch`）而非 IconPark 原名，这样换图不影响调用方。未知名字退化为 `Help` 而不抛错。

图标默认 `fill: 'currentColor'`，因此**自动继承周围文字色**，跟随主题。`DshIconProvider` 可为子树统一 outline 主题/线宽/尺寸。

加图标只需在 `src/ui/icons.tsx` 加一行 import + 一行导出——**不再手写任何 SVG path**（这正是它要消除的维护点：`dsh-better-sidebar/src/client/icons.tsx` 至今手工维护 10 个图标）。

### 4.1 ⚠️ 必须用逐图标深层导入

这是踩过的坑，务必遵守：

```ts
// ✅ 正确
import Setting from '@icon-park/react/es/icons/Setting';

// ❌ 错误——会把 ~2000 个图标全打进 bundle
import { Setting } from '@icon-park/react';
```

实测：barrel 导入让 dshloader 的 client bundle 从 **115 kB 膨胀到 5.88 MB（51 倍）**。三重原因叠加：

1. `es/index.js` 是 `export * from './map'`，而 `map.js` 引用全部图标；
2. 每个图标模块**顶层调用** `IconWrapper(...)` 且**没有 `/*#__PURE__*/` 标记**，打包器必须假设有副作用，无法删除；
3. `package.json` 的 `sideEffects: {styles/**}` 是**非法值**（应为数组或布尔），使 side-effect 剪枝直接失效。

而且跨运行时模块边界**本来就无法 tree-shake**：dshloader 的 bundle 经模块表整体物化，所以「导出了什么」就等于「打包了什么」。这也是为什么只能是策划子集而不是 `export *`。

需要冷门图标的插件可以自己依赖 `@icon-park/react`（同样用深层导入）。

---

## 5. 迁移清单

```
□ package.json
  □ dsh.client.inject 加 "@dsh-plugin/dsh-loader"
  □ peerDependencies 加 "@dsh-plugin/dsh-loader": "^1.1.0"
□ 客户端入口
  □ export const inject = ['dshLoaderUi', ...]（cordis 服务名）
  □ 从 ctx.dshLoaderUi 取 facade，undefined 时静默返回
□ 删掉自己的注入样板
  □ MutationObserver / rAF 节流 / mounted Map / scan()
  □ 硬编码的 shell 选择器 → 用锚点名（不在内置表里就 defineAnchor 或提 PR）
  □ 幂等守卫 / 自愈逻辑 / 卸载清理
□ 控件与样式
  □ 自建 button/input/switch/select → dsh-loader 基础控件
  □ 内联样式对象 → 组件 + T/G 令牌
  □ require('@deepseek-ai/dsh-client-ui-primitives') → 需要 Menu 等官方组件时
    改用 '@dsh-plugin/dsh-loader/ui-primitives'
□ 打包
  □ '@dsh-plugin/dsh-loader/client' 加入 externals
  □ 纯脚本（tsc-only）插件无需改打包，工厂的 require 直接可用
□ 验证
  □ typecheck 干净；仓库自带 test 全绿
  □ 审计：客户端源码里不应再出现 MutationObserver / querySelectorAll 定位 shell
```

---

## 6. 实测收益（dsh-thought-buddy）

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| 自有 DOM 观察代码 | MutationObserver + rAF 节流 + `scan()` + `mounted` Map + 双路径选择器 + 幂等守卫 + 清理，约 60 行 | **0**（仅注释里保留说明） |
| `querySelectorAll` 调用 | 2 | **0** |
| 插件保留的判断 | —— | 状态条文案是否匹配 + 渲染哪种表情 |
| 产物校验 | 18 项 | 18/18 全绿（并顺手修正了测试桩不传播 `isConnected` 的不忠实之处） |
