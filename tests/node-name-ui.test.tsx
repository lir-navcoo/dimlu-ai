import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { displayNodeName } from '../src/editor/node-display-name';
import { PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { materials } from '../src/materials';
import { EditorDocument } from '../packages/editor/document';
import {
  lit,
  selectionApplication,
  selectionRegistry,
  selectionText,
} from './multiselection-fixture';
import {
  acceptedName,
  nameApply,
  nameAuthor,
  nameHarness,
  nameInput,
  nameKey,
} from './node-name-fixture';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const edit = (value: string) => fireEvent.change(nameInput(), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('optional author name explicit draft editing', () => {
  it('starts empty with legacy fallback placeholder and first dirty Apply commits and clears only its draft', () => {
    const h = nameHarness();
    const before = h.author.getSnapshot();
    const set = vi.spyOn(h.author, 'setNodeName');
    expect(nameInput().value).toBe('');
    expect(nameInput().placeholder).toBe('Legacy fallback');
    edit(' \r\n采购 😀 \t');
    expect(h.author.getSnapshot()).toBe(before);
    fireEvent.click(nameApply());
    expect(set).toHaveBeenCalledOnce();
    expect(acceptedName(h.author)).toBe('采购 😀');
    expect(nameInput().value).toBe('采购 😀');
    expect(screen.queryByText('有未保存草稿')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => h.author.undo());
    expect(acceptedName(h.author)).toBeUndefined();
    expect(nameInput().value).toBe('');
    act(() => h.author.redo());
    expect(nameInput().value).toBe('采购 😀');
  });
  it('allows eighty Unicode code points without an HTML UTF16 limit', () => {
    const h = nameHarness();
    const value = '😀'.repeat(80);
    expect(nameInput().hasAttribute('maxlength')).toBe(false);
    edit(value);
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBe(value);
    expect(nameInput().value).toBe(value);
  });
  it.each(['a\u0000b', 'a\u007fb', '😀'.repeat(81)])(
    'invalid name remains a local draft across unmount and return %j',
    (value) => {
      const h = nameHarness();
      const before = h.author.getSnapshot();
      edit(value);
      fireEvent.click(nameApply());
      expect(h.author.getSnapshot()).toBe(before);
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
      h.view.rerender(h.tree(h.author, true, false));
      h.view.rerender(h.tree());
      expect(nameInput().value).toBe(value);
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
      click('放弃草稿');
      expect(nameInput().value).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );
  it('clear is explicit and removes metadata while keeping business content', () => {
    const h = nameHarness({ name: 'Existing' });
    const value = h.author.getSnapshot().plan.pages.get('a')!.schema.children[0].children![0].props
      .value;
    edit('');
    expect(acceptedName(h.author)).toBe('Existing');
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBeUndefined();
    expect(nameInput().value).toBe('');
    expect(
      h.author.getSnapshot().plan.pages.get('a')!.schema.children[0].children![0].props.value,
    ).toEqual(value);
    act(() => h.author.undo());
    expect(nameInput().value).toBe('Existing');
  });
  it.each(['equal', 'clear'] as const)(
    'accepted %s no-op can clean its own local draft without losing redo',
    (kind) => {
      const h = nameHarness({ ...(kind === 'equal' ? { name: 'Name' } : {}) });
      act(() => {
        h.author.setProp('a', 'alpha', 'value', lit('Temporary'));
        h.author.undo();
      });
      const before = h.author.getSnapshot();
      edit(kind === 'equal' ? ' Name ' : '   ');
      fireEvent.click(nameApply());
      expect(h.author.getSnapshot()).toBe(before);
      expect(before.canRedo).toBe(true);
      expect(nameInput().value).toBe(kind === 'equal' ? 'Name' : '');
      expect(screen.queryByText('有未保存草稿')).toBeNull();
    },
  );
  it('unrelated prop changes preserve dirty text without source conflict', () => {
    const h = nameHarness();
    edit('Draft');
    act(() => h.author.setProp('a', 'alpha', 'value', lit('New business text')));
    expect(nameInput().value).toBe('Draft');
    expect(screen.queryByText('当前定义已变化，草稿已保留。确认后可用草稿替换此配置。')).toBeNull();
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBe('Draft');
  });
  it('external rename and Undo conflict retain draft until explicit rebase or discard', () => {
    const h = nameHarness({ name: 'Start' });
    edit('Local');
    act(() => h.author.setNodeName('a', 'alpha', 'Remote'));
    expect(nameInput().value).toBe('Local');
    expect(screen.getByText('当前定义已变化，草稿已保留。确认后可用草稿替换此配置。')).toBeTruthy();
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBe('Remote');
    click('确认使用草稿');
    fireEvent.click(nameApply());
    expect(acceptedName(h.author)).toBe('Local');
    edit('Another local');
    act(() => h.author.undo());
    expect(nameInput().value).toBe('Another local');
    expect(screen.getByText('当前定义已变化，草稿已保留。确认后可用草稿替换此配置。')).toBeTruthy();
    click('放弃草稿');
    expect(nameInput().value).toBe('Remote');
  });
  it('thrown core refusal preserves dirty input and displays local error', () => {
    const h = nameHarness();
    edit('Retained');
    const before = h.author.getSnapshot();
    vi.spyOn(h.author, 'setNodeName').mockImplementation(() => {
      throw new Error('Independent command refusal');
    });
    fireEvent.click(nameApply());
    expect(h.author.getSnapshot()).toBe(before);
    expect(nameInput().value).toBe('Retained');
    expect(screen.getByRole('alert').textContent).toContain('Independent command refusal');
  });
  it('Inspector provides one name editor outside tabs and suppresses it for multi/page selection', () => {
    const h = nameHarness({ panel: true });
    const input = nameInput();
    expect(input.closest('[role="tabpanel"]')).toBeNull();
    expect(screen.getAllByRole('textbox', { name: '编辑器名称' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: '样式' }));
    expect(nameInput()).toBe(input);
    act(() => h.author.selectMany('a', ['alpha', 'tail'], 'alpha'));
    expect(screen.queryByRole('textbox', { name: '编辑器名称' })).toBeNull();
    act(() => h.author.select('a', null));
    expect(screen.queryByRole('textbox', { name: '编辑器名称' })).toBeNull();
  });
});

describe('display-only author names preserve each legacy fallback and search', () => {
  it('named bound fields and slot nodes retain old field/content searches and duplicate-name identity', () => {
    const schema = selectionApplication();
    Object.assign(schema.dependencies.components, { 'ui.form': '1.0.0', 'ui.input': '1.0.0' });
    schema.pages[0].children.push({
      id: 'named-form',
      component: 'ui.form',
      props: {},
      formId: 'model',
      children: [
        {
          id: 'bound-input',
          component: 'ui.input',
          props: {},
          field: { formId: 'model', fieldId: 'name' },
          extensions: { [nameKey]: 'Duplicate name' },
        },
      ],
    });
    schema.pages[0].children[0].children![1].slots!.footer.children[0].children![0].extensions = {
      [nameKey]: 'Duplicate name',
    };
    const author = new EditorDocument(schema, selectionRegistry());
    author.select('a', 'alpha');
    nameHarness({ document: author, display: true });
    const search = screen.getByRole('textbox', { name: '搜索组件树' });
    for (const query of ['Name', 'bound-input', 'ui.input']) {
      fireEvent.change(search, { target: { value: query } });
      expect(
        document.querySelector('[data-editor-tree-node="bound-input"]')?.textContent,
      ).toContain('Duplicate name');
    }
    fireEvent.change(search, { target: { value: 'Slot text' } });
    expect(document.querySelector('[data-editor-tree-node="slot-leaf"]')?.textContent).toContain(
      'Duplicate name',
    );
    fireEvent.change(search, { target: { value: 'Duplicate name' } });
    const bound = within(
      document.querySelector<HTMLElement>('[data-editor-tree-node="bound-input"]')!,
    ).getByRole('button', { name: /选中.*bound-input/ });
    const slot = within(
      document.querySelector<HTMLElement>('[data-editor-tree-node="slot-leaf"]')!,
    ).getByRole('button', { name: /选中.*slot-leaf/ });
    expect(bound.getAttribute('aria-label')).not.toBe(slot.getAttribute('aria-label'));
  });
  it('metadata stays literal and leaves actual business output/compiled dependencies unchanged on a new runtime', () => {
    const author = nameAuthor();
    const beforePlan = author.getSnapshot().plan;
    const beforeNode = beforePlan.pages.get('a')!.children[0].children[0];
    const first = new PageRuntime(beforePlan, 'a', { designMode: true });
    const view = render(<RuntimeRenderer runtime={first} materials={materials} />);
    const text = view.container.textContent;
    const html = view.container.innerHTML;
    author.setNodeName('a', 'alpha', 'globalThis.nameCodeExecuted = true');
    const afterNode = author.getSnapshot().plan.pages.get('a')!.children[0].children[0];
    expect(afterNode.dependencies).toEqual(beforeNode.dependencies);
    expect(Object.keys(afterNode.props)).toEqual(Object.keys(beforeNode.props));
    first.dispose();
    const second = new PageRuntime(author.getSnapshot().plan, 'a', { designMode: true });
    view.rerender(<RuntimeRenderer runtime={second} materials={materials} />);
    expect(view.container.textContent).toBe(text);
    expect(view.container.innerHTML).toBe(html);
    expect(view.container.innerHTML).not.toContain('globalThis.nameCodeExecuted');
    expect(Object.hasOwn(globalThis, 'nameCodeExecuted')).toBe(false);
    expect(second.instanceId).not.toBe(first.instanceId);
    second.dispose();
  });
  it('pure helper honors the caller fallback without inventing content/type fallback', () => {
    const node = selectionText('identity', 'Business');
    for (const fallback of ['Field label', 'Literal title', 'Material type', ''])
      expect(displayNodeName(node, fallback)).toBe(fallback);
    node.extensions = { [nameKey]: 'Author' };
    expect(displayNodeName(node, 'Field label')).toBe('Author');
    node.extensions = { [nameKey]: ' bad' };
    expect(displayNodeName(node, 'Material type')).toBe('Material type');
  });
  it('tree and breadcrumb show author text while keeping type/identity readable and no native title', () => {
    const h = nameHarness({ name: '<b>采购筛选</b>', display: true });
    const row = document.querySelector('[data-editor-tree-node="alpha"]')!;
    expect(row.textContent).toContain('<b>采购筛选</b>');
    expect(row.querySelector('b')).toBeNull();
    const treeButton = within(row as HTMLElement).getByRole('button', { name: /选中.*alpha/ });
    expect(treeButton.getAttribute('aria-label')).toContain('文本');
    const crumb = within(screen.getByRole('navigation', { name: '组件层级' })).getByRole('button', {
      name: /选择层级.*alpha/,
    });
    expect(crumb.textContent).toBe('<b>采购筛选</b>');
    expect(treeButton.hasAttribute('title')).toBe(false);
    expect(crumb.hasAttribute('title')).toBe(false);
    expect(acceptedName(h.author)).toBe('<b>采购筛选</b>');
  });
  it.each(['Author label', 'Alpha text', 'ui.text', 'alpha', '文本'])(
    'tree keeps prior searches as well as new name search %s',
    (query) => {
      nameHarness({ name: 'Author label', display: true });
      const search = screen.getByRole('textbox', { name: /搜索/ });
      fireEvent.change(search, { target: { value: query } });
      expect(document.querySelector('[data-editor-tree-node="alpha"]')).not.toBeNull();
    },
  );
  it('unnamed tree content fallback and breadcrumb type fallback stay distinct', () => {
    nameHarness({ display: true });
    const row = document.querySelector('[data-editor-tree-node="alpha"]')!;
    expect(row.textContent).toContain('Alpha text');
    const crumb = within(screen.getByRole('navigation', { name: '组件层级' })).getByRole('button', {
      name: /选择层级.*alpha/,
    });
    expect(crumb.textContent).toBe('文本');
  });
});
