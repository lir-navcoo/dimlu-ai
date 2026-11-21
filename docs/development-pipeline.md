# 持续开发流水线

主 Agent 负责拆分任务、冻结契约、分配工作、判断验收与评审结果；开发 Agent 在完成任务 N 后接续 N+1。验收 Agent 和评审 Agent 使用已冻结且校验哈希一致的任务快照，避免正在开发的下一项影响结论。发现的问题回到开发队列修复，修复后重新冻结并复验。

开发阶段只运行相关测试（`--maxWorkers=1`）和严格 TypeScript 检查。全量测试与浏览器交互验证由验收 Agent 执行；主 Agent 阅读证据并做最终判定。任务通过后才标记完成，不把“已写代码”视为验收通过。

| 任务                   | 范围                                                                                             | 交付边界                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| N1 事件与动作          | 事件面板、动作编排、原子表单回填与统一提交、CRUD示例                                             | 001-actions 已验收，231 测试通过                                                   |
| N2 数据源运行内核      | Schema、TS transport、独立 source store、取消与并发、运行时权限与表达式绑定                      | 002-data-runtime-fix 已验收，265 测试通过                                          |
| N3 数据配置面板        | 数据二级Tab、页面状态/表单/数据源原子CRUD与引用保护、共用Value编辑器和dataRef、查询按钮+结果示例 | 003-data-editor-fix 已验收，297 测试通过，浏览器/评审通过                          |
| N4 服务端列表闭环      | 服务端搜索/分页/排序、保存刷新、单次分页事件、防止二次slice/sort                                 | 004-server-records 已验收，312 测试通过，浏览器/评审通过                           |
| N5 本地项目保存恢复    | 应用定义与编辑会话、版本校验/恢复；不持久化运行时表单/请求数据                                   | 005-project-storage 已验收，336 测试通过，浏览器/评审通过                          |
| N6 集成收尾            | Transport原始参数草稿隔离、错误汇总文案及文档/截图集成                                           | 006-draft-polish 已验收，340 测试及全部检查/浏览器/评审通过                        |
| N7 React Setter 扩展   | React 注册表、统一固定值宿主、局部降级、草稿与迟到回调保护                                       | 010最终集成正式验收，全部五种旧回调保护及宿主生命周期复验通过                      |
| N8 节点样式运行内核    | 类型化 style Schema、领域/作用域校验、原子命令、运行时及真实物料目标                             | 008-node-style-runtime 已正式接受，13文件150项相关测试及检查、独立评审通过         |
| N9 样式面板与集成      | 紧凑样式Tab、自然值Setter、显式绑定、恢复与草稿清理、最终回归                                    | 010-style-inspector-fix 正式验收，51文件427项测试及全部检查/浏览器/评审通过        |
| N10 采购业务案例       | 默认采购管理、隔离本地服务、动态明细、新建编辑及保存刷新                                         | 013-overlay-layer-fix 最终正式验收，60文件469项测试及全部检查/浏览器/评审通过      |
| N11 组件逻辑           | when/repeat可视化、原子命令、类型/词法作用域保护、草稿/恢复/撤销                                 | 随013正式验收，52组独立评审通过，浮层P2已闭环                                      |
| N12 页面代码与画布导航 | Monaco、页面 JSX/TSX/CSS、祖先路径与父级选择、日期时间样式、面板按需初始化                       | 018正式验收；017全量67文件512项，018专项6项、独立探针5组与全部检查/浏览器/评审通过 |
| N13 页面内日期时间选择 | Base UI Popover、自有日历和时分秒、范围草稿、嵌套焦点与定位                                      | 019正式验收；67文件535项及Schema/严格类型/构建/格式、浏览器与独立评审通过          |
| N14 面板与画布联动     | 共享悬停、显式双向定位、CanvasHost 局部视口与静态面板路由                                        | 020正式验收；68文件558项及全部门禁、评审与浏览器通过                               |
| N15 设计期浮层聚焦     | Dialog/Drawer 单实例编辑、嵌套范围、身份保留与拖动隔离                                           | 022正式验收；69文件571项及全部门禁、评审与浏览器通过                               |

冻结副本由主 Agent 建立在当前开发工作区之外，并记录路径与SHA256。验收记录位于外部 `E:\dimlu-ai-pipeline\PIPELINE.md`，以主 Agent 发布的快照和正式结论为准。开发 Agent 发出“可冻结 N”后先只读准备下一项，快照复制完成即继续，不等待独立测试和评审同时结束。

