import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { Popover } from '@base-ui/react/popover';
import { CalendarDays, Clock, X } from 'lucide-react';
import { Input, Button, Tip } from '../ui/primitives';
import {
  isDocumentNode,
  isDocumentElement,
  isDocumentInput,
  isLiveDocument,
  runtimePortalContainer,
  useRuntimeDomEnvironment,
} from '../ui/runtime-dom';
import { useDesignMode } from '../../packages/react-runtime/Renderer';
import { temporalError, validTemporal, type TemporalFormat } from '../../packages/schema/formats';
import { TemporalPicker } from './temporal-picker';
import { displayTemporal, normalizeDirect } from './temporal-helpers';
import {
  FieldFrame,
  useMaterialValue,
  requiredText,
  textProp,
  boolProp,
  jsonProp,
  enumErrors,
  type Contracts,
  type FieldPresentation,
} from './shared';
import './temporal.css';

export type TemporalValue = string | string[];
type PickerSession = { token: number; origin: string; index: number; inputFocus: boolean };

export function DateMaterial({
  mode = 'date',
  range = false,
  value,
  onValueChange,
  clearable = true,
  placeholder,
  ...field
}: FieldPresentation & {
  mode?: TemporalFormat;
  range?: boolean;
  value: TemporalValue;
  onValueChange?: (value: TemporalValue) => void;
  clearable?: boolean;
  placeholder?: string;
}) {
  const [selected, change] = useMaterialValue(value, onValueChange);
  const design = useDesignMode();
  const environment = useRuntimeDomEnvironment();
  const origin = JSON.stringify([selected, mode, range, !!(field.disabled || field.readOnly), design]);
  const [session, setSession] = useState<PickerSession | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | ShadowRoot | null>(null);
  const portalContainer =
    environment === undefined ? portalHost : runtimePortalContainer(environment);
  const sessionRef = useRef<PickerSession | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const latest = useRef({ origin, disabled: !!(field.disabled || field.readOnly), design, change, range, environment });
  latest.current = { origin, disabled: !!(field.disabled || field.readOnly), design, change, range, environment };
  const activeSession =
    session && session.origin === origin && !(field.disabled || field.readOnly) && !design ? session : null;
  sessionRef.current = activeSession;
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const control = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pickerButton = useRef<HTMLButtonElement | null>(null);
  const lastInput = useRef(0);
  const closeReason = useRef('');
  const restoringPickerFocus = useRef(false);
  const focused = useRef(false);
  const owner = useRef('');
  const lastValue = useRef(selected);
  lastValue.current = selected;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (session && !activeSession) setSession(null);
  }, [origin]);
  const close = (reason: string) => {
    // A close can cause a later focus-out notification. Preserve the first
    // reason so Escape/apply still restores the actual opening control.
    if (sessionRef.current) closeReason.current = reason;
    sessionRef.current = null;
    setSession(null);
  };
  const begin = (index: number, inputFocus: boolean, fromIcon = false) => {
    if (!mounted.current || latest.current.disabled || latest.current.design) return;
    const currentEnvironment = latest.current.environment;
    if (currentEnvironment !== undefined && !runtimePortalContainer(currentEnvironment)) return;
    const root = currentEnvironment === undefined ? control.current?.getRootNode() : null;
    if (root) {
      // Escape inherited Drawer/canvas clipping while retaining a shadow tree's styles.
      setPortalHost(
        root.nodeType === 11 && 'host' in root
          ? (root as ShadowRoot)
          : (control.current?.ownerDocument.body ?? null),
      );
    }
    const next = { token: ++sequence.current, origin: latest.current.origin, index, inputFocus };
    closeReason.current = '';
    restoringPickerFocus.current = false;
    returnFocus.current = fromIcon ? pickerButton.current : (inputs.current[index] ?? null);
    sessionRef.current = next;
    setSession(next);
  };
  const emit = (next: TemporalValue) => {
    if (!mounted.current || latest.current.disabled || latest.current.design) return;
    if (JSON.stringify(lastValue.current) !== JSON.stringify(next)) {
      lastValue.current = next;
      latest.current.change(next);
    }
  };
  const update = (text: string, index: number) => {
    if (latest.current.disabled || latest.current.design) return;
    close('input');
    const textValue = normalizeDirect(text, mode);
    if (!range) emit(textValue);
    else {
      const previous = Array.isArray(lastValue.current) ? lastValue.current : [];
      const next = [previous[0] ?? '', previous[1] ?? ''];
      next[index] = textValue;
      emit(next.every((part) => !part) ? [] : next);
    }
  };
  const belongs = (target: EventTarget | null) =>
    isDocumentNode(target, control.current?.ownerDocument) &&
    (control.current?.contains(target) ||
      popup.current?.contains(target) ||
      (isDocumentElement(target, control.current?.ownerDocument) &&
        target.closest('[data-temporal-owner]')?.getAttribute('data-temporal-owner') ===
          owner.current));
  const wholeBlur = (event: FocusEvent<HTMLElement>) => {
    if (belongs(event.relatedTarget)) return;
    const saved = Object.create(event) as FocusEvent<HTMLElement>;
    Object.defineProperty(saved, 'currentTarget', { value: event.currentTarget });
    const blurredControl = control.current,
      ownerDocument = blurredControl?.ownerDocument;
    const notify = () => {
      if (
        !mounted.current ||
        control.current !== blurredControl ||
        !blurredControl?.isConnected ||
        !isLiveDocument(ownerDocument) ||
        (latest.current.environment !== undefined &&
          !runtimePortalContainer(latest.current.environment))
      )
        return;
      if (focused.current && !belongs(ownerDocument!.activeElement)) {
        focused.current = false;
        field.onBlur?.(saved);
      }
    };
    if (isDocumentNode(event.relatedTarget, ownerDocument)) notify();
    else queueMicrotask(notify);
  };
  const parts = range
    ? Array.isArray(selected)
      ? selected
      : []
    : [typeof selected === 'string' ? selected : ''];
  const ownError = temporalError(selected, { format: mode, range });
  const kind =
    mode === 'time'
      ? '时间'
      : mode === 'month'
        ? '月份'
        : mode === 'datetime-local'
          ? '日期时间'
          : '日期';
  const PickerIcon = mode === 'time' ? Clock : CalendarDays;
  return (
    <FieldFrame {...field} onBlur={wholeBlur} error={field.error ?? ownError}>
      {(a11y) => {
        owner.current = a11y.id;
        const popupId = `${a11y.id}-popup`;
        return (
          <Popover.Root
            open={!!activeSession}
            triggerId={`${a11y.id}-picker`}
            onOpenChange={(open, details) => {
              if (open) begin(0, false, true);
              else {
                if (
                  (details.reason === 'outside-press' && belongs(details.event.target)) ||
                  (details.reason === 'focus-out' &&
                    'relatedTarget' in details.event &&
                    belongs(details.event.relatedTarget as EventTarget | null))
                ) {
                  details.cancel();
                  return;
                }
                close(details.reason);
              }
            }}
          >
            <div
              ref={control}
              className="material-temporal-control"
              data-range={range || undefined}
              data-disabled={(field.disabled || field.readOnly) || undefined}
              data-invalid={a11y['aria-invalid'] || undefined}
              onFocusCapture={() => {
                focused.current = true;
              }}
            >
              <div
                className="material-temporal-values"
                data-range={range || undefined}
                data-mode={mode}
              >
                {(range ? [0, 1] : [0]).map((index) => (
                  <div className="material-temporal-part" key={index}>
                    {index > 0 && (
                      <span className="material-temporal-divider" aria-hidden="true">
                        至
                      </span>
                    )}
                    <Input
                      {...a11y}
                      className="material-temporal-input"
                      ref={(element) => {
                        inputs.current[index] = isDocumentInput(element, element?.ownerDocument)
                          ? element
                          : null;
                      }}
                      id={index ? `${a11y.id}-end` : a11y.id}
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      aria-labelledby={range ? undefined : a11y['aria-labelledby']}
                      aria-label={range ? `${field.label}${index ? '结束' : '开始'}` : undefined}
                      aria-haspopup="dialog"
                      aria-expanded={!!activeSession}
                      aria-controls={activeSession ? popupId : undefined}
                      name={
                        field.name ? (range ? `${field.name}.${index}` : field.name) : undefined
                      }
                      value={displayTemporal(parts[index] ?? '', mode)}
                      disabled={field.disabled || field.readOnly}
                      readOnly={design}
                      required={field.required}
                      placeholder={
                        range
                          ? `${index ? '结束' : '开始'}${placeholder || kind}`
                          : (placeholder ?? `请选择${kind}`)
                      }
                      onFocus={() => {
                        lastInput.current = index;
                      }}
                      onClick={() => begin(index, true)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          begin(index, false);
                        }
                      }}
                      onInput={(event) => update(event.currentTarget.value, index)}
                      onChange={(event) => update(event.target.value, index)}
                    />
                  </div>
                ))}
              </div>
              {clearable && parts.some(Boolean) && (
                <Tip content={`清空${kind}`}>
                  <Button
                    type="button"
                    className="material-temporal-control-clear"
                    variant="ghost"
                    aria-label={`清空${field.label}`}
                    disabled={field.disabled || field.readOnly || design}
                    onClick={() => {
                      close('clear');
                      emit(range ? [] : '');
                      inputs.current[lastInput.current]?.focus({ preventScroll: true });
                    }}
                  >
                    <X size={13} />
                  </Button>
                </Tip>
              )}
              <Tip
                content={`选择${kind}`}
                onOpenChange={(open, details) => {
                  if (open && details.reason === 'trigger-focus') {
                    // Focus restoration is not a new request for a tooltip.
                    // Opening one here would consume the parent dialog's next Escape.
                    if (restoringPickerFocus.current) details.cancel();
                    restoringPickerFocus.current = false;
                  }
                }}
              >
                <Popover.Trigger
                  id={`${a11y.id}-picker`}
                  ref={pickerButton}
                  onBlur={() => {
                    restoringPickerFocus.current = false;
                  }}
                  render={
                    <Button type="button" className="material-temporal-picker" variant="ghost" />
                  }
                  aria-label={`选择${field.label}`}
                  disabled={field.disabled || field.readOnly || design}
                >
                  <PickerIcon size={16} aria-hidden="true" />
                </Popover.Trigger>
              </Tip>
            </div>
            <Popover.Portal container={portalContainer}>
              <Popover.Positioner
                className="temporal-positioner"
                anchor={control}
                align="start"
                sideOffset={5}
                collisionPadding={12}
              >
                <Popover.Popup
                  ref={popup}
                  id={popupId}
                  className="temporal-popup"
                  aria-label={`${field.label}选择面板`}
                  aria-labelledby={undefined}
                  data-mode={mode}
                  data-temporal-owner={a11y.id}
                  initialFocus={() =>
                    activeSession?.inputFocus
                      ? false
                      : (popup.current?.querySelector<HTMLElement>(
                          '[data-calendar-focus="true"]',
                        ) ?? true)
                  }
                  finalFocus={() => {
                    if (
                      latest.current.disabled ||
                      latest.current.design ||
                      closeReason.current === 'outside-press' ||
                      closeReason.current === 'focus-out' ||
                      closeReason.current === 'input'
                    )
                      return false;
                    const target = returnFocus.current;
                    restoringPickerFocus.current = target === pickerButton.current;
                    return target;
                  }}
                  onFocusCapture={() => {
                    focused.current = true;
                  }}
                >
                  <Popover.Title className="temporal-popup-title">
                    {range ? `${kind}范围` : `选择${kind}`}
                  </Popover.Title>
                  {activeSession && (
                    <TemporalPicker
                      key={activeSession.token}
                      mode={mode}
                      range={range}
                      initial={parts}
                      initialIndex={activeSession.index}
                      owner={a11y.id}
                      onCancel={() => close('cancel')}
                      onApply={(result) => {
                        const current = sessionRef.current;
                        if (
                          !current ||
                          current.token !== activeSession.token ||
                          current.origin !== latest.current.origin ||
                          latest.current.disabled ||
                          latest.current.design
                        )
                          return;
                        close('apply');
                        emit(range ? result : result[0]);
                      }}
                    />
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        );
      }}
    </FieldFrame>
  );
}

