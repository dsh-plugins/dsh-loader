import { ConfigError } from '../config.js';

/** 模型适配器声明的推理等级，ID 保持原样传给宿主。 */
export interface ConfigReasoningEffort { id: string; name: string; description?: string }
/** 模型目录中的单个模型及其推理能力。 */
export interface ConfigModelOption {
  id: string;
  name: string;
  description?: string;
  reasoning?: { efforts: readonly ConfigReasoningEffort[]; defaultEffort?: string };
}
/** 同一提供商的模型分组。 */
export interface ConfigModelGroup { id: string; name: string; models: readonly ConfigModelOption[] }
/** 当前宿主成功加载的模型，以及互不影响的提供商错误。 */
export interface ConfigModelList {
  groups: readonly ConfigModelGroup[];
  failures: readonly { id: string; name: string; message: string }[];
}
/** 读取模型目录；取消后消费者必须丢弃迟到结果。 */
export type ConfigModelSource = (signal: AbortSignal) => Promise<ConfigModelList>;

interface ModelConnection {
  api?: { llm?: { models(input: object): Promise<{ result: { ok: true; value: ConfigModelList } | { ok: false; error: { code: string; message: string } } }> } };
}
interface ModelContext {
  get?(name: string): unknown;
  inject?(names: string[], callback: (scope: ModelContext) => unknown): unknown;
  effect?(fn: () => (() => void) | void): unknown;
}

/** 通过 loader 已适配的 connection.api 读取目录，连接随 Cordis 注入和卸载更新。 */
export function createConfigModelSource(ctx: ModelContext): ConfigModelSource {
  let connection: ModelConnection | undefined;
  let generation = 0;
  const mount = (scope: ModelContext) => {
    const current = scope.get?.('connection') as ModelConnection | undefined;
    const mounted = ++generation;
    connection = current;
    scope.effect?.(() => () => { if (generation === mounted) { connection = undefined; generation++; } });
  };
  if (ctx.inject) { ctx.inject(['connection'], mount); } else { mount(ctx); }
  return async signal => {
    signal.throwIfAborted();
    const llm = connection?.api?.llm;
    if (!llm) { throw new ConfigError('unavailable', '模型目录尚未连接，请稍后重试'); }
    const started = generation;
    const response = await llm.models({});
    signal.throwIfAborted();
    if (generation !== started) { throw new ConfigError('unavailable', '模型连接已变化，请刷新模型列表'); }
    if (!response.result.ok) { throw new ConfigError(response.result.error.code, response.result.error.message); }
    const value = response.result.value;
    if (!value || !Array.isArray(value.groups) || !Array.isArray(value.failures)
      || value.groups.some(group => !group || typeof group.id !== 'string' || !group.id.trim() || typeof group.name !== 'string' || !Array.isArray(group.models)
        || group.models.some((model: ConfigModelOption) => !model || typeof model.id !== 'string' || !model.id.trim() || typeof model.name !== 'string'
          || model.reasoning !== undefined && (!model.reasoning || !Array.isArray(model.reasoning.efforts)
            || model.reasoning.efforts.some((effort: ConfigReasoningEffort) => !effort || typeof effort.id !== 'string' || !effort.id.trim() || typeof effort.name !== 'string')
            || model.reasoning.defaultEffort !== undefined && typeof model.reasoning.defaultEffort !== 'string')))
      || value.failures.some(failure => !failure || typeof failure.id !== 'string' || typeof failure.name !== 'string' || typeof failure.message !== 'string')) {
      throw new ConfigError('invalid-result', '模型目录格式无效，请检查宿主与 loader 版本');
    }
    return value;
  };
}
