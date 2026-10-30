# 宿主稳定 API

通过 `ctx.dshLoader` 访问宿主能力，声明 `inject: ['dshLoader']` 让 Cordis 处理加载顺序。公开类型从 loader 获取，不需要某个 dsh 版本的开发依赖。

```ts
import type { HostAPI, CordisContext } from '@dsh-plugin/dsh-loader';
export const inject = ['dshLoader'];
export function apply(ctx: CordisContext) {
  const loader = ctx.get('dshLoader') as HostAPI;
  const tools = loader.services.get('tools');
  // ctx 的 effect 自动回收此补丁。
  loader.patch.method(tools, 'dispatch', original => function (...args) {
    return original.apply(this, args);
  }, { owner: ctx });
}
```

## 能力入口

| 入口 | 用途 |
|---|---|
| `config` | 插件自有配置、模板与文件持久化，独立于宿主 settings |
| `settings` | 宿主配置的 describe/update/replace/mutate；旧 namespace 注册只在仍有该能力的版本可用 |
| `web` | HTTP 精确路由、前缀路由和中间件，统一返回清理句柄 |
| `services` | 获取规范化的宿主服务 |
| `registry` | 工具、沙箱和权限预设的兼容操作 |
| `llm` / `dsh` | 适配器预加载的模块符号与助手方法 |
| `patch` | 可停用、可幂等释放的函数补丁 |

确切签名见随包发布的 `dist/types.d.ts` 与 `dist/adapters/shared/*.d.ts`。适配器在宿主启动时选定，插件不要自行检测版本来复制上游私有逻辑。

## 稳定子路径

宿主 `tools`、`llm`、`agent`、`settings`、`timeout`、`subagent`、`credentials`、`compaction-basic` 同时提供 ESM/CJS 导出。模块在已选定运行时解析，调用缺失符号会明确报错；多套不同版本同时运行时请通过 owner 的 `HostAPI`，避免全局静态导入歧义。

公共声明由 loader 维护。原始版本相关 ABI 中仍有宽松类型，优先使用 facade；不要把某个上游版本的私有类型作为插件的公共契约。

## 归属与取消

别名注册返回清理函数，可以传入插件自己的上下文作为 owner。补丁由创建它的 API scope 持有；单个插件需要在自己的 effect 中释放返回句柄。释放任意层不会复活已释放的旧值，也不会覆盖之后的第三方包装器。不要将 loader 的全局生命周期等同于插件生命周期。

配置注册必须传入自己的 owner：`loader.config.register(ctx, template)`。监听归属同一 owner，异步注册在 owner 已卸载后完成也会立即清理。卸载不删除磁盘配置。

配置 API 示例见 [配置文档](config-api.md) 和 [示例插件](../examples/config-plugin/index.mjs)。版本范围、旧 settings 与客户端 helper 的迁移边界见 [支持表](support.md) 和 [迁移说明](migration-2.0.md)。
