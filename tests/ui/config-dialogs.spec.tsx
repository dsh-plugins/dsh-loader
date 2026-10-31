import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigError, type ConfigView } from '../../src/config.js';
import type { ConfigClient } from '../../src/config-client.js';
import { createConfigDialogs, type ConfigDialogProps, type ConfigDialogsAPI, type ConfigDialogSession } from '../../src/ui/config-dialogs.js';
import { ConfigCard } from '../../src/ui/config-form.js';
// The UI facade imports the host menu seed; this suite only exercises its config service.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({ Menu: () => null }));
import { createUi } from '../../src/ui/index.js';
let dialogs: ConfigDialogsAPI, root: Root | undefined;
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = true; }) });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.open = false; }) });
});
afterEach(() => { act(() => { dialogs?.dispose(); root?.unmount(); }); root = undefined; document.body.replaceChildren(); });
const owner = () => { const releases: (() => void)[] = []; return { effect(fn: () => (() => void) | void) { const off = fn(); if (off) releases.push(off); }, dispose() { for (const off of releases) off(); } }; };
function fixture() {
  let view: ConfigView = { template: { id: 'sample', packageName: '@example/sample', title: 'Sample', fields: [
    { type: 'text', key: 'unrelated', label: 'Other' },
    { type: 'object', key: 'editor', label: 'Document', dialog: { id: 'editor', label: '编辑文档' }, fields: [{ type: 'text', key: 'text', label: 'Content', required: true }] },
    { type: 'password', key: 'secret', label: 'Secret' },
  ] }, value: { unrelated: 'keep', editor: { text: 'before' }, secret: { $secret: 'opaque-reference', set: true } }, defaults: {}, revision: 3 };
  const api: ConfigClient = { list: vi.fn(async () => [view]), read: vi.fn(async () => structuredClone(view)), update: vi.fn(async (_id, value, revision) => { view = { ...view, value, revision: revision + 1 }; return structuredClone(view); }), reset: vi.fn(), invoke: vi.fn(), subscribe: vi.fn(() => () => {}), dispose: vi.fn() };
  dialogs = createConfigDialogs(api);
  const context = owner();
  const register = (component = Editor, targetOwner = context) => dialogs.registerDialog<{ text: string }>(targetOwner, { id: 'editor', configId: 'sample', field: ['editor'], title: 'Custom editor', component });
  return { api, context, register, view };
}
function Editor({ value, setValue, saving, save }: ConfigDialogProps<{ text: string }>) {
  return <><label>自定义内容<textarea value={value.text} onChange={event => setValue({ text: event.target.value })}/></label><button disabled={saving} onClick={() => { void save().catch(() => {}); }}>插件保存</button></>;
}
async function open(handle: ReturnType<ReturnType<typeof fixture>['register']>) {
  let pending!: Promise<ConfigDialogSession<{ text: string }>>;
  await act(async () => { pending = handle.open(); }); return pending;
}
async function click(text: string) { await act(async () => [...document.querySelectorAll('button')].find(node => node.textContent === text)!.click()); }
async function type(value: string) { await act(async () => {
  const textarea = document.querySelector('dialog textarea')!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}); }
