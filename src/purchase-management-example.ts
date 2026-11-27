import type {
  ActionCall,
  ApplicationSchema,
  Json,
  NodeSchema,
  Value,
} from '../packages/schema/types';
import { pageHeader } from './example-header.ts';
const lit = (value: Json): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const state = (stateId: string): Value => ({ kind: 'stateRef', stateId });
const data = (path: string[], sourceId = 'purchases'): Value => ({
  kind: 'dataRef',
  sourceId,
  path,
});
const call = (id: string, action: string, input: Record<string, Value> = {}): ActionCall => ({
  id,
  action,
  input,
});
const set = (id: string, stateId: string, value: Value) =>
  call(id, 'state.set', { stateId: lit(stateId), value });
const query = (prefix: string): ActionCall[] => [
  call(`${prefix}-execute`, 'data.execute', { sourceId: lit('purchases') }),
  set(`${prefix}-actual-page`, 'page', data(['page'])),
  set(`${prefix}-actual-size`, 'pageSize', data(['pageSize'])),
];
const complete = (prefix: string): ActionCall[] => [
  ...query(prefix),
  call(`${prefix}-notice`, 'ui.notify', { title: lit('采购申请已保存'), tone: lit('success') }),
  set(`${prefix}-close`, 'drawerOpen', lit(false)),
];
const button = (
  id: string,
  label: string,
  actions: ActionCall[],
  props: Record<string, Value> = {},
): NodeSchema => ({
  id,
  component: 'ui.button',
  props: { label: lit(label), ...props },
  on: { onClick: actions },
});
const disabled = expr('forms.purchase.isSubmitting || state.saveCommitted');
const bound = (
  id: string,
  component: string,
  fieldId: string,
  props: Record<string, Value> = {},
): NodeSchema => ({ id, component, props, field: { formId: 'purchase', fieldId } });
const fieldDisabled = expr('state.saveCommitted');

