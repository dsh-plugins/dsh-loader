# Responses 声明投影

`loader.llm.registerResponsesToolAdditions(owner, project)` 将插件拥有的持久化声明在 Responses HTTP 请求的原消息位置替换为 `additional_tools`，不更改顶层 `tools`。

回调同步读取 `provider`、`model`、`sessionId`、`purpose`、`messages` 和 `signal`。未命中路由或会话时返回 `undefined`；命中时返回按消息顺序排列的 `ResponsesToolAdditionRecord[]`。注册返回幂等清理函数，并绑定 `owner.effect`。调用方须声明 `llm` 依赖。

```ts
interface ResponsesToolAdditionRecord {
  messageId: string
  sourceKind: string
  text: string
  addition: {
    version: 1
    id: string
    tools: readonly {
      type: 'function'
      name: string
      description: string
      parameters: Readonly<Record<string, unknown>>
      strict: false
    }[]
  }
}
```

持久化消息须由插件调用宿主 `createUserMessage` 构造，满足以下约定：

- `id` 对应 `messageId`，`role` 为 `user`，`source.kind` 等于 `sourceKind`。
- `source.responsesToolAddition` 保存完整 `addition`，版本、字段顺序和定义与回调快照一致。
- `content` 仅含一个 `text` 块，与返回的 `text` 完全相同；正文包含且仅包含一次 `[dsh-responses-tools:<id>]`。标识限 1–128 个英文字母、数字、下划线或连字符，推荐 UUID。
- 一次请求中消息 ID 和声明 ID 唯一。重复标识即使出现在其它来源的文本中，也会使请求失败。

转换只接受一个对应的 Responses `user` input 项，其 content 为原始字符串或单个 `input_text` 块。适配器若合并、拆分、丢弃或改写该消息，接口会报告映射诊断，不猜测声明位置。普通用户文本中的 JSON 从不作为工具来源。

默认替换项为 `{type: 'additional_tools', role: 'developer', tools: addition.tools}`，其余 input 项、调用 ID、顺序和请求参数保持不变。

调用 `loader.llm.registerResponsesToolAdditions(owner, project, { preferTopLevel: true })` 时，loader 先完整校验原记录，再按实际 HTTP 请求顶层 `tools` 中的函数名称过滤同名追加项。批次仍有其他工具时保持原位置；没有剩余工具时省略该项。顶层 `tools` 和持久化历史均不修改。调用插件可检查 `loader.llm.responsesToolAdditionsPreferTopLevel === true` 确认当前版本支持此选项。

单次 `llm/stream` 的转换状态独立保存。原始请求和顶层函数名集合未变化的已转换请求均可重复处理；若重试更改了顶层函数名集合，必须重新提供原始 input。

请求作用域覆盖异步迭代器的 `next`、`return`、`throw`，fetch 通过现有补丁链注册。卸载先取消活动请求，待迭代器结束后还原补丁，阻止 SDK 重试越过转换。HTTP 错误保留状态码并补充原生策略诊断，不触发顶层声明回退。

此接口不实现 `tool_search_output`，也不实现 WebSocket 或 Chat Completions。路由准入由调用插件决定；不能只凭模型名判断端点支持该协议。辅助请求、工具执行权限与实际工具注册也由调用方及宿主负责。

配套宿主接口位于 `loader.dsh.tools`：`defineTool`、`projectToolSchema`、`ToolContextUnavailableError`、`ToolExecutionPipeline`、`executeToolBatch`。这些符号从宿主预加载，缺失时明确报错；不在附属插件复制参数校验、权限或审批实现。
