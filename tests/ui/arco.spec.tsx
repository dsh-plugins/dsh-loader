import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Arco, installArco } from '../../src/ui/arco.js';

// React 19 只在 react-dom/client 提供根节点 API；测试仍使用真实 React 渲染器。
vi.mock('react-dom', async importOriginal => {
  const original = await importOriginal<typeof import('react-dom') & { default: typeof import('react-dom') }>();
  const api = { ...original.default, createRoot: undefined, render: undefined, unmountComponentAtNode: undefined };
  return { ...original, ...api, default: api };
});

let root: Root | undefined;
const releases: (() => void)[] = [];

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = undefined;
  }
  for (const release of releases.splice(0).reverse()) {
    release();
  }
  document.body.replaceChildren();
  document.body.removeAttribute('data-ds-dark-theme');
  document.body.removeAttribute('arco-theme');
});

describe('共享 Arco 控件', () => {
  it('宿主未导出旧 React DOM API 时可显示和清理独立消息', async () => {
    releases.push(installArco());
    try {
      await act(async () => {
        Arco.Message.success({ content: '独立消息', duration: 0 });
      });
      expect(document.body.textContent).toContain('独立消息');
    } finally {
      act(() => {
        Arco.Message.clear();
      });
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 650));
      });
    }
    expect(document.body.textContent).not.toContain('独立消息');
  });

  it('附属插件可使用组件与组合组件，事件由同一 React 渲染树处理', () => {
    releases.push(installArco());
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const onClick = vi.fn();
    act(() => root!.render(<Arco.Space><Arco.Button type="primary" onClick={onClick}>保存配置</Arco.Button><Arco.Select defaultValue="foo"><Arco.Select.Option value="foo">选项</Arco.Select.Option></Arco.Select></Arco.Space>));
    const button = container.querySelector('button')!;
    act(() => button.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('选项');
  });

  it('安装控件样式时保留宿主字体、页面边距与原生按钮的焦点样式', () => {
    const hostStyle = document.createElement('style');
    hostStyle.textContent = 'body{font-size:19px;margin:13px;padding:7px;line-height:2;font-family:serif}button{outline:1px solid red}';
    document.head.appendChild(hostStyle);
    releases.push(() => hostStyle.remove());
    const button = document.createElement('button');
    document.body.appendChild(button);
    const before = getComputedStyle(document.body);
    const properties = ['font-size', 'margin', 'padding', 'line-height', 'font-family'];
    const previous = properties.map(property => before.getPropertyValue(property));
    releases.push(installArco());
    const after = getComputedStyle(document.body);
    expect(properties.map(property => after.getPropertyValue(property))).toEqual(previous);
    expect(getComputedStyle(button).outline).toBe('1px solid red');
  });

  it('初始深色、切换浅色与再次切换深色时同步 body Portal 的主题变量', async () => {
    document.body.setAttribute('data-ds-dark-theme', '');
    releases.push(installArco());
    expect(document.body.getAttribute('arco-theme')).toBe('dark');
    const dark = getComputedStyle(document.body).getPropertyValue('--color-bg-2');
    document.body.removeAttribute('data-ds-dark-theme');
    await Promise.resolve();
    expect(document.body.hasAttribute('arco-theme')).toBe(false);
    const light = getComputedStyle(document.body).getPropertyValue('--color-bg-2');
    expect(dark).not.toBe(light);
    document.body.setAttribute('data-ds-dark-theme', '');
    await Promise.resolve();
    expect(getComputedStyle(document.body).getPropertyValue('--color-bg-2')).toBe(dark);
  });

  it('卸载移除样式并恢复原有主题，重新安装后继续跟随宿主', async () => {
    document.body.setAttribute('arco-theme', 'dark');
    const off = installArco();
    expect(document.body.hasAttribute('arco-theme')).toBe(false);
    off();
    expect(document.body.getAttribute('arco-theme')).toBe('dark');
    expect(document.querySelector('style[data-plugin-css="@dsh-plugin/dsh-loader/ui/arco.css"]')).toBeNull();
    document.body.setAttribute('data-ds-dark-theme', '');
    releases.push(installArco());
    expect(document.querySelectorAll('style[data-plugin-css="@dsh-plugin/dsh-loader/ui/arco.css"]')).toHaveLength(1);
    document.body.removeAttribute('data-ds-dark-theme');
    await Promise.resolve();
    expect(document.body.hasAttribute('arco-theme')).toBe(false);
  });

  it('卸载停止主题监听，并保留其他代码后来设置的 Arco 主题', async () => {
    const off = installArco();
    document.body.setAttribute('arco-theme', 'custom');
    off();
    expect(document.body.getAttribute('arco-theme')).toBe('custom');
    document.body.setAttribute('data-ds-dark-theme', '');
    await Promise.resolve();
    expect(document.body.getAttribute('arco-theme')).toBe('custom');
  });
});
