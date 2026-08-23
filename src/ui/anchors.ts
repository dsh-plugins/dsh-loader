/**
 * The dsh-1-x SHELL ANCHOR TABLE.
 *
 * Every entry is a selector some plugin in this family currently hardcodes.
 * Centralising them here is the whole point of `dshLoader.ui`: when dsh moves
 * its DOM, this table changes and the plugins do not.
 *
 * Each anchor records WHO needed it and WHAT it was before, so a future
 * maintainer can trace an anchor back to the behaviour it supports.
 *
 * @module @dsh-plugin/dsh-loader/ui/anchors
 */
import type { AnchorSpec } from './slots.js';

/** Query helper that tolerates an invalid selector (returns nothing). */
function all(selector: string): () => Iterable<Element> {
  return () => {
    if (typeof document === 'undefined') return [];
    try {
      return document.querySelectorAll(selector);
    } catch {
      return [];
    }
  };
}

/** Anchor names dshloader ships for the dsh 1.x shell. */
export const ANCHOR_NAMES = [
  'conversation.status',
  'conversation.column',
  'shell.overlay',
  'desktop.detailsSurface',
  'layout.frame',
  'settings.nav',
] as const;

/** One of the built-in anchor names. */
export type BuiltinAnchor = (typeof ANCHOR_NAMES)[number];

/**
 * The built-in anchors for dsh 1.x (verified against dsh 0.1.0-rc.6).
 *
 * Provenance of each selector:
 *
 * - `conversation.status` — dsh-thought-buddy, `src/client/index.ts:632-637`:
 *   `[data-conversation-scroll] [role="status"]` with a whole-document
 *   `[role="status"]` fallback. Callers add their own `accept` (thought-buddy
 *   matches the status text) via {@link AnchorSpec.accept} on a redefinition,
 *   or filter in `MountSpec.when`.
 * - `conversation.column` — dsh-better-sidebar, `src/client/Sidebar.tsx:396`:
 *   `#root [data-slot="conversation"]`.
 * - `shell.overlay` — dsh-code-review, `src/client.ts:1930` / `:2528`:
 *   `[data-shell-overlay]`.
 * - `desktop.detailsSurface` — dsh-code-review, `src/client.ts:1957`:
 *   `.dshDesktopDetailsSurface`. A CSS-module-adjacent CLASS name and therefore
 *   the most fragile anchor in the table; kept because the behaviour needs it.
 * - `layout.frame` — dsh-code-review, `src/client.ts:1176` / `:1209` / `:1244`:
 *   the frame whose `style.gridTemplateColumns` carries the sidebar width and
 *   whose `data-sidebar-collapsed` attribute carries the collapsed state. This
 *   anchor is READ (via `ui.hosts('layout.frame')`), never mounted into.
 * - `settings.nav` — dsh-better-sidebar, `src/client/settings-nav-icon.ts`:
 *   the settings navigation list that gets an icon synced into it.
 */
export const BUILTIN_ANCHORS: Record<BuiltinAnchor, AnchorSpec> = {
  'conversation.status': {
    describe: 'Conversation turn-status strip ([data-conversation-scroll] [role="status"])',
    find: all('[data-conversation-scroll] [role="status"]'),
    fallback: all('[role="status"]'),
    insert: 'prepend',
  },
  'conversation.column': {
    describe: 'Conversation centre column (#root [data-slot="conversation"])',
    find: all('#root [data-slot="conversation"]'),
    insert: 'append',
  },
  'shell.overlay': {
    describe: 'Shell overlay host ([data-shell-overlay])',
    find: all('[data-shell-overlay]'),
    insert: 'append',
  },
  'desktop.detailsSurface': {
    describe: 'Desktop details surface (.dshDesktopDetailsSurface) — class-based, fragile',
    find: all('.dshDesktopDetailsSurface'),
    insert: 'append',
  },
  'layout.frame': {
    describe: 'Layout frame carrying sidebar width / collapsed state (read-only anchor)',
    find: all('[data-sidebar-collapsed], [data-shell-frame]'),
    insert: 'append',
  },
  'settings.nav': {
    describe: 'Settings navigation list',
    find: all('[data-settings-nav]'),
    fallback: all('[role="tablist"]'),
    insert: 'append',
  },
};

/** Read the sidebar layout state from the `layout.frame` anchor. */
export interface LayoutFrameState {
  /** Whether the shell reports the sidebar as collapsed. */
  collapsed: boolean;
  /** First `px` value of the frame's grid template, when present. */
  firstColumnPx: number | undefined;
}

/**
 * Project one `layout.frame` host into {@link LayoutFrameState}.
 *
 * Encapsulates the `style.gridTemplateColumns` parsing dsh-code-review does at
 * `src/client.ts:1176`, so the regex lives with the anchor it belongs to.
 */
export function readLayoutFrame(host: Element): LayoutFrameState {
  const collapsed = host.hasAttribute('data-sidebar-collapsed');
  let firstColumnPx: number | undefined;
  const style = (host as HTMLElement).style;
  const template = typeof style?.gridTemplateColumns === 'string' ? style.gridTemplateColumns : '';
  const match = /^\s*([\d.]+)px/.exec(template);
  if (match !== null) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value)) firstColumnPx = value;
  }
  return { collapsed, firstColumnPx };
}
