import type { RuntimeClass, RuntimeFunction, RuntimeValue } from './contracts/runtime.js';
/** Compatibility value exports; use HostAPI facades for version-independent typed operations. */
export type CredentialProvider = RuntimeValue;
export declare const CredentialProvider: RuntimeClass;
export declare const credentialKey: RuntimeFunction;
export declare const credentialKeyId: RuntimeFunction;
export declare const credentialKeyScope: RuntimeFunction;
export type CredentialRef = string & { readonly __credentialRef: unique symbol };
export declare function credentialRef(value: string): CredentialRef;
declare const plugin: RuntimeFunction | RuntimeClass;
export default plugin;
export declare const isCredentialKeySegment: RuntimeFunction;
export declare const isCredentialRefName: RuntimeFunction;
export declare const parseCredentialKey: RuntimeFunction;
