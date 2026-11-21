import type { ApplicationSchema, Value, NodeSchema, ActionCall } from '../packages/schema/types';
const literal = (value: any): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const ref = (stateId: string): Value => ({ kind: 'stateRef', stateId });
const set = (id: string, stateId: string, value: Value): ActionCall => ({
  id,
  action: 'state.set',
  input: { stateId: literal(stateId), value },
});
const text = (id: string, value: Value, tone?: string): NodeSchema => ({
  id,
  component: 'ui.text',
  props: { value, ...(tone ? { tone: literal(tone) } : {}) },
});

export const exampleApplication: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'dimlu.starter',
  title: 'Dimlu 运行时示例',
  entryPageId: 'purchase',
  dependencies: {
    components: Object.fromEntries(
      [
        'ui.layout',
        'ui.text',
        'ui.heading',
        'ui.input',
        'ui.number',
        'ui.button',
        'ui.form',
        'ui.formStatus',
        'react.purchaseItems',
        'ui.summary',
        'ui.badge',
        'ui.record',
        'ui.empty',
        'ui.recordCard',
        'react.counter',
      ].map((id) => [id, '1.0.0']),
    ),
    actions: { 'state.set': '1.0.0', 'demo.submitPurchase': '1.0.0', 'demo.searchPeople': '1.0.0' },
    computations: { 'purchase.total': '1.0.0' },
  },
  extensions: { 'dimlu:description': 'React 页面内核的三个验证场景' },
  pages: [
    {
      id: 'purchase',
      title: '采购申请',
      description: '动态明细 · 稳定行身份 · 汇总与整单校验',
      state: [{ id: 'result', type: 'string', initial: '' }],
      forms: [
        {
          id: 'purchase',
          computed: [{ id: 'total', compute: 'purchase.total' }],
          rules: [
            {
              test: expr('forms.purchase.computed.total <= 50000'),
              message: '单笔采购金额不能超过 50,000 元',
            },
          ],
          fields: [
            {
              id: 'name',
              path: ['name'],
              label: '申请名称',
              type: 'string',
              initial: '',
              rules: [
                { kind: 'required', message: '请填写申请名称' },
                { kind: 'maxLength', value: 80, message: '名称最多 80 个字' },
              ],
            },
            {
              id: 'approvalReason',
              path: ['approvalReason'],
              label: '审批说明',
              type: 'string',
              initial: '',
              when: expr('forms.purchase.computed.total > 10000'),
              disabled: expr("forms.purchase.values.name === ''"),
              rules: [{ kind: 'required', message: '超过 10,000 元，请填写审批说明' }],
            },
          ],
          arrays: [
            {
              id: 'items',
              path: ['items'],
              label: '采购明细',
              minItems: 1,
              maxItems: 20,
              initial: [{ name: '办公设备', quantity: 2, price: 399 }],
              fields: [
                {
                  id: 'itemName',
                  path: ['name'],
                  label: '物品名称',
                  type: 'string',
                  initial: '',
                  rules: [
                    { kind: 'required', message: '请填写物品名称' },
                    { kind: 'maxLength', value: 80, message: '物品名称最多 80 个字' },
                  ],
                },
                {
                  id: 'quantity',
                  path: ['quantity'],
                  label: '采购数量',
                  type: 'number',
                  initial: 1,
                  rules: [
                    { kind: 'required', message: '请填写采购数量' },
                    { kind: 'min', value: 1, message: '数量至少为 1' },
                    { kind: 'max', value: 999, message: '数量最多为 999' },
                    {
                      kind: 'expression',
                      test: expr('scope.row.quantity === null || scope.row.quantity % 1 === 0'),
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
                      test: expr(
                        'scope.row.price === null || Math.abs(scope.row.price * 100 - Math.round(scope.row.price * 100)) < 0.000001',
                      ),
                      message: '单价最多保留两位小数',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      children: [
        {
          id: 'purchase-heading',
          component: 'ui.heading',
          props: {
            title: literal('创建采购申请'),
            description: literal('填写申请与采购明细，可新增、排序或删除；金额自动汇总。'),
          },
        },
        {
          id: 'purchase-form',
          component: 'ui.form',
          formId: 'purchase',
          props: {},
          on: {
            onReset: [set('reset-purchase-result', 'result', literal(''))],
            onSubmit: [
              {
                id: 'submit-purchase',
                action: 'demo.submitPurchase',
                input: { values: { kind: 'formValues', formId: 'purchase' } },
                resultTo: 'result',
              },
            ],
          },
          children: [
            {
              id: 'purchase-name',
              component: 'ui.input',
              field: { formId: 'purchase', fieldId: 'name' },
              props: {
                placeholder: literal('例如：设计团队办公设备采购'),
                hint: literal('简明描述用途；名称包含“失败”可测试服务端拒绝'),
              },
            },
            {
              id: 'purchase-items',
              component: 'react.purchaseItems',
              props: { formId: literal('purchase'), arrayId: literal('items') },
            },
            {
              id: 'purchase-total',
              component: 'ui.summary',
              props: {
                label: literal('预计总金额'),
                value: expr("'¥ ' + forms.purchase.computed.total"),
              },
            },
            {
              id: 'purchase-note',
              component: 'ui.layout',
              props: { variant: literal('row') },
              children: [
                {
                  id: 'purchase-badge',
                  component: 'ui.badge',
                  props: {
                    value: expr(
                      "forms.purchase.computed.total > 10000 ? '需主管审批' : '常规采购'",
                    ),
                    tone: expr("forms.purchase.computed.total > 10000 ? 'amber' : 'green'"),
                  },
                },
                text('purchase-notice', literal('超过 ¥10,000 时切换为主管审批提示'), 'muted'),
              ],
            },
            {
              id: 'purchase-reason',
              component: 'ui.input',
              field: { formId: 'purchase', fieldId: 'approvalReason' },
              props: { hint: literal('填写名称后可编辑；金额降到阈值以下时保留内容但不提交') },
            },
            {
              id: 'purchase-submit',
              component: 'ui.button',
              props: {
                label: expr("forms.purchase.isSubmitting ? '正在提交…' : '提交申请'"),
                type: literal('submit'),
                disabled: expr('forms.purchase.isSubmitting'),
              },
            },
            {
              id: 'purchase-reset',
              component: 'ui.button',
              props: {
                label: literal('重置表单'),
                type: literal('reset'),
                variant: literal('secondary'),
              },
            },
            {
              id: 'purchase-status',
              component: 'ui.formStatus',
              props: { formId: literal('purchase') },
            },
            {
              ...text('purchase-result', ref('result'), 'success'),
              when: expr("state.result !== ''"),
            },
          ],
        },
      ],
    },
    {
      id: 'people',
      title: '成员目录',
      description: '异步查询 · 循环 · 空状态',
      state: [
        { id: 'query', type: 'string', initial: '' },
        { id: 'people', type: 'array', initial: [] },
        { id: 'selected', type: 'string', initial: '' },
      ],
      onEnter: [
        {
          id: 'load-people',
          action: 'demo.searchPeople',
          input: { query: ref('query') },
          resultTo: 'people',
        },
      ],
      children: [
        {
          id: 'people-heading',
          component: 'ui.heading',
          props: {
            title: literal('找到你的协作伙伴'),
            description: literal('按姓名或部门查询，数据由本地模拟服务异步返回。'),
          },
        },
        {
          id: 'people-search',
          component: 'ui.form',
          props: {},
          on: {
            onSubmit: [
              {
                id: 'search-people',
                action: 'demo.searchPeople',
                input: { query: ref('query') },
                resultTo: 'people',
              },
            ],
          },
          children: [
            {
              id: 'people-search-row',
              component: 'ui.layout',
              props: { variant: literal('search') },
              children: [
                {
                  id: 'people-query',
                  component: 'ui.input',
                  props: {
                    label: literal('姓名或部门'),
                    value: ref('query'),
                    placeholder: literal('搜索：产品设计部'),
                  },
                  on: { onChange: [set('change-query', 'query', expr('event.target.value'))] },
                },
                {
                  id: 'people-query-button',
                  component: 'ui.button',
                  props: { label: literal('搜索成员'), type: literal('submit') },
                },
              ],
            },
          ],
        },
        text('people-count', expr("'共 ' + state.people.length + ' 位成员'"), 'muted'),
        {
          id: 'people-row',
          component: 'ui.record',
          props: { record: expr('scope.person') },
          repeat: {
            items: ref('people'),
            item: 'person',
            index: 'rowIndex',
            key: expr('scope.person.id'),
          },
          on: {
            onClick: [
              set(
                'select-person',
                'selected',
                expr("scope.person.name + ' · ' + scope.person.department"),
              ),
            ],
          },
        },
        {
          id: 'people-empty',
          component: 'ui.empty',
          props: { title: literal('没有匹配的成员') },
          when: expr('state.people.length === 0'),
        },
        {
          ...text('people-selection', expr("'已选择：' + state.selected"), 'success'),
          when: expr("state.selected !== ''"),
        },
      ],
    },
    {
      id: 'composition',
      title: '组件组合',
      description: '作用域插槽 · 原生 React 扩展',
      state: [
        {
          id: 'record',
          type: 'object',
          initial: {
            name: '林知远',
            role: '前端工程师',
            department: '研发中心',
            email: 'zhiyuan@example.com',
          },
        },
      ],
      children: [
        {
          id: 'composition-heading',
          component: 'ui.heading',
          props: {
            title: literal('组合能力，保持原生'),
            description: literal(
              'Schema 组织组件，自定义代码继续使用 React 的 JSX、Hooks 和事件。',
            ),
          },
        },
        {
          id: 'person-card',
          component: 'ui.recordCard',
          props: { record: ref('record') },
          slots: {
            header: {
              params: ['record'],
              children: [
                {
                  id: 'card-heading',
                  component: 'ui.heading',
                  props: {
                    title: expr('scope.record.name'),
                    description: expr("scope.record.department + ' / ' + scope.record.role"),
                  },
                },
              ],
            },
            body: {
              params: ['record'],
              children: [
                text('card-email', expr("'联系邮箱：' + scope.record.email")),
                text(
                  'card-description',
                  literal('卡片内容通过作用域插槽接收 record，页面负责决定如何展示。'),
                  'muted',
                ),
              ],
            },
            footer: {
              params: ['record'],
              children: [
                { id: 'card-status', component: 'ui.badge', props: { value: literal('协作中') } },
              ],
            },
          },
        },
        {
          id: 'native-react',
          component: 'react.counter',
          props: { label: literal('一个普通的 TSX 组件') },
        },
      ],
    },
  ],
};