export function TimeMaterial(props: Omit<Parameters<typeof DateMaterial>[0], 'mode'>) {
  return <DateMaterial {...props} mode="time" />;
}
function temporalContract(time: boolean): Contracts[string] {
  return {
    version: '1.0.0',
    field: {
      type: ['string', 'array'],
      valueProp: 'value',
      changeEvent: 'onValueChange',
      defaults: (props) => ({
        format: time ? 'time' : ((props.mode ?? 'date') as TemporalFormat),
        ...(props.range ? { range: true, uniqueItems: false, itemType: 'string' } : {}),
      }),
    },
    props: {
      label: requiredText,
      value: { ...jsonProp, required: true },
      hint: textProp,
      range: boolProp,
      clearable: boolProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
      placeholder: textProp,
      ...(!time ? { mode: textProp } : {}),
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props, { fieldType, fieldItemType, field }) => {
      const errors = enumErrors(props, time ? {} : { mode: ['date', 'month', 'datetime-local'] });
      const range = props.range === true,
        format = time ? 'time' : (props.mode ?? 'date');
      if (
        fieldType &&
        (range
          ? fieldType !== 'array' || (fieldItemType && fieldItemType !== 'string')
          : fieldType !== 'string')
      )
        errors.push('日期时间单值绑定文本字段，范围绑定文本数组');
      if (
        field &&
        (field.format !== format ||
          !!field.range !== range ||
          (range && field.uniqueItems !== false))
      )
        errors.push('字段的日期时间格式或范围设置与控件不匹配，请新建兼容字段');
      if (
        'value' in props &&
        (range
          ? !Array.isArray(props.value) ||
            (props.value.length !== 0 && props.value.length !== 2) ||
            !props.value.every((v) => typeof v === 'string')
          : typeof props.value !== 'string')
      )
        errors.push('日期时间的值应为文本，范围应为空数组或两个文本值');
      return errors;
    },
  };
}
export const temporalContracts: Contracts = {
  'ui.date': temporalContract(false),
  'ui.time': temporalContract(true),
};
export { validTemporal };
