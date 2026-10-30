import { type HighlightSpan } from './markdown/highlight.js';
export { CODE_HIGHLIGHT_EXTENSIONS, languageForPath } from '../code-language.js';
/** Highlight one source fragment into one token list per line. */
export type CodeHighlighter = (code: string) => HighlightSpan[][] | undefined;
/**
 * Bind the shared lazy highlighter to one language and refresh after its grammar loads.
 * @param language - grammar hint selected from the source filename.
 * @returns a stable fragment highlighter; unknown and loading grammars return `undefined` for plain-text fallback.
 */
export declare function useCodeHighlighter(language: string | undefined): CodeHighlighter;
export type { HighlightSpan };
