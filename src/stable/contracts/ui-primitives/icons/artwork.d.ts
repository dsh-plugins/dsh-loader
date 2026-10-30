/**
 * Default artwork for the product icon set. Each glyph is an SVG document
 * whose geometry may depend on the stroke weight; ui-theme publishes every
 * glyph and weight as one `<symbol id="dsw-icon-<glyph>-<weight>">` in the
 * document icon sprite, which a theme can replace with its own SVG.
 */
/** Regular stroke width used by the product icon set. */
export declare const ICON_REGULAR_STROKE = 1;
/** Medium stroke width used by emphasized product icons. */
export declare const ICON_MEDIUM_STROKE = 1.3;
/** Default artwork keyed by glyph name; symbol ids derive from these keys. */
export declare const ICON_ARTWORK: {
    'new-chat-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'search-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'globe-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'settings-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'panel-left-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'ellipsis-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'plus-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'check-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'branch-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'chevron-down-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'chevron-left-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'chevron-right-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'triangle-right-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'chevron-up-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'close-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'close-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'close-circle-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'copy-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'refresh-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'like-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'like-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'dislike-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'dislike-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'share-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'deliver-doc': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'edit-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'think-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'agent-preset-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'browse-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'context-injection-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'link-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'right-up-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'enhance-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'trash-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'warning-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'check-circle-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'warning-triangle-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'user-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'users-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'paper-plane-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'stop-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'paperclip-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'loading-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'download-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'play-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'pause-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'fullscreen-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'code-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'cordis-plugin-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'api-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'personalization-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'project-add-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'folder-open-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'folder-open': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'folder-close': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'tree-corner': {
        size: number;
        aspect: [number, number];
        svg: (strokeWidth: number) => string;
    };
    'light-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'dark-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'followsystem-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'data-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'database-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'clock-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'gauge-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'send-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'queue-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'checklist-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'list-pen-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'goal-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    sparkle: {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'inspect-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'skill-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'question-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'info-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'plugin-pinwheel-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'alarm-clock-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'archive-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'wrap-lines-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'nowrap-fill': {
        size: number;
        svg: () => string;
    };
    'wrap-fill': {
        size: number;
        svg: () => string;
    };
    'compare-split-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'plan-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'compact-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'shield-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'check-circle-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'unarchive-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'pin-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'pin-fill': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'flat-list-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'workspace-tree-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'chevrons-up-down-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'drag-handle-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'archive-off-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'archive-check-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'sliders-two-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'microphone-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'apps-add-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
    'apps-add-compact-outline': {
        size: number;
        svg: (strokeWidth: number) => string;
    };
};
/** Glyph name accepted by {@link iconSymbolId}. */
export type IconGlyph = keyof typeof ICON_ARTWORK;
/** Weight suffix of a product icon symbol. */
export type IconWeight = 'regular' | 'medium';
/**
 * Name the sprite symbol that carries one glyph weight.
 * @param glyph - glyph key in {@link ICON_ARTWORK}.
 * @param weight - stroke weight.
 * @returns the `dsw-icon-<glyph>-<weight>` element id.
 */
export declare function iconSymbolId(glyph: IconGlyph, weight: IconWeight): IconSymbolId;
/** Sprite symbol id of one product glyph weight. */
export type IconSymbolId = `dsw-icon-${IconGlyph}-${IconWeight}`;
/** Default SVG document of every product icon symbol, keyed by symbol id. */
export declare const ICON_SYMBOLS: Readonly<Record<IconSymbolId, string>>;