## N14 / N15 面板与画布增强

对照固定版本 AliLowCodeEngine 的 Skeleton、Detecting、Selection、Simulator 与 ModalNodesManager 职责，分别落实临时导航状态、面板激活、局部视口和设计期浮层展示，不迁移阿里 Schema 或运行时。官方证据及范围见 [面板与画布规划](editor-canvas-code-plan.md)，使用见 [面板与画布交互](editor-interactions.md)。

020已正式接受：独立23条导航回归，最终68文件558项测试（203.70s）及Schema导出、严格TypeScript/Vite构建、格式检查通过，257份冻结源和11份生产评审hash一致。主Agent在独立5195 origin验证普通选择不滚动、显式双向定位、隐藏后代反馈、Monaco未应用草稿保留、键盘拖动禁定位与工具条可见；真实pointer hover/drag受当前浏览器API限制，由独立交互与几何测试补证，不冒充实际鼠标验收。

设计期浮层范围随022正式接受。开发、验证与评审循环关闭footer嵌套目标被祖先隐藏、不可见重复实例抢占当前实例、sticky范围条遮工具条和DOMRect展开丢坐标四项问题。独立13项交互回归、1377项React/Hook/Form/Portal身份断言及10项DOMRect探针通过。021原完整回归570/571，唯一失败为旧保存恢复测试假定编辑态浮层默认展开；022仅调整该测试为先验证收合、再显式树选检查恢复值，原业务断言完整保留，生产与其余261份文件完全相同。021原红日志不覆盖。

022最终完整69文件571项测试全部通过（208.53s），未放宽默认超时；Schema导出、严格TypeScript/Vite构建、格式及独立评审通过。262份冻结源与开发源一致，18份联合生产评审hash匹配。主Agent读取证据后正式接受；此后仅更新本流水线和画布规划两份文档，另记docs-only差异，不改生产或测试。

主Agent在独立5195 origin验证冻结生产的嵌套/插槽/重复实例、隐藏反馈、Select局部值跨范围保留、三级Escape及回焦，1280/760/390宽度外壳无页面滚动，冷加载后console无新warning/error。020已验证显式双向定位和Monaco草稿保留。临时服务、标签页、视口覆盖和fixture均清理，用户5173项目未改。证据见外置reports/020-editor-navigation、reports/021-overlay-focus/browser-validation.md及reports/022-editor-canvas-final，画面见 [浮层聚焦编辑](editor-canvas-preview.png)。

## N12 页面代码、画布导航与日期时间

`018-code-canvas-temporal-final` 已正式接受。Monaco 统一页面代码、表达式和 JSON 输入，支持展开与同源 workers；整页 JSX/TSX 使用原生 React 和 Runtime Hooks，设计态不执行，预览才运行，CSS 经 ShadowRoot 隔离。原 Schema children 保留，禁用代码恢复；JS 在当前窗口执行，不是安全沙箱，仅支持声明的三个静态模块。使用方式见 [页面 React 代码](page-code.md)。

画布提供完整祖先路径和父级选择，选区更新时立即隐藏上一测量框的操作工具；数据/代码面板首次访问后保留挂载。018当时的日期选择使用原生弹层，随后已由N13替换为页面内面板。Ali 官方研究、当前范围及后续共享悬停/浮层聚焦/视口能力见 [面板与画布规划](editor-canvas-code-plan.md)。

016 首轮有测试匹配冲突及超时；经 CPU 采样定位隐藏控件扩大 JSDOM 标签查询成本，按需初始化后相关串行 21 项全部通过。017 完整回归在默认门限、单 worker 和禁止文件并行下通过 67 文件、512 项（164.53s），随后构建发现测试 helper 的无效类型选项。018 仅删除该行，生产代码不变；独立核对 248 文件仅此差异后，复用 017 全量，实际通过 6 项专项、5 组独立 React 探针、Schema 导出、严格 TypeScript、构建、格式及独立评审。失败证据未覆盖。

