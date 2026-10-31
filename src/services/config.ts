import { mkdir, readFile, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigError, checkJSON, configOptions, defaultsFor, mapValues, operationFields, validateResource, validateTemplate, validateValues } from '../config.js';
import type { ConfigAPI, ConfigHandle, ConfigOperationHandler, ConfigOperationRequest, ConfigOperationResult, ConfigSnapshot, ConfigTemplate, ConfigValues, ConfigView } from '../config.js';
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
  handlers: Map<string, { handler: ConfigOperationHandler; calls: Set<AbortController> }>;
  operationQueues: Map<string, Promise<unknown>>;
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
      const entry: Entry = { template, value, revision, file, active: true, queue: Promise.resolve(), watchers: new Set(), secrets: new Map(), handlers: new Map(), operationQueues: new Map() };
      this.entries.set(template.id, entry);
      scope.add(() => { this.closeEntry(entry); if (this.entries.get(template.id) === entry) this.entries.delete(template.id); this.emit(); });
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
        registerOperation: (id, handler) => {
          get();
          if (!template.panels?.some(panel => panel.operations.some(operation => operation.id === id))) throw new ConfigError('not-found', `Operation is not declared: ${id}`);
          if (typeof handler !== 'function' || entry.handlers.has(id)) throw new ConfigError('duplicate', `Invalid or duplicate handler: ${id}`);
          const registration = { handler: handler as ConfigOperationHandler, calls: new Set<AbortController>() };
          entry.handlers.set(id, registration); this.emit();
          return scope.add(() => {
            for (const call of registration.calls) call.abort(); registration.calls.clear();
            if (entry.handlers.get(id) === registration) entry.handlers.delete(id);
            this.emit();
          });
        },
        dispose: scope.dispose,
      };
    } catch (error) { scope.dispose(); throw error; }
    finally { this.loading.delete(template.id); }
  }
  private closeEntry(entry: Entry): void {
    entry.active = false; entry.watchers.clear();
    for (const registration of entry.handlers.values()) for (const call of registration.calls) call.abort();
    entry.handlers.clear();
  }
  /** No deadline: callers/owners cancel through AbortSignal, including long model downloads. */
  async invoke(id: string, operationId: string, request: ConfigOperationRequest, signal?: AbortSignal): Promise<ConfigOperationResult> {
    const entry = this.entry(id);
    const panel = entry.template.panels?.find(panel => panel.operations.some(operation => operation.id === operationId));
    const operation = panel?.operations.find(operation => operation.id === operationId);
    const registration = entry.handlers.get(operationId);
    if (!panel || !operation || !registration) throw new ConfigError('not-found', `Operation is not registered: ${operationId}`);
    checkJSON(request);
    if (!request || typeof request !== 'object' || !request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new ConfigError('invalid', 'Operation input is required');
    if (operation.requiresRevision && !request.resource) throw new ConfigError('revision-required', '请先加载资源以获取 revision');
    if (request.resource !== undefined) validateResource(request.resource);
    const resource = request.resource ? structuredClone(request.resource) : undefined;
    const input = validateValues(operationFields(panel.fields, operation.input), request.input);
    // Async list IDs are resolved by the plugin; saved-config options are checked here.
    mapValues(operationFields(panel.fields, operation.input), input, (field, value, path) => {
      if (field.optionsFrom?.config) {
        const allowed = configOptions(field, entry.value).map(option => option.value);
        if ((field.type === 'multiselect' ? value as unknown[] : value === '' && !field.required ? [] : [value]).some(item => !allowed.includes(item as string | number))) throw new ConfigError('validation', '已保存配置中的选项已变化', { [path.join('.')]: '无效选项' });
      }
      return value;
    });
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    registration.calls.add(controller);
    let cancel: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { cancel = () => reject(new ConfigError('cancelled', '操作已取消或插件已卸载')); controller.signal.addEventListener('abort', cancel, { once: true }); });
    const run = async () => {
      if (controller.signal.aborted || !entry.active || entry.handlers.get(operationId) !== registration) throw new ConfigError('cancelled', '操作已取消或插件已卸载');
      const result = await registration.handler({ input: structuredClone(input), ...(resource ? { resource } : {}), config: { value: structuredClone(entry.value), revision: entry.revision }, signal: controller.signal });
      if (controller.signal.aborted || !entry.active) throw new ConfigError('cancelled', '操作已取消或插件已卸载');
      checkJSON(result);
      if (!result || typeof result !== 'object' || result.value === undefined) throw new ConfigError('invalid-result', 'Operation must return { value }');
      if (result.resource != null) validateResource(result.resource);
      return structuredClone(result);
    };
    // Save/delete of one resource serialize together; unrelated downloads/editors can proceed.
    const key = operation.requiresRevision ? `resource:${resource!.id}` : `operation:${operationId}`;
    const task = operation.readOnly ? run() : (entry.operationQueues.get(key) ?? Promise.resolve()).then(run);
    if (!operation.readOnly) {
      const settled = task.catch(() => {}).finally(() => { if (entry.operationQueues.get(key) === settled) entry.operationQueues.delete(key); });
      entry.operationQueues.set(key, settled);
    }
    try { if (controller.signal.aborted) cancel(); return await Promise.race([task, cancelled]); }
    finally { signal?.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cancel); registration.calls.delete(controller); }
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
    return { template, value: this.redact(entry, entry.value), defaults: this.redact(entry, defaultsFor(entry.template.fields)), revision: entry.revision, availableOperations: [...entry.handlers.keys()] };
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
    for (const entry of this.entries.values()) this.closeEntry(entry);
    this.entries.clear(); this.emit(); this.listeners.clear();
  }
}
