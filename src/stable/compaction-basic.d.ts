import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export type BasicCompactionEngine = RuntimeValue;
export declare const BasicCompactionEngine: RuntimeClass;
declare const plugin: RuntimeFunction | RuntimeClass;
export default plugin;
