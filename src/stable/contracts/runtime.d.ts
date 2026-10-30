/** A value whose detailed ABI is version-specific. Prefer HostAPI facades for new integrations. */
export interface RuntimeValue { [key: string]: any }
export interface RuntimeFunction { (...args: any[]): any }
export interface RuntimeClass { new (...args: any[]): RuntimeValue; [key: string]: any }
