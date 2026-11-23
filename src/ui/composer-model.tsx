import { createElement, useMemo, type ComponentType } from 'react';
import type { SessionObservable } from '../session-client.js';

/** 提交给当前会话的模型选择；省略等级时由宿主采用模型默认行为。 */
export interface ComposerModelSelection { provider: string; model: string; reasoningEffort?: string }

/** 模型目录对选择器公开的显示信息和推理能力。 */
export interface ComposerModelOption {
  id: string;
  name: string;
  description?: string;
  reasoning?: {
    efforts: readonly { id: string; name: string; description?: string }[];
    defaultEffort?: string;
  };
}

/** 宿主模型目录按提供商组织的分组。 */
export interface ComposerModelGroup { id: string; name: string; models: readonly ComposerModelOption[] }

/** 与宿主 `/model` 命令共用的当前会话模型目录状态。 */
export interface ComposerModelSnapshot {
  current: ComposerModelSelection | null;
  retainedEffort?: string;
  routable: boolean | null;
  groups: readonly ComposerModelGroup[];
  failures: readonly { id: string; name: string; message: string }[];
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error';
  pending: ComposerModelSelection | null;
  error: string | null;
}

/** 团队功能和宿主已保存的开关状态；关闭已使用的团队前须由调用方确认。 */
export interface ComposerTeamSnapshot { available: boolean; enabled: boolean; requiresDisableConfirmation: boolean }

/** 会话级组件参数。写操作失败时拒绝 Promise，投影仍显示宿主实际状态。 */
export interface ComposerModelProps {
  sessionId: string;
  locked: boolean;
  available: boolean;
  directory: SessionObservable<ComposerModelSnapshot>;
  load(): Promise<void>;
  select(selection: ComposerModelSelection): Promise<void>;
  team?: {
    state: SessionObservable<ComposerTeamSnapshot>;
    setEnabled(enabled: boolean): Promise<void>;
  };
}

/** 供模型选择器注册使用的 Cordis 客户端上下文。 */
export interface ComposerModelOwner {
  get(name: string): unknown;
  inject(dependencies: string[], apply: (scope: ComposerModelOwner) => void): { dispose(): unknown };
  effect(effect: () => (() => void)): unknown;
}

/** 注册期间替换原生模型选择器，释放后恢复原生组件和它的子插槽。 */
export interface ComposerModel {
  register(owner: ComposerModelOwner, component: ComponentType<ComposerModelProps>): () => void;
}

type Result = { ok: true } | { ok: false; error: { code?: string; message: string } };
type SeatProps = { sessionId: string; locked: boolean };
type Directory = {
  store: SessionObservable<ComposerModelSnapshot>;
  load(): Promise<unknown>;
  select(selection: ComposerModelSelection): Promise<Result>;
};
type Directories = { directoryFor(sessionId: string): Directory };
type Binding = { session: { projections: { faceOf(key: string): SessionObservable<unknown> } } };
type Sessions = {
  binding(sessionId: string): Binding | undefined;
  subagentAddress(sessionId: string): unknown;
  list: SessionObservable<{ byId: Record<string, { origin?: string } | undefined> }>;
};
type Remote = { agentTeams: { setEnabled(sessionId: string, enabled: boolean): Promise<Result> } };
type Slots = {
  inject(name: string, callback: () => () => void): () => void;
  register(options: { name: string; priority: number }, component: ComponentType<SeatProps>): () => void;
};

const seat = 'conversation.input.model';

function checkResult(result: Result): void {
  if (!result.ok) {
    throw new Error(result.error.code ? `${result.error.code}: ${result.error.message}` : result.error.message);
  }
}

function warn(message: string, error?: unknown): void {
  console.warn(`[dsh-loader] ${message}`, error ?? '');
}

