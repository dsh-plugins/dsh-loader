/** Opaque internal AST boundary; public component props are independent of the parser. */
interface Node { type: string; [key: string]: unknown }
export type Definition = Node;
export type FootnoteDefinition = Node;
export type Root = Node;
export type RootContent = Node;
