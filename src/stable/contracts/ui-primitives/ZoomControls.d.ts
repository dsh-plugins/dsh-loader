import { type DocumentZoomLabels } from './document-zoom.js';
/** Live percentage display updated independently from the document tree. */
export interface ZoomControlsHandle {
    /** @param zoom - current gesture scale multiplier. */
    showZoom: (zoom: number) => void;
}
/**
 * Present optional fitting, fixed presets, and incremental controls.
 * @param props - committed `zoom`, optional `fit` row (omitted: no fitting row), localized labels, `visible`, optional
 *   owner `className`, and zoom and activity callbacks.
 * @param ref - `showZoom` displays a transient scale until `zoom` changes.
 * @returns a localized zoom toolbar.
 */
export declare const ZoomControls: import("react").ForwardRefExoticComponent<{
    readonly zoom: number;
    readonly fit?: {
        readonly label: string;
        readonly selected: boolean;
        readonly onSelect: () => void;
    } | undefined;
    readonly className?: string | undefined;
    readonly labels: DocumentZoomLabels;
    readonly visible: boolean;
    readonly onZoom: (zoom: number) => void;
    readonly onActiveChange: (active: boolean) => void;
} & import("react").RefAttributes<ZoomControlsHandle>>;
