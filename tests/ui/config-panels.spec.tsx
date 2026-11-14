import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createConfigDialogs, type ConfigPanelProps } from '../../src/ui/config-dialogs.js';
import { ConfigCard, ConfigPage, CONFIG_CSS } from '../../src/ui/config-form.js';
import { Arco, installArco } from '../../src/ui/arco.js';
import type { ConfigView } from '../../src/config.js';
import type { ConfigClient } from '../../src/config-client.js';

it('在分组中挂载自定义面板并隐藏替代字段，卸载和重新注册可清理组件', async () => {
  const view: ConfigView = { template: { id: 'sample', packageName: '@example/sample', title: '配置', fields: [
    { type: 'text', key: 'hidden', label: '内部字段', hidden: true },
    { type: 'group', label: '功能组', fields: [], panel: 'manager' },
  ], panels: [{ id: 'manager', title: '管理面板', custom: true, fields: [], operations: [] }] }, value: { hidden: 'keep' }, defaults: {}, revision: 1 };
  const client = { invoke: vi.fn(async () => ({ value: '完成' })), update: vi.fn() } as unknown as ConfigClient;
  const api = createConfigDialogs(client);
  const releases: (() => void)[] = [];
  const owner = { effect(fn) { releases.push(fn()); } };
  const cleaned = vi.fn();
  function Manager({ client }: ConfigPanelProps) {
    React.useEffect(() => cleaned, []);
    return <button type="button" onClick={() => { void client.invoke('sample', 'test', { input: {} }); }}>管理条目</button>;
  }
  const release = api.registerPanel(owner, { configId: 'sample', id: 'manager', component: Manager });
  const container = document.body.appendChild(document.createElement('div')), root = createRoot(container);
  try {
    act(() => root.render(<ConfigCard view={view} client={client} dialogs={api}/>));
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === '管理条目')!;
    expect(button.closest('fieldset')!.querySelector('legend')!.textContent).toBe('功能组');
    expect(container.querySelectorAll('[data-config-panel=manager]')).toHaveLength(1);
    expect(container.querySelector('input')).toBeNull();
    await act(async () => button.click());
    expect(client.invoke).toHaveBeenCalledWith('sample', 'test', { input: {} });
    expect(client.update).not.toHaveBeenCalled();
    act(() => release());
    expect(cleaned).toHaveBeenCalledOnce();
    act(() => { api.registerPanel(owner, { configId: 'sample', id: 'manager', component: Manager }); });
    release();
    expect(api.panelComponent('sample', 'manager')).toBe(Manager);
    expect(() => api.registerPanel(owner, { configId: 'sample', id: 'manager', component: Manager })).toThrow();
  } finally {
    act(() => { api.dispose(); root.unmount(); });
    container.remove();
    for (const cleanup of releases) { cleanup(); }
  }
});

it('未绑定字段的管理面板保持独立保存，不参与卡片草稿', async () => {
  const view: ConfigView = { template: { id: 'sample', packageName: '@example/sample', title: '配置', fields: [], panels: [{ id: 'free', title: '独立面板', custom: true, fields: [], operations: [] }] }, value: {}, defaults: {}, revision: 1 };
  const client = { update: vi.fn() } as unknown as ConfigClient;
  const api = createConfigDialogs(client);
  const seen: ConfigPanelProps[] = [];
  api.registerPanel({ effect: fn => fn() }, { configId: 'sample', id: 'free', component: (props: ConfigPanelProps) => { seen.push(props); return <p>自由面板</p>; } });
  const container = document.body.appendChild(document.createElement('div')), root = createRoot(container);
  try {
    act(() => root.render(<ConfigCard view={view} client={client} dialogs={api}/>));
    expect(seen.at(-1)!.value).toBeUndefined();
    expect(seen.at(-1)!.setValue).toBeUndefined();
    expect(container.querySelectorAll<HTMLButtonElement>('button')[0].disabled).toBe(true);
  } finally {
    act(() => { api.dispose(); root.unmount(); }); container.remove();
  }
});

