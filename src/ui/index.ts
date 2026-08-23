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

export * from './slots.js';
export * from './anchors.js';
export * from './style.js';
export * from './icons.js';
export * from './components.js';

/** The `ui` facade plus the built-in anchor helpers. */
export interface DshLoaderUi extends UiAPI {
  /** Read the shell's sidebar layout state, when the anchor resolves. */
  layoutFrame(): LayoutFrameState | undefined;
}

/**
 * Build the UI facade and seed it with the dsh 1.x anchor table.
 *
 * @param options - forwarded to {@link createUiAPI} (observe root, warn sink).
 */
export function createUi(options: CreateUiOptions = {}): DshLoaderUi {
  const api = createUiAPI(options);
  for (const [name, spec] of Object.entries(BUILTIN_ANCHORS)) {
    api.defineAnchor(name as BuiltinAnchor, spec);
  }
  return {
    ...api,
    // Methods that close over engine state must be re-bound, not spread-copied
    // as plain values — `mountReact` calls `this.mount`, so keep the object.
    mount: api.mount.bind(api),
    mountReact: api.mountReact.bind(api),
    defineAnchor: api.defineAnchor.bind(api),
    anchors: api.anchors.bind(api),
    hosts: api.hosts.bind(api),
    onDomSettled: api.onDomSettled.bind(api),
    diagnose: api.diagnose.bind(api),
    destroy: api.destroy.bind(api),
    layoutFrame(): LayoutFrameState | undefined {
      const [host] = api.hosts('layout.frame');
      return host === undefined ? undefined : readLayoutFrame(host);
    },
  };
}
