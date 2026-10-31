import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigError, checkJSON, configAt, findConfigField, type ConfigValue, type ConfigView } from '../config.js';
import type { ConfigClient } from '../config-client.js';
import { ownedScope, type ResourceOwner } from '../lifecycle.js';
import { setAt } from './config-fields.js';

export type ConfigDialogReader<T> = (signal: AbortSignal) => T | Promise<T>;
export interface ConfigDialogSession<T> {
  readonly value: T;
  readonly saving: boolean;
  readonly error: string;
  readonly errors: Record<string, string>;
  /** A controlled UI can supply its value directly; an uncontrolled editor can register a reader. */
  setValue(value: T): void;
  setReader(reader: ConfigDialogReader<T>): () => void;
  /** Persist this field through config-api; keep the dialog open. Concurrent calls share one promise. */
  save(): Promise<ConfigView>;
  close(): void;
}
export type ConfigDialogProps<T> = ConfigDialogSession<T>;
export interface ConfigDialogOptions<T> {
  id: string;
  configId: string;
  field: string[];
  title: string;
  component: React.ComponentType<ConfigDialogProps<T>>;
}
export interface ConfigDialogHandle<T> {
  open(): Promise<ConfigDialogSession<T>>;
  save(): Promise<ConfigView>;
  close(): void;
  dispose(): void;
}
export interface ConfigDialogsAPI {
  registerDialog<T = ConfigValue>(owner: ResourceOwner, options: ConfigDialogOptions<T>): ConfigDialogHandle<T>;
  openDialog(configId: string, id: string, field: string[]): Promise<ConfigDialogSession<unknown>>;
  hasDialog(configId: string, id: string, field: string[]): boolean;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}
