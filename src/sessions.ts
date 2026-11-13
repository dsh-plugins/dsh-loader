/** 为插件提供版本隔离的会话读写、排他操作和待发送消息生命周期。 */
import type { CordisContext } from './types.js';
import { createSessionHost } from './adapters/session-host.js';

/** 官方会话日志的完整逻辑快照，不暴露存储编码。 */
export interface SessionSnapshot {
  header: Record<string, unknown>;
  events: Record<string, unknown>[];
  inheritedEventCount: number;
}

/** 已排队或已领取、尚未送入模型的消息。 */
export interface SessionPendingMessage {
  id: string;
  message: Record<string, unknown>;
  state: 'queued' | 'claimed';
  target: 'next-turn' | 'next-step';
}

/** captured 表示 loader 持有可以安全重建此 Agent 的公开生命周期句柄。 */
export interface SessionStatus {
  busy: boolean;
  captured: boolean;
  pending: SessionPendingMessage[];
}

/** 会话变更在操作成功后发布；error 通知保留明确的失败对象。 */
export type SessionChange =
  | { type: 'event'; sessionId: string; event: Record<string, unknown> }
  | { type: 'status' | 'pending' | 'replaced'; sessionId: string; status: SessionStatus }
  | { type: 'error'; sessionId: string; error: unknown };

/** 只在 runExclusive 回调执行期间有效，不能保存到回调外使用。 */
export interface SessionExclusive {
  read(): Promise<SessionSnapshot>;
  replace(snapshot: SessionSnapshot): Promise<void>;
  prompt(content: Record<string, unknown>[]): Promise<void>;
  /** 校验编辑输入并生成稳定消息身份；retained 只引用原消息中的附件。 */
  admitEdit(originalMessage: Record<string, unknown>, parts: Record<string, unknown>[]): Promise<Record<string, unknown>>;
  /** 仅接受宿主从已验证日志或 admitEdit 构造的完整消息，保留其身份和附件。 */
  sendMessage(message: Record<string, unknown>): Promise<void>;
  /** 无新增用户文本地请求助手续答。 */
  retry(operationId?: string): Promise<void>;
}

/** 宿主内部模块由当前版本 adapter 装载，附属插件不引用上游私有模块。 */
export interface SessionsOptions {
  version?: string;
  importModule?: (specifier: string) => Promise<Record<string, unknown>>;
  modules?: { agent?: Record<string, unknown>; llm?: Record<string, unknown>; session?: Record<string, unknown>; catalog?: Record<string, unknown>; controller?: Record<string, unknown>; cordis?: Record<string, unknown> };
}

/** 所有破坏性历史操作必须取得会话排他权，忙碌 Agent 只允许撤回尚未发送的消息。 */
export interface SessionsAPI {
  readonly ready: Promise<void>;
  read(sessionId: string): Promise<SessionSnapshot>;
  status(sessionId: string): SessionStatus;
  watch(listener: (change: SessionChange) => void, sessionId?: string): () => void;
  runExclusive<T>(sessionId: string, operation: (session: SessionExclusive) => Promise<T>): Promise<T>;
  prompt(sessionId: string, content: Record<string, unknown>[]): Promise<void>;
  retry(sessionId: string, operationId?: string): Promise<void>;
  recallPending(sessionId: string, messageIds: string[]): Promise<SessionPendingMessage[]>;
  dispose(): void;
}

/** 稳定错误码便于调用方区分忙碌、需要重启以及存储失败。 */
export class SessionHostError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SessionHostError';
  }
}

/** 创建 facade 并立即安装生命周期捕获；调用方应在宿主初始化时等待 ready。 */
export function createSessionsAPI(ctx: CordisContext, options: SessionsOptions = {}): SessionsAPI {
  return createSessionHost(ctx, options);
}
