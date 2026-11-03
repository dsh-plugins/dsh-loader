import * as React from 'react';
import { createPortal } from 'react-dom';
import type { ConfigModelValue } from '../config.js';
import type { ConfigModelList, ConfigModelOption, ConfigModelSource } from './config-model-source.js';

export const ConfigModelsContext = React.createContext<ConfigModelSource | undefined>(undefined);

/** 模型选择器的受控值与目录读取入口；选择结果交由所在表单保存。 */
export interface ModelSelectProps {
  value: ConfigModelValue | null;
  onChange(value: ConfigModelValue | null): void;
  loadModels?: ConfigModelSource;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  label?: string;
  invalid?: boolean;
  describedBy?: string;
}

const CSS = `
.dshl-model{display:inline-flex;max-width:100%;font:inherit;color:inherit}
.dshl-model .dshl-model-trigger{display:flex;align-items:center;gap:6px;max-width:100%;min-height:30px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2,#8886);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#8881);color:inherit;font:inherit;cursor:pointer}
.dshl-model-trigger:disabled{opacity:.5;cursor:default}.dshl-model-trigger[aria-invalid=true]{border-color:var(--dsw-alias-status-danger,#d33)}
.dshl-model-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.dshl-model-muted{color:var(--dsw-alias-label-secondary,GrayText)}
.dshl-model-effort{white-space:nowrap;font-size:.92em}.dshl-model-caret{width:12px;height:12px;flex:none}.dshl-model-trigger[aria-expanded=true]>.dshl-model-caret{transform:rotate(180deg)}
.dshl-model-popup{position:fixed;z-index:1000;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;padding:5px;border:1px solid var(--dsw-alias-border-l2,#8884);border-radius:13px;background:var(--dsw-alias-bg-base,Canvas);color:var(--dsw-alias-label-primary,CanvasText);box-shadow:0 8px 28px #0003;font:13px/1.4 system-ui}
.dshl-model-popup button{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;flex:none;border:0;border-radius:8px;padding:8px 7px;background:transparent;color:inherit;text-align:start;font:inherit;cursor:pointer}
.dshl-model-popup button:disabled{opacity:.5;cursor:default}.dshl-model-popup button:hover:not(:disabled),.dshl-model-popup button[aria-selected=true]{background:var(--dsw-alias-bg-hover,#8882)}
.dshl-model button:focus-visible,.dshl-model-popup button:focus-visible,.dshl-model-popup input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,Highlight);outline-offset:-2px}
.dshl-model-popup .dshl-model-back{gap:7px;font-weight:500}.dshl-model-back svg{transform:rotate(90deg)}.dshl-model-popup button[data-model-choice]>.dshl-model-caret{transform:rotate(-90deg)}
.dshl-model-popup .dshl-model-search{box-sizing:border-box;flex:none;width:100%;padding:8px 7px;margin:2px 0 5px;border:0;border-radius:7px;background:transparent;color:inherit;font:inherit}
.dshl-model-list{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2,#8888) transparent}
.dshl-model-group{padding:9px 7px 5px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,GrayText)}
.dshl-model-row-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshl-model-row-value{min-width:0;max-width:75%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,GrayText)}
.dshl-model-check{width:14px;height:14px;flex:none}.dshl-model-note{padding:8px 7px;margin:0;font-size:12px;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary,GrayText)}
.dshl-model-note[role=alert]{color:var(--dsw-alias-status-danger,#d33)}.dshl-model-footer{border-top:1px solid var(--dsw-alias-border-l1,#8884);margin-top:4px;padding-top:4px;flex:0 1 auto;min-height:0;max-height:150px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}
.dshl-model-popup .dshl-model-refresh{font-size:12px;color:var(--dsw-alias-label-secondary,GrayText)}
`;

