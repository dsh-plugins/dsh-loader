import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigPage } from '../../src/ui/config-form.js';
import { ConfigError, type ConfigView } from '../../src/config.js';
import type { ConfigClient } from '../../src/config-client.js';

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function view(id: string): ConfigView {
  return { template: { id, packageName: '@example/config', title: id, fields: [{ type: 'text', key: 'name', label: '名称' }] }, value: { name: 'before' }, defaults: { name: 'changed' }, revision: 3 };
}
async function render(views = [view('first'), view('second'), view('unchanged')]) {
  const api: ConfigClient = { list: vi.fn(async () => views), read: vi.fn(), update: vi.fn(async (id, value, revision) => ({ ...views.find(item => item.template.id === id)!, value, revision: revision + 1 })), reset: vi.fn(), invoke: vi.fn(), subscribe: vi.fn(() => () => {}), dispose: vi.fn() };
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<ConfigPage client={api} layout="plugins"/>));
  return { api, container, cards: [...container.querySelectorAll<HTMLElement>('.dshl-config-card')] };
}
function button(card: HTMLElement, text: string): HTMLButtonElement {
  return [...card.querySelectorAll('button')].find(item => item.textContent === text)!;
}
function edit(card: HTMLElement) { act(() => button(card, '恢复默认值').click()); }
async function shortcut(target: HTMLElement, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true, ...options });
  await act(async () => { target.focus(); target.dispatchEvent(event); });
  return event;
}
function notices(): string[] { return [...document.querySelectorAll('[role=alert]')].map(node => node.textContent ?? ''); }

it('saves all modified cards once and shows a success Toast only after every request succeeds', async () => {
  const { api, cards } = await render(); edit(cards[0]); edit(cards[1]);
  const complete = new Map<string, (result: ConfigView) => void>();
  vi.mocked(api.update).mockImplementation((id) => new Promise(resolve => complete.set(id, resolve)));
  const input = cards[0].querySelector('input')!;
  expect((await shortcut(input)).defaultPrevented).toBe(true);
  await shortcut(input, { repeat: true });
  expect(api.update).toHaveBeenCalledTimes(2);
  expect(api.update).toHaveBeenCalledWith('first', { name: 'changed' }, 3);
  expect(api.update).toHaveBeenCalledWith('second', { name: 'changed' }, 3);
  expect(notices()).toEqual([]);
  await act(async () => complete.get('first')!({ ...view('first'), value: { name: 'changed' }, revision: 4 }));
  expect(notices()).toEqual([]);
  await act(async () => complete.get('second')!({ ...view('second'), value: { name: 'changed' }, revision: 4 }));
  expect(notices()).toContain('已保存全部 2 项配置');
  expect(button(cards[0], '保存').disabled).toBe(true); expect(button(cards[1], '保存').disabled).toBe(true);
  expect(api.invoke).not.toHaveBeenCalled();
});

it('reports partial failures, retains failed drafts and retries only the remaining modified cards', async () => {
  const { api, cards } = await render(); edit(cards[0]); edit(cards[1]);
  vi.mocked(api.update).mockRejectedValueOnce(new ConfigError('conflict', '配置已被其他页面修改')).mockResolvedValueOnce({ ...view('second'), value: { name: 'changed' }, revision: 4 });
  await shortcut(cards[0].querySelector('input')!);
  expect(notices()).toContain('已保存 1 项配置，1 项保存失败，请检查错误提示');
  expect(cards[0].querySelector<HTMLInputElement>('input')!.value).toBe('changed');
  expect(button(cards[0], '保存').disabled).toBe(false); expect(button(cards[1], '保存').disabled).toBe(true);
  expect(cards[0].textContent).toContain('配置已被其他页面修改');
  await shortcut(cards[0].querySelector('input')!);
  expect(api.update).toHaveBeenCalledTimes(3);
  expect(vi.mocked(api.update).mock.calls[2][0]).toBe('first');
  expect(notices()).toContain('已保存全部 1 项配置');
});

it('shows saved feedback for a manual save and does not write unchanged configuration on Ctrl+S', async () => {
  const { api, cards } = await render([view('first')]);
  await shortcut(cards[0].querySelector('input')!);
  expect(api.update).not.toHaveBeenCalled(); expect(notices()).toContain('没有未保存的配置修改');
  edit(cards[0]);
  await act(async () => cards[0].querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.update).toHaveBeenCalledTimes(1); expect(notices()).toContain('配置已保存');
});

it('scopes Ctrl+S to configuration inputs and preserves other shortcuts and composition', async () => {
  const { api, cards } = await render([view('first')]); edit(cards[0]);
  const outside = document.createElement('input'); document.body.append(outside);
  expect((await shortcut(outside)).defaultPrevented).toBe(false);
  expect((await shortcut(button(cards[0], '保存'))).defaultPrevented).toBe(false);
  const input = cards[0].querySelector('input')!;
  for (const options of [{ altKey: true }, { shiftKey: true }, { metaKey: true }, { isComposing: true }]) {
    expect((await shortcut(input, options)).defaultPrevented).toBe(false);
  }
  expect(api.update).not.toHaveBeenCalled();
  await shortcut(input, { key: 'S' }); expect(api.update).toHaveBeenCalledTimes(1);
});

