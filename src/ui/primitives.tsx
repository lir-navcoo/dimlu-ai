import {
  Children,
  Fragment,
  isValidElement,
  type ComponentProps,
  type ReactNode,
  type ReactElement,
} from 'react';
import { Button as BaseButton } from '@base-ui/react/button';
import { Input as BaseInput } from '@base-ui/react/input';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Collapsible } from '@base-ui/react/collapsible';
import { Tooltip } from '@base-ui/react/tooltip';
import { Check, ChevronDown } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { runtimePortalContainer, useRuntimeDomEnvironment } from './runtime-dom';

export const cn = (...values: ClassValue[]) => twMerge(clsx(values));
export const TipProvider = Tooltip.Provider;
/** Compose onto the existing element so drag sources and focus targets keep their DOM identity. */
export function Tip({
  children,
  content,
  side = 'top',
  disabled = false,
  onOpenChange,
}: {
  children: ReactElement;
  content: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  disabled?: boolean;
  onOpenChange?: Tooltip.Root.Props['onOpenChange'];
}) {
  const container = runtimePortalContainer(useRuntimeDomEnvironment());
  return (
    <Tooltip.Root onOpenChange={onOpenChange}>
      <Tooltip.Trigger render={children} disabled={disabled} />
      <Tooltip.Portal container={container}>
        <Tooltip.Positioner side={side} sideOffset={7} className="tooltip-positioner">
          <Tooltip.Popup className="ui-tooltip" role="tooltip">
            {content}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function Button({
  className,
  variant = 'default',
  ...props
}: ComponentProps<typeof BaseButton> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
}) {
  return <BaseButton className={cn('ui-button', `ui-button-${variant}`, className)} {...props} />;
}
export function Input({ className, ...props }: ComponentProps<typeof BaseInput>) {
  return <BaseInput className={cn('ui-input', className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('ui-textarea', className)} {...props} />;
}
export function Checkbox({ className, ...props }: ComponentProps<typeof BaseCheckbox.Root>) {
  return (
    <BaseCheckbox.Root className={cn('ui-checkbox', className)} {...props}>
      <BaseCheckbox.Indicator>
        <Check size={12} strokeWidth={2.5} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

type Choice = { value: string; label: ReactNode; group?: string; disabled?: boolean };
function readChoices(children: ReactNode, group?: string): Choice[] {
  return Children.toArray(children).flatMap((child): Choice[] => {
    if (
      !isValidElement<{ value?: string; label?: string; disabled?: boolean; children?: ReactNode }>(
        child,
      )
    )
      return [];
    if (child.type === 'option')
      return [
        {
          value: String(child.props.value ?? ''),
          label: child.props.children,
          group,
          disabled: child.props.disabled,
        },
      ];
    if (child.type === 'optgroup') return readChoices(child.props.children, child.props.label);
    if (child.type === Fragment) return readChoices(child.props.children, group);
    return [];
  });
}
/** String values stay explicit. The popup is portaled; no synthetic native change events. */
export function Select({
  value,
  onValueChange,
  children,
  className,
  id,
  name,
  disabled,
  ...trigger
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
} & Pick<
  ComponentProps<typeof BaseSelect.Trigger>,
  'aria-label' | 'aria-labelledby' | 'aria-describedby' | 'autoFocus'
>) {
  const choices = readChoices(children);
  const container = runtimePortalContainer(useRuntimeDomEnvironment());
  return (
    <BaseSelect.Root<string>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      items={choices}
      name={name}
      disabled={disabled}
    >
      <BaseSelect.Trigger
        {...trigger}
        id={id}
        data-value={value}
        className={cn('ui-select', className)}
      >
        <BaseSelect.Value className="min-w-0 flex-1 truncate" />
        <BaseSelect.Icon>
          <ChevronDown size={13} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner
          sideOffset={4}
          alignItemWithTrigger={false}
          className="select-positioner"
        >
          <BaseSelect.Popup className="ui-select-popup">
            <BaseSelect.List className="max-h-[min(320px,var(--available-height))] overflow-y-auto overscroll-contain p-1">
              {choices.map((choice, index) => (
                <Fragment key={choice.value}>
                  {choice.group && choice.group !== choices[index - 1]?.group && (
                    <div className="px-2 py-1 text-[11px] font-medium text-slate-400">
                      {choice.group}
                    </div>
                  )}
                  <BaseSelect.Item
                    value={choice.value}
                    data-value={choice.value}
                    disabled={choice.disabled}
                    className="ui-select-item"
                  >
                    <BaseSelect.ItemText className="min-w-0 flex-1 truncate">
                      {choice.label}
                    </BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator>
                      <Check size={13} />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                </Fragment>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export function Disclosure({
  title,
  children,
  className,
  defaultOpen = false,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={cn('ui-disclosure', className)}>
      <Collapsible.Trigger className="ui-disclosure-trigger">
        <ChevronDown size={13} />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Panel>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
