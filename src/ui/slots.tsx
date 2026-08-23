/**
 * The dshloader UI SLOT engine (`ctx.dshLoader.ui` / `__dshLoader__.ui`).
 *
 * dsh's Web shell offers official slots for a few places (`settings.section`,
 * `conversation.chat.node`, …) but not for everything plugins need to decorate.
 * Today four plugins in this family each hand-roll the same DOM-injection
 * boilerplate against hardcoded shell selectors:
 *
 *   - dsh-thought-buddy   → `[data-conversation-scroll] [role="status"]`
 *   - dsh-auxiliary       → the Models page's editable model rows
 *   - dsh-code-review     → `[data-shell-overlay]`, `.dshDesktopDetailsSurface`
 *   - dsh-better-sidebar  → `#root [data-slot="conversation"]`, theme root, …
 *
 * Every one of them re-implements: a MutationObserver, requestAnimationFrame
 * coalescing, an idempotence guard, self-healing after a React re-render, and
 * teardown. This module implements that ONCE and moves the shell selectors into
 * a named ANCHOR TABLE the version adapter owns — so when dsh moves its DOM,
 * one anchor entry changes instead of four plugins.
 *
 * What it cannot do: invent an anchor that no longer exists. A vanished anchor
 * turns N silent breakages into ONE diagnosable one (`ui.diagnose()`), which is
 * the honest goal — DOM injection is centralised here, not made robust. The
 * durable fix stays "get the anchor promoted to an official slot".
 *
 * @module @dsh-plugin/dsh-loader/ui/slots
 */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Where a mount node is placed relative to its host element. */
export type InsertMode = 'prepend' | 'append' | 'before' | 'after';

/** How the active adapter locates one shell anchor. */
export interface AnchorSpec {
  /** Human-readable description, used by {@link UiAPI.diagnose}. */
  describe: string;
  /** Primary locator. Return every element that should host a mount. */
  find: () => Iterable<Element>;
  /**
   * Fallback locator, tried only when `find` yields nothing. Lets an anchor
   * survive a narrow selector going stale (the pattern thought-buddy uses:
   * scoped selector first, whole-document second).
   */
  fallback?: () => Iterable<Element>;
  /** Extra predicate a candidate must satisfy (e.g. matching text content). */
  accept?: (host: Element) => boolean;
  /** Placement of the mount node. Defaults to `'append'`. */
  insert?: InsertMode;
  /** Tag name for the generated mount node. Defaults to `'span'`. */
  tagName?: string;
}

/** One plugin-supplied mount against an anchor. */
export interface MountSpec {
  /**
   * Unique mount id, `'<plugin>:<what>'`. Doubles as the `data-dshl-slot`
   * attribute value that makes mounting idempotent.
   */
  id: string;
  /**
   * Populate the mount node. Called once per host; return a cleanup that
   * releases whatever was created.
   */
  render: (mount: HTMLElement, host: Element) => (() => void) | void;
  /** Skip this host when the predicate returns false. */
  when?: (host: Element) => boolean;
}

/** A React flavour of {@link MountSpec}. */
export interface ReactMountSpec {
  /** Unique mount id, `'<plugin>:<what>'`. */
  id: string;
  /** Component rendered into the mount node; receives the host element. */
  component: React.ComponentType<{ host: Element }>;
  /** Skip this host when the predicate returns false. */
  when?: (host: Element) => boolean;
}

/** One live mount instance. */
interface Instance {
  mount: HTMLElement;
  cleanup: (() => void) | undefined;
}

/** Diagnostics for one registered anchor. */
export interface AnchorDiagnostic {
  anchor: string;
  describe: string;
  /** Hosts the primary locator currently finds. */
  hosts: number;
  /** Whether the fallback locator had to be used. */
  usedFallback: boolean;
  /** Mount ids currently registered against this anchor. */
  mounts: string[];
  /** Live mount instances across all hosts. */
  live: number;
}

