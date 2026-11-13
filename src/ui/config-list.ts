import type { ConfigClient } from '../config-client.js';
import type { ConfigView } from '../config.js';

interface ConfigListSnapshot {
  status: 'loading' | 'ready' | 'error';
  views: ConfigView[];
  error?: string;
}

/** 配置入口与表单共享列表状态，避免打开详情时重新等待网络请求。 */
export class ConfigList {
  private snapshot: ConfigListSnapshot = { status: 'loading', views: [] };
  private listeners = new Set<() => void>();
  private release?: () => void;
  private generation = 0;
  private lifetime = 0;
  private pending?: Promise<void>;

  constructor(private readonly client: ConfigClient) {}

  getSnapshot = (): ConfigListSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.release = this.client.subscribe(this.refresh);
      this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.release?.();
        this.release = undefined;
        this.lifetime++;
        this.pending = undefined;
      }
    };
  };

  refresh = (): void => {
    if (!this.listeners.size) { return; }
    this.generation++;
    if (this.pending) { return; }
    const lifetime = this.lifetime;
    let settled = this.generation;
    const pending = Promise.resolve().then(async () => {
      while (this.listeners.size && lifetime === this.lifetime) {
        const generation = this.generation;
        try {
          const views = await this.client.list();
          if (lifetime !== this.lifetime) { return; }
          if (generation !== this.generation) { continue; }
          this.publish({ status: 'ready', views });
        } catch (cause) {
          if (lifetime !== this.lifetime) { return; }
          if (generation !== this.generation) { continue; }
          this.publish({ status: 'error', views: this.snapshot.views, error: cause instanceof Error ? cause.message : String(cause) });
        }
        settled = generation;
        if (generation === this.generation) { return; }
      }
    }).finally(() => {
      if (this.pending === pending) {
        this.pending = undefined;
        if (settled !== this.generation && lifetime === this.lifetime) { this.refresh(); }
      }
    });
    this.pending = pending;
    this.publish({ status: 'loading', views: this.snapshot.views });
  };

  private publish(snapshot: ConfigListSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try { listener(); }
      catch (cause) { console.error('[dshloader] config list subscriber failed', cause); }
    }
  }
}

const lists = new WeakMap<ConfigClient, ConfigList>();

/** 同一个客户端只维护一份列表快照及失效订阅，最后一个使用者卸载后释放订阅。 */
export function configListFor(client: ConfigClient): ConfigList {
  let list = lists.get(client);
  if (!list) {
    list = new ConfigList(client);
    lists.set(client, list);
  }
  return list;
}
