import { resolveStableModule } from '../../dist/adapters/stable-host.js';
const upstream = resolveStableModule('compaction-basic');
export const BasicCompactionEngine = upstream.BasicCompactionEngine;
export default upstream.default;
