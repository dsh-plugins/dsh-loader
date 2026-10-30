# config-api（2.0.0）

配置由插件宿主声明，loader 负责持久化、HTTP 桥接与 React 表单。它不依赖宿主 settings，也不需要 `exposeAllNamespaces`。

## 注册

```ts
import { defineConfig } from '@dsh-plugin/dsh-loader/config';
import type { HostAPI, CordisContext } from '@dsh-plugin/dsh-loader';

interface Preferences { enabled: boolean; endpoint: string; timeout: number }
export const inject = ['dshLoader'];
export async function apply(ctx: CordisContext & { dshLoader: HostAPI }) {
  const handle = await ctx.dshLoader.config.register<Preferences>(ctx, defineConfig({
    id: 'example-plugin',
    packageName: '@example/plugin',
    title: '示例插件',
    description: '连接与运行参数',
    fields: [
      { type: 'boolean', key: 'enabled', label: '启用', default: true },
      { type: 'group', label: '连接', fields: [
        { type: 'text', key: 'endpoint', label: '服务地址', default: 'https://example.com', required: true },
        { type: 'number', key: 'timeout', label: '请求超时时间（秒）', default: 30, min: 1, max: 120 },
      ] },
    ],
  }));
  const initial = handle.get(); // { value: Preferences, revision: number }
  handle.watch(({ value, revision }) => console.log(value.enabled, revision));
  // 同级部分更新；嵌套对象与数组整体替换。宿主代码可省略 expectedRevision。
  await handle.update({ enabled: true }, initial.revision);
  // ctx 卸载自动释放注册与监听；需要提前结束时调用 handle.dispose()。
}
```

`register(ownerCtx, template)` 是异步的。owner 在读取磁盘期间卸载时，注册以 `disposed` 失败，不发布遗留模板。相同 ID 同时只允许一个注册；先释放再重装，旧句柄不能影响新注册。

| 句柄方法 | 行为 |
| --- | --- |
| `get()` | 返回值的副本与当前修订号；宿主可以读取密码 |
| `update(patch, expectedRevision?)` | 串行、完整校验后原子提交，同级部分合并 |
| `reset(expectedRevision?)` | 宿主直接提交模板默认值 |
| `watch(listener)` | 提交成功后通知；返回幂等取消函数，随 owner 回收 |
| `dispose()` | 解除模板、监听和 UI 注册，保留配置文件 |

## 模板

`id` 是安全的单目录名：小写字母或数字起头，后续可用小写字母、数字、`.`、`_`、`-`，最长 100 字符，不以点结尾，不允许 Windows 设备名。它与含 `/` 的 `packageName` 分开。可选 `rowId` 把配置放到某个插件实例，省略时放到包详情页。多个实例应使用不同的稳定 `id`。

字段公共属性：`key`、`label`、`description`、`default`、`required`、`min`、`max`、`pattern`、`visibleWhen: { path: string[], equals: JSON值 }`。显隐路径从配置根开始。模板只接受 JSON 值，不接受函数、JSX、CSS 或自定义渲染回调。

| type | 数据与附加属性 |
| --- | --- |
| `text` / `textarea` / `password` | 字符串；min/max 表示长度，pattern 是正则表达式字符串 |
| `number` | 有限数字；min/max 表示数值范围 |
| `boolean` | 开关 |
| `select` / `multiselect` | `options: [{ label, value: string或number }]`；多选存数组 |
| `object` | `fields`；创建嵌套对象 |
| `array` | `item` 指定每项字段模板；支持嵌套对象/数组，min/max 表示项数 |
| `group` | `fields`，无 key；只分组，不改变数据层级 |

缺失值补默认值：文本为空串，开关为 false，数组为空数组，数字为 min 或 0，单选为首个选项，对象递归补齐。显式默认值也必须通过字段校验。隐藏字段保留值，保存时仍校验完整结构。模板升级只补缺失字段；不自动迁移旧插件的其他文件。

## 文件和并发

保存位置为 `<profile>/config/<id>/config.json`：

```json
{ "formatVersion": 1, "revision": 1, "value": { "enabled": true } }
```

优先使用 loader 入口的 `config.profileDir`，否则从当前宿主 Loader 的 `config.baseUrl` 及其 profile 清单定位，再考虑本安装所在 profile。不会扫描其他 profile 并猜测当前运行者；无法定位时 `register` 返回 `profile-unavailable`。不接受越界 ID 或 config/plugin/file 层的符号链接。

同一 ID 的提交串行执行。临时文件在同目录以独占方式创建，写入和 fsync 成功后 rename 替换；替换失败不改内存、修订号或原文件。重装会等待前一注册的在途写入。损坏文件报错，不自动修复或覆盖。首版不监听手工修改，手动编辑后重新加载插件或重启。

客户端必须提交读取时的 `expectedRevision`。冲突返回 HTTP 409 / `ConfigError.code === 'conflict'`，不会覆盖别的页面。校验错误为 `validation`，`fields` 按点分路径指出字段。IO 错误保留原文件。

## 密码与桥接

密码在磁盘和宿主句柄中为普通配置字符串；它不是凭据保险库。HTTP 回传仅包含不可猜测的引用及 `set` 标记，模板和默认值里的密码也会遮蔽。原样引用表示保留，字符串表示设置新值，空串表示显式清空。数组删除、重排时引用随项移动，不按旧数组下标恢复密码。

`/api/dshloader/config` 提供 list/read/update/reset 与 `/events` SSE。只暴露当前注册的模板。请求使用宿主 `connection.authorizeIndex` 的浏览器认证，并拒绝跨站请求；宿主认证服务不可用时返回 503。订阅重连后重新读取，不依赖 `exposeAllNamespaces`。

## 统一页面

- dsh 0.1.5 系列、0.1.6-alpha.1：更多 → 设置 → 插件配置。
- 从 0.1.6-alpha.2 起：loader 注册 `plugins.bundle.config` 或 `plugins.row.config`，放在对应插件详情页，不重复创建聚合入口。
- 每个插件一个默认折叠卡片；字段使用 label / 控件 / 说明 / 错误结构，等价于 a-form-item。
- 一个卡片的全部可见字段共享实测最宽 label，包括分组内字段；展开、显隐变化和字体加载后重新测量。
- 分组使用圆角 fieldset 和 legend，让标题自然截断边框。数组提供新增、删除和逐项编辑。
- 保存、取消修改、恢复默认值均独立作用于当前卡片。恢复默认值只改草稿，保存后才写磁盘。保存失败或冲突保留草稿，外部更新不覆盖正在编辑的内容。
