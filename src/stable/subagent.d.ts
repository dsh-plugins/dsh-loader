import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export type AssistantOutputFold = RuntimeValue;
export declare const AssistantOutputFold: RuntimeClass;
export declare const NO_START_CAPABILITIES: unknown;
export declare const STRUCTURED_OUTPUT_TOOL: unknown;
export declare const SUBAGENT_DESCRIPTOR_VERSION: number;
export declare class SubagentDepthError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class SubagentError extends Error { constructor(...args: any[]); [key: string]: any }
export type SubagentRunId = RuntimeValue;
export declare const SubagentRunId: RuntimeClass;
export type SubagentRuntime = RuntimeValue;
export declare const SubagentRuntime: RuntimeClass;
export declare const appendDelegatedPolicyOverrides: RuntimeFunction;
export declare const applyChildComposition: RuntimeFunction;
export declare const assertPositiveFinite: RuntimeFunction;
export declare const assertSubagentMaxDepth: RuntimeFunction;
export declare const assertUsableCwd: RuntimeFunction;
export declare const captureDelegatedPolicyOverrides: RuntimeFunction;
export declare const childSessionMeta: RuntimeFunction;
declare const plugin: RuntimeFunction | RuntimeClass;
export default plugin;
export declare const delegationDepthOf: RuntimeFunction;
export declare const finalAssistantOutput: RuntimeFunction;
export declare const foldSubagentDescriptor: RuntimeFunction;
export declare const parentAgentOptionsForDelegation: RuntimeFunction;
export declare const resolveChildAgentOptions: RuntimeFunction;
export declare const resolveChildCwd: RuntimeFunction;
export declare const resolveChildDepth: RuntimeFunction;
export declare const settleRun: RuntimeFunction;
export declare const settleRunResult: RuntimeFunction;
export declare const snapshotSubagentDescriptor: RuntimeFunction;
export declare const subprocessRunHandle: RuntimeFunction;
export declare const validateConfiguredCwd: RuntimeFunction;
