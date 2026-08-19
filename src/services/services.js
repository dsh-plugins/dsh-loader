// Services stable API (design.md §3.3 / §4.1 `ctx.dshLoader.services`).
//
// Thin read/alias helpers over the cordis service registry. `alias()` is a
// low-level escape hatch for plugin authors who need a one-hop alias beyond
// what the selected adapter already provides; it never overwrites an existing
// service (mirrors the adapter safety rule in design.md §5.1).

import { LOG_PREFIX } from '../version.js';

export function createServicesAPI({ ctx }) {
  return {
    get(name) {
      return ctx.get(name);
    },
    alias(from, to) {
      if (ctx.get(from) !== undefined) {
        console.warn(`${LOG_PREFIX} services.alias: "${from}" already exists, skip alias`);
        return;
      }
      const target = ctx.get(to);
      if (target === undefined) {
        console.warn(`${LOG_PREFIX} services.alias: target "${to}" unavailable, cannot alias "${from}"`);
        return;
      }
      ctx.reflect.provide(from, target);
    },
  };
}
