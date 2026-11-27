import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DateMaterial, temporalContracts, type TemporalValue } from '../src/materials/temporal';
import { DrawerMaterial } from '../src/materials/feedback';
import { TipProvider } from '../src/ui/primitives';
import type { TemporalFormat } from '../packages/schema/formats';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import type { ApplicationSchema } from '../packages/schema/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = (label: string) => screen.getByRole('textbox', { name: label }) as HTMLInputElement;
const choose = (label: string) => screen.getByRole('button', { name: `选择${label}` });
const nativeInputs = () =>
  document.querySelectorAll(
    'input[type="date"], input[type="month"], input[type="time"], input[type="datetime-local"]',
  );

function Controlled({
  initial,
  mode = 'date',
  range = false,
  changes,
}: {
  initial: TemporalValue;
  mode?: TemporalFormat;
  range?: boolean;
  changes: (value: TemporalValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DateMaterial
      label="计划"
      mode={mode}
      range={range}
      value={value}
      name="scheduled"
      onValueChange={(next) => {
        changes(next);
        setValue(next);
      }}
    />
  );
}

describe('custom temporal controls: retained field contracts', () => {
  it('renders configured placeholders for date, time and range inputs', () => {
    const view = render(
      <DateMaterial label="日期" value="" placeholder="选择业务日期" clearable={false} />,
    );
    expect(input('日期').placeholder).toBe('选择业务日期');

    view.rerender(
      <DateMaterial label="日期范围" value={[]} range placeholder="业务日期" clearable={false} />,
    );
    expect(input('日期范围开始').placeholder).toBe('开始业务日期');
    expect(input('日期范围结束').placeholder).toBe('结束业务日期');

    view.rerender(
      <DateMaterial
        label="时间"
        mode="time"
        value=""
        placeholder="选择交接时间"
        clearable={false}
      />,
    );
    expect(input('时间').placeholder).toBe('选择交接时间');
  });

  it.each([
    ['date', '2026-11-08'],
    ['month', '2026-11'],
    ['time', '10:20:30'],
    ['datetime-local', '2026-11-08T10:20:30'],
  ] as const)('retains %s ISO text entry without any browser picker input', (mode, value) => {
    const changes = vi.fn();
    render(<Controlled initial="" mode={mode} changes={changes} />);
    const field = input('计划');
    expect(field.type).toBe('text');
    expect(field.name).toBe('scheduled');
    fireEvent.input(field, { target: { value } });
    fireEvent.change(field, { target: { value } });
    expect(field.value).toBe(mode === 'datetime-local' ? value.replace('T', ' ') : value);
    expect(changes).toHaveBeenCalledExactlyOnceWith(value);
    expect(nativeInputs()).toHaveLength(0);
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('keeps named range boundaries, seconds, partial validation and an internal atomic clear', () => {
    const changes = vi.fn();
    render(<Controlled initial={['10:20:30', '11:22:33']} mode="time" range changes={changes} />);
    const start = input('计划开始');
    const end = input('计划结束');
    expect([start.name, end.name]).toEqual(['scheduled.0', 'scheduled.1']);
    fireEvent.input(start, { target: { value: '10:21:34' } });
    fireEvent.change(start, { target: { value: '10:21:34' } });
    expect(changes).toHaveBeenCalledExactlyOnceWith(['10:21:34', '11:22:33']);
    const clear = screen.getByRole('button', { name: '清空计划' });
    expect(clear.closest('.material-temporal-control')).toBe(
      start.closest('.material-temporal-control'),
    );
    fireEvent.click(clear);
    expect(changes).toHaveBeenLastCalledWith([]);
    expect(changes).toHaveBeenCalledTimes(2);
    expect([start.value, end.value]).toEqual(['', '']);
    expect(screen.queryByRole('button', { name: '清空计划' })).toBeNull();
    fireEvent.input(end, { target: { value: '12:00:01' } });
    expect(changes).toHaveBeenLastCalledWith(['', '12:00:01']);
    expect(screen.getByRole('alert').textContent).toContain('完整');
  });

  it('preserves required, hint, disabled and error accessibility without callbacks', () => {
    const changes = vi.fn();
    render(
      <DateMaterial
        label="锁定日期"
        value="2026-11-08"
        name="locked"
        hint="本地时间"
        error="日期不可用"
        disabled
        required
        onValueChange={changes}
      />,
    );
    const field = input('锁定日期');
    const trigger = choose('锁定日期') as HTMLButtonElement;
    const clear = screen.getByRole('button', { name: '清空锁定日期' }) as HTMLButtonElement;
    expect([field.disabled, trigger.disabled, clear.disabled]).toEqual([true, true, true]);
    expect(field.required).toBe(true);
    expect(field.name).toBe('locked');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain('-hint');
    expect(field.getAttribute('aria-describedby')).toContain('-error');
    fireEvent.click(trigger);
    fireEvent.click(clear);
    expect(changes).not.toHaveBeenCalled();
    expect(field.value).toBe('2026-11-08');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('retains unbound local editing and reacts to external reset without exposing a clear button when forbidden', () => {
    const view = render(<DateMaterial label="日期" value="2026-11-08" clearable={false} />);
    fireEvent.input(input('日期'), { target: { value: '2026-11-09' } });
    expect(input('日期').value).toBe('2026-11-09');
    view.rerender(<DateMaterial label="日期" value="" clearable={false} />);
    expect(input('日期').value).toBe('');
    expect(screen.queryByRole('button', { name: '清空日期' })).toBeNull();
  });
});

const panel = () => screen.findByRole('dialog', { name: '计划选择面板' });
const pickTime = (popup: HTMLElement, part: '小时' | '分钟' | '秒钟', value: string) => {
  const unit = part === '小时' ? '时' : part === '分钟' ? '分' : '秒';
  fireEvent.click(
    within(within(popup).getByRole('listbox', { name: part })).getByRole('option', {
      name: `${value} ${unit}`,
    }),
  );
};

describe('custom temporal popover interactions', () => {
  it.each([
    ['date', '2026-11-08', '2026-11-09'],
    ['month', '2026-11', '2026-09'],
  ] as const)(
    'selects a %s from the custom panel and returns focus without calling showPicker',
    async (mode, initial, next) => {
      const changes = vi.fn();
      const nativePicker = vi.fn();
      const view = render(<Controlled initial={initial} mode={mode} changes={changes} />);
      Object.defineProperty(input('计划'), 'showPicker', {
        configurable: true,
        value: nativePicker,
      });
      const trigger = choose('计划');
      fireEvent.click(trigger);
      const popup = await panel();
      expect(nativeInputs()).toHaveLength(0);
      expect(nativePicker).not.toHaveBeenCalled();
      expect(changes).not.toHaveBeenCalled();
      fireEvent.click(within(popup).getByRole('button', { name: next }));
      expect(changes).toHaveBeenCalledExactlyOnceWith(next);
      expect(input('计划').value).toBe(next);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(trigger));
      expect(document.querySelector('[title]')).toBeNull();
      view.unmount();
    },
  );

  it.each([
    ['date', ['2026-11-01', '2026-11-02'], '2026-11-09', '2026-11-07'],
    ['month', ['2026-01', '2026-02'], '2026-11', '2026-09'],
  ] as const)(
    'keeps %s range drafts private, cancels partial selection and commits the sorted pair once',
    async (mode, initial, later, earlier) => {
      const changes = vi.fn();
      render(<Controlled initial={[...initial]} mode={mode} range changes={changes} />);
      const trigger = choose('计划');
      fireEvent.click(trigger);
      let popup = await panel();
      fireEvent.click(within(popup).getByRole('button', { name: later }));
      expect(changes).not.toHaveBeenCalled();
      expect([input('计划开始').value, input('计划结束').value]).toEqual(initial);
      fireEvent.keyDown(popup, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(changes).not.toHaveBeenCalled();
      fireEvent.click(trigger);
      popup = await panel();
      fireEvent.click(within(popup).getByRole('button', { name: later }));
      expect(changes).not.toHaveBeenCalled();
      fireEvent.click(within(popup).getByRole('button', { name: earlier }));
      expect(changes).toHaveBeenCalledExactlyOnceWith([earlier, later]);
      expect([input('计划开始').value, input('计划结束').value]).toEqual([earlier, later]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );

  it.each([
    ['time', '10:20:30', '11:22:34'],
    ['datetime-local', '2026-11-08T10:20:30', '2026-11-08T11:22:34'],
  ] as const)(
    'keeps %s time drafts private and preserves seconds through cancel and confirmation',
    async (mode, initial, next) => {
      const changes = vi.fn();
      render(<Controlled initial={initial} mode={mode} changes={changes} />);
      fireEvent.click(choose('计划'));
      let popup = await panel();
      pickTime(popup, '小时', '11');
      pickTime(popup, '分钟', '22');
      pickTime(popup, '秒钟', '34');
      expect(changes).not.toHaveBeenCalled();
      expect(input('计划').value).toBe(initial.replace('T', ' '));
      fireEvent.click(within(popup).getByRole('button', { name: '取消' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(changes).not.toHaveBeenCalled();
      fireEvent.click(choose('计划'));
      popup = await panel();
      expect(
        within(popup).getByRole('option', { name: '30 秒' }).getAttribute('aria-selected'),
      ).toBe('true');
      pickTime(popup, '小时', '11');
      pickTime(popup, '分钟', '22');
      pickTime(popup, '秒钟', '34');
      fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
      expect(changes).toHaveBeenCalledExactlyOnceWith(next);
      expect(input('计划').value).toBe(next.replace('T', ' '));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );

  it('rejects a reversed time draft and commits the repaired complete range with seconds once', async () => {
    const changes = vi.fn();
    render(<Controlled initial={['10:20:30', '11:22:33']} mode="time" range changes={changes} />);
    fireEvent.click(input('计划结束'));
    const popup = await panel();
    pickTime(popup, '小时', '09');
    const confirm = within(popup).getByRole('button', { name: '确定' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(changes).not.toHaveBeenCalled();
    expect([input('计划开始').value, input('计划结束').value]).toEqual(['10:20:30', '11:22:33']);
    fireEvent.click(within(popup).getByRole('button', { name: /^开始/ }));
    pickTime(popup, '小时', '08');
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(changes).toHaveBeenCalledExactlyOnceWith(['08:20:30', '09:22:33']);
  });

  it.each([
    ['date', '2026-11-01', '2026-11-02', '2026-11-08'],
    ['month', '2026-01', '2026-02', '2026-11'],
  ] as const)(
    'allows equal %s range boundaries without dropping either endpoint',
    async (mode, start, end, value) => {
      const changes = vi.fn();
      render(<Controlled initial={[start, end]} mode={mode} range changes={changes} />);
      fireEvent.click(choose('计划'));
      const popup = await panel();
      fireEvent.click(within(popup).getByRole('button', { name: value }));
      expect(changes).not.toHaveBeenCalled();
      fireEvent.click(within(popup).getByRole('button', { name: value }));
      expect([input('计划开始').value, input('计划结束').value]).toEqual([value, value]);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(changes).toHaveBeenCalledExactlyOnceWith([value, value]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    },
  );

  it('compares mixed minute and second precision as the same time before applying a later second', async () => {
    const changes = vi.fn();
    render(<Controlled initial={['12:00:00', '12:00']} mode="time" range changes={changes} />);
    fireEvent.click(input('计划结束'));
    const popup = await panel();
    const confirm = within(popup).getByRole('button', { name: '确定' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    pickTime(popup, '秒钟', '01');
    fireEvent.click(confirm);
    expect(changes).toHaveBeenCalledExactlyOnceWith(['12:00:00', '12:00:01']);
  });

  it('invalidates an open draft on external reset and on a late disabled transition', async () => {
    const changes = vi.fn();
    const view = render(
      <DateMaterial label="计划" mode="time" value="10:20:30" onValueChange={changes} />,
    );
    fireEvent.click(choose('计划'));
    let popup = await panel();
    pickTime(popup, '小时', '11');
    view.rerender(
      <DateMaterial label="计划" mode="time" value="08:00:05" onValueChange={changes} />,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(input('计划').value).toBe('08:00:05');
    expect(changes).not.toHaveBeenCalled();
    fireEvent.click(choose('计划'));
    popup = await panel();
    expect(within(popup).getByRole('option', { name: '05 秒' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    pickTime(popup, '小时', '09');
    view.rerender(
      <DateMaterial label="计划" mode="time" value="08:00:05" disabled onValueChange={changes} />,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(choose('计划'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(changes).not.toHaveBeenCalled();
  });

  it.each([
    ['0001-01-01', '0001-01-02'],
    ['0099-02-01', '0099-02-02'],
    ['9999-12-30', '9999-12-31'],
  ])(
    'renders the literal calendar year in %s and emits %s without JavaScript Date century coercion',
    async (initial, next) => {
      const changes = vi.fn();
      render(<Controlled initial={initial} changes={changes} />);
      fireEvent.click(choose('计划'));
      const popup = await panel();
      expect(within(popup).getByRole('button', { name: initial })).toBeTruthy();
      fireEvent.click(within(popup).getByRole('button', { name: next }));
      expect(changes).toHaveBeenCalledExactlyOnceWith(next);
    },
  );

  it('keeps body-portal focus within the field and only reports blur after focus leaves the whole control', async () => {
    const blur = vi.fn();
    render(
      <>
        <DateMaterial label="计划" value="2026-11-08" onBlur={blur} />
        <button type="button">外部操作</button>
      </>,
    );
    const trigger = choose('计划');
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const popup = await panel();
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    const day = within(popup).getByRole('button', { name: '2026-11-09' });
    act(() => day.focus());
    expect(blur).not.toHaveBeenCalled();
    fireEvent.keyDown(day, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(blur).not.toHaveBeenCalled();
    act(() => screen.getByRole('button', { name: '外部操作' }).focus());
    expect(blur).toHaveBeenCalledOnce();
  });

  it('moves calendar focus with arrow keys across a month boundary without submitting a draft', async () => {
    const changes = vi.fn();
    render(<Controlled initial="2026-11-30" changes={changes} />);
    const field = input('计划');
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const popup = await panel();
    const selected = within(popup).getByRole('button', { name: '2026-11-30' });
    act(() => selected.focus());
    fireEvent.keyDown(selected, { key: 'ArrowRight' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe('2026-12-01'),
    );
    expect(changes).not.toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(changes).not.toHaveBeenCalled();
  });

  it('keeps focus inside the whole field through a nested month Select portal', async () => {
    const blur = vi.fn();
    render(
      <>
        <DateMaterial label="计划" value="2026-11-08" onBlur={blur} />
        <button type="button">外部操作</button>
      </>,
    );
    const field = input('计划');
    act(() => field.focus());
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    const popup = await panel();
    const months = within(popup).getByRole('combobox', { name: '月份' });
    act(() => months.focus());
    fireEvent.click(months);
    const december = await screen.findByRole('option', { name: '12月' });
    expect(popup.contains(december)).toBe(false);
    act(() => december.focus());
    expect(blur).not.toHaveBeenCalled();
    fireEvent.pointerDown(december, { button: 0, pointerType: 'mouse' });
    fireEvent.click(december);
    await waitFor(() => expect(document.activeElement).toBe(months));
    expect(within(popup).getByRole('button', { name: '2026-12-08' })).toBeTruthy();
    expect(blur).not.toHaveBeenCalled();
    fireEvent.keyDown(months, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(field));
    act(() => screen.getByRole('button', { name: '外部操作' }).focus());
    await waitFor(() => expect(blur).toHaveBeenCalledOnce());
  });

  it('edits seconds through listbox keyboard navigation without leaking unconfirmed values', async () => {
    const changes = vi.fn();
    render(<Controlled initial="10:20:30" mode="time" changes={changes} />);
    fireEvent.click(choose('计划'));
    const popup = await panel();
    const seconds = within(popup).getByRole('option', { name: '30 秒' });
    act(() => seconds.focus());
    fireEvent.keyDown(seconds, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('31 秒'));
    expect(changes).not.toHaveBeenCalled();
    expect(input('计划').value).toBe('10:20:30');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('59 秒'));
    fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
    expect(changes).toHaveBeenCalledExactlyOnceWith('10:20:59');
  });

  it('uses a working portal inside a Drawer and Escape dismisses the temporal panel before the parent', async () => {
    const changes = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState<TemporalValue>('10:20:30');
      return (
        <TipProvider>
          <DrawerMaterial
            title="采购申请"
            open={open}
            onOpenChange={setOpen}
            showTrigger={false}
            showFooter={false}
          >
            <DateMaterial
              label="计划"
              mode="time"
              value={value}
              onValueChange={(next) => {
                changes(next);
                setValue(next);
              }}
            />
          </DrawerMaterial>
        </TipProvider>
      );
    }
    render(<Host />);
    const trigger = await screen.findByRole('button', { name: '选择计划' });
    fireEvent.click(trigger);
    let popup = await panel();
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('dialog', { name: '采购申请' }).contains(popup)).toBe(false);
    pickTime(popup, '秒钟', '34');
    fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
    expect(changes).toHaveBeenCalledExactlyOnceWith('10:20:34');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.querySelector('.ui-tooltip[data-open]')).toBeNull();
    fireEvent.click(trigger);
    popup = await panel();
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    pickTime(popup, '秒钟', '35');
    const focusedOption = document.activeElement!;
    fireEvent.keyDown(focusedOption, { key: 'Escape' });
    fireEvent.keyUp(focusedOption, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '计划选择面板' })).toBeNull());
    expect(screen.getByRole('dialog', { name: '采购申请' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await waitFor(() => expect(popup.isConnected).toBe(false));
    expect(document.querySelector('.ui-tooltip[data-open]')).toBeNull();
    expect(changes).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    fireEvent.keyUp(trigger, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '采购申请' })).toBeNull());
  });

  it('suppresses only programmatic return-focus tips while keeping later keyboard and hover tips usable', async () => {
    const changes = vi.fn();
    render(
      <TipProvider delay={0} closeDelay={0}>
        <Controlled initial="10:20:30" mode="time" changes={changes} />
        <button type="button">外部操作</button>
      </TipProvider>,
    );
    const trigger = choose('计划');
    fireEvent.click(trigger);
    const popup = await panel();
    await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
    pickTime(popup, '秒钟', '31');
    fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    await waitFor(() => expect(popup.isConnected).toBe(false));
    expect(document.querySelector('.ui-tooltip[data-open]')).toBeNull();
    const outside = screen.getByRole('button', { name: '外部操作' });
    act(() => outside.focus());
    fireEvent.keyDown(outside, { key: 'Tab' });
    act(() => trigger.focus());
    expect(
      (await screen.findByRole('tooltip')).closest('.ui-tooltip')?.hasAttribute('data-open'),
    ).toBe(true);
    act(() => outside.focus());
    await waitFor(() => expect(document.querySelector('.ui-tooltip[data-open]')).toBeNull());
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    expect(
      (await screen.findByRole('tooltip')).closest('.ui-tooltip')?.hasAttribute('data-open'),
    ).toBe(true);
    expect(changes).toHaveBeenCalledExactlyOnceWith('10:20:31');
  });

  it('keeps a ShadowRoot-hosted picker and its focus in the same style boundary', async () => {
    const changes = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const mount = document.createElement('div');
    root.appendChild(mount);
    const view = render(<Controlled initial="10:20:30" mode="time" changes={changes} />, {
      container: mount,
    });
    try {
      const shadow = within(root as unknown as HTMLElement);
      const trigger = shadow.getByRole('button', { name: '选择计划' });
      fireEvent.click(trigger);
      const popup = await shadow.findByRole('dialog', { name: '计划选择面板' });
      expect(popup.getRootNode()).toBe(root);
      expect(document.querySelector('[aria-label="计划选择面板"]')).toBeNull();
      pickTime(popup, '秒钟', '31');
      fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
      expect(changes).toHaveBeenCalledExactlyOnceWith('10:20:31');
      await waitFor(() => expect(root.activeElement).toBe(trigger));
      await waitFor(() =>
        expect(shadow.queryByRole('dialog', { name: '计划选择面板' })).toBeNull(),
      );
    } finally {
      view.unmount();
      host.remove();
    }
  });

  it('moves the visible calendar to the Now draft without publishing it until confirmation', async () => {
    const changes = vi.fn();
    render(<Controlled initial="2001-01-02T10:20:30" mode="datetime-local" changes={changes} />);
    fireEvent.click(choose('计划'));
    const popup = await panel();
    expect(within(popup).getByRole('button', { name: '2001-01-02' })).toBeTruthy();
    fireEvent.click(within(popup).getByRole('button', { name: '现在' }));
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    expect(within(popup).getByRole('button', { name: today })).toBeTruthy();
    expect(
      Number((within(popup).getByRole('textbox', { name: '年份' }) as HTMLInputElement).value),
    ).toBe(now.getFullYear());
    const year = within(popup).getByRole('textbox', { name: '年份' });
    fireEvent.change(year, { target: { value: '2001' } });
    fireEvent.keyDown(year, { key: 'Enter' });
    expect(
      within(popup).getByRole('button', {
        name: `2001-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      }),
    ).toBeTruthy();
    fireEvent.click(within(popup).getByRole('button', { name: '现在' }));
    expect(within(popup).getByRole('button', { name: today })).toBeTruthy();
    expect(changes).not.toHaveBeenCalled();
    expect(input('计划').value).toBe('2001-01-02 10:20:30');
    fireEvent.click(within(popup).getByRole('button', { name: '确定' }));
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.calls[0][0]).toMatch(new RegExp(`^${today}T\\d{2}:\\d{2}:\\d{2}$`));
  });

  it('does not open an interactive picker while authoring but works after switching to preview', async () => {
    const registry = { components: temporalContracts, actions: {} };
    const schema: ApplicationSchema = {
      schemaVersion: '0.1.0',
      id: 'temporal-authoring',
      title: '日期设计验证',
      entryPageId: 'page',
      dependencies: { components: { 'ui.date': '1.0.0' }, actions: {} },
      pages: [
        {
          id: 'page',
          title: '页面',
          state: [],
          children: [
            {
              id: 'date',
              component: 'ui.date',
              props: {
                label: { kind: 'literal', value: '计划' },
                value: { kind: 'literal', value: '2026-11-08' },
              },
            },
          ],
        },
      ],
    };
    const runtime = new PageRuntime(compileApplication(schema, registry), 'page');
    try {
      const view = render(
        <RuntimeRenderer runtime={runtime} materials={{ 'ui.date': DateMaterial }} designMode />,
      );
      const field = input('计划');
      fireEvent.click(field);
      fireEvent.click(choose('计划'));
      fireEvent.keyDown(field, { key: 'ArrowDown' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(runtime.getRecords()).toEqual([]);
      view.rerender(<RuntimeRenderer runtime={runtime} materials={{ 'ui.date': DateMaterial }} />);
      expect(input('计划')).toBe(field);
      fireEvent.click(choose('计划'));
      expect(await panel()).toBeTruthy();
    } finally {
      runtime.dispose();
    }
  });
});