const CSS = `
.dshl-config-dialog{width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 32px);box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:12px;padding:20px;overflow:auto;font:inherit;background:var(--dsw-alias-bg-base,Canvas);color:var(--dsw-alias-label-primary,CanvasText);color-scheme:inherit}
.dshl-config-dialog::backdrop{background:#0007}.dshl-config-dialog h2{font-size:1.1em;margin:0 0 16px}
.dshl-config-dialog-body{min-width:0;overflow-wrap:anywhere}.dshl-config-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.dshl-config-dialog-body textarea{max-width:100%;box-sizing:border-box;resize:vertical}
.dshl-config-dialog-actions button{font:inherit;border:1px solid var(--dsw-alias-border-l2,#8888);border-radius:6px;padding:6px 16px;background:transparent;color:inherit;cursor:pointer}.dshl-config-dialog-actions button:disabled{opacity:.5;cursor:default}
.dshl-config-dialog-error{color:var(--dsw-alias-status-danger,#d33);overflow-wrap:anywhere}
@media(max-width:480px){.dshl-config-dialog{padding:12px}}
`;
interface LiveSession<T> extends ConfigDialogSession<T> { subscribe(listener: () => void): () => void; version(): number; broken(error: Error): void; failed: boolean }
class EditorBoundary extends React.Component<{ children: React.ReactNode; fail(error: Error): void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: Error) { this.props.fail(error); }
  override render() { return this.state.failed ? <p>插件配置界面无法显示。</p> : this.props.children; }
}
function Dialog<T>({ session, options, ready }: { session: LiveSession<T>; options: ConfigDialogOptions<T>; ready(error?: unknown): void }): React.ReactElement {
  React.useSyncExternalStore(session.subscribe, session.version);
  const element = React.useRef<HTMLDialogElement>(null), title = React.useId();
  React.useEffect(() => { try { element.current!.showModal(); ready(); } catch (error) { ready(error); } }, []);
  const Component = options.component;
  return <dialog className="dshl-config-dialog" ref={element} aria-labelledby={title} aria-busy={session.saving} onCancel={event => { event.preventDefault(); session.close(); }} onClose={session.close}>
    <style>{CSS}</style><h2 id={title}>{options.title}</h2>
    <fieldset className="dshl-config-dialog-body" disabled={session.saving} style={{ border: 0, margin: 0, padding: 0 }}><EditorBoundary fail={session.broken}><Component value={session.value} saving={session.saving} error={session.error} errors={session.errors} setValue={session.setValue} setReader={session.setReader} save={session.save} close={session.close}/></EditorBoundary></fieldset>
    {session.error && <div role="alert" className="dshl-config-dialog-error"><p>{session.error}</p>{Object.entries(session.errors).map(([field, message]) => <p key={field}>{field}: {message}</p>)}</div>}
    <div className="dshl-config-dialog-actions"><button type="button" onClick={session.close}>取消</button><button type="button" disabled={session.saving || session.failed} onClick={() => { void session.save().then(session.close).catch(() => {}); }}>{session.saving ? '保存中…' : '确认'}</button></div>
  </dialog>;
}
/** UI functions live only in the browser registry; host templates remain JSON. */
export function createConfigDialogs(client: ConfigClient): ConfigDialogsAPI {
  const registrations = new Map<string, { field: string[]; open(): Promise<ConfigDialogSession<any>>; dispose(): void }>();
  const listeners = new Set<() => void>(); let disposed = false;
  const key = (configId: string, id: string) => JSON.stringify([configId, id]);
  const emit = () => { for (const listener of listeners) listener(); };
  const find = (configId: string, id: string, field: string[]) => {
    const registration = registrations.get(key(configId, id));
    return registration && JSON.stringify(registration.field) === JSON.stringify(field) ? registration : undefined;
  };
  return {
    registerDialog<T = ConfigValue>(owner: ResourceOwner, input: ConfigDialogOptions<T>): ConfigDialogHandle<T> {
      if (disposed) throw new ConfigError('disposed', 'Config dialogs disposed');
      if (!input || typeof input.configId !== 'string' || typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(input.configId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.id) || !Array.isArray(input.field) || !input.field.length || input.field.some(part => typeof part !== 'string' || !part || ['__proto__','constructor','prototype'].includes(part)) || typeof input.title !== 'string' || !input.title.trim() || !input.component || !['function','object'].includes(typeof input.component)) throw new ConfigError('invalid', 'Invalid config dialog registration');
      const id = key(input.configId, input.id), options = { ...input, field: [...input.field] };
      if (registrations.has(id)) throw new ConfigError('duplicate', 'Config dialog already registered');
      const scope = ownedScope(owner);
      let opening: Promise<ConfigDialogSession<T>> | undefined, live: LiveSession<T> | undefined, generation = 0;
      const assertActive = () => { if (scope.disposed || disposed) throw new ConfigError('disposed', 'Config dialog unregistered'); };
      const close = () => { generation++; opening = undefined; live?.close(); };
      const registration = {
        field: options.field,
        open: () => {
          try { assertActive(); } catch (error) { return Promise.reject(error); }
          if (opening) return opening;
          if (live) return Promise.resolve(live);
          const token = ++generation;
          opening = (async () => {
            let base = await client.read(options.configId); assertActive();
            if (token !== generation) throw new ConfigError('dialog-closed', '配置弹窗已关闭');
            const field = findConfigField(base.template.fields, options.field), initial = configAt(base.value, options.field);
            if (!field || field.type === 'group' || initial === undefined) throw new ConfigError('invalid', 'Config dialog target field does not exist');
            let value = structuredClone(initial) as T, saving = false, error = '', errors: Record<string, string> = {}, active = true, version = 0, pending: Promise<ConfigView> | undefined;
            const readers = new Map<symbol, ConfigDialogReader<T>>(), subscribers = new Set<() => void>(), controller = new AbortController();
            const host = document.createElement('div'), previousFocus = document.activeElement as HTMLElement | null;
            host.dataset.dshlConfigDialog = id; document.body.append(host); const root = createRoot(host);
            const notify = () => { version++; for (const subscriber of subscribers) subscriber(); };
            const check = () => { assertActive(); if (!active) throw new ConfigError('dialog-closed', '配置弹窗已关闭'); };
            let readyResolve: (session: ConfigDialogSession<T>) => void, readyReject: (error: unknown) => void;
            const ready = new Promise<ConfigDialogSession<T>>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
            const session: LiveSession<T> = {
              get value() { return structuredClone(value); }, get saving() { return saving; }, get error() { return error; }, get errors() { return { ...errors }; }, failed: false,
              setValue(next) { check(); checkJSON(next); value = structuredClone(next); notify(); },
              setReader(reader) { check(); if (typeof reader !== 'function') throw new ConfigError('invalid', 'Reader must be a function'); const token = Symbol(); readers.set(token, reader); return () => { readers.delete(token); }; },
              subscribe(listener) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }, version: () => version,
              broken(cause) { session.failed = true; error = cause.message; notify(); },
              save() {
                try { check(); if (session.failed) throw new ConfigError('render-error', '插件配置界面无法显示'); } catch (error) { return Promise.reject(error); }
                if (pending) return pending;
                saving = true; error = ''; errors = {}; notify();
                let cancel: () => void;
                const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new ConfigError('dialog-closed', '配置弹窗已关闭')); controller.signal.addEventListener('abort', cancel, { once: true }); });
                const task = Promise.resolve().then(async () => {
                  const reader = [...readers.values()].at(-1), next = reader ? await reader(controller.signal) : value;
                  check(); checkJSON(next); value = structuredClone(next); notify();
                  const saved = await client.update(options.configId, setAt(base.value, options.field, value as ConfigValue), base.revision, controller.signal);
                  check(); base = saved; value = structuredClone(configAt(saved.value, options.field)) as T;
                  return structuredClone(saved);
                });
                pending = Promise.race([task, cancelled]).catch(cause => { if (active) { error = cause instanceof Error ? cause.message : String(cause); errors = cause instanceof ConfigError ? cause.fields : {}; } throw cause; }).finally(() => { controller.signal.removeEventListener('abort', cancel); saving = false; pending = undefined; if (active) notify(); });
                return pending;
              },
              close() {
                if (!active) return; active = false; controller.abort(); readers.clear(); subscribers.clear();
                readyReject(new ConfigError('dialog-closed', '配置弹窗已关闭'));
                try { host.querySelector('dialog')?.close(); }
                finally { try { root.unmount(); } finally {
                  host.remove();
                  if (live === session) { live = undefined; generation++; opening = undefined; }
                  if (previousFocus?.isConnected) previousFocus.focus();
                } }
              },
            };
            live = session;
            root.render(<Dialog session={session} options={options} ready={cause => { if (cause) { readyReject(cause); session.close(); } else readyResolve(session); }}/>);
            return ready;
          })().finally(() => { if (token === generation) opening = undefined; });
          return opening;
        },
        dispose: scope.dispose,
      };
      scope.add(() => { try { close(); } finally { if (registrations.get(id) === registration) registrations.delete(id); emit(); } });
      assertActive(); registrations.set(id, registration); emit();
      return { open: registration.open, save: () => live ? live.save() : Promise.reject(new ConfigError('dialog-closed', '请先打开配置弹窗')), close, dispose: scope.dispose };
    },
    hasDialog: (configId, id, field) => Boolean(find(configId, id, field)),
    openDialog: (configId, id, field) => find(configId, id, field)?.open() ?? Promise.reject(new ConfigError('not-found', '插件尚未注册此配置弹窗')),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispose() { if (disposed) return; disposed = true; const errors = []; for (const registration of [...registrations.values()]) { try { registration.dispose(); } catch (error) { errors.push(error); } } registrations.clear(); listeners.clear(); if (errors.length) throw new AggregateError(errors, 'Config dialog cleanup failed'); },
  };
}
