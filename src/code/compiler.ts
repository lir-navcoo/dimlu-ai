import { transform } from 'sucrase';
// Sucrase is pinned. Its parser supplies lexical tokens, so comments, regexps and
// template text are never mistaken for module declarations.
import { parse } from 'sucrase/dist/parser/index';
import { TokenType as tt } from 'sucrase/dist/parser/tokenizer/types';
import { IdentifierRole } from 'sucrase/dist/parser/tokenizer/index';
import type { PageCode } from '../../packages/schema/types';

const supportedModules = new Set(['react', 'react/jsx-runtime', '@dimlu/runtime']);
export type CompiledPageCode = { code: string };

/** Decode module specifiers without evaluating any JavaScript. */
function stringValue(raw: string): string {
  return raw
    .slice(1, -1)
    .replace(
      /\\(u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[\s\S])/g,
      (_, escape: string) => {
        if (escape[0] === 'u' || escape[0] === 'x') {
          const digits = escape[1] === '{' ? escape.slice(2, -1) : escape.slice(1);
          return String.fromCodePoint(parseInt(digits, 16));
        }
        return (
          (
            {
              n: '\n',
              r: '\r',
              t: '\t',
              b: '\b',
              f: '\f',
              v: '\v',
              '0': '\0',
              '\n': '',
              '\r': '',
              '\r\n': '',
            } as Record<string, string>
          )[escape] ?? escape
        );
      },
    );
}

function validateModules(source: string, tsx: boolean) {
  const { tokens } = parse(source, true, tsx, false);
  const spelling = (index: number) =>
    tokens[index] ? source.slice(tokens[index].start, tokens[index].end) : '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === tt._import) {
      // Property names (obj.import(), { import() {} }) are not declarations.
      if (
        tokens[i - 1]?.type === tt.dot ||
        tokens[i - 1]?.type === tt.questionDot ||
        token.identifierRole !== null
      )
        continue;
      if (tokens[i + 1]?.type === tt.parenL || tokens[i + 1]?.type === tt.dot)
        throw new Error('页面代码不支持动态 import() 或 import.meta；请使用静态 import。');
      if (tokens[i + 1]?.type === tt.string) check(spelling(i + 1));
      else {
        let found = false;
        for (let j = i + 1; j < tokens.length; j++) {
          if (spelling(j) === 'from' && tokens[j + 1]?.type === tt.string) {
            check(spelling(j + 1));
            found = true;
            break;
          }
          if (tokens[j].type === tt.semi) break;
        }
        if (!found) throw new Error('页面代码只支持标准 ES 模块 import。');
      }
    }
    if (token.type === tt._export) {
      // Only re-export forms can load another module. A normal exported function
      // body may contain unrelated strings and identifiers named "from".
      let start = i + 1;
      if (spelling(start) === 'type') start++;
      if (tokens[start]?.type === tt.star || tokens[start]?.type === tt.braceL) {
        let depth = 0;
        for (let j = start; j < tokens.length; j++) {
          if (tokens[j].type === tt.braceL) depth++;
          if (tokens[j].type === tt.braceR) depth--;
          if (depth === 0 && spelling(j) === 'from' && tokens[j + 1]?.type === tt.string) {
            check(spelling(j + 1));
            break;
          }
          if (
            tokens[j].type === tt.semi ||
            (depth === 0 && tokens[j].type === tt.braceR && spelling(j + 1) !== 'from')
          )
            break;
        }
      }
    }
    if (
      token.type === tt.name &&
      stringValue(`"${spelling(i)}"`) === 'require' &&
      token.identifierRole !== IdentifierRole.ObjectKey &&
      tokens[i - 1]?.type !== tt.dot &&
      tokens[i - 1]?.type !== tt.questionDot
    )
      throw new Error('页面代码不支持 CommonJS require()；请使用静态 import。');
  }
  function check(raw: string) {
    const id = stringValue(raw);
    if (!supportedModules.has(id))
      throw new Error(`不支持导入模块 ${id}。可使用 react、react/jsx-runtime、@dimlu/runtime。`);
  }
}

/** Pure transform/validation. Never call the resulting factory here. */
export function compilePageCode(input: Pick<PageCode, 'source' | 'language'>): CompiledPageCode {
  validateModules(input.source, input.language === 'tsx');
  const { code } = transform(input.source, {
    transforms: input.language === 'tsx' ? ['typescript', 'jsx', 'imports'] : ['jsx', 'imports'],
    jsxRuntime: 'automatic',
    production: true,
    keepUnusedImports: true,
    filePath: input.language === 'tsx' ? 'page.tsx' : 'page.jsx',
  });
  // Function construction parses the transformed module but does not execute it.
  new Function('require', 'module', 'exports', code);
  return { code };
}
