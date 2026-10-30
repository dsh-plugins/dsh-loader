import type { ReactNode } from 'react';
/** A tab links its localized label to a caller-owned panel. */
export interface SegmentedTab<Value extends string = string> {
    value: Value;
    label: ReactNode;
    id: string;
    panelId: string;
}
/**
 * Render equal-width, controlled tabs with a sliding selection indicator.
 * @param props.items - non-empty ordered tabs with unique values and DOM ids.
 * @param props.value - selected value, which must belong to items.
 * @param props.onChange - selection requested by click, Left/Right, or Home/End.
 * Keyboard selection also moves focus; only the selected tab is a tab stop.
 * @param props.label - localized accessible name for the tab list.
 * @param props.className - layout placement; panels remain caller-owned.
 * @param props.size - `sm` draws 30px tabs with a 2px inset (34px tall); the default `md` draws 34px tabs with a 4px inset (42px tall).
 * @returns the tab list, without its panels.
 */
export declare function SegmentedTabs<Value extends string>({ items, value, onChange, label, className, size }: {
    items: readonly [SegmentedTab<Value>, ...SegmentedTab<Value>[]];
    value: Value;
    onChange: (value: Value) => void;
    label: string;
    className?: string | undefined;
    size?: 'sm' | 'md' | undefined;
}): ReactNode;
