import * as React from 'react';
import { type ConfigView, type ConfigField, ConfigError } from '../config.js';
import type { ConfigClient } from '../config-client.js';
import type { BootDescriptor } from '../bootstrap.js';
import { Fields, setAt } from './config-fields.js';
import { OperationPanel } from './config-operations.js';
import type { ConfigDialogsAPI } from './config-dialogs.js';
import { ConfigModelsContext } from './model-select.js';
import type { ConfigModelSource } from './config-model-source.js';
import { ConfigToast } from './config-toast.js';

class PanelBoundary extends React.Component<{ component: React.ComponentType<any>; children: React.ReactNode }, { error: string; component?: React.ComponentType<any> }> {
  override state = { error: '', component: this.props.component };
  static getDerivedStateFromProps(props: { component: React.ComponentType<any> }, state: { component?: React.ComponentType<any> }) { return props.component === state.component ? null : { error: '', component: props.component }; }
  static getDerivedStateFromError(error: unknown) { return { error: error instanceof Error ? error.message : String(error) }; }
  override render() { return this.state.error ? <p role="alert">管理面板无法显示：{this.state.error}</p> : this.props.children; }
}

interface ConfigSaveAction { dirty: boolean; save(): Promise<boolean> }
type ConfigSaveRegistration = (id: string, current: () => ConfigSaveAction) => () => void;
function saveShortcut(event: KeyboardEvent): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && !event.isComposing && event.key.toLowerCase() === 's';
}

