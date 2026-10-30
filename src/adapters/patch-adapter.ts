import { create } from './shared-host.js';
import { preloadRegistryModules } from './modules.js';
import { createLlmAPI } from '../services/llm.js';
import { createDshSymbolsAPI } from '../services/dsh-symbols.js';
import { browserAccess } from './http-access.js';
import type { PatchMetadata } from './metadata.js';
import { createAdaptedWebAPI } from './web.js';
import { createSettingsAPI } from '../services/settings.js';
import { createServicesAPI } from '../services/services.js';
import { createRegistryAPI } from '../services/registry.js';
import { installStableRuntime } from './stable-host.js';
import { ownedScope } from '../lifecycle.js';
import type { AdapterFactory, HostAdapter } from '../types.js';
export function makePatchAdapter(client: PatchMetadata): AdapterFactory {
  return {
    name: client.id, supports: client.patch,
    create(ctx, config) {
      const base = create(ctx, config);
      const resources = ownedScope(ctx);
      resources.add(() => base.dispose());
      const adapter: HostAdapter = {
        ...base, name: client.id, supports: client.patch,
        dispose: resources.dispose,
        authorizeConfig: browserAccess(ctx),
        async apply() {
          adapter.modules = await preloadRegistryModules(ctx.get('loader')?.import?.bind(ctx.get('loader')));
          if (config?.boot) resources.add(installStableRuntime({ version: config.boot.dshVersion, adapterId: client.id, modules: { ...adapter.modules } }));
          adapter.web = createAdaptedWebAPI(ctx, resources);
          adapter.settings = createSettingsAPI({ ctx, resources, exposeAllNamespaces: Boolean(config?.exposeAllNamespaces), module: adapter.modules.settings });
          if (client.settingsModel === 'forms' || ctx.get('settings')?.configure) {
            adapter.settings.register = () => { throw new Error('dshloader: this host uses instance Config forms; use dshLoader.config.register for plugin-owned configuration'); };
            adapter.settings.installSection = () => { throw new Error('dshloader: legacy settings sections are unavailable; migrate to dshLoader.config'); };
          }
          adapter.services = createServicesAPI({ ctx });
          adapter.registry = createRegistryAPI({ ctx, modules: adapter.modules });
          adapter.llm = createLlmAPI({ module: adapter.modules.llm });
          adapter.dsh = createDshSymbolsAPI({ modules: adapter.modules });
          await base.apply();
        },
      };
      return adapter;
    },
  };
}
