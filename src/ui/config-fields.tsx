import * as React from 'react';
import { fieldDefault, type ConfigField, type ConfigValue, type ConfigValues } from '../config.js';
export function at(value: ConfigValues, path: string[]): ConfigValue | undefined { return path.reduce<any>((v, key) => v?.[key], value); }
export function setAt(value: ConfigValues, path: string[], next: ConfigValue): ConfigValues {
  const copy = structuredClone(value); let target: any = copy;
  for (const key of path.slice(0, -1)) target = target[key] ??= {};
  target[path.at(-1)!] = next; return copy;
}
/** Separate fieldset state keeps drafts mounted and each nested group independent. */
function ConfigGroup({ field, children }: { field: ConfigField; children: React.ReactNode }): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(Boolean(field.defaultCollapsed));
  const expanded = !field.collapsible || !collapsed;
  const bodyId = React.useId();
  return <fieldset className="dshl-config-group" data-collapsible={field.collapsible ? '' : undefined} data-expanded={expanded}>
    <legend>{field.collapsible ? <button className="dshl-config-group-toggle" type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setCollapsed(value => !value)}>
      <span>{field.label}</span><svg className="dshl-config-group-triangle" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1 L10 6 L3 11 Z" fill="currentColor"/></svg>
    </button> : field.label}</legend>
    <div id={bodyId} className="dshl-config-group-body" aria-hidden={!expanded} {...(!expanded ? { inert: '' } : {})}>
      <div className="dshl-config-group-clip"><div className="dshl-config-group-content">{field.description && <p className="dshl-config-help">{field.description}</p>}{children}</div></div>
    </div>
  </fieldset>;
}
export function Fields({ fields, draft, path = [], change, errors, prefix, options }: { fields: ConfigField[]; draft: ConfigValues; path?: string[]; change(path: string[], value: ConfigValue): void; errors: Record<string, string>; prefix: string; options?: (field: ConfigField) => { label: string; value: string | number }[] }): React.ReactElement {
  return <>{fields.map((field, index) => {
    if (field.visibleWhen && JSON.stringify(at(draft, field.visibleWhen.path)) !== JSON.stringify(field.visibleWhen.equals)) return null;
    const next = field.type === 'group' ? path : [...path, field.key!];
    const key = next.join('.') + ':' + index;
    if (field.type === 'group' || field.type === 'object') return <ConfigGroup field={field} key={key}><Fields fields={field.fields!} draft={draft} path={next} change={change} errors={errors} prefix={prefix} options={options}/></ConfigGroup>;
    const value = at(draft, next) ?? fieldDefault(field);
    const choices = options?.(field) ?? field.options ?? [];
    const id = `${prefix}-${next.map(encodeURIComponent).join('.')}`;
    const error = errors[next.join('.')];
    let control: React.ReactNode;
    const props = { id, 'aria-invalid': Boolean(error), 'aria-describedby': field.description || error ? `${id}-help` : undefined };
    if (field.type === 'array') control = <div className="dshl-config-array">{(Array.isArray(value) ? value : []).map((_, itemIndex) => <section key={itemIndex}><Fields fields={[{ ...field.item!, key: String(itemIndex) }]} path={next} draft={draft} change={change} errors={errors} prefix={prefix} options={options}/><button type="button" onClick={() => change(next, (value as ConfigValue[]).filter((_, i) => i !== itemIndex))}>删除第 {itemIndex + 1} 项</button></section>)}<button type="button" onClick={() => change(next, [...value as ConfigValue[], fieldDefault(field.item!)])}>新增</button></div>;
    else if (field.type === 'boolean') control = <input {...props} type="checkbox" checked={value === true} onChange={event => change(next, event.target.checked)}/>;
    else if (field.type === 'select' || field.type === 'multiselect') control = <select {...props} multiple={field.type === 'multiselect'} value={field.type === 'multiselect' ? (value as ConfigValue[]).map(item => JSON.stringify(item)) : JSON.stringify(value)} onChange={event => {
      const decode = (text: string) => JSON.parse(text);
      change(next, field.type === 'multiselect' ? [...event.target.selectedOptions].map(option => decode(option.value)) : decode(event.target.value));
    }}>{field.optionsFrom && <option value={JSON.stringify('')}>请选择</option>}{field.type === 'select' && value !== '' && !choices.some(option => option.value === value) && <option value={JSON.stringify(value)}>{String(value)}（选项已不可用）</option>}{choices.map(option => <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>{option.label}</option>)}</select>;
    else if (field.type === 'textarea') control = <textarea {...props} value={String(value)} onChange={event => change(next, event.target.value)}/>;
    else control = <input {...props} type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'} autoComplete={field.type === 'password' ? 'new-password' : undefined} value={typeof value === 'object' ? '' : String(value)} placeholder={field.type === 'password' && value && typeof value === 'object' && !Array.isArray(value) && value.set ? '已设置，留空保持不变' : undefined} min={field.min} max={field.max} onChange={event => change(next, field.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}/>;
    return <div className={'dshl-config-item' + (field.type === 'array' ? ' dshl-config-item-array' : '')} key={key}><label className="dshl-config-label" htmlFor={id}><span>{field.label}{field.required ? ' *' : ''}</span></label><div className="dshl-config-control">{control}{field.type === 'password' && <button type="button" onClick={() => change(next, '')}>清空</button>}<div id={`${id}-help`}>{field.description && <div className="dshl-config-help">{field.description}</div>}{error && <div className="dshl-config-error">{error}</div>}</div></div></div>;
  })}</>;
}
