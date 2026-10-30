/**
 * Identify iOS and Android phones and tablets from the current browser's device information.
 * MacIntel with multiple touch points identifies desktop-mode iPads.
 * The first result is shared by all callers until the page reloads.
 * @returns true for recognized mobile devices; false for other devices, including unrecognized UAs.
 */
export declare function isMobileDevice(): boolean;
/**
 * Focus an automatic destination without a focus outline until keyboard navigation or blur.
 * The theme suppresses outlines while data-dsh-automatic-focus is present; borders and shadows remain intact.
 * Tab and directional navigation restore normal focus styling.
 * @param element - control or container receiving automatic focus.
 * @param options - browser focus options, including scroll preservation.
 */
export declare function focusWithoutRing(element: HTMLElement, options?: FocusOptions): void;
