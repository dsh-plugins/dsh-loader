import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigCard, installConfigUI } from '../../src/ui/config-form.js';
import { createBootDescriptor } from '../../src/bootstrap.js';
import { ConfigError, type ConfigView } from '../../src/config.js';
import type { ConfigClient } from '../../src/config-client.js';
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); });
const view: ConfigView = {
  template: { id: 'example', packageName: '@example/plugin', title: '示例插件', fields: [
    { type: 'text', key: 'name', label: '名称' },
    { type: 'group', label: '连接', fields: [{ type: 'number', key: 'timeout', label: '最长等待时间' }] },
    { type: 'boolean', key: 'advanced', label: '高级设置' },
    { type: 'text', key: 'detail', label: '详细内容', visibleWhen: { path: ['advanced'], equals: true } },
    { type: 'array', key: 'list', label: '列表', item: { type: 'text', label: '元素' } },
  ] }, value: { name: 'before', timeout: 5, advanced: false, detail: '', list: [] }, defaults: { name: 'default', timeout: 3, advanced: false, detail: '', list: [] }, revision: 1,
};
function client(): ConfigClient {
  return { list: vi.fn(async () => [view]), read: vi.fn(async () => view), update: vi.fn(async (_id, value, revision) => ({ ...view, value, revision: revision + 1 })), reset: vi.fn(), subscribe: vi.fn(() => () => {}), dispose: vi.fn() };
}
function render(api = client()) {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root!.render(<ConfigCard view={view} client={api}/>));
  return { container, api };
}
function click(container: HTMLElement, text: string) { act(() => [...container.querySelectorAll('button')].find(button => button.textContent === text)!.click()); }
it('starts collapsed, owns group markup and restores defaults only as a draft', async () => {
  const { container, api } = render();
  expect(container.querySelector('details')!.open).toBe(false);
  expect(container.querySelector('fieldset legend')!.textContent).toBe('连接');
  click(container, '恢复默认值'); expect(api.update).not.toHaveBeenCalled();
  expect(container.querySelector('input')!.value).toBe('default');
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.update).toHaveBeenCalledWith('example', view.defaults, 1);
  expect(container.querySelector('input')!.value).toBe('default');
});
it('keeps the draft and field errors after a rejected save', async () => {
  const api = client(); vi.mocked(api.update).mockRejectedValue(new ConfigError('validation', '保存失败', { name: '错误名称' }));
  const { container } = render(api); click(container, '恢复默认值');
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector('input')!.value).toBe('default'); expect(container.textContent).toContain('错误名称');
  click(container, '取消修改'); expect(container.querySelector('input')!.value).toBe('before');
});
it('supports conditional visibility and array changes without a plugin renderer', () => {
  const { container } = render(); expect(container.textContent).not.toContain('详细内容');
  act(() => container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  expect(container.textContent).toContain('详细内容'); click(container, '新增'); expect(container.textContent).toContain('删除第 1 项');
  click(container, '删除第 1 项'); expect(container.textContent).not.toContain('删除第 1 项');
});
it('routes old versions to settings and new versions to keyed plugin slots, with cleanup', async () => {
  const rows: any[] = []; const releases = vi.fn();
  const ctx = { get: () => ({ inject: (_name: string, callback: () => unknown) => { callback(); return releases; }, register: (options: unknown) => rows.push(options) }) };
  const api = client();
  const old = installConfigUI(ctx, api, createBootDescriptor('0.1.6-alpha.1', 'dsh-0.1.6'));
  expect(rows[0].name).toBe('settings.section'); old(); expect(releases).toHaveBeenCalledTimes(1);
  rows.length = 0;
  const next = installConfigUI(ctx, api, createBootDescriptor('0.1.6-alpha.2', 'dsh-0.1.6'));
  await Promise.resolve(); await Promise.resolve();
  expect(rows[0]).toMatchObject({ name: 'plugins.bundle.config', key: '@example/plugin' }); next();
});

it('keeps cards independent and preserves a dirty draft across external revisions', async () => {
  const api = client(); const second = { ...view, template: { ...view.template, id: 'second', title: 'Second' } };
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const draw = (first: ConfigView) => root!.render(<><ConfigCard view={first} client={api}/><ConfigCard view={second} client={api}/></>);
  act(() => draw(view));
  const cards = container.querySelectorAll<HTMLElement>('details');
  click(cards[0], '恢复默认值');
  expect(cards[1].querySelector('input')!.value).toBe('before');
  const updated = { ...view, value: { ...view.value, name: 'external' }, revision: 2 };
  act(() => draw(updated));
  expect(cards[0].querySelector('input')!.value).toBe('default');
  expect(cards[0].textContent).toContain('配置已有更新');
  vi.mocked(api.update).mockRejectedValueOnce(new ConfigError('conflict', 'revision conflict'));
  await act(async () => { cards[0].querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(api.update).toHaveBeenCalledWith('example', view.defaults, 1);
  expect(cards[0].querySelector('input')!.value).toBe('default');
  expect(cards[1].textContent).not.toContain('revision conflict');
  click(cards[0], '取消修改'); expect(cards[0].querySelector('input')!.value).toBe('external');
});
