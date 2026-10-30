/**
 * Extend upstream dollar-only math syntax with TeX delimiters while reusing its
 * token vocabulary. The dollar construct is dispatched before upstream's
 * `mathFlow`, so the shapes it accepts keep the opening line's text as math
 * instead of fence meta, which the renderer does not read. A `$$` candidate it
 * declines — a `$$` sequence the line does not end after, or a block left open
 * — is left to that upstream flow.
 */
import type { Extension } from '../../markdown-parser.js';
/**
 * TeX backslash delimiters and display-dollar blocks as a micromark syntax
 * extension reusing `micromark-extension-math`'s token vocabulary; the caller
 * must also register `math()` on the same parse so the emitted tokens compile
 * to standard math nodes. Both `$$<math>$$` on one line and a `$$<math>` block
 * closed by a trailing `$$` parse as one math node, and a closing `$$` may sit
 * at the end of a content line.
 * @returns The micromark syntax extension.
 */
export declare function mathCompatibility(): Extension;