it('supports editable text and temporary operation inputs without submitting operation drafts', async () => {
  const declaration = view('first');
  declaration.template.panels = [{ id: 'tools', title: '工具', fields: [{ type: 'textarea', key: 'query', label: '查询内容' }], operations: [{ id: 'echo', button: { label: '执行' } }] }];
  const { api, container, cards } = await render([declaration]); edit(cards[0]);
  await shortcut(container.querySelector('textarea')!);
  expect(api.update).toHaveBeenCalledTimes(1); expect(api.invoke).not.toHaveBeenCalled();
  edit(cards[0]);
  const editable = document.createElement('div'); editable.contentEditable = 'true'; editable.setAttribute('contenteditable', 'true'); container.querySelector('.dshl-config')!.append(editable);
  await shortcut(editable); expect(api.update).toHaveBeenCalledTimes(2);
});

it('joins an in-flight manual save and prevents repeated shortcuts from opening the browser save dialog', async () => {
  const { api, cards } = await render([view('first'), view('second')]); edit(cards[0]); edit(cards[1]);
  const complete = new Map<string, (result: ConfigView) => void>();
  vi.mocked(api.update).mockImplementation((id) => new Promise(resolve => { complete.set(id, resolve); }));
  await act(async () => cards[0].querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await shortcut(cards[1].querySelector('input')!);
  expect((await shortcut(document.body, { repeat: true })).defaultPrevented).toBe(true);
  expect(api.update).toHaveBeenCalledTimes(2);
  await act(async () => { for (const [id, resolve] of complete) { resolve({ ...view(id), value: { name: 'changed' }, revision: 4 }); } });
  expect(notices()).toEqual(['已保存全部 2 项配置']);
});

it('keeps a completed shortcut held until key release, blur or page disposal', async () => {
  const { cards } = await render([view('first')]); edit(cards[0]);
  await shortcut(cards[0].querySelector('input')!);
  expect((await shortcut(document.body, { repeat: true })).defaultPrevented).toBe(true);
  act(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: 's', bubbles: true })));
  expect((await shortcut(document.body, { repeat: true })).defaultPrevented).toBe(false);
  await shortcut(cards[0].querySelector('input')!);
  act(() => window.dispatchEvent(new Event('blur')));
  expect((await shortcut(document.body, { repeat: true })).defaultPrevented).toBe(false);
  await shortcut(cards[0].querySelector('input')!);
  act(() => root!.unmount()); root = undefined;
  expect((await shortcut(document.body, { repeat: true })).defaultPrevented).toBe(false);
});

it('queues a new shortcut for a card edited while another shortcut batch is pending', async () => {
  const { api, cards } = await render([view('first'), view('second')]); edit(cards[0]);
  const complete = new Map<string, (result: ConfigView) => void>();
  vi.mocked(api.update).mockImplementation(id => new Promise(resolve => { complete.set(id, resolve); }));
  await shortcut(cards[0].querySelector('input')!);
  act(() => document.dispatchEvent(new KeyboardEvent('keyup', { key: 's', bubbles: true })));
  edit(cards[1]); await shortcut(cards[1].querySelector('input')!);
  expect(api.update).toHaveBeenCalledTimes(1);
  await act(async () => complete.get('first')!({ ...view('first'), value: { name: 'changed' }, revision: 4 }));
  expect(api.update).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.update).mock.calls[1]).toEqual(['second', { name: 'changed' }, 3]);
  expect(notices()).toEqual([]);
  await act(async () => complete.get('second')!({ ...view('second'), value: { name: 'changed' }, revision: 4 }));
  expect(notices()).toEqual(['已保存全部 2 项配置']);
});

it('keeps new edits made after an earlier card saves and reports that they still need saving', async () => {
  const { api, cards } = await render([view('first'), view('second')]); edit(cards[0]); edit(cards[1]);
  const complete = new Map<string, (result: ConfigView) => void>();
  vi.mocked(api.update).mockImplementation(id => new Promise(resolve => { complete.set(id, resolve); }));
  await shortcut(cards[0].querySelector('input')!);
  await act(async () => complete.get('first')!({ ...view('first'), value: { name: 'changed' }, revision: 4 }));
  edit(cards[0]);
  await act(async () => complete.get('second')!({ ...view('second'), value: { name: 'changed' }, revision: 4 }));
  expect(notices()).toEqual(['本次已保存 2 项配置，仍有新的修改未保存']);
  expect(button(cards[0], '保存').disabled).toBe(false);
  expect(api.update).toHaveBeenCalledTimes(2);
});
