/** 将 0.2.2 的公开生命周期、消息入口与最终模型发送边界封装在宿主侧。 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { CordisContext } from '../types.js';
import { ownedScope } from '../lifecycle.js';
import { patchSlot } from '../patch.js';
import {
  SessionHostError, type SessionsAPI, type SessionsOptions, type SessionSnapshot,
  type SessionPendingMessage, type SessionStatus, type SessionChange, type SessionExclusive,
} from '../sessions.js';
import { encodeSessionSnapshot, readStoredSession, replaceStoredSession, type SessionCodec, type SessionPersistence } from './session-storage.js';

type RecordValue = Record<string, unknown>;
interface Message extends RecordValue { id: string; role: string; content: RecordValue[]; source: RecordValue }
interface Session {
  id: string;
  header: RecordValue;
  inheritedEventCount: number;
  snapshotEvents(): readonly RecordValue[];
  eventAt(seq: number): RecordValue | undefined;
  append(type: string, data: RecordValue, ...options: RecordValue[]): RecordValue;
}
interface SessionStore { flush(session: Session): Promise<void> }
interface FileUploads {
  resolve(agent: Agent, receiptId: string): RecordValue | undefined;
  retirePrompt(agent: Agent, requestId: string): void;
}
interface Attachments { admitPromptContent(content: RecordValue[]): Promise<RecordValue[]> }
interface Inbox {
  readonly nextTurn: readonly Message[];
  readonly nextStep: readonly Message[];
  clear(): void;
  append(target: Target, message: Message): void;
  prepend(target: Target, message: Message): void;
  replace(id: string, message: Message): boolean;
  remove(id: string): boolean;
  splice(target: Target, start: number, deleteCount: number, inserted: Message[]): Message[];
}
interface Agent {
  id: string;
  session: Session;
  status: 'idle' | 'running';
  options: RecordValue;
  model: { current(): RecordValue | undefined; select(selection: RecordValue): void };
  inbox: Inbox;
  send(message: Message, target: Target, wakeup: boolean): void;
  followup(message: Message): void;
  steer(message: Message): void;
  inject(message: Message): void;
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
interface Handle { agent: Agent; dispose(): Promise<void> }
interface SetupCommit { commit(): void }
type AgentSetup = (ctx: CordisContext, agent: Agent) => SetupCommit | void | Promise<SetupCommit | void>;
interface Registry {
  get(id: string): Agent | undefined;
  list(): Agent[];
  create(options: RecordValue): Promise<Handle>;
  resume(options: RecordValue): Promise<Handle>;
}
interface Controller {
  resolveAgent(id: string): Promise<{ agent: Agent } | { error: Error }>;
  prompt(request: { sessionId: string; requestId: string; content: RecordValue[] }, signal: AbortSignal): Promise<unknown>;
}
interface Request extends RecordValue { sessionId?: string; messages: readonly Message[] }
interface Prepared extends RecordValue { stream(request: Request): AsyncIterable<unknown> }
interface Llm {
  prepareCall(config: RecordValue, signal?: AbortSignal, configure?: unknown): Promise<Prepared>;
  stream(request: Request): AsyncIterable<unknown>;
  resolveModelInfo(provider: string, model: string): Promise<{ inputModalities?: string[] }>;
}
interface AgentModule { AgentRegistry: { prototype: Registry } }
interface ControllerModule { SessionController: { prototype: Controller } }
interface EventBus { emit(...args: unknown[]): void }
interface CordisModule { EventsService: { prototype: EventBus } }
interface ReplacementNotice { publishRemoval?: () => void }
interface LlmModule {
  LlmRuntime: { prototype: Llm };
  createUserMessage(input: { content: RecordValue[]; source: RecordValue }): Message;
  freezeMessage(message: Message): Message;
  markAgentLoopRequest<T extends Request>(request: T): T;
  isAgentLoopRequest(request: Request): boolean;
}
interface SessionModule {
  appendPluginRecord(session: Session, type: string, data: RecordValue): number;
  buildForkSeed(events: readonly RecordValue[], boundary: number): RecordValue[];
}
type Target = 'next-turn' | 'next-step';
interface Tracked { message: Message; state: 'queued' | 'claimed'; target: Target }
interface Capture { handle: Handle; receiver: Registry; options: RecordValue; bridge: Handle }
interface State {
  captured?: Capture;
  agent?: Agent;
  pending: Map<string, Tracked>;
  revoked: Set<string>;
  retry: Set<string>;
  batches: Set<Message[]>;
  maintenance: number;
  releases: (() => void)[];
}
interface Lease { sessionId: string; active: boolean; writesExclusive: boolean }

/** 只使用公开服务方法和构造函数原型；所有上游差异集中于本模块。 */
export function createSessionHost(ctx: CordisContext, options: SessionsOptions): SessionsAPI {
  const resources = ownedScope(ctx);
  const states = new Map<string, State>();
  const listeners = new Set<{ listener: (change: SessionChange) => void; sessionId?: string }>();
  const locks = new Map<string, Lease>();
  const queues = new Map<string, Promise<void>>();
  const replacements = new Map<string, ReplacementNotice>();
  const operation = new AsyncLocalStorage<Lease>();
  let agentModule: AgentModule;
  let llmModule: LlmModule;
  let sessionModule: SessionModule;
  let codec: SessionCodec;
  let disposed = false;

  function requireService<T>(name: string): T {
    const value = ctx.get(name) as T | undefined;
    if (!value) {
      throw new SessionHostError('HOST_UNAVAILABLE', `宿主缺少 ${name} 服务。`);
    }
    return value;
  }
  const registry = () => requireService<Registry>('agents');
  const persistence = () => requireService<SessionPersistence>('sessionPersistence');
  const controller = () => requireService<Controller>('sessionController');
  const flush = (session: Session) => requireService<SessionStore>('sessions').flush(session);

  function stateFor(id: string): State {
    let state = states.get(id);
    if (!state) {
      state = { pending: new Map(), revoked: new Set(), retry: new Set(), batches: new Set(), maintenance: 0, releases: [] };
      states.set(id, state);
    }
    return state;
  }
  function assertOpen(): void {
    if (disposed || resources.disposed) {
      throw new SessionHostError('DISPOSED', '会话适配器已经卸载。');
    }
  }
  function assertEntry(id: string): void {
    assertOpen();
    const lock = locks.get(id);
    if (lock?.writesExclusive && (operation.getStore() !== lock || !lock.active)) {
      throw new SessionHostError('SESSION_LOCKED', `会话 ${id} 正在修改历史，请稍后重试。`);
    }
  }
  function status(id: string): SessionStatus {
    const state = states.get(id);
    const agent = registry().get(id);
    return {
      busy: agent?.status === 'running' || (state?.maintenance ?? 0) > 0,
      captured: Boolean(agent && state?.captured?.handle.agent === agent),
      pending: state ? [...state.pending.values()]
        .filter(item => !state.revoked.has(item.message.id) && !state.retry.has(item.message.id))
        .map(item => structuredClone({ id: item.message.id, message: item.message, state: item.state, target: item.target })) : [],
    };
  }
  function emit(change: SessionChange): void {
    for (const subscription of listeners) {
      if (subscription.sessionId !== undefined && subscription.sessionId !== change.sessionId) {
        continue;
      }
      try {
        subscription.listener(change);
      } catch (error) {
        ctx.logger?.error?.(`会话 ${change.sessionId} 的变更监听器失败。`, error);
      }
    }
  }
  function changed(id: string, type: 'status' | 'pending' | 'replaced'): void {
    emit({ type, sessionId: id, status: status(id) });
  }
  function assertIdle(id: string): void {
    if (status(id).busy) {
      throw new SessionHostError('SESSION_BUSY', '会话正在运行，请等待完成或手动停止后再修改历史。');
    }
  }
  function requireCapture(agent: Agent): Capture {
    const capture = stateFor(agent.id).captured;
    if (!capture || capture.handle.agent !== agent) {
      throw new SessionHostError('HOST_RESTART_REQUIRED', '该会话的生命周期句柄未被 loader 捕获，请重启宿主后再操作。');
    }
    return capture;
  }
  function patch<T>(target: object, key: PropertyKey, wrap: (original: T) => T, releases?: (() => void)[]): void {
    const handle = patchSlot<T>(target, key, wrap);
    const release = resources.add(() => handle.dispose());
    releases?.push(release);
  }
  function record(session: Session, type: string, data: RecordValue): RecordValue {
    const seq = sessionModule.appendPluginRecord(session, `plugin:dsh-loader/${type}`, data);
    const event = session.eventAt(seq);
    if (!event) {
      throw new SessionHostError('HOST_INCONSISTENT', '宿主提交控制记录后未返回对应日志事件。');
    }
    return event;
  }
  function attach(agent: Agent): void {
    const state = stateFor(agent.id);
    if (state.agent === agent) {
      return;
    }
    for (const release of state.releases.splice(0)) {
      release();
    }
    state.agent = agent;
    state.pending.clear();
    state.batches.clear();
    state.revoked.clear();
    state.retry.clear();
    for (const [target, messages] of [['next-turn', agent.inbox.nextTurn], ['next-step', agent.inbox.nextStep]] as const) {
      for (const message of messages) {
        state.pending.set(message.id, { message, target, state: 'queued' });
        if (typeof message.source.rpcId === 'string' && message.source.rpcId.startsWith('dsh-loader:retry:')) {
          state.retry.add(message.id);
        }
      }
    }
    for (const event of agent.session.snapshotEvents()) {
      if (event.type === 'plugin:dsh-loader/recall') {
        const data = event.data as { messageId: string };
        state.revoked.add(data.messageId);
      }
    }
    patch<Inbox['clear']>(agent.inbox, 'clear', original => function (this: Inbox) {
      assertEntry(agent.id);
      return original.call(this);
    }, state.releases);
    for (const key of ['append', 'prepend'] as const) {
      patch<Inbox[typeof key]>(agent.inbox, key, original => function (this: Inbox, target, message) {
        assertEntry(agent.id);
        return original.call(this, target, message);
      }, state.releases);
    }
    patch<Inbox['replace']>(agent.inbox, 'replace', original => function (this: Inbox, id, message) {
      assertEntry(agent.id);
      return original.call(this, id, message);
    }, state.releases);
    patch<Inbox['remove']>(agent.inbox, 'remove', original => function (this: Inbox, id) {
      assertEntry(agent.id);
      return original.call(this, id);
    }, state.releases);
    patch<Inbox['splice']>(agent.inbox, 'splice', original => function (this: Inbox, target, start, deleteCount, inserted) {
      assertEntry(agent.id);
      return original.call(this, target, start, deleteCount, inserted);
    }, state.releases);
    patch<Agent['send']>(agent, 'send', original => function (this: Agent, message, target, wakeup) {
      assertEntry(this.id);
      return original.call(this, message, target, wakeup);
    }, state.releases);
    patch<Agent['runMaintenance']>(agent, 'runMaintenance', original => function <T>(this: Agent, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      assertEntry(this.id);
      state.maintenance += 1;
      let promise: Promise<T>;
      try {
        promise = original.call(this, task) as Promise<T>;
      } catch (error) {
        state.maintenance -= 1;
        throw error;
      }
      return promise.finally(() => { state.maintenance -= 1; changed(agent.id, 'status'); });
    }, state.releases);
    patch<Session['append']>(agent.session, 'append', original => function (this: Session, type, data, ...args) {
      assertEntry(this.id);
      if (type === 'user/message') {
        const id = data.id as string;
        if (state.retry.has(id)) {
          state.retry.delete(id);
          state.pending.delete(id);
          return record(this, 'retry', { messageId: id, operationId: (data.source as RecordValue).rpcId });
        }
        if (state.revoked.has(id)) {
          state.pending.delete(id);
          return record(this, 'recall', { messageId: id });
        }
      }
      return original.call(this, type, data, ...args);
    }, state.releases);
  }
  function capture(receiver: Registry, optionsValue: RecordValue, handle: Handle): Handle {
    const state = stateFor(handle.agent.id);
    attach(handle.agent);
    let entry = state.captured;
    if (entry && entry.handle.agent === handle.agent) {
      return entry.bridge;
    }
    const value: Capture = {
      receiver,
      options: { agentOptions: optionsValue.agentOptions, setup: optionsValue.setup },
      handle,
      bridge: {
        get agent() { return value.handle.agent; },
        async dispose() {
          await value.handle.dispose();
        },
      },
    };
    state.captured = value;
    changed(handle.agent.id, 'status');
    return value.bridge;
  }

  function guardRequest(request: Request): Request {
    const id = request.sessionId;
    if (!id || !llmModule.isAgentLoopRequest(request)) {
      return request;
    }
    const state = states.get(id);
    if (!state) {
      return request;
    }
    const messages = request.messages.filter(message => !state.revoked.has(message.id) && !state.retry.has(message.id));
    for (const message of messages) {
      state.pending.delete(message.id);
    }
    // 此处至原 stream 调用没有 await，撤回无法再修改已派发的请求。
    changed(id, 'pending');
    if (messages.length === request.messages.length) {
      return request;
    }
    return llmModule.markAgentLoopRequest(Object.freeze({ ...request, messages: Object.freeze(messages) }));
  }

  async function install(): Promise<void> {
    if (options.version && !/^0\.2\.2(?:-|$)/.test(options.version)) {
      throw new SessionHostError('UNSUPPORTED_VERSION', `会话适配器尚未验证宿主版本 ${options.version}。`);
    }
    const load = options.importModule ?? (async (specifier: string) => import(specifier) as Promise<RecordValue>);
    const [agent, llm, session, catalog, controllerExports, cordis] = await Promise.all([
      options.modules?.agent ?? load('@deepseek-ai/dsh-agent'),
      options.modules?.llm ?? load('@deepseek-ai/dsh-llm'),
      options.modules?.session ?? load('@deepseek-ai/dsh-session'),
      options.modules?.catalog ?? load('@deepseek-ai/dsh-session-format-catalog'),
      options.modules?.controller ?? load('@deepseek-ai/dsh-api-session-controller'),
      options.modules?.cordis ?? load('@deepseek-ai/cordis'),
    ]);
    const cordisModule = cordis as unknown as CordisModule;
    const controllerModule = controllerExports as unknown as ControllerModule;
    agentModule = agent as unknown as AgentModule;
    llmModule = llm as unknown as LlmModule;
    sessionModule = session as unknown as SessionModule;
    codec = catalog.sessionFormatCatalog as SessionCodec;
    if (!agentModule.AgentRegistry || !controllerModule.SessionController || !cordisModule.EventsService || !llmModule.LlmRuntime || !llmModule.createUserMessage
      || !llmModule.markAgentLoopRequest || !llmModule.isAgentLoopRequest || !sessionModule.appendPluginRecord || !sessionModule.buildForkSeed
      || codec?.currentVersion !== 4) {
      throw new SessionHostError('UNSUPPORTED_HOST', '当前宿主缺少会话适配所需的公开 API。');
    }
    assertOpen();
    if (!ctx.on) {
      throw new SessionHostError('HOST_UNAVAILABLE', '宿主未提供会话事件订阅 API。');
    }
    const on = (name: string, listener: (...args: any[]) => unknown) => {
      // Cordis 的事件签名由上游声明合并，这里跨版本入口必须保留其可变参数。
      const release = ctx.on!(name, listener);
      if (release) {
        resources.add(release);
      }
    };
    on('agent/created', ({ agent }: { agent: Agent }) => { attach(agent); });
    on('agent/disposed', ({ agent }: { agent: Agent }) => {
      const state = states.get(agent.id);
      if (state?.agent === agent) {
        for (const release of state.releases.splice(0)) {
          release();
        }
        state.agent = undefined;
        state.pending.clear();
        state.batches.clear();
      }
      changed(agent.id, 'status');
    });
    on('agent/inbox/inserted', ({ agent, message }: { agent: Agent; message: Message }) => {
      const state = stateFor(agent.id);
      const target = agent.inbox.nextTurn.some(item => item.id === message.id) ? 'next-turn' : 'next-step';
      state.pending.set(message.id, { message, target, state: 'queued' });
      changed(agent.id, 'pending');
    });
    on('agent/inbox/claimed', ({ agent, message }: { agent: Agent; message: Message }) => {
      const state = stateFor(agent.id);
      const previous = state.pending.get(message.id);
      state.pending.set(message.id, { message, state: 'claimed', target: previous?.target ?? 'next-turn' });
      changed(agent.id, 'pending');
    });
    on('agent/inbox/discarded', ({ agent, message }: { agent: Agent; message: Message }) => {
      stateFor(agent.id).pending.delete(message.id);
      changed(agent.id, 'pending');
    });
    on('agent/pre-step', async ({ agent }: { agent: Agent }, next: () => Promise<{ kind: 'enter'; messages: Message[] } | { kind: 'reject' }>) => {
      const decision = await next();
      if (decision.kind === 'enter') {
        const state = stateFor(agent.id);
        for (let index = decision.messages.length - 1; index >= 0; index -= 1) {
          if (state.revoked.has(decision.messages[index]!.id)) {
            decision.messages.splice(index, 1);
          }
        }
        state.batches.add(decision.messages);
      }
      return decision;
    });
    on('agent/status', ({ agent }: { agent: Agent }) => {
      const state = stateFor(agent.id);
      if (agent.status === 'idle') {
        state.batches.clear();
        // 被拒绝的 pre-step 不会自行退回 claimed 输入，保留输入供下一次显式发送。
        for (const item of [...state.pending.values()]) {
          if (item.state === 'claimed' && !state.revoked.has(item.message.id)) {
            const admitted = agent.session.snapshotEvents().some(event => event.type === 'user/message'
              && (event.data as RecordValue).id === item.message.id);
            if (admitted) {
              state.pending.delete(item.message.id);
            } else {
              agent.inbox.append(item.target, item.message);
            }
          }
        }
      }
      changed(agent.id, 'status');
    });
    on('session/event', (session: Session, event: RecordValue) => {
      emit({ type: 'event', sessionId: session.id, event: structuredClone(event) });
    });
    on('agent/error', ({ agent, error }: { agent: Agent; error: unknown }) => {
      emit({ type: 'error', sessionId: agent.id, error });
    });
    patch<EventBus['emit']>(cordisModule.EventsService.prototype, 'emit', original => function (this: EventBus, ...args) {
      const offset = typeof args[0] === 'object' || typeof args[0] === 'function' ? 1 : 0;
      const id = args[offset + 1];
      const notice = args[offset] === 'api-session/removed' && typeof id === 'string' ? replacements.get(id) : undefined;
      if (notice) {
        // 同 ID 重建保留客户端 Session 与投影存储，真正失去 Agent 时再补发移除。
        notice.publishRemoval = () => original.apply(this, args);
        return;
      }
      return original.apply(this, args);
    });
    for (const key of ['create', 'resume'] as const) {
      patch<Registry[typeof key]>(agentModule.AgentRegistry.prototype, key, original => async function (this: Registry, value) {
        const id = (key === 'create' ? value.sessionId : value.resumeSessionId) as string;
        assertEntry(id);
        const handle = await original.call(this, value);
        if (registry().get(id) !== handle.agent) {
          return handle;
        }
        return capture(this, value, handle);
      });
    }
    patch<Llm['prepareCall']>(llmModule.LlmRuntime.prototype, 'prepareCall', original => async function (this: Llm, config, signal, configure) {
      const prepared = await original.call(this, config, signal, configure);
      return { ...prepared, stream(request) { return prepared.stream(guardRequest(request)); } };
    });
    patch<Llm['stream']>(llmModule.LlmRuntime.prototype, 'stream', original => function (this: Llm, request) {
      return original.call(this, guardRequest(request));
    });
    patch<Controller['prompt']>(controllerModule.SessionController.prototype, 'prompt', original => async function (this: Controller, request, signal) {
      if (operation.getStore()?.active && operation.getStore()?.sessionId === request.sessionId) {
        return original.call(this, request, signal);
      }
      return exclusive(request.sessionId, async () => original.call(this, request, signal), false);
    });
    for (const agent of registry().list()) {
      attach(agent);
    }
  }
  const ready = install().catch(error => {
    resources.dispose();
    throw error;
  });
  // ready 仍保留拒绝状态供消费者 await，同时明确记录初始化失败。
  void ready.catch(error => ctx.logger?.error?.('loader 会话适配器初始化失败。', error));

  async function read(id: string): Promise<SessionSnapshot> {
    await ready;
    assertOpen();
    const agent = registry().get(id);
    if (agent) {
      return structuredClone({ header: agent.session.header, events: [...agent.session.snapshotEvents()], inheritedEventCount: agent.session.inheritedEventCount });
    }
    return readStoredSession(persistence(), id);
  }
  async function resolve(id: string): Promise<Agent> {
    const found = await controller().resolveAgent(id);
    if ('error' in found) {
      throw found.error;
    }
    requireCapture(found.agent);
    return found.agent;
  }
  function closeReplacedTail(snapshot: SessionSnapshot): SessionSnapshot {
    if (snapshot.events.length === 0) {
      return snapshot;
    }
    const seed = sessionModule.buildForkSeed(snapshot.events, snapshot.events.length - 1);
    // 同 ID 替换只借用官方尾部修复；丢弃新增继承标记，原日志中的引用位置不变。
    const closers = seed.slice(snapshot.events.length + 1).map(event => ({ ...event, seq: Number(event.seq) - 1 }));
    return closers.length === 0 ? snapshot : { ...snapshot, events: [...snapshot.events, ...closers] };
  }
  async function replace(id: string, snapshot: SessionSnapshot): Promise<void> {
    const agent = await resolve(id);
    assertIdle(id);
    const captured = requireCapture(agent);
    encodeSessionSnapshot(codec, id, snapshot);
    const replacement = closeReplacedTail(snapshot);
    if (replacement !== snapshot) {
      encodeSessionSnapshot(codec, id, replacement);
    }
    const previous = await read(id);
    const pending = [
      ...agent.inbox.nextTurn.map(message => ({ message, target: 'next-turn' as const })),
      ...agent.inbox.nextStep.map(message => ({ message, target: 'next-step' as const })),
    ];
    const selection = agent.model.current();
    const originalSetup = captured.options.setup as AgentSetup | undefined;
    const setup: AgentSetup = async (agentCtx, resumed) => {
      const originalCommit = await originalSetup?.(agentCtx, resumed);
      return {
        commit() {
          originalCommit?.commit();
          // 截断前缀可能留下已领取消息的旧插入事件，须在发布及驱动启动前恢复真实队列。
          resumed.inbox.clear();
          for (const item of pending) {
            resumed.inbox.append(item.target, item.message);
          }
          if (selection) {
            resumed.model.select(selection);
          }
        },
      };
    };
    const resume = async (): Promise<Handle> => {
      const next = await captured.receiver.resume({ resumeSessionId: id, ...captured.options, setup });
      captured.handle = stateFor(id).captured!.handle;
      stateFor(id).captured = captured;
      return next;
    };
    await flush(agent.session);
    const notice: ReplacementNotice = {};
    replacements.set(id, notice);
    try {
      await captured.handle.dispose();
      try {
        await replaceStoredSession(persistence(), codec, id, replacement);
        await resume();
      } catch (error) {
        try {
          const current = registry().get(id);
          if (current) {
            await requireCapture(current).handle.dispose();
          }
          await replaceStoredSession(persistence(), codec, id, previous);
          await resume();
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `会话 ${id} 的历史替换及恢复均失败，请停止后续操作并重启宿主。`);
        }
        throw new SessionHostError('REPLACE_FAILED', '历史替换失败，原会话已经恢复。', { cause: error });
      }
    } finally {
      replacements.delete(id);
      if (!registry().get(id)) {
        notice.publishRemoval?.();
      }
    }
    changed(id, 'replaced');
  }
  async function prompt(id: string, content: RecordValue[]): Promise<void> {
    const agent = await resolve(id);
    assertIdle(id);
    await controller().prompt({ sessionId: agent.id, requestId: randomUUID(), content }, new AbortController().signal);
  }
  async function validateImages(agent: Agent, content: RecordValue[]): Promise<void> {
    if (!content.some(block => block.type === 'image')) {
      return;
    }
    const selection = agent.model.current();
    if (selection) {
      const model = await requireService<Llm>('llm').resolveModelInfo(selection.provider as string, selection.model as string);
      if (model.inputModalities && !model.inputModalities.includes('image')) {
        throw new SessionHostError('IMAGE_UNSUPPORTED', '当前模型不支持图片输入。');
      }
    }
  }
  async function admitEdit(id: string, originalMessage: RecordValue, parts: RecordValue[]): Promise<RecordValue> {
    const agent = await resolve(id);
    assertIdle(id);
    const originalContent = originalMessage.content;
    if (!Array.isArray(originalContent)) {
      throw new SessionHostError('INVALID_MESSAGE', '原消息没有合法的内容块。');
    }
    const uploads = requireService<FileUploads>('fileUploads');
    const content = parts.map(part => {
      if (part.type === 'retained') {
        const index = part.index;
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
          throw new SessionHostError('INVALID_ATTACHMENT', '保留附件的索引不合法。');
        }
        const block = originalContent[index] as RecordValue | undefined;
        if (!block || (block.type !== 'file' && block.type !== 'image') || !block.attachment) {
          throw new SessionHostError('INVALID_ATTACHMENT', '只能保留原消息中的附件。');
        }
        return structuredClone(block);
      }
      if (part.type === 'file') {
        if (typeof part.receiptId !== 'string') {
          throw new SessionHostError('INVALID_ATTACHMENT', '新文件必须使用本会话的上传凭据。');
        }
        const block = uploads.resolve(agent, part.receiptId);
        if (!block) {
          throw new SessionHostError('INVALID_ATTACHMENT', '文件没有上传到当前会话。');
        }
        return block;
      }
      if ((part.type !== 'text' && part.type !== 'image') || 'attachment' in part) {
        throw new SessionHostError('INVALID_ATTACHMENT', '编辑内容只接受文本、新图片、上传凭据或原附件索引。');
      }
      return part;
    });
    if (!content.some(part => part.type !== 'text' || (typeof part.text === 'string' && part.text.trim().length > 0))) {
      throw new SessionHostError('INVALID_MESSAGE', '编辑后的消息必须包含文本或附件。');
    }
    await validateImages(agent, content);
    const admitted = await requireService<Attachments>('attachments').admitPromptContent(content);
    if (registry().get(id) !== agent) {
      throw new SessionHostError('MESSAGE_CHANGED', '附件验证期间会话已重建。');
    }
    assertIdle(id);
    // 凭据在此转换为已存附件引用；重建 Agent 后发送不依赖旧 Session 的暂存表。
    return llmModule.createUserMessage({ content: admitted, source: { kind: 'user' } });
  }
  async function sendMessage(id: string, message: RecordValue): Promise<void> {
    const agent = await resolve(id);
    if ([...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(item => item.id === message.id)
      || agent.session.snapshotEvents().some(event => event.type === 'user/message' && (event.data as RecordValue).id === message.id)) {
      await flush(agent.session);
      return;
    }
    assertIdle(id);
    const content = message.content as RecordValue[];
    if (typeof message.id !== 'string' || message.role !== 'user' || !Array.isArray(content) || content.length === 0) {
      throw new SessionHostError('INVALID_MESSAGE', '发送需要带稳定身份的完整用户消息。');
    }
    await validateImages(agent, content);
    assertIdle(id);
    agent.followup(llmModule.freezeMessage(message as Message));
    await flush(agent.session);
  }
  async function retry(id: string, operationId: string = randomUUID()): Promise<void> {
    const agent = await resolve(id);
    const rpcId = `dsh-loader:retry:${operationId}`;
    if (agent.session.snapshotEvents().some(event => event.type === 'plugin:dsh-loader/retry'
      && (event.data as RecordValue).operationId === rpcId)) {
      await flush(agent.session);
      return;
    }
    const existing = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].find(message => message.source.rpcId === rpcId);
    if (existing && agent.status === 'running') {
      await flush(agent.session);
      return;
    }
    assertIdle(id);
    if (!agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.surfaceOp === 'append')) {
      throw new SessionHostError('RETRY_UNAVAILABLE', '当前会话没有可续答的用户消息。');
    }
    const token = existing ?? llmModule.createUserMessage({ content: [], source: { kind: 'user', rpcId } });
    if (existing) {
      agent.inbox.remove(existing.id);
    }
    stateFor(id).retry.add(token.id);
    try {
      agent.followup(token);
    } catch (error) {
      stateFor(id).retry.delete(token.id);
      throw error;
    }
    await flush(agent.session);
  }
  async function exclusive<T>(id: string, callback: (session: SessionExclusive) => Promise<T>, idle = true): Promise<T> {
    await ready;
    assertOpen();
    if (operation.getStore()?.active && operation.getStore()?.sessionId === id) {
      throw new SessionHostError('NESTED_OPERATION', '请使用当前排他操作提供的会话方法。');
    }
    const previous = queues.get(id) ?? Promise.resolve();
    let release!: () => void;
    const barrier = new Promise<void>(done => { release = done; });
    queues.set(id, barrier);
    await previous;
    // 普通发送只串行附件 admission；它等待期间当前轮次仍须能提交日志。
    const lease = { sessionId: id, active: true, writesExclusive: idle };
    locks.set(id, lease);
    const check = () => {
      if (!lease.active || operation.getStore() !== lease) {
        throw new SessionHostError('EXPIRED_OPERATION', '会话排他操作已经结束。');
      }
      assertOpen();
    };
    try {
      return await operation.run(lease, async () => {
        if (idle) {
          assertIdle(id);
        }
        const session: SessionExclusive = {
          read: () => { check(); return read(id); },
          replace: snapshot => { check(); return replace(id, snapshot); },
          prompt: content => { check(); return prompt(id, content); },
          admitEdit: (original, parts) => { check(); return admitEdit(id, original, parts); },
          sendMessage: message => { check(); return sendMessage(id, message); },
          retry: operationId => { check(); return retry(id, operationId); },
        };
        return callback(session);
      });
    } finally {
      lease.active = false;
      locks.delete(id);
      if (queues.get(id) === barrier) {
        queues.delete(id);
      }
      release();
    }
  }
  async function recallPending(id: string, ids: string[]): Promise<SessionPendingMessage[]> {
    await ready;
    assertEntry(id);
    const agent = registry().get(id);
    if (!agent) {
      throw new SessionHostError('NOT_ATTACHED', '请先打开该会话后再撤回待发送消息。');
    }
    requireCapture(agent);
    const state = stateFor(id);
    const unique = [...new Set(ids)];
    const items = unique.map(messageId => {
      const item = state.pending.get(messageId);
      if (!item || state.revoked.has(messageId) || state.retry.has(messageId)) {
        throw new SessionHostError('MESSAGE_DISPATCHED', '消息已经发送或不再待处理，无法硬撤回。');
      }
      return item;
    });
    const result = items.map(item => structuredClone({ id: item.message.id, message: item.message, state: item.state, target: item.target }));
    for (const item of items) {
      const messageId = item.message.id;
      if (item.state === 'queued') {
        if (!agent.inbox.remove(messageId)) {
          throw new SessionHostError('MESSAGE_CHANGED', '消息队列发生变化，撤回未完成。');
        }
        if (typeof item.message.source.rpcId === 'string') {
          requireService<FileUploads>('fileUploads').retirePrompt(agent, item.message.source.rpcId);
        }
      } else {
        record(agent.session, 'recall', { messageId });
        state.revoked.add(messageId);
        for (const batch of state.batches) {
          const index = batch.findIndex(message => message.id === messageId);
          if (index >= 0) {
            batch.splice(index, 1);
          }
        }
      }
      state.pending.delete(messageId);
    }
    await flush(agent.session);
    changed(id, 'pending');
    return result;
  }
  return {
    ready, read, status, runExclusive: exclusive, recallPending,
    prompt: (id, content) => exclusive(id, session => session.prompt(content)),
    retry: (id, operationId) => exclusive(id, session => session.retry(operationId), false),
    watch(listener, sessionId) {
      assertOpen();
      const subscription = { listener, sessionId };
      listeners.add(subscription);
      return () => { listeners.delete(subscription); };
    },
    dispose() {
      disposed = true;
      resources.dispose();
      listeners.clear();
    },
  };
}
