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
  fields?: ConfigField[];
  item?: ConfigField;
  visibleWhen?: { path: string[]; equals: ConfigValue };
}
export interface ConfigTemplate {
  id: string;
  packageName: string;
  rowId?: string;
  title: string;
  description?: string;
  fields: ConfigField[];
}
export interface ConfigSnapshot<T = ConfigValues> { value: T; revision: number }
export interface ConfigView extends ConfigSnapshot { template: ConfigTemplate; defaults: ConfigValues }
export interface ConfigHandle<T> {
  get(): ConfigSnapshot<T>;
  update(value: Partial<T>, expectedRevision?: number): Promise<ConfigSnapshot<T>>;
  reset(expectedRevision?: number): Promise<ConfigSnapshot<T>>;
  watch(listener: (snapshot: ConfigSnapshot<T>) => void): () => void;
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
  const walk = (fields: ConfigField[], keys = new Set<string>()) => {
    if (!Array.isArray(fields)) throw new ConfigError('invalid-template', 'fields must be an array');
    for (const field of fields) {
      if (!field || typeof field.label !== 'string' || !field.label || !['text','textarea','password','number','boolean','select','multiselect','object','array','group'].includes(field.type)) throw new ConfigError('invalid-template', 'Invalid field');
      if (field.visibleWhen && (!Array.isArray(field.visibleWhen.path) || !field.visibleWhen.path.length || field.visibleWhen.path.some(key => typeof key !== 'string' || unsafe.has(key)) || field.visibleWhen.equals === undefined)) throw new ConfigError('invalid-template', 'Invalid visibility condition');
      if ((field.min !== undefined && !Number.isFinite(field.min)) || (field.max !== undefined && !Number.isFinite(field.max)) || (field.min !== undefined && field.max !== undefined && field.min > field.max)) throw new ConfigError('invalid-template', 'Invalid field bounds');
      if (field.type === 'group') { if (!field.fields) throw new ConfigError('invalid-template', 'Group needs fields'); walk(field.fields, keys); continue; }
      if (!field.key || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field.key) || unsafe.has(field.key) || keys.has(field.key)) throw new ConfigError('invalid-template', `Invalid or duplicate key: ${field.key}`);
      keys.add(field.key);
      if (field.pattern) { try { new RegExp(field.pattern); } catch { throw new ConfigError('invalid-template', 'Invalid pattern'); } }
      if (field.type === 'object') { if (!field.fields) throw new ConfigError('invalid-template', 'Object needs fields'); walk(field.fields); }
      if (field.type === 'array') { if (!field.item || field.item.type === 'group') throw new ConfigError('invalid-template', 'Array needs an item schema'); walk([{ ...field.item, key: 'item' }]); }
      if (['select','multiselect'].includes(field.type) && !field.options?.length) throw new ConfigError('invalid-template', 'Selection needs options');
      if (field.options && (!Array.isArray(field.options) || field.options.some(option => !option || typeof option.label !== 'string' || !['string', 'number'].includes(typeof option.value)) || new Set(field.options.map(option => JSON.stringify(option.value))).size !== field.options.length)) throw new ConfigError('invalid-template', 'Invalid or duplicate options');
      if (field.default !== undefined) {
        try { validateValues([{ ...field, key: 'value' }], { value: field.default }); }
        catch { throw new ConfigError('invalid-template', `Invalid default for ${field.key}`); }
      }
    }
  };
  walk(template.fields);
}
export function fieldDefault(field: ConfigField): ConfigValue {
  if (field.default !== undefined) return structuredClone(field.default);
  if (field.type === 'object') return defaultsFor(field.fields!);
  if (field.type === 'array' || field.type === 'multiselect') return [];
  if (field.type === 'boolean') return false;
  if (field.type === 'number') return field.min ?? 0;
  if (field.type === 'select') return field.options![0].value;
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
    else if (field.type === 'select' && !field.options!.some(option => option.value === value)) fail('无效选项');
    else if (field.type === 'multiselect' && (!Array.isArray(value) || value.some(item => !field.options!.some(option => option.value === item)))) fail('无效选项');
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