/** 将宿主模型选择插槽和会话投影适配为与 DSH 版本无关的组件参数。 */
export function createComposerModel(): ComposerModel {
  return {
    register(owner, Component) {
      const fiber = owner.inject(['slots', 'modelDirectories', 'sessions'], function mountComposerModel(scope) {
        const slots = scope.get('slots') as Slots;
        const models = scope.get('modelDirectories') as Directories;
        const sessions = scope.get('sessions') as Sessions;
        if (typeof slots?.inject !== 'function' || typeof slots.register !== 'function'
          || typeof models?.directoryFor !== 'function' || typeof sessions?.binding !== 'function'
          || typeof sessions.subagentAddress !== 'function' || !sessions.list) {
          warn('模型选择器所需的宿主接口不可用，保留原生模型选择器。');
          return;
        }

        let active = true;
        let remote: Remote | undefined;
        const remoteListeners = new Set<() => void>();
        function notifyRemote(): void {
          for (const listener of remoteListeners) { listener(); }
        }
        scope.effect(() => () => { active = false; remoteListeners.clear(); });
        scope.inject(['remote', 'remote.agentTeams'], teamScope => {
          const candidate = teamScope.get('remote') as Remote;
          if (typeof candidate?.agentTeams?.setEnabled !== 'function') {
            return;
          }
          remote = candidate;
          notifyRemote();
          teamScope.effect(() => () => { remote = undefined; notifyRemote(); });
        });

        function Seat({ sessionId, locked }: SeatProps) {
          const binding = sessions.binding(sessionId);
          const modelProps = useMemo(() => {
            if (!binding || sessions.subagentAddress(sessionId) !== undefined) {
              return undefined;
            }
            const directory = models.directoryFor(sessionId);
            const team = binding.session.projections.faceOf('agentTeam');
            const modelSelection = binding.session.projections.faceOf('modelSelection');
            let snapshot: ComposerTeamSnapshot = { available: false, enabled: false, requiresDisableConfirmation: false };
            function getTeamSnapshot(): ComposerTeamSnapshot {
              const mode = team.getSnapshot() as { enabled?: unknown } | undefined;
              const model = modelSelection.getSnapshot() as { lastUsed?: unknown } | undefined;
              const available = remote !== undefined && typeof mode?.enabled === 'boolean' && model !== undefined
                && sessions.subagentAddress(sessionId) === undefined
                && sessions.list.getSnapshot().byId[sessionId]?.origin !== 'subagent';
              const enabled = mode?.enabled === true;
              const requiresDisableConfirmation = enabled && model?.lastUsed != null;
              if (snapshot.available !== available || snapshot.enabled !== enabled
                || snapshot.requiresDisableConfirmation !== requiresDisableConfirmation) {
                snapshot = { available, enabled, requiresDisableConfirmation };
              }
              return snapshot;
            }
            function assertSession(): void {
              if (!active || sessions.binding(sessionId) !== binding || sessions.subagentAddress(sessionId) !== undefined) {
                throw new Error('[dsh-loader] 当前会话已关闭或模型选择器已卸载。');
              }
            }
            return {
              sessionId,
              available: true,
              directory: directory.store,
              async load() { assertSession(); await directory.load(); },
              async select(selection) { assertSession(); checkResult(await directory.select(selection)); },
              team: {
                state: {
                  getSnapshot: getTeamSnapshot,
                  subscribe(listener) {
                    const off = [team.subscribe(listener), modelSelection.subscribe(listener), sessions.list.subscribe(listener)];
                    remoteListeners.add(listener);
                    return () => { remoteListeners.delete(listener); for (const unsubscribe of off) { unsubscribe(); } };
                  },
                },
                async setEnabled(enabled) {
                  assertSession();
                  if (!remote || !getTeamSnapshot().available) {
                    throw new Error('[dsh-loader] 当前会话不支持智能体团队协作。');
                  }
                  checkResult(await remote.agentTeams.setEnabled(sessionId, enabled));
                },
              },
            } satisfies Omit<ComposerModelProps, 'locked'>;
          }, [binding, sessionId]);
          return modelProps ? createElement(Component, { ...modelProps, locked }) : null;
        }

        try {
          scope.effect(() => slots.inject(seat, () => {
            try {
              return slots.register({ name: seat, priority: -10 }, Seat);
            } catch (error) {
              warn('无法注册模型选择器，保留原生模型选择器。', error);
              return () => {};
            }
          }));
        } catch (error) {
          warn('无法订阅模型选择插槽，保留原生模型选择器。', error);
        }
      });
      return () => { void fiber.dispose(); };
    },
  };
}
