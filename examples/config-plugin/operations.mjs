import { setTimeout as delay } from 'node:timers/promises';

/** A serializable editor; neither its inputs nor its results enter config.json. */
export const operationsPanel = {
  id: 'documents', title: '文档与工具示例', description: '临时表单与配置保存相互独立；示例文档仅存于内存，重启后重置。',
  fields: [
    { type: 'text', key: 'query', label: '搜索词' },
    { type: 'select', key: 'documentId', label: '文档', optionsFrom: { operation: 'documents.list', path: ['items'], label: ['title'], value: ['id'] } },
    { type: 'textarea', key: 'content', label: '文档内容', description: '选择文档后自动填充；编辑内容只在点击“保存文档”时提交给处理器。' },
    { type: 'group', label: '导入', collapsible: true, defaultCollapsed: true, fields: [{ type: 'textarea', key: 'importText', label: '导入内容' }] },
    { type: 'select', key: 'model', label: '下载模型', optionsFrom: { config: ['models'] }, description: '选项来自已保存的配置，不读取未保存的配置草稿。' },
  ],
  operations: [
    { id: 'documents.list', readOnly: true, autoRun: true, input: ['query'], button: { label: '搜索文档' }, result: [{ type: 'list', title: '搜索结果', path: ['items'], label: ['title'] }] },
    { id: 'documents.load', readOnly: true, input: ['documentId'], onChange: [['documentId']], button: { label: '重新加载文档' }, fill: [{ from: ['content'], to: ['content'] }], result: [{ type: 'json', title: '工具 Schema', path: ['schema'] }] },
    { id: 'documents.save', input: ['documentId', 'content'], requiresRevision: true, button: { label: '保存文档', success: '文档已保存' }, refresh: ['documents.list'] },
    { id: 'documents.delete', input: ['documentId'], requiresRevision: true, button: { label: '删除文档', success: '文档已删除' }, fill: [{ from: ['documentId'], to: ['documentId'] }, { from: ['content'], to: ['content'] }], refresh: ['documents.list'] },
    { id: 'documents.import', input: ['importText'], button: { label: '导入到草稿' }, fill: [{ from: ['content'], to: ['content'] }] },
    { id: 'documents.preview', readOnly: true, input: ['content'], button: { label: '预览 Markdown' }, result: [{ type: 'markdown', title: '文档预览' }] },
    { id: 'models.download', input: ['model'], button: { label: '下载示例模型', success: '示例下载完成' }, result: [{ type: 'text', title: '下载结果' }] },
  ],
};

export function registerExampleOperations(handle, ConfigError) {
  const documents = new Map([
    ['intro', { title: '入门文档', content: '# 入门\n\n这是 **Markdown** 文档。', revision: 1 }],
    ['tool', { title: '工具说明', content: '# 工具\n\nSchema 在只读 JSON 中展示。', revision: 1 }],
  ]);
  const schema = { type: 'object', properties: { query: { type: 'string', description: '搜索内容' } }, required: ['query'] };
  const get = id => { const document = documents.get(id); if (!document) throw new ConfigError('not-found', '文档不存在'); return document; };
  const check = (input, resource) => {
    if (input.documentId !== resource.id) throw new ConfigError('conflict', '所选文档与已加载的资源不一致，请重新加载');
    const document = get(resource.id);
    if (document.revision !== resource.revision) throw new ConfigError('conflict', '文档已被其他页面修改；草稿已保留，请重新加载后重试');
    return document;
  };
  handle.registerOperation('documents.list', ({ input }) => ({ value: { items: [...documents].filter(([, document]) => document.title.includes(input.query)).map(([id, document]) => ({ id, title: document.title })) } }));
  handle.registerOperation('documents.load', ({ input }) => {
    const document = get(input.documentId);
    return { value: { content: document.content, schema }, resource: { id: input.documentId, revision: document.revision } };
  });
  handle.registerOperation('documents.save', ({ input, resource, signal }) => {
    signal.throwIfAborted(); const document = check(input, resource);
    document.content = input.content; document.revision++;
    return { value: '已保存', resource: { id: resource.id, revision: document.revision } };
  });
  handle.registerOperation('documents.delete', ({ input, resource, signal }) => {
    signal.throwIfAborted(); check(input, resource); documents.delete(resource.id);
    return { value: { documentId: '', content: '' }, resource: null };
  });
  handle.registerOperation('documents.import', ({ input }) => ({ value: { content: input.importText } }));
  handle.registerOperation('documents.preview', ({ input }) => ({ value: input.content }));
  handle.registerOperation('models.download', async ({ input, signal }) => {
    if (!input.model) throw new ConfigError('validation', '请选择已保存配置中的模型', { model: '请先选择模型' });
    // Demonstration only. Real downloaders must also pass signal to their IO.
    await delay(2000, undefined, { signal });
    return { value: `示例任务完成：${input.model}（未下载实际文件）` };
  });
  return { documents };
}
