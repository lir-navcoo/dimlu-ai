import { Children, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lit } from './multiselection-fixture';
import { acceptedName, nameApply, nameAuthor, nameHarness, nameInput } from './node-name-fixture';
type Handler = (...args: any[]) => unknown;
const held = vi.hoisted(() => ({
  authoredClicks: new Map<string, Handler>(),
  clicks: new Map<string, Handler>(),
  inputs: new Map<string, Handler>(),
  focus: new Map<string, Handler>(),
}));
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Tip: (props: ComponentProps<typeof actual.Tip>) => {
      const child = props.children.props as { 'aria-label'?: string; onClick?: Handler };
      if (child['aria-label'] && child.onClick)
        held.authoredClicks.set(child['aria-label'], child.onClick);
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
      const label = props['aria-label'];
      if (label && props.onChange) held.inputs.set(label, props.onChange as Handler);
      if (label && props.onFocus) held.focus.set(label, props.onFocus as Handler);
      return <actual.Input {...props} />;
    },
  };
});
beforeEach(() => {
  held.authoredClicks.clear();
  held.clicks.clear();
  held.inputs.clear();
  held.focus.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const edit = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const entry = (h: ReturnType<typeof nameHarness>, node = 'alpha') =>
  h.session().drafts.read(`node-name:a/${node}`, 'independent-inspection-only-dirty', {});
const button = (name: string) => screen.getByRole('button', { name });
const pointer = () => {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
};

describe('author name retained callbacks permanently expire across authority return', () => {
  it.each([
    'plan',
    'plan-undo-return',
    'selection-return',
    'full-selection-return',
    'page-return',
    'preview-return',
    'document-return',
    'active-drag-return',
    'pending-drag-return',
    'code-return',
    'unmount-return',
  ] as const)(
    '%s cannot revive old edit/error/Apply/focus callbacks; fresh dirty Apply remains available',
    (kind) => {
      const h = nameHarness();
      edit('Retained local');
      const oldInput = held.inputs.get('编辑器名称')!,
        oldApply = held.authoredClicks.get('应用编辑器名称')!,
        oldFocus = held.focus.get('编辑器名称');
      expect(oldInput).toBeTypeOf('function');
      expect(oldApply).toBeTypeOf('function');
      if (kind === 'plan' || kind === 'plan-undo-return') {
        act(() => h.author.renamePage('b', 'Changed'));
        if (kind === 'plan-undo-return') act(() => h.author.undo());
      } else if (kind === 'selection-return') {
        act(() => h.author.select('a', 'tail'));
        act(() => h.author.select('a', 'alpha'));
      } else if (kind === 'full-selection-return') {
        act(() => h.author.selectMany('a', ['root', 'alpha', 'tail'], 'alpha'));
        act(() => h.author.select('a', 'alpha'));
      } else if (kind === 'page-return') {
        act(() => h.author.select('b', 'shared'));
        act(() => h.author.select('a', 'alpha'));
      } else if (kind === 'preview-return') {
        h.view.rerender(h.tree(h.author, false));
        h.view.rerender(h.tree());
      } else if (kind === 'document-return') {
        h.view.rerender(h.tree(nameAuthor()));
        h.view.rerender(h.tree());
      } else if (kind === 'active-drag-return') {
        act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
        act(() => h.drag().cancel());
      } else if (kind === 'pending-drag-return') {
        fireEvent(button('Prepare name pointer'), pointer());
        act(() => h.drag().cancel());
      } else if (kind === 'code-return') {
        act(() =>
          h.author.setPageCode('a', {
            ...h.author.getSnapshot().plan.pages.get('a')!.schema.code!,
            enabled: true,
          }),
        );
        act(() => h.author.undo());
      } else {
        h.view.rerender(h.tree(h.author, true, false));
        h.view.rerender(h.tree());
      }
      const before = entry(h),
        snapshot = h.author.getSnapshot();
      const external = screen.getByRole('textbox', { name: 'Name external input' });
      external.focus();
      act(() => {
        oldInput({ target: { value: 'Bad\u0000retained' } });
        oldApply();
        oldFocus?.({ target: nameInput(), currentTarget: nameInput() });
      });
      expect(entry(h)).toBe(before);
      expect(h.author.getSnapshot()).toBe(snapshot);
      expect(nameInput().value).toBe('Retained local');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.activeElement).toBe(external);
      const set = vi.spyOn(h.author, 'setNodeName');
      fireEvent.click(nameApply());
      expect(set).toHaveBeenCalledOnce();
      expect(acceptedName(h.author)).toBe('Retained local');
      expect(screen.queryByText('有未保存草稿')).toBeNull();
      act(() => oldInput({ target: { value: 'Old after success' } }));
      expect(nameInput().value).toBe('Retained local');
    },
  );
  it.each([
    'active',
    'pending',
    'disabled',
    'code',
    'plan-before-render',
    'selection-before-render',
  ] as const)('%s live mismatch rejects old local write and core call before rerender', (kind) => {
    const h = nameHarness({ frozen: kind.endsWith('before-render') });
    edit('Still local');
    const oldInput = held.inputs.get('编辑器名称')!,
      oldApply = held.authoredClicks.get('应用编辑器名称')!;
    const before = entry(h);
    const set = vi.spyOn(h.author, 'setNodeName');
    let observed = false;
    const invoke = () => {
      observed = true;
      oldInput({ target: { value: 'Poison\u0000' } });
      oldApply();
    };
    if (kind === 'pending') {
      h.duringPending(invoke);
      fireEvent(button('Prepare name pointer'), pointer());
    } else {
      if (kind === 'active') act(() => h.drag().begin({ kind: 'material', component: 'ui.text' }));
      else if (kind === 'disabled') h.view.rerender(h.tree(h.author, false));
      else if (kind === 'code')
        act(() =>
          h.author.setPageCode('a', {
            ...h.author.getSnapshot().plan.pages.get('a')!.schema.code!,
            enabled: true,
          }),
        );
      else if (kind === 'plan-before-render')
        act(() => h.author.renamePage('b', 'New actual plan'));
      else act(() => h.author.selectMany('a', ['alpha', 'tail'], 'alpha'));
      act(invoke);
    }
    expect(observed).toBe(true);
    expect(entry(h)).toBe(before);
    expect(set).not.toHaveBeenCalled();
    expect(acceptedName(h.author)).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['preview', 'document', 'plan-return'] as const)(
    'old conflict rebase/discard stays dead after %s roundtrip',
    (kind) => {
      const h = nameHarness();
      edit('Retained conflict');
      act(() => h.author.setNodeName('a', 'alpha', 'Remote'));
      const rebase = held.clicks.get('确认使用草稿')!,
        discard = held.clicks.get('放弃草稿')!;
      expect(rebase).toBeTypeOf('function');
      expect(discard).toBeTypeOf('function');
      if (kind === 'preview') {
        h.view.rerender(h.tree(h.author, false));
        h.view.rerender(h.tree());
      } else if (kind === 'document') {
        h.view.rerender(h.tree(nameAuthor('Remote')));
        h.view.rerender(h.tree());
      } else {
        act(() => h.author.renamePage('b', 'Intermediate'));
        act(() => h.author.undo());
      }
      const before = entry(h),
        snapshot = h.author.getSnapshot();
      act(() => {
        rebase();
        discard();
      });
      expect(entry(h)).toBe(before);
      expect(h.author.getSnapshot()).toBe(snapshot);
      expect(nameInput().value).toBe('Retained conflict');
      expect(
        screen.getByText('当前定义已变化，草稿已保留。确认后可用草稿替换此配置。'),
      ).toBeTruthy();
      fireEvent.click(button('确认使用草稿'));
      fireEvent.click(nameApply());
      expect(acceptedName(h.author)).toBe('Retained conflict');
    },
  );
  it('same context rerenders and initial pre-layout false do not expire fresh callbacks spuriously', () => {
    const h = nameHarness();
    const input = held.inputs.get('编辑器名称')!,
      apply = held.authoredClicks.get('应用编辑器名称')!;
    h.view.rerender(h.tree());
    h.view.rerender(h.tree());
    act(() => input({ target: { value: 'First current callback' } }));
    act(() => apply());
    expect(acceptedName(h.author)).toBe('First current callback');
    expect(screen.queryByText('有未保存草稿')).toBeNull();
  });
  it('synchronous accepted commit cannot clear the dirty draft now belonging to another node', () => {
    const h = nameHarness();
    edit('Alpha draft');
    act(() => h.author.select('a', 'tail'));
    edit('Tail draft');
    act(() => h.author.select('a', 'alpha'));
    const original = h.author.setNodeName;
    vi.spyOn(h.author, 'setNodeName').mockImplementation((...args) => {
      const result = original(...args);
      flushSync(() => h.author.select('a', 'tail'));
      return result;
    });
    fireEvent.click(nameApply());
    expect(nameInput().value).toBe('Tail draft');
    expect(entry(h, 'tail').dirty).toBe(true);
    expect(entry(h, 'alpha').dirty).toBe(true);
  });
  it('a synchronous document replacement cannot lend its accepted receipt to same-key dirty draft', () => {
    const h = nameHarness();
    edit('Shared draft');
    const other = nameAuthor();
    const original = h.author.setNodeName;
    vi.spyOn(h.author, 'setNodeName').mockImplementation((...args) => {
      const result = original(...args);
      flushSync(() => h.view.rerender(h.tree(other)));
      return result;
    });
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBe('Shared draft');
    expect(acceptedName(other)).toBeUndefined();
    expect(nameInput().value).toBe('Shared draft');
    expect(entry(h).dirty).toBe(true);
  });
  it('unrelated props do not make draft stale, yet expire precommit old local callbacks', () => {
    const h = nameHarness();
    edit('Draft');
    const input = held.inputs.get('编辑器名称')!;
    act(() => h.author.setProp('a', 'alpha', 'value', lit('Other')));
    const before = entry(h);
    act(() => input({ target: { value: 'Old plan' } }));
    expect(entry(h)).toBe(before);
    expect(screen.queryByText(/当前定义已变化/)).toBeNull();
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBe('Draft');
  });
});
