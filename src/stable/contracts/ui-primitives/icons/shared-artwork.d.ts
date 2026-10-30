import type { IconProps } from './props.js';
interface WeightedArtworkProps extends IconProps {
    strokeWidth: number;
}
/**
 * Render conversation geometry — the chat bubble around two text lines —
 * for session reference icons; it matches the `queue-outline` product glyph.
 * @param props - Size, optional CSS class, and inherited stroke width.
 * @returns The decorative SVG artwork.
 */
export declare const ChatLinesOutlineArtwork: ({ size, className, strokeWidth }: WeightedArtworkProps) => import("react").JSX.Element;
/**
 * Render globe geometry for link icons; it matches the `globe-outline` product glyph.
 * @param props - Size, optional CSS class, and inherited stroke width.
 * @returns The decorative SVG artwork.
 */
export declare const GlobeOutlineArtwork: ({ size, className, strokeWidth }: WeightedArtworkProps) => import("react").JSX.Element;
/**
 * Render code-bracket geometry for link icons; it matches the `inspect-outline` product glyph.
 * @param props - Size, optional CSS class, and inherited stroke width.
 * @returns The decorative SVG artwork.
 */
export declare const CodeBracketsArtwork: ({ size, className, strokeWidth }: WeightedArtworkProps) => import("react").JSX.Element;
/**
 * Render document-browse geometry for reference icons; it matches the `browse-outline` product glyph.
 * @param props - Size, optional CSS class, and inherited stroke width.
 * @returns The decorative SVG artwork.
 */
export declare const BrowseOutlineArtwork: ({ size, className, strokeWidth }: WeightedArtworkProps) => import("react").JSX.Element;
/**
 * Render closed-folder geometry for reference and link icons; it matches the `folder-close` product glyph.
 * @param props - Size, optional CSS class, and inherited stroke width.
 * @returns The decorative SVG artwork.
 */
export declare const FolderCloseArtwork: ({ size, className, strokeWidth }: WeightedArtworkProps) => import("react").JSX.Element;
export {};
