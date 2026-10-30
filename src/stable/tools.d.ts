import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export declare class CodeRunFailedError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class JsonSchemaError extends Error { constructor(...args: any[]); [key: string]: any }
export declare const RUN_CODE_NAME: unknown;
export declare const TOOL_ABORTED: unknown;
export declare const TOOL_ABORTED_BEFORE_DISPATCH: unknown;
export declare const TOOL_RUNTIME_SCHEDULER: unknown;
export declare class ToolActivationError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class ToolArgsError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class ToolBatchExecutionError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class ToolExecutorUnavailableError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class ToolNotFoundError extends Error { constructor(...args: any[]); [key: string]: any }
export declare class ToolOutputError extends Error { constructor(...args: any[]); [key: string]: any }
export type ToolRuntime = RuntimeValue;
export declare const ToolRuntime: RuntimeClass;
export type ToolsService = RuntimeValue;
export declare const ToolsService: RuntimeClass;
export declare const assertObjectJsonSchema: RuntimeFunction;
export declare const assertSupportedJsonSchema: RuntimeFunction;
declare const plugin: RuntimeFunction | RuntimeClass;
export default plugin;
export declare const defineContentToolFixture: RuntimeFunction;
export declare function defineTool<T>(definition: T): T;
export declare const isJsonSchemaRecord: RuntimeFunction;
export declare const isPlainJsonArray: RuntimeFunction;
export declare const isPlainJsonRecord: RuntimeFunction;
export declare const jsonSchemaToPy: RuntimeFunction;
export declare const jsonSchemaToTs: RuntimeFunction;
export declare const parameterSchemaSpecToJsonSchema: RuntimeFunction;
export declare const projectToolSchema: RuntimeFunction;
export declare const renderToolsSdk: RuntimeFunction;
export declare const renderToolsSdkPy: RuntimeFunction;
export declare const validateArgs: RuntimeFunction;
export declare const validateJsonSchemaValue: RuntimeFunction;
export declare const valueSchemaSpecToJsonSchema: RuntimeFunction;
