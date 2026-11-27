import { Children, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSetterRegistry } from '../src/editor/Setters';
import { changeControl } from './ui-helpers';
import {
  acceptedColumns,
  applyColumns,
  baseColumns,
  columnInput,
  jsonColumns,
  literalColumnsHarness,
  tableAuthor,
  tableHarness,
} from './table-columns-fixture';
import { lit } from './multiselection-fixture';

type Handler = (...arguments_: any[]) => unknown;
const held = vi.hoisted(() => ({
  clicks: new Map<string, Handler>(),
  rowClicks: new Map<string, Handler>(),
  inputs: new Map<string, Handler>(),
  codes: new Map<string, Handler>(),
}));
// Observe actual callbacks while returning real controls; no setter or Base UI behavior is replaced.
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Tip: (props: ComponentProps<typeof actual.Tip>) => {
      const child = props.children.props as { 'aria-label'?: string; onClick?: Handler };
      if (child['aria-label'] && child.onClick)
        held.rowClicks.set(child['aria-label'], child.onClick);
      return <actual.Tip {...props} />;
    },
    Button: (props: ComponentProps<typeof actual.Button>) => {
      const label =
        props['aria-label'] ??
        Children.toArray(props.children)
          .filter((child) => typeof child === 'string')
          .join('')
          .trim();
      if (props.onClick) held.clicks.set(label, props.onClick as Handler);
      return <actual.Button {...props} />;
    },
    Input: (props: ComponentProps<typeof actual.Input>) => {
      if (props.onChange && props['aria-label'])
        held.inputs.set(props['aria-label'], props.onChange as Handler);
      return <actual.Input {...props} />;
    },
  };
});
vi.mock('../src/ui/CodeEditor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/CodeEditor')>();
  return {
    ...actual,
    CodeEditor: (props: ComponentProps<typeof actual.CodeEditor>) => {
      held.codes.set(props.label, props.onChange);
      return <actual.CodeEditor {...props} />;
    },
  };
});
beforeEach(() => {
  held.clicks.clear();
  held.rowClicks.clear();
  held.inputs.clear();
  held.codes.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const button = (name: string) => screen.getByRole('button', { name });
const titleEdit = (value: string) =>
  fireEvent.change(columnInput(1, '标题'), { target: { value } });
const entry = (harness: ReturnType<typeof tableHarness>) =>
  harness
    .session()
    .drafts.read(
      'table-columns:a/table/columns',
      JSON.stringify(acceptedColumns(harness.author)),
      {},
    );

describe('old local callbacks protect the same session draft as the core command', () => {
  it('actual metadata setter ownership replacement and return expires old callbacks while fresh dirty Apply works', () => {
    const h = tableHarness();
    titleEdit('Metadata retained draft');
    const oldInput = held.inputs.get('列 1 标题')!;
    const oldApply = held.clicks.get('应用列')!;
    const changed = structuredClone(h.metadata);
    changed['ui.table'].properties.find((property) => property.name === 'columns')!.setter = {
      kind: 'json',
    };
    h.view.rerender(h.tree(h.author, true, h.registry, changed));
    h.view.rerender(h.tree());
    const before = entry(h);
    act(() => {
      oldInput({ target: { value: 'Old metadata edit' } });
      oldApply();
    });
    expect(entry(h)).toBe(before);
    expect(h.author.getSnapshot().canUndo).toBe(false);
    fireEvent.click(applyColumns());
    expect((acceptedColumns(h.author) as Record<string, unknown>[])[0].title).toBe(
      'Metadata retained draft',
    );
    expect(entry(h).dirty).toBe(false);
  });

  it('cosmetic metadata label replacement does not invent an author ownership transition', () => {
    const h = tableHarness();
    titleEdit('Cosmetic metadata draft');
    const oldInput = held.inputs.get('列 1 标题')!;
    const changed = structuredClone(h.metadata);
    changed['ui.table'].properties.find((property) => property.name === 'columns')!.label =
      'Host renamed columns';
    h.view.rerender(h.tree(h.author, true, h.registry, changed));
    h.view.rerender(h.tree());
    act(() => oldInput({ target: { value: 'Same ownership edit' } }));
    expect(columnInput(1, '标题').value).toBe('Same ownership edit');
    fireEvent.click(applyColumns());
    expect((acceptedColumns(h.author) as Record<string, unknown>[])[0].title).toBe(
      'Same ownership edit',
    );
    expect(entry(h).dirty).toBe(false);
  });

  it.each(['preview', 'document', 'active-drag', 'pending-drag'] as const)(
    'fresh callbacks after %s return can apply an existing dirty draft and clear only their accepted operation',
    (kind) => {
      const h = tableHarness();
      titleEdit('Dirty before transition');
      const oldInput = held.inputs.get('列 1 标题')!;
      if (kind === 'preview') {
        h.view.rerender(h.tree(h.author, false));
        h.view.rerender(h.tree());
      } else if (kind === 'document') {
        h.view.rerender(h.tree(tableAuthor()));
        h.view.rerender(h.tree());
      } else if (kind === 'active-drag') {
        act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        act(() => h.drag().cancel());
      } else {
        const pointer = new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
        });
        Object.defineProperty(pointer, 'pointerId', { value: 1 });
        fireEvent(button('Prepare columns pointer'), pointer);
        act(() => h.drag().cancel());
      }
      expect(columnInput(1, '标题').value).toBe('Dirty before transition');
      const freshPermission = h.props().canEdit!;
      expect(freshPermission()).toBe(true);
      titleEdit('Fresh callback accepted');
      const set = vi.spyOn(h.author, 'setProp');
      fireEvent.click(applyColumns());
      expect(set.mock.calls.filter((call) => call[2] === 'columns')).toHaveLength(1);
      expect((acceptedColumns(h.author) as Record<string, unknown>[])[0].title).toBe(
        'Fresh callback accepted',
      );
      expect(freshPermission()).toBe(false);
      expect(entry(h).dirty).toBe(false);
      act(() => oldInput({ target: { value: 'Old callback after new success' } }));
      expect(columnInput(1, '标题').value).toBe('Fresh callback accepted');
    },
  );

  it.each([
    'plan',
    'full-selection-return',
    'page-return',
    'preview-return',
    'document-return',
    'literal-return',
  ] as const)('%s permanently expires retained local edits/add/format/Apply callbacks', (kind) => {
    const h = tableHarness();
    titleEdit('Retained good draft');
    const oldInput = held.inputs.get('列 1 标题')!;
    const oldAdd = held.clicks.get('添加列')!;
    const oldFormat = held.clicks.get('JSON 编辑列')!;
    const oldApply = held.clicks.get('应用列')!;
    if (kind === 'plan') act(() => h.author.renamePage('b', 'New plan'));
    else if (kind === 'full-selection-return') {
      act(() => h.author.selectMany('a', ['table', 'alpha'], 'table'));
      act(() => h.author.select('a', 'table'));
    } else if (kind === 'page-return') {
      act(() => h.author.selectPage('b'));
      act(() => h.author.select('a', 'table'));
    } else if (kind === 'preview-return') {
      h.view.rerender(h.tree(h.author, false));
      h.view.rerender(h.tree());
    } else if (kind === 'document-return') {
      h.view.rerender(h.tree(tableAuthor()));
      h.view.rerender(h.tree());
    } else {
      changeControl(screen.getByRole('combobox', { name: '表格列绑定方式' }), 'expression');
      changeControl(screen.getByRole('combobox', { name: '表格列绑定方式' }), 'literal');
    }
    const before = entry(h);
    const snapshot = h.author.getSnapshot();
    act(() => {
      oldInput({ target: { value: 'Poison old edit' } });
      oldAdd();
      oldFormat();
      oldApply();
    });
    expect(entry(h)).toBe(before);
    expect(h.author.getSnapshot()).toBe(snapshot);
    expect(columnInput(1, '标题').value).toBe('Retained good draft');
  });

  it.each(['active', 'pending', 'code', 'disabled'] as const)(
    '%s invocation refuses local edits/errors and final Apply before a later render can help',
    (kind) => {
      const h = tableHarness();
      titleEdit('Do not clear');
      const oldInput = held.inputs.get('列 1 标题')!;
      const oldApply = held.clicks.get('应用列')!;
      const before = entry(h);
      let observed = false;
      const tryOld = () => {
        observed = true;
        oldInput({ target: { value: '' } });
        oldApply();
      };
      if (kind === 'pending') {
        h.duringPending(tryOld);
        const pointer = new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 10,
          clientY: 10,
        });
        Object.defineProperty(pointer, 'pointerId', { value: 1 });
        fireEvent(button('Prepare columns pointer'), pointer);
      } else {
        if (kind === 'active')
          act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        else if (kind === 'disabled') h.view.rerender(h.tree(h.author, false));
        else
          act(() =>
            h.author.setPageCode('a', {
              ...h.author.getSnapshot().plan.pages.get('a')!.schema.code!,
              enabled: true,
            }),
          );
        act(tryOld);
      }
      expect(observed).toBe(true);
      expect(entry(h)).toBe(before);
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
      expect(acceptedColumns(h.author)).toEqual(baseColumns);
      if (kind === 'code') {
        expect(screen.getByRole('tab', { name: '页面代码', selected: true })).toBeTruthy();
        expect(screen.queryByRole('textbox', { name: '列 1 标题' })).toBeNull();
        const code = h.author.getSnapshot().plan.pages.get('a')!.schema.code!;
        act(() => h.author.setPageCode('a', { ...code, enabled: false }));
        expect(entry(h)).toBe(before);
      }
      expect(columnInput(1, '标题').value).toBe('Do not clear');
      expect(screen.queryAllByRole('alert')).toHaveLength(0);
    },
  );

  it('old format callbacks stay dead after rows -> JSON -> rows and never overwrite current content', () => {
    const h = tableHarness();
    titleEdit('Current rows');
    const firstRowsInput = held.inputs.get('列 1 标题')!;
    fireEvent.click(button('JSON 编辑列'));
    const oldCode = held.codes.get('表格列 JSON')!;
    fireEvent.change(jsonColumns(), {
      target: { value: '[{"key":"current","title":"Current JSON"}]' },
    });
    fireEvent.click(button('结构化编辑列'));
    const before = entry(h);
    act(() => {
      firstRowsInput({ target: { value: 'Old rows resurrected' } });
      oldCode('[]');
    });
    expect(entry(h)).toBe(before);
    expect(columnInput(1, '标题').value).toBe('Current JSON');
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });

  it('a removed row callback cannot edit,move or delete the row that took its old array index', () => {
    const h = tableHarness();
    titleEdit('Removed row draft');
    const oldInput = held.inputs.get('列 1 标题')!;
    const oldRemove = held.rowClicks.get('删除列 1')!;
    const oldMove = held.rowClicks.get('下移列 1')!;
    fireEvent.click(button('删除列 1'));
    const before = entry(h);
    act(() => {
      oldInput({ target: { value: 'Poison successor' } });
      oldMove();
      oldRemove();
    });
    expect(entry(h)).toBe(before);
    expect(columnInput(1, '标题').value).toBe('Amount');
  });

  it('old stale rebase/discard callbacks cannot clear or rebase another permission generation', () => {
    const h = tableHarness();
    titleEdit('Conflict retained');
    act(() => h.author.setProp('a', 'table', 'columns', lit([{ key: 'remote', title: 'Remote' }])));
    const oldRebase = held.clicks.get('确认使用草稿')!;
    const oldDiscard = held.clicks.get('放弃草稿')!;
    h.view.rerender(h.tree(h.author, false));
    h.view.rerender(h.tree());
    const before = entry(h);
    act(() => {
      oldRebase();
      oldDiscard();
    });
    expect(entry(h)).toBe(before);
    expect(columnInput(1, '标题').value).toBe('Conflict retained');
    expect(applyColumns().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/当前定义已变化/)).toBeTruthy();
  });

  it('guard-refused parent onChange neither calls the document nor ends a current group', () => {
    const h = tableHarness();
    const old = h.props();
    act(() => h.author.renamePage('b', 'Changed plan'));
    const before = h.author.getSnapshot();
    const end = vi.spyOn(h.author, 'endGroup');
    const set = vi.spyOn(h.author, 'setProp');
    act(() => {
      expect(old.canEdit!()).toBe(false);
      expect(old.onChange(baseColumns)).toBe(false);
    });
    expect(h.author.getSnapshot()).toBe(before);
    expect(end).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('host override replacement and return cannot reactivate retained columns callbacks', () => {
    const h = tableHarness();
    titleEdit('Host lifetime draft');
    const oldInput = held.inputs.get('列 1 标题')!;
    const oldApply = held.clicks.get('应用列')!;
    const replacement = createSetterRegistry({ columns: () => <p>Replacement columns host</p> });
    h.view.rerender(h.tree(h.author, true, replacement));
    h.view.rerender(h.tree());
    const before = entry(h);
    act(() => {
      oldInput({ target: { value: 'Old host edit' } });
      oldApply();
    });
    expect(entry(h)).toBe(before);
    expect(columnInput(1, '标题').value).toBe('Host lifetime draft');
    expect(h.author.getSnapshot().canUndo).toBe(false);
  });
});

