# Dimlu · React Runtime Foundation

一个从页面内核开始的低代码平台原型：Schema v0.1、结构与语义校验、独立 TypeScript 运行时、React 适配层，以及物料元数据驱动的属性编辑器。支持拖放编排、表单模型创建和字段绑定配置。

## 运行

需要 Node.js 22.18+（推荐 Node.js 24）和 npm。

```powershell
npm.cmd install
npm.cmd run dev
```

浏览器访问终端输出的本地地址。默认编辑模式，可在画布点选组件或使用左侧组件树，右侧编辑固定值、表达式和字段绑定；支持物料拖入、选中后拖动画布组件本体、组件树手柄拖动重排、跨容器/插槽移动、子树复制、撤销重做、JSON 文件导入导出。物料/树手柄或已聚焦的画布按空格或 Enter 可选择落点，Escape 取消。切换“预览模式”即可输入并操作页面，普通 Schema 页模式切换保持运行数据；React 代码页退出预览会卸载组件并清理 effect，再次进入时内部 Hook 状态重新初始化。Schema 面板仍可编辑整份应用 JSON。所有修改统一校验，有效修改会重置预览运行状态；无效定义不会替换当前应用，单纯选择节点不会重置。

启动模块加载失败时会显示错误说明和“刷新重试”，不会清除本地项目。如果开发服务仍返回缺失导出或空模块，请重启 `npm.cmd run dev`，或触发对应源码重新加载后刷新；启动提示不会自动修复 Vite 缓存，无需清除本地项目。

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run schema:export
```

`schema:export` 从代码中的单一来源生成 `public/schema/application.v0.1.json` 及 `public/examples/` 下的采购管理 starter、purchase-management、动作、数据源和服务端列表示例。修改协议或示例后运行此命令，再构建。

默认案例现为“采购申请管理”：搜索/分页/排序列表 → 新建与编辑抽屉 → 基本字段和通用动态明细 → 金额派生与校验 → 提交并刷新列表。已有合法本地项目继续优先恢复，不会被新案例覆盖。演示记录仅保留于当前内存，刷新页面恢复初始数据；使用与边界见 [采购申请管理](docs/purchase-management.md)，画面见 [采购抽屉与部门选择](docs/purchase-management-preview.jpg)。文件菜单仅提供新的采购管理案例下载入口，下载后可按需导入。

N10 采购案例、N11 组件逻辑和通用浮层层级修复已随 `013-overlay-layer-fix` 正式验收：默认门限下 60 个文件、469 项测试通过，Schema 导出、严格 TypeScript、构建、格式、52 组独立评审及浏览器验证全部通过，无未解决 P1/P2。011 部门下拉被抽屉遮挡的原始失败证据与 012 中间证据保留；最终修复已通过真实鼠标命中验证。完整状态见 [开发流水线](docs/development-pipeline.md)。

## 工作台界面

右侧“逻辑”页签支持显示条件与循环渲染：两段会话草稿统一原子应用，稳定记录标识、外层/本层作用域提示、变量来源保护、恢复及冲突确认。合法旧 when/repeat 无需迁移；已知错误类型和明确缺失作用域会在编辑提交或导入时拒绝，computed/bare scope 语法保留。使用与边界见 [组件逻辑](docs/node-logic.md)，画面见 [逻辑检查器](docs/node-logic-preview.jpg)。

使用 Base UI + Tailwind CSS v4，编辑器控件 28px、业务控件 32px。全高外壳只让内容滚动；永久纵向图标侧栏承载物料/结构/数据/代码，右侧常用属性、底部可调调试区分工明确。侧栏支持调宽、收起和窄屏抽屉，物料整块支持拖拽和键盘落点，移除常驻手动插入表单，组件树可搜索、折叠和定位。字段、表达式与 Schema 草稿跨面板保留，字段/Schema 冲突需显式确认；布局操作保持业务 React 状态。布局与验证记录见 [工作台界面](docs/workbench-ui-plan.md)。

日期与时间输入使用统一的 32px 组合外框、固定图标、内部清空与焦点/错误样式，支持日期、月份、日期时间、时间及范围。选择面板由 Base UI Popover 承载，使用页面内日历和时分秒选择，不调用浏览器原生日期弹层；仍保留 ISO 字符串、字段绑定和直接输入能力。交互与边界见 [日期与时间](docs/temporal-controls.md)。数据与代码面板首次打开时初始化，之后保留面板状态与草稿。

物料图标使用 Lucide，悬浮提示统一使用 Base UI Tooltip。画布顶部提供可点击的完整祖先路径，选中框工具条提供选择父级、复制和删除；当前物料面板提供 31 个通用组件，业务示例扩展独立于物料可见性。阿里官方物料库调研及后续优先级见 [物料库规划](docs/material-library-plan.md)。

树、画布与层级路径共享悬停；普通选择保持滚动位置，使用“在画布定位”和“在组件树定位”显式双向定位。Dialog、Drawer 平时显示紧凑占位，选择自身或后代进入单实例编辑范围，支持嵌套与返回页面；设计展示不改变业务打开状态或重建运行实例。面板使用统一静态描述和激活路由，代码/数据草稿跨面板保留。使用与扩展边界见 [面板与画布交互](docs/editor-interactions.md)。

文本输入统一支持单行和多行，通过 `multiline` 切换；多行支持行数配置，共用字段绑定、校验与原生 React 事件。配置与换行语义见 [统一文本输入](docs/text-input.md)。

选择器通过 `multiple` 统一单选 / 多选，支持文本/数字实际值、数组字段和选择数量校验、可视化选项配置、动态选项、字段绑定、必填、禁用、清空和重置，使用 Base UI 原生 `onValueChange` 值回调。可导入独立示例；配置、类型与空值语义见 [选择器](docs/select.md)。

右侧“事件”面板支持注册表驱动的事件/动作、参数绑定、顺序编排和原子撤销，草稿跨组件保留并显式处理冲突。内建表单回填、重置和提交，原生提交与动作提交共用同一路径，支持失败终止、等待与取消。导入 `public/examples/actions.json` 可体验表格编辑、抽屉回填和保存；协议与边界见 [事件与动作](docs/actions-v0.1.md)。

右侧“样式”面板提供紧凑的尺寸、间距、布局、文字与背景分组，固定值支持 `16`、`12px`、`100%`、`auto` 自然输入，复杂取值通过显式 Value 绑定编辑。单项/分组/全部恢复清除显式覆盖及对应草稿，支持原子撤销。普通 TSX Setter 可通过注册表扩展和替换；31 个通用物料声明真实样式目标。契约见 [React Setter](docs/setters-v0.1.md) 与 [节点样式](docs/styles-v0.1.md)，画面见 [样式面板](docs/style-inspector-preview.jpg)。N7/N8/N9 已随 `010-style-inspector-fix` 正式验收：默认测试门限下 51 个文件、427 项测试通过，Schema 导出、严格类型、构建、格式检查、浏览器验证和独立评审全部通过，无未解决 P1/P2。原007/009失败证据保留，完整状态见 [开发流水线](docs/development-pipeline.md)。P1 阶段当时未包含 when/repeat 可视化配置，随后已在 N11 完成；HTTP、出码、完整插件系统与页面CRUD继续延期。

数据源内核通过宿主TypeScript transport执行查询或mutation，独立存储data/loading/error，支持dataRef、sources表达式与useDataSource。query采用latest-wins，mutation忙时拒绝重复；编辑模式不请求，首次预览才执行进入事件。导入 `public/examples/data-sources.json` 可体验本地mock查询；契约见 [数据源运行内核](docs/data-sources-v0.1.md)，持续任务分工见 [开发流水线](docs/development-pipeline.md)。

左侧数据栏提供页面状态、表单模型和数据源二级页签，状态/源配置支持原子保存、引用删除保护、跨页签草稿与冲突确认；属性、动作和源参数可绑定dataRef并保留JSON数组路径。使用方式见 [数据配置面板](docs/data-editor-v0.1.md)。

导入 `public/examples/server-records.json` 可体验服务端搜索、分页、排序、抽屉回填与保存刷新。统一分页事件一次操作只执行一次查询；保存成功但刷新失败会提示仅重试查询，防止重复保存。示例、事件和 mock 服务契约见 [服务端列表闭环](docs/server-records-v0.1.md)。

勾选框与开关使用原生 `checked / onCheckedChange`，支持独立操作与布尔字段绑定；普通 `false` 是有效值，必须勾选或开启使用新增的 `mustBeTrue` 规则。配置与示例见 [布尔控件](docs/boolean-controls.md)。

本轮新增单选组、多选组、日期/时间及范围、通用动态明细、卡片、分隔线、标签页、图片、链接、描述列表、表格、列表、分页、对话框、抽屉、提醒与加载状态，并提供页面实例隔离的消息通知动作。布局容器和表单支持网格、间距及标签布局配置。使用方式和阶段边界见 [基础组件第一阶段](docs/components-phase-one.md)，可导入 `public/examples/components.json` 体验四个独立示例页面。

可视化字段绑定限定到最近表单容器的模型；容器外不提供新绑定入口，已绑定组件跨模型移动会提示先解除绑定。规则、拖放保护和已有定义兼容性见 [字段绑定作用域](docs/form-binding-scope.md)。

页面代码与现有表达式、JSON / Schema 输入使用统一 Monaco 编辑器，支持展开编辑和按调用方保留草稿。Monaco 与 editor / JSON / CSS / TS workers 按需从本地构建产物加载；加载失败可回退文本编辑。语法提示不能替代协议校验，也不提供完整 TypeScript 语义类型检查。画布导航、固定版本的 AliLowCodeEngine 官方研究与后续范围见 [面板、画布与页面代码规划](docs/editor-canvas-code-plan.md)。

画布新增独立的内容宽度与编辑缩放工具行：自动、桌面、平板、手机和自定义宽度，50%～150% 编辑缩放、100% 恢复及持续适应宽度。预览保留内容宽度，始终按 100% 显示；设备预设不模拟浏览器媒体查询。操作、坐标架构及 AliLowCodeEngine / TinyEngine / GrapesJS 对照见 [画布视口与编辑缩放](docs/editor-viewport.md)，本轮实现和待验收项见 [一天工作记录](docs/workday-2026-11-09.md)。

左侧“代码”面板可在平台内编写 JSX / TSX 和 CSS，启用后由 default React 组件显示当前页面，原 Schema children 保留，禁用即可恢复。保存只转换与校验，不执行模块；编辑模式显示占位，预览才运行。React 与 Runtime Hooks 复用当前实例，页面 CSS 通过同树 ShadowRoot Portal 隔离；作者 JS 在当前窗口运行，具有浏览器权限，不是安全沙箱。支持模块、生命周期、草稿冲突、局部错误和存储边界见 [页面 React 代码](docs/page-code.md)。

## 本地项目

产品案例统一为采购申请管理；旧三页案例不再提供下载或对外文件。已有本地项目仍按原恢复规则保留，替换前可先导出备份，再明确确认“重置项目”使用新的默认案例。

提交与查询使用本地模拟服务。已提交的项目定义与选中位置自动保存在当前浏览器，刷新后以编辑模式恢复；表单运行值、查询结果和未提交草稿不保存。损坏本地副本会保护原文并提供恢复操作，保存失败保留内存和导出入口。协议与边界见 [本地项目保存恢复](docs/project-storage-v0.1.md)。

本地保存恢复已通过 N5 独立验收：336 项测试及严格类型、构建、格式检查通过，浏览器验证覆盖刷新恢复、390px / 760px 布局与确认对话框。N6 草稿与集成收尾已验收：340 项测试、协议导出、严格类型、构建、全源格式、浏览器与独立评审全部通过；完整状态见 [开发流水线](docs/development-pipeline.md)。

## 目录

```text
packages/schema/         类型、JSON Schema、语义校验
packages/runtime/        表达式、能力注册表、运行计划、页面实例
packages/react-runtime/  React 渲染器和状态订阅 Hook
packages/editor/         物料元数据协议、文档命令、原子校验和撤销历史
src/editor/              宿主物料目录、组件树、画布、属性与字段面板、导入导出
src/purchase-management-example.ts  默认采购管理业务案例
src/examples.ts          内部兼容回归fixture（不对外发放）
src/materials.tsx        物料注册与本地动作适配器
src/materials/           通用表单、容器、数据展示与反馈物料
src/ui/                 Base UI 紧凑控件、Monaco 编辑器及同源 Worker
src/code/               页面 JSX/TSX 编译、预览运行、ShadowRoot 与代码草稿
src/App.tsx              固定全高工作台与底部调试区
docs/schema-v0.1.md      协议和执行语义
docs/architecture.md     分层、决策和后续演进边界
docs/form-v0.1.md        字段模型、校验、提交语义和 React Hooks
docs/form-v0.2.md        动态明细、行身份、派生计算和 useFieldArray
docs/editor-v0.1.md      编辑元数据、命令层、草稿与预览边界
docs/editor-v0.2.md      画布选择、模式隔离、移动复制和作用域保护
docs/editor-v0.3.md      拖放意图、纯预检、命中提示和键盘操作
docs/editor-canvas-code-plan.md  016 官方研究、祖先导航与后续边界
docs/page-code.md        平台内页面 React/CSS、编译与预览生命周期
tests/                   契约、异步一致性、React 交互测试
```

表单使用普通 React/HTML 组件与独立 TypeScript store，提供 useForm/useField/useFieldArray/handleSubmit。采购明细支持 1–20 行，排序和删除后值与错误跟随稳定身份。名称包含“失败”可验证服务端错误与输入保留，汇总金额超过 10,000 可验证审批说明，超过 50,000 会阻止提交。嵌套数组、异步校验、服务端权限及持久化属于后续阶段。编辑器基础见 [编辑器 v0.1](docs/editor-v0.1.md)，拖放操作与边界见 [编辑器 v0.3](docs/editor-v0.3.md)。

## 代码扩展

组件扩展直接写 TSX，保留 React 的事件和 Hooks。先在注册表声明 props、事件、插槽及版本，再在 React 物料表中注册组件。示例见 `NativeReactCounter`。

Schema 中的计算使用标准 JavaScript **表达式子集**，例如 `forms.purchase.computed.total > 10000`、`event.target.value`、`scope.person.name`。它不是完整 JavaScript 执行环境；支持范围见协议文档。需要语句、闭包或 Hooks 时，可使用平台内的页面 React 代码，或宿主 TSX 组件；需要复用动作与派生能力时，仍可注册 TypeScript 动作、纯计算函数。页面代码支持完整组件语法，不会扩张 Schema 表达式子集。

表单与字段的可视化配置、绑定冲突和删除引用检查见 [编辑器 v0.4](docs/editor-v0.4.md)。
