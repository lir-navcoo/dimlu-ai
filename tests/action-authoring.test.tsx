import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { ActionPanel } from '../src/editor/ActionPanel';
import { EditorSessionProvider } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { registry } from '../src/materials';
import { actionExample } from '../src/action-example';
import { changeControl } from './ui-helpers';
afterEach(cleanup);
function Harness({ document }: { document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const node = findNode(page, snapshot.selection.nodeId!)!.node;
  return <ActionPanel document={document} snapshot={snapshot} node={node} />;
}
describe('action authoring drafts', () => {
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
    fireEvent.click(screen.getByRole('combobox', { name: '动作 1 类型' }));
    const options = within(await screen.findByRole('listbox'));
    expect(options.getByText('常用动作')).toBeTruthy();
    expect(options.getByText('应用自定义方法')).toBeTruthy();
    const method = options.getByRole('option', { name: /转成大写 · app\.method\.uppercase/ });
    fireEvent.pointerDown(method, { pointerType: 'mouse', button: 0 });
    fireEvent.click(method);
    const action = within(screen.getByRole('region', { name: '动作 1' }));
    expect(action.getByText('将输入文本转换为大写。')).toBeTruthy();
    changeControl(action.getByRole('combobox', { name: '动作 1 类型' }), 'ui.notify');
    expect(action.queryByText('将输入文本转换为大写。')).toBeNull();
  });

  it('keeps unsaved event actions editable when their application method is deleted', () => {
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
    changeControl(screen.getByRole('combobox', { name: '动作 1 类型' }), `app.method.${methodId}`);
    fireEvent.click(add);
    changeControl(screen.getByRole('combobox', { name: '动作 2 类型' }), 'ui.notify');
    const notice = within(screen.getByRole('region', { name: '动作 2' }));
    changeControl(notice.getByLabelText('title取值方式'), 'literal');
    changeControl(notice.getByRole('textbox', { name: 'title' }), '保留这条通知');

    act(() => document.removeApplicationMethod(methodId));
    const missingAction = within(screen.getByRole('region', { name: '动作 1' }));
    expect(missingAction.getByRole('status').textContent).toContain('此动作已不可用');
    expect(save.matches(':disabled')).toBe(true);
    fireEvent.click(missingAction.getByRole('button', { name: '删除动作 1' }));
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
    changeControl(screen.getByRole('combobox', { name: '动作 2 类型' }), 'app.navigate');
    const pagePicker = screen.getByRole('combobox', { name: '目标页面' });
    fireEvent.click(pagePicker);
    const targetOption = await screen.findByRole('option', { name: /记录详情/ });
    fireEvent.pointerDown(targetOption, { pointerType: 'mouse', button: 0 });
    fireEvent.click(targetOption);
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
      changeControl(screen.getByRole('textbox', { name: 'title' }), '新消息');
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
    changeControl(screen.getByLabelText('formId取值方式'), 'expression');
    changeControl(screen.getByRole('textbox', { name: 'formId' }), 'state.');
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => doc.select('records', 'edit-record'));
    act(() => doc.select('records', 'external-submit'));
    expect((screen.getByRole('textbox', { name: 'formId' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    act(() => doc.setEventActions('records', 'external-submit', 'onClick', []));
    expect((screen.getByRole('button', { name: '保存事件' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: '确认使用草稿' }));
    changeControl(screen.getByRole('textbox', { name: 'formId' }), '"edit"');
    fireEvent.click(screen.getByRole('button', { name: '保存事件' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      findNode(doc.getSnapshot().plan.pages.get('records')!.schema, 'external-submit')!.node.on!
        .onClick[0].input.formId,
    ).toEqual({ kind: 'expression', language: 'javascript', source: '"edit"' });
  });
});
