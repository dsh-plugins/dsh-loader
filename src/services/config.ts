import { mkdir, readFile, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigError, checkJSON, defaultsFor, mapValues, validateTemplate, validateValues } from '../config.js';
import type { ConfigAPI, ConfigHandle, ConfigSnapshot, ConfigTemplate, ConfigValues, ConfigView } from '../config.js';
import { ownedScope, type ResourceOwner } from '../lifecycle.js';

interface Entry {
  template: ConfigTemplate;
  value: ConfigValues;
  revision: number;
  file: string;
  active: boolean;
  queue: Promise<unknown>;
  watchers: Set<(snapshot: ConfigSnapshot) => void>;
  secrets: Map<string, string>;
}
async function rejectLink(path: string): Promise<void> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new ConfigError('unsafe-path', 'Configuration paths must not be symbolic links'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export class ConfigStore implements ConfigAPI {
  private entries = new Map<string, Entry>();
  private loading = new Set<string>();
  private pending = new Map<string, Promise<unknown>>();
  private listeners = new Set<() => void>();
  private closed = false;
  constructor(private profileDir: string | undefined) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit(): void { for (const listener of this.listeners) { try { listener(); } catch (error) { console.error('[dshloader] config subscriber failed', error); } } }
  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry?.active) throw new ConfigError('not-found', `Configuration is not registered: ${id}`);
    return entry;
  }
  async register<T = ConfigValues>(owner: ResourceOwner, input: ConfigTemplate): Promise<ConfigHandle<T>> {
    if (this.closed) throw new ConfigError('disposed', 'Config API disposed');
    validateTemplate(input);
    const template = structuredClone(input);
    if (this.entries.has(template.id) || this.loading.has(template.id)) throw new ConfigError('duplicate', `Configuration already registered: ${template.id}`);
    if (!this.profileDir) throw new ConfigError('profile-unavailable', 'Cannot locate the active profile; set dsh-loader profileDir explicitly');
    this.loading.add(template.id);
    const scope = ownedScope(owner);
    try {
      // A reloaded owner must read after any in-flight commit by its predecessor.
      await this.pending.get(template.id);
      const root = await realpath(this.profileDir);
      const config = join(root, 'config');
      const directory = join(config, template.id);
      await rejectLink(config); await rejectLink(directory);
      await mkdir(directory, { recursive: true });
      const file = join(directory, 'config.json');
      await rejectLink(file);
      let value = defaultsFor(template.fields), revision = 0;
      try {
        const disk = JSON.parse(await readFile(file, 'utf8'));
        if (disk.formatVersion !== 1 || !Number.isSafeInteger(disk.revision) || disk.revision < 0 || !disk.value || Array.isArray(disk.value) || typeof disk.value !== 'object') throw new ConfigError('corrupt', 'Invalid config.json format');
        value = validateValues(template.fields, disk.value);
        revision = disk.revision;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (scope.disposed || this.closed) throw new ConfigError('disposed', 'Plugin unloaded while loading configuration');
      const entry: Entry = { template, value, revision, file, active: true, queue: Promise.resolve(), watchers: new Set(), secrets: new Map() };
      this.entries.set(template.id, entry);
      scope.add(() => { entry.active = false; entry.watchers.clear(); if (this.entries.get(template.id) === entry) this.entries.delete(template.id); this.emit(); });
      this.emit();
      const get = (): ConfigSnapshot<T> => {
        if (!entry.active) throw new ConfigError('disposed', 'Configuration handle disposed');
        return { value: structuredClone(entry.value) as T, revision: entry.revision };
      };
      return {
        get,
        update: async (patch, expectedRevision) => { await this.commit(entry, patch as ConfigValues, expectedRevision); return get(); },
        reset: async expectedRevision => { await this.commit(entry, defaultsFor(template.fields), expectedRevision, true); return get(); },
        watch: listener => { get(); const callback = listener as (snapshot: ConfigSnapshot) => void; entry.watchers.add(callback); return scope.add(() => { entry.watchers.delete(callback); }); },
        dispose: scope.dispose,
      };
    } catch (error) { scope.dispose(); throw error; }
    finally { this.loading.delete(template.id); }
  }
  private commit(entry: Entry, patch: ConfigValues, expectedRevision?: number, replace = false): Promise<void> {
    checkJSON(patch);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return Promise.reject(new ConfigError('invalid', 'Expected configuration object'));
    const input = structuredClone(patch);
    const task = entry.queue.then(async () => {
      if (!entry.active || this.closed) throw new ConfigError('disposed', 'Configuration handle disposed');
      if (expectedRevision !== undefined && expectedRevision !== entry.revision) throw new ConfigError('conflict', '配置已在其他页面修改，请重新加载后保存');
      const value = validateValues(entry.template.fields, replace ? input : { ...entry.value, ...input });
      const revision = entry.revision + 1;
      const directory = join(entry.file, '..');
      await rejectLink(join(directory, '..')); await rejectLink(directory); await rejectLink(entry.file);
      const temporary = `${entry.file}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify({ formatVersion: 1, revision, value }, null, 2) + '\n'); await file.sync(); }
        finally { await file.close(); }
        if (!entry.active || this.closed) throw new ConfigError('disposed', 'Plugin unloaded before configuration commit');
        await rename(temporary, entry.file);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.error('[dshloader] temporary config cleanup failed', error); }); }
      entry.value = value; entry.revision = revision;
      for (const listener of entry.watchers) { try { listener({ value: structuredClone(value), revision }); } catch (error) { console.error('[dshloader] config watcher failed', error); } }
      this.emit();
    });
    entry.queue = task.catch(() => {});
    this.pending.set(entry.template.id, entry.queue);
    return task;
  }
  private redact(entry: Entry, value: ConfigValues, fields = entry.template.fields): ConfigValues {
    return mapValues(fields, value, (field, item) => {
      if (field.type !== 'password') return item;
      const text = String(item);
      let token = [...entry.secrets].find(([, value]) => value === text)?.[0];
      if (!token) { token = randomUUID(); entry.secrets.set(token, text); }
      return { $secret: token, set: text.length > 0 };
    });
  }
  read(id: string): ConfigView {
    const entry = this.entry(id);
    const template = structuredClone(entry.template);
    const strip = (fields: typeof template.fields): void => { for (const field of fields) {
      if (field.default !== undefined) field.default = this.redact(entry, { item: field.default }, [{ ...field, key: 'item' }]).item;
      if (field.fields) strip(field.fields); if (field.item) strip([field.item]);
    } };
    strip(template.fields);
    return { template, value: this.redact(entry, entry.value), defaults: this.redact(entry, defaultsFor(entry.template.fields)), revision: entry.revision };
  }
  list(): ConfigView[] { return [...this.entries.keys()].map(id => this.read(id)); }
  async write(id: string, value: ConfigValues, expectedRevision: number): Promise<ConfigView> {
    const entry = this.entry(id);
    if (!Number.isSafeInteger(expectedRevision)) throw new ConfigError('invalid', 'expectedRevision is required');
    checkJSON(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError('invalid', 'Expected configuration object');
    const decoded = mapValues(entry.template.fields, { ...entry.value, ...value }, (field, item) => {
      if (field.type !== 'password' || typeof item === 'string') return item;
      const token = item && typeof item === 'object' && !Array.isArray(item) ? item.$secret : undefined;
      if (typeof token !== 'string' || !entry.secrets.has(token)) throw new ConfigError('invalid', 'Invalid secret reference');
      return entry.secrets.get(token)!;
    });
    await this.commit(entry, decoded, expectedRevision, true);
    return this.read(id);
  }
  async reset(id: string, expectedRevision: number): Promise<ConfigView> {
    if (!Number.isSafeInteger(expectedRevision)) throw new ConfigError('invalid', 'expectedRevision is required');
    const entry = this.entry(id);
    await this.commit(entry, defaultsFor(entry.template.fields), expectedRevision, true);
    return this.read(id);
  }
  dispose(): void {
    this.closed = true;
    for (const entry of this.entries.values()) { entry.active = false; entry.watchers.clear(); }
    this.entries.clear(); this.emit(); this.listeners.clear();
  }
}
