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
      { type: 'group', label: '连接', collapsible: true, defaultCollapsed: false, fields: [
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
| `registerOperation(id, handler)` | 注册模板声明的宿主操作处理器，返回幂等取消函数；随此句柄/owner 回收 |
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
| `object` | `fields`；创建嵌套对象，可设置折叠属性 |
| `array` | `item` 指定每项字段模板；支持嵌套对象/数组，min/max 表示项数 |
| `group` | `fields`，无 key；只分组，不改变数据层级，可设置折叠属性 |

`group` 和 `object` 还支持以下布局属性：

| 属性 | 默认值 | 行为 |
| --- | --- | --- |
| `collapsible` | `false` | 是否显示标题右侧的折叠三角，并允许点击或用 Enter/空格切换 |
| `defaultCollapsed` | `false` | 首次渲染时是否折叠；设为 true 时必须同时启用 collapsible |

不可折叠分组始终展开。折叠状态仅属于当前页面，不写入 config.json，也不会改动草稿、默认值或完整校验规则。嵌套分组分别保存自己的展开状态；折叠内容不会进入键盘焦点顺序。可折叠标题保持 legend 对边框的自然截断，三角在折叠时朝右、展开时朝下。

收起动画先在 220ms 内缩小内容高度，再用 120ms 渐隐边框；展开先用 120ms 渐显边框，再在 220ms 内展开高度。快速反向点击从当前动画位置过渡，内容尺寸变化也会自动适配。系统开启减少动态效果时直接切换状态。

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

## 临时操作区

`panels` 声明独立操作区。每区拥有自己的临时字段和操作按钮，位置在该插件卡片的普通配置表单下方。字段仍使用相同的表单、分组、显隐与 label 对齐规则，支持对象、数组等完整字段树。搜索词、导入内容、编辑文档、列表结果和资源修订号都只存在于当前页面；普通“保存”“恢复默认值”“取消修改”不影响它们。操作也不会调用配置保存、触发 `handle.watch` 或要求重载插件。离开页面后临时状态丢弃。

模板中只有 JSON 声明；宿主代码在 `register()` 返回的句柄上注册函数。操作 ID 在同一模板内唯一。没有处理器的按钮禁用，未注册的操作不能通过 HTTP 调用。

```ts
import { ConfigError, defineConfig } from '@dsh-plugin/dsh-loader/config';

const handle = await ctx.dshLoader.config.register<{ models: string[] }>(ctx, defineConfig({
  id: 'document-plugin', packageName: '@example/documents', title: '文档',
  fields: [{ type: 'array', key: 'models', label: '可选模型', default: ['example-model'],
    item: { type: 'text', label: '模型 ID' } }],
  panels: [{ id: 'editor', title: '文档编辑', fields: [
    { type: 'text', key: 'query', label: '搜索词' },
    { type: 'select', key: 'documentId', label: '文档', optionsFrom: {
      operation: 'list', path: ['items'], label: ['title'], value: ['id'],
    } },
    { type: 'textarea', key: 'content', label: '文档内容' },
    { type: 'select', key: 'model', label: '模型', optionsFrom: { config: ['models'] } },
  ], operations: [
    { id: 'list', input: ['query'], readOnly: true, autoRun: true,
      button: { label: '搜索' }, result: [{ type: 'list', path: ['items'], label: ['title'] }] },
    { id: 'load', input: ['documentId'], readOnly: true, onChange: [['documentId']],
      button: { label: '重新加载' }, fill: [{ from: ['content'], to: ['content'] }],
      result: [{ type: 'json', title: '工具 Schema', path: ['schema'] }] },
    { id: 'save', input: ['documentId', 'content'], requiresRevision: true,
      button: { label: '保存文档', success: '文档已保存' }, refresh: ['list'] },
  ] }],
}));
handle.registerOperation('list', async ({ input, signal }) => ({
  value: { items: await repository.list(String(input.query), { signal }) },
}));
handle.registerOperation('load', async ({ input, signal }) => {
  const doc = await repository.read(String(input.documentId), { signal });
  return { value: { content: doc.content, schema: doc.toolSchema },
    resource: { id: doc.id, revision: doc.revision } };
});
handle.registerOperation('save', async ({ input, resource, config, signal }) => {
  // 同时验证资源 ID，并由仓库原子比较 revision 后写入。
  if (input.documentId !== resource!.id) throw new ConfigError('conflict', '请重新加载所选资源');
  const doc = await repository.save(resource!.id, String(input.content), {
    expectedRevision: resource!.revision, model: config.value.models[0], signal,
  });
  return { value: '已保存', resource: { id: doc.id, revision: doc.revision } };
});
```

处理器接收 `{ input, resource?, config, signal }`，返回 `{ value, resource? }`（可为 Promise）。`config` 是执行时已提交配置的宿主副本，包含其配置修订号；它不受页面未保存的配置草稿影响。宿主可以读取其中的密码，因此处理器应只返回需要展示的内容，不应回传密码。返回值必须为 JSON，禁止 JSX/函数。临时 password 字段可以输入新值，但不接受非空默认值（包括嵌套默认值）。

| 操作属性 | 行为 |
| --- | --- |
| `id` | 稳定标识，最长 100 字符，字母/数字起头，后续可用 `.`、`_`、`-` |
| `input?: string[]` | 从当前操作区选择要提交、校验的顶层 key；省略提交全部，`[]` 表示无输入。group 中的 key 仍在顶层，对象/数组整体提交 |
| `button?: { label, success? }` | 显示按钮及可选成功提示；省略时用于自动数据源 |
| `readOnly?: boolean` | 声明不产生写入；自动执行、变更触发和刷新目标必须为只读。插件负责遵守这一约定 |
| `autoRun?: boolean` | 页面挂载、可用处理器变更、订阅重连/更新时重新读取 |
| `onChange?: string[][]` | 当前操作区的字段路径；变化时调用操作，取消同一操作的旧读取 |
| `fill?: { from, to }[]` | 从返回 `value` 的路径回填到操作区草稿路径；只在成功、草稿未继续变化时应用 |
| `result?: ConfigResultDisplay[]` | 同一结果可用多个只读视图展示 |
| `refresh?: string[]` | 成功后刷新同区指定操作 ID；目标必须是无 fill 的只读操作，刷新不递归触发其他刷新 |
| `requiresRevision?: boolean` | 资源写操作必须携带已加载的 `{ id, revision }`，尚未加载时按钮禁用；不能与 readOnly 同用 |

`optionsFrom` 仅用于临时 select/multiselect，与静态 `options` 二选一。`{ operation, path?, label?, value? }` 读取同区只读操作的 `result.value` 中的数组；`{ config, label?, value? }` 读取当前已保存配置的数组。路径均为字符串数组，省略 label/value 表示数组项自身（字符串或数字值，label 为字符串）；对象数组通过路径取名称和标识。不允许绑定包含 password 的已保存配置数组。异步列表中的 ID 是否存在、是否有权限访问由处理器再次验证；已保存配置选项由 loader 在调用时校验，防止提交旧选项。刷新选项不会自动替换当前选择或正在编辑的文档。

`result` 每项支持 `type`、可选 `title` 和 `path`（相对于返回 value；省略表示根）：

- `text`：保留换行的只读文本。
- `markdown`：CommonMark 渲染，禁用原始 HTML，过滤危险链接；不接受插件渲染回调。
- `list`：只读列表；可用 `label` 路径显示对象项名称。
- `json`：默认折叠的 JSON 展示，可展开查看工具 Schema；没有 JSON 编辑框。

选择触发的加载会取消前一个请求，并检查响应顺序。请求期间继续输入时不覆盖草稿或更新其资源 revision。后台自动读取也不会覆盖正在编辑的内容。操作错误和字段校验错误显示在操作区，保留输入；刷新失败保留成功操作和原列表，另行显示刷新错误。操作运行期间显示处理中，禁用重复点击；同区资源写操作期间禁用输入和其他操作。可点击“取消操作”结束等待。

### 资源修订、长任务和清理

配置文件的 `revision` 与文档/工具等资源的 `resource.revision` 完全独立。读取操作返回 `{ resource: { id, revision } }` 后，loader 为该操作区记住版本；保存、删除声明 `requiresRevision: true`，会在 HTTP 请求中原样携带。成功返回新 resource 更新版本；删除可返回 `resource: null` 清除版本，并用 fill 清空选择/编辑器。

**处理器必须在实际资源存储中验证身份、权限与预期 revision，再原子写入/删除。** 版本不匹配时抛出 `new ConfigError('conflict', '资源已更新，请重新加载')`，桥接返回 HTTP 409，页面保留草稿和旧版本，不自动重试覆盖。loader 在单次注册内串行执行同一资源 ID 的写操作（保存和删除共用队列）；无资源操作按操作 ID 串行，其他资源的任务可以并行。资源 ID 应包含资源类别，避免不同资源共用同一 ID。跨进程或插件重装后的并发仍须由存储执行原子版本检查。

操作地址为 `POST /api/dshloader/config/<插件ID>/operations/<操作ID>`，请求 `{ input, resource? }`，响应 `{ ok: true, value: { value, resource? } }`；复用配置桥接的宿主认证、同源检查和 1 MiB 请求体上限。普通配置 API 与事件订阅保持原协议。操作结果不进入配置 SSE，不触发普通配置重读；仅执行声明的 refresh。数据源在订阅重连后重新获取。

操作通道不设置短请求超时，适用于首次模型下载等长任务。浏览器调用 `client.invoke(id, operation, request, signal?)` 可传入自己的 AbortSignal；页面离开、取消、客户端 dispose、处理器注销、插件卸载和桥接关闭都会终止相关请求并向宿主 signal 发出取消。**处理器须把 signal 传给下载/文件/网络 IO，并在提交副作用前检查取消**；loader 无法撤销处理器已完成的外部写入，也无法强停忽略 signal 的代码。卸载后的迟到结果会被丢弃。

完整可运行模板和处理器见 [配置示例](../examples/config-plugin/index.mjs) 与 [操作示例](../examples/config-plugin/operations.mjs)：包含搜索、选择回填、导入草稿、Markdown 预览、带 revision 的保存/删除、只读工具 Schema 和可取消的模拟下载。模拟下载不访问真实模型服务，示例文档保存在内存。
