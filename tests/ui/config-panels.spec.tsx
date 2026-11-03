import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createConfigDialogs, type ConfigPanelProps } from '../../src/ui/config-dialogs.js';
import { ConfigCard, CONFIG_CSS } from '../../src/ui/config-form.js';
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
