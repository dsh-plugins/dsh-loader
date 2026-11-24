import type { ComponentType, ReactNode } from 'react';
import { cordisRoot, createSessionAdapter, type SessionClientContext } from './adapters/session-client.js';

/** 可观察的官方会话状态，供扩展订阅运行状态与草稿变化。 */
export interface SessionObservable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** 发送接口支持的附件格式；旧消息的附件由服务端按原始下标保留。 */
export type SessionPromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }
  | { type: 'file'; receiptId: string }
  | { type: 'retained'; index: number };

/** 官方输入系统持有的浏览器附件，释放前可重复序列化。 */
export interface SessionDraftAttachment {
  id: string;
  kind: 'image' | 'file';
  file: File;
  previewUrl?: string;
}

/** 撤回附件的下载信息；下载地址必须来自同源授权接口。 */
export interface SessionRestoredAttachment {
  name: string;
  mediaType?: string;
  url?: string;
  data?: string;
}

/** 消息扩展只取得公开渲染参数中的身份与内容。 */
export interface SessionMessageProps {
  sessionId: string;
  messageId: string;
  role: 'user' | 'assistant';
  content: readonly Record<string, unknown>[];
  original: ReactNode;
}

/** 完整包裹官方消息组件，可在编辑期间替换正文并追加同级版本导航。 */
export interface SessionMessageExtension {
  id: string;
  Message: ComponentType<SessionMessageProps>;
  /** 截断轮次有处理内容时使用这组标题，无内容时省略提示。 */
  forkedTurnLabels?: { label: string; duration: string };
}

/** 插件使用的会话客户端能力，官方版本差异集中在 adapter 中。 */
export interface SessionClient {
  registerMessageExtension(extension: SessionMessageExtension): () => void;
  registerAssistantActions(id: string, component: ComponentType<{ sessionId: string; messageId: string }>): () => void;
  registerComposerDock(id: string, component: ComponentType<{ sessionId: string }>): () => void;
  registerHeaderAction(id: string, component: ComponentType<{ sessionId: string }>): () => void;
  session(sessionId: string): SessionObservable<{ running: boolean }>;
  createAttachments(sessionId: string, files: readonly File[]): readonly SessionDraftAttachment[];
  serializeAttachments(ids: readonly string[]): Promise<readonly SessionPromptPart[]>;
  releaseAttachment(id: string): void;
  restoreDraft(sessionId: string, draft: { text: string; attachments: readonly SessionRestoredAttachment[] }): Promise<void>;
  refreshHistory(sessionId: string): Promise<void>;
  dispose(): void;
}

export const SESSION_CLIENT_SERVICE = 'dshLoaderSessionClient';
const wrappedPlugins = new WeakMap<object, object>();

/** 创建会话扩展接口；必须在官方 Chat 注册 renderer 前调用。 */
export function createSessionClient(ctx: SessionClientContext): SessionClient {
  return createSessionAdapter(ctx);
}

/** 在官方 Chat apply 的上下文中安装接口，使原始 child-slot 授权随注册保留。 */
export function installSessionClient(ctx: SessionClientContext): SessionClient {
  const root = ctx[cordisRoot] ?? ctx;
  const existing = root.get(SESSION_CLIENT_SERVICE) as SessionClient | undefined;
  if (existing) {
    return existing;
  }
  if (!root.provide) {
    throw new Error('[dsh-loader] 会话扩展需要根上下文的 provide 接口。');
  }
  const client = createSessionClient(root);
  root.provide(SESSION_CLIENT_SERVICE, client);
  root.effect?.(() => () => { client.dispose(); });
  return client;
}

/** 从当前 Cordis 根上下文取得已安装的会话扩展接口。 */
export function getSessionClient(ctx: SessionClientContext): SessionClient | undefined {
  return (ctx[cordisRoot] ?? ctx).get(SESSION_CLIENT_SERVICE) as SessionClient | undefined;
}

/** 在模块工厂返回官方 Chat 插件时包装其公开 apply，保证安装顺序。 */
export function wrapSessionChatPlugin<T extends { apply(ctx: SessionClientContext, ...args: unknown[]): unknown }>(plugin: T): T {
  const existing = wrappedPlugins.get(plugin);
  if (existing) {
    return existing as T;
  }
  const wrapped: T = {
    ...plugin,
    apply(ctx: SessionClientContext, ...args: unknown[]): unknown {
      installSessionClient(ctx);
      return plugin.apply(ctx, ...args);
    },
  };
  wrappedPlugins.set(plugin, wrapped);
  wrappedPlugins.set(wrapped, wrapped);
  return wrapped;
}
