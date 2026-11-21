# 服务端列表与保存刷新

导入 `public/examples/server-records.json`，切换预览后执行首次查询。示例使用宿主注册的本地 TypeScript mock 服务，不连接外部业务系统。Schema 负责组合已有状态、表单、数据源和事件动作，不增加请求工作流 DSL。

## 分页与排序契约

`ui.pagination` 新增 `onPaginationChange({ page, pageSize })`。声明统一回调后，page 和 pageSize 都受控；改变每页条数只发一次 `{ page: 1, pageSize: nextSize }`，不再调用旧的 `onPageChange` / `onPageSizeChange`。没有统一回调时保留原行为。事件面板能配置该事件，参数通过 `event.page` 和 `event.pageSize` 读取。

`ui.table.sortMode` 支持 `client`（默认）和 `server`。server 模式只发排序事件并显示服务返回的顺序，不进行本地排序。`paginate: false` 不切片，配合独立分页组件展示服务已分页的数据。行身份继续使用 `rowKey`，行插槽保留相同行 key。

搜索、清空条件与排序先设置 page=1，再显式执行一次 query。分页先原子事件给出页码和大小，动作顺序写入两个状态后执行 query。query 返回 `{ items, total, page, pageSize, sort }`，后续动作将实际 page/pageSize 同步到页面状态，因此筛选结果减少或保存导致总数缩小时不会滞留空页。查询参数不会自动 watch，也不会因为归一化再次请求。

数据源沿用 latest-wins：后一次 query 使前一次等待和后续动作链停止。迟到响应不能覆盖列表，也不能把旧 page/pageSize 写回状态。编辑模式运行入口拒绝请求；首次预览进入才加载。

## 保存与失败恢复

点击行“编辑”时重置 `saveCommitted`，记录选中 id，通过普通表单动作回填，并打开抽屉。保存流程为 mutation → `saveCommitted=true` → query → 成功通知 → 关闭抽屉。业务 action `demo.saveRecordOnce` 是宿主 TypeScript 函数：当保存已提交时拒绝再次执行 mutation。除按钮禁用外，程序化原生表单提交也受该保护。

- 保存失败：保持输入和抽屉，允许修改后重新保存，不刷新列表。
- 保存成功但刷新失败：明确显示“保存已完成，仅列表刷新失败”，禁用保存和编辑字段。“仅重试刷新”只执行 query，成功后通知并关闭，不再 mutation。
- 查询失败：表格提供重试，已有结果保留在源快照中；加载和错误由 source 状态驱动。

保存成功的标记属于当前编辑会话内存；打开新一行重新置 false。示例不承诺真实远端写入的幂等性：生产服务仍应在服务端使用幂等键和事务，取消客户端等待不能撤销已提交写入。

## 本地验证服务

`createRecordsTransports({ rows?, delayMs? })` 每次创建独立数据集，query/save 共享该实例的数据。query 真正执行关键词过滤、稳定排序、分页和页码归一化；save 校验并更新该数据集。默认 23 条记录、220ms 延迟，请求支持 AbortSignal。

手动验证：搜索“查询失败”产生查询错误；编辑姓名包含“保存失败”产生保存/字段错误；姓名包含“刷新失败”会先完成保存，再让下一次列表刷新失败一次，用于验证只重试查询的流程。测试使用独立工厂和零延迟，不污染用户预览数据。

开发定向测试覆盖统一分页回调、server 顺序与禁切片、服务过滤和页码归一化、隔离工厂、两种保存失败、程序化重复提交、一次 size 一次请求、搜索/排序归首页、设计零请求和旧 query 归一化链停止。完整回归与浏览器交互由独立验收 Agent 在冻结快照执行。

浏览器验收画面：[服务端排序与分页](server-records-preview.png)、[已保存但刷新失败](server-records-refresh-failed.png)。表单通用错误汇总使用中性“有 N 项需要处理”，错误详情仍保留，避免把刷新错误提示为填写错误。