export const CONFIG_CSS = `
.dshl-config{color:var(--color-text-primary,inherit);font:inherit;width:100%;box-sizing:border-box}
.dshl-config-card{border:1px solid var(--color-border,#8886);border-radius:12px;margin:12px 0;padding:12px;min-width:0}
.dshl-config-card summary{cursor:pointer;font-weight:600}.dshl-config-card summary:focus-visible{outline:2px solid Highlight}
.dshl-config-form{--config-label-width:0px;margin-top:16px;min-width:0}
.dshl-config-fields{border:0;margin:0;padding:0;min-width:0}
.dshl-config-item{display:grid;grid-template-columns:var(--config-label-width) minmax(0,1fr);gap:12px;align-items:start;margin:12px 0}
.dshl-config-label{padding-top:6px;white-space:nowrap}.dshl-config-label span{display:inline-block}
.dshl-config-control{min-width:0}.dshl-config-control input:not([type=checkbox]),.dshl-config-control select,.dshl-config-control textarea{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:transparent;border:1px solid var(--color-border,#8888);border-radius:6px;padding:6px}
.dshl-config-control option{color:CanvasText;background:Canvas}.dshl-config-control textarea{min-height:80px;max-width:100%;resize:vertical}
.dshl-config-group{border:1px solid var(--color-border,#8888);border-radius:10px;min-width:0;margin:16px 0;padding:0 12px}
.dshl-config-group legend{padding:0 8px;margin-left:4px;font-weight:500;max-width:100%;overflow-wrap:anywhere}
.dshl-config-group-body{display:grid;grid-template-rows:1fr}
.dshl-config-group-clip{min-height:0;overflow:hidden}.dshl-config-group-content{padding-bottom:8px}
.dshl-config-group[data-collapsible]{--config-group-height-duration:220ms;--config-group-border-duration:120ms;transition:border-color var(--config-group-border-duration) ease}
.dshl-config-group[data-collapsible]>.dshl-config-group-body{transition:grid-template-rows var(--config-group-height-duration) ease var(--config-group-border-duration)}
.dshl-config-group[data-expanded=false]{border-color:transparent;transition-delay:var(--config-group-height-duration)}
.dshl-config-group[data-expanded=false]>.dshl-config-group-body{grid-template-rows:0fr;transition-delay:0s}
.dshl-config .dshl-config-group-toggle{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:3px;padding:0;font-weight:inherit;text-align:start}
.dshl-config-group-toggle:focus-visible{outline:2px solid Highlight;outline-offset:3px}
.dshl-config-group-triangle{width:12px;height:12px;flex:none;transition:transform 180ms ease}
.dshl-config-group[data-expanded=true]>legend .dshl-config-group-triangle{transform:rotate(90deg)}
@media(prefers-reduced-motion:reduce){.dshl-config-group[data-collapsible],.dshl-config-group[data-collapsible]>.dshl-config-group-body,.dshl-config-group-triangle{transition:none}}
.dshl-config-help{font-size:12px;opacity:.7;margin-top:4px}.dshl-config-error{color:var(--color-danger,#d33);font-size:13px;overflow-wrap:anywhere}
.dshl-config-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.dshl-config button{font:inherit;color:inherit;background:transparent;border:1px solid var(--color-border,#8888);border-radius:6px;padding:6px 12px;cursor:pointer}.dshl-config button:disabled{opacity:.5;cursor:default}
.dshl-config-card[data-layout=plugins] .dshl-config-save{position:sticky;top:var(--plugin-header-scroll-padding,0px);z-index:2;margin-top:0;margin-bottom:12px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#8886);background:var(--dsw-alias-bg-base,Canvas);align-items:center}
.dshl-config-card[data-layout=plugins] .dshl-config-save>button[type=submit]{background:var(--dsw-alias-button-primary-fill,Highlight);color:var(--dsw-alias-label-primary-foreground,HighlightText);border-color:transparent}
.dshl-config-save-feedback{flex-basis:100%;font-size:12px}.dshl-config-save-feedback:empty{display:none}.dshl-config-save-feedback p{margin:0}
.dshl-config-item-array>.dshl-config-control{grid-column:1 / -1}
.dshl-config-array{min-width:0}.dshl-config-array>section{border-left:2px solid #8885;padding-left:8px;margin:8px 0}
.dshl-config-panel{border-top:1px solid var(--color-border,#8886);margin-top:24px;padding-top:8px;min-width:0}
.dshl-config-panel h3{font-size:1em}.dshl-config-result,.dshl-config-json{margin-top:12px;overflow-wrap:anywhere;min-width:0}
.dshl-config-result pre,.dshl-config-json pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;font-size:.9em}
.dshl-config-result img{max-width:100%}.dshl-config-json{border:1px solid var(--color-border,#8886);border-radius:8px;padding:8px}
@media(max-width:480px){.dshl-config-card{padding:8px}.dshl-config-item{gap:8px}.dshl-config-group{padding-left:8px;padding-right:8px}.dshl-config-control input,.dshl-config-control select{min-width:0}}
`;
export function ConfigCard({ view, client, dialogs, layout = 'settings', registerSave, onSaved }: { view: ConfigView; client: ConfigClient; dialogs?: ConfigDialogsAPI; layout?: BootDescriptor['capabilities']['configUI']; registerSave?: ConfigSaveRegistration; onSaved?(): void }): React.ReactElement {
  const [base, setBase] = React.useState(view);
  const [draft, setDraft] = React.useState(view.value);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [open, setOpen] = React.useState(false);
  const form = React.useRef<HTMLDivElement>(null);
  const prefix = React.useId();
  const pendingSave = React.useRef<Promise<boolean>>();
  const embedded = new Set<string>();
  const collectPanels = (fields: ConfigField[]) => {
    for (const field of fields) {
      if (field.panel) { embedded.add(field.panel); }
      if (field.fields) { collectPanels(field.fields); }
      if (field.item) { collectPanels([field.item]); }
    }
  };
  collectPanels(view.template.fields);
  const renderPanel = (id: string, inline = false) => {
    const panel = view.template.panels?.find(panel => panel.id === id);
    if (!panel) { return null; }
    if (!panel.custom) { return <OperationPanel key={id} pluginId={view.template.id} panel={panel} client={client} saved={base.revision > view.revision ? base.value : view.value} available={view.availableOperations}/>; }
    const Component = dialogs?.panelComponent(view.template.id, id);
    return <section key={id} className={inline ? undefined : 'dshl-config-panel'} data-config-panel={id}>
      {!inline && <h3>{panel.title}</h3>}
      {panel.description && <p className="dshl-config-help">{panel.description}</p>}
      {Component ? <PanelBoundary component={Component}><Component view={base.revision > view.revision ? base : view} client={client}/></PanelBoundary> : <p role="status">请启用插件客户端以显示此管理面板。</p>}
    </section>;
  };
  const [, refreshDialogs] = React.useReducer(value => value + 1, 0);
  React.useEffect(() => dialogs?.subscribe(refreshDialogs), [dialogs]);
  React.useEffect(() => { if (!dirty && view.revision >= base.revision) { setBase(view); setDraft(view.value); } }, [view, dirty, base.revision]);
  React.useLayoutEffect(() => {
    const root = form.current; if (!root || !open) return;
    const measure = () => {
      const widths = [...root.querySelectorAll<HTMLElement>('.dshl-config-label span')].filter(label => !label.closest('.dshl-config-group-body[aria-hidden=true]')).map(label => label.getBoundingClientRect().width);
      const width = `${Math.ceil(Math.max(0, ...widths))}px`;
      if (root.style.getPropertyValue('--config-label-width') !== width) root.style.setProperty('--config-label-width', width);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    root.querySelectorAll('.dshl-config-label span').forEach(label => observer?.observe(label));
    const groups = new MutationObserver(() => { root.querySelectorAll('.dshl-config-label span').forEach(label => observer?.observe(label)); measure(); });
    groups.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-hidden'] });
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { groups.disconnect(); observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [open, draft, view.template]);
  const save = (): Promise<boolean> => {
    if (pendingSave.current) { return pendingSave.current; }
    setBusy(true); setError(''); setErrors({});
    const pending = Promise.resolve().then(async () => {
      try { const saved = await client.update(view.template.id, draft, base.revision); currentSave.current.dirty = false; setBase(saved); setDraft(saved.value); setDirty(false); return true; }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (cause instanceof ConfigError) { setErrors(cause.fields); } return false; }
      finally { pendingSave.current = undefined; setBusy(false); }
    });
    pendingSave.current = pending;
    return pending;
  };
  const currentSave = React.useRef<ConfigSaveAction>({ dirty, save }); currentSave.current = { dirty, save };
  React.useLayoutEffect(() => registerSave?.(view.template.id, () => currentSave.current), [registerSave, view.template.id]);
  const feedback = <>
    {dirty && view.revision !== base.revision && <p role="status">配置已有更新；保存前请取消修改以加载最新值。</p>}
    {error && <p role="alert" className="dshl-config-error">{error}</p>}
  </>;
  const actions = <div className="dshl-config-actions dshl-config-save"><button type="submit" title="Ctrl+S 保存本页全部已修改配置" disabled={busy || !dirty}>{busy ? '保存中…' : '保存'}</button><button type="button" disabled={busy} onClick={() => { const latest = view.revision >= base.revision ? view : base; setBase(latest); setDraft(latest.value); setDirty(false); setError(''); setErrors({}); }}>取消修改</button><button type="button" disabled={busy} onClick={() => { setDraft(structuredClone(view.defaults)); setDirty(true); }}>恢复默认值</button>{layout === 'plugins' && <div className="dshl-config-save-feedback">{feedback}{dirty && !error && view.revision === base.revision && <span role="status">有未保存的修改</span>}</div>}</div>;
  return <details className="dshl-config-card" data-layout={layout} onToggle={event => setOpen(event.currentTarget.open)}><summary>{view.template.title}</summary>{view.template.description && <p>{view.template.description}</p>}<div className="dshl-config-form" ref={form}><form noValidate onSubmit={event => { event.preventDefault(); void save().then(success => { if (success) { onSaved?.(); } }); }}>
    {layout === 'plugins' && actions}
    <fieldset className="dshl-config-fields" disabled={busy}><Fields disabled={busy} panel={id => renderPanel(id, true)} dialog={(field, path, id) => <button type="button" id={id} disabled={!dialogs?.hasDialog(view.template.id, field.dialog!.id, path)} onClick={() => { void dialogs!.openDialog(view.template.id, field.dialog!.id, path).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))); }}>{field.dialog!.label ?? '打开配置弹窗'}</button>} fields={view.template.fields} draft={draft} errors={errors} prefix={prefix} change={(path, value) => { setDraft(current => setAt(current, path, value)); setDirty(true); }}/></fieldset>
    {layout === 'settings' && <>{feedback}{actions}</>}
  </form>{view.template.panels?.filter(panel => !embedded.has(panel.id)).map(panel => renderPanel(panel.id))}</div></details>;
}
export function ConfigPage({ client, ids, dialogs, loadModels, layout = 'settings' }: { client: ConfigClient; ids?: string[]; dialogs?: ConfigDialogsAPI; loadModels?: ConfigModelSource; layout?: BootDescriptor['capabilities']['configUI'] }): React.ReactElement {
  const [views, setViews] = React.useState<ConfigView[]>([]);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState<{ id: number; text: string; success: boolean }>();
  const notices = React.useRef(0), saves = React.useRef(new Map<string, () => ConfigSaveAction>());
  const savingAll = React.useRef<Promise<void>>();
  const saveQueued = React.useRef(false);
  const shortcutHeld = React.useRef(false);
  const notify = React.useCallback((text: string, success: boolean) => setNotice({ id: ++notices.current, text, success }), []);
  const registerSave = React.useCallback<ConfigSaveRegistration>((id, current) => {
    saves.current.set(id, current);
    return () => { if (saves.current.get(id) === current) { saves.current.delete(id); } };
  }, []);
  const onSaved = React.useCallback(() => { if (!savingAll.current) { notify('配置已保存', true); } }, [notify]);
  const changedCards = () => [...saves.current].map(([id, current]) => ({ id, action: current() })).filter(entry => entry.action.dirty);
  const saveAll = () => {
    if (savingAll.current) { saveQueued.current = true; return; }
    const changed = changedCards();
    if (!changed.length) { notify('没有未保存的配置修改', true); return; }
    setNotice(undefined); saveQueued.current = false;
    savingAll.current = Promise.resolve().then(async () => {
      const outcomes = new Map<string, boolean>();
      let batch = changed;
      while (batch.length) {
        const results = await Promise.allSettled(batch.map(entry => entry.action.save()));
        results.forEach((result, index) => outcomes.set(batch[index].id, result.status === 'fulfilled' && result.value));
        if (!saveQueued.current) { break; }
        saveQueued.current = false; batch = changedCards();
      }
      const saved = [...outcomes.values()].filter(Boolean).length, failed = outcomes.size - saved;
      const text = failed ? `已保存 ${saved} 项配置，${failed} 项保存失败，请检查错误提示`
        : changedCards().length ? `本次已保存 ${saved} 项配置，仍有新的修改未保存` : `已保存全部 ${saved} 项配置`;
      notify(text, failed === 0);
    }).finally(() => { savingAll.current = undefined; saveQueued.current = false; });
  };
  const keydown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !saveShortcut(event.nativeEvent) || !(event.target instanceof Element)
      || !event.target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]')) { return; }
    event.preventDefault(); event.stopPropagation(); shortcutHeld.current = true; saveAll();
  };
  React.useEffect(() => {
    const repeat = (event: KeyboardEvent) => {
      if (event.repeat && shortcutHeld.current && saveShortcut(event)) { event.preventDefault(); event.stopPropagation(); }
    };
    const release = () => { shortcutHeld.current = false; };
    const keyup = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 's' || event.key === 'Control') { release(); } };
    document.addEventListener('keydown', repeat, true);
    document.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', release);
    return () => { release(); document.removeEventListener('keydown', repeat, true); document.removeEventListener('keyup', keyup, true); window.removeEventListener('blur', release); };
  }, []);
  React.useEffect(() => {
    let active = true, generation = 0;
    const refresh = () => { const current = ++generation; void client.list().then(value => { if (active && current === generation) { setViews(value); setError(''); } }, cause => { if (active && current === generation) setError(String(cause)); }); };
    const off = client.subscribe(refresh); refresh();
    return () => { active = false; off(); };
  }, [client]);
  return <ConfigModelsContext.Provider value={loadModels}><div className="dshl-config" aria-keyshortcuts="Control+S" onKeyDownCapture={keydown}><style data-plugin="@dsh-plugin/dsh-loader" data-plugin-css="@dsh-plugin/dsh-loader/ui/config.css">{CONFIG_CSS}</style>{error && <p role="alert">{error}</p>}{views.filter(view => !ids || ids.includes(view.template.id)).map(view => <ConfigCard key={view.template.id} view={view} client={client} dialogs={dialogs} layout={layout} registerSave={registerSave} onSaved={onSaved}/>)}{!views.length && !error && <p>暂无已注册的插件配置。</p>}{notice && <ConfigToast key={notice.id} text={notice.text} success={notice.success} onDone={() => setNotice(current => current?.id === notice.id ? undefined : current)}/>}</div></ConfigModelsContext.Provider>;
}
/** All slot registration is loader-owned; plugins supply only templates. */
export function installConfigUI(ctx: any, client: ConfigClient, boot: BootDescriptor, dialogs?: ConfigDialogsAPI, loadModels?: ConfigModelSource): () => void {
  let disposed = false;
  let generation = 0;
  const registrations = new Map<string, () => void>();
  const slots = ctx.get?.('slots');
  if (!slots) return () => {};
  const add = (name: string, id: string, ids?: string[]) => {
    const off = slots.inject(name, () => slots.register({ name, id: `dshloader:${id}`, ...(name !== 'settings.section' ? { key: id } : {}), label: () => '插件配置', order: 40, inject: () => ({}) }, () => <ConfigPage client={client} ids={ids} dialogs={dialogs} loadModels={loadModels} layout={boot.capabilities.configUI}/>));
    registrations.set(id, typeof off === 'function' ? off : () => {});
  };
  const sync = async () => {
    const token = ++generation;
    try {
      const views = await client.list(); if (disposed || generation !== token) return;
      const groups = new Map<string, { slot: string; ids: string[] }>();
      for (const { template } of views) {
        const key = template.packageName + (template.rowId ? `#${template.rowId}` : '');
        const group = groups.get(key) ?? { slot: template.rowId ? 'plugins.row.config' : 'plugins.bundle.config', ids: [] };
        group.ids.push(template.id); groups.set(key, group);
      }
      // Replace only when the registration set changes, never on ordinary saves.
      const signature = JSON.stringify([...groups]);
      if (signature === lastSignature) return;
      lastSignature = signature;
      for (const off of registrations.values()) off(); registrations.clear();
      for (const [key, group] of groups) add(group.slot, key, group.ids);
    } catch (error) { if (!disposed) console.error('[dshloader] config UI registration failed', error); }
  };
  let lastSignature = '';
  if (boot.capabilities.configUI === 'settings') add('settings.section', 'plugin-config');
  const off = boot.capabilities.configUI === 'plugins' ? client.subscribe(() => { void sync(); }) : () => {};
  if (boot.capabilities.configUI === 'plugins') void sync();
  return () => { disposed = true; off(); for (const release of registrations.values()) release(); registrations.clear(); };
}
