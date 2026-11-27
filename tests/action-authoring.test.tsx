import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { ActionPanel } from '../src/editor/ActionPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { actionExample } from './fixtures/action-example';
import { actionOperation, changeControl, closeActionConfig, openActionConfig } from './ui-helpers';
afterEach(cleanup);
function Harness({ document }: { document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const node = findNode(page, snapshot.selection.nodeId!)!.node;
  return <ActionPanel document={document} snapshot={snapshot} node={node} />;
}
describe('action authoring drafts', () => {
  it('duplicates a call only in the draft and applies the edited copy directly from the dialog', () => {
    const doc = new EditorDocument(actionExample, registry);
    doc.setEventActions('records', 'external-submit', 'onClick', [
      {
        id: 'original-notice',
        action: 'ui.notify',
        input: { title: { kind: 'literal', value: '原消息' } },
      },
      {
        id: 'last-notice',
        action: 'ui.notify',
        input: { title: { kind: 'literal', value: '末尾消息' } },
      },
    ]);
    doc.select('records', 'external-submit');
    const getCalls = () =>
      findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'external-submit')!.node.on!
        .onClick;
    const initial = getCalls();
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={doc} />
        </EditorSessionProvider>
      </TipProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '动作 1 操作菜单' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '复制动作' }));
    expect(getCalls()).toBe(initial);
    openActionConfig(2);
    const dialog = within(screen.getByRole('dialog'));
    const title = dialog.getByRole('textbox', { name: 'title' }) as HTMLInputElement;
    expect(title.value).toBe('原消息');
    changeControl(dialog.getByLabelText('title取值方式'), 'expression');
    changeControl(dialog.getByRole('textbox', { name: 'title' }), 'state.');
    fireEvent.click(dialog.getByRole('button', { name: '应用并关闭' }));
    expect(dialog.getByRole('alert')).toBeTruthy();
    expect(getCalls()).toBe(initial);
    changeControl(dialog.getByRole('textbox', { name: 'title' }), '"副本消息"');
    fireEvent.click(dialog.getByRole('button', { name: '应用并关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const [original, copy, last] = getCalls();
    expect(original).toEqual(initial[0]);
    expect(last).toEqual(initial[1]);
    expect(copy.id).toMatch(/^action-/);
    expect(copy.id).not.toBe(original.id);
    expect(copy.action).toBe(original.action);
    expect(copy.input.title).toEqual({
      kind: 'expression',
      language: 'javascript',
      source: '"副本消息"',
    });
  });

  it('groups application methods and shows the selected method description', async () => {
    const schema = structuredClone(actionExample);
    schema.methods = [
      {
        id: 'uppercase',
        title: '转成大写',
        description: '将输入文本转换为大写。',
        source: 'return String(input.payload);',
      },
    ];
    const doc = new EditorDocument(schema, registry);
    doc.select('records', 'external-submit');
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={doc} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '添加动作' }));
    openActionConfig(1);
    fireEvent.click(screen.getByRole('combobox', { name: '动作 1 类型' }));
    const options = within(await screen.findByRole('listbox'));
    expect(options.getByText('常用动作')).toBeTruthy();
    expect(options.getByText('应用自定义方法')).toBeTruthy();
    const method = options.getByRole('option', { name: /转成大写 · app\.method\.uppercase/ });
    fireEvent.pointerDown(method, { pointerType: 'mouse', button: 0 });
    fireEvent.click(method);
    const action = within(screen.getByRole('dialog'));
    expect(action.getByText('将输入文本转换为大写。')).toBeTruthy();
    changeControl(action.getByRole('combobox', { name: '动作 1 类型' }), 'ui.notify');
    expect(action.queryByText('将输入文本转换为大写。')).toBeNull();
  });

  it('keeps unsaved event actions editable when their application method is deleted', async () => {
    const document = new EditorDocument(actionExample, registry);
    const methodId = document.createApplicationMethod('整理名称');
    document.setEventActions('records', 'external-submit', 'onClick', []);
    document.select('records', 'external-submit');
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={document} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    const add = screen.getByRole('button', { name: '添加动作' });
    const save = screen.getByRole('button', { name: '保存事件' });
    fireEvent.click(add);
    openActionConfig(1);
    changeControl(screen.getByRole('combobox', { name: '动作 1 类型' }), `app.method.${methodId}`);
    closeActionConfig();
    fireEvent.click(add);
    openActionConfig(2);
    changeControl(screen.getByRole('combobox', { name: '动作 2 类型' }), 'ui.notify');
    const notice = within(screen.getByRole('dialog'));
    changeControl(notice.getByLabelText('title取值方式'), 'literal');
    changeControl(notice.getByRole('textbox', { name: 'title' }), '保留这条通知');
    closeActionConfig();

    act(() => document.removeApplicationMethod(methodId));
    openActionConfig(1);
    const missingAction = within(screen.getByRole('dialog'));
    expect(missingAction.getByRole('status').textContent).toContain('此动作已不可用');
    closeActionConfig();
    expect(save.matches(':disabled')).toBe(true);
    await actionOperation(1, 'delete');
    expect(save.matches(':disabled')).toBe(false);
    fireEvent.click(save);
    const page = document.getSnapshot().plan.pages.get('records')!.schema;
    expect(findNode(page, 'external-submit')!.node.on?.onClick).toEqual([
      expect.objectContaining({
        action: 'ui.notify',
        input: { title: { kind: 'literal', value: '保留这条通知' } },
      }),
    ]);
  });

  it('offers application pages as navigation targets for page-event actions', async () => {
    const schema = structuredClone(actionExample);
    schema.pages.push({ id: 'record-detail', title: '记录详情', state: [], children: [] });
    const doc = new EditorDocument(schema, registry);
    doc.select('records', 'external-submit');
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={doc} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '添加动作' }));
    openActionConfig(2);
    changeControl(screen.getByRole('combobox', { name: '动作 2 类型' }), 'app.navigate');
    const pagePicker = screen.getByRole('combobox', { name: '目标页面' });
    fireEvent.click(pagePicker);
    const targetOption = await screen.findByRole('option', { name: /记录详情/ });
    fireEvent.pointerDown(targetOption, { pointerType: 'mouse', button: 0 });
    fireEvent.click(targetOption);
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(
      findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'external-submit')!.node.on!
        .onClick[1],
    ).toMatchObject({
      action: 'app.navigate',
      input: { pageId: { kind: 'literal', value: 'record-detail' } },
    });
  });

  it.each([['first.name'], ['']])(
    'preserves a state path %j when only another action changes',
    (...path: string[]) => {
      const schema = structuredClone(actionExample);
      schema.pages[0].state.push({
        id: 'record',
        type: 'object',
        initial: { 'first.name': '姓名', '': '空键' },
      });
      const doc = new EditorDocument(schema, registry);
      doc.setEventActions('records', 'external-submit', 'onClick', [
        {
          id: 'ref-notice',
          action: 'ui.notify',
          input: { title: { kind: 'stateRef', stateId: 'record', path } },
        },
        {
          id: 'other-notice',
          action: 'ui.notify',
          input: { title: { kind: 'literal', value: '原消息' } },
        },
      ]);
      doc.select('records', 'external-submit');
      render(
        <TipProvider>
          <EditorSessionProvider>
            <Harness document={doc} />
          </EditorSessionProvider>
        </TipProvider>,
      );
      openActionConfig(2);
      changeControl(screen.getByRole('textbox', { name: 'title' }), '新消息');
      closeActionConfig();
      fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
      expect(
        findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'external-submit')!.node.on!
          .onClick[0].input.title,
      ).toEqual({ kind: 'stateRef', stateId: 'record', path });
    },
  );
  it('retains invalid source across node selection and requires explicit conflict confirmation', () => {
    const doc = new EditorDocument(actionExample, registry);
    doc.select('records', 'external-submit');
    render(
      <TipProvider>
        <EditorSessionProvider>
          <Harness document={doc} />
        </EditorSessionProvider>
      </TipProvider>,
    );
    openActionConfig(1);
    changeControl(screen.getByLabelText('formId取值方式'), 'expression');
    changeControl(screen.getByRole('textbox', { name: 'formId' }), 'state.');
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => doc.select('records', 'edit-record'));
    act(() => doc.select('records', 'external-submit'));
    openActionConfig(1);
    expect((screen.getByRole('textbox', { name: 'formId' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    closeActionConfig();
    act(() => doc.setEventActions('records', 'external-submit', 'onClick', []));
    expect((screen.getByRole('button', { name: '保存事件' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    openActionConfig(1);
    changeControl(screen.getByRole('textbox', { name: 'formId' }), '"edit"');
    closeActionConfig();
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'external-submit')!.node.on!
        .onClick[0].input.formId,
    ).toEqual({ kind: 'expression', language: 'javascript', source: '"edit"' });
  });
});
