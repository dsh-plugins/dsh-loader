// Stable subpath types: @dsh-external/dshloader/ui-settings
// Side-effect import triggers the dsh-client-ui-settings/client SlotMap
// merge (adds 'settings.section') so PropsRuntime<'settings.section'>
// stays typed. Re-export keeps values/types reachable.
import '@deepseek-ai/dsh-client-ui-settings/client';
export * from '@deepseek-ai/dsh-client-ui-settings/client';
