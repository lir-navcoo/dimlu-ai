import jsep from 'jsep';
import { forbiddenObjectKeySet, type Value } from '../schema/types';

export interface EvaluationContext {
  state: Readonly<Record<string, unknown>>;
  scope: Readonly<Record<string, unknown>>;
  event?: unknown;
  forms?: Readonly<Record<string, unknown>>;
  sources?: Readonly<Record<string, unknown>>;
  formValues?: (id: string) => unknown;
}
export interface CompiledValue {
  evaluate(context: EvaluationContext): unknown;
  dependencies: readonly string[];
  usesEvent: boolean;
  usesScope: boolean;
  usesSources: boolean;
}
type Ast = { type: string; [key: string]: any };
export type ScopeReads = { names: ReadonlySet<string>; wildcard: boolean };
/** Read lexical locals without restricting computed/bare scope compatibility. */
export function valueScopeReads(value: Value): ScopeReads {
  const names = new Set<string>();
  let wildcard = false;
  const visit = (ast: Ast) => {
    if (ast.type === 'MemberExpression') {
      if (ast.object.type === 'Identifier' && ast.object.name === 'scope') {
        const name = !ast.computed
          ? ast.property.name
          : ast.property.type === 'Literal'
            ? String(ast.property.value)
            : undefined;
        if (name === undefined) wildcard = true;
        else names.add(name);
      } else visit(ast.object);
      if (ast.computed) visit(ast.property);
      return;
    }
    if (ast.type === 'Identifier' && ast.name === 'scope') wildcard = true;
    for (const child of Object.values(ast)) {
      if (Array.isArray(child))
        child.forEach((item) => {
          if (item && typeof item === 'object') visit(item);
        });
      else if (child && typeof child === 'object') visit(child);
    }
  };
  if (value.kind === 'expression') visit(jsep(value.source) as Ast);
  return { names, wildcard };
}
/** Validate explicitly named locals without exposing the AST to authoring code. */
export function assertValueScope(value: Value, available: ReadonlySet<string>) {
  if (value.kind !== 'expression') return;
  const visit = (ast: Ast) => {
    if (
      ast.type === 'MemberExpression' &&
      ast.object.type === 'Identifier' &&
      ast.object.name === 'scope'
    ) {
      const name = !ast.computed
        ? ast.property.name
        : ast.property.type === 'Literal'
          ? String(ast.property.value)
          : undefined;
      if (!name || !available.has(name))
        throw new Error(`当前组件缺少明确的作用域 scope.${name ?? '?'}`);
      return;
    }
    if (ast.type === 'Identifier' && ast.name === 'scope')
      throw new Error('作用域参数请使用明确的 scope.变量名');
    if (ast.type === 'MemberExpression') {
      visit(ast.object);
      if (ast.computed) visit(ast.property);
      return;
    }
    for (const child of Object.values(ast)) {
      if (Array.isArray(child))
        child.forEach((item) => {
          if (item && typeof item === 'object') visit(item);
        });
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(jsep(value.source) as Ast);
}
const forbidden = forbiddenObjectKeySet;
const binaryOps = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '===',
  '!==',
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  '&&',
  '||',
  '??',
]);
const unaryOps = new Set(['!', '+', '-']);
const math = Object.freeze({
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
});
const globals: Record<string, unknown> = Object.freeze({ Math: math, Number, String });
const allowedFunctions = new Set<unknown>([...Object.values(math), Number, String]);
const expressionCache = new Map<string, CompiledValue>();

export function readProperty(object: unknown, key: unknown): unknown {
  if (typeof key !== 'string' && typeof key !== 'number')
    throw new Error('属性名必须是字符串或数字');
  if (forbidden.has(String(key))) throw new Error(`不允许访问属性 ${String(key)}`);
  if (object === null || object === undefined) throw new Error(`无法读取空值的 ${String(key)}`);
  return (Object(object) as Record<string, unknown>)[String(key)];
}

function rootStateRef(node: Ast): string | undefined {
  if (node.type !== 'MemberExpression') return undefined;
  if (
    node.object.type === 'Identifier' &&
    ['state', 'forms', 'sources'].includes(node.object.name)
  ) {
    const id = node.computed
      ? node.property.type === 'Literal'
        ? String(node.property.value)
        : '*'
      : node.property.name;
    if (node.object.name === 'sources') return `@source:${id}`;
    return id === '*' ? '*' : node.object.name === 'forms' ? `@form:${id}` : id;
  }
  return rootStateRef(node.object);
}

