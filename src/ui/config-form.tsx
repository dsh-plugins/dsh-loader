import * as React from 'react';
import { type ConfigView, ConfigError } from '../config.js';
import type { ConfigClient } from '../config-client.js';
import type { BootDescriptor } from '../bootstrap.js';
import { Fields, setAt } from './config-fields.js';
import { OperationPanel } from './config-operations.js';

export const CONFIG_CSS = `
.dshl-config{color:var(--color-text-primary,inherit);font:inherit;width:100%;box-sizing:border-box}
.dshl-config-card{border:1px solid var(--color-border,#8886);border-radius:12px;margin:12px 0;padding:12px;min-width:0}
.dshl-config-card summary{cursor:pointer;font-weight:600}.dshl-config-card summary:focus-visible{outline:2px solid Highlight}
.dshl-config-form{--config-label-width:0px;margin-top:16px;min-width:0}
.dshl-config-fields{border:0;margin:0;padding:0;min-width:0}
.dshl-config-item{display:grid;grid-template-columns:var(--config-label-width) minmax(0,1fr);gap:12px;align-items:start;margin:12px 0}
.dshl-config-label{padding-top:6px;white-space:nowrap}.dshl-config-label span{display:inline-block}
.dshl-config-control{min-width:0}.dshl-config-control input:not([type=checkbox]),.dshl-config-control select,.dshl-config-control textarea{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:transparent;border:1px solid var(--color-border,#8888);border-radius:6px;padding:6px}
.dshl-config-control option{color:CanvasText;background:Canvas}.dshl-config-control textarea{min-height:80px}
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
.dshl-config-item-array>.dshl-config-control{grid-column:1 / -1}
.dshl-config-array{min-width:0}.dshl-config-array>section{border-left:2px solid #8885;padding-left:8px;margin:8px 0}
.dshl-config-panel{border-top:1px solid var(--color-border,#8886);margin-top:24px;padding-top:8px;min-width:0}
.dshl-config-panel h3{font-size:1em}.dshl-config-result,.dshl-config-json{margin-top:12px;overflow-wrap:anywhere;min-width:0}
.dshl-config-result pre,.dshl-config-json pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto;font-size:.9em}
.dshl-config-result img{max-width:100%}.dshl-config-json{border:1px solid var(--color-border,#8886);border-radius:8px;padding:8px}
@media(max-width:480px){.dshl-config-card{padding:8px}.dshl-config-item{gap:8px}.dshl-config-group{padding-left:8px;padding-right:8px}.dshl-config-control input,.dshl-config-control select{min-width:0}}
`;
export function ConfigCard({ view, client }: { view: ConfigView; client: ConfigClient }): React.ReactElement {
  const [base, setBase] = React.useState(view);
  const [draft, setDraft] = React.useState(view.value);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [open, setOpen] = React.useState(false);
  const form = React.useRef<HTMLDivElement>(null);
  const prefix = React.useId();
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
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setErrors({});
    try { const saved = await client.update(view.template.id, draft, base.revision); setBase(saved); setDraft(saved.value); setDirty(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (cause instanceof ConfigError) setErrors(cause.fields); }
    finally { setBusy(false); }
  };
  return <details className="dshl-config-card" onToggle={event => setOpen(event.currentTarget.open)}><summary>{view.template.title}</summary>{view.template.description && <p>{view.template.description}</p>}<div className="dshl-config-form" ref={form}><form noValidate onSubmit={save}>
    <fieldset className="dshl-config-fields" disabled={busy}><Fields fields={view.template.fields} draft={draft} errors={errors} prefix={prefix} change={(path, value) => { setDraft(current => setAt(current, path, value)); setDirty(true); }}/></fieldset>
    {dirty && view.revision !== base.revision && <p role="status">配置已有更新；保存前请取消修改以加载最新值。</p>}
    {error && <p role="alert" className="dshl-config-error">{error}</p>}
    <div className="dshl-config-actions"><button type="submit" disabled={busy || !dirty}>{busy ? '保存中…' : '保存'}</button><button type="button" disabled={busy} onClick={() => { const latest = view.revision >= base.revision ? view : base; setBase(latest); setDraft(latest.value); setDirty(false); setError(''); setErrors({}); }}>取消修改</button><button type="button" disabled={busy} onClick={() => { setDraft(structuredClone(view.defaults)); setDirty(true); }}>恢复默认值</button></div>
  </form>{view.template.panels?.map(panel => <OperationPanel key={panel.id} pluginId={view.template.id} panel={panel} client={client} saved={base.revision > view.revision ? base.value : view.value} available={view.availableOperations}/>)}</div></details>;
}
export function ConfigPage({ client, ids }: { client: ConfigClient; ids?: string[] }): React.ReactElement {
  const [views, setViews] = React.useState<ConfigView[]>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let active = true, generation = 0;
    const refresh = () => { const current = ++generation; void client.list().then(value => { if (active && current === generation) { setViews(value); setError(''); } }, cause => { if (active && current === generation) setError(String(cause)); }); };
    const off = client.subscribe(refresh); refresh();
    return () => { active = false; off(); };
  }, [client]);
  return <div className="dshl-config"><style>{CONFIG_CSS}</style>{error && <p role="alert">{error}</p>}{views.filter(view => !ids || ids.includes(view.template.id)).map(view => <ConfigCard key={view.template.id} view={view} client={client}/>)}{!views.length && !error && <p>暂无已注册的插件配置。</p>}</div>;
}
/** All slot registration is loader-owned; plugins supply only templates. */
export function installConfigUI(ctx: any, client: ConfigClient, boot: BootDescriptor): () => void {
  let disposed = false;
  let generation = 0;
  const registrations = new Map<string, () => void>();
  const slots = ctx.get?.('slots');
  if (!slots) return () => {};
  const add = (name: string, id: string, ids?: string[]) => {
    const off = slots.inject(name, () => slots.register({ name, id: `dshloader:${id}`, ...(name !== 'settings.section' ? { key: id } : {}), label: () => '插件配置', order: 40, inject: () => ({}) }, () => <ConfigPage client={client} ids={ids}/>));
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
