/** Let asterisk strong emphasis close after punctuation when CJK prose continues without whitespace. */
import type { Extension } from '../../markdown-parser.js';
/**
 * Extend CommonMark asterisk strong emphasis for punctuation-delimited CJK
 * prose, as a micromark syntax extension for `fromMarkdown`.
 * @returns The micromark syntax extension.
 */
export declare function cjkFriendlyStrong(): Extension;
