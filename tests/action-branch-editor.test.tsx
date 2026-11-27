import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionChainEditor } from '../src/editor/ActionPanel';
import { TipProvider } from '../src/ui/primitives';
import { EditorSessionProvider } from '../src/editor/session';
import type { ActionCall, ApplicationSchema, Json, PageSchema } from '../packages/schema/types';
import { changeControl } from './ui-helpers';

const page = (): PageSchema => ({
  id: 'page',
  title: 'Page',
  state: [{ id: 'path', type: 'string', initial: '' }],
  children: [],
});

const schema = (): ApplicationSchema => ({
  schemaVersion: '0.1.0',
  id: 'branch-editor-test',
  title: 'Branch Editor',
  entryPageId: 'page',
  dependencies: { components: {}, actions: {} },
  pages: [page()],
});

const lit = (value: Json): { kind: 'literal'; value: Json } => ({ kind: 'literal', value });

const branchChain = (): ActionCall[] => [
  {
    id: 'branch-1',
    action: 'control.branch',
    input: { when: lit(true) },
    then: [
      {
        id: 'then-notify',
        action: 'ui.notify',
        input: { title: lit('满足'), tone: lit('info') },
      },
    ],
    else: [],
  },
];

function show(existing: ActionCall[], onSave: (calls: ActionCall[]) => unknown) {
  const view = render(
    <TipProvider>
      <EditorSessionProvider>
        <ActionChainEditor
          page={page()}
          existing={existing}
          draftKey="branch-editor"
          pageScope
          saveLabel="保存事件"
          onSave={onSave}
        />
      </EditorSessionProvider>
    </TipProvider>,
  );
  const sc = () => within(view.container);
  return { view, sc };
}

describe('control.branch editor authoring', () => {
  it('flattens branch children into the list with add entries per lane', () => {
    const { view, sc } = show(branchChain(), vi.fn());
    // 分支卡片 + then 子调用卡片
    expect(sc().getByRole('button', { name: '打开动作 1 配置' })).toBeTruthy();
    expect(sc().getByRole('button', { name: '打开动作 2 配置' })).toBeTruthy();
    expect(view.container.querySelectorAll('.action-card.is-branch-child')).toHaveLength(1);
    expect(sc().getByRole('button', { name: '＋ 满足条件时' })).toBeTruthy();
    expect(sc().getByRole('button', { name: '＋ 否则' })).toBeTruthy();
  });

  it('round-trips a saved branch tree without structure loss', async () => {
    const save = vi.fn();
    const chain = branchChain();
    const { sc } = show(chain, save);
    // 修改 then 子调用的标题使草稿变脏，再保存验证结构不丢失。
    fireEvent.click(sc().getByRole('button', { name: '打开动作 2 配置' }));
    const dialog = await screen.findByRole('dialog', { name: /动作配置 · 2/ });
    const title = within(dialog).getByRole('textbox', { name: 'title' }) as HTMLInputElement;
    fireEvent.change(title, { target: { value: '已改' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    fireEvent.click(sc().getByRole('button', { name: '保存事件' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toEqual([
      {
        // 空 else 链编译后省略（语义等价于无 else）。
        ...chain[0],
        else: undefined,
        then: [{ ...chain[0].then![0], input: { title: lit('已改'), tone: lit('info') } }],
      },
    ]);
  });

  it('adds a child to the else lane and saves it into the tree', async () => {
    const save = vi.fn();
    const { sc } = show(branchChain(), save);
    fireEvent.click(sc().getByRole('button', { name: '＋ 否则' }));
    // 新子调用自动打开配置弹窗；ui.notify 需要标题，填固定值
    const dialog = await screen.findByRole('dialog', { name: /动作配置 · 3/ });
    // 默认子动作为 state.set，切换为 ui.notify 后填标题。
    changeControl(within(dialog).getByRole('combobox', { name: '动作 3 类型' }), 'ui.notify');
    // 新参数默认不设置，先切换为固定值再填标题。
    changeControl(within(dialog).getByRole('combobox', { name: 'title取值方式' }), 'literal');
    const title = within(dialog).getByRole('textbox', { name: 'title' }) as HTMLTextAreaElement;
    fireEvent.change(title, { target: { value: '否则执行' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    fireEvent.click(sc().getByRole('button', { name: '保存事件' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0][0] as ActionCall[];
    expect(saved[0].else?.[0].action).toBe('ui.notify');
    expect(saved[0].else?.[0].input.title).toEqual(lit('否则执行'));
  });

  it('removes the whole subtree when deleting a branch card', () => {
    const { sc } = show(branchChain(), vi.fn());
    fireEvent.click(sc().getByRole('button', { name: '动作 1 操作菜单' }));
    fireEvent.click(sc().getByRole('menuitem', { name: '删除动作' }));
    expect(sc().getByText('尚未配置页面进入动作。')).toBeTruthy();
    expect(sc().queryByRole('button', { name: '打开动作 2 配置' })).toBeNull();
  });
});