主 Agent 在独立 origin 实际验证 Monaco/TSX/CSS/Hook 交互、刷新恢复和日期时间窄列；保留用户原采购项目，已清理临时测试页和服务。证据位于外部 `E:/dimlu-ai-pipeline/reports/016-canvas-panel/browser-validation.md` 和 `reports/018-code-canvas-temporal-final/validation.md`。最终源与冻结 248 文件一致后，仅补 README、本规划及本流水线三份说明文档，不改生产代码。

## N13 页面内日期时间选择

`019-temporal-popover` 正式接受。当前 Base UI 1.9.0 没有公开日期选择 UI，使用公开 Popover 负责浮层和焦点，自有日历/月面板及时分秒列表负责选择；所有日期输入使用 text，不再调用原生日期弹层。单个日期/月点选即应用，范围连续选择，时间与日期时间确认后一次提交；取消不发布候选，原 Schema、字段格式与秒精度保留。说明见 [日期与时间](temporal-controls.md)。

开发、独立测试、独立评审与主 Agent 浏览器循环关闭了 React blur 事件方法丢失、Tooltip 拦截第二次 Escape、Drawer Portal 继承画布裁剪边界、时间列表滚动祖先及“现在”未同步浏览月份等问题。最终独立验证通过67个文件535项测试（180.86s），保持默认超时、单worker与禁止文件并行；Schema导出、严格TypeScript、Vite构建与格式检查全部通过。251份冻结文件与开发源完全一致，五个评审生产文件的SHA四方一致，随后只补三份说明文档并另记差异。

主 Agent 在独立5194 origin实际验证各模式、范围、直接输入、内部清空、取消/确认、设计态、Drawer月份二级浮层、两层Escape及定位，console无warning/error，1280×720外层无滚动。原始失败证据保留，临时服务、标签页与fixture已清理，用户5173项目未修改。完整证据位于 `E:/dimlu-ai-pipeline/reports/019-temporal-popover/`。

## N10 采购业务案例

N10 已随 `013-overlay-layer-fix` 正式接受。默认fallback改为采购申请管理，保留旧 `exampleApplication` 作为内部兼容回归fixture；按后续明确需求，旧案例已停止对外导出和下载；不改变本地存储键、版本或已有合法项目优先恢复行为。通用物料组成列表、筛选分页、受控抽屉和动态明细表单，复用金额计算、统一提交、保存防重与仅重试查询流程；本地mock工厂校验并权威重算金额。用法见 [采购申请管理](purchase-management.md)，画面见 [采购抽屉与部门选择](purchase-management-preview.jpg)。

011 原始全量448项及静态/评审曾通过，但浏览器发现部门Select被Drawer遮挡的P2，因此011不作为最终接受版本。原截图、命中证据和失败结论保留；012为包含N11的中间冻结，也未掩盖该浮层问题。013统一修复物料/编辑器Select、Menu/Combobox与Tooltip层级，并通过真实鼠标及键盘选择、Escape、焦点恢复和自定义Tip验证。层级说明见 [浮层层级](overlay-layers.md)。

## N11 组件逻辑

N11 已随013正式接受。逻辑Tab按需挂载，两组独立source会话草稿通过原子命令统一提交；类型与显式scope校验、完整词法provider保护、单组恢复与草稿冲突处理保持Schema/React原生语义。合法旧定义无需迁移，computed/bare scope语法保持，历史已知错误定义会更早拒绝。文档见 [组件逻辑](node-logic.md)，画面见 [逻辑检查器](node-logic-preview.jpg)。

最终013在未放宽默认超时的条件下通过60个文件、469项测试（178.36s），Schema导出、严格TypeScript、构建、格式检查、52组独立评审（38核心+5 DOM+9采购）及浏览器全部通过。主Agent读取报告并目视代表截图，核对224份原始源码哈希一致后正式判定无未解决P1/P2。独立3项组合验收测试随后按SHA原样集成，收尾仅补文档与两张已验证截图，不改生产代码；未重复全量。HTTP、出码、完整插件和页面CRUD继续延期。

## P1 扩展与样式

N7/N8/N9 已正式验收，P1 完成。最终冻结 `010-style-inspector-fix` 在默认测试门限下通过 51 个测试文件、427 项测试；Schema 导出、严格 TypeScript、构建、格式检查、独立浏览器验证与评审全部通过，主 Agent 已读取证据并判定无未解决 P1/P2。31 个通用物料的样式作用于明确的真实目标，样式控件按需挂载，切换 Tab 保留会话草稿。

