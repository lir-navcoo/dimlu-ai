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
const data = (path: string[]): Value => ({ kind: 'dataRef', sourceId: 'records', path });
const call = (id: string, action: string, input: Record<string, Value> = {}): ActionCall => ({
  id,
  action,
  input,
});
const set = (id: string, stateId: string, value: Value) =>
  call(id, 'state.set', { stateId: literal(stateId), value });
const query = (prefix: string): ActionCall[] => [
  call(`${prefix}-query`, 'data.execute', { sourceId: literal('records') }),
  set(`${prefix}-page`, 'page', data(['page'])),
  set(`${prefix}-size`, 'pageSize', data(['pageSize'])),
];
const complete = (prefix: string): ActionCall[] => [
  ...query(prefix),
  call(`${prefix}-notice`, 'ui.notify', {
    title: literal('记录已保存，列表已刷新'),
    tone: literal('success'),
  }),
  set(`${prefix}-close`, 'drawerOpen', literal(false)),
];
const button = (
  id: string,
  label: string,
  actions: ActionCall[],
  props: Record<string, Value> = {},
): NodeSchema => ({
  id,
  component: 'ui.button',
  props: { label: literal(label), ...props },
  on: { onClick: actions },
});
export const serverRecordsExample: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'dimlu.server-records',
  title: '服务端列表与保存刷新',
  entryPageId: 'records',
  dependencies: {
    components: Object.fromEntries(
      [
        'ui.heading',
        'ui.layout',
        'ui.input',
        'ui.number',
        'ui.button',
        'ui.table',
        'ui.pagination',
        'ui.drawer',
        'ui.form',
        'ui.formStatus',
        'ui.alert',
        'ui.text',
      ].map((id) => [id, '1.0.0']),
    ),
    actions: Object.fromEntries(
      [
        'state.set',
        'data.execute',
        'form.reset',
        'form.setValues',
        'demo.saveRecordOnce',
        'ui.notify',
      ].map((id) => [id, '1.0.0']),
    ),
    transports: { 'demo.recordsQuery': '1.0.0', 'demo.recordSave': '1.0.0' },
  },
  pages: [
    {
      id: 'records',
      title: '服务端记录管理',
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
          id: 'edit',
          fields: [
            { id: 'recordId', path: ['id'], label: '记录 ID', type: 'string', initial: '' },
            {
              id: 'name',
              path: ['name'],
              label: '姓名',
              type: 'string',
              initial: '',
              disabled: expression('state.saveCommitted'),
              rules: [{ kind: 'required', message: '请填写姓名' }],
            },
            {
              id: 'department',
              path: ['department'],
              label: '部门',
              type: 'string',
              initial: '',
              disabled: expression('state.saveCommitted'),
              rules: [{ kind: 'required', message: '请填写部门' }],
            },
            {
              id: 'amount',
              path: ['amount'],
              label: '金额',
              type: 'number',
              initial: 0,
              disabled: expression('state.saveCommitted'),
              rules: [
                { kind: 'required', message: '请填写金额' },
                { kind: 'min', value: 0, message: '金额不能小于零' },
              ],
            },
          ],
        },
      ],
      dataSources: [
        {
          id: 'records',
          kind: 'query',
          transport: 'demo.recordsQuery',
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
          id: 'saveRecord',
          kind: 'mutation',
          transport: 'demo.recordSave',
          input: { id: state('selectedId'), values: { kind: 'formValues', formId: 'edit' } },
          initial: { id: '' },
        },
      ],
      onEnter: query('enter'),
      children: [
        {
          id: 'heading',
          component: 'ui.heading',
          props: {
            title: literal('服务端记录管理'),
            description: literal(
              '查询、分页、排序由本地 mock 服务执行。搜索“查询失败”验证重试；编辑姓名为“保存失败”或“刷新失败”验证两类错误。',
            ),
          },
        },
        {
          id: 'query-filter',
          component: 'ui.input',
          props: {
            label: literal('搜索姓名或部门'),
            value: state('query'),
            placeholder: literal('输入后点击搜索，不自动请求'),
          },
          on: { onChange: [set('update-filter', 'query', expression('event.target.value'))] },
        },
        {
          id: 'query-actions',
          component: 'ui.layout',
          props: { variant: literal('row') },
          children: [
            button('search-button', '搜索', [
              set('search-first-page', 'page', literal(1)),
              ...query('search'),
            ]),
            button('clear-button', '清空筛选', [
              set('clear-filter-value', 'query', literal('')),
              set('clear-first-page', 'page', literal(1)),
              ...query('clear'),
            ]),
          ],
        },
        {
          id: 'query-status',
          component: 'ui.text',
          props: {
            value: expression(
              'sources.records.loading ? "正在查询…" : "共 " + sources.records.data.total + " 条记录"',
            ),
            tone: literal('muted'),
          },
        },
        {
          id: 'records-table',
          component: 'ui.table',
          props: {
            data: data(['items']),
            columns: literal([
              { key: 'name', title: '姓名', sortable: true },
              { key: 'department', title: '部门', sortable: true },
              { key: 'amount', title: '金额', sortable: true, align: 'right' },
            ]),
            rowKey: literal('id'),
            sort: data(['sort']),
            sortMode: literal('server'),
            paginate: literal(false),
            loading: expression('sources.records.loading'),
            error: expression('sources.records.error ? sources.records.error.message : ""'),
          },
          on: {
            onSortChange: [
              set('sort-key', 'sortKey', expression('event ? event.key : ""')),
              set('sort-direction', 'sortDirection', expression('event ? event.direction : ""')),
              set('sort-first-page', 'page', literal(1)),
              ...query('sort'),
            ],
            onRetry: query('retry-list'),
          },
          slots: {
            actions: {
              params: ['row', 'index'],
              children: [
                button(
                  'edit-record',
                  '编辑',
                  [
                    set('edit-marker', 'saveCommitted', literal(false)),
                    set('edit-id', 'selectedId', expression('scope.row.id')),
                    call('edit-reset', 'form.reset', { formId: literal('edit') }),
                    call('edit-prefill', 'form.setValues', {
                      formId: literal('edit'),
                      values: expression('scope.row'),
                    }),
                    set('edit-open', 'drawerOpen', literal(true)),
                  ],
                  { disabled: expression('forms.edit.isSubmitting') },
                ),
              ],
            },
          },
        },
        {
          id: 'records-pagination',
          component: 'ui.pagination',
          props: {
            page: state('page'),
            pageSize: state('pageSize'),
            total: data(['total']),
            disabled: expression('sources.records.loading'),
          },
          on: {
            onPaginationChange: [
              set('pagination-request-page', 'page', expression('event.page')),
              set('pagination-request-size', 'pageSize', expression('event.pageSize')),
              ...query('pagination'),
            ],
          },
        },
        {
          id: 'edit-drawer',
          component: 'ui.drawer',
          props: {
            title: literal('编辑服务端记录'),
            description: literal('保存成功后只刷新列表；刷新失败可以单独重试，无需再次保存。'),
            open: state('drawerOpen'),
            triggerLabel: literal('继续当前编辑'),
            showFooter: literal(false),
            width: literal(460),
          },
          on: { onOpenChange: [set('drawer-toggle', 'drawerOpen', expression('event'))] },
          children: [
            {
              id: 'refresh-warning',
              component: 'ui.alert',
              when: expression('state.saveCommitted && !!sources.records.error'),
              props: {
                title: literal('保存已完成，仅列表刷新失败'),
                description: literal('记录已经写入服务，请点击“仅重试刷新”，不会再次保存。'),
                tone: literal('warning'),
              },
            },
            {
              ...button('retry-refresh', '仅重试刷新', complete('retry-saved-refresh'), {
                disabled: expression('sources.records.loading || forms.edit.isSubmitting'),
              }),
              when: expression('state.saveCommitted'),
            },
            {
              id: 'record-form',
              component: 'ui.form',
              formId: 'edit',
              props: {},
              on: {
                onSubmit: [
                  call('save-record-once', 'demo.saveRecordOnce'),
                  set('save-committed', 'saveCommitted', literal(true)),
                  ...complete('save-refresh'),
                ],
              },
              children: [
                {
                  id: 'edit-name',
                  component: 'ui.input',
                  props: {},
                  field: { formId: 'edit', fieldId: 'name' },
                },
                {
                  id: 'edit-department',
                  component: 'ui.input',
                  props: {},
                  field: { formId: 'edit', fieldId: 'department' },
                },
                {
                  id: 'edit-amount',
                  component: 'ui.number',
                  props: {},
                  field: { formId: 'edit', fieldId: 'amount' },
                },
                {
                  id: 'edit-status',
                  component: 'ui.formStatus',
                  props: { formId: literal('edit') },
                },
                {
                  id: 'save-button',
                  component: 'ui.button',
                  props: {
                    label: literal('保存记录'),
                    type: literal('submit'),
                    disabled: expression('forms.edit.isSubmitting || state.saveCommitted'),
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
