import { resolveStableModule } from '../../dist/adapters/stable-host.js';
const upstream = resolveStableModule('timeout');
export const MAX_TIMER_DELAY_MS = upstream.MAX_TIMER_DELAY_MS;
export const TimeoutReason = upstream.TimeoutReason;
export const clampTimeout = upstream.clampTimeout;
export const deadline = upstream.deadline;
export const idleWatchdog = upstream.idleWatchdog;
export const timeoutOf = upstream.timeoutOf;
