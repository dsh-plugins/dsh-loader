import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export declare class SettingsConflictError extends Error { constructor(...args: any[]); [key: string]: any }
export type SettingsForms = RuntimeValue;
export declare const SettingsForms: RuntimeClass;
export type SettingsProvider = RuntimeValue;
export declare const SettingsProvider: RuntimeClass;
declare const plugin: RuntimeFunction | RuntimeClass;
export default plugin;
export declare const redactSecrets: RuntimeFunction;
