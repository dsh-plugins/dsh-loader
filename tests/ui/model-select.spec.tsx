import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelSelect, ConfigModelsContext, type ModelSelectProps } from '../../src/ui/model-select.js';
import { createConfigModelSource, type ConfigModelList } from '../../src/ui/config-model-source.js';
import { ConfigCard, installConfigUI } from '../../src/ui/config-form.js';
import type { ConfigClient } from '../../src/config-client.js';
import type { ConfigModelValue, ConfigView } from '../../src/config.js';
import { createBootDescriptor } from '../../src/bootstrap.js';

const directory: ConfigModelList = { groups: [
  { id: 'deepseek', name: 'DeepSeek', models: [
    { id: 'flash', name: 'DeepSeek-V4.1-Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }], defaultEffort: 'high' } },
    { id: 'plain', name: 'Plain model' },
  ] },
  { id: 'example', name: '示例提供商', models: [{ id: 'flash', name: '示例 Flash', reasoning: { efforts: [{ id: 'custom', name: '自定义等级' }], defaultEffort: 'custom' } }] },
], failures: [] };
const initial: ConfigModelValue = { provider: 'deepseek', model: 'flash', reasoningEffort: 'high' };
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function draw(element: React.ReactElement) {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root!.render(element)); return container;
}
function setup(props: Partial<ModelSelectProps> = {}) {
  const changed = vi.fn(), load = vi.fn(async () => directory);
  function Example() {
    const [value, setValue] = React.useState(props.value === undefined ? initial : props.value);
    return <ModelSelect {...props} value={value} onChange={next => { changed(next); setValue(next); }} loadModels={props.loadModels ?? load}/>;
  }
  return { container: draw(<Example/>), changed, load };
}
async function click(node: Element) { await act(async () => { (node as HTMLElement).click(); }); }
function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const node = [...scope.querySelectorAll('button')].find(item => item.textContent === text);
  if (!node) { throw new Error(`缺少按钮：${text}`); } return node;
}
function popup(): HTMLElement { return document.querySelector<HTMLElement>('[role=dialog]')!; }
async function open(container: HTMLElement) { await click(container.querySelector('.dshl-model-trigger')!); }
async function search(text: string) {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function key(node: Element, value: string) { act(() => { node.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }); }

it('searches provider and model names and keeps equal model IDs from different providers distinct', async () => {
  const { container, changed } = setup({ value: null }); await open(container);
  expect(document.activeElement).toBe(document.querySelector('input[type=search]'));
  expect(popup().querySelectorAll('[role=group]')).toHaveLength(2);
  await search('  示例提供商  ');
  expect(popup().querySelectorAll('[role=option]')).toHaveLength(1);
  await click(button('示例 Flash'));
  expect(changed).toHaveBeenCalledWith({ provider: 'example', model: 'flash', reasoningEffort: 'custom' });
  expect(popup()).toBeNull(); expect(document.activeElement).toBe(container.querySelector('button'));
  expect(container.textContent).toContain('自定义等级');
  await open(container); await click(button('模型示例 Flash')); await search('PLAIN');
  expect(popup().querySelectorAll('[role=option]')).toHaveLength(1);
  await search('missing'); expect(popup().textContent).toContain('没有匹配的模型');
});

it('offers adapter-owned effort IDs, preserves supported efforts and removes them for non-reasoning models', async () => {
  const { container, changed } = setup(); await open(container); await click(button('推理等级High'));
  expect([...popup().querySelectorAll('[role=option]')].map(item => item.textContent)).toEqual(['Off', 'Low', 'High', 'Max', '使用提供商默认值']);
  expect(popup().querySelector('[aria-selected=true]')!.textContent).toBe('High');
  expect(document.activeElement).toBe(popup().querySelector('[aria-selected=true]'));
  await click(button('Max')); expect(changed).toHaveBeenLastCalledWith({ ...initial, reasoningEffort: 'max' });
  await open(container); await click(button('模型DeepSeek-V4.1-Flash')); await click(button('DeepSeek-V4.1-Flash'));
  expect(changed).toHaveBeenLastCalledWith({ ...initial, reasoningEffort: 'max' });
  await open(container); await click(button('模型DeepSeek-V4.1-Flash')); await click(button('示例 Flash'));
  expect(changed).toHaveBeenLastCalledWith({ provider: 'example', model: 'flash', reasoningEffort: 'custom' });
  await open(container); await click(button('模型示例 Flash')); await click(button('Plain model'));
  expect(changed).toHaveBeenLastCalledWith({ provider: 'deepseek', model: 'plain' });
  await open(container); expect(popup().textContent).not.toContain('推理等级');
});

it('can inherit provider reasoning and marks exactly one choice without writing during refresh', async () => {
  const { container, changed } = setup(); await open(container); await click(button('推理等级High')); await click(button('使用提供商默认值'));
  expect(changed).toHaveBeenLastCalledWith({ provider: 'deepseek', model: 'flash' });
  await open(container); await click(button('推理等级High'));
  expect(popup().querySelectorAll('[aria-selected=true]')).toHaveLength(1);
  expect(popup().querySelector('[aria-selected=true]')!.textContent).toBe('使用提供商默认值');
  await click(button('刷新模型列表')); expect(changed).toHaveBeenCalledTimes(1);
});

it('preserves missing models and stale efforts and only clears optional fields explicitly', async () => {
  const missing = { provider: 'removed', model: 'retained', reasoningEffort: 'old' };
  const { container, changed } = setup({ value: missing }); await open(container);
  expect(popup().textContent).toContain('当前模型未在目录中'); expect(changed).not.toHaveBeenCalled();
  await click(button('清除选择')); expect(changed).toHaveBeenCalledWith(null); expect(container.textContent).toContain('选择模型');
  await act(async () => { root!.render(<ModelSelect value={{ ...initial, reasoningEffort: 'old' }} onChange={changed} loadModels={async () => directory} required/>); });
  await open(container); expect(popup().textContent).toContain('当前推理等级已不可用');
  expect([...popup().querySelectorAll('button')].some(item => item.textContent === '清除选择')).toBe(false);
});

it('keeps successful providers usable during partial failures and retries a failed load', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('连接失败')).mockResolvedValue({ ...directory, failures: [{ id: 'offline', name: '离线提供商', message: '暂时不可用' }] });
  const { container, changed } = setup({ value: null, loadModels: load }); await open(container);
  expect(popup().querySelector('[role=alert]')!.textContent).toBe('连接失败');
  await click(button('重试加载')); expect(popup().textContent).toContain('离线提供商：暂时不可用');
  await click(button('Plain model')); expect(changed).toHaveBeenCalledWith({ provider: 'deepseek', model: 'plain' });
});

