import { expect, it, vi } from 'vitest';
import { ConfigList, configListFor } from '../../src/ui/config-list.js';
import type { ConfigClient } from '../../src/config-client.js';
import type { ConfigView } from '../../src/config.js';

const views = (revision: number): ConfigView[] => [{
  template: { id: 'example', packageName: '@example/plugin', title: '示例', fields: [] },
  value: {}, defaults: {}, revision,
}];
const flush = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };
function fixture() {
  const reads: { resolve(value: ConfigView[]): void; reject(error: Error): void }[] = [];
  let change = () => {};
  const release = vi.fn();
  const client = {
    list: vi.fn(() => new Promise<ConfigView[]>((resolve, reject) => { reads.push({ resolve, reject }); })),
    subscribe: vi.fn((callback: () => void) => { change = callback; return release; }),
  } as unknown as ConfigClient;
  return { client, reads, release, change: () => change(), store: configListFor(client) };
}

it('多个读取者共享已加载快照和一个失效订阅', async () => {
  const { client, reads, store, release } = fixture();
  expect(configListFor(client)).toBe(store);
  const off = store.subscribe(vi.fn());
  await flush();
  expect(store.getSnapshot().status).toBe('loading');
  reads[0].resolve(views(1)); await flush();
  const snapshot = store.getSnapshot();
  const other = store.subscribe(vi.fn());
  await flush();
  expect(store.getSnapshot()).toBe(snapshot);
  expect(client.list).toHaveBeenCalledTimes(1);
  expect(client.subscribe).toHaveBeenCalledTimes(1);
  off(); expect(release).not.toHaveBeenCalled();
  other(); expect(release).toHaveBeenCalledTimes(1);
});

it('合并失效事件并丢弃读取期间已过期的结果', async () => {
  const { reads, store, change, client } = fixture();
  const seen: number[] = [];
  const off = store.subscribe(() => { seen.push(store.getSnapshot().views[0]?.revision ?? 0); });
  await flush();
  change(); change(); change();
  expect(client.list).toHaveBeenCalledTimes(1);
  reads[0].resolve(views(1)); await flush();
  expect(client.list).toHaveBeenCalledTimes(2);
  expect(seen).not.toContain(1);
  reads[1].resolve(views(2)); await flush();
  expect(store.getSnapshot()).toMatchObject({ status: 'ready', views: views(2) });
  off();
});

it('后台刷新及失败保留快照，重试成功后清除错误', async () => {
  const { reads, store, change } = fixture();
  const off = store.subscribe(vi.fn()); await flush();
  reads[0].resolve(views(1)); await flush();
  change(); await flush();
  expect(store.getSnapshot()).toMatchObject({ status: 'loading', views: views(1) });
  reads[1].reject(new Error('暂时无法连接')); await flush();
  expect(store.getSnapshot()).toMatchObject({ status: 'error', views: views(1), error: '暂时无法连接' });
  store.refresh(); await flush();
  reads[2].resolve([]); await flush();
  expect(store.getSnapshot()).toEqual({ status: 'ready', views: [] });
  off();
});

it('卸载后的迟到响应不能覆盖重新订阅的结果', async () => {
  const { reads, store, release } = fixture();
  const off = store.subscribe(vi.fn()); await flush(); off();
  expect(release).toHaveBeenCalledTimes(1);
  const next = store.subscribe(vi.fn()); await flush();
  reads[1].resolve(views(2)); await flush();
  reads[0].resolve(views(1)); await flush();
  expect(store.getSnapshot().views).toEqual(views(2));
  next();
});

it('响应完成到清理之间的失效事件仍会触发下一次读取', async () => {
  const { reads, store, change, client } = fixture();
  let invalidated = false;
  const off = store.subscribe(() => {
    if (store.getSnapshot().status === 'ready' && !invalidated) {
      invalidated = true;
      queueMicrotask(change);
    }
  });
  await flush(); reads[0].resolve(views(1)); await flush();
  expect(client.list).toHaveBeenCalledTimes(2);
  reads[1].resolve(views(2)); await flush();
  expect(store.getSnapshot().views).toEqual(views(2));
  off();
});

it('同步读取失败也转换为可重试的错误状态', async () => {
  const client = { subscribe: () => () => {}, list: () => { throw new Error('连接未就绪'); } } as unknown as ConfigClient;
  const store = new ConfigList(client);
  const off = store.subscribe(vi.fn()); await flush();
  expect(store.getSnapshot()).toEqual({ status: 'error', views: [], error: '连接未就绪' });
  off();
});
