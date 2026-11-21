import { exampleApplication } from '../src/examples';
import type { Value } from '../packages/schema/types';
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
/** Explicit v0.1 fixture keeps compatibility tests independent of the evolving procurement demo. */
export const flatFormApplication = structuredClone(exampleApplication);
flatFormApplication.pages[0].forms = [
  {
    id: 'purchase',
    fields: [
      {
        id: 'name',
        path: ['name'],
        label: '申请名称',
        type: 'string',
        initial: '',
        rules: [{ kind: 'required', message: '请填写申请名称' }],
      },
      {
        id: 'quantity',
        path: ['quantity'],
        label: '采购数量',
        type: 'number',
        initial: 2,
        rules: [
          { kind: 'required', message: '请填写采购数量' },
          { kind: 'min', value: 1, message: '数量至少为 1' },
          { kind: 'max', value: 999, message: '数量最多为 999' },
          {
            kind: 'expression',
            test: expr(
              'forms.purchase.values.quantity === null || forms.purchase.values.quantity % 1 === 0',
            ),
            message: '数量必须为整数',
          },
        ],
      },
      {
        id: 'price',
        path: ['price'],
        label: '预计单价 / 元',
        type: 'number',
        initial: 399,
        rules: [
          { kind: 'required', message: '请填写预计单价' },
          { kind: 'min', value: 0.01, message: '单价至少为 0.01 元' },
          {
            kind: 'expression',
            test: expr('forms.purchase.values.quantity * forms.purchase.values.price <= 50000'),
            message: '单笔采购金额不能超过 50,000 元',
          },
        ],
      },
      {
        id: 'approvalReason',
        path: ['approvalReason'],
        label: '审批说明',
        type: 'string',
        initial: '',
        when: expr('forms.purchase.values.quantity * forms.purchase.values.price > 10000'),
        disabled: expr("forms.purchase.values.name === ''"),
        rules: [{ kind: 'required', message: '超过 10,000 元，请填写审批说明' }],
      },
    ],
  },
];
flatFormApplication.pages[0].children[1].children = [
  flatFormApplication.pages[0].children[1].children![0],
];
