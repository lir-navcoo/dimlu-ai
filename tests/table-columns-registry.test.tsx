import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSetterRegistry, type ReactSetterProps } from '../src/editor/Setters';
import {
  acceptedColumns,
  baseColumns,
  literalColumnsHarness,
  tableHarness,
} from './table-columns-fixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('columns uses the existing immutable host registry and basic JSON safety fallback', () => {
  it('a same-id host renderer override wins and receives guarded optional permission', () => {
    let props!: ReactSetterProps;
    function HostColumns(value: ReactSetterProps) {
      props = value;
      return (
        <button onClick={() => value.onChange([{ key: 'host', title: 'Host override' }])}>
          Apply host columns
        </button>
      );
    }
    const h = tableHarness({ override: HostColumns });
    expect(Object.isFrozen(createSetterRegistry({ columns: HostColumns }))).toBe(true);
    expect(screen.queryByRole('group', { name: '表格列设置' })).toBeNull();
    expect(props.canEdit!()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply host columns' }));
    expect(acceptedColumns(h.author)).toEqual([{ key: 'host', title: 'Host override' }]);
  });

  it('throwing columns renderer falls back once to immediate basic JSON,not recursively to columns', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let calls = 0;
    function Broken(): never {
      calls++;
      throw new Error('Independent broken columns renderer');
    }
    const { author } = tableHarness({ override: Broken });
    expect(screen.getByText(/设置器无法显示/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '表格列设置' })).toBeNull();
    expect(acceptedColumns(author)).toEqual(baseColumns);
    const prior = calls;
    const next = [{ key: 'fallback', title: 'Basic JSON retains immediate semantics' }];
    fireEvent.change(screen.getByRole('textbox', { name: '表格列' }), {
      target: { value: JSON.stringify(next) },
    });
    expect(acceptedColumns(author)).toEqual(next);
    expect(calls).toBe(prior);
    expect(screen.queryByRole('button', { name: '应用列' })).toBeNull();
  });

  it('missing columns renderer uses existing JSON fallback without requiring old host prop migrations', () => {
    const { columns: unused, ...missing } = createSetterRegistry();
    expect(unused).toBeTypeOf('function');
    const { commit } = literalColumnsHarness({ registry: Object.freeze(missing) });
    expect(screen.getByText(/columns 未注册/)).toBeTruthy();
    expect(screen.queryByRole('group', { name: '表格列设置' })).toBeNull();
    const next = [{ key: 'missing', title: 'Missing renderer fallback' }];
    fireEvent.change(screen.getByRole('textbox', { name: '表格列' }), {
      target: { value: JSON.stringify(next) },
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith(next);
  });
});
