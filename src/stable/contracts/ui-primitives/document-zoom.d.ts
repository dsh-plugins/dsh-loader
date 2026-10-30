/** Shared fixed document scales used by preview surfaces and their controls. */
/** Fixed scale limits, incremental step, and menu choices. */
export declare const DOCUMENT_ZOOM: {
    readonly minimum: 0.25;
    readonly maximum: 4;
    readonly step: 0.25;
    readonly presets: readonly [0.25, 0.5, 1, 1.5, 2];
};
/** Localized labels supplied by the document renderer. */
export interface DocumentZoomLabels {
    readonly controls: string;
    readonly menu: string;
    readonly out: string;
    readonly into: string;
    readonly value: (percent: number) => string;
}