describe('successful operation reset lease is bounded to its original key and format', () => {
  it('synchronous successful host change cannot reset a different already-dirty draft key', () => {
    let afterCommit = () => {};
    const h = literalColumnsHarness({
      onChange: () => {
        afterCommit();
        return true;
      },
    });
    titleEdit('Original key draft');
    h.view.rerender(h.tree(baseColumns, undefined, 'another/columns'));
    titleEdit('Other key draft');
    h.view.rerender(h.tree());
    afterCommit = () =>
      flushSync(() => h.view.rerender(h.tree(baseColumns, undefined, 'another/columns')));
    fireEvent.click(applyColumns());
    expect(columnInput(1, '标题').value).toBe('Other key draft');
    expect(
      h.session().drafts.read('table-columns:another/columns', JSON.stringify(baseColumns), {})
        .dirty,
    ).toBe(true);
    expect(
      h.session().drafts.read('table-columns:independent/columns', JSON.stringify(baseColumns), {})
        .dirty,
    ).toBe(true);
  });

  it('synchronous successful host format switch cannot clear the new JSON format draft', () => {
    const h = literalColumnsHarness({
      onChange: () => {
        fireEvent.click(button('JSON 编辑列'));
        return true;
      },
    });
    titleEdit('In-flight accepted rows');
    fireEvent.click(applyColumns());
    expect(JSON.parse(jsonColumns().value)[0].title).toBe('In-flight accepted rows');
    expect(
      h.session().drafts.read('table-columns:independent/columns', JSON.stringify(baseColumns), {})
        .dirty,
    ).toBe(true);
  });
});
