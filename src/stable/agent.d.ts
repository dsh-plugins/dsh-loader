import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export type AgentModel = RuntimeValue;
export declare const AgentModel: RuntimeClass;
export type AgentRegistry = RuntimeValue;
export declare const AgentRegistry: RuntimeClass;
export declare const agentCarrier: RuntimeFunction;
export declare const agentEvents: RuntimeFunction;
export declare const assembleContextFor: RuntimeFunction;
declare const plugin: RuntimeFunction | RuntimeClass;
export default plugin;
export declare const emitAgentEvent: RuntimeFunction;
export declare const foldConsumedWork: RuntimeFunction;
export declare const installModelSelection: RuntimeFunction;
export declare const modelSelectionProjectionDefinition: RuntimeFunction;
