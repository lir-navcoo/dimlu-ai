import type {
  ActionCall,
  ApplicationSchema,
  Json,
  NodeSchema,
  Value,
} from '../packages/schema/types';
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const state = (stateId: string): Value => ({ kind: 'stateRef', stateId });
const action = (
  id: string,
  name: string,
  input: Record<string, Value>,
  resultTo?: string,
): ActionCall => ({ id, action: name, input, ...(resultTo ? { resultTo } : {}) });
const set = (id: string, stateId: string, value: Value) =>
  action(id, 'state.set', { stateId: literal(stateId), value });
const submitButton = (id: string, label: string, native = false): NodeSchema => ({
  id,
  component: 'ui.button',
  props: {
    label: literal(label),
    type: literal(native ? 'submit' : 'button'),
    disabled: expression('forms.edit.isSubmitting'),
  },
  ...(native
    ? {}
    : { on: { onClick: [action(id + '-submit', 'form.submit', { formId: literal('edit') })] } }),
});

export const actionExample: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'dimlu.actions',
  title: '事件与动作示例',
  entryPageId: 'records',
  dependencies: {
    components: Object.fromEntries(
      [
        'ui.heading',
        'ui.table',
        'ui.button',
        'ui.drawer',
        'ui.form',
        'ui.input',
        'ui.formStatus',
      ].map((id) => [id, '1.0.0']),
    ),
    actions: Object.fromEntries(
      [
        'state.set',
        'form.setValues',
        'form.reset',
        'form.submit',
        'demo.saveRecord',
        'ui.notify',
      ].map((id) => [id, '1.0.0']),
    ),
  },
  pages: [
    {
      id: 'records',
      title: '记录管理',
      description: '表格 → 行作用域 → 抽屉表单 → 保存并更新列表',
      state: [
        {
          id: 'records',
          type: 'array',
          initial: [
            { id: 'r1', name: '林知远', department: '研发中心' },
            { id: 'r2', name: '陈嘉宁', department: '产品设计部' },
          ],
        },
        { id: 'selectedId', type: 'string', initial: '' },
        { id: 'drawerOpen', type: 'boolean', initial: false },
      ],
      forms: [
        {
          id: 'edit',
          fields: [
            { id: 'recordId', path: ['id'], label: '记录ID', type: 'string', initial: '' },
            {
              id: 'name',
              path: ['name'],
              label: '姓名',
              type: 'string',
              initial: '',
              rules: [{ kind: 'required', message: '请填写姓名' }],
            },
            {
              id: 'department',
              path: ['department'],
              label: '部门',
              type: 'string',
              initial: '',
              rules: [{ kind: 'required', message: '请填写部门' }],
            },
          ],
        },
      ],
      children: [
        {
          id: 'heading',
          component: 'ui.heading',
          props: {
            title: literal('记录管理'),
            description: literal(
              '点击表格中的编辑。姓名包含“失败”可体验服务错误；右侧事件面板可修改动作。',
            ),
          },
        },
        {
          id: 'records-table',
          component: 'ui.table',
          props: {
            data: state('records'),
            columns: literal([
              { key: 'name', title: '姓名' },
              { key: 'department', title: '部门' },
            ]),
            rowKey: literal('id'),
            selectionMode: literal('none'),
            paginate: literal(false),
          },
          slots: {
            actions: {
              params: ['row', 'index'],
              children: [
                {
                  id: 'edit-record',
                  component: 'ui.button',
                  props: {
                    label: literal('编辑'),
                    variant: literal('secondary'),
                    disabled: expression('forms.edit.isSubmitting'),
                  },
                  on: {
                    onClick: [
                      set('select-record', 'selectedId', expression('scope.row.id')),
                      action('reset-editor', 'form.reset', { formId: literal('edit') }),
                      action('prefill-editor', 'form.setValues', {
                        formId: literal('edit'),
                        values: expression('scope.row'),
                      }),
                      set('open-editor', 'drawerOpen', literal(true)),
                    ],
                  },
                },
              ],
            },
          },
        },
        {
          id: 'record-drawer',
          component: 'ui.drawer',
          props: {
            title: literal('编辑记录'),
            description: literal('既支持表单内原生提交，也支持底部按钮通过 form.submit 提交。'),
            open: state('drawerOpen'),
            triggerLabel: literal('编辑当前记录'),
            width: literal(440),
            showFooter: literal(true),
          },
          on: { onOpenChange: [set('toggle-editor', 'drawerOpen', expression('event'))] },
          children: [
            {
              id: 'record-form',
              component: 'ui.form',
              formId: 'edit',
              props: {},
              on: {
                onSubmit: [
                  action(
                    'save-record',
                    'demo.saveRecord',
                    {
                      rows: state('records'),
                      id: state('selectedId'),
                      values: { kind: 'formValues', formId: 'edit' },
                    },
                    'records',
                  ),
                  action('saved-notice', 'ui.notify', {
                    title: literal('记录已保存'),
                    tone: literal('success'),
                  }),
                  set('close-editor', 'drawerOpen', literal(false)),
                ],
              },
              children: [
                {
                  id: 'record-name',
                  component: 'ui.input',
                  props: { placeholder: literal('请输入姓名') },
                  field: { formId: 'edit', fieldId: 'name' },
                },
                {
                  id: 'record-department',
                  component: 'ui.input',
                  props: { placeholder: literal('请输入部门') },
                  field: { formId: 'edit', fieldId: 'department' },
                },
                {
                  id: 'record-status',
                  component: 'ui.formStatus',
                  props: { formId: literal('edit') },
                },
                submitButton('save-record-button', '保存记录', true),
              ],
            },
          ],
          slots: {
            footer: { params: [], children: [submitButton('external-submit', '提交表单')] },
          },
        },
      ],
    },
  ],
};
