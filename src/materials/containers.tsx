import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
  type CSSProperties,
  type FormHTMLAttributes,
} from 'react';
import { Tabs } from '@base-ui/react/tabs';
import {
  useDesignMode,
  useHasSlot,
  useMaterialNode,
  type SlotRenderers,
} from '../../packages/react-runtime/Renderer';
import { Button } from '../ui/primitives';
import {
  useMaterialValue,
  textProp,
  boolProp,
  numberProp,
  requiredText,
  enumErrors,
  type Contracts,
} from './shared';

export function LayoutMaterial({
  variant = 'stack',
  gap,
  padding,
  columns = 2,
  align = 'stretch',
  justify = 'start',
  wrap = true,
  maxHeight,
  scroll = false,
  children,
  style: nodeStyle,
}: {
  style?: CSSProperties;
  variant?: string;
  gap?: number;
  padding?: number;
  columns?: number;
  align?: string;
  justify?: string;
  wrap?: boolean;
  maxHeight?: number;
  scroll?: boolean;
  children?: ReactNode;
}) {
  const style: CSSProperties = {
    rowGap: gap,
    columnGap: gap,
    paddingTop: padding,
    paddingRight: padding,
    paddingBottom: padding,
    paddingLeft: padding,
    alignItems: align,
    justifyContent: justify,
    flexWrap: wrap ? 'wrap' : 'nowrap',
    ...(variant === 'grid'
      ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
      : {}),
    ...(scroll ? { overflow: 'auto', maxHeight: maxHeight ?? 320 } : {}),
  };
  return (
    <div className={`material-layout ${variant}`} style={{ ...style, ...nodeStyle }}>
      {children}
    </div>
  );
}
export function FormMaterial({
  children,
  labelLayout = 'top',
  labelWidth = 100,
  columns = 1,
  gap = 16,
  readOnly = false,
  showErrors = true,
  ...props
}: FormHTMLAttributes<HTMLFormElement> & {
  labelLayout?: 'top' | 'left';
  labelWidth?: number;
  columns?: number;
  gap?: number;
  readOnly?: boolean;
  showErrors?: boolean;
}) {
  const [errors, setErrors] = useState<{ id: string; text: string }[]>([]);
  const design = useDesignMode();
  const collect = (form: HTMLFormElement) => {
    const messages = [...form.querySelectorAll<HTMLElement>('.field-error[role="alert"]')].filter(
      (item) => item.textContent?.trim() && !item.closest('[hidden]'),
    );
    const next = messages.map((item, index) => ({
      id: item.id || `error-${index}`,
      text: item.textContent!,
    }));
    setErrors((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  };
  const formId = useId();
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form || !showErrors) return;
    const observer = new MutationObserver(() => collect(form));
    collect(form);
    observer.observe(form, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [showErrors, formId]);
  return (
    <form
      {...props}
      id={formId}
      className={`material-form labels-${labelLayout}`}
      style={
        {
          '--field-label-width': `${labelWidth}px`,
          '--form-columns': columns,
          rowGap: gap,
          columnGap: gap,
          ...props.style,
        } as CSSProperties
      }
    >
      {showErrors && errors.length > 0 && !design && (
        <div className="material-error-summary" role="region" aria-label="表单错误汇总">
          <strong>有 {errors.length} 项需要处理</strong>
          <ul>
            {errors.map((error, index) => (
              <li key={error.id}>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const messages = [
                      ...document
                        .getElementById(formId)!
                        .querySelectorAll<HTMLElement>('.field-error[role="alert"]'),
                    ];
                    const message = messages[index];
                    const container = message?.closest('.material-field, .material-field-array');
                    container?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
                    container
                      ?.querySelector<HTMLElement>(
                        'input:not([type="hidden"]), textarea, [role="combobox"], [role="radio"], [role="checkbox"]',
                      )
                      ?.focus();
                  }}
                >
                  {error.text}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <fieldset className="material-form-fields" disabled={readOnly && !design}>
        {children}
      </fieldset>
    </form>
  );
}
export function CardMaterial({
  title,
  description,
  children,
  slots = {},
  style,
}: {
  style?: CSSProperties;
  title?: string;
  description?: string;
  children?: ReactNode;
  slots?: SlotRenderers;
}) {
  const footer = useHasSlot('footer', slots),
    design = useDesignMode();
  return (
    <section className="material-card material-generic-card" style={style}>
      {(title || description) && (
        <header>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </header>
      )}
      {slots.header?.({})}
      <div className="material-card-content">{children}</div>
      {(footer || (design && slots.footer)) && <footer>{slots.footer?.({})}</footer>}
    </section>
  );
}
export function DividerMaterial({
  label,
  orientation = 'horizontal',
  style,
}: {
  style?: CSSProperties;
  label?: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <div
      className={`material-divider ${orientation}`}
      style={style}
      role="separator"
      aria-orientation={orientation}
    >
      {label && <span>{label}</span>}
    </div>
  );
}

type TabInfo = { id: string; nodeId?: string; value: string; label: string; disabled: boolean };
const TabContext = createContext<{ register: (tab: TabInfo) => () => void } | null>(null);
export function TabsMaterial({
  value = '',
  onValueChange,
  children,
  label = '标签页',
  style,
}: {
  style?: CSSProperties;
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  label?: string;
}) {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [selected, change] = useMaterialValue(value, onValueChange);
  const design = useDesignMode();
  const register = useCallback((tab: TabInfo) => {
    setTabs((items) => [...items.filter((i) => i.id !== tab.id), tab]);
    return () => setTabs((items) => items.filter((i) => i.id !== tab.id));
  }, []);
  const context = useMemo(() => ({ register }), [register]);
  const schema = useMaterialNode();
  const order: string[] = [];
  const visit = (nodes: NonNullable<typeof schema>['children'] = []) => {
    for (const child of nodes) {
      if (child.component === 'ui.tabs') continue;
      if (child.component === 'ui.tabPanel') order.push(child.id);
      else {
        visit(child.children);
        for (const slot of Object.values(child.slots ?? {})) visit(slot.children);
      }
    }
  };
  visit(schema?.children);
  const ordered = schema
    ? [...tabs].sort((a, b) => order.indexOf(a.nodeId ?? '') - order.indexOf(b.nodeId ?? ''))
    : tabs;
  if (new Set(tabs.map((tab) => tab.value)).size !== tabs.length)
    throw new Error('标签页面板的页面值不能重复');
  const active = ordered.some((t) => t.value === selected && !t.disabled)
    ? selected
    : (ordered.find((t) => !t.disabled)?.value ?? null);
  return (
    <TabContext.Provider value={context}>
      <Tabs.Root
        style={style}
        value={active}
        onValueChange={(next) => change(next ?? '')}
        className={`material-tabs ${design ? 'design' : ''}`}
      >
        <Tabs.List aria-label={label} className="material-tab-list">
          {ordered.map((tab) => (
            <Tabs.Tab key={tab.id} value={tab.value} disabled={tab.disabled}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {!tabs.length && <p className="material-placeholder">拖入“标签页面板”创建内容页</p>}
        {children}
      </Tabs.Root>
    </TabContext.Provider>
  );
}
export function TabPanelMaterial({
  value,
  label,
  disabled = false,
  children,
  style,
}: {
  style?: CSSProperties;
  value: string;
  label: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const context = useContext(TabContext),
    id = useId(),
    design = useDesignMode();
  const effectiveValue = value || id,
    nodeId = useMaterialNode()?.id;
  useEffect(
    () => context?.register({ id, nodeId, value: effectiveValue, label, disabled }),
    [context, id, nodeId, effectiveValue, label, disabled],
  );
  if (!context)
    return (
      <section className="material-tab-panel" style={style}>
        <strong>{label}</strong>
        <p className="material-placeholder">请放入标签页容器</p>
        {children}
      </section>
    );
  return (
    <Tabs.Panel
      value={effectiveValue}
      keepMounted
      className="material-tab-panel"
      style={style}
      {...(design ? { hidden: false } : {})}
    >
      {design && (
        <header className="material-design-heading">
          {label}
          {disabled ? ' · 已禁用' : ''}
        </header>
      )}
      {children}
    </Tabs.Panel>
  );
}
export const containerContracts: Contracts = {
  'ui.layout': {
    version: '1.0.0',
    children: true,
    props: {
      variant: textProp,
      gap: numberProp,
      padding: numberProp,
      columns: numberProp,
      align: textProp,
      justify: textProp,
      wrap: boolProp,
      scroll: boolProp,
      maxHeight: numberProp,
    },
    validateProps: (props) => [
      ...enumErrors(props, {
        variant: ['stack', 'row', 'grid2', 'search', 'grid'],
        align: ['stretch', 'start', 'center', 'end'],
        justify: ['start', 'center', 'end', 'space-between'],
      }),
      ...['gap', 'padding', 'maxHeight'].flatMap((key) =>
        key in props && (Number(props[key]) < 0 || Number(props[key]) > 2000)
          ? [`${key} 必须在 0 到 2000 之间`]
          : [],
      ),
      ...('columns' in props &&
      (!Number.isInteger(props.columns) || Number(props.columns) < 1 || Number(props.columns) > 12)
        ? ['列数必须为 1 到 12 的整数']
        : []),
    ],
  },
  'ui.form': {
    version: '1.0.0',
    form: true,
    children: true,
    props: {
      labelLayout: textProp,
      labelWidth: numberProp,
      columns: numberProp,
      gap: numberProp,
      readOnly: boolProp,
      showErrors: boolProp,
    },
    events: ['onSubmit', 'onReset'],
    validateProps: (props) => [
      ...enumErrors(props, { labelLayout: ['top', 'left'] }),
      ...('columns' in props &&
      (!Number.isInteger(props.columns) || Number(props.columns) < 1 || Number(props.columns) > 4)
        ? ['表单列数必须为 1 到 4']
        : []),
      ...['labelWidth', 'gap'].flatMap((key) =>
        key in props && (Number(props[key]) < 0 || Number(props[key]) > 400)
          ? [`${key} 必须在 0 到 400 之间`]
          : [],
      ),
    ],
  },
  'ui.card': {
    version: '1.0.0',
    children: true,
    slots: { header: [], footer: [] },
    props: { title: textProp, description: textProp },
  },
  'ui.divider': {
    version: '1.0.0',
    props: { label: textProp, orientation: textProp },
    validateProps: (props) => enumErrors(props, { orientation: ['horizontal', 'vertical'] }),
  },
  'ui.tabs': {
    version: '1.0.0',
    children: true,
    props: { value: textProp, label: textProp },
    events: ['onValueChange'],
  },
  'ui.tabPanel': {
    version: '1.0.0',
    children: true,
    props: { value: requiredText, label: requiredText, disabled: boolProp },
  },
};
