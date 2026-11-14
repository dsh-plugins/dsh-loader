import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DshMenu } from '../../src/ui/menu.js';

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });

/** jsdom 没有布局，给每行一个固定高度，让钳制逻辑可测。 */
function stubRowHeight(height: number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rect = original.call(this);
    if (this.getAttribute('role') === 'menuitem') {
      return { ...rect, height, width: 200, top: 0, bottom: height, left: 0, right: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return rect;
  });
}

function renderMenu(count: number, maxRows?: number) {
  const items = Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, label: `选项 ${index}` }));
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(
    <DshMenu open portal items={items} maxRows={maxRows} onSelect={() => {}} onClose={() => {}}
      anchor={<button type="button">触发器</button>} />,
  ));
  return container;
}

it('maxRows 按行高限制菜单滚动区域，并保留可滚动的其余行', () => {
  stubRowHeight(30);
  renderMenu(12, 5);
  const menu = document.querySelector('[role="menu"]')!;
  const viewport = menu.querySelector<HTMLElement>(':scope > [role="presentation"]')!;
  expect(viewport.querySelectorAll('[role="menuitem"]')).toHaveLength(12);
  expect(viewport.style.maxHeight).toBe('150px');
  expect(viewport.style.overflowY).toBe('auto');
});

it('未指定 maxRows 或行数不超过上限时不加滚动限制', () => {
  stubRowHeight(30);
  renderMenu(12);
  const unbounded = document.querySelector('[role="menu"]')!;
  expect(unbounded.querySelector<HTMLElement>(':scope > [role="presentation"]')!.style.maxHeight).toBe('');
  act(() => root?.unmount());
  document.body.replaceChildren();
  renderMenu(3, 5);
  const bounded = document.querySelector('[role="menu"]')!;
  const viewport = bounded.querySelector<HTMLElement>(':scope > [role="presentation"]')!;
  expect(viewport.style.maxHeight).toBe('90px');
  expect(viewport.style.overflowY).toBe('');
});

it('隐藏标记只进入首个可选项，分隔与标题行不变', () => {
  renderMenu(2, 5);
  const rows = [...document.querySelectorAll('[role="menuitem"]')];
  expect(rows).toHaveLength(2);
  expect(rows[0].querySelector('span[hidden]')).not.toBeNull();
  expect(rows[1].querySelector('span[hidden]')).toBeNull();
});