it('绑定字段的自定义面板改写卡片草稿，并由卡片的保存与修订号一并提交', async () => {
  const view: ConfigView = {
    template: { id: 'sample', packageName: '@example/sample', title: '配置', fields: [
      { type: 'array', key: 'modes', label: '模式', hidden: true, item: { type: 'text', label: '模式' } },
    ], panels: [{ id: 'rules', title: '规则面板', custom: true, field: ['modes'], fields: [], operations: [] }] },
    value: { modes: ['standard'] }, defaults: { modes: [] }, revision: 4,
  };
  const client = { update: vi.fn(async (_id: string, value: Record<string, unknown>, revision: number) => ({ ...view, value, revision: revision + 1 })) } as unknown as ConfigClient;
  const api = createConfigDialogs(client);
  function Rules({ value, setValue }: ConfigPanelProps) {
    return <button type="button" onClick={() => setValue!([...(value as string[]), 'ptc'])}>追加 PTC</button>;
  }
  api.registerPanel({ effect: fn => fn() }, { configId: 'sample', id: 'rules', component: Rules });
  const container = document.body.appendChild(document.createElement('div')), root = createRoot(container);
  const find = (text: string) => [...container.querySelectorAll('button')].find(button => button.textContent === text) as HTMLButtonElement;
  try {
    act(() => root.render(<ConfigCard view={view} client={client} dialogs={api}/>));
    expect(find('保存').disabled).toBe(true);
    act(() => find('追加 PTC').click());
    // 面板改动进入卡片草稿：保存按钮解锁，且面板自身不直接写配置。
    expect(find('保存').disabled).toBe(false);
    expect(client.update).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(client.update).toHaveBeenCalledWith('sample', { modes: ['standard', 'ptc'] }, 4);
    expect(find('保存').disabled).toBe(true);
  } finally {
    act(() => { api.dispose(); root.unmount(); }); container.remove();
  }
});

it('管理面板中的 Arco 按钮保持与独立组件相同的样式', () => {
  const releaseStyle = installArco();
  const view: ConfigView = { template: { id: 'sample', packageName: '@example/sample', title: '配置', fields: [], panels: [{ id: 'manager', title: '管理', custom: true, fields: [], operations: [] }] }, value: {}, defaults: {}, revision: 1 };
  const api = createConfigDialogs({} as ConfigClient);
  api.registerPanel({ effect: fn => fn() }, { configId: 'sample', id: 'manager', component: () => <Arco.Button size="small" type="primary">面板按钮</Arco.Button> });
  const container = document.body.appendChild(document.createElement('div')), root = createRoot(container);
  try {
    act(() => root.render(<><style>{CONFIG_CSS}</style><Arco.Button size="small" type="primary">独立按钮</Arco.Button><div className="dshl-config"><ConfigCard view={view} client={{} as ConfigClient} dialogs={api}/></div></>));
    const buttons = [...container.querySelectorAll('button')];
    const reference = getComputedStyle(buttons.find(button => button.textContent === '独立按钮')!);
    const actual = getComputedStyle(buttons.find(button => button.textContent === '面板按钮')!);
    for (const property of ['background-color', 'color', 'padding-top', 'padding-bottom']) {
      expect(actual.getPropertyValue(property)).toBe(reference.getPropertyValue(property));
    }
  } finally {
    act(() => { api.dispose(); root.unmount(); }); container.remove(); releaseStyle();
  }
});

it('绑定面板的改动由 Ctrl+S 与其他字段一并提交，并遵守修订冲突', async () => {
  const view: ConfigView = {
    template: { id: 'sample', packageName: '@example/sample', title: '配置', fields: [
      { type: 'boolean', key: 'enabled', label: '总开关' },
      { type: 'array', key: 'modes', label: '模式', hidden: true, item: { type: 'text', label: '模式' } },
    ], panels: [{ id: 'rules', title: '规则', custom: true, field: ['modes'], fields: [], operations: [] }] },
    value: { enabled: true, modes: ['standard'] }, defaults: { enabled: true, modes: [] }, revision: 7,
  };
  const update = vi.fn(async (_id: string, value: Record<string, unknown>, revision: number) => ({ ...view, value, revision: revision + 1 }));
  const client = { list: vi.fn(async () => [view]), update, read: vi.fn(), reset: vi.fn(), invoke: vi.fn(), subscribe: vi.fn(() => () => {}), dispose: vi.fn() } as unknown as ConfigClient;
  const api = createConfigDialogs(client);
  api.registerPanel({ effect: fn => fn() }, {
    configId: 'sample', id: 'rules',
    component: ({ value, setValue }: ConfigPanelProps) => (
      <button type="button" onClick={() => setValue!([...(value as string[]), 'ptc'])}>追加模式</button>
    ),
  });
  const container = document.body.appendChild(document.createElement('div')), root = createRoot(container);
  try {
    await act(async () => root.render(<ConfigPage client={client} dialogs={api} layout="plugins"/>));
    const card = container.querySelector<HTMLElement>('.dshl-config-card')!;
    const append = [...card.querySelectorAll('button')].find(button => button.textContent === '追加模式')!;
    act(() => append.click());
    // 面板改动与声明式字段进入同一份草稿：一次 Ctrl+S 只提交一次。
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => { card.querySelector<HTMLElement>('input')!.focus(); card.querySelector<HTMLElement>('input')!.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('sample', { enabled: true, modes: ['standard', 'ptc'] }, 7);
  } finally {
    act(() => { api.dispose(); root.unmount(); }); container.remove();
  }
});
