# 数据源运行内核 v0.1

数据源负责请求和结果的唯一存储，不把查询结果复制成页面状态。内核独立于 React，宿主用正常 TypeScript 注册 transport；Schema 只引用 transport 名称、版本和参数，不保存源码。当前没有自动依赖请求、缓存、重试策略或真实业务后端。

## 页面定义与注册

```ts
const registry = createRegistry(components, actions, computations, {
  'api.people': {
    version: '1.0.0',
    input: { query: { type: 'string', required: true } },
    output: 'array',
    async execute(input, { signal }) {
      const response = await fetch('/api/people?q=' + encodeURIComponent(String(input.query)), {
        signal,
      });
      if (!response.ok) throw new Error('查询失败');
      return response.json();
    },
  },
});
```

第四个参数可选，旧注册表和旧Schema兼容。transport 只接收经过复制校验的 JSON 参数和取消信号，没有 `setState`、表单写入或通知接口。URL、鉴权、响应适配等由宿主 TypeScript 管理，示例 fetch 仅展示注册方式，不代表项目有该后端。

```json
{
  "dependencies": {
    "components": {},
    "actions": { "data.execute": "1.0.0" },
    "transports": { "api.people": "1.0.0" }
  },
  "dataSources": [
    {
      "id": "people",
      "kind": "query",
      "transport": "api.people",
      "input": { "query": { "kind": "stateRef", "stateId": "query" } },
      "initial": []
    }
  ]
}
```

上例 `dataSources` 属于页面，`dependencies` 属于应用。输入字段必须在 transport 契约中，必填字段在定义时提供默认绑定；literal 与直接引用的已知类型在编译时检查，动态值执行前再检查。`initial` 严格匹配输出类型。输出只允许有限 JSON，并按 output 校验；undefined、非有限数字、函数、带危险键的数据不会进入 source store。

默认输入仅使用页面上下文，支持页面状态、表单和数据源引用，不能读取 `event` 或 `scope`。字段变化不会自动请求，页面/行事件需要先更新状态或通过 `data.execute.input` 显式传覆盖参数。覆盖按参数名浅合并，整个输入验证通过后才开始请求。`refresh()` 重评当前定义绑定，不重放上次调用的临时覆盖值。

## 访问与动作

快照固定包含 `data`、`status: idle/loading/success/error`、`loading`、`error: null | { name, message }`。初始状态为 idle。开始请求清除旧错误、保留旧data，成功替换data，失败保留data并记录错误，取消恢复idle。所有快照和结果都复制并冻结。

- `PageRuntime.getDataSource(id)` 返回当前页面独立的 source store。
- `getDataSourcesSnapshot()` 提供页面全部数据源快照。
- `DataSourceRuntime.execute(input?, { signal }?)` 和 `refresh(options?)` 返回 JSON Promise。
- `cancel()` 停止当前等待与发布；`dispose()` 取消并销毁实例。
- `useDataSource(id)` 返回快照以及 execute / refresh / cancel，用原生React外部store订阅。

表达式使用 `sources.people.data`、`sources.people.loading`、`sources.people.error`。独立绑定 `{ "kind": "dataRef", "sourceId": "people", "path": ["rows"] }` 相对 `snapshot.data` 读取。path 是字符串数组，`["first.name"]` 与 `[""]` 保持原义。节点按 `@source:people` 精确订阅，源状态变化不广播给无关页面状态。源 ID 必须静态明确；本轮不接受动态 `sources[state.sourceId]` 或读取整个 sources 对象。

表单的 when / disabled / expression校验规则本轮明确不允许 sources 读取，避免表单条件只读一次却不随请求结果刷新；需要时先显式把业务结果写入页面状态。普通页面属性和事件参数可以直接使用数据源。

```json
{
  "id": "query-people",
  "action": "data.execute",
  "input": {
    "sourceId": { "kind": "literal", "value": "people" },
    "input": { "kind": "literal", "value": { "query": "研发" } }
  }
}
```

`data.execute` 等待请求完成，失败停止动作链，输出是transport的JSON返回值。通常直接dataRef绑定结果；确实需要业务快照时可以配置resultTo。静态sourceId、输入覆盖及已知返回类型在编译时检查，动态sourceId在执行时检查。

## 并发、取消和设计模式

query 在同 source 内采用 latest-wins，跨动作lane也生效。新请求取消旧请求，旧Promise抛AbortError，旧动作链停止，不记录成业务 action.error。transport即使忽略signal，旧结果也不能发布。不同source和不同页面实例彼此隔离。

mutation正在执行时重复调用报busy，保留第一次请求，不默认取消、不自动重放。显式cancel、页面销毁或切编辑模式仍会终止客户端等待与发布，但不能撤销服务器已经执行的写操作。宿主应尊重AbortSignal；真实写接口仍需服务端幂等设计。

设计权限落在PageRuntime和source执行入口，宿主自定义TS transport同样受控。App默认以designMode创建实例，编辑时不会执行onEnter或transport；首次预览才进入页面生命周期。切回编辑取消在途动作/源请求，迟到结果不写入；再次预览不会重复onEnter，需显式查询或重置页面重试。模式切换保持PageRuntime实例和React组件身份。`getPending()`包含直接调用source产生的等待状态。

## 本地示例与验证

导入 [data-sources.json](../public/examples/data-sources.json)，编辑态保持空表；首次进入预览加载本地注册的 `demo.peopleQuery`。输入姓名或部门后点击“查询记录”，输入“失败”显示错误，修改后再查即可恢复。该transport只查询内存fixture，不连接外部服务。

示例来源 `src/data-source-example.ts`，通过 `npm.cmd run schema:export` 同步JSON。开发测试覆盖结构/版本/类型拒绝、输入覆盖、取消与latest-wins、mutation busy、状态与订阅隔离、设计权限、Hook和dataRef渲染；完整可视化数据源配置与服务端列表分别属于后续N3、N4。
