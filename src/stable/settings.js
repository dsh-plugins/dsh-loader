import { resolveStableModule } from '../../dist/adapters/stable-host.js';
const upstream = resolveStableModule('settings');
export const SettingsConflictError = upstream.SettingsConflictError;
export const SettingsForms = upstream.SettingsForms;
export const SettingsProvider = upstream.SettingsProvider;
export default upstream.default;
export const redactSecrets = upstream.redactSecrets;