it('opens a custom React UI and programmatic save/confirm persist the field through one pipeline', async () => {
  const { register, api } = fixture(), handle = register(), session = await open(handle);
  expect(document.querySelector('dialog')!.open).toBe(true); expect(session.value).toEqual({ text: 'before' });
  await type('via plugin'); await click('插件保存');
  expect(api.update).toHaveBeenCalledWith('sample', { unrelated: 'keep', editor: { text: 'via plugin' }, secret: { $secret: 'opaque-reference', set: true } }, 3, expect.any(AbortSignal));
  expect(document.querySelector('dialog')).not.toBeNull();
  await type('via handle'); await act(async () => { await handle.save(); });
  expect(vi.mocked(api.update).mock.calls.at(-1)![2]).toBe(4);
  await type('via confirm'); await click('确认');
  expect(vi.mocked(api.update).mock.calls.at(-1)![1].editor).toEqual({ text: 'via confirm' });
  expect(vi.mocked(api.update).mock.calls.at(-1)![2]).toBe(5); expect(document.querySelector('dialog')).toBeNull();
});
it('uses an asynchronous custom data reader for both saves, and old reader cleanup cannot remove its replacement', async () => {
  const { register, api } = fixture(), handle = register(), session = await open(handle);
  const old = session.setReader(() => ({ text: 'old' })); const remove = session.setReader(async () => ({ text: 'editor state' })); old(); old();
  await act(async () => { await session.save(); });
  expect(vi.mocked(api.update).mock.calls.at(-1)![1].editor).toEqual({ text: 'editor state' });
  remove(); await act(async () => session.setValue({ text: 'controlled again' })); await click('确认');
  expect(vi.mocked(api.update).mock.calls.at(-1)![1].editor).toEqual({ text: 'controlled again' });
});
it('keeps the custom UI and collected draft after validation and revision conflicts', async () => {
  const { register, api } = fixture(), handle = register(); await open(handle); await type('my draft');
  vi.mocked(api.update).mockRejectedValueOnce(new ConfigError('validation', 'invalid data', { 'editor.text': 'required' }));
  await click('确认'); expect(document.querySelector('dialog')).not.toBeNull(); expect(document.querySelector('textarea')!.value).toBe('my draft'); expect(document.body.textContent).toContain('required');
  vi.mocked(api.update).mockRejectedValueOnce(new ConfigError('conflict', 'keep draft'));
  await click('确认'); expect(document.querySelector('textarea')!.value).toBe('my draft'); expect(document.body.textContent).toContain('keep draft');
  await click('确认'); expect(document.querySelector('dialog')).toBeNull();
  expect(vi.mocked(api.update).mock.calls.every(call => call[2] === 3)).toBe(true);
});
it('deduplicates overlapping saves and waits for the reader before sending a single write', async () => {
  const { register, api } = fixture(), handle = register(), session = await open(handle);
  let finish!: (value: { text: string }) => void;
  session.setReader(() => new Promise(resolve => { finish = resolve; }));
  let first!: Promise<ConfigView>, second!: Promise<ConfigView>;
  await act(async () => { first = session.save(); second = handle.save(); });
  expect(first).toBe(second); expect(api.update).not.toHaveBeenCalled(); expect(document.querySelector('dialog')!.getAttribute('aria-busy')).toBe('true');
  expect([...document.querySelectorAll('button')].find(button => button.textContent === '保存中…')!.disabled).toBe(true);
  await act(async () => { finish({ text: 'collected' }); await first; });
  expect(api.update).toHaveBeenCalledTimes(1);
});
it('cancel and Escape close without writing, return focus, and opening twice reuses one editor', async () => {
  const { register, api } = fixture(), handle = register(); const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const first = await open(handle); expect(await handle.open()).toBe(first);
  await act(async () => { await dialogs.openDialog('sample', 'editor', ['editor']); }); expect(document.querySelectorAll('dialog')).toHaveLength(1);
  await type('discarded'); await click('取消'); expect(api.update).not.toHaveBeenCalled(); expect(document.activeElement).toBe(trigger);
  await open(handle); act(() => document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(document.querySelector('dialog')).toBeNull(); expect(api.update).not.toHaveBeenCalled();
});
it('closing during a slow reader cancels immediately, discards its late value and permits a fresh session', async () => {
  const { register, api } = fixture(), handle = register(), session = await open(handle); let finish!: (value: { text: string }) => void, signal!: AbortSignal;
  session.setReader(abort => { signal = abort; return new Promise(resolve => finish = resolve); });
  let pending!: Promise<ConfigView>; await act(async () => { pending = session.save(); });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'dialog-closed' });
  await act(async () => { session.close(); await rejected; }); expect(signal.aborted).toBe(true);
  await act(async () => { finish({ text: 'late' }); }); expect(api.update).not.toHaveBeenCalled();
  const next = await open(handle); expect(next).not.toBe(session); expect(next.value).toEqual({ text: 'before' });
});
it('owner unload cancels an active write, removes the modal and registration, and old disposal leaves a new registration intact', async () => {
  const { register, api, context } = fixture(), handle = register(), session = await open(handle); let signal!: AbortSignal;
  vi.mocked(api.update).mockImplementation(async (_id, _value, _revision, abort) => { signal = abort!; return new Promise(() => {}); });
  let pending!: Promise<ConfigView>; await act(async () => { pending = session.save(); });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'dialog-closed' });
  await act(async () => { context.dispose(); await rejected; }); expect(signal.aborted).toBe(true); expect(document.querySelector('dialog')).toBeNull();
  expect(dialogs.hasDialog('sample', 'editor', ['editor'])).toBe(false);
  const replacement = register(Editor, owner()); handle.dispose(); expect(dialogs.hasDialog('sample', 'editor', ['editor'])).toBe(true); replacement.dispose();
});
it('unloading or closing during initial read prevents late modal creation', async () => {
  const { register, api, context, view } = fixture(), handle = register(); let finish!: (view: ConfigView) => void;
  vi.mocked(api.read).mockImplementation(() => new Promise(resolve => finish = resolve));
  const pending = handle.open(), rejected = expect(pending).rejects.toMatchObject({ code: 'disposed' }); context.dispose();
  await act(async () => { finish(view); await rejected; }); expect(document.querySelector('dialog')).toBeNull();
});
it('closing and reopening while reading isolates the late initial response from the new dialog', async () => {
  const { register, api, view } = fixture(), handle = register(); let finish!: (view: ConfigView) => void;
  vi.mocked(api.read).mockImplementationOnce(() => new Promise(resolve => finish = resolve));
  const pending = handle.open(), rejected = expect(pending).rejects.toMatchObject({ code: 'dialog-closed' }); handle.close();
  const session = await open(handle);
  await act(async () => { finish(view); await rejected; }); expect(document.querySelectorAll('dialog')).toHaveLength(1);
  await act(async () => { session.setValue({ text: 'fresh' }); await session.save(); });
  expect(vi.mocked(api.update).mock.calls.at(-1)![1].editor).toEqual({ text: 'fresh' });
});
it('registers an uncontrolled editor reader before open resolves and isolates render errors', async () => {
  const { register, api } = fixture();
  function Custom({ setReader }: ConfigDialogProps<{ text: string }>) {
    React.useEffect(() => setReader(() => ({ text: 'from custom effect' })), [setReader]); return <p>custom view</p>;
  }
  const handle = register(Custom); await open(handle); await act(async () => { await handle.save(); });
  expect(vi.mocked(api.update).mock.calls.at(-1)![1].editor).toEqual({ text: 'from custom effect' }); act(() => handle.dispose());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): React.ReactElement { throw new Error('plugin render failed'); }
  const broken = register(Broken); await open(broken);
  expect(document.body.textContent).toContain('插件配置界面无法显示'); expect(document.body.textContent).toContain('plugin render failed');
  await expect(broken.save()).rejects.toMatchObject({ code: 'render-error' });
});
it('declarative dialog buttons track registration and open the right field without changing ordinary drafts', async () => {
  const { register, api, view } = fixture(); const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root!.render(<ConfigCard view={view} client={api} dialogs={dialogs}/>));
  expect([...container.querySelectorAll('button')].find(button => button.textContent === '编辑文档')!.disabled).toBe(true);
  let handle!: ReturnType<typeof register>; act(() => { handle = register(); }); await click('编辑文档');
  expect(document.querySelector('dialog textarea')!.value).toBe('before'); await type('new'); await click('确认');
  expect(api.update).toHaveBeenCalledTimes(1); expect([...container.querySelectorAll('button')].find(button => button.textContent === '保存')!.disabled).toBe(true);
  act(() => handle.dispose()); expect([...container.querySelectorAll('button')].find(button => button.textContent === '编辑文档')!.disabled).toBe(true);
});
it('rejects duplicate registrations, undeclared fields and non-JSON editor data', async () => {
  const { register, api, view } = fixture(), handle = register(); expect(() => register()).toThrow('already registered');
  for (const field of [[], ['__proto__'], [5]]) expect(() => dialogs.registerDialog(owner(), { id: 'invalid', configId: 'sample', field: field as string[], title: 'Invalid', component: Editor })).toThrow('Invalid config dialog');
  expect(() => dialogs.registerDialog(owner(), { id: undefined as any, configId: 'sample', field: ['editor'], title: 'Invalid', component: Editor })).toThrow('Invalid config dialog');
  await expect(dialogs.openDialog('sample', 'editor', ['other'])).rejects.toMatchObject({ code: 'not-found' });
  vi.mocked(api.read).mockResolvedValueOnce({ ...view, template: { ...view.template, fields: [] } });
  await expect(handle.open()).rejects.toMatchObject({ code: 'invalid' });
  const session = await open(handle); expect(() => session.setValue({ text: (() => {}) as any })).toThrow('JSON');
});
it('exposes the same registry on the UI service and destroys all dialogs with that service', async () => {
  const { register } = fixture(), ui = createUi({ config: dialogs }); expect(ui.config).toBe(dialogs);
  const handle = register(); await open(handle); act(() => ui.destroy()); expect(document.querySelector('dialog')).toBeNull();
  await expect(handle.open()).rejects.toMatchObject({ code: 'disposed' });
});