function inspect(
  node: Ast,
  dependencies: Set<string>,
  event: { used: boolean; scope: boolean; sources: boolean },
): void {
  switch (node.type) {
    case 'Literal':
      return;
    case 'Identifier':
      if (
        !['state', 'forms', 'sources', 'scope', 'event', ...Object.keys(globals)].includes(
          node.name,
        )
      )
        throw new Error(`未知变量 ${node.name}；使用 state、scope 或 event`);
      if (node.name === 'event') event.used = true;
      if (node.name === 'scope') event.scope = true;
      if (node.name === 'sources') {
        event.sources = true;
        dependencies.add('@source:*');
      }
      if (node.name === 'state' || node.name === 'forms') dependencies.add('*');
      return;
    case 'MemberExpression': {
      const ref = rootStateRef(node);
      if (ref) dependencies.add(ref);
      if (ref?.startsWith('@source:')) event.sources = true;
      // Inspect a direct state member without turning a precise reference into a wildcard.
      if (!(
        node.object.type === 'Identifier' &&
        ['state', 'forms', 'sources'].includes(node.object.name)
      ))
        inspect(node.object, dependencies, event);
      if (node.computed) {
        if (node.property.type === 'Literal' && forbidden.has(String(node.property.value)))
          throw new Error(`不允许访问属性 ${String(node.property.value)}`);
        inspect(node.property, dependencies, event);
      } else if (forbidden.has(node.property.name))
        throw new Error(`不允许访问属性 ${node.property.name}`);
      return;
    }
    case 'BinaryExpression':
      if (!binaryOps.has(node.operator)) throw new Error(`不支持运算符 ${node.operator}`);
      inspect(node.left, dependencies, event);
      inspect(node.right, dependencies, event);
      return;
    case 'UnaryExpression':
      if (!unaryOps.has(node.operator)) throw new Error(`不支持运算符 ${node.operator}`);
      inspect(node.argument, dependencies, event);
      return;
    case 'ConditionalExpression':
      inspect(node.test, dependencies, event);
      inspect(node.consequent, dependencies, event);
      inspect(node.alternate, dependencies, event);
      return;
    case 'ArrayExpression':
      node.elements.forEach((item: Ast) => {
        if (item) inspect(item, dependencies, event);
      });
      return;
    case 'CallExpression': {
      const c = node.callee;
      const valid =
        (c.type === 'Identifier' && ['Number', 'String'].includes(c.name)) ||
        (c.type === 'MemberExpression' &&
          !c.computed &&
          c.object.type === 'Identifier' &&
          c.object.name === 'Math' &&
          Object.hasOwn(math, c.property.name));
      if (!valid)
        throw new Error(
          '表达式只允许调用 Number、String 和已注册的 Math 纯函数；业务逻辑使用动作或 TSX 组件',
        );
      inspect(c, dependencies, event);
      node.arguments.forEach((arg: Ast) => inspect(arg, dependencies, event));
      return;
    }
    default:
      throw new Error(`不支持语法 ${node.type}；表达式仅用于读取和计算`);
  }
}

function evaluate(node: Ast, ctx: EvaluationContext): any {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      if (node.name === 'forms') return ctx.forms;
      if (node.name === 'sources') return ctx.sources;
      return node.name === 'state'
        ? ctx.state
        : node.name === 'scope'
          ? ctx.scope
          : node.name === 'event'
            ? ctx.event
            : globals[node.name];
    case 'MemberExpression':
      return readProperty(
        evaluate(node.object, ctx),
        node.computed ? evaluate(node.property, ctx) : node.property.name,
      );
    case 'ArrayExpression':
      return node.elements.map((item: Ast) => (item ? evaluate(item, ctx) : null));
    case 'ConditionalExpression':
      return evaluate(node.test, ctx)
        ? evaluate(node.consequent, ctx)
        : evaluate(node.alternate, ctx);
    case 'UnaryExpression': {
      const v = evaluate(node.argument, ctx);
      return node.operator === '!' ? !v : node.operator === '+' ? +v : -v;
    }
    case 'CallExpression': {
      const fn = evaluate(node.callee, ctx);
      if (!allowedFunctions.has(fn)) throw new Error('未注册的表达式函数');
      return fn(...node.arguments.map((arg: Ast) => evaluate(arg, ctx)));
    }
    case 'BinaryExpression': {
      const left = evaluate(node.left, ctx);
      if (node.operator === '&&') return left && evaluate(node.right, ctx);
      if (node.operator === '||') return left || evaluate(node.right, ctx);
      if (node.operator === '??') return left ?? evaluate(node.right, ctx);
      const right = evaluate(node.right, ctx);
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        case '**':
          return left ** right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '==':
          return left == right;
        case '!=':
          return left != right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
      }
    }
  }
  throw new Error('无法执行表达式');
}

export function compileValue(value: Value): CompiledValue {
  if (value.kind === 'literal')
    return {
      evaluate: () => value.value,
      dependencies: [],
      usesEvent: false,
      usesScope: false,
      usesSources: false,
    };
  if (value.kind === 'fieldRef' || value.kind === 'formValues')
    return {
      evaluate: (ctx) =>
        value.kind === 'formValues'
          ? ctx.formValues!(value.formId)
          : readProperty(
              readProperty(
                readProperty(readProperty(ctx.forms, value.formId), 'fields'),
                value.fieldId,
              ),
              'value',
            ),
      dependencies: [`@form:${value.formId}`],
      usesEvent: false,
      usesScope: false,
      usesSources: false,
    };
  if (value.kind === 'stateRef')
    return {
      evaluate: (ctx) =>
        (value.path ?? []).reduce<unknown>(readProperty, readProperty(ctx.state, value.stateId)),
      dependencies: [value.stateId],
      usesEvent: false,
      usesScope: false,
      usesSources: false,
    };
  if (value.kind === 'dataRef')
    return {
      evaluate: (ctx) =>
        (value.path ?? []).reduce<unknown>(
          readProperty,
          readProperty(readProperty(ctx.sources, value.sourceId), 'data'),
        ),
      dependencies: [`@source:${value.sourceId}`],
      usesEvent: false,
      usesScope: false,
      usesSources: true,
    };
  if (value.language !== 'javascript') throw new Error('不支持的表达式语言');
  const cached = expressionCache.get(value.source);
  if (cached) return cached;
  const ast = jsep(value.source) as Ast;
  const dependencies = new Set<string>();
  const event = { used: false, scope: false, sources: false };
  inspect(ast, dependencies, event);
  const compiled = {
    evaluate: (ctx: EvaluationContext) => evaluate(ast, ctx),
    dependencies: [...dependencies],
    usesEvent: event.used,
    usesScope: event.scope,
    usesSources: event.sources,
  };
  // Bound the shared syntax cache. Context and evaluated results are never cached here.
  if (expressionCache.size >= 500) expressionCache.delete(expressionCache.keys().next().value!);
  expressionCache.set(value.source, compiled);
  return compiled;
}
