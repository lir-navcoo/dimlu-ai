import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Check } from 'lucide-react';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Button, Input, Tip } from '../ui/primitives';
import { runtimePortalContainer, useRuntimeDomEnvironment } from '../ui/runtime-dom';
import { temporalError, validTemporal, type TemporalFormat } from '../../packages/schema/formats';
import {
  addDays,
  addMonths,
  dateParts,
  daysInMonth,
  fullTime,
  isoDate,
  localNow,
  monthDays,
  pad2,
  padYear,
  weekDay,
} from './temporal-helpers';

function MonthSelect({
  value,
  onChange,
  owner,
}: {
  value: number;
  onChange: (value: number) => void;
  owner: string;
}) {
  const container = runtimePortalContainer(useRuntimeDomEnvironment());
  const items = Array.from({ length: 12 }, (_, index) => ({
    value: String(index + 1),
    label: index + 1 + '月',
  }));
  return (
    <BaseSelect.Root
      value={String(value)}
      items={items}
      onValueChange={(next) => {
        if (next) onChange(Number(next));
      }}
    >
      <BaseSelect.Trigger className="ui-select temporal-month" aria-label="月份">
        <BaseSelect.Value />
        <BaseSelect.Icon>
          <ChevronDown size={12} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal container={container}>
        <BaseSelect.Positioner
          className="select-positioner"
          sideOffset={4}
          alignItemWithTrigger={false}
        >
          <BaseSelect.Popup
            className="ui-select-popup temporal-month-popup"
            data-temporal-owner={owner}
          >
            <BaseSelect.List>
              {items.map((item) => (
                <BaseSelect.Item className="ui-select-item" value={item.value} key={item.value}>
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator>
                    <Check size={12} />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
function Calendar({
  value,
  rangeValues,
  monthOnly,
  onSelect,
  owner,
}: {
  value: string;
  rangeValues: string[];
  monthOnly: boolean;
  onSelect: (value: string) => void;
  owner: string;
}) {
  const initial = validTemporal(value, 'date')
    ? value
    : validTemporal(value, 'month')
      ? `${value}-01`
      : localNow('date');
  const [focusDate, setFocusDate] = useState(initial);
  const [view, setView] = useState(() => dateParts(initial));
  const [yearText, setYearText] = useState(padYear(view.year));
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);
  useLayoutEffect(() => {
    if (moveFocus.current) {
      grid.current?.querySelector<HTMLButtonElement>('[data-calendar-focus="true"]')?.focus();
      moveFocus.current = false;
    }
  }, [focusDate, view.year, view.month]);
  const navigate = (next: string, focus = false) => {
    const target = dateParts(next);
    moveFocus.current = focus;
    setFocusDate(next);
    setView(target);
    setYearText(padYear(target.year));
  };
  const applyYear = () => {
    const year = /^\d{1,4}$/.test(yearText) ? Number(yearText) : 0;
    if (year >= 1 && year <= 9999)
      navigate(isoDate(year, view.month, Math.min(view.day, daysInMonth(year, view.month))));
    else setYearText(padYear(view.year));
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const move: Record<string, () => string> = monthOnly
      ? {
          ArrowLeft: () => addMonths(date, -1),
          ArrowRight: () => addMonths(date, 1),
          ArrowUp: () => addMonths(date, -3),
          ArrowDown: () => addMonths(date, 3),
          Home: () => isoDate(dateParts(date).year, 1, 1),
          End: () => isoDate(dateParts(date).year, 12, 1),
          PageUp: () => addMonths(date, -12),
          PageDown: () => addMonths(date, 12),
        }
      : {
          ArrowLeft: () => addDays(date, -1),
          ArrowRight: () => addDays(date, 1),
          ArrowUp: () => addDays(date, -7),
          ArrowDown: () => addDays(date, 7),
          Home: () => addDays(date, -weekDay(date)),
          End: () => addDays(date, 6 - weekDay(date)),
          PageUp: () => addMonths(date, event.shiftKey ? -12 : -1),
          PageDown: () => addMonths(date, event.shiftKey ? 12 : 1),
        };
    if (move[event.key]) {
      event.preventDefault();
      navigate(move[event.key](), true);
    }
  };
  const activeRange = rangeValues.filter(Boolean).map((part) => part.split('T')[0]);
  const ordered = [...activeRange].sort();
  const cell = (date: string | null) => {
    if (!date) return <span className="temporal-day-blank" />;
    const key = monthOnly ? date.slice(0, 7) : date;
    const selected = activeRange.includes(key);
    const within = ordered.length === 2 && key > ordered[0] && key < ordered[1];
    const focused = monthOnly ? focusDate.slice(0, 7) === key : focusDate === key;
    return (
      <div role="gridcell" aria-selected={selected} key={date}>
        <Button
          variant="ghost"
          className="temporal-day"
          aria-label={key}
          aria-pressed={selected}
          data-calendar-focus={focused}
          data-outside={(!monthOnly && dateParts(date).month !== view.month) || undefined}
          data-selected={selected || undefined}
          data-in-range={within || undefined}
          data-today={key === localNow(monthOnly ? 'month' : 'date') || undefined}
          tabIndex={focused ? 0 : -1}
          onKeyDown={(event) => keyDown(event, date)}
          onClick={() => {
            setFocusDate(date);
            onSelect(key);
          }}
        >
          {monthOnly ? `${dateParts(date).month}月` : dateParts(date).day}
        </Button>
      </div>
    );
  };
  const days = monthOnly
    ? Array.from({ length: 12 }, (_, index) => isoDate(view.year, index + 1, 1))
    : monthDays(view.year, view.month);
  const rowSize = monthOnly ? 3 : 7;
  return (
    <div className={`temporal-calendar ${monthOnly ? 'month-only' : ''}`}>
      <div className="temporal-calendar-header">
        <Tip content={monthOnly ? '上一年' : '上个月'}>
          <Button
            variant="ghost"
            aria-label={monthOnly ? '上一年' : '上个月'}
            disabled={view.year === 1 && (monthOnly || view.month === 1)}
            onClick={() =>
              navigate(addMonths(isoDate(view.year, view.month, 1), monthOnly ? -12 : -1))
            }
          >
            <ChevronLeft size={15} />
          </Button>
        </Tip>
        <Input
          className="temporal-year"
          type="text"
          inputMode="numeric"
          aria-label="年份"
          value={yearText}
          maxLength={4}
          onChange={(event) => setYearText(event.target.value)}
          onBlur={applyYear}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyYear();
            }
          }}
        />
        <span className="temporal-year-suffix">年</span>
        {!monthOnly && (
          <MonthSelect
            owner={owner}
            value={view.month}
            onChange={(month) =>
              navigate(isoDate(view.year, month, Math.min(view.day, daysInMonth(view.year, month))))
            }
          />
        )}
        <Tip content={monthOnly ? '下一年' : '下个月'}>
          <Button
            variant="ghost"
            aria-label={monthOnly ? '下一年' : '下个月'}
            disabled={view.year === 9999 && (monthOnly || view.month === 12)}
            onClick={() =>
              navigate(addMonths(isoDate(view.year, view.month, 1), monthOnly ? 12 : 1))
            }
          >
            <ChevronRight size={15} />
          </Button>
        </Tip>
      </div>
      <div
        role="grid"
        aria-label={
          monthOnly ? `${padYear(view.year)}年月份` : `${padYear(view.year)}年${view.month}月`
        }
        ref={grid}
      >
        {!monthOnly && (
          <div className="temporal-week" role="row">
            {['一', '二', '三', '四', '五', '六', '日'].map((name) => (
              <span role="columnheader" key={name}>
                {name}
              </span>
            ))}
          </div>
        )}
        {Array.from({ length: days.length / rowSize }, (_, row) => (
          <div className="temporal-calendar-row" role="row" key={row}>
            {days
              .slice(row * rowSize, (row + 1) * rowSize)
              .map((date, index) =>
                date ? cell(date) : <div role="gridcell" key={`blank-${index}`} />,
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

function scrollTimeOption(item: HTMLElement, center = false) {
  // scrollIntoView also scrolls the popup, Drawer and page ancestors.
  // Only the individual time list should move when revealing its selection.
  const list = item.parentElement;
  if (!list) return;
  const itemRect = item.getBoundingClientRect();
  const listRect = list.getBoundingClientRect();
  const top = itemRect.top - listRect.top;
  if (center) list.scrollTop += top - (list.clientHeight - itemRect.height) / 2;
  else if (top < 0) list.scrollTop += top;
  else if (top + itemRect.height > list.clientHeight)
    list.scrollTop += top + itemRect.height - list.clientHeight;
}

function TimeColumns({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const values = fullTime(value).split(':');
  const move = useRef<number | null>(null);
  const columns = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (move.current !== null) {
      const selected = columns.current?.querySelector<HTMLButtonElement>(
        `[data-column="${move.current}"][aria-selected="true"]`,
      );
      selected?.focus({ preventScroll: true });
      if (selected) scrollTimeOption(selected);
      move.current = null;
    }
  }, [value]);
  useLayoutEffect(() => {
    columns.current
      ?.querySelectorAll<HTMLElement>('[aria-selected="true"]')
      .forEach((item) => scrollTimeOption(item, true));
  }, []);
  return (
    <div className="temporal-time" ref={columns}>
      {['小时', '分钟', '秒钟'].map((label, column) => (
        <div className="temporal-time-column" key={label}>
          <span className="temporal-time-heading">{label}</span>
          <div
            className="temporal-time-options"
            role="listbox"
            aria-label={label}
            onKeyDown={(event) => {
              const current = Number(values[column]),
                max = column === 0 ? 23 : 59;
              const next =
                event.key === 'ArrowDown'
                  ? Math.min(max, current + 1)
                  : event.key === 'ArrowUp'
                    ? Math.max(0, current - 1)
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? max
                        : event.key === 'PageDown'
                          ? Math.min(max, current + 10)
                          : event.key === 'PageUp'
                            ? Math.max(0, current - 10)
                            : undefined;
              if (next !== undefined) {
                event.preventDefault();
                move.current = column;
                const parts = [...values];
                parts[column] = pad2(next);
                onChange(parts.join(':'));
              }
            }}
          >
            {Array.from({ length: column === 0 ? 24 : 60 }, (_, index) => (
              <Button
                key={index}
                variant="ghost"
                role="option"
                aria-selected={values[column] === pad2(index)}
                aria-label={`${pad2(index)} ${column === 0 ? '时' : column === 1 ? '分' : '秒'}`}
                data-column={column}
                data-calendar-focus={column === 0 && values[0] === pad2(index)}
                tabIndex={values[column] === pad2(index) ? 0 : -1}
                onClick={() => {
                  const parts = [...values];
                  parts[column] = pad2(index);
                  onChange(parts.join(':'));
                }}
              >
                {pad2(index)}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TemporalPicker({
  mode,
  range,
  initial,
  initialIndex,
  owner,
  onApply,
  onCancel,
}: {
  mode: TemporalFormat;
  range: boolean;
  initial: string[];
  initialIndex: number;
  owner: string;
  onApply: (parts: string[]) => void;
  onCancel: () => void;
}) {
  const hasTime = mode === 'time' || mode === 'datetime-local';
  const [active, setActive] = useState(initialIndex);
  const [nowVersion, setNowVersion] = useState(0);
  const [draft, setDraft] = useState(() =>
    hasTime
      ? [0, 1].map((index) =>
          validTemporal(initial[index], mode)
            ? mode === 'time'
              ? fullTime(initial[index])
              : `${initial[index].split('T')[0]}T${fullTime(initial[index].split('T')[1])}`
            : localNow(mode),
        )
      : [initial[0] ?? '', initial[1] ?? ''],
  );
  const [anchor, setAnchor] = useState<string | null>(() =>
    range && initialIndex === 1 && validTemporal(initial[0], mode) ? initial[0] : null,
  );
  const latest = useRef({ draft, active, anchor });
  latest.current = { draft, active, anchor };
  const chooseDate = (date: string) => {
    const current = latest.current;
    if (mode === 'datetime-local') {
      const next = [...current.draft];
      next[current.active] = `${date}T${fullTime(next[current.active].split('T')[1])}`;
      setDraft(next);
    } else if (!range) onApply([date]);
    else if (current.anchor) onApply([current.anchor, date].sort());
    else {
      setAnchor(date);
      setDraft([date, '']);
      setActive(1);
    }
  };
  const part = draft[active] ?? '';
  const error = hasTime
    ? temporalError(range ? draft : draft[0], { format: mode, range })
    : undefined;
  const isCalendar = mode !== 'time';
  return (
    <div className="temporal-picker-body">
      {range &&
        (hasTime ? (
          <div className="temporal-boundaries" role="group" aria-label="范围边界">
            {['开始', '结束'].map((label, index) => (
              <Button
                key={label}
                variant="ghost"
                aria-pressed={active === index}
                onClick={() => setActive(index)}
              >
                {label}
                <span>{draft[index].replace('T', ' ')}</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="temporal-range-prompt" role="status">
            {`请选择${anchor ? '结束' : '开始'}${mode === 'month' ? '月份' : '日期'}`}
            <span>{draft.filter(Boolean).join(' 至 ')}</span>
          </div>
        ))}
      <div className={`temporal-picker-content ${mode === 'datetime-local' ? 'with-time' : ''}`}>
        {isCalendar && (
          <Calendar
            key={hasTime ? `calendar-${active}-${nowVersion}` : 'calendar'}
            value={mode === 'datetime-local' ? part.split('T')[0] : part}
            rangeValues={range ? draft : [draft[0]]}
            monthOnly={mode === 'month'}
            onSelect={chooseDate}
            owner={owner}
          />
        )}
        {hasTime && (
          <TimeColumns
            key={`time-${active}-${nowVersion}`}
            value={mode === 'datetime-local' ? part.split('T')[1] : part}
            onChange={(time) => {
              const current = latest.current;
              const next = [...current.draft];
              next[current.active] =
                mode === 'datetime-local' ? `${next[current.active].split('T')[0]}T${time}` : time;
              setDraft(next);
            }}
          />
        )}
      </div>
      {error && (
        <p className="temporal-picker-error" role="alert">
          {error}
        </p>
      )}
      <div className="temporal-picker-footer">
        <Button
          variant="ghost"
          onClick={() => {
            if (hasTime) {
              const current = latest.current;
              const next = [...current.draft];
              next[current.active] = localNow(mode);
              setDraft(next);
              // Reset only the current views, including when the date itself is unchanged.
              setNowVersion((version) => version + 1);
            } else chooseDate(localNow(mode));
          }}
        >
          {hasTime ? '现在' : mode === 'month' ? '本月' : '今天'}
        </Button>
        <span />
        <Button onClick={onCancel}>取消</Button>
        {hasTime && (
          <Button
            variant="primary"
            disabled={!!error}
            onClick={() => {
              const current = latest.current.draft;
              if (!temporalError(range ? current : current[0], { format: mode, range }))
                onApply(range ? current : [current[0]]);
            }}
          >
            确定
          </Button>
        )}
      </div>
    </div>
  );
}
