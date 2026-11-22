/** Framework-neutral subset of React/CSS style values supported by schema 0.1. */
const size = ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'] as const;
const margin = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'] as const;
const spacing = [
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gap',
  'rowGap',
  'columnGap',
] as const;
export const styleProperties = [
  ...size,
  ...margin,
  ...spacing,
  'display',
  'flexDirection',
  'flexWrap',
  'alignItems',
  'justifyContent',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'color',
  'backgroundColor',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'borderRadius',
  'boxShadow',
] as const;
export type StyleProperty = (typeof styleProperties)[number];
export type ResolvedStyle = Partial<Record<StyleProperty, string | number>>;
export interface StyleCapability {
  /** Human-readable semantic target; it is not a selector or executable adapter. */
  target: 'root' | 'field' | 'popup';
  properties: readonly StyleProperty[];
  /** 物料已将组件 CSS 锚点绑定到实际样式目标。 */
  source?: boolean;
}
const enums: Partial<Record<StyleProperty, readonly string[]>> = {
  display: [
    'block',
    'inline',
    'inline-block',
    'flex',
    'inline-flex',
    'grid',
    'inline-grid',
    'none',
    'contents',
    'flow-root',
  ],
  flexDirection: ['row', 'row-reverse', 'column', 'column-reverse'],
  flexWrap: ['nowrap', 'wrap', 'wrap-reverse'],
  alignItems: ['normal', 'stretch', 'start', 'end', 'center', 'baseline', 'flex-start', 'flex-end'],
  justifyContent: [
    'normal',
    'stretch',
    'start',
    'end',
    'center',
    'space-between',
    'space-around',
    'space-evenly',
    'flex-start',
    'flex-end',
  ],
  textAlign: ['left', 'right', 'center', 'justify', 'start', 'end'],
};
/** Inspector choices share the same domain as validation. */
export function styleChoices(key: StyleProperty): readonly string[] | undefined {
  const choices = enums[key];
  return choices && Object.freeze([...choices]);
}
const names = new Set<string>(styleProperties);
const colors = new Set([
  'transparent',
  'currentColor',
  'black',
  'white',
  'red',
  'green',
  'blue',
  'gray',
  'grey',
  'silver',
  'yellow',
  'orange',
  'purple',
  'pink',
  'brown',
  'cyan',
  'magenta',
  'navy',
  'teal',
  'olive',
  'maroon',
  'lime',
  'aqua',
  'fuchsia',
  'rebeccapurple',
]);
export function isStyleProperty(key: string): key is StyleProperty {
  return names.has(key);
}
export function styleValueTypes(key: StyleProperty): readonly ('string' | 'number')[] {
  return enums[key] || key === 'color' || key === 'backgroundColor'
    ? ['string']
    : key === 'flexGrow' || key === 'flexShrink'
      ? ['number']
      : key === 'boxShadow'
        ? ['string']
        : ['string', 'number'];
}
function length(value: unknown, negative: boolean) {
  if (typeof value === 'number') return Number.isFinite(value) && (negative || value >= 0);
  if (typeof value !== 'string') return false;
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%|rem|em|vw|vh)$/.exec(value);
  return (
    value === '0' ||
    (!!match && Number.isFinite(Number(match[1])) && (negative || Number(match[1]) >= 0))
  );
}
const shadowColorPattern = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/;
const shadowFunctionPattern = /^(?:rgba?|hsla?)\(\s*[\d.,%\s/]+\)$/i;
const shadowTokenPattern = /^inset$|^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|%|rem|em|vw|vh)?$/;
function shadow(value: string) {
  return value
    .trim()
    .split(',')
    .every((part) => {
      const tokens = part.trim().split(/\s+/);
      return (
        tokens.length >= 2 &&
        tokens.every(
          (token) =>
            token === 'inset' ||
            token === 'none' ||
            colors.has(token) ||
            shadowColorPattern.test(token) ||
            shadowFunctionPattern.test(token) ||
            shadowTokenPattern.test(token),
        )
      );
    });
}
/** Returns a user-facing domain error; never evaluates CSS or accesses the DOM. */
export function styleValueError(key: StyleProperty, value: unknown): string | undefined {
  const choices = enums[key];
  if (choices)
    return typeof value === 'string' && choices.includes(value)
      ? undefined
      : `${key} 需要 ${choices.join(' / ')}`;
  if (key === 'color' || key === 'backgroundColor')
    return typeof value === 'string' &&
      (colors.has(value) ||
        /^#(?:[\da-fA-F]{3}|[\da-fA-F]{4}|[\da-fA-F]{6}|[\da-fA-F]{8})$/.test(value))
      ? undefined
      : `${key} 需要受支持的颜色名或十六进制颜色`;
  if (key === 'flexGrow' || key === 'flexShrink')
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? undefined
      : `${key} 需要非负有限数字`;
  if (key === 'fontWeight')
    return value === 'normal' ||
      value === 'bold' ||
      (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000)
      ? undefined
      : 'fontWeight 需要 normal、bold 或 1–1000 的整数';
  if (key === 'lineHeight' && value === 'normal') return;
  if (key === 'borderRadius')
    return length(value, false) || value === '50%'
      ? undefined
      : 'borderRadius 需要非负数字或 px/%/rem/em/vw/vh 长度';
  if (key === 'boxShadow')
    return typeof value === 'string' && (value === 'none' || shadow(value))
      ? undefined
      : 'boxShadow 需要 none 或由长度、inset 与颜色组成的阴影值';
  const isMargin = (margin as readonly string[]).includes(key);
  const auto =
    isMargin ||
    key === 'width' ||
    key === 'height' ||
    key === 'minWidth' ||
    key === 'minHeight' ||
    key === 'flexBasis';
  if (
    (value === 'auto' && auto) ||
    (value === 'none' && (key === 'maxWidth' || key === 'maxHeight'))
  )
    return;
  return length(value, isMargin)
    ? undefined
    : `${key} 需要${isMargin ? '' : '非负'}数字或 px/%/rem/em/vw/vh 长度${auto ? '（可用 auto）' : ''}`;
}
