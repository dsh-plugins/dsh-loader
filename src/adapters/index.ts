import type { AdapterRegistry } from '../registry.js';
import { adapter as v0_1_5 } from './0.1.5/index.js';
import { adapter as v0_1_6 } from './0.1.6/index.js';
import { adapter as v0_1_7 } from './0.1.7/index.js';
import { adapter as v0_2_0 } from './0.2.0/index.js';
import { adapter as v0_2_1 } from './0.2.1/index.js';
import { adapter as v0_2_2 } from './0.2.2/index.js';
export const hostAdapters = [v0_1_5, v0_1_6, v0_1_7, v0_2_0, v0_2_1, v0_2_2];
export function registerHostAdapters(registry: AdapterRegistry): AdapterRegistry { for (const factory of hostAdapters) registry.register(factory); return registry; }
