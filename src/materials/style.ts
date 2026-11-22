import type { CSSProperties } from 'react';
import type { ComponentContract } from '../../packages/runtime/registry';
import {
  styleProperties,
  type StyleCapability,
  type StyleProperty,
} from '../../packages/schema/style';

export const textStyleProperties = [
  'color',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
] as const;
export function textStyle(style?: CSSProperties): CSSProperties | undefined {
  if (!style) return;
  return Object.fromEntries(
    textStyleProperties.filter((key) => style[key] !== undefined).map((key) => [key, style[key]]),
  );
}
const box = styleProperties.filter(
  (key) => !(textStyleProperties as readonly StyleProperty[]).includes(key),
);
const targets: Record<string, { target: StyleCapability['target']; text?: boolean }> = {
  'ui.heading': { target: 'root', text: true },
  'ui.text': { target: 'root', text: true },
  'ui.input': { target: 'field', text: true },
  'ui.number': { target: 'field', text: true },
  'ui.select': { target: 'field', text: true },
  'ui.checkbox': { target: 'field', text: true },
  'ui.switch': { target: 'field', text: true },
  'ui.radioGroup': { target: 'field', text: true },
  'ui.checkboxGroup': { target: 'field', text: true },
  'ui.date': { target: 'field', text: true },
  'ui.time': { target: 'field', text: true },
  'ui.button': { target: 'root', text: true },
  'ui.badge': { target: 'root', text: true },
  'ui.link': { target: 'root', text: true },
  'ui.empty': { target: 'root', text: true },
  'ui.layout': { target: 'root' },
  'ui.form': { target: 'root' },
  'ui.card': { target: 'root' },
  'ui.divider': { target: 'root' },
  'ui.tabs': { target: 'root' },
  'ui.tabPanel': { target: 'root' },
  'ui.fieldArray': { target: 'root' },
  'ui.image': { target: 'root' },
  'ui.descriptions': { target: 'root' },
  'ui.list': { target: 'root' },
  'ui.table': { target: 'root' },
  'ui.pagination': { target: 'root' },
  'ui.dialog': { target: 'popup' },
  'ui.drawer': { target: 'popup' },
  'ui.alert': { target: 'root' },
  'ui.loading': { target: 'root' },
};
/** Explicit per-material declarations; legacy/demo materials intentionally remain unsupported. */
export function withMaterialStyles(
  contracts: Record<string, ComponentContract>,
): Record<string, ComponentContract> {
  return Object.fromEntries(
    Object.entries(contracts).map(([id, contract]) => [
      id,
      targets[id]
        ? {
            ...contract,
            style: {
              target: targets[id].target,
              source: true,
              properties: [...(targets[id].text ? styleProperties : box)],
            },
          }
        : contract,
    ]),
  );
}