/** The product starter is a business composition; legacy runtime-boundary examples remain separate. */
export const purchaseManagementExample: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'dimlu.purchase-management',
  title: '采购申请管理',
  entryPageId: 'purchases',
  dependencies: {
    components: Object.fromEntries(
      [
        'ui.layout',
        'ui.card',
        'ui.input',
        'ui.select',
        'ui.date',
        'ui.button',
        'ui.table',
        'ui.pagination',
        'ui.drawer',
        'ui.form',
        'ui.fieldArray',
        'ui.alert',
        'ui.text',
        'ui.badge',
        'ui.divider',
      ].map((id) => [id, '1.0.0']),
    ),
    actions: Object.fromEntries(
      [
        'state.set',
        'data.execute',
        'form.reset',
        'form.setValues',
        'form.submit',
        'demo.savePurchaseOnce',
        'ui.notify',
      ].map((id) => [id, '1.0.0']),
    ),
    computations: { 'purchase.total': '1.0.0' },
    transports: { 'demo.purchasesQuery': '1.0.0', 'demo.purchaseSave': '1.0.0' },
  },
  pages: [
    {
      id: 'purchases',
      title: '采购申请管理',
      description: '查询采购申请，新建与编辑明细，校验后保存。',
      state: [
        { id: 'query', type: 'string', initial: '' },
        { id: 'page', type: 'number', initial: 1 },
        { id: 'pageSize', type: 'number', initial: 5 },
        { id: 'sortKey', type: 'string', initial: '' },
        { id: 'sortDirection', type: 'string', initial: '' },
        { id: 'selectedId', type: 'string', initial: '' },
        { id: 'drawerOpen', type: 'boolean', initial: false },
        { id: 'saveCommitted', type: 'boolean', initial: false },
      ],
      forms: [
        {
          id: 'purchase',
          computed: [{ id: 'total', compute: 'purchase.total' }],
          rules: [
            {
              test: expr('forms.purchase.computed.total <= 50000'),
              message: '单笔采购金额不能超过50,000元',
            },
          ],
          fields: [
            ...[
              ['name', '申请名称'],
              ['applicant', '申请人'],
              ['department', '所属部门'],
            ].map(([id, label]) => ({
              id,
              path: [id],
              label,
              type: 'string' as const,
              initial: '',
              disabled: fieldDisabled,
              rules: [
                { kind: 'required' as const, message: `请填写${label}` },
                { kind: 'maxLength' as const, value: 80, message: `${label}最多80字` },
              ],
            })),
            {
              id: 'purchaseDate',
              path: ['purchaseDate'],
              label: '采购日期',
              type: 'string',
              format: 'date',
              initial: '',
              disabled: fieldDisabled,
              rules: [{ kind: 'required', message: '请选择采购日期' }],
            },
            {
              id: 'approvalReason',
              path: ['approvalReason'],
              label: '审批说明',
              type: 'string',
              initial: '',
              disabled: fieldDisabled,
              when: expr('forms.purchase.computed.total > 10000'),
              rules: [{ kind: 'required', message: '超过10,000元，请填写审批说明' }],
            },
          ],
          arrays: [
            {
              id: 'items',
              path: ['items'],
              label: '采购明细',
              minItems: 1,
              maxItems: 20,
              disabled: fieldDisabled,
              initial: [{ name: '', quantity: 1, price: 0 }],
              fields: [
                {
                  id: 'itemName',
                  path: ['name'],
                  label: '物品名称',
                  type: 'string',
                  initial: '',
                  rules: [
                    { kind: 'required', message: '请填写物品名称' },
                    { kind: 'maxLength', value: 80, message: '物品名称最多80字' },
                  ],
                },
                {
                  id: 'quantity',
                  path: ['quantity'],
                  label: '数量',
                  type: 'number',
                  initial: 1,
                  rules: [
                    { kind: 'required', message: '请填写数量' },
                    { kind: 'min', value: 1, message: '数量至少为1' },
                    { kind: 'max', value: 999, message: '数量最多999' },
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
                  initial: 0,
                  rules: [
                    { kind: 'required', message: '请填写预计单价' },
                    { kind: 'min', value: 0, message: '单价不能为负数' },
                    {
                      kind: 'expression',
                      test: expr(
                        'scope.row.price === null || Math.abs(scope.row.price * 100 - Math.round(scope.row.price * 100)) < 0.000001',
                      ),
                      message: '单价最多两位小数',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      dataSources: [
        {
          id: 'purchases',
          kind: 'query',
          transport: 'demo.purchasesQuery',
          input: {
            query: state('query'),
            page: state('page'),
            pageSize: state('pageSize'),
            sortKey: state('sortKey'),
            sortDirection: state('sortDirection'),
          },
          initial: { items: [], total: 0, page: 1, pageSize: 5, sort: null },
        },
        {
          id: 'savePurchase',
          kind: 'mutation',
          transport: 'demo.purchaseSave',
          input: { id: state('selectedId'), values: { kind: 'formValues', formId: 'purchase' } },
          initial: { id: '', number: '', amount: 0 },
        },
      ],
      onEnter: query('enter'),
      children: [
        {
          id: 'purchase-workspace',
          component: 'ui.layout',
          props: { gap: lit(16) },
          style: {
            paddingTop: lit(20),
            paddingRight: lit(20),
            paddingBottom: lit(20),
            paddingLeft: lit(20),
            backgroundColor: lit('#f8fafc'),
            minWidth: lit(0),
          },
          children: [
            ...pageHeader(
              'purchase-heading',
              '采购申请管理',
              '从采购明细到金额校验，集中管理每一笔申请。演示数据，刷新页面后恢复初始记录。',
            ),
            {
              id: 'purchase-list-card',
              component: 'ui.card',
              props: {},
              style: { backgroundColor: lit('#ffffff'), paddingTop: lit(8), paddingBottom: lit(8) },
              children: [
                {
                  id: 'purchase-toolbar',
                  component: 'ui.layout',
                  props: {
                    variant: lit('row'),
                    gap: lit(10),
                    align: lit('end'),
                    justify: lit('space-between'),
                  },
                  style: { marginBottom: lit(14) },
                  children: [
                    {
                      id: 'purchase-filter',
                      component: 'ui.input',
                      props: {
                        label: lit('搜索采购申请'),
                        value: state('query'),
                        placeholder: lit('申请名称、编号、申请人或部门'),
                      },
                      style: { flexGrow: lit(1), flexBasis: lit('240px'), maxWidth: lit(420) },
                      on: { onChange: [set('update-query', 'query', expr('event.target.value'))] },
                    },
                    {
                      id: 'purchase-toolbar-buttons',
                      component: 'ui.layout',
                      props: { variant: lit('row'), gap: lit(8) },
                      children: [
                        button(
                          'search-purchases',
                          '查询',
                          [set('search-first', 'page', lit(1)), ...query('search')],
                          { disabled: expr('sources.purchases.loading') },
                        ),
                        button(
                          'clear-purchases',
                          '重置筛选',
                          [
                            set('clear-query', 'query', lit('')),
                            set('clear-first', 'page', lit(1)),
                            ...query('clear'),
                          ],
                          {
                            variant: lit('secondary'),
                            disabled: expr('sources.purchases.loading'),
                          },
                        ),
                        button(
                          'new-purchase',
                          '新建申请',
                          [
                            set('new-marker', 'saveCommitted', lit(false)),
                            set('new-id', 'selectedId', lit('')),
                            call('new-form', 'form.reset', { formId: lit('purchase') }),
                            set('new-open', 'drawerOpen', lit(true)),
                          ],
                          { disabled: expr('forms.purchase.isSubmitting') },
                        ),
                      ],
                    },
                  ],
                },
                {
                  id: 'purchase-count',
                  component: 'ui.text',
                  props: {
                    value: expr(
                      'sources.purchases.loading ? "正在加载采购申请…" : "共 " + sources.purchases.data.total + " 条采购申请"',
                    ),
                    tone: lit('muted'),
                  },
                  style: { fontSize: lit(12), marginBottom: lit(10) },
                },
                {
                  id: 'purchase-table',
                  component: 'ui.table',
                  props: {
                    data: data(['items']),
                    columns: lit([
                      { key: 'number', title: '申请编号', width: 150, sortable: true },
                      { key: 'name', title: '申请名称', width: 210 },
                      { key: 'applicant', title: '申请人' },
                      { key: 'department', title: '部门' },
                      { key: 'purchaseDate', title: '采购日期', sortable: true },
                      { key: 'amount', title: '采购金额 / 元', align: 'right', sortable: true },
                    ]),
                    rowKey: lit('id'),
                    sort: data(['sort']),
                    sortMode: lit('server'),
                    paginate: lit(false),
                    selectionMode: lit('none'),
                    loading: expr('sources.purchases.loading'),
                    error: expr('sources.purchases.error ? sources.purchases.error.message : ""'),
                  },
                  on: {
                    onSortChange: [
                      set('sort-key', 'sortKey', expr('event ? event.key : ""')),
                      set('sort-direction', 'sortDirection', expr('event ? event.direction : ""')),
                      set('sort-first', 'page', lit(1)),
                      ...query('sort'),
                    ],
                    onRetry: query('retry-list'),
                  },
                  slots: {
                    actions: {
                      params: ['row', 'index'],
                      children: [
                        button(
                          'edit-purchase',
                          '编辑',
                          [
                            set('edit-marker', 'saveCommitted', lit(false)),
                            set('edit-id', 'selectedId', expr('scope.row.id')),
                            call('edit-reset', 'form.reset', { formId: lit('purchase') }),
                            call('edit-prefill', 'form.setValues', {
                              formId: lit('purchase'),
                              values: expr('scope.row.editValues'),
                            }),
                            set('edit-open', 'drawerOpen', lit(true)),
                          ],
                          {
                            variant: lit('secondary'),
                            disabled: expr('forms.purchase.isSubmitting'),
                          },
                        ),
                      ],
                    },
                  },
                },
                {
                  id: 'purchase-pagination',
                  component: 'ui.pagination',
                  props: {
                    page: state('page'),
                    pageSize: state('pageSize'),
                    total: data(['total']),
                    disabled: expr('sources.purchases.loading'),
                  },
                  style: { marginTop: lit(14) },
                  on: {
                    onPaginationChange: [
                      set('pagination-page', 'page', expr('event.page')),
                      set('pagination-size', 'pageSize', expr('event.pageSize')),
                      ...query('pagination'),
                    ],
                  },
                },
              ],
            },
            {
              id: 'purchase-drawer',
              component: 'ui.drawer',
              props: {
                title: expr('state.selectedId ? "编辑采购申请" : "新建采购申请"'),
                description: lit('填写申请信息与采购明细，金额实时计算。'),
                open: state('drawerOpen'),
                showTrigger: lit(false),
                showFooter: lit(true),
                width: lit(720),
              },
              style: { maxWidth: lit('100%'), backgroundColor: lit('#ffffff') },
              on: { onOpenChange: [set('drawer-toggle', 'drawerOpen', expr('event'))] },
              children: [
                {
                  id: 'purchase-refresh-warning',
                  component: 'ui.alert',
                  when: expr('state.saveCommitted && !!sources.purchases.error'),
                  props: {
                    title: lit('申请已保存，仅列表刷新失败'),
                    description: lit('申请已写入，点击“仅重试刷新”即可，不会再次提交。'),
                    tone: lit('warning'),
                  },
                },
                {
                  ...button('retry-purchase-refresh', '仅重试刷新', complete('retry-saved'), {
                    disabled: expr('sources.purchases.loading || forms.purchase.isSubmitting'),
                  }),
                  when: expr('state.saveCommitted'),
                },
                {
                  id: 'purchase-form',
                  component: 'ui.form',
                  formId: 'purchase',
                  props: { readOnly: disabled, gap: lit(14) },
                  on: {
                    onSubmit: [
                      call('save-purchase-once', 'demo.savePurchaseOnce'),
                      set('mark-saved', 'saveCommitted', lit(true)),
                      set('saved-id', 'selectedId', data(['id'], 'savePurchase')),
                      ...complete('save'),
                    ],
                  },
                  children: [
                    {
                      id: 'purchase-basic-title',
                      component: 'ui.text',
                      props: { value: lit('基本信息') },
                      style: { fontWeight: lit(600), fontSize: lit(14) },
                    },
                    {
                      id: 'purchase-basics',
                      component: 'ui.layout',
                      props: { variant: lit('grid2'), gap: lit(12) },
                      children: [
                        bound('purchase-name', 'ui.input', 'name', {
                          placeholder: lit('例如：研发工位设备采购'),
                        }),
                        bound('purchase-applicant', 'ui.input', 'applicant', {
                          placeholder: lit('填写申请人姓名'),
                        }),
                        bound('purchase-department', 'ui.select', 'department', {
                          options: lit(
                            ['研发中心', '产品设计部', '运营中心', '行政管理部'].map((value) => ({
                              label: value,
                              value,
                            })),
                          ),
                          placeholder: lit('选择所属部门'),
                          clearable: lit(true),
                        }),
                        bound('purchase-date', 'ui.date', 'purchaseDate', {
                          mode: lit('date'),
                          clearable: lit(true),
                        }),
                      ],
                    },
                    { id: 'purchase-divider', component: 'ui.divider', props: {} },
                    {
                      id: 'purchase-items',
                      component: 'ui.fieldArray',
                      props: { formId: lit('purchase'), arrayId: lit('items') },
                      style: { marginTop: lit(2), marginBottom: lit(4) },
                    },
                    {
                      id: 'purchase-amount-summary',
                      component: 'ui.layout',
                      props: {
                        variant: lit('row'),
                        justify: lit('space-between'),
                        align: lit('center'),
                      },
                      style: {
                        paddingTop: lit(12),
                        paddingRight: lit(12),
                        paddingBottom: lit(12),
                        paddingLeft: lit(12),
                        backgroundColor: lit('#f1f5f9'),
                      },
                      children: [
                        {
                          id: 'purchase-amount-label',
                          component: 'ui.text',
                          props: { value: lit('申请总金额') },
                          style: { color: lit('#475569'), fontSize: lit(13) },
                        },
                        {
                          id: 'purchase-amount',
                          component: 'ui.text',
                          props: { value: expr('"¥ " + forms.purchase.computed.total') },
                          style: { fontSize: lit(23), fontWeight: lit(700), color: lit('#0f172a') },
                        },
                      ],
                    },
                    {
                      id: 'purchase-approval-hint',
                      component: 'ui.badge',
                      props: {
                        value: expr(
                          'forms.purchase.computed.total > 10000 ? "超过10,000元，需填写审批说明" : "常规采购申请"',
                        ),
                        tone: expr('forms.purchase.computed.total > 10000 ? "amber" : "green"'),
                      },
                    },
                    bound('purchase-reason', 'ui.input', 'approvalReason', {
                      multiline: lit(true),
                      rows: lit(3),
                      placeholder: lit('说明本次采购用途及必要性'),
                    }),
                    {
                      id: 'purchase-form-errors',
                      component: 'ui.alert',
                      when: expr('forms.purchase.formErrors.length > 0'),
                      props: {
                        title: lit('请检查采购金额'),
                        description: expr('forms.purchase.formErrors[0] || ""'),
                        tone: lit('error'),
                      },
                    },
                    {
                      id: 'purchase-submit-error',
                      component: 'ui.alert',
                      when: expr('!!forms.purchase.submitError && !state.saveCommitted'),
                      props: {
                        title: lit('申请尚未保存'),
                        description: expr('forms.purchase.submitError || ""'),
                        tone: lit('error'),
                      },
                    },
                  ],
                },
              ],
              slots: {
                footer: {
                  params: [],
                  children: [
                    {
                      id: 'purchase-form-actions',
                      component: 'ui.layout',
                      props: { variant: lit('row'), justify: lit('end'), gap: lit(8) },
                      children: [
                        button(
                          'cancel-purchase',
                          '取消',
                          [set('cancel-drawer', 'drawerOpen', lit(false))],
                          {
                            variant: lit('secondary'),
                            disabled: expr('forms.purchase.isSubmitting'),
                          },
                        ),
                        button(
                          'submit-purchase',
                          '提交申请',
                          [call('submit-purchase-call', 'form.submit', { formId: lit('purchase') })],
                          {
                            variant: lit('primary'),
                            label: expr('forms.purchase.isSubmitting ? "正在提交…" : "提交申请"'),
                            disabled,
                          },
                        ),
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};
