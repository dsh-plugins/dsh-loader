/** 将可信的持久化声明映射到 Responses input，保持历史位置和顶层参数不变。 */
export interface ResponsesFunctionTool {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly strict: false;
}

/** 与消息共同持久化的版本化声明，供恢复和重放使用。 */
export interface ResponsesToolAddition {
  readonly version: 1;
  readonly id: string;
  readonly tools: readonly ResponsesFunctionTool[];
}

/** 将可信消息身份、完整正文和结构化声明绑定为同一投影记录。 */
export interface ResponsesToolAdditionRecord {
  readonly messageId: string;
  readonly sourceKind: string;
  readonly text: string;
  readonly addition: ResponsesToolAddition;
}

/** 仅暴露公共请求信息，路由匹配无需读取适配器私有字段。 */
export interface ResponsesToolRequest {
  readonly provider: string;
  readonly model: string;
  readonly sessionId?: string;
  readonly purpose?: string;
  readonly messages: readonly unknown[];
  readonly signal?: AbortSignal;
}

/** 返回本插件拥有的声明；undefined 表示此请求不参与转换。 */
export type ResponsesToolProjector = (request: ResponsesToolRequest) => readonly ResponsesToolAdditionRecord[] | undefined;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** 标识只用于精确定位已验证消息，不从标识附近推断 schema。 */
export function responsesToolMarker(id: string): string {
  return `[dsh-responses-tools:${id}]`;
}

function fail(reason: string): never {
  throw new Error(`dsh-loader: Responses additional_tools 映射失败：${reason}`);
}

function count(text: string, marker: string): number {
  return text.split(marker).length - 1;
}

function markerCounts(value: unknown): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [marker] of JSON.stringify(value).matchAll(/\[dsh-responses-tools:[a-zA-Z0-9_-]{1,128}\]/g)) { counts.set(marker, (counts.get(marker) ?? 0) + 1); }
  return counts;
}

function contentText(value: unknown, type: string): string | undefined {
  if (!Array.isArray(value) || value.length !== 1) { return undefined; }
  const block = object(value[0]);
  return block?.type === type && typeof block.text === 'string' ? block.text : undefined;
}

/** 每次 llm/stream 独享一份映射；重试复用已验证的 input，不能跨请求继承。 */
export class ResponsesToolProjection {
  private readonly records: readonly ResponsesToolAdditionRecord[];
  private readonly projectedInputs = new Set<string>();

  /** 快照并验证可信来源，后续重试不再读取可变插件状态。 */
  constructor(messages: readonly unknown[], records: readonly ResponsesToolAdditionRecord[]) {
    this.records = structuredClone(records);
    const ids = new Set<string>();
    const messageIds = new Set<string>();
    const markers = markerCounts(messages);
    const byId = new Map<unknown, Record<string, unknown>>();
    const duplicateIds = new Set<unknown>();
    for (const value of messages) {
      const message = object(value);
      if (!message) { continue; }
      if (byId.has(message.id)) { duplicateIds.add(message.id); }
      byId.set(message.id, message);
    }
    for (const record of this.records) {
      const { addition, messageId, sourceKind, text } = record;
      if (addition.version !== 1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(addition.id)) { fail('声明版本或标识无效'); }
      if (ids.has(addition.id) || messageIds.has(messageId)) { fail(`重复声明 ${addition.id}`); }
      ids.add(addition.id);
      messageIds.add(messageId);
      const message = byId.get(messageId);
      const source = object(message?.source);
      if (duplicateIds.has(messageId) || message?.role !== 'user' || source?.kind !== sourceKind
        || JSON.stringify(source.responsesToolAddition) !== JSON.stringify(addition)
        || contentText(message.content, 'text') !== text) { fail(`来源或完整内容不匹配 ${addition.id}`); }
      const marker = responsesToolMarker(addition.id);
      if (count(text, marker) !== 1 || markers.get(marker) !== 1) { fail(`声明标识缺失或重复 ${addition.id}`); }
      const names = new Set<string>();
      if (!Array.isArray(addition.tools) || !addition.tools.length) { fail(`空声明 ${addition.id}`); }
      for (const tool of addition.tools) {
        if (tool.type !== 'function' || !tool.name || typeof tool.description !== 'string'
          || !object(tool.parameters) || tool.strict !== false || names.has(tool.name)) { fail(`工具定义无效 ${addition.id}`); }
        names.add(tool.name);
      }
    }
  }

  /** 原位置替换声明，保留其它参数；已验证的输出允许原样重试。 */
  rewrite(body: string): string {
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return fail('请求体不是 JSON'); }
    const request = object(parsed);
    if (!request || !Array.isArray(request.input)) { fail('Responses 请求缺少 input 数组'); }
    const inputKey = JSON.stringify(request.input);
    if (this.projectedInputs.has(inputKey)) { return body; }
    const input = [...request.input];
    const markers = markerCounts(input);
    const positions = new Map<string, number>();
    input.forEach((value, index) => {
      const message = object(value);
      if (message?.role !== 'user' || (message.type !== undefined && message.type !== 'message')) { return; }
      const text = typeof message.content === 'string' ? message.content : contentText(message.content, 'input_text');
      if (text !== undefined) { positions.set(text, index); }
    });
    let previousIndex = -1;
    for (const record of this.records) {
      const marker = responsesToolMarker(record.addition.id);
      if (markers.get(marker) !== 1) { fail(`input 标识缺失或重复 ${record.addition.id}`); }
      const index = positions.get(record.text);
      if (index === undefined || index <= previousIndex) { fail(`input 内容或顺序不匹配 ${record.addition.id}`); }
      previousIndex = index;
      input[index] = { type: 'additional_tools', role: 'developer', tools: record.addition.tools };
    }
    this.projectedInputs.add(JSON.stringify(input));
    return JSON.stringify({ ...request, input });
  }
}