007与009的失败快照、复现脚本及报告保留为原始证据，未改写成通过记录。010修复覆盖全部五种旧 Setter 回调、未应用绑定草稿保护、宿主卸载后永久失效以及默认测试门限下的面板开销回归；未通过调高超时阈值绕过原009超时。

Setter 契约见 [React Setter](setters-v0.1.md)，样式语法、目标、自然输入、绑定和恢复语义见 [节点样式](styles-v0.1.md)，验收画面见 [样式面板](style-inspector-preview.jpg)。这是历史P1范围：当时未实现when/repeat可视化，随后已由N11完成；HTTP transport、出码、完整插件系统和页面CRUD仍未实现。

## N6 集成收尾

006-draft-polish 已正式验收：43 个测试文件、340 项测试通过，协议导出、严格类型、构建、全源格式、独立浏览器验证与评审全部通过，无未解决 P1/P2。交付包含同一source按transport保存原始未提交参数草稿、表单错误汇总中性化及本轮截图与文档集成。浏览器画面见 [Transport 草稿恢复](source-transport-draft-preview.png)。随后仅进入已判定问题的修复队列，不增加新功能。

## N2 冻结契约

页面可选 `dataSources: DataSourceDefinition[]`，定义为 `{ id, kind: 'query' | 'mutation', transport, input: Record<string, Value>, initial: Json }`。`registry.transports` 与 `dependencies.transports` 都可选，旧应用无需迁移。注册的 `TransportContract` 声明精确版本、输入类型、必填参数、输出类型，以及普通 TypeScript `execute(input, { signal })` 函数。transport 不获得可写页面上下文，也不从 Schema 执行源码。`createRegistry` 的第四个可选参数承载 transport。

`DataSourceRuntime` 独立于 React：`execute(input?, { signal }?)`、`refresh(options?)`、`cancel()`、`setEnabled(enabled)`、`getSnapshot()`、`subscribe(listener)`、`dispose()`。返回快照包含 `data`、`status: idle/loading/success/error`、`loading` 和 `error: null | { name, message }`，不包含 undefined。初始值与 transport 输出类型一致，返回值经 JSON/输出类型检查后复制并冻结。失败保留已有 data，error 归一为 JSON。

执行输入把定义的 input 与调用覆盖值按参数键浅合并，一次校验所有必填、未知参数和类型后再调用 transport。定义 input 只使用页面作用域，不能引用 event 或 scope；读取状态/表单/其他数据源快照不会自动发请求。本轮只显式 `data.execute` 或页面 `onEnter`，不自动 watch。

query 在同 source 内 latest-wins，跨 action lane 也生效；旧调用 reject，原动作链停止，忽略取消信号的迟到结果也不能发布。mutation 同 source 正在执行时拒绝新调用，不默认取消或自动重放；显式取消只能停止客户端等待与发布，不能撤销服务器已执行的写操作。销毁隔离实例并取消请求。

`PageRuntime.getDataSource(id)` 和 `getDataSourcesSnapshot()` 提供源访问，pending 包含直接 source 调用。`data.execute({ sourceId, input? })` 动作返回 JSON，可被动作链等待。`useDataSource(sourceId)` 用 React 外部 store 订阅快照，表达式使用 `sources.<id>.data/status/loading/error`；`dataRef { sourceId, path?: string[] }` 读取 snapshot.data，path 保留为可逆字符串数组。依赖为 `@source:<id>`。Schema 检查源身份、版本依赖、引用、已知输入/输出类型与 initial。表单条件/校验规则本轮明确禁止读取 sources，避免只读取不刷新的配置。

`PageRuntime` 构造支持 `{ designMode?: boolean }`，`setDesignMode(boolean)` 切换执行权限，保留运行实例和 React 组件身份。设计态源执行入口拒绝请求，进入生命周期等到首次预览激活，且每个页面实例最多执行一次；切回编辑会取消在途源请求并阻止迟到发布。再次预览不重放 `onEnter`，中断后由用户显式查询或重置页面重试，避免进入动作包含 mutation 时重复业务写入。宿主 TS transport 也受该权限约束。

N2测试重点：合法与非法Schema、初始/结果JSON类型、动态输入、query旧链终止、mutation busy、取消迟到与销毁、实例隔离、权限切换、精准订阅与pending。仅使用注册mock或本地HTTP fixture，不访问真实外部业务服务。
