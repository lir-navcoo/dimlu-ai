import { list, parse, type Declaration, type Rule } from 'postcss';
import { styleProperties, styleValueError, type StyleProperty } from './style';
import type { NodeSchema, Value } from './types';

export const STYLE_SOURCE_LIMIT = 12000;
const selector = /^:root(?::(?:hover|focus|focus-visible|focus-within|active))?$/;
const localProperties = new Set([
  'margin',
  'padding',
  'background',
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
  'background-clip',
  'background-origin',
  'border',
  'border-radius',
  'border-style',
  'border-width',
  'border-color',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-top-style',
  'border-right-style',
  'border-bottom-style',
  'border-left-style',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'outline',
  'outline-width',
  'outline-style',
  'outline-color',
  'outline-offset',
  'box-shadow',
  'text-shadow',
  'box-sizing',
  'overflow',
  'overflow-x',
  'overflow-y',
  'opacity',
  'filter',
  'cursor',
  'font',
  'font-family',
  'font-style',
  'font-variant',
  'letter-spacing',
  'word-spacing',
  'white-space',
  'overflow-wrap',
  'word-break',
  'text-decoration',
  'text-decoration-line',
  'text-decoration-color',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-overflow',
  'text-transform',
  'transition',
  'transition-property',
  'transition-duration',
  'transition-delay',
  'transition-timing-function',
  'transform',
  'transform-origin',
  'translate',
  'rotate',
  'scale',
  'user-select',
  'visibility',
  'flex',
  'order',
  'align-self',
  'justify-self',
  'align-content',
  'justify-items',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-columns',
  'grid-auto-rows',
  'grid-auto-flow',
  'grid-column',
  'grid-column-start',
  'grid-column-end',
  'grid-row',
  'grid-row-start',
  'grid-row-end',
]);
const cssFunctions = new Set([
  'calc',
  'min',
  'max',
  'clamp',
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'light-dark',
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'repeat',
  'minmax',
  'fit-content',
  'cubic-bezier',
  'steps',
  'linear',
  'matrix',
  'matrix3d',
  'translate',
  'translatex',
  'translatey',
  'translatez',
  'translate3d',
  'scale',
  'scalex',
  'scaley',
  'scalez',
  'scale3d',
  'rotate',
  'rotatex',
  'rotatey',
  'rotatez',
  'rotate3d',
  'skew',
  'skewx',
  'skewy',
  'perspective',
  'blur',
  'brightness',
  'contrast',
  'drop-shadow',
  'grayscale',
  'hue-rotate',
  'invert',
  'opacity',
  'saturate',
  'sepia',
]);
const cssNames = Object.fromEntries(
  styleProperties.map((key) => [key, key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)]),
) as Record<StyleProperty, string>;
for (const name of Object.values(cssNames)) localProperties.add(name);
const unitless = new Set<StyleProperty>(['flexGrow', 'flexShrink', 'fontWeight', 'lineHeight']);
const numeric = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const defaultBlock = ':root {\n}';

function assertLocalValue(value: string) {
  // 约束重新序列化的值，避免 CSS 转义、注释或未闭合结构改变分词。
  if (/[\\;{}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|\/\*/.test(value))
    throw new Error('CSS 值中不能包含转义、注释、控制字符或声明分隔符');
  const tokens = /"[^"\r\n]*"|'[^'\r\n]*'|[-\w]+\(|[\[\]()'"]/g;
  let depth = 0;
  for (const [token] of value.matchAll(tokens)) {
    if (token === ')') depth--;
    else if (token.endsWith('(')) {
      const name = token.slice(0, -1).toLowerCase();
      if (!cssFunctions.has(name))
        throw new Error(`不支持 CSS 函数 ${name || '('}，组件样式不能加载外部资源`);
      depth++;
    } else if (token.length === 1) throw new Error('CSS 值包含未闭合的引号或不支持的符号');
    if (depth < 0) throw new Error('CSS 值的括号不匹配');
  }
  if (depth !== 0) throw new Error('CSS 值的括号不匹配');
}

type StyleValues = NonNullable<NodeSchema['style']>;
function parseSource(source: string) {
  if (source.length > STYLE_SOURCE_LIMIT) throw new Error('CSS 源码最多 12,000 个字符');
  const root = parse(source);
  for (const node of root.nodes) {
    if (node.type === 'comment') continue;
    if (node.type !== 'rule' || !selector.test(node.selector))
      throw new Error('CSS 选择器须为 :root 或受支持的根节点状态（如 :root:hover）');
    for (const entry of node.nodes) {
      if (entry.type === 'comment') continue;
      if (entry.type !== 'decl' || !entry.value.trim())
        throw new Error('规则块内只支持有效的 CSS 属性声明');
      // 自定义属性可能通过继承改写物料内部变量或宿主的层叠规则。
      if (!localProperties.has(propertyName(entry.prop)))
        throw new Error(`组件源码不支持 CSS 属性 ${entry.prop}`);
      assertLocalValue(entry.value);
    }
  }
  return root;
}
export function assertStyleSource(source: string) {
  parseSource(source);
}

