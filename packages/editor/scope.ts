import jsep from 'jsep';
import type { NodeSchema, PageSchema, Value } from '../schema/types';
import type { InsertTarget } from './document';
import { valueScopeReads } from '../runtime/expression';

type Providers = ReadonlyMap<string, string>;
type ScopedValue = { value: Value; providers: Providers };
/** Lexical environments mirror renderer ordering, including slot and repeat shadowing. */
function lexicalValues(page: PageSchema) {
  const values = new Map<string, ScopedValue>();
  const scopes = new Map<string, { outer: Providers; local: Providers }>();
  const visit = (nodes: NodeSchema[], outer: Providers) => {
    for (const node of nodes) {
      const record = (path: string, value: Value | undefined, providers: Providers) => {
        if (value) values.set(`${node.id}/${path}`, { value, providers });
      };
      record('repeat/items', node.repeat?.items, outer);
      const local = new Map(outer);
      if (node.repeat) {
        local.set(node.repeat.item, `repeat:${node.id}:item`);
        local.set(node.repeat.index ?? 'index', `repeat:${node.id}:index`);
      }
      scopes.set(node.id, { outer, local });
      record('repeat/key', node.repeat?.key, local);
      record('when', node.when, local);
      for (const [key, value] of Object.entries(node.props)) record(`props/${key}`, value, local);
      for (const [key, value] of Object.entries(node.style ?? {}))
        record(`style/${key}`, value, local);
      for (const [event, calls] of Object.entries(node.on ?? {}))
        for (const call of calls)
          for (const [key, value] of Object.entries(call.input))
            record(`on/${event}/${call.id}/input/${key}`, value, local);
      visit(node.children ?? [], local);
      for (const [name, slot] of Object.entries(node.slots ?? {})) {
        const slotScope = new Map(local);
        for (const param of slot.params) slotScope.set(param, `slot:${node.id}:${name}:${param}`);
        visit(slot.children, slotScope);
      }
    }
  };
  visit(page.children, new Map());
  return { values, scopes };
}
export function nodeLogicScopes(page: PageSchema, nodeId: string) {
  const scope = lexicalValues(page).scopes.get(nodeId);
  return { outer: [...(scope?.outer.keys() ?? [])], local: [...(scope?.local.keys() ?? [])] };
}
/** Reject semantic rebinding of retained expressions, even when a name still exists. */
export function assertLogicScope(before: PageSchema, after: PageSchema) {
  const original = lexicalValues(before).values;
  for (const [path, candidate] of lexicalValues(after).values) {
    const previous = original.get(path);
    if (!previous || JSON.stringify(previous.value) !== JSON.stringify(candidate.value)) continue;
    const reads = valueScopeReads(previous.value);
    const names = reads.wildcard
      ? new Set([...previous.providers.keys(), ...candidate.providers.keys()])
      : reads.names;
    for (const name of names)
      if (previous.providers.get(name) !== candidate.providers.get(name))
        throw new Error(`${path} 的 scope.${name} 来源将改变；请先调整依赖表达式`);
  }
}

const withRepeat = (node: NodeSchema, outer: Set<string>) =>
  new Set([...outer, ...(node.repeat ? [node.repeat.item, node.repeat.index ?? 'index'] : [])]);
const withSlot = (outer: Set<string>, params: string[]) => new Set([...outer, ...params]);

export function nodeScopeNames(page: PageSchema, nodeId: string): string[] {
  const visit = (nodes: NodeSchema[], outer: Set<string>): Set<string> | undefined => {
    for (const node of nodes) {
      const local = withRepeat(node, outer);
      if (node.id === nodeId) return local;
      const child = visit(node.children ?? [], local);
      if (child) return child;
      for (const slot of Object.values(node.slots ?? {})) {
        const found = visit(slot.children, withSlot(local, slot.params));
        if (found) return found;
      }
    }
  };
  return [...(visit(page.children, new Set()) ?? [])];
}