/** The `ui` facade. */
export interface UiAPI {
  /**
   * Register (or replace) an anchor. The adapter seeds the built-ins at boot;
   * a plugin may add its own for shell areas dshloader does not know yet.
   * @returns a disposer removing the anchor and unmounting everything on it.
   */
  defineAnchor(name: string, spec: AnchorSpec): () => void;
  /** Anchor names currently registered. */
  anchors(): string[];
  /**
   * The elements an anchor currently resolves to. Use this for anchors that are
   * READ rather than decorated — e.g. reading the layout frame's collapsed
   * attribute or grid width instead of mounting into it.
   */
  hosts(anchor: string): Element[];
  /**
   * Subscribe to "the shell's DOM has settled": called once per coalesced
   * mutation batch, on the same observer and the same rAF frame the mount sweep
   * uses.
   *
   * This exists for injections whose HOST IDENTIFICATION is itself business
   * logic and therefore does not fit the anchor model — dsh-auxiliary's model
   * catalog is the motivating case: it cross-references `aria-label` inputs
   * against a provider directory, re-reads settings on a debounce, and also
   * listens for `input` events, so an `AnchorSpec.find()` could never express
   * it. Such a caller keeps its own sweep but stops running a second
   * MutationObserver over the whole document.
   *
   * The listener MUST be idempotent: it is invoked again after any batch,
   * including batches its own writes caused.
   *
   * @returns an unsubscribe function.
   */
  onDomSettled(listener: () => void): () => void;
  /**
   * Mount imperative content on every element an anchor resolves to, now and
   * whenever the shell re-renders. Idempotent per (host, mount id).
   * @returns a disposer unmounting every instance of this mount.
   */
  mount(anchor: string, spec: MountSpec): () => void;
  /**
   * Mount a React component on every element an anchor resolves to. A React
   * root is created per host and unmounted on teardown.
   * @returns a disposer unmounting every instance of this mount.
   */
  mountReact(anchor: string, spec: ReactMountSpec): () => void;
  /** Snapshot of anchor health — the single place to look when injection stops working. */
  diagnose(): AnchorDiagnostic[];
  /** Stop observing and unmount everything (called by the loader's own teardown). */
  destroy(): void;
}

/** Attribute marking a generated mount node (and making re-mount idempotent). */
const SLOT_ATTR = 'data-dshl-slot';

/** Options for {@link createUiAPI}. */
export interface CreateUiOptions {
  /** Root to observe. Defaults to `document.documentElement`. */
  observeRoot?: Element;
  /** Diagnostic sink; defaults to `console.warn`. */
  warn?: (message: string) => void;
}

/**
 * Build the `ui` facade with its own observer. One engine serves every anchor
 * and every mount, so the shell is observed exactly once regardless of how many
 * plugins inject.
 */
