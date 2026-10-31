import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfigCard } from '../../src/ui/config-form.js';
import { ConfigError, type ConfigPanel, type ConfigView, type ConfigOperationResult } from '../../src/config.js';
import type { ConfigClient } from '../../src/config-client.js';
import { operationsPanel } from '../../examples/config-plugin/operations.mjs';
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); });
const initial = (): ConfigView => ({ template: { id: 'operations', packageName: '@example/operations', title: 'Example', fields: [{ type: 'array', key: 'models', label: '可选模型', item: { type: 'text', label: '模型 ID' } }], panels: [structuredClone(operationsPanel) as ConfigPanel] }, value: { models: ['committed'] }, defaults: { models: ['default'] }, revision: 7 });
async function fixture() {
  const view = initial(), subscribers = new Set<() => void>();
  const api: ConfigClient = {
    list: vi.fn(async () => [view]), read: vi.fn(async () => view), reset: vi.fn(), dispose: vi.fn(),
    update: vi.fn(async (_id, value, revision) => ({ ...view, value, revision: revision + 1 })),
    subscribe: vi.fn(fn => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }),
    invoke: vi.fn(async (_plugin, id, request) => {
      if (id === 'documents.list') return { value: { items: [{ id: 'intro', title: '入门' }, { id: 'tool', title: '工具' }] } };
      if (id === 'documents.load') return { value: { content: `# ${request.input.documentId}`, schema: { type: 'object', properties: { query: { type: 'string' } } } }, resource: { id: String(request.input.documentId), revision: 3 } };
      if (id === 'documents.preview') return { value: request.input.content };
      if (id === 'documents.save') return { value: 'saved', resource: { id: 'intro', revision: 4 } };
      return { value: 'done' };
    }),
  };
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ConfigCard client={api} view={view}/>));
  const draw = (next: ConfigView) => act(() => root.render(<ConfigCard client={api} view={next}/>));
  return { container, api, view, subscribers, draw };
}
function button(container: HTMLElement, text: string) { return [...container.querySelectorAll('button')].find(node => node.textContent === text)!; }
async function click(container: HTMLElement, text: string) { await act(async () => button(container, text).click()); }
function control(container: HTMLElement, label: string) { const node = [...container.querySelectorAll('label')].find(item => item.textContent === label)!; return document.getElementById(node.htmlFor)! as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; }
async function input(container: HTMLElement, label: string, value: string) {
  const node = control(container, label), select = node.tagName === 'SELECT';
  await act(async () => {
    const prototype = select ? HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, select ? JSON.stringify(value) : value);
    node.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }));
  });
}
it('loads an asynchronous list, selects into a transient editor and displays Schema only as collapsed JSON', async () => {
  const { container, api } = await fixture();
  expect(api.invoke).toHaveBeenCalledWith('operations', 'documents.list', { input: { query: '' } }, expect.any(AbortSignal));
  expect(control(container, '文档').textContent).toContain('入门');
  expect(button(container, '保存文档').disabled).toBe(true);
  await input(container, '文档', 'intro'); expect(control(container, '文档内容').value).toBe('# intro');
  const schema = container.querySelector<HTMLDetailsElement>('.dshl-config-json')!;
  expect(schema.open).toBe(false); expect(schema.querySelector('summary')!.textContent).toBe('工具 Schema');
  expect(schema.querySelector('pre')!.textContent).toContain('properties'); expect(schema.querySelector('textarea')).toBeNull();
  expect(button(container, '保存文档').disabled).toBe(false); expect(api.update).not.toHaveBeenCalled();
  await input(container, '下载模型', 'committed'); await click(container, '下载示例模型');
  expect(container.textContent).toContain('下载结果'); expect(container.textContent).toContain('done');
});
it('keeps operation state out of ordinary save and renders safe Markdown, list and text results', async () => {
  const { container, api } = await fixture();
  await input(container, '文档内容', '# Heading\n\n**Bold** [bad](javascript:alert(1))\n\n<script>alert(1)</script>');
  await click(container, '预览 Markdown');
  expect(container.querySelector('.dshl-config-result h1')!.textContent).toBe('Heading');
  expect(container.querySelector('.dshl-config-result strong')!.textContent).toBe('Bold');
  expect(container.querySelector('script')).toBeNull(); expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(container.querySelector('.dshl-config-result li')!.textContent).toBe('入门');
  expect(button(container, '保存').disabled).toBe(true);
  await act(async () => container.querySelectorAll('form')[1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.update).not.toHaveBeenCalled();
  await click(container, '恢复默认值');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.update).toHaveBeenCalledWith('operations', { models: ['default'] }, 7);
  expect(control(container, '文档内容').value).toContain('# Heading');
});
it('uses saved configuration options while persisted configuration is being edited', async () => {
  const { container, api } = await fixture();
  const model = control(container, '下载模型'); expect(model.textContent).toContain('committed');
  await input(container, '模型 ID', 'unsaved');
  expect(model.textContent).toContain('committed'); expect(model.textContent).not.toContain('unsaved');
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.update).toHaveBeenCalledWith('operations', { models: ['unsaved'] }, 7);
  expect(model.textContent).toContain('unsaved');
});
it('sends the loaded resource revision, keeps conflicting drafts, and refreshes the list only after success', async () => {
  const { container, api } = await fixture(); await input(container, '文档', 'intro'); await input(container, '文档内容', 'my draft');
  vi.mocked(api.invoke).mockRejectedValueOnce(new ConfigError('conflict', 'resource changed, keep draft'));
  await click(container, '保存文档');
  expect(control(container, '文档内容').value).toBe('my draft'); expect(container.textContent).toContain('resource changed, keep draft');
  expect(api.invoke).toHaveBeenLastCalledWith('operations', 'documents.save', { input: { documentId: 'intro', content: 'my draft' }, resource: { id: 'intro', revision: 3 } }, expect.any(AbortSignal));
  expect(vi.mocked(api.invoke).mock.calls.filter(call => call[1] === 'documents.list')).toHaveLength(1);
  await click(container, '保存文档'); expect(container.textContent).toContain('文档已保存');
  expect(control(container, '文档内容').value).toBe('my draft');
  expect(vi.mocked(api.invoke).mock.calls.filter(call => call[1] === 'documents.list')).toHaveLength(2);
  await click(container, '保存文档');
  expect(vi.mocked(api.invoke).mock.calls.findLast(call => call[1] === 'documents.save')![2].resource!.revision).toBe(4);
  expect(api.update).not.toHaveBeenCalled();
});
it('discards stale selection loads and preserves edits made while a load was in flight', async () => {
  const { container, api } = await fixture(); const pending: { signal: AbortSignal; finish(value: ConfigOperationResult): void }[] = [];
  vi.mocked(api.invoke).mockImplementation(async (_plugin, _id, _request, signal) => new Promise(resolve => pending.push({ signal: signal!, finish: resolve })));
  await input(container, '文档', 'intro'); await input(container, '文档', 'tool');
  expect(pending[0].signal.aborted).toBe(true);
  await input(container, '文档内容', 'continued typing');
  await act(async () => pending[1].finish({ value: { content: 'tool result' }, resource: { id: 'tool', revision: 2 } }));
  expect(control(container, '文档内容').value).toBe('continued typing'); expect(container.textContent).toContain('未覆盖编辑内容');
  await act(async () => pending[0].finish({ value: { content: 'stale intro' }, resource: { id: 'intro', revision: 1 } }));
  expect(control(container, '文档内容').value).toBe('continued typing'); expect(button(container, '保存文档').disabled).toBe(true);
});
it('deletion sends the resource revision, clears editor identity and refreshes only the declared list', async () => {
  const { container, api } = await fixture(); await input(container, '文档', 'intro');
  vi.mocked(api.invoke).mockResolvedValueOnce({ value: { documentId: '', content: '' }, resource: null }).mockResolvedValueOnce({ value: { items: [{ id: 'tool', title: '工具' }] } });
  await click(container, '删除文档');
  expect(vi.mocked(api.invoke).mock.calls.find(call => call[1] === 'documents.delete')![2].resource).toEqual({ id: 'intro', revision: 3 });
  expect(control(container, '文档内容').value).toBe(''); expect(control(container, '文档').value).toBe('""');
  expect(button(container, '保存文档').disabled).toBe(true); expect(control(container, '文档').textContent).not.toContain('入门');
  expect(api.update).not.toHaveBeenCalled();
});
it('reconnect refreshes only automatic lists and preserves the current editor and revision', async () => {
  const { container, api, subscribers, draw, view } = await fixture(); await input(container, '文档', 'intro'); await input(container, '文档内容', 'dirty editor');
  await act(async () => { for (const notify of subscribers) notify(); });
  expect(vi.mocked(api.invoke).mock.calls.filter(call => call[1] === 'documents.list')).toHaveLength(2);
  expect(vi.mocked(api.invoke).mock.calls.filter(call => call[1] === 'documents.load')).toHaveLength(1);
  draw({ ...view, revision: 8, value: { models: ['external'] } });
  expect(control(container, '文档内容').value).toBe('dirty editor');
  await click(container, '保存文档');
  expect(vi.mocked(api.invoke).mock.calls.find(call => call[1] === 'documents.save')![2].resource).toEqual({ id: 'intro', revision: 3 });
});
it('keeps long operations pending without duplicate submission, allows cancellation and cleans up on unmount', async () => {
  const { container, api, subscribers } = await fixture(); vi.useFakeTimers(); let signal!: AbortSignal;
  vi.mocked(api.invoke).mockImplementation(async (_plugin, _id, _request, abort) => { signal = abort!; return new Promise(() => {}); });
  await input(container, '下载模型', 'committed'); await click(container, '下载示例模型');
  expect(button(container, '下载示例模型中…').disabled).toBe(true);
  await act(async () => vi.advanceTimersByTime(60 * 60 * 1000)); expect(signal.aborted).toBe(false);
  expect(container.textContent).toContain('处理中…');
  await click(container, '取消操作'); expect(signal.aborted).toBe(true); expect(button(container, '下载示例模型').disabled).toBe(false);
  await click(container, '下载示例模型'); act(() => root.unmount()); expect(signal.aborted).toBe(true); expect(subscribers.size).toBe(0);
});
it('disables missing handlers without invoking them', async () => {
  const { container, api, draw, view } = await fixture(); draw({ ...view, availableOperations: [] });
  expect(button(container, '搜索文档').disabled).toBe(true); const count = vi.mocked(api.invoke).mock.calls.length;
  await click(container, '搜索文档'); expect(api.invoke).toHaveBeenCalledTimes(count);
});