it('shows an empty-directory state without automatically choosing or clearing a model', async () => {
  const { container, changed } = setup({ value: null, loadModels: async () => ({ groups: [], failures: [] }) });
  await open(container); expect(popup().textContent).toContain('暂无可用模型'); expect(changed).not.toHaveBeenCalled();
});

it('supports arrow navigation, Escape back navigation, outside dismissal and focus return', async () => {
  const { container } = setup(); const trigger = container.querySelector('button')!;
  key(trigger, 'ArrowDown'); await act(async () => {});
  key(document.activeElement!, 'ArrowDown'); expect(document.activeElement!.textContent).toContain('推理等级');
  key(document.activeElement!, 'Home'); expect(document.activeElement!.textContent).toContain('模型');
  await click(document.activeElement!); const input = document.querySelector('input')!;
  key(input, 'ArrowDown'); expect(document.activeElement!.getAttribute('role')).toBe('option');
  key(document.activeElement!, 'Escape'); expect(popup().querySelector('input')).toBeNull();
  key(document.activeElement!, 'Escape'); expect(popup()).toBeNull(); expect(document.activeElement).toBe(trigger);
  await open(container); act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))); expect(popup()).toBeNull();
});

it('cancels late reads on dismissal or unmount and closes a popup when the field is disabled', async () => {
  let complete!: (value: ConfigModelList) => void;
  const load = vi.fn((signal: AbortSignal) => new Promise<ConfigModelList>(resolve => { complete = resolve; }));
  const { container, changed } = setup({ value: null, loadModels: load }); await open(container);
  const signal = load.mock.calls[0][0]; key(document.querySelector('input')!, 'Escape'); expect(signal.aborted).toBe(true);
  await act(async () => complete(directory)); expect(popup()).toBeNull(); expect(changed).not.toHaveBeenCalled();
  await act(async () => root!.render(<ModelSelect value={initial} onChange={changed} loadModels={async () => directory}/>));
  await open(container); act(() => root!.render(<ModelSelect value={initial} onChange={changed} disabled/>));
  expect(popup()).toBeNull(); expect((container.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
});

it('stages nested model selections and null clears until the owning config card saves', async () => {
  const view: ConfigView = { template: { id: 'models', packageName: '@example/models', title: '模型配置', fields: [{ type: 'object', key: 'nested', label: '路由', fields: [{ type: 'model', key: 'route', label: '模型', default: initial }] }] }, value: { nested: { route: initial } }, defaults: { nested: { route: initial } }, revision: 4 };
  const client: ConfigClient = { list: vi.fn(), read: vi.fn(), update: vi.fn(async (_id, value) => ({ ...view, value, revision: 5 })), reset: vi.fn(), invoke: vi.fn(), subscribe: vi.fn(() => () => {}), dispose: vi.fn() };
  const container = draw(<ConfigModelsContext.Provider value={async () => directory}><ConfigCard view={view} client={client}/></ConfigModelsContext.Provider>);
  await open(container); await click(button('模型DeepSeek-V4.1-Flash')); await click(button('示例 Flash')); expect(client.update).not.toHaveBeenCalled();
  await click(button('取消修改')); expect(container.querySelector('.dshl-model-trigger')!.textContent).toContain('DeepSeek-V4.1-Flash');
  await open(container); await click(button('清除选择')); expect(container.querySelector('.dshl-model-trigger')!.textContent).toContain('选择模型');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(client.update).toHaveBeenCalledWith('models', { nested: { route: null } }, 4);
  await click(button('恢复默认值')); expect(container.querySelector('.dshl-model-trigger')!.textContent).toContain('DeepSeek-V4.1-Flash');
});

it('injects connection explicitly, unwraps RPC failures and rejects malformed directories', async () => {
  const release: (() => void)[] = [], inject = vi.fn();
  const llm = { models: vi.fn(async () => ({ result: { ok: true, value: directory } })) };
  const source = createConfigModelSource({ inject: (names, callback) => { inject(names); callback({ get: name => { expect(name).toBe('connection'); return { api: { llm } }; }, effect: fn => { const off = fn(); if (off) { release.push(off); } } }); } });
  expect(inject).toHaveBeenCalledWith(['connection']);
  expect(await source(new AbortController().signal)).toBe(directory);
  expect(llm.models).toHaveBeenCalledWith({});
  llm.models.mockResolvedValueOnce({ result: { ok: false, error: { code: 'transport', message: 'RPC 失败' } } } as never);
  await expect(source(new AbortController().signal)).rejects.toMatchObject({ code: 'transport', message: 'RPC 失败' });
  llm.models.mockResolvedValueOnce({ result: { ok: true, value: { groups: [{ id: 'example', name: 'Example', models: [{ id: 'model', name: 'Model', reasoning: { efforts: [null] } }] }], failures: [] } } } as never);
  await expect(source(new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-result' });
  release[0](); await expect(source(new AbortController().signal)).rejects.toMatchObject({ code: 'unavailable' });
});

it('provides the model source to both supported config UI entry points', async () => {
  for (const version of ['0.1.5-rc.3', '0.1.6-alpha.2']) {
    const view: ConfigView = { template: { id: 'models', packageName: '@example/models', title: '模型', fields: [{ type: 'model', key: 'route', label: '模型' }] }, value: { route: null }, defaults: { route: null }, revision: 0 };
    const client = { list: vi.fn(async () => [view]), subscribe: vi.fn(() => () => {}) } as unknown as ConfigClient;
    let Component!: React.ComponentType;
    const slots = { inject: (_name: string, callback: () => unknown) => { callback(); return () => {}; }, register: (_options: unknown, component: React.ComponentType) => { Component = component; } };
    const load = vi.fn(async () => directory);
    const off = installConfigUI({ get: () => slots }, client, createBootDescriptor(version, 'dsh-' + version.split('-')[0]), undefined, load);
    await act(async () => {});
    let container!: HTMLElement; await act(async () => { container = draw(<Component/>); });
    await open(container); expect(load).toHaveBeenCalledTimes(1); expect(popup().textContent).toContain('DeepSeek-V4.1-Flash');
    act(() => root!.unmount()); root = undefined; document.body.replaceChildren(); off();
  }
});

it('rejects a late directory from a replaced connection and ignores disposal of an older binding', async () => {
  let attach!: Parameters<NonNullable<Parameters<typeof createConfigModelSource>[0]['inject']>>[1];
  const source = createConfigModelSource({ inject: (_names, callback) => { attach = callback; } });
  const releases: (() => void)[] = [];
  let complete!: (value: unknown) => void;
  const oldConnection = { api: { llm: { models: () => new Promise(resolve => { complete = resolve; }) } } };
  const connect = (connection: unknown) => attach({ get: () => connection, effect: fn => { const off = fn(); if (off) { releases.push(off); } } });
  connect(oldConnection);
  const pending = source(new AbortController().signal);
  connect({ api: { llm: { models: async () => ({ result: { ok: true, value: directory } }) } } });
  releases[0]();
  complete({ result: { ok: true, value: directory } });
  await expect(pending).rejects.toMatchObject({ code: 'unavailable', message: '模型连接已变化，请刷新模型列表' });
  expect(await source(new AbortController().signal)).toBe(directory);
  const late = source(new AbortController().signal);
  releases[1]();
  await expect(late).rejects.toMatchObject({ code: 'unavailable' });
});

it('keeps the popup within a native modal dialog so it remains in the active focus and pointer scope', async () => {
  const dialog = document.createElement('dialog'); dialog.open = true; document.body.append(dialog);
  const container = document.createElement('div'); dialog.append(container); root = createRoot(container);
  act(() => root!.render(<ModelSelect value={null} onChange={() => {}} loadModels={async () => directory}/>));
  await open(container);
  expect(dialog.contains(popup())).toBe(true);
  expect(document.activeElement).toBe(popup().querySelector('input'));
  await click(button('Plain model')); expect(popup()).toBeNull(); expect(document.activeElement).toBe(container.querySelector('button'));
});