function Caret(): React.ReactElement {
  return <svg className="dshl-model-caret" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function Check(): React.ReactElement {
  return <svg className="dshl-model-check" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

/** 按提供商搜索模型，并在同一弹层中编辑该模型实际支持的推理等级。 */
export function ModelSelect({ value, onChange, loadModels, required, disabled, id, label = '模型', invalid, describedBy }: ModelSelectProps): React.ReactElement {
  const inheritedSource = React.useContext(ConfigModelsContext);
  const source = loadModels ?? inheritedSource;
  const identity = React.useId();
  const popupId = `${identity}-models`;
  const trigger = React.useRef<HTMLButtonElement>(null);
  const popup = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [page, setPage] = React.useState<'overview' | 'models' | 'reasoning'>('overview');
  const [query, setQuery] = React.useState('');
  const [models, setModels] = React.useState<ConfigModelList>();
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [reload, refresh] = React.useReducer(count => count + 1, 0);
  const [position, setPosition] = React.useState<React.CSSProperties>({});
  const selectedGroup = models?.groups.find(group => group.id === value?.provider);
  const selected = selectedGroup?.models.find(model => model.id === value?.model);
  const efforts = selected?.reasoning?.efforts ?? [];
  const effortId = value?.reasoningEffort ?? selected?.reasoning?.defaultEffort;
  const effortName = efforts.find(effort => effort.id === effortId)?.name ?? value?.reasoningEffort;
  const unavailable = Boolean(value && models && !loading && !error && !selected);
  const invalidEffort = Boolean(selected && value?.reasoningEffort && !efforts.some(effort => effort.id === value.reasoningEffort));
  const name = selected?.name ?? value?.model ?? '选择模型';
  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) { trigger.current?.focus(); }
  }, []);

  React.useEffect(() => { if (disabled) { close(false); } }, [disabled, close]);
  React.useEffect(() => {
    if (!open) { return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      if (!source) { throw new Error('模型目录尚未连接，请稍后重试'); }
      return source(controller.signal);
    }).then(result => {
      if (!controller.signal.aborted) { setModels(result); }
    }, cause => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }).finally(() => { if (!controller.signal.aborted) { setLoading(false); } });
    return () => controller.abort();
  }, [open, reload, source]);

  React.useLayoutEffect(() => {
    if (!open) { return; }
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) { return; }
      if (rect.bottom < 0 || rect.top > window.innerHeight) { close(false); return; }
      const margin = 12, gap = 6;
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - margin * 2);
      const above = rect.top - margin - gap, below = window.innerHeight - rect.bottom - margin - gap;
      const preferBelow = below >= Math.min(380, above);
      setPosition({ width: Math.max(0, width), maxHeight: Math.max(0, Math.min(380, preferBelow ? below : above)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        ...(preferBelow ? { top: Math.max(margin, rect.bottom + gap) } : { bottom: Math.max(margin, window.innerHeight - rect.top + gap) }) });
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (trigger.current) { observer?.observe(trigger.current); }
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, close]);

  React.useEffect(() => {
    if (!open) { return; }
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !popup.current?.contains(target) && !trigger.current?.contains(target)) { close(false); }
    };
    const blur = () => close(false);
    document.addEventListener('pointerdown', outside, true); document.addEventListener('focusin', outside);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('focusin', outside); window.removeEventListener('blur', blur); };
  }, [open, close]);
  React.useLayoutEffect(() => {
    if (open) {
      const root = popup.current;
      const initial = root?.querySelector<HTMLElement>('input')
        ?? root?.querySelector<HTMLElement>('[aria-selected=true]')
        ?? root?.querySelector<HTMLElement>('[data-model-choice]');
      initial?.focus();
    }
  }, [open, page]);

  const chooseModel = (provider: string, model: ConfigModelOption) => {
    const available = model.reasoning?.efforts ?? [];
    const previous = value?.reasoningEffort;
    const effort = previous && available.some(item => item.id === previous) ? previous : model.reasoning?.defaultEffort;
    onChange({ provider, model: model.id, ...(effort && available.some(item => item.id === effort) ? { reasoningEffort: effort } : {}) });
    close();
  };
  const keyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) { return; }
    if (event.key === 'Escape' || event.key === 'ArrowLeft' && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault(); event.stopPropagation();
      if (page === 'overview' || event.key === 'Escape' && page === 'models' && !value) { close(); }
      else { setPage('overview'); }
      return;
    }
    const choices = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-model-choice]:not(:disabled)')];
    const current = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || !(event.target instanceof HTMLInputElement) && ['Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? choices.length - 1 : 0) : (current + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
      choices[index]?.focus(); choices[index]?.scrollIntoView?.({ block: 'nearest' });
    }
  };
  const search = query.trim().toLocaleLowerCase();
  const groups = models?.groups.map(group => ({ ...group, models: group.models.filter(model =>
    [group.id, group.name, model.id, model.name].some(text => text.toLocaleLowerCase().includes(search))) })).filter(group => group.models.length);
  const listId = `${popupId}-list`;

  return <span className="dshl-model"><style data-plugin="@dsh-plugin/dsh-loader" data-plugin-css="@dsh-plugin/dsh-loader/ui/model-select.css">{CSS}</style><button ref={trigger} id={id} className="dshl-model-trigger" type="button" disabled={disabled}
    aria-label={`${label}：${name}${effortName ? ` ${effortName}` : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popupId : undefined}
    aria-invalid={invalid} aria-describedby={describedBy} title={value ? `${value.provider} / ${value.model}` : label}
    onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setPage(value ? 'overview' : 'models'); setQuery(''); setOpen(true); } }}
    onClick={() => { if (open) { close(); } else { setPage(value ? 'overview' : 'models'); setQuery(''); setOpen(true); } }}>
    <span className={'dshl-model-name' + (!value ? ' dshl-model-muted' : '')}>{name}</span>{effortName && <span className="dshl-model-effort dshl-model-muted">{effortName}</span>}<Caret/>
  </button>{open && createPortal(<div ref={popup} id={popupId} role="dialog" aria-label={`${label}选择器`} className="dshl-model-popup" style={position} onKeyDown={keyboard}>
    {page !== 'overview' && <button type="button" className="dshl-model-back" onClick={() => setPage('overview')}><Caret/>{page === 'models' ? '模型' : '推理等级'}</button>}
    {page === 'overview' ? <>
      <button type="button" data-model-choice onClick={() => { setQuery(''); setPage('models'); }}><span className="dshl-model-row-label">模型</span><span className="dshl-model-row-value" title={value ? `${value.provider} / ${value.model}` : undefined}>{name}</span><Caret/></button>
      {Boolean(efforts.length || value?.reasoningEffort) && <button type="button" data-model-choice disabled={!efforts.length} onClick={() => setPage('reasoning')}><span className="dshl-model-row-label">推理等级</span><span className="dshl-model-row-value">{effortName ?? '默认'}</span><Caret/></button>}
    </> : page === 'models' ? <>
      <input className="dshl-model-search" type="search" aria-label="搜索模型" placeholder="搜索模型或提供商…" value={query} aria-controls={listId} onChange={event => setQuery(event.target.value)}/>
      <div id={listId} className="dshl-model-list" role="listbox" aria-label="模型" aria-busy={loading}>
        {groups?.map(group => <div key={group.id} role="group" aria-label={group.name}><div className="dshl-model-group">{group.name}</div>{group.models.map(model => {
          const active = value?.provider === group.id && value.model === model.id;
          return <button key={model.id} type="button" role="option" aria-selected={active} data-model-choice title={model.description ?? `${group.id} / ${model.id}`} onClick={() => chooseModel(group.id, model)}><span className="dshl-model-row-label">{model.name}</span>{active && <Check/>}</button>;
        })}</div>)}
        {!loading && !error && !groups?.length && <p className="dshl-model-note" role="status">{search ? '没有匹配的模型' : '暂无可用模型，请先配置模型提供商'}</p>}
      </div>
    </> : <div className="dshl-model-list" role="listbox" aria-label="推理等级">{efforts.map(effort => <button key={effort.id} type="button" role="option" data-model-choice aria-selected={effort.id === value?.reasoningEffort} title={effort.description} onClick={() => { if (value) { onChange({ ...value, reasoningEffort: effort.id }); close(); } }}><span className="dshl-model-row-label">{effort.name}</span>{effort.id === value?.reasoningEffort && <Check/>}</button>)}<button type="button" role="option" data-model-choice aria-selected={value?.reasoningEffort === undefined} onClick={() => { if (value) { onChange({ provider: value.provider, model: value.model }); close(); } }}><span className="dshl-model-row-label">使用提供商默认值</span>{value?.reasoningEffort === undefined && <Check/>}</button></div>}
    <div className="dshl-model-footer">
      {loading && <p className="dshl-model-note" role="status">正在加载模型…</p>}
      {error && <p className="dshl-model-note" role="alert">{error}</p>}
      {unavailable && <p className="dshl-model-note" role="status">当前模型未在目录中，已保留原配置。</p>}
      {invalidEffort && <p className="dshl-model-note" role="status">当前推理等级已不可用，请重新选择。</p>}
      {models?.failures.map(failure => <p key={failure.id} className="dshl-model-note" role="status">{failure.name}：{failure.message}</p>)}
      <button type="button" className="dshl-model-refresh" disabled={loading} onClick={refresh}>{error ? '重试加载' : '刷新模型列表'}</button>
      {!required && value && <button type="button" onClick={() => { onChange(null); close(); }}>清除选择</button>}
    </div>
  </div>, trigger.current?.closest('dialog[open]') ?? document.body)}</span>;
}
