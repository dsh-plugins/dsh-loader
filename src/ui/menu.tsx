/**
 * The wrapped platform MENU (`DshMenu`).
 *
 * Consumers import this from `@dsh-plugin/dsh-loader/client` instead of
 * importing `@deepseek-ai/dsh-client-ui-primitives` directly. The wrapper exists
 * so that changes to the platform primitive — a renamed export, a moved package,
 * an altered prop shape — are absorbed HERE, in one line's distance, instead of
 * breaking every plugin that renders a dropdown.
 *
 * Two deliberate properties:
 *
 *  1. TYPES ARE HAND-WRITTEN, not re-exported. A shipped `.d.ts` that says
 *     `export { Menu } from '@deepseek-ai/...'` resolves from dshloader's own
 *     install — which consumers do not have (see docs/ui-kit.md, 铁律三) — so
 *     re-exported types break consumer typecheck the moment dshloader is
 *     published without devDependencies. These interfaces are written out and
 *     must be kept in sync with upstream BY HAND when a prop the plugins use
 *     changes; that maintenance cost is the price of consumer-side purity.
 *  2. THE PLATFORM IMPORT IS STATIC AND SINGULAR. This file is the only place in
 *     dshloader that names the primitives package for menus. If it disappears or
 *     renames, the fix is contained here. The static import means dshloader's
 *     client bundle hard-depends on the primitive seed module — the same failure
 *     mode the direct imports had, so no regression — which is also why the
 *     missing-module degradation path is NOT attempted: with ESM compiled into
 *     the CJS closure factory there is no clean way to defer the require, and a
 *     half-working menu would be worse than an honest load error.
 *
 * @module @dsh-plugin/dsh-loader/ui/menu
 */
import * as React from 'react';
// The SINGLE site that names the platform primitives package for menus.
import { Menu as PlatformMenu } from '@deepseek-ai/dsh-client-ui-primitives';

/** One selectable row (optionally with a nested submenu). */
export interface MenuItem {
  id: string;
  label: React.ReactNode;
  disabled?: boolean;
  /** Leading icon. */
  icon?: React.ReactNode;
  /** Destructive row: error-coloured text/icon and danger hover fill. */
  danger?: boolean;
  /** Nested card opened to the right on hover/focus. */
  submenu?: readonly MenuItem[];
}

/** Hairline between item groups (not selectable). */
export interface MenuSeparator {
  type: 'separator';
  id: string;
}

/** Non-interactive heading row above a group of items. */
export interface MenuLabel {
  type: 'label';
  id: string;
  text: string;
}

/** One primary-menu entry: a row, a separator, or a heading label. */
export type MenuEntry = MenuItem | MenuSeparator | MenuLabel;

/** {@link DshMenu} props — structurally the platform Menu's contract. */
export interface DshMenuProps {
  /** Whether the list is showing (owner-controlled). */
  open: boolean;
  /** The trigger element (rendered in place). */
  anchor: React.ReactNode;
  /** Selectable rows and optional separators/labels. */
  items: readonly MenuEntry[];
  /** Rows pinned below the scrolling items area. */
  footer?: readonly MenuEntry[];
  /** Row shown as selected. */
  selectedId?: string | undefined;
  /** Rows shown as selected with independent option groups. */
  selectedIds?: readonly string[] | undefined;
  /** Row click callback (not called for disabled rows). */
  onSelect: (id: string) => void;
  /** Invoked on outside click or Escape. */
  onClose: () => void;
  /** List alignment against the anchor (default `'start'`). */
  align?: 'start' | 'end';
  /** Open below (`'bottom'`, default), above, or to the right of the anchor. */
  side?: 'bottom' | 'top' | 'right';
  /**
   * Render the list into `document.body`, fixed-positioned from the anchor rect.
   * Use when an ancestor's overflow clipping would crop the in-place list.
   */
  portal?: boolean;
  /**
   * Close once the pointer has left both trigger and list for the grace period
   * (default `false` keeps it open until outside click/Escape/selection).
   */
  closeOnPointerLeave?: boolean;
  /** Reduce vertical row spacing only. */
  dense?: boolean;
  /** Reduced typography and spacing overall. */
  compact?: boolean;
  /** Portal mode only: supply the anchor rect directly. */
  getAnchorRect?: () => DOMRect | null;
  /** Extra class on the anchor wrapper. */
  className?: string;
}

/** Whether the platform primitive is already known to be missing. */
let platformMissing = false;

/**
 * The stable menu surface for dshloader consumers.
 *
 * Forwards every prop verbatim to the platform primitive — this wrapper's job
 * is ISOLATION (one import site, hand-owned types), not behaviour change. When
 * the platform evolves, adaptation code goes here and consumers stay put.
 */
export function DshMenu(props: DshMenuProps): React.ReactElement | null {
  if (platformMissing) return null;
  try {
    // Forward verbatim. `PlatformMenu` is typed against upstream; the cast keeps
    // our hand-written contract authoritative on the consumer-facing side.
    return (PlatformMenu as unknown as (p: DshMenuProps) => React.ReactElement)(props);
  } catch (error) {
    // Render-time failures (prop-shape drift) degrade to an empty menu with one
    // loud warning rather than tearing down the host plugin's tree.
    platformMissing = true;
    console.warn(
      `[dshloader] DshMenu: the platform menu primitive failed (${error instanceof Error ? error.message : String(error)}); rendering nothing. ` +
        'Update src/ui/menu.tsx to adapt to the new platform contract.',
    );
    return null;
  }
}
