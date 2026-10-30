import type { DragEvent } from 'react';
/**
 * Own a row's inert drag preview until drag end, replacement, or unmount.
 * The offscreen copy keeps WebKit snapshots separate from overlapping panels.
 * The wrapper copies only explicitly requested computed custom properties.
 * Its cloned slot DOM remains in document.body for that lifetime; query live rows
 * within their list to exclude duplicate text and element IDs.
 * @param className - preview background matching the row's surface; WebKit fills
 * transparent snapshot pixels white, including rounded corners.
 * @param inheritedProperties - custom-property names whose computed values the preview needs.
 * Omit to copy none. Keep the list reference stable; replacing it clears the active preview.
 * @returns preview callbacks; cleanup reports whether this row started a drag,
 * even when its preview failed or the row became non-draggable before drag end.
 * Start accepts the source row when a child handle owns the drag event.
 */
export declare function useRowDragPreview(className: string, inheritedProperties?: readonly `--${string}`[]): {
    start: (event: DragEvent<HTMLElement>, row?: HTMLElement) => void;
    clear: () => boolean;
};
