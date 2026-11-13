/** 通过官方编解码器和公开写句柄替换 JSONL，写句柄持有跨进程 write lease。 */
import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { constants, zstdCompress } from 'node:zlib';
import { SessionHostError, type SessionSnapshot } from '../sessions.js';

/** adapter 使用的官方持久化句柄子集。 */
export interface StorageHandle {
  header: Record<string, unknown>;
  inheritedEventCount: number;
  read(): Promise<{ events: readonly Record<string, unknown>[] }>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** 通过服务公开方法获取文件位置和独占写 lease。 */
export interface SessionPersistence {
  open(id: string, access: 'read' | 'write'): Promise<StorageHandle>;
  stat(id: string): Promise<{ header: Record<string, unknown>; location?: { kind: string; path: string } } | undefined>;
}

/** 官方 catalog 对当前版本的编码及完整校验操作。 */
export interface SessionCodec {
  currentVersion: number;
  encodeCurrentHeader(header: Record<string, unknown>, inheritedEventCount: number): Record<string, unknown>;
  encodeCurrentEvent(event: Record<string, unknown>): Record<string, unknown>;
  createRestore(header: unknown, options: { recovery: 'strict'; validation: 'current' }): {
    decodeRow(row: unknown): void;
    finish(): { inheritedEventCount: number };
  };
}

const compress = promisify(zstdCompress);

/** 返回已关闭读取句柄的独立逻辑快照。 */
export async function readStoredSession(persistence: SessionPersistence, sessionId: string): Promise<SessionSnapshot> {
  const handle = await persistence.open(sessionId, 'read');
  try {
    const { events } = await handle.read();
    return structuredClone({ header: handle.header, events: [...events], inheritedEventCount: handle.inheritedEventCount });
  } finally {
    await handle.close();
  }
}

/** 预先编码和严格回读，避免处置原 Agent 后才发现历史不合法。 */
export function encodeSessionSnapshot(codec: SessionCodec, sessionId: string, snapshot: SessionSnapshot): { header: Buffer; body: Buffer } {
  if (snapshot.header.id !== sessionId || snapshot.header.version !== codec.currentVersion) {
    throw new SessionHostError('INVALID_SNAPSHOT', '会话身份或日志版本与宿主不匹配。');
  }
  // 官方 JSONL toHeaderLine 在进入 catalog 前将逻辑 header 的可选深度规范为 0。
  const header = codec.encodeCurrentHeader({
    ...snapshot.header,
    delegationDepth: snapshot.header.delegationDepth ?? 0,
  }, snapshot.inheritedEventCount);
  const rows = snapshot.events.map(event => codec.encodeCurrentEvent(event));
  const restore = codec.createRestore(header, { recovery: 'strict', validation: 'current' });
  for (const row of rows) {
    restore.decodeRow(row);
  }
  const restored = restore.finish();
  if (restored.inheritedEventCount !== snapshot.inheritedEventCount) {
    throw new SessionHostError('INVALID_SNAPSHOT', '会话继承事件数量与编码后的日志不一致。');
  }
  return {
    header: Buffer.from(`${JSON.stringify(header)}\n`),
    body: Buffer.from(rows.map(row => `${JSON.stringify(row)}\n`).join('')),
  };
}

/** 原 Agent 必须已完成 dispose；写句柄关闭前始终持有官方 lease。 */
export async function replaceStoredSession(
  persistence: SessionPersistence,
  codec: SessionCodec,
  sessionId: string,
  snapshot: SessionSnapshot,
): Promise<void> {
  const encoded = encodeSessionSnapshot(codec, sessionId, snapshot);
  const handle = await persistence.open(sessionId, 'write');
  let temporary: string | undefined;
  try {
    await handle.flush();
    const stat = await persistence.stat(sessionId);
    const location = stat?.location;
    if (!location || location.kind !== 'jsonl' || !isAbsolute(location.path)
      || !new RegExp(`^session\\.v${codec.currentVersion}\\.jsonl(?:\\.zstd)?$`).test(basename(location.path))) {
      throw new SessionHostError('UNSUPPORTED_STORAGE', '当前会话没有受支持的官方 JSONL 文件位置。');
    }
    if (handle.header.id !== snapshot.header.id || handle.header.createdAt !== snapshot.header.createdAt
      || handle.header.cwd !== snapshot.header.cwd) {
      throw new SessionHostError('INVALID_SNAPSHOT', '替换历史必须保留会话身份、创建时间和工作目录。');
    }
    const compressed = location.path.endsWith('.zstd');
    const parts = encoded.body.length === 0 ? [encoded.header] : [encoded.header, encoded.body];
    const data = Buffer.concat(compressed
      ? await Promise.all(parts.map(part => compress(part, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })))
      : parts);
    temporary = join(dirname(location.path), `.dsh-loader-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, location.path);
    temporary = undefined;
  } finally {
    const failures: unknown[] = [];
    if (temporary) {
      try {
        await unlink(temporary);
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await handle.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, `会话 ${sessionId} 的存储清理失败。`);
    }
  }
}
