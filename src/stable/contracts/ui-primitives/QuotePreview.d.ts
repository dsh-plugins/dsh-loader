/** Shared compact presentation for draft and sent text quotes. */
import type { JSX } from 'react';
/** Optional whole-quote removal control supplied by an editable owner. */
export interface QuotePreviewRemoval {
    /** Localized accessible name for the removal button. */
    readonly label: string;
    /** Remove the complete owning quote node. */
    readonly onRemove: () => void;
}
/** Presentation inputs for one compact quote excerpt. */
export interface QuotePreviewProps {
    /** Exact selected text rendered inline and exposed in a popover while clipped. */
    readonly text: string;
    /** Composer-only removal action; omit for inert sent quotes. */
    readonly removal?: QuotePreviewRemoval | undefined;
}
/**
 * Render one width-capped quote preview shared by editable drafts and sent messages.
 * Clipped excerpts open a content-sized, scrollable popover that fits within the viewport.
 * @param props - selected text and optional localized removal action.
 * @returns a non-navigating quote preview with a full-text popover only while clipped.
 */
export declare function QuotePreview({ text, removal }: QuotePreviewProps): JSX.Element;
