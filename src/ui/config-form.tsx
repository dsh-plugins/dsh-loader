import * as React from 'react';
import { fieldDefault, type ConfigField, type ConfigValue, type ConfigValues, type ConfigView, ConfigError } from '../config.js';
import type { ConfigClient } from '../config-client.js';
import type { BootDescriptor } from '../bootstrap.js';

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
.dshl-config-group{border:1px solid var(--color-border,#8888);border-radius:10px;min-width:0;margin:16px 0;padding:0 12px 8px}
.dshl-config-group legend{padding:0 8px;margin-left:4px;font-weight:500;max-width:100%;overflow-wrap:anywhere}
.dshl-config-help{font-size:12px;opacity:.7;margin-top:4px}.dshl-config-error{color:var(--color-danger,#d33);font-size:13px;overflow-wrap:anywhere}
.dshl-config-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.dshl-config button{font:inherit;color:inherit;background:transparent;border:1px solid var(--color-border,#8888);border-radius:6px;padding:6px 12px;cursor:pointer}.dshl-config button:disabled{opacity:.5;cursor:default}
.dshl-config-item-array>.dshl-config-control{grid-column:1 / -1}
.dshl-config-array{min-width:0}.dshl-config-array>section{border-left:2px solid #8885;padding-left:8px;margin:8px 0}
@media(max-width:480px){.dshl-config-card{padding:8px}.dshl-config-item{gap:8px}.dshl-config-group{padding-left:8px;padding-right:8px}.dshl-config-control input,.dshl-config-control select{min-width:0}}
`;
function at(value: ConfigValues, path: string[]): ConfigValue | undefined { return path.reduce<any>((v, key) => v?.[key], value); }
function setAt(value: ConfigValues, path: string[], next: ConfigValue): ConfigValues {
  const copy = structuredClone(value); let target: any = copy;
  for (const key of path.slice(0, -1)) target = target[key] ??= {};
  target[path.at(-1)!] = next; return copy;
}
function Fields({ fields, draft, path = [], change, errors, prefix }: { fields: ConfigField[]; draft: ConfigValues; path?: string[]; change(path: string[], value: ConfigValue): void; errors: Record<string, string>; prefix: string }): React.ReactElement {
  return <>{fields.map((field, index) => {
    if (field.visibleWhen && JSON.stringify(at(draft, field.visibleWhen.path)) !== JSON.stringify(field.visibleWhen.equals)) return null;
    const next = field.type === 'group' ? path : [...path, field.key!];
    const key = next.join('.') + ':' + index;
    if (field.type === 'group' || field.type === 'object') return <fieldset className="dshl-config-group" key={key}><legend>{field.label}</legend>{field.description && <p className="dshl-config-help">{field.description}</p>}<Fields fields={field.fields!} draft={draft} path={next} change={change} errors={errors} prefix={prefix}/></fieldset>;
    const value = at(draft, next) ?? fieldDefault(field);
    const id = `${prefix}-${next.map(encodeURIComponent).join('.')}`;
    const error = errors[next.join('.')];
    let control: React.ReactNode;
    const props = { id, 'aria-invalid': Boolean(error), 'aria-describedby': field.description || error ? `${id}-help` : undefined };
    if (field.type === 'array') control = <div className="dshl-config-array">{(Array.isArray(value) ? value : []).map((_, itemIndex) => <section key={itemIndex}><Fields fields={[{ ...field.item!, key: String(itemIndex) }]} path={next} draft={draft} change={change} errors={errors} prefix={prefix}/><button type="button" onClick={() => change(next, (value as ConfigValue[]).filter((_, i) => i !== itemIndex))}>删除第 {itemIndex + 1} 项</button></section>)}<button type="button" onClick={() => change(next, [...value as ConfigValue[], fieldDefault(field.item!)])}>新增</button></div>;
    else if (field.type === 'boolean') control = <input {...props} type="checkbox" checked={value === true} onChange={event => change(next, event.target.checked)}/>;
    else if (field.type === 'select' || field.type === 'multiselect') control = <select {...props} multiple={field.type === 'multiselect'} value={field.type === 'multiselect' ? (value as ConfigValue[]).map(item => JSON.stringify(item)) : JSON.stringify(value)} onChange={event => {
      const decode = (text: string) => field.options!.find(option => JSON.stringify(option.value) === text)!.value;
      change(next, field.type === 'multiselect' ? [...event.target.selectedOptions].map(option => decode(option.value)) : decode(event.target.value));
    }}>{field.options!.map(option => <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{option.label}</option>)}</select>;
    else if (field.type === 'textarea') control = <textarea {...props} value={String(value)} onChange={event => change(next, event.target.value)}/>;
    else control = <input {...props} type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.type === 'password' ? 'new-password' : undefined} value={typeof value === 'object' ? '' : String(value)} placeholder={field.type === 'password' && value && typeof value === 'object' && !Array.isArray(value) && value.set ? '已设置，留空保持不变' : undefined} min={field.min} max={field.max} onChange={event => change(next, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}/>;
    return <div className={'dshl-config-item' + (field.type === 'array' ? ' dshl-config-item-array' : '')} key={key}><label className="dshl-config-label" htmlFor={id}><span>{field.label}{field.required ? ' *' : ''}</span></label><div className="dshl-config-control">{control}{field.type === 'password' && <button type="button" onClick={() => change(next, '')}>清空</button>}<div id={`${id}-help`}>{field.description && <div className="dshl-config-help">{field.description}</div>}{error && <div className="dshl-config-error">{error}</div>}</div></div></div>;
  })}</>;
}
export function ConfigCard({ view, client }: { view: ConfigView; client: ConfigClient }): React.ReactElement {
  const [base, setBase] = React.useState(view);
  const [draft, setDraft] = React.useState(view.value);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [open, setOpen] = React.useState(false);
  const form = React.useRef<HTMLFormElement>(null);
  const prefix = React.useId();
  React.useEffect(() => { if (!dirty && view.revision >= base.revision) { setBase(view); setDraft(view.value); } }, [view, dirty, base.revision]);
  React.useLayoutEffect(() => {
    const root = form.current; if (!root || !open) return;
    const measure = () => {
      const widths = [...root.querySelectorAll<HTMLElement>('.dshl-config-label span')].map(label => label.getBoundingClientRect().width);
      const width = `${Math.ceil(Math.max(0, ...widths))}px`;
      if (root.style.getPropertyValue('--config-label-width') !== width) root.style.setProperty('--config-label-width', width);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    root.querySelectorAll('.dshl-config-label span').forEach(label => observer?.observe(label));
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { observer?.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [open, draft, view.template]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setErrors({});
    try { const saved = await client.update(view.template.id, draft, base.revision); setBase(saved); setDraft(saved.value); setDirty(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); if (cause instanceof ConfigError) setErrors(cause.fields); }
    finally { setBusy(false); }
  };
  return <details className="dshl-config-card" onToggle={event => setOpen(event.currentTarget.open)}><summary>{view.template.title}</summary>{view.template.description && <p>{view.template.description}</p>}<form noValidate className="dshl-config-form" ref={form} onSubmit={save}>
    <fieldset className="dshl-config-fields" disabled={busy}><Fields fields={view.template.fields} draft={draft} errors={errors} prefix={prefix} change={(path, value) => { setDraft(current => setAt(current, path, value)); setDirty(true); }}/></fieldset>
    {dirty && view.revision !== base.revision && <p role="status">配置已有更新；保存前请取消修改以加载最新值。</p>}
    {error && <p role="alert" className="dshl-config-error">{error}</p>}
    <div className="dshl-config-actions"><button type="submit" disabled={busy || !dirty}>{busy ? '保存中…' : '保存'}</button><button type="button" disabled={busy} onClick={() => { const latest = view.revision >= base.revision ? view : base; setBase(latest); setDraft(latest.value); setDirty(false); setError(''); setErrors({}); }}>取消修改</button><button type="button" disabled={busy} onClick={() => { setDraft(structuredClone(view.defaults)); setDirty(true); }}>恢复默认值</button></div>
  </form></details>;
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
