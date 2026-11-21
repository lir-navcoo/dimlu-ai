// Lexical module validation uses the parser from our pinned Sucrase release.
declare module 'sucrase/dist/parser/index' {
  export const parse: typeof import('sucrase/dist/types/parser/index').parse;
}
declare module 'sucrase/dist/parser/tokenizer/index' {
  export const IdentifierRole: typeof import('sucrase/dist/types/parser/tokenizer/index').IdentifierRole;
}
declare module 'sucrase/dist/parser/tokenizer/types' {
  export const TokenType: typeof import('sucrase/dist/types/parser/tokenizer/types').TokenType;
}
