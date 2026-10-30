import type { ReactNode, RefObject } from 'react';
/**
 * Render an anchor with a hover-triggered preview card independently of nested tooltips.
 * Touch entry does not open a preview or intercept the anchor's action.
 * @param props.anchor - the hover target (rendered in place inside a wrapper span).
 * @param props.content - card content; the pointer may rest on it, so it is
 * readable and selectable, but it carries no dismissal affordance of its own.
 * @param props.openDelayMs - hover dwell before the card shows (default 500).
 * @param props.variant - compact card beside the anchor, or a preview above/below it
 * with 24px side insets, a 420px height cap, the frame-top clearance (capped below an anchor inside the top strip),
 * and 100ms opacity transitions.
 * @param props.widthAnchorRef - optional element whose width and horizontal position size the preview.
 * @param props.inline - keep the anchor in prose; show a contained preview on hover or keyboard focus.
 * Its hover region connects the anchor and preview across the visual gap.
 * @param props.fitContent - size an inline card to its content within the usual width cap.
 * @param props.disabled - suppress opening; turning true dismisses an open card.
 * @param props.grouped - share first-display dwell across the surrounding list and active portal.
 * Group replacement removes the previous card immediately, including a fading preview.
 * @param props.copyText - optional primary value copied by activation and
 * included in the card's accessible name.
 * @param props.copyLabel - localized accessible activation-label prefix.
 * @param props.copiedLabel - localized visible success label.
 * @returns anchor wrapper with the conditional portaled card.
 */
export declare function HoverCard({ anchor, content, openDelayMs, disabled, grouped, copyText, copyLabel, copiedLabel, variant, widthAnchorRef, inline, fitContent, }: {
    anchor: ReactNode;
    /** Inline media preview using the shared menu material and keyboard focus. */
    inline?: boolean;
    fitContent?: boolean;
    content: ReactNode;
    openDelayMs?: number;
    disabled?: boolean;
    grouped?: boolean;
    variant?: 'compact' | 'preview';
    widthAnchorRef?: RefObject<HTMLElement | null>;
} & ({
    copyText?: string | undefined;
    copyLabel: string;
    copiedLabel: string;
} | {
    copyText?: undefined;
    copyLabel?: string;
    copiedLabel?: string;
})): import("react").JSX.Element;