function propertyName(name: string) {
  return name.startsWith('--') ? name : name.toLowerCase();
}
function literalCss(key: StyleProperty, value: string | number) {
  return typeof value === 'number' && value !== 0 && !unitless.has(key)
    ? `${value}px`
    : String(value);
}
function rootRules(root: ReturnType<typeof parseSource>): Rule[] {
  return root.nodes.filter(
    (node): node is Rule => node.type === 'rule' && node.selector === ':root',
  );
}
function expandSpacing(declaration: Declaration) {
  const prop = propertyName(declaration.prop);
  if (prop !== 'margin' && prop !== 'padding' && prop !== 'gap') return;
  const parts = list.space(declaration.value);
  if (!parts.length || parts.length > (prop === 'gap' ? 2 : 4)) return;
  const [top, right = top, bottom = top, left = right] = parts;
  if (prop === 'gap') return { 'row-gap': top, 'column-gap': right };
  return {
    [`${prop}-top`]: top,
    [`${prop}-right`]: right,
    [`${prop}-bottom`]: bottom,
    [`${prop}-left`]: left,
  };
}
function rootValues(root: ReturnType<typeof parseSource>) {
  const values = new Map<string, { value: string; important: boolean }>();
  const set = (prop: string, value: string, important = false) => {
    if (important || !values.get(prop)?.important) values.set(prop, { value, important });
  };
  for (const rule of rootRules(root))
    for (const node of rule.nodes) {
      if (node.type !== 'decl') continue;
      set(propertyName(node.prop), node.value, node.important);
      for (const [prop, value] of Object.entries(expandSpacing(node) ?? {}))
        set(prop, value, node.important);
    }
  return values;
}

export function formatStyleSource(node: Pick<NodeSchema, 'style' | 'styleCss'>) {
  if (node.styleCss !== undefined) return node.styleCss;
  const initial = styleProperties.flatMap((key) => {
    const value = node.style?.[key];
    return value?.kind === 'literal'
      ? [`  ${cssNames[key]}: ${literalCss(key, value.value as string | number)};\n`]
      : [];
  });
  return `:root {\n${initial.join('')}}`;
}

export function applyStyleSource(
  source: string,
  properties: readonly StyleProperty[],
  before?: StyleValues,
) {
  const root = parseSource(source);
  const values = rootValues(root);
  const style: StyleValues = {};
  for (const key of properties) {
    const existing = before?.[key];
    const declaration = values.get(cssNames[key]);
    if (!declaration) {
      if (existing && existing.kind !== 'literal') style[key] = existing;
      continue;
    }
    const { value } = declaration;
    if (
      existing?.kind === 'literal' &&
      literalCss(key, existing.value as string | number) === value
    ) {
      style[key] = existing;
      continue;
    }
    const candidate =
      numeric.test(value) && (unitless.has(key) || Number(value) === 0) ? Number(value) : value;
    if (!styleValueError(key, candidate)) style[key] = { kind: 'literal', value: candidate };
  }
  const text = source.trim();
  return { style, css: text && text !== defaultBlock ? text : undefined };
}

export function patchStyleSource(
  source: string,
  patch: Partial<Record<StyleProperty, Value | undefined>>,
) {
  const root = parseSource(source);
  for (const [name, value] of Object.entries(patch)) {
    const key = name as StyleProperty;
    const prop = cssNames[key];
    if (!prop) continue;
    for (const rule of rootRules(root)) {
      for (const entry of [...rule.nodes]) {
        if (entry.type !== 'decl') continue;
        const entryProp = propertyName(entry.prop);
        if (
          entryProp === prop ||
          (prop === 'gap' &&
            value?.kind === 'literal' &&
            (entryProp === 'row-gap' || entryProp === 'column-gap'))
        ) {
          entry.remove();
          continue;
        }
        const expanded = expandSpacing(entry);
        if (expanded && prop in expanded) {
          for (const [longhand, next] of Object.entries(expanded)) {
            if (longhand !== prop) entry.cloneBefore({ prop: longhand, value: next });
          }
          entry.remove();
        }
      }
    }
    if (value?.kind !== 'literal') continue;
    let lastRule = rootRules(root).at(-1);
    if (!lastRule) {
      root.append({ selector: ':root', nodes: [] });
      lastRule = rootRules(root).at(-1)!;
    }
    lastRule.append({ prop, value: literalCss(key, value.value as string | number) });
    lastRule.raws.semicolon = true;
  }
  for (const rule of rootRules(root)) if (!rule.nodes.length) rule.remove();
  return root.toString().trim() || undefined;
}

/** 仅生成带运行时属性标记的选择器，源码选择器绝不直接写入文档。 */
export function scopeStyleSource(source: string, attribute: string) {
  const root = parseSource(source);
  return root.nodes
    .flatMap((rule) => {
      if (rule.type !== 'rule') return [];
      // 关闭弹层和隐藏标签由物料控制。用零特异性的条件保留源码内部的层叠顺序。
      const target = `${attribute}:where(:not([hidden], [data-closed]))${rule.selector.slice(':root'.length)}`;
      const scopeRule = (important: boolean) => {
        const declarations = rule.nodes.flatMap((node) => {
          if (node.type !== 'decl' || !!node.important !== important) return [];
          // 样式源码覆盖物料默认内联样式，源码中的 !important 继续具有较高优先级。
          return [`${node.prop}: ${node.value} !important;`];
        });
        return declarations.length
          ? [`${important ? attribute.repeat(2) : ''}${target} { ${declarations.join(' ')} }`]
          : [];
      };
      return [...scopeRule(false), ...scopeRule(true)];
    })
    .join('\n');
}
