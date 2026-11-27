import { changeControl, showStructure } from './ui-helpers';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { formEditorApplication } from './form-editor-fixture';

afterEach(cleanup);
const change = (label: string, value: string) => changeControl(screen.getByLabelText(label), value);
function setup() {
  seedLegacyProject();
  render(<App />);
  fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
  change('应用定义 · JSON', JSON.stringify(formEditorApplication));
  fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
  fireEvent.click(screen.getByRole('button', { name: '选中 表单容器 form' }));
}
function createModel() {
  fireEvent.click(screen.getByRole('button', { name: '创建表单模型' }));
  change('新表单 ID', 'model');
  change('字段 ID', 'name');
  change('字段名称', '姓名');
  fireEvent.click(screen.getByRole('button', { name: '＋ 添加校验规则' }));
  fireEvent.click(screen.getByRole('button', { name: '创建并绑定表单' }));
}
function selectName() {
  showStructure();
  fireEvent.click(screen.getByRole('button', { name: '选中 文本输入 name-input' }));
}
const binding = (fieldId: string) => JSON.stringify(['model', fieldId]);

describe('field binding panel', () => {
  it('authors a form, binds text and numeric inputs, validates and submits without editing JSON definitions', async () => {
    setup();
    createModel();
    expect(screen.getByLabelText('绑定表单').getAttribute('data-value')).toBe('model');
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '表单模型' }));
    const fieldSearch = screen.getByRole('textbox', { name: '搜索表单字段' });
    const nameFieldRow = screen.getByRole('button', { name: '编辑字段 model/name' });
    expect(nameFieldRow.textContent).toContain('name · 文本 · name');
    changeControl(fieldSearch, 'NAME');
    expect(screen.getByText('1/1')).toBeTruthy();
    fireEvent.keyDown(fieldSearch, { key: 'Escape' });
    expect((fieldSearch as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '编辑字段 model/name' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭字段设置' }));
    changeControl(fieldSearch, 'no-matching-field');
    expect(screen.getByText('已保留当前编辑字段')).toBeTruthy();
    expect(screen.getByRole('button', { name: '编辑字段 model/name' })).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
    changeControl(fieldSearch, '');
    selectName();
    change('绑定字段', binding('name'));
    expect(screen.queryByLabelText('输入值绑定方式')).toBeNull();
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).readOnly).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: '选中 数字输入 amount-input' }));
    fireEvent.click(screen.getByLabelText('绑定字段'));
    expect(screen.queryByRole('option', { name: /姓名/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建并绑定字段' }));

    const newFieldDialog = screen.getByRole('dialog', { name: '新建并绑定字段' });
    const newFieldScroll = newFieldDialog.querySelector('.field-definition-fields');
    const newFieldActions = newFieldDialog.querySelector('.field-definition-actions');
    expect(newFieldScroll?.contains(screen.getByRole('textbox', { name: '字段 ID' }))).toBe(true);
    expect(newFieldActions?.contains(screen.getByRole('button', { name: '创建并绑定字段' }))).toBe(
      true,
    );
    const fieldDialog = within(newFieldDialog);
    changeControl(fieldDialog.getByLabelText('字段 ID'), 'amount');
    changeControl(fieldDialog.getByLabelText('字段名称'), '金额');
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加校验规则' }));
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加校验规则' }));
    change('规则 2 类型', 'min');
    change('规则 2 校验值', '1');
    change('规则 2 错误提示', '金额至少为 1');
    fireEvent.click(screen.getByRole('button', { name: '创建并绑定字段' }));
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(binding('amount'));
    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '表单模型' }));
    changeControl(fieldSearch, 'amount');
    expect(screen.getByRole('button', { name: '编辑字段 model/amount' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    expect(screen.getByText('请填写姓名')).toBeTruthy();
    expect(screen.getByText('请填写金额')).toBeTruthy();
    changeControl(screen.getByRole('textbox', { name: '姓名' }), '张三');
    changeControl(screen.getByRole('spinbutton', { name: '金额' }), '0');
    expect(screen.getByText('金额至少为 1')).toBeTruthy();
    changeControl(screen.getByRole('spinbutton', { name: '金额' }), '120');
    fireEvent.click(screen.getByRole('tab', { name: '页面状态' }));
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await waitFor(() => expect(screen.getByText(/"isSubmitSuccessful": true/)).toBeTruthy());
    expect(screen.getByText(/"amount": 120/)).toBeTruthy();
    expect(screen.getByText(/"name": "张三"/)).toBeTruthy();
  }, 30_000);
  it('retains invalid drafts and preview, applies field edits once and supports undo and unbinding', () => {
    setup();
    createModel();
    selectName();
    change('绑定字段', binding('name'));
    const input = screen.getByRole('textbox', { name: '姓名' });
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    const editFieldDialog = screen.getByRole('dialog', { name: '字段设置' });
    expect(editFieldDialog).toBeTruthy();
    const editFieldScroll = editFieldDialog.querySelector('.field-definition-fields');
    const editFieldActions = editFieldDialog.querySelector('.field-definition-actions');
    expect(editFieldScroll?.contains(screen.getByRole('textbox', { name: '字段名称' }))).toBe(true);
    expect(editFieldActions?.contains(screen.getByRole('button', { name: '保存字段设置' }))).toBe(
      true,
    );
    change('字段名称', '');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    expect(screen.getByRole('alert').textContent).toContain('请填写字段名称');
    expect(screen.getByRole('textbox', { name: '姓名', hidden: true })).toBe(input);
    change('字段名称', '联系人');
    change('字段默认值', '默认姓名');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    expect((screen.getByRole('textbox', { name: '联系人' }) as HTMLInputElement).value).toBe(
      '默认姓名',
    );
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    expect((screen.getByLabelText('字段名称') as HTMLInputElement).value).toBe('姓名');
    expect((screen.getByLabelText('字段默认值') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: '关闭字段设置' }));
    change('绑定字段', '');
    expect(screen.getByLabelText('输入值绑定方式')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    expect(screen.getByLabelText('绑定字段').getAttribute('data-value')).toBe(binding('name'));
  });
  it('edits boolean field conditions and rejects invalid conditions before applying them', () => {
    setup();
    createModel();
    selectName();
    change('绑定字段', binding('name'));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    change('显示条件取值方式', 'expression');
    change('显示条件', "forms.model.values.name === ''");
    change('禁用条件取值方式', 'stateRef');
    change('禁用条件页面状态', 'enabled');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    const readField = () =>
      JSON.parse((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value).pages[0]
        .forms[0].fields[0];
    const field = readField();
    expect(field.when).toEqual({
      kind: 'expression',
      language: 'javascript',
      source: "forms.model.values.name === ''",
    });
    expect(field.disabled).toEqual({ kind: 'stateRef', stateId: 'enabled' });
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    const nameInput = screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '编辑模式' }));
    selectName();
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    expect((screen.getByLabelText('显示条件') as HTMLTextAreaElement).value).toBe(
      field.when.source,
    );
    expect(screen.getByLabelText('禁用条件页面状态').getAttribute('data-value')).toBe('enabled');
    change('显示条件', 'scope.row.visible');
    change('禁用条件取值方式', 'unset');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    expect(screen.getByRole('alert').textContent).toContain('字段条件不能读取循环或插槽作用域');
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭字段设置' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(readField()).toEqual(field);

    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '表单模型' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段 model/name' }));
    change('显示条件取值方式', 'literal');
    expect(
      screen.getByRole('checkbox', { name: '显示条件固定值' }).getAttribute('aria-checked'),
    ).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    expect(readField().when).toEqual({ kind: 'literal', value: false });
    expect(readField()).not.toHaveProperty('disabled');
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    expect(screen.queryByRole('textbox', { name: '姓名' })).toBeNull();
  });
  it('shows blockers for field deletion and preserves expression rules while editing ordinary settings', () => {
    seedLegacyProject();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '选中 文本输入 purchase-reason' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑字段设置' }));
    const when = (screen.getByLabelText('显示条件') as HTMLTextAreaElement).value;
    const disabled = (screen.getByLabelText('禁用条件') as HTMLTextAreaElement).value;
    expect(when).toBe('forms.purchase.computed.total > 10000');
    expect(disabled).toBe("forms.purchase.values.name === ''");
    change('字段名称', '采购说明');
    fireEvent.click(screen.getByRole('button', { name: '保存字段设置' }));

    fireEvent.click(screen.getByRole('tab', { name: '数据' }));
    fireEvent.click(screen.getByRole('tab', { name: '表单模型' }));
    fireEvent.click(screen.getByRole('button', { name: '删除字段 purchase/approvalReason' }));
    expect(screen.getByRole('dialog', { name: '删除表单字段？' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '删除字段 purchase/approvalReason' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(screen.getByRole('dialog', { name: '删除表单字段？' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('purchase-reason');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    const app = JSON.parse((screen.getByLabelText('应用定义 · JSON') as HTMLTextAreaElement).value);
    const field = app.pages[0].forms[0].fields.find(
      (f: { id: string }) => f.id === 'approvalReason',
    );
    expect(field.label).toBe('采购说明');
    expect(field.when).toEqual({ kind: 'expression', language: 'javascript', source: when });
    expect(field.disabled).toEqual({
      kind: 'expression',
      language: 'javascript',
      source: disabled,
    });
    expect(field.rules[0].kind).toBe('required');
  });
});
