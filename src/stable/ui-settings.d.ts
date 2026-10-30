import './contracts/settings-slots.js';
export * from './contracts/settings-slots.js';
import type { NamespaceView, CordisContext } from '../../dist/types.js';
import type { SchemaNode } from '../../lib/types/ui/client-compat.js';
export type { SchemaNode };
export interface ConfigFormSnapshot<T> { status: 'loading' | 'ready' | 'unavailable'; value: T | undefined; base: unknown; user: unknown; revision: number | undefined; writable: boolean }
export type SettingsPathOp = { op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] };
export interface ConfigForm<T> { getSnapshot(): ConfigFormSnapshot<T>; subscribe(listener: () => void): () => void; mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<boolean>; set(field: string, value: unknown): Promise<boolean>; unset(field: string): Promise<boolean> }
export interface ConfigForms { get<T>(spec: { namespace: string; decode?: (value: unknown) => T | undefined }): ConfigForm<T> }
export interface SettingsDescribeView { namespaces: readonly NamespaceView[]; writable: boolean; hasDocument: boolean }
export interface SettingsMirrorSnapshot { status: 'idle' | 'loading' | 'ready'; view: SettingsDescribeView | undefined; error: string | null }
export interface SettingsDescribeFace { getSnapshot(): SettingsMirrorSnapshot; subscribe(listener: () => void): () => void; ensure(): Promise<void>; acceptView(view: NamespaceView): void }
export interface SettingsSchemaService { rehydrate(serialized: unknown): SchemaNode; validate(schema: SchemaNode, draft: unknown): string | undefined; nodeAtPath(root: SchemaNode, path: readonly string[]): SchemaNode | undefined; getPath(value: unknown, path: readonly string[]): unknown; hasPath(value: unknown, path: readonly string[]): boolean; setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): Record<string, unknown>; deletePath(root: Record<string, unknown>, path: readonly string[]): Record<string, unknown> }
export declare const inject: string[];
export declare function apply(ctx: CordisContext): void;
