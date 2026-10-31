import { ConfigError, defineConfig } from '@dsh-plugin/dsh-loader/config';
import { operationsPanel, registerExampleOperations } from './operations.mjs';

export const name = '@dsh-plugin/config-example';
export const inject = ['dshLoader'];
export const template = defineConfig({
  id: 'config-example',
  packageName: name,
  title: '配置示例',
  description: '配置保存在当前 profile 下；表单由 loader 统一渲染。',
  fields: [
    { type: 'text', key: 'displayName', label: '显示名称', default: '示例', required: true },
    { type: 'boolean', key: 'enabled', label: '启用', default: true },
    { type: 'object', key: 'document', label: '文档配置', dialog: { id: 'document-editor', label: '编辑文档配置' }, fields: [
      { type: 'text', key: 'title', label: '文档标题', default: '示例文档', required: true },
      { type: 'textarea', key: 'content', label: '文档正文', default: '配置弹窗的示例内容', required: true },
    ] },
    { type: 'array', key: 'models', label: '可选模型', default: ['example-model'], item: { type: 'text', label: '模型 ID', required: true } },
    { type: 'group', label: '连接', collapsible: true, defaultCollapsed: false, fields: [
      { type: 'text', key: 'endpoint', label: '服务地址', default: 'https://example.com', pattern: '^https?://', description: '以 http:// 或 https:// 开头。' },
      { type: 'password', key: 'token', label: '访问令牌', description: '已保存的内容不会回传到浏览器。' },
      { type: 'number', key: 'timeout', label: '请求超时（秒）', default: 30, min: 1, max: 300 },
    ] },
    { type: 'select', key: 'mode', label: '工作模式', default: 'simple', options: [
      { label: '简单', value: 'simple' }, { label: '高级', value: 'advanced' },
    ] },
    { type: 'textarea', key: 'notes', label: '高级说明', visibleWhen: { path: ['mode'], equals: 'advanced' } },
    { type: 'array', key: 'targets', label: '目标列表', item: { type: 'object', label: '目标', fields: [
      { type: 'text', key: 'name', label: '名称', default: '新目标', required: true },
      { type: 'multiselect', key: 'tags', label: '标签', options: [{ label: '工作', value: 'work' }, { label: '个人', value: 'personal' }] },
    ] } },
  ],
  panels: [operationsPanel],
});

export async function apply(ctx) {
  const config = await ctx.dshLoader.config.register(ctx, template);
  registerExampleOperations(config, ConfigError);
  // The owner context releases both the registration and its subscriptions.
  const useConfiguration = ({ value }) => {
    // Replace with the plugin's own behavior. Do not log password fields.
    ctx.logger?.info?.(`配置示例：${value.displayName}，${value.enabled ? '已启用' : '已停用'}`);
  };
  useConfiguration(config.get());
  config.watch(useConfiguration);
}
