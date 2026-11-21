import type { ApplicationSchema, FieldDefinition } from '../packages/schema/types';

export const nameField: FieldDefinition = {
  id: 'name',
  path: ['applicant', 'name'],
  label: '姓名',
  type: 'string',
  initial: '',
  rules: [{ kind: 'required', message: '请填写姓名' }],
};
export const amountField: FieldDefinition = {
  id: 'amount',
  path: ['amount'],
  label: '金额',
  type: 'number',
  initial: null,
  rules: [
    { kind: 'required', message: '请填写金额' },
    { kind: 'min', value: 1, message: '金额至少为 1' },
  ],
};
export const formEditorApplication: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'test',
  title: '字段面板验收',
  entryPageId: 'page',
  dependencies: {
    components: {
      'ui.form': '1.0.0',
      'ui.input': '1.0.0',
      'ui.number': '1.0.0',
      'ui.button': '1.0.0',
      'ui.text': '1.0.0',
    },
    actions: {},
  },
  pages: [
    {
      id: 'page',
      title: '空白表单',
      state: [],
      children: [
        {
          id: 'form',
          component: 'ui.form',
          props: {},
          children: [
            {
              id: 'name-input',
              component: 'ui.input',
              props: {
                label: { kind: 'literal', value: '文本输入' },
                value: { kind: 'literal', value: '' },
              },
            },
            {
              id: 'amount-input',
              component: 'ui.number',
              props: {
                label: { kind: 'literal', value: '数字输入' },
                value: { kind: 'literal', value: 0 },
              },
            },
            {
              id: 'submit',
              component: 'ui.button',
              props: {
                label: { kind: 'literal', value: '提交' },
                type: { kind: 'literal', value: 'submit' },
              },
            },
          ],
        },
      ],
    },
  ],
};