/** Newly authored expressions must use variables available at their actual node. */
export function assertActionScope(page: PageSchema, nodeId: string, values: Value[]) {
  const available = new Set(nodeScopeNames(page, nodeId));
  const visit = (ast: any) => {
    if (!ast || typeof ast !== 'object') return;
    if (
      ast.type === 'MemberExpression' &&
      ast.object?.type === 'Identifier' &&
      ast.object.name === 'scope'
    ) {
      const name = !ast.computed
        ? ast.property.name
        : ast.property.type === 'Literal'
          ? String(ast.property.value)
          : undefined;
      if (!name) throw new Error('作用域参数请使用明确的 scope.变量名');
      if (!available.has(name)) throw new Error(`当前组件缺少作用域 scope.${name}`);
      return;
    }
    for (const child of Object.values(ast))
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
  };
  for (const value of values) if (value.kind === 'expression') visit(jsep(value.source));
}

/** Preserve the scope names a subtree already uses when changing its parent. */
export function assertMoveScope(page: PageSchema, subtree: NodeSchema, target: InsertTarget) {
  const scopes = new Map<string, Set<string>>();
  const collect = (nodes: NodeSchema[], outer: Set<string>) => {
    for (const node of nodes) {
      scopes.set(node.id, outer);
      const local = withRepeat(node, outer);
      collect(node.children ?? [], local);
      for (const slot of Object.values(node.slots ?? {}))
        collect(slot.children, withSlot(local, slot.params));
    }
  };
  collect(page.children, new Set());
  let destination = new Set<string>();
  if (target.parentId) {
    const lookup = (nodes: NodeSchema[]): NodeSchema | undefined => {
      for (const node of nodes) {
        if (node.id === target.parentId) return node;
        const found = lookup([
          ...(node.children ?? []),
          ...Object.values(node.slots ?? {}).flatMap((slot) => slot.children),
        ]);
        if (found) return found;
      }
    };
    const parent = lookup(page.children)!;
    destination = withRepeat(parent, scopes.get(parent.id)!);
    if (target.slot !== undefined)
      destination = withSlot(destination, parent.slots?.[target.slot]?.params ?? []);
  }
  const check = (value: Value | undefined, before: Set<string>, after: Set<string>) => {
    if (value?.kind !== 'expression') return;
    const required = new Set<string>();
    const visit = (ast: any) => {
      if (!ast || typeof ast !== 'object') return;
      if (
        ast.type === 'MemberExpression' &&
        ast.object?.type === 'Identifier' &&
        ast.object.name === 'scope'
      ) {
        const key = !ast.computed
          ? ast.property.name
          : ast.property.type === 'Literal'
            ? String(ast.property.value)
            : '*';
        required.add(key);
        if (ast.computed) visit(ast.property);
        return;
      }
      if (ast.type === 'MemberExpression') {
        visit(ast.object);
        if (ast.computed) visit(ast.property);
        return;
      }
      if (ast.type === 'Identifier' && ast.name === 'scope') required.add('*');
      for (const child of Object.values(ast))
        if (Array.isArray(child)) child.forEach(visit);
        else if (child && typeof child === 'object') visit(child);
    };
    visit(jsep(value.source));
    for (const key of required.has('*') ? before : required)
      if (before.has(key) && !after.has(key))
        throw new Error(`移动后缺少作用域 scope.${key}；请选择提供该参数的容器或插槽`);
  };
  const walk = (node: NodeSchema, before: Set<string>, after: Set<string>) => {
    check(node.repeat?.items, before, after);
    const localBefore = withRepeat(node, before),
      localAfter = withRepeat(node, after);
    check(node.repeat?.key, localBefore, localAfter);
    check(node.when, localBefore, localAfter);
    for (const value of Object.values(node.props)) check(value, localBefore, localAfter);
    for (const value of Object.values(node.style ?? {})) check(value, localBefore, localAfter);
    for (const calls of Object.values(node.on ?? {}))
      for (const call of calls)
        for (const value of Object.values(call.input)) check(value, localBefore, localAfter);
    for (const child of node.children ?? []) walk(child, localBefore, localAfter);
    for (const slot of Object.values(node.slots ?? {}))
      for (const child of slot.children)
        walk(child, withSlot(localBefore, slot.params), withSlot(localAfter, slot.params));
  };
  walk(subtree, scopes.get(subtree.id)!, destination);
}
