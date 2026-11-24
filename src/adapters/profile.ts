import { isAbsolute, join } from 'node:path';
import type { CordisContext } from '../types.js';

/** 生效的 npm 仓库配置及用于并发校验的宿主配置快照。 */
export interface PluginRegistrySnapshot {
  readonly revision: string;
  readonly registry: string | null;
  readonly resolved: string | null;
  readonly fallbackRegistries: readonly string[];
}

/** 使用宿主的配置编辑器和插件管理器共用的文件锁。 */
export interface ProfileAPI {
  /** 读取本进程启动所用的配置档目录。 */
  readonly directory: string;
  /** 读取配置档的首选仓库及回退顺序。 */
  readPluginRegistries(): Promise<PluginRegistrySnapshot>;
  /** 只更新仓库顺序；配置在读取后变化时拒绝写入。 */
  writePluginRegistries(expectedRevision: string, registry: string, fallbackRegistries: readonly string[]): Promise<void>;
  /** 在宿主插件安装、卸载和构建审批共用的锁内执行文件变更。 */
  withPackageLock<T>(operation: () => T | Promise<T>, options?: { waitMs?: number }): Promise<T>;
  /** 使用宿主的原子替换实现写入完整文件内容。 */
  writeFileAtomic(filename: string, content: string, options: { mode: number }): Promise<void>;
}

interface Manager {
  registries(): Promise<{ registry: string | null; resolved: string | null; fallbackRegistries: readonly string[] }>;
}

interface Entry {
  options: { id?: string; name?: string; config?: unknown };
  fiber?: unknown;
}

interface ConfigEditor {
  entries(): Entry[];
  edit(entry: Entry, update: (current: Record<string, unknown>) => Record<string, unknown>): Promise<unknown>;
}

interface AtomicWrite {
  withFileLock<T>(filename: string, operation: () => T | Promise<T>, options?: { waitMs?: number }): Promise<T>;
  writeFileAtomic(filename: string, content: string, options: { mode: number }): Promise<void>;
}

const managerPackage = '@deepseek-ai/dsh-plugin-manager';
const atomicWritePackage = '@deepseek-ai/dsh-atomic-write';

export function createProfileAPI(ctx: CordisContext): ProfileAPI {
  let atomicWrite: Promise<AtomicWrite> | undefined;
  const directory = (): string => {
    const value = ctx.get('profileContext')?.dir;
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new Error('DSH 未提供当前配置档目录。');
    }
    return value;
  };
  const files = () => atomicWrite ??= (async () => {
    const loader = ctx.get('loader');
    const loaded = typeof loader?.import === 'function'
      ? await loader.import(atomicWritePackage)
      : await import(atomicWritePackage);
    if (typeof loaded.withFileLock !== 'function' || typeof loaded.writeFileAtomic !== 'function') {
      throw new Error('DSH 未提供配置档文件锁和原子写入接口。');
    }
    return loaded as AtomicWrite;
  })();
  const managerEntry = () => {
    const manager: Manager | undefined = ctx.get('pluginManager');
    const editor: ConfigEditor | undefined = ctx.get('configEditor');
    const entry = editor?.entries().find(row => row.options.id === 'plugin-manager' && row.options.name === managerPackage);
    if (!editor || !entry?.fiber || typeof manager?.registries !== 'function') {
      throw new Error('DSH 插件管理器尚未就绪。');
    }
    return { manager, editor, entry };
  };
  const stale = () => new Error('DSH 插件管理器配置已变化，请重新打开窗口。');

  return {
    get directory() { return directory(); },
    async readPluginRegistries() {
      const { manager, entry } = managerEntry();
      const revision = JSON.stringify(entry.options.config ?? {});
      const fiber = entry.fiber;
      const registries = await manager.registries();
      const current = managerEntry();
      if (current.entry.fiber !== fiber || JSON.stringify(current.entry.options.config ?? {}) !== revision) {
        throw stale();
      }
      return { ...registries, revision };
    },
    async writePluginRegistries(expectedRevision, registry, fallbackRegistries) {
      const { editor, entry } = managerEntry();
      await editor.edit(entry, current => {
        if (JSON.stringify(current) !== expectedRevision) {
          throw stale();
        }
        return { ...current, registry, fallbackRegistries: [...fallbackRegistries] };
      });
    },
    async withPackageLock(operation, options) {
      return (await files()).withFileLock(join(directory(), 'package.json'), operation, options);
    },
    async writeFileAtomic(filename, content, options) {
      await (await files()).writeFileAtomic(filename, content, options);
    },
  };
}
