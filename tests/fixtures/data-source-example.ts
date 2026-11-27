import type { ApplicationSchema, Json, Value } from '../../packages/schema/types';
import { pageHeader } from '../../src/example-header.ts';
const literal = (value: Json): Value => ({ kind: 'literal', value });
const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
export const dataSourceExample: ApplicationSchema = {
  schemaVersion: '0.1.0',
  id: 'dimlu.data-sources',
  title: '数据源内核示例',
  entryPageId: 'query',
  dependencies: {
    components: Object.fromEntries(
      ['ui.input', 'ui.button', 'ui.table', 'ui.text'].map((id) => [id, '1.0.0']),
    ),
    actions: { 'data.execute': '1.0.0', 'state.set': '1.0.0' },
    transports: { 'demo.peopleQuery': '1.0.0' },
  },
  pages: [
    {
      id: 'query',
      title: '数据源查询',
      state: [{ id: 'query', type: 'string', initial: '' }],
      dataSources: [
        {
          id: 'people',
          kind: 'query',
          transport: 'demo.peopleQuery',
          input: { query: { kind: 'stateRef', stateId: 'query' } },
          initial: { rows: [], total: 0 },
        },
      ],
      onEnter: [
        { id: 'enter-people', action: 'data.execute', input: { sourceId: literal('people') } },
      ],
      children: [
        ...pageHeader(
          'heading',
          '数据源查询',
          '仅预览时进入页面查询；修改条件后显式点击查询。输入“失败”可体验错误与重试。',
        ),
        {
          id: 'query-input',
          component: 'ui.input',
          props: {
            label: literal('查询条件'),
            value: { kind: 'stateRef', stateId: 'query' },
            placeholder: literal('姓名或部门'),
          },
          on: {
            onChange: [
              {
                id: 'update-query',
                action: 'state.set',
                input: { stateId: literal('query'), value: expression('event.target.value') },
              },
            ],
          },
        },
        {
          id: 'query-button',
          component: 'ui.button',
          props: { label: literal('查询记录') },
          on: {
            onClick: [
              {
                id: 'query-people',
                action: 'data.execute',
                input: { sourceId: literal('people') },
              },
            ],
          },
        },
        {
          id: 'query-error',
          component: 'ui.text',
          props: {
            value: expression('sources.people.error ? sources.people.error.message : ""'),
            tone: literal('muted'),
          },
        },
        {
          id: 'query-table',
          component: 'ui.table',
          props: {
            data: { kind: 'dataRef', sourceId: 'people', path: ['rows'] },
            columns: literal([
              { key: 'name', title: '姓名' },
              { key: 'department', title: '部门' },
            ]),
            rowKey: literal('id'),
            loading: expression('sources.people.loading'),
            paginate: literal(false),
          },
        },
      ],
    },
  ],
};
