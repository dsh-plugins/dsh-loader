import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export declare const MAX_TIMER_DELAY_MS: number;
export type TimeoutReason = RuntimeValue;
export declare const TimeoutReason: RuntimeClass;
export declare const clampTimeout: RuntimeFunction;
export declare const deadline: RuntimeFunction;
export declare const idleWatchdog: RuntimeFunction;
export declare const timeoutOf: RuntimeFunction;
