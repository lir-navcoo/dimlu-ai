import { useRef } from 'react';

export function ResizeHandle({
  label,
  value,
  min,
  max,
  onChange,
  axis = 'x',
  reverse = false,
  controls,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  axis?: 'x' | 'y';
  reverse?: boolean;
  controls: string;
}) {
  const start = useRef<{ coordinate: number; value: number; pointerId: number } | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div
      className={`resize-handle ${axis}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-controls={controls}
      onPointerDown={(event) => {
        if (event.button !== 0 || start.current || event.isPrimary === false) return;
        event.preventDefault();
        event.currentTarget.focus();
        start.current = {
          coordinate: axis === 'x' ? event.clientX : event.clientY,
          value,
          pointerId: event.pointerId,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = start.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onChange(
          clamp(
            drag.value +
              ((axis === 'x' ? event.clientX : event.clientY) - drag.coordinate) *
                (reverse ? -1 : 1),
          ),
        );
      }}
      onPointerUp={(event) => {
        if (start.current?.pointerId === event.pointerId) start.current = null;
      }}
      onPointerCancel={(event) => {
        if (start.current?.pointerId === event.pointerId) start.current = null;
      }}
      onLostPointerCapture={(event) => {
        if (start.current?.pointerId === event.pointerId) start.current = null;
      }}
      onKeyDown={(event) => {
        const negative = axis === 'x' ? 'ArrowLeft' : 'ArrowUp',
          positive = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (![negative, positive, 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        onChange(
          event.key === 'Home'
            ? min
            : event.key === 'End'
              ? max
              : clamp(value + (event.key === positive ? 16 : -16) * (reverse ? -1 : 1)),
        );
      }}
    />
  );
}
