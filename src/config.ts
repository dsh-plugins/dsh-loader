import type { ResourceOwner } from './lifecycle.js';
export type ConfigValue = null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue };
export type ConfigValues = Record<string, ConfigValue>;
export interface ConfigField {
  type: 'text' | 'textarea' | 'password' | 'number' | 'boolean' | 'select' | 'multiselect' | 'object' | 'array' | 'group';
  key?: string;
  label: string;
  description?: string;
  default?: ConfigValue;
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: string;
  options?: { label: string; value: string | number }[];
  /** Transient panel selections only. Paths are relative to the saved config or operation value. */
  optionsFrom?: { config: string[]; path?: never; operation?: never; label?: string[]; value?: string[] } | { operation: string; path?: string[]; config?: never; label?: string[]; value?: string[] };
  fields?: ConfigField[];
  item?: ConfigField;
  visibleWhen?: { path: string[]; equals: ConfigValue };
  /** Group/object presentation only; defaults to a fixed, expanded fieldset. */
  collapsible?: boolean;
  /** Initial UI state when collapsible=true; never stored as a config value. */
  defaultCollapsed?: boolean;
  /** Optional client-registered editor for this persisted field. UI code stays in the client plugin. */
  dialog?: { id: string; label?: string };
}
export interface ConfigTemplate {
  id: string;
  packageName: string;
  rowId?: string;
  title: string;
  description?: string;
  fields: ConfigField[];
  panels?: ConfigPanel[];
}
/** A panel owns a page-local draft, independent of persisted configuration. */
export interface ConfigPanel { id: string; title: string; description?: string; fields: ConfigField[]; operations: ConfigOperation[] }
export interface ConfigResultDisplay { type: 'text' | 'markdown' | 'list' | 'json'; title?: string; path?: string[]; label?: string[] }
export interface ConfigOperation {
  /** Unique across all panels of this template. */
  id: string;
  /** Top-level draft keys to validate and send; omitted means all panel fields. */
  input?: string[];
  button?: { label: string; success?: string };
  /** Read operations may run on mount/reconnect, input change or refresh. */
  readOnly?: boolean;
  autoRun?: boolean;
  onChange?: string[][];
  /** Result value paths copied into transient fields after a successful explicit load. */
  fill?: { from: string[]; to: string[] }[];
  result?: ConfigResultDisplay[];
  refresh?: string[];
  /** Mutations must send the resource identity and revision obtained from a read. */
  requiresRevision?: boolean;
}
export interface ConfigResource { id: string; revision: string | number }
export interface ConfigOperationRequest { input: ConfigValues; resource?: ConfigResource }
export interface ConfigOperationResult { value: ConfigValue; resource?: ConfigResource | null }
export interface ConfigOperationContext<T = ConfigValues> extends ConfigOperationRequest { config: ConfigSnapshot<T>; signal: AbortSignal }
export type ConfigOperationHandler<T = ConfigValues> = (context: ConfigOperationContext<T>) => ConfigOperationResult | Promise<ConfigOperationResult>;
export interface ConfigSnapshot<T = ConfigValues> { value: T; revision: number }
export interface ConfigView extends ConfigSnapshot { template: ConfigTemplate; defaults: ConfigValues; availableOperations?: string[] }
export interface ConfigHandle<T> {
  get(): ConfigSnapshot<T>;
  update(value: Partial<T>, expectedRevision?: number): Promise<ConfigSnapshot<T>>;
  reset(expectedRevision?: number): Promise<ConfigSnapshot<T>>;
  watch(listener: (snapshot: ConfigSnapshot<T>) => void): () => void;
  registerOperation(id: string, handler: ConfigOperationHandler<T>): () => void;
  dispose(): void;
}
export interface ConfigAPI {
  register<T = ConfigValues>(owner: ResourceOwner, template: ConfigTemplate): Promise<ConfigHandle<T>>;
}
export class ConfigError extends Error {
  constructor(public code: string, message: string, public fields: Record<string, string> = {}) { super(message); this.name = 'ConfigError'; }
}
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
export function checkJSON(value: unknown, depth = 0): void {
  if (depth > 40) throw new ConfigError('invalid', 'Configuration is too deeply nested');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) throw new ConfigError('invalid', 'Configuration must contain JSON values only');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new ConfigError('invalid', 'Configuration must contain plain objects');
  for (const [key, entry] of Object.entries(value)) {
    if (unsafe.has(key)) throw new ConfigError('invalid', `Unsafe configuration key: ${key}`);
    checkJSON(entry, depth + 1);
  }
}
export function defineConfig<T extends ConfigTemplate>(template: T): T { validateTemplate(template); return template; }
export function validateTemplate(template: ConfigTemplate): void {
  checkJSON(template);
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(template.id) || /\.$/.test(template.id) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(template.id)) throw new ConfigError('invalid-template', 'Invalid plugin ID');
  if (typeof template.packageName !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(template.packageName) || typeof template.title !== 'string' || !template.title.trim() || !Array.isArray(template.fields)) throw new ConfigError('invalid-template', 'Package name, title and fields are required');
  if (template.rowId !== undefined && (typeof template.rowId !== 'string' || !template.rowId || template.rowId.includes('#'))) throw new ConfigError('invalid-template', 'Invalid plugin row ID');
  const walk = (fields: ConfigField[], keys = new Set<string>(), transient = false) => {
    if (!Array.isArray(fields)) throw new ConfigError('invalid-template', 'fields must be an array');
    for (const field of fields) {
      if (!field || typeof field.label !== 'string' || !field.label || !['text','textarea','password','number','boolean','select','multiselect','object','array','group'].includes(field.type)) throw new ConfigError('invalid-template', 'Invalid field');
      if ((field.collapsible !== undefined && typeof field.collapsible !== 'boolean') || (field.defaultCollapsed !== undefined && typeof field.defaultCollapsed !== 'boolean')) throw new ConfigError('invalid-template', 'Collapse options must be boolean');
      if ((field.collapsible !== undefined || field.defaultCollapsed !== undefined) && !['group', 'object'].includes(field.type)) throw new ConfigError('invalid-template', 'Collapse options require a group or object');
      if (field.defaultCollapsed && !field.collapsible) throw new ConfigError('invalid-template', 'defaultCollapsed requires collapsible=true');
      if (field.dialog !== undefined && (transient || field.type === 'group' || !field.dialog || Array.isArray(field.dialog) || typeof field.dialog.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(field.dialog.id) || unsafe.has(field.dialog.id) || field.dialog.label !== undefined && (typeof field.dialog.label !== 'string' || !field.dialog.label))) throw new ConfigError('invalid-template', 'Invalid config dialog declaration');
      if (field.visibleWhen && (!Array.isArray(field.visibleWhen.path) || !field.visibleWhen.path.length || field.visibleWhen.path.some(key => typeof key !== 'string' || unsafe.has(key)) || field.visibleWhen.equals === undefined)) throw new ConfigError('invalid-template', 'Invalid visibility condition');
      if ((field.min !== undefined && !Number.isFinite(field.min)) || (field.max !== undefined && !Number.isFinite(field.max)) || (field.min !== undefined && field.max !== undefined && field.min > field.max)) throw new ConfigError('invalid-template', 'Invalid field bounds');
      if (field.optionsFrom !== undefined && (!transient || !['select','multiselect'].includes(field.type) || field.options || !field.optionsFrom || typeof field.optionsFrom !== 'object' || Array.isArray(field.optionsFrom))) throw new ConfigError('invalid-template', 'Dynamic options require a transient selection without static options');
      if (field.type === 'group') { if (!field.fields) throw new ConfigError('invalid-template', 'Group needs fields'); walk(field.fields, keys, transient); continue; }
      if (!field.key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field.key) || unsafe.has(field.key) || keys.has(field.key)) throw new ConfigError('invalid-template', `Invalid or duplicate key: ${field.key}`);
      keys.add(field.key);
      if (field.pattern) { try { new RegExp(field.pattern); } catch { throw new ConfigError('invalid-template', 'Invalid pattern'); } }
      if (field.type === 'object') { if (!field.fields) throw new ConfigError('invalid-template', 'Object needs fields'); walk(field.fields, new Set(), transient); }
      if (field.type === 'array') { if (!field.item || field.item.type === 'group') throw new ConfigError('invalid-template', 'Array needs an item schema'); walk([{ ...field.item, key: 'item' }], new Set(), transient); }
      if (transient && field.type === 'password' && field.default) throw new ConfigError('invalid-template', 'Transient passwords cannot have non-empty defaults');
      if (['select','multiselect'].includes(field.type) && !field.options?.length && !field.optionsFrom) throw new ConfigError('invalid-template', 'Selection needs options');
      if (field.options && (!Array.isArray(field.options) || field.options.some(option => !option || typeof option.label !== 'string' || !['string', 'number'].includes(typeof option.value)) || new Set(field.options.map(option => JSON.stringify(option.value))).size !== field.options.length)) throw new ConfigError('invalid-template', 'Invalid or duplicate options');
      if (field.default !== undefined) {
        try { validateValues([{ ...field, key: 'value' }], { value: field.default }); }
        catch { throw new ConfigError('invalid-template', `Invalid default for ${field.key}`); }
      }
    }
  };
  walk(template.fields);
  const ids = new Set<string>(), panelIds = new Set<string>();
  const identifier = (id: string) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(id) && !unsafe.has(id);
  const path = (value: unknown, empty = false): value is string[] => Array.isArray(value) && (empty || value.length > 0) && value.every(key => typeof key === 'string' && key.length > 0 && !unsafe.has(key));
  if (template.panels !== undefined && !Array.isArray(template.panels)) throw new ConfigError('invalid-template', 'panels must be an array');
  for (const panel of template.panels ?? []) {
    if (!identifier(panel.id) || panelIds.has(panel.id) || typeof panel.title !== 'string' || !panel.title || !Array.isArray(panel.operations)) throw new ConfigError('invalid-template', 'Invalid or duplicate panel');
    panelIds.add(panel.id); walk(panel.fields, new Set(), true);
    mapValues(panel.fields, defaultsFor(panel.fields), (field, value) => { if (field.type === 'password' && value !== '') throw new ConfigError('invalid-template', 'Transient passwords cannot have non-empty defaults'); return value; });
    for (const operation of panel.operations) {
      if (!identifier(operation.id) || ids.has(operation.id)) throw new ConfigError('invalid-template', 'Invalid or duplicate operation ID');
      ids.add(operation.id);
      for (const key of ['readOnly', 'autoRun', 'requiresRevision'] as const) if (operation[key] !== undefined && typeof operation[key] !== 'boolean') throw new ConfigError('invalid-template', 'Operation flags must be boolean');
      if ((operation.autoRun || operation.onChange || operation.refresh?.includes(operation.id)) && !operation.readOnly) throw new ConfigError('invalid-template', 'Automatic operations must be readOnly');
      if (operation.readOnly && operation.requiresRevision) throw new ConfigError('invalid-template', 'Revision mutations cannot be readOnly');
      if (operation.button && (typeof operation.button.label !== 'string' || !operation.button.label || operation.button.success !== undefined && typeof operation.button.success !== 'string')) throw new ConfigError('invalid-template', 'Invalid operation button');
      if (operation.input && (!Array.isArray(operation.input) || new Set(operation.input).size !== operation.input.length || operation.input.some(key => typeof key !== 'string' || !Object.hasOwn(defaultsFor(panel.fields), key)))) throw new ConfigError('invalid-template', 'Unknown operation input');
      if (operation.onChange && (!Array.isArray(operation.onChange) || operation.onChange.some(item => !path(item) || !findConfigField(panel.fields, item)))) throw new ConfigError('invalid-template', 'Invalid change trigger');
      if (operation.fill && (!Array.isArray(operation.fill) || operation.fill.some(item => !path(item.from, true) || !path(item.to) || !findConfigField(panel.fields, item.to)))) throw new ConfigError('invalid-template', 'Invalid result binding');
      if (operation.result && (!Array.isArray(operation.result) || operation.result.some(item => !['text','markdown','list','json'].includes(item.type) || item.path && !path(item.path, true) || item.label && !path(item.label, true) || item.title !== undefined && typeof item.title !== 'string'))) throw new ConfigError('invalid-template', 'Invalid result display');
    }
    const visit = (fields: ConfigField[]) => { for (const field of fields) {
      const source = field.optionsFrom;
      if (source) {
        if (Object.hasOwn(source, 'config') === Object.hasOwn(source, 'operation')) throw new ConfigError('invalid-template', 'Options need exactly one source');
        if (source.label && !path(source.label, true) || source.value && !path(source.value, true)) throw new ConfigError('invalid-template', 'Invalid option mapping');
        if ('config' in source) {
          const saved = path(source.config) && findConfigField(template.fields, source.config);
          if (!saved || saved.type !== 'array' || hasPassword(saved)) throw new ConfigError('invalid-template', 'Saved options must reference a non-secret config array');
        } else if (!panel.operations.some(operation => operation.id === source.operation && operation.readOnly) || source.path && !path(source.path, true)) throw new ConfigError('invalid-template', 'Options must reference a read operation in the same panel');
      }
      if (field.fields) visit(field.fields); if (field.item) visit([field.item]);
    } };
    visit(panel.fields);
    for (const operation of panel.operations) if (operation.refresh && (!Array.isArray(operation.refresh) || operation.refresh.some(id => !panel.operations.some(target => target.id === id && target.readOnly && !target.fill?.length)))) throw new ConfigError('invalid-template', 'Refresh targets must be read operations without draft bindings');
  }
}
export function findConfigField(fields: ConfigField[], path: string[]): ConfigField | undefined {
  for (const field of fields) {
    if (field.type === 'group') { const found = findConfigField(field.fields!, path); if (found) return found; }
    else if (field.key === path[0]) return path.length === 1 ? field : field.type === 'object' ? findConfigField(field.fields!, path.slice(1)) : field.type === 'array' && /^(0|[1-9][0-9]*)$/.test(path[1]) ? findConfigField([{ ...field.item!, key: path[1] }], path.slice(1)) : undefined;
  }
}
function hasPassword(field: ConfigField): boolean { return field.type === 'password' || Boolean(field.fields?.some(hasPassword) || field.item && hasPassword(field.item)); }
export function configAt(value: unknown, path: string[]): ConfigValue | undefined { return path.reduce<any>((current, key) => current != null && Object.hasOwn(Object(current), key) ? (current as any)[key] : undefined, value); }
export function configOptions(field: ConfigField, saved: ConfigValues, results: Record<string, ConfigOperationResult> = {}): { label: string; value: string | number }[] {
  const source = field.optionsFrom;
  if (!source) return field.options ?? [];
  const items = 'config' in source ? configAt(saved, source.config!) : configAt(results[source.operation]?.value, source.path ?? []);
  if (!Array.isArray(items)) return [];
  const options = items.map(item => ({ label: configAt(item, source.label ?? []), value: configAt(item, source.value ?? []) }));
  return options.filter((option): option is {label:string;value:string|number} => typeof option.label === 'string' && (typeof option.value === 'string' || typeof option.value === 'number'));
}
export function operationFields(fields: ConfigField[], input?: string[]): ConfigField[] {
  if (!input) return fields;
  return fields.flatMap(field => field.type === 'group' ? [{ ...field, fields: operationFields(field.fields!, input) }] : input.includes(field.key!) ? [field] : []);
}
export function validateResource(resource: ConfigResource): void {
  if (!resource || typeof resource !== 'object' || typeof resource.id !== 'string' || !resource.id || !(typeof resource.revision === 'string' && resource.revision.length > 0 || typeof resource.revision === 'number' && Number.isSafeInteger(resource.revision) && resource.revision >= 0)) throw new ConfigError('invalid', 'Resource id and revision are required');
}
export function fieldDefault(field: ConfigField): ConfigValue {
  if (field.default !== undefined) return structuredClone(field.default);
  if (field.type === 'object') return defaultsFor(field.fields!);
  if (field.type === 'array' || field.type === 'multiselect') return [];
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return field.min ?? 0;
  if (field.type === 'select') return field.options?.[0].value ?? '';
  return '';
}
export function defaultsFor(fields: ConfigField[]): ConfigValues {
  return mapValues(fields, {}, (_field, value) => value);
}
/** Walks schema-owned values; groups never create an extra data level. */
export function mapValues(fields: ConfigField[], input: ConfigValues, map: (field: ConfigField, value: ConfigValue, path: string[]) => ConfigValue, path: string[] = []): ConfigValues {
  const result: ConfigValues = {};
  const visit = (field: ConfigField, value: ConfigValue, at: string[]): ConfigValue => {
    if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) return map(field, mapValues(field.fields!, value, map, at), at);
    if (field.type === 'array' && Array.isArray(value)) return map(field, value.map((item, index) => visit(field.item!, item, [...at, String(index)])), at);
    return map(field, value, at);
  };
  for (const field of fields) {
    if (field.type === 'group') Object.assign(result, mapValues(field.fields!, input, map, path));
    else result[field.key!] = visit(field, input[field.key!] === undefined ? fieldDefault(field) : input[field.key!], [...path, field.key!]);
  }
  return result;
}
export function validateValues(fields: ConfigField[], input: ConfigValues): ConfigValues {
  checkJSON(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('invalid', 'Expected configuration object');
  const errors: Record<string, string> = {};
  const result = mapValues(fields, input, (field, value, path) => {
    const fail = (message: string) => { errors[path.join('.')] = message; };
    if (['text','textarea','password'].includes(field.type)) {
      if (typeof value !== 'string') fail('必须是文本');
      else if (field.required && !value.trim()) fail('此项必填');
      else if (field.min !== undefined && value.length < field.min || field.max !== undefined && value.length > field.max) fail('文本长度超出范围');
      else if (field.pattern && !new RegExp(field.pattern).test(value)) fail('格式不正确');
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('必须是有效数字');
      else if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) fail('数字超出范围');
    } else if (field.type === 'boolean' && typeof value !== 'boolean') fail('必须是开关值');
    else if (field.type === 'select' && (field.optionsFrom ? !['string','number'].includes(typeof value) || field.required && value === '' : !field.options!.some(option => option.value === value))) fail('无效选项');
    else if (field.type === 'multiselect' && (!Array.isArray(value) || value.some(item => field.optionsFrom ? !['string','number'].includes(typeof item) : !field.options!.some(option => option.value === item)))) fail('无效选项');
    else if (field.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) fail('无效结构');
    else if (field.type === 'array' || field.type === 'multiselect') {
      if (!Array.isArray(value)) fail('必须是数组');
      else if ((field.required && value.length === 0) || (field.min !== undefined && value.length < field.min) || (field.max !== undefined && value.length > field.max)) fail('数组长度超出范围');
    }
    return value;
  });
  if (Object.keys(errors).length) throw new ConfigError('validation', '配置校验失败', errors);
  return result;
}
