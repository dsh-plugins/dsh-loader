# 从 dsh-loader 1.x 迁移到 2.0.0

1. 将插件 peerDependency 改为 `@dsh-plugin/dsh-loader: ^2.0.0`，使用 Node >=24.9.0。确认 dsh 位于[支持表](support.md)的六个 patch 系列中；未知 patch 和主版本不再回退。
2. 新插件配置使用 [config-api](config-api.md)。注册时传入插件自己的 Cordis 上下文；配置 ID 不使用 npm 包名中的 `/`。旧插件文件不会自动移动或删除，按插件自行决定迁移策略。
3. 删除由插件自行维护的设置表单。提供可序列化字段模板，loader 决定入口、卡片、label 和分组布局；不要再为同一模板自行注册 native 配置槽位。
4. 客户端启动必须使用宿主生成的协议 2 描述。升级后重新加载页面，旧的客户端缓存不能与 2.0 宿主混用。禁止用客户端选项覆盖宿主的适配器或设置开关。
5. `registerModuleAlias` / `registerPackageAlias` 返回清理句柄；原先忽略返回值的代码继续运行。优先传入 owner 上下文，或者把返回的 disposer 交给自己的 effect。宿主别名注册仍是异步 API。
6. 补丁 dispose 会使已经被其他包装器捕获的旧逻辑立即失效；任意顺序卸载都透传到仍有效的层。不要依赖旧的“释放后仍然执行”行为。

## 保留与变化

`ctx.dshLoader.settings/web/services/registry/llm/dsh/patch`、客户端入口及 UI facade 均保留。上游路径、符号及私有服务契约集中在 `src/adapters`，插件应优先使用有类型的 facade。

较新 dsh 的 settings 是实例 Config 表单，已删除旧的 namespace `register` / `installSection` 契约。2.0 保留这些方法入口，在该能力不存在时明确抛错；新配置应迁往 config-api。`describe/update/replace/mutate` 继续适配宿主设置。此变化不影响 loader 自己的配置存储。

宿主稳定子路径提供显式 ESM 和 CJS 出口，不依赖 `_resolveFilename` 钩子。导出的上游符号仍按宿主实际能力解析，已移除的符号在调用时报告不可用。不要使用旧 dsh 私有类型作公共插件接口；loader 的声明包不要求安装某个 dsh 版本。少数原始符号保留宽松 ABI 类型，推荐使用 facade 的类型。

旧客户端 `runtime`、`schema-form`、`web-react` 包已在支持范围之前退出上游发布：loader 保留常用 context provenance、schema/path、snapshot selector、useInvoke helpers。框架 renderer 和 SessionProvider 由宿主 UI 槽位提供，插件应使用运行时传入的 props，而不是创建第二个框架 renderer。

`exposeAllNamespaces` 仅控制旧 settings 桥接；开启时经宿主启动描述传给浏览器。config-api 始终单独注册并使用宿主浏览器认证。

## 卸载与故障

卸载 owner 会移除注册和监听，卸载 loader 会清理桥接、补丁和挂载；配置文件保留。显式清理和 Cordis 自动清理可以重复调用。全局解析器被第三方完全替换时只给出诊断，不尝试把未知调用链重新接回自身。

配置损坏、写入失败或修订冲突都不会静默覆盖原配置。profile 不能唯一定位时，设置 loader 入口 `config: { profileDir: '/absolute/profile/path' }` 后重载。
