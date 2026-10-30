/** Image gestures delegate file preparation and transport to the owning feature. */
import { type ImgHTMLAttributes } from 'react';
import type { FileDragActions } from './file-drag-actions.js';
type ImageGestures = Required<Pick<ImgHTMLAttributes<HTMLImageElement>, 'onPointerEnter' | 'onPointerDown' | 'onPointerLeave' | 'onDragStart' | 'onDragEnd' | 'onClickCapture'>>;
/**
 * Prepare resource-backed images on primary press, other images also on hover; release on leave.
 * Releasing inside the image retains preparation for the next gesture; cancelled drags never start late.
 * @param actions - stable file preparation and error callbacks.
 * @param src - displayed image URL.
 * @param name - proposed export name.
 * @param original - already loaded original bytes.
 * @param resourceAddress - verifiable reference to an unmodified local original.
 * @returns image gesture handlers; overflowing images remain owned by their pan handler.
 */
export declare function useImageDrag(actions: FileDragActions, src: string, name: string, original?: File, resourceAddress?: string): ImageGestures;
export {};
