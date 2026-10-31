import * as React from 'react';
import type { ConfigDialogProps, DshLoaderUi } from '@dsh-plugin/dsh-loader/client';

export const inject = ['dshLoaderUi'];
interface Document { title: string; content: string }
/** Build this file as the plugin's client entry, with React and loader/client external. */
export function DocumentEditor({ value, setReader, save, saving }: ConfigDialogProps<Document>) {
  const title = React.useRef<HTMLInputElement>(null), content = React.useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = React.useState('');
  React.useEffect(() => setReader(async signal => {
    signal.throwIfAborted();
    // A code editor can return editor.getValue() here, without mirroring every keystroke.
    return { title: title.current!.value, content: content.current!.value };
  }), [setReader]);
  return <div style={{ display: 'grid', gap: 12 }}>
    <p>此界面由示例插件自定义，确认和插件保存使用同一个数据读取函数。</p>
    <label>文档标题<input ref={title} defaultValue={value.title} style={{ display: 'block', width: '100%', boxSizing: 'border-box', font: 'inherit', color: 'inherit', background: 'transparent' }}/></label>
    <label>文档正文<textarea ref={content} defaultValue={value.content} style={{ display: 'block', width: '100%', minHeight: 160, boxSizing: 'border-box', font: 'inherit', color: 'inherit', background: 'transparent' }}/></label>
    <button type="button" disabled={saving} onClick={() => { void save().then(() => setMessage('插件 .save() 已保存'), () => setMessage('保存失败，内容已保留')); }}>插件调用 .save()</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
export function apply(ctx: { effect(fn: () => (() => void) | void): unknown; dshLoaderUi: Pick<DshLoaderUi, 'config'> }) {
  return ctx.dshLoaderUi.config.registerDialog<Document>(ctx, {
    id: 'document-editor', configId: 'config-example', field: ['document'], title: '自定义文档配置', component: DocumentEditor,
  });
}
