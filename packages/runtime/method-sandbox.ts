import { parse } from 'sucrase/dist/parser/index';
// Sucrase is pinned; the same parser backs the page-code compiler, so token roles are stable.
import { TokenType as tt } from 'sucrase/dist/parser/tokenizer/types';
import { IdentifierRole } from 'sucrase/dist/parser/tokenizer/index';

/**
 * Application methods execute in a dedicated Worker realm (`method-worker-core`); the
 * only way back to the host realm is the capability RPC. `input` and `context` are the
 * only intended capabilities. Anything able to reach the realm's globals or generate
 * code is rejected at parse time and, as defense in depth, shadowed inside the
 * compiled body. Where Worker is unavailable, methods fall back to the page realm with
 * this same gate, which there is the only barrier.
 *
 * Residual bypass: property names built by string concatenation (obj['const'+'ructor'])
 * cannot be detected at parse time; inside the Worker realm such escapes still cannot
 * reach the host realm (only the realm's own globals).
 */

/** Reading these bare identifiers reaches host-realm objects or generates code. */
const deniedBareNames = new Set([
  'eval',
  'Function',
  'require',
  'globalThis',
  'self',
  'window',
  'document',
  'frames',
  'opener',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'navigator',
  'location',
  'history',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'importScripts',
  'postMessage',
  'alert',
  'confirm',
  'prompt',
  'open',
  'close',
  'top',
  'parent',
]);

/** Any object escapes into the host realm through these members (prototype chain). */
const deniedPropertyNames = new Set([
  'constructor',
  'prototype',
  '__proto__',
  'eval',
  'Function',
  'require',
  'importScripts',
]);

/** Denied names that users never legitimately declare can also be shadowed as undefined. */
export const shadowedCapabilityNames = [
  'Function',
  'globalThis',
  'self',
  'window',
  'document',
  'frames',
  'opener',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'importScripts',
  'postMessage',
  'alert',
  'confirm',
  'prompt',
];

/** Decode a string-literal token spelling without evaluating any JavaScript. */
function decodeString(raw: string): string {
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

/** Throws with an actionable message when method.source tries to leave its capability box. */
export function assertMethodCapabilities(source: string): void {
  const { tokens } = parse(source, false, true, false);
  const spelling = (index: number) =>
    tokens[index] ? source.slice(tokens[index].start, tokens[index].end) : '';
  // Declared names (const parent, params, shorthand) may be referenced bare without
  // touching the host realm, so the bare-name denylist only applies to free references.
  const declared = new Set<string>();
  for (const token of tokens)
    if (
      token.type === tt.name &&
      token.identifierRole !== null &&
      token.identifierRole !== IdentifierRole.Access &&
      token.identifierRole !== IdentifierRole.ExportAccess &&
      token.identifierRole !== IdentifierRole.ObjectKey &&
      token.identifierRole !== IdentifierRole.ImportDeclaration &&
      token.identifierRole !== IdentifierRole.ImportAccess
    )
      declared.add(source.slice(token.start, token.end));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Property names (obj.import(), { import() {} }) are not dynamic import calls.
    if (
      token.type === tt._import &&
      token.identifierRole === null &&
      tokens[i + 1]?.type === tt.parenL
    )
      throw new Error('方法源码不允许动态 import()；请通过 input 和 context 使用能力。');
    if (token.type === tt.string) {
      const property = decodeString(spelling(i));
      if (deniedPropertyNames.has(property) && tokens[i - 1]?.type === tt.bracketL)
        throw new Error(`方法源码不允许访问属性 ${property}。`);
      continue;
    }
    if (token.type !== tt.name) continue;
    const name = spelling(i);
    // IdentifierRole.Access is a bare reference; declarations carry distinct roles, so
    // legitimate local names are never rejected.
    if (
      token.identifierRole === IdentifierRole.Access &&
      deniedBareNames.has(name) &&
      !declared.has(name)
    )
      throw new Error(`方法源码不允许使用宿主能力 ${name}；请通过 input 和 context 使用能力。`);
    if (token.identifierRole === null) {
      const previous = tokens[i - 1]?.type;
      if (
        (previous === tt.dot || previous === tt.questionDot) &&
        deniedPropertyNames.has(name)
      )
        throw new Error(
          `方法源码不允许访问属性 ${name}（原型链逃逸）；请改用 Array.isArray 等纯函数。`,
        );
    }
  }
}