export function createUiAPI(options: CreateUiOptions = {}): UiAPI {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const anchors = new Map<string, AnchorSpec>();
  /** anchor name → mount id → spec */
  const mounts = new Map<string, Map<string, MountSpec>>();
  /** anchor name → mount id → host → instance */
  const live = new Map<string, Map<string, Map<Element, Instance>>>();
  /** Anchors whose primary locator came up empty on the last sweep. */
  const fellBack = new Set<string>();
  /** `onDomSettled` subscribers, notified once per coalesced batch. */
  const settledListeners = new Set<() => void>();

  let observer: MutationObserver | undefined;
  let scheduled = false;
  let destroyed = false;

  const hasDom = (): boolean => typeof document !== 'undefined' && typeof MutationObserver !== 'undefined';

  /** Resolve an anchor to its host elements, recording fallback use. */
  const resolve = (name: string, spec: AnchorSpec): Element[] => {
    const collect = (source: (() => Iterable<Element>) | undefined): Element[] => {
      if (source === undefined) return [];
      try {
        return [...source()];
      } catch {
        return [];
      }
    };
    let hosts = collect(spec.find);
    if (hosts.length === 0) {
      const alt = collect(spec.fallback);
      if (alt.length > 0) {
        fellBack.add(name);
        hosts = alt;
      } else {
        fellBack.delete(name);
      }
    } else {
      fellBack.delete(name);
    }
    if (spec.accept !== undefined) {
      hosts = hosts.filter(host => {
        try {
          return spec.accept!(host);
        } catch {
          return false;
        }
      });
    }
    // De-duplicate: the primary and fallback locators may overlap.
    return [...new Set(hosts)];
  };

  /** Insert a freshly created mount node relative to its host. */
  const place = (host: Element, node: HTMLElement, mode: InsertMode): void => {
    switch (mode) {
      case 'prepend':
        host.insertBefore(node, host.firstChild);
        return;
      case 'before':
        host.parentNode?.insertBefore(node, host);
        return;
      case 'after':
        host.parentNode?.insertBefore(node, host.nextSibling);
        return;
      default:
        host.appendChild(node);
    }
  };

  /** Tear down one instance, containing any cleanup failure. */
  const teardown = (instance: Instance): void => {
    try {
      instance.cleanup?.();
    } catch (error) {
      warn(`[dshloader.ui] mount cleanup threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (instance.mount.parentNode !== null) {
      instance.mount.parentNode.removeChild(instance.mount);
    }
  };

  const instancesFor = (anchor: string, mountId: string): Map<Element, Instance> => {
    let byMount = live.get(anchor);
    if (byMount === undefined) {
      byMount = new Map();
      live.set(anchor, byMount);
    }
    let byHost = byMount.get(mountId);
    if (byHost === undefined) {
      byHost = new Map();
      byMount.set(mountId, byHost);
    }
    return byHost;
  };

  /** One reconciliation pass over every anchor × mount. */
  const sweep = (): void => {
    if (destroyed || !hasDom()) return;
    for (const [name, spec] of anchors) {
      const specs = mounts.get(name);
      if (specs === undefined || specs.size === 0) continue;
      const hosts = resolve(name, spec);
      const insert = spec.insert ?? 'append';
      const tagName = spec.tagName ?? 'span';

      for (const [mountId, mountSpec] of specs) {
        const instances = instancesFor(name, mountId);

        // Drop instances whose host left the document, or whose node was
        // detached by a shell re-render (the latter is re-created below).
        for (const [host, instance] of [...instances]) {
          if (!host.isConnected || !instance.mount.isConnected) {
            teardown(instance);
            instances.delete(host);
          }
        }

        for (const host of hosts) {
          if (instances.has(host)) continue;
          if (mountSpec.when !== undefined) {
            try {
              if (!mountSpec.when(host)) continue;
            } catch {
              continue;
            }
          }
          // Idempotence net: a node with our slot id already inside the host
          // (e.g. left over from a previous engine) means "already mounted".
          if (host.querySelector(`[${SLOT_ATTR}="${mountId}"]`) !== null) continue;

          const node = document.createElement(tagName);
          node.setAttribute(SLOT_ATTR, mountId);
          try {
            place(host, node, insert);
          } catch (error) {
            warn(`[dshloader.ui] could not place "${mountId}" on anchor "${name}": ${error instanceof Error ? error.message : String(error)}`);
            continue;
          }
          let cleanup: (() => void) | undefined;
          try {
            cleanup = mountSpec.render(node, host) ?? undefined;
          } catch (error) {
            warn(`[dshloader.ui] mount "${mountId}" render threw: ${error instanceof Error ? error.message : String(error)}`);
            if (node.parentNode !== null) node.parentNode.removeChild(node);
            continue;
          }
          instances.set(host, { mount: node, cleanup });
        }
      }
    }
  };

  /** Coalesce mutation bursts into one sweep per frame. */
  const schedule = (): void => {
    if (scheduled || destroyed) return;
    scheduled = true;
    const run = (): void => {
      scheduled = false;
      sweep();
      // Notify DOM-settled subscribers after the mount sweep, so a listener that
      // inspects the document sees this batch's mounts already in place.
      for (const listener of [...settledListeners]) {
        try {
          listener();
        } catch (error) {
          warn(
            `[dshloader.ui] onDomSettled listener threw: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  };

  /** Start observing on first use; a single observer serves every anchor. */
  const ensureObserver = (): void => {
    if (observer !== undefined || destroyed || !hasDom()) return;
    const root = options.observeRoot ?? document.documentElement;
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
  };

  const removeAllFor = (anchor: string, mountId?: string): void => {
    const byMount = live.get(anchor);
    if (byMount === undefined) return;
    const ids = mountId === undefined ? [...byMount.keys()] : [mountId];
    for (const id of ids) {
      const byHost = byMount.get(id);
      if (byHost === undefined) continue;
      for (const instance of byHost.values()) teardown(instance);
      byHost.clear();
      byMount.delete(id);
    }
  };

  return {
    defineAnchor(name, spec) {
      anchors.set(name, spec);
      ensureObserver();
      schedule();
      return () => {
        removeAllFor(name);
        anchors.delete(name);
        mounts.delete(name);
        live.delete(name);
        fellBack.delete(name);
      };
    },

    anchors() {
      return [...anchors.keys()];
    },

    hosts(anchor) {
      const spec = anchors.get(anchor);
      return spec === undefined ? [] : resolve(anchor, spec);
    },

    onDomSettled(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('dshloader.ui.onDomSettled: listener must be a function');
      }
      settledListeners.add(listener);
      // Start observing even when no anchor is registered: a caller may use only
      // this primitive and never mount anything.
      ensureObserver();
      schedule();
      return () => {
        settledListeners.delete(listener);
      };
    },

    mount(anchor, spec) {
      if (typeof spec.id !== 'string' || spec.id.length === 0) {
        throw new TypeError('dshloader.ui.mount: spec.id is required');
      }
      if (!anchors.has(anchor)) {
        warn(
          `[dshloader.ui] mount "${spec.id}" targets unknown anchor "${anchor}" — ` +
            `known anchors: ${[...anchors.keys()].join(', ') || '(none)'}. ` +
            'The mount stays registered and activates if the anchor is defined later.',
        );
      }
      let specs = mounts.get(anchor);
      if (specs === undefined) {
        specs = new Map();
        mounts.set(anchor, specs);
      }
      if (specs.has(spec.id)) {
        // Re-register (HMR): drop the old instances first so render runs fresh.
        removeAllFor(anchor, spec.id);
      }
      specs.set(spec.id, spec);
      ensureObserver();
      schedule();
      return () => {
        removeAllFor(anchor, spec.id);
        mounts.get(anchor)?.delete(spec.id);
      };
    },

    mountReact(anchor, spec) {
      const Component = spec.component;
      return this.mount(anchor, {
        id: spec.id,
        when: spec.when,
        render: (node, host) => {
          let root: Root | undefined;
          try {
            root = createRoot(node);
            root.render(React.createElement(Component, { host }));
          } catch (error) {
            warn(`[dshloader.ui] React mount "${spec.id}" failed: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }
          return () => {
            // Unmount runs from a mutation sweep or plugin teardown, never from
            // inside a React commit, so a synchronous unmount is safe here.
            try {
              root?.unmount();
            } catch {
              /* the root may already be gone with its container */
            }
          };
        },
      });
    },

    diagnose() {
      const out: AnchorDiagnostic[] = [];
      for (const [name, spec] of anchors) {
        const hosts = resolve(name, spec);
        const specs = mounts.get(name);
        let liveCount = 0;
        const byMount = live.get(name);
        if (byMount !== undefined) for (const byHost of byMount.values()) liveCount += byHost.size;
        out.push({
          anchor: name,
          describe: spec.describe,
          hosts: hosts.length,
          usedFallback: fellBack.has(name),
          mounts: specs === undefined ? [] : [...specs.keys()],
          live: liveCount,
        });
      }
      return out;
    },

    destroy() {
      destroyed = true;
      observer?.disconnect();
      observer = undefined;
      settledListeners.clear();
      for (const anchor of [...live.keys()]) removeAllFor(anchor);
      live.clear();
      mounts.clear();
      anchors.clear();
      fellBack.clear();
    },
  };
}
