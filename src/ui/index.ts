/**
 * The dshloader UI surface: virtual slots, the curated icon set, and the base
 * controls, wrapped as one `ui` facade.
 *
 * Consumers reach this at runtime through `@dsh-plugin/dsh-loader/client`, which
 * the DSH client module table resolves by stripping the `/client` suffix to
 * dshloader's registered bundle id — so no alias and no load-order coordination
 * is needed (see docs/ui.md).
 *
 * @module @dsh-plugin/dsh-loader/ui
 */
import { BUILTIN_ANCHORS, readLayoutFrame, type BuiltinAnchor, type LayoutFrameState } from './anchors.js';
import { createUiAPI, type CreateUiOptions, type UiAPI } from './slots.js';
import { createConfigClient, type ConfigClient } from '../config-client.js';
import { createConfigDialogs, type ConfigDialogsAPI } from './config-dialogs.js';
import { createComposerModel, type ComposerModel } from './composer-model.js';
export type { ComposerModel, ComposerModelOwner, ComposerModelProps, ComposerModelSelection, ComposerModelSnapshot, ComposerModelGroup, ComposerModelOption, ComposerTeamSnapshot } from './composer-model.js';

export * from './slots.js';
export * from './anchors.js';
export * from './style.js';
export * from './icons.js';
export * from './components.js';
export * from './menu.js';
export * from './config-dialogs.js';
export { Arco } from './arco.js';
export { ModelSelect } from './model-select.js';
export type { ModelSelectProps } from './model-select.js';
export { Scrollbar, type ScrollbarProps } from './scrollbar.js';
export { default as Markdown } from 'react-markdown';
export type { ConfigModelSource, ConfigModelList, ConfigModelGroup, ConfigModelOption, ConfigReasoningEffort } from './config-model-source.js';

/** The `ui` facade plus the built-in anchor helpers. */
export interface DshLoaderUi extends UiAPI {
  config: ConfigDialogsAPI;
  /** 已挂载的配置桥接客户端，供插件读取和订阅自己的配置。 */
  configClient?: ConfigClient;
  /** 在 DSH Web 输入栏替换原生模型选择器。 */
  composerModel: ComposerModel;
  /** Read the shell's sidebar layout state, when the anchor resolves. */
  layoutFrame(): LayoutFrameState | undefined;
  /**
   * Read a client-side cordis service by name (e.g. `slots`, `sessions`).
   * Proxied from `window.__dshLoader__.services` when available.
   */
  services?: {
    get(name: string): unknown;
  };
}

/**
 * Build the UI facade and seed it with the dsh 1.x anchor table.
 *
 * @param options - forwarded to {@link createUiAPI} (observe root, warn sink).
 */
export function createUi(options: CreateUiOptions & { config?: ConfigDialogsAPI; configClient?: ConfigClient } = {}): DshLoaderUi {
  const api = createUiAPI(options);
  const ownClient = options.config || options.configClient ? undefined : createConfigClient((url, init) => globalThis.fetch(url, init));
  const configClient = options.configClient ?? ownClient;
  const config = options.config ?? createConfigDialogs(configClient!);
  for (const [name, spec] of Object.entries(BUILTIN_ANCHORS)) {
    api.defineAnchor(name as BuiltinAnchor, spec);
  }
  return {
    ...api,
    config,
    configClient,
    composerModel: createComposerModel(),
    // Methods that close over engine state must be re-bound, not spread-copied
    // as plain values — `mountReact` calls `this.mount`, so keep the object.
    mount: api.mount.bind(api),
    mountReact: api.mountReact.bind(api),
    defineAnchor: api.defineAnchor.bind(api),
    anchors: api.anchors.bind(api),
    hosts: api.hosts.bind(api),
    onDomSettled: api.onDomSettled.bind(api),
    diagnose: api.diagnose.bind(api),
    destroy: () => { try { config.dispose(); } finally { ownClient?.dispose(); api.destroy(); } },
    layoutFrame(): LayoutFrameState | undefined {
      const [host] = api.hosts('layout.frame');
      return host === undefined ? undefined : readLayoutFrame(host);
    },
  };
}
