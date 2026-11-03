import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Scrollbar } from '../../src/ui/scrollbar.js';

it('内容溢出后可用键盘、滚动与拖动滑块导航，内容缩短后收起滑块并清理观察器', () => {
  let resize!: () => void;
  const disconnect = vi.fn(), observe = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  try {
    act(() => root.render(<Scrollbar aria-label="配置正文"><input defaultValue="保留草稿"/></Scrollbar>));
    const viewport = container.querySelector<HTMLElement>('.dshl-scrollbar-viewport')!;
    let total = 800;
    Object.defineProperties(viewport, { clientHeight: { get: () => 200 }, scrollHeight: { get: () => total } });
    act(() => resize());
    const thumb = container.querySelector<HTMLElement>('[role=scrollbar]')!;
    expect(thumb.getAttribute('aria-controls')).toBe(viewport.id);
    expect(observe).toHaveBeenCalledTimes(2);
    act(() => thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(viewport.scrollTop).toBe(600);
    act(() => thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(viewport.scrollTop).toBe(0);
    act(() => {
      viewport.scrollTop = 300;
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(thumb.getAttribute('aria-valuenow')).toBe('300');
    thumb.setPointerCapture = vi.fn();
    thumb.hasPointerCapture = () => true;
    thumb.releasePointerCapture = vi.fn();
    act(() => thumb.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 10, bubbles: true })));
    act(() => thumb.dispatchEvent(new MouseEvent('pointermove', { clientY: 60, bubbles: true })));
    expect(viewport.scrollTop).toBe(500);
    act(() => thumb.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
    expect(thumb.releasePointerCapture).toHaveBeenCalledOnce();
    act(() => thumb.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 60, bubbles: true })));
    act(() => thumb.dispatchEvent(new Event('pointercancel', { bubbles: true })));
    act(() => thumb.dispatchEvent(new MouseEvent('pointermove', { clientY: 100, bubbles: true })));
    expect(viewport.scrollTop).toBe(500);
    total = 100;
    act(() => resize());
    expect(container.querySelector('[role=scrollbar]')).toBeNull();
    expect(container.querySelector('input')!.value).toBe('保留草稿');
  } finally {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalledOnce();
});
