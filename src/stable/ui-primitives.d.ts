// Stable subpath types: @dsh-plugin/dsh-loader/ui-primitives
// Re-export the real package's types so TS consumers (and this plugin's
// client bundle) stay typed without importing @deepseek-ai/* directly.
export * from '@deepseek-ai/dsh-client-ui-primitives';
