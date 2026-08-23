/**
 * Design tokens and the idempotent stylesheet injector shared by every
 * dshloader UI component.
 *
 * Tokens are the DSH shell's own CSS custom properties, each paired with a
 * fallback so a component still renders sanely when the shell changes or the
 * plugin is previewed outside it. The names were harvested from the shell
 * styling the plugins in this family already rely on; when dsh renames one,
 * this file is the single place to fix.
 *
 * @module @dsh-plugin/dsh-loader/ui/style
 */

/** `var(--name, fallback)` — a token reference that degrades instead of breaking. */
export function token(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

/** The DSH shell tokens dshloader components consume. */
export const T = {
  /** Primary body text. */
  labelPrimary: token('--dsw-alias-label-primary', '#1a1a1a'),
  /** Secondary / supporting text. */
  labelSecondary: token('--dsw-alias-label-secondary', '#4a4a4a'),
  /** Tertiary text (hints, units). */
  labelTertiary: token('--dsw-alias-label-tertiary', '#8a8a8a'),
  /** Caption / disabled text. */
  labelCaption: token('--dsw-alias-label-caption', '#a8a8a8'),
  /** Page / card background. */
  bgBase: token('--dsw-alias-bg-base', '#ffffff'),
  /** Subtle raised surface. */
  bgSubtle: token('--dsw-alias-bg-subtle', 'rgba(127,127,127,0.06)'),
  /** Hover wash for interactive rows. */
  bgHover: token('--dsw-alias-bg-hover', 'rgba(127,127,127,0.10)'),
  /** Default control border. */
  border: token('--dsw-alias-border-l2', '#d9d9d9'),
  /** Lighter divider. */
  borderSubtle: token('--dsw-alias-border-l1', '#ececec'),
  /** Brand accent (primary button, checked states). */
  accent: token('--dsw-alias-brand-primary', '#4f7cff'),
  /** Accent text placed on top of the accent fill. */
  accentOn: token('--dsw-alias-brand-on-primary', '#ffffff'),
  /** Destructive accent. */
  danger: token('--dsw-alias-status-danger', '#e5484d'),
  /** Monospace stack for code / paths. */
  fontCode: token('--ds-font-family-code', 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'),
} as const;

/** Shared control geometry so every dshloader control lines up. */
export const G = {
  /** Control height for inputs / selects / buttons. */
  controlHeight: 30,
  /** Compact control height. */
  controlHeightSm: 24,
  /** Standard corner radius. */
  radius: 8,
  /** Pill radius (switches, chips). */
  radiusPill: 999,
  /** Horizontal padding inside a control. */
  padX: 10,
  /** Standard row gap. */
  gap: 8,
  /** Base font size. */
  fontSize: 13,
  /** Small font size (descriptions). */
  fontSizeSm: 12,
} as const;

/**
 * Inject a stylesheet once, tagged with the DSH client-module ownership
 * attributes (`data-plugin` / `data-plugin-css`) so the HMR driver can reclaim
 * it. Calling this repeatedly with the same `cssId` is a no-op.
 *
 * @param pluginId - owning plugin id (package name), for `data-plugin`.
 * @param cssId - stylesheet id within the plugin, e.g. `'ui/components.css'`.
 * @param css - the stylesheet text.
 * @returns a disposer removing the tag, for callers that want one.
 */
export function injectStyle(pluginId: string, cssId: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {};
  const tagId = `${pluginId}/${cssId}`;
  const selector = `style[data-plugin-css="${tagId}"]`;
  const existing = document.querySelector(selector);
  if (existing !== null) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = pluginId;
  style.dataset.pluginCss = tagId;
  style.textContent = css;
  document.head.appendChild(style);
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style);
  };
}

/** The class-name prefix every dshloader UI class carries. */
export const CX = 'dshl';

/** Join truthy class names. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
