# 数据配置面板 v0.1

左侧“数据”分为页面状态、表单模型、数据源三个二级页签。复用现有全高外壳和内容滚动，配置控件使用紧凑 Base UI，图标悬浮提示使用 Tooltip。表单模型沿用字段、明细及绑定配置；从属性面板点击“编辑字段设置”会打开对应表单模型页签。

## 页面状态

点击“新建状态”，填写状态 ID、类型和 JSON 初始值，再点击“创建状态”。选中已有状态可保存类型和初始值，ID 创建后保持稳定。支持 string / number / boolean / array / object / null；初始值必须与类型一致。

状态创建、修改、删除分别通过 `EditorDocument.createState(pageId, definition)`、`updateState(pageId, id, { type, initial })`、`removeState(pageId, id)` 执行，一次操作对应一条撤销历史。修改后复用完整编译器检查所有已知引用类型。失败保留当前文档、预览和重做历史。

删除前检查组件属性、条件和循环、事件、页面进入事件、表单条件/校验规则、数据源默认参数、动作 resultTo 与 state.set 目标。动态状态读取或动态 state.set 目标无法确定实际对象时，保守阻止删除；请先明确或移除相关引用。literal 业务 JSON 和 extensions 不会被误当成绑定代码。

## 数据源

点击“新建数据源”，填写稳定 ID、query / mutation 类型、已注册 transport 和符合返回类型的 JSON 初始值。参数由 transport 契约生成，必填字段、已知类型和未知参数统一校验。配置不执行请求，不会因修改参数自动查询。

默认参数复用 `ValueInput`：固定值、页面状态、表单字段、表单数据、数据源和 JavaScript 表达式。source 参数只允许页面作用域，不接受 event / scope；行事件要调用 data.execute 并提供显式 input 覆盖。

`createDataSource(pageId, definition)` 与 `updateDataSource(pageId, id, definitionWithoutId)` 自动补充 transport 版本依赖，整份定义一次提交。删除使用 `removeDataSource(pageId, id)`，检查组件/事件/lifecycle中的 dataRef、sources 表达式、其他数据源默认输入和 data.execute 目标；动态执行目标保守阻止删除。源自身的默认引用会随定义一起删除，不单独阻止删除自身。

状态和数据源编辑都有按 page / definition ID 隔离的草稿，切换选择或页签不丢失无效输入。定义在其他面板或撤销/重做中变化时，保留当前草稿并禁用保存，必须“确认使用草稿”或“放弃草稿”。transport契约发生变化也会形成草稿冲突。保存成功才替换文档，不把半完成参数写入运行时。

同一数据源的参数草稿按 transport 分别暂存。A → B → A 会恢复 A 的原始取值方式、未完成的表达式/JSON 和特殊字符路径；不同 transport 的同名参数不会互相继承。缓存与整个数据源草稿同生命周期：放弃或保存成功会一起清理，冲突确认会对整组草稿重新确认。保存只解析当前 transport 契约声明的参数，隐藏的无效草稿既不阻止当前保存，也不会混入 Schema。

## 共享值编辑器

`src/editor/ValueEditor.tsx` 提供 `BindingDraft`、`bindingDraft`、`parseBinding` 和 `ValueInput`，供动作和源参数复用。属性面板保持已有常用 setter，同时新增数据源绑定方式并使用同一编辑器配置 source 和 path；既有固定值、表达式和表单引用继续保留。

dataRef 路径相对 source.data，使用可逆的 JSON 字符串数组，例如 `["rows"]`、`["first.name"]`、`[""]`。空输入表示不指定路径，`[]` 表示显式空路径，保存不会改写为点分字符串。状态引用路径使用同一数组格式。参数取值“不设置”表示省略可选参数，必填参数必须设置。

例如选中表格，将“数据”绑定方式改为“数据源”，选择 people，再填写路径 `["rows"]`，即可读取 `sources.people.data.rows`。完整 source快照字段仍可使用表达式，例如 loading 绑定 `sources.people.loading`。

## 查询示例与边界

导入 [data-sources.json](../public/examples/data-sources.json)，数据源页签可编辑 people 的 query 参数与初始数据；预览后点击“查询记录”，表格通过 dataRef 显示本地 mock 结果。编辑模式始终不执行 transport。运行内核契约见 [数据源运行内核](data-sources-v0.1.md)。

服务端分页/排序和保存刷新见 [服务端列表闭环](server-records-v0.1.md)，当前浏览器的应用定义保存见 [本地项目保存恢复](project-storage-v0.1.md)。本项目仍使用本地模拟服务，不包含真实后端 CRUD 持久化。任务验收状态见 [开发流水线](development-pipeline.md)，已验收画面见 [数据配置预览](data-editor-preview.png)。
