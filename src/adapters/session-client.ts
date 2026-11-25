import { createElement, Fragment, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import type { SessionClient, SessionDraftAttachment, SessionMessageExtension, SessionMessageProps, SessionObservable, SessionPromptPart, SessionRestoredAttachment } from '../session-client.js';

interface SlotOptions {
  name: string;
  key?: string;
  id?: string;
  order?: number;
  [key: string]: unknown;
}
interface Slots {
  register(options: SlotOptions, component: ComponentType<RendererProps>): () => void;
  inject(name: string, callback: () => (() => void)): () => void;
  entries(name: string): readonly { options: { key?: string } }[];
}
interface RendererProps {
  sessionId: string;
  messageId?: string;
  turnProcess?: { hasContent: boolean };
  t?: (key: string, ...args: unknown[]) => string;
  node?: {
    kind: string;
    location?: { kind: string; turn?: { end?: { data: { reason: { kind: string } } } } };
    data: {
      messageId?: string;
      content?: readonly Record<string, unknown>[];
      finalNode?: { messageId?: string; blocks?: readonly Record<string, unknown>[] };
    };
  };
  [key: string]: unknown;
}
/** rc.1 的具体 Session 公开 resync，用于日志分支替换后重建事件流。 */
interface SessionFace extends SessionObservable<{
  running: boolean;
  removed: boolean;
  subagent?: unknown;
  openState: 'cold' | 'loading' | 'open' | 'error';
  openError: { message?: string } | null;
}> {
  resync(): Promise<void>;
}
interface InputFace {
  state: SessionObservable<{ draft: string; draftRev: number; phase: string; attachmentIds: readonly string[]; occurrences: readonly unknown[]; claim?: unknown }>;
  setDraft(text: string): void;
  addAttachments(ids: readonly string[]): boolean;
  removeAttachment(id: string): boolean;
  focus(): void;
}
interface ConversationFace {
  input: { for(scope: unknown): InputFace };
  createDrafts(sessionId: string, files: readonly File[], uploadImages: boolean): readonly SessionDraftAttachment[];
  serializeDraftAttachments(ids: readonly string[]): Promise<{ attachments: readonly SessionPromptPart[] }>;
  releaseDraftAttachment(id: string): void;
}
interface SessionsFace {
  scope(sessionId: string): unknown;
  binding(sessionId: string): { session: SessionFace } | undefined;
  refresh(): Promise<void>;
  refreshProjections(sessionId: string): Promise<void>;
  /** rc.1 公开的控制基线重建入口，清除旧投影序列水位。 */
  handleConnected(): void;
}

export const cordisRoot = Symbol.for('cordis.root');

/** 仅依赖 Cordis 的公开服务读取与生命周期入口。 */
export interface SessionClientContext {
  readonly [cordisRoot]?: SessionClientContext;
  readonly root?: SessionClientContext;
  get(name: string): unknown;
  provide?(name: string, value: unknown): unknown;
  effect?(effect: () => (() => void)): unknown;
}

/** 用公开注册方法包装官方消息 renderer，保留其所有注入参数与子槽声明。 */
export function createSessionAdapter(ctx: SessionClientContext): SessionClient {
  const slots = ctx.get('slots') as Slots | undefined;
  if (!slots) {
    throw new Error('[dsh-loader] 会话扩展需要 slots 服务。');
  }
  const messageKeys = new Set(['user', 'steering', 'assistant-step']);
  if (slots.entries('conversation.chat.node').some(entry => messageKeys.has(entry.options.key ?? ''))) {
    throw new Error('[dsh-loader] 会话扩展必须通过官方 Chat 模块的 apply 包装提前安装。');
  }
  let extensions: readonly SessionMessageExtension[] = [];
  const listeners = new Set<() => void>();
  const disposers = new Set<() => void>();
  let disposed = false;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const getExtensions = () => extensions;
  const publish = () => { for (const listener of listeners) { listener(); } };
  const originalRegister = slots.register;
  function register(this: Slots, options: SlotOptions, Component: ComponentType<RendererProps>): () => void {
    if (options.name !== 'conversation.chat.node' || (!messageKeys.has(options.key ?? '') && options.key !== 'turn-process')) {
      return originalRegister.call(this, options, Component);
    }
    function Message(props: RendererProps): ReactNode {
      const registered = useSyncExternalStore(subscribe, getExtensions, getExtensions);
      const node = props.node;
      if (node?.kind === 'turn-process' && node.location?.turn?.end?.data.reason.kind === 'forked') {
        const labels = registered.find(extension => extension.forkedTurnLabels)?.forkedTurnLabels;
        if (labels && props.turnProcess?.hasContent === false) {
          return null;
        }
        if (labels && props.t) {
          const translate = props.t;
          return createElement(Component, { ...props, t: (key: string, ...args: unknown[]) => {
            if (key === 'message.turnProcess.worked') {
              return labels.label;
            }
            if (key === 'message.turnProcess.took') {
              return labels.duration;
            }
            return translate(key, ...args);
          } });
        }
      }
      const assistant = node?.kind === 'assistant-step';
      const messageId = assistant ? node?.data.finalNode?.messageId : node?.data.messageId;
      let rendered: ReactNode = createElement(Component, props);
      if (!messageId || (assistant && props.groupPart === 'reasoning')) {
        return rendered;
      }
      for (const extension of registered) {
        rendered = createElement(extension.Message, {
          sessionId: props.sessionId,
          messageId,
          role: assistant ? 'assistant' : 'user',
          content: assistant ? node?.data.finalNode?.blocks ?? [] : node?.data.content ?? [],
          original: rendered,
        } satisfies SessionMessageProps);
      }
      return createElement(Fragment, null, rendered);
    }
    return originalRegister.call(this, options, Message);
  }
  slots.register = register;

  function service<T>(name: string): T {
    const value = ctx.get(name);
    if (!value) {
      throw new Error(`[dsh-loader] 会话扩展缺少 ${name} 服务。`);
    }
    return value as T;
  }
  function input(sessionId: string): InputFace {
    const scope = service<SessionsFace>('sessions').scope(sessionId);
    if (!scope) {
      throw new Error('目标会话已关闭，请重新打开会话。');
    }
    return service<ConversationFace>('conversation').input.for(scope);
  }
  function session(sessionId: string): SessionFace {
    const binding = service<SessionsFace>('sessions').binding(sessionId);
    if (!binding) {
      throw new Error('目标会话已关闭，请重新打开会话。');
    }
    return binding.session;
  }
  function registerList(name: string, id: string, component: ComponentType<RendererProps>): () => void {
    const off = slots!.inject(name, () => slots!.register({ name, id, order: 90 }, component));
    const release = () => { off(); disposers.delete(release); };
    disposers.add(release);
    return release;
  }
  function createAttachments(sessionId: string, files: readonly File[]): readonly SessionDraftAttachment[] {
    return service<ConversationFace>('conversation').createDrafts(sessionId, files, !session(sessionId).getSnapshot().subagent);
  }
  async function readFile(attachment: SessionRestoredAttachment): Promise<File> {
    if (attachment.data !== undefined) {
      const binary = atob(attachment.data);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new File([bytes], attachment.name, { type: attachment.mediaType ?? 'application/octet-stream' });
    }
    if (!attachment.url) {
      throw new Error(`附件 ${attachment.name} 缺少授权下载地址，已保留撤回内容，请重试恢复草稿。`);
    }
    const url = new URL(attachment.url, location.href);
    if (url.origin !== location.origin) {
      throw new Error('撤回附件下载地址必须与当前应用同源。');
    }
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) {
      throw new Error(`附件 ${attachment.name} 下载失败（${response.status}）。`);
    }
    return new File([await response.blob()], attachment.name, { type: attachment.mediaType ?? response.headers.get('Content-Type') ?? 'application/octet-stream' });
  }
  return {
    registerMessageExtension(extension) {
      if (disposed || extensions.some(item => item.id === extension.id)) {
        throw new Error(`消息扩展 ${extension.id} 已存在或接口已卸载。`);
      }
      extensions = [...extensions, extension];
      publish();
      return () => {
        extensions = extensions.filter(item => item !== extension);
        publish();
      };
    },
    registerAssistantActions(id, component) {
      return registerList('conversation.chat.assistant-actions', id, component as ComponentType<RendererProps>);
    },
    registerComposerDock(id, component) {
      return registerList('conversation.composer.dock', id, component as ComponentType<RendererProps>);
    },
    registerHeaderAction(id, component) {
      return registerList('conversation.session.header.actions', id, component as ComponentType<RendererProps>);
    },
    session,
    createAttachments,
    async serializeAttachments(ids) {
      return (await service<ConversationFace>('conversation').serializeDraftAttachments(ids)).attachments;
    },
    releaseAttachment(id) {
      service<ConversationFace>('conversation').releaseDraftAttachment(id);
    },
    async restoreDraft(sessionId, draft) {
      const target = input(sessionId);
      const before = target.state.getSnapshot();
      if (!['plain', 'claimed'].includes(before.phase)) {
        throw new Error('输入框正在发送，请完成后重试恢复草稿。');
      }
      if (before.occurrences.length > 0 || before.claim) {
        throw new Error('当前输入框含引用或命令，请先处理当前草稿，再恢复已撤回的消息。');
      }
      const files = await Promise.all(draft.attachments.map(readFile));
      const after = target.state.getSnapshot();
      if (after.draftRev !== before.draftRev || after.phase !== before.phase || after.attachmentIds !== before.attachmentIds) {
        throw new Error('下载附件期间草稿已变化，请重试恢复，避免覆盖新输入。');
      }
      const attachments = createAttachments(sessionId, files);
      if (!target.addAttachments(attachments.map(attachment => attachment.id))) {
        for (const attachment of attachments) {
          service<ConversationFace>('conversation').releaseDraftAttachment(attachment.id);
        }
        throw new Error('输入框正在发送，请完成后重试恢复草稿。');
      }
      target.setDraft([after.draft, draft.text].filter(Boolean).join('\n\n'));
      target.focus();
    },
    async refreshHistory(sessionId) {
      const target = session(sessionId);
      if (target.getSnapshot().removed) {
        throw new Error('宿主已注销当前会话实例，请重新打开会话以加载新实例。');
      }
      const sessions = service<SessionsFace>('sessions');
      // 分支替换会回退事件序号，先撤销旧投影水位再接收新历史基线。
      sessions.handleConnected();
      await Promise.all([
        sessions.refresh(),
        sessions.refreshProjections(sessionId),
        target.resync(),
      ]);
      const snapshot = target.getSnapshot();
      if (snapshot.removed) {
        throw new Error('宿主已注销当前会话实例，请重新打开会话以加载新实例。');
      }
      if (snapshot.openState === 'error') {
        throw new Error(`会话历史刷新失败：${snapshot.openError?.message ?? '无法读取新分支历史'}`);
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (slots!.register === register) {
        slots!.register = originalRegister;
      }
      for (const release of [...disposers]) {
        release();
      }
      extensions = [];
      publish();
      listeners.clear();
    },
  };
}
