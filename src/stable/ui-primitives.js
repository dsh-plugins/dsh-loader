// Stable re-export: @dsh-external/dshloader/ui-primitives
//
// Plugins import UI primitives from this subpath instead of directly
// from @deepseek-ai/dsh-client-ui-primitives. When dsh renames the
// package, only this file (and the adapter's packageAliases) change.
export * from '@deepseek-ai/dsh-client-ui-primitives';
