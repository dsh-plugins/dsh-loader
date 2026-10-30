/** Clipboard action and its temporary success state. */
export interface ClipboardCopyState {
    /** True for one second after an accepted clipboard write. */
    readonly copied: boolean;
    /** Write the current text unless a write or success indication is already active. */
    readonly onCopy: () => void;
}
/**
 * Keep clipboard feedback local to the mounted control and release its reset timer on unmount.
 * @param text - Exact text to copy when the action is invoked.
 * @returns Success feedback and a callback stable while text and feedback are unchanged.
 */
export declare function useClipboardCopy(text: string): ClipboardCopyState;
