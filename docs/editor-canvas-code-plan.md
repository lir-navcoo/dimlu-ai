# 面板、画布与页面代码

研究日期：2026-11-08。先对照 AliLowCodeEngine 官方源码，随后分阶段落地层级导航、统一代码编辑器、页面 React 代码及面板与画布联动。本文区分官方证据、当前实现和后续建议；不把源码对照等同于运行过阿里编辑器。

## 固定版本与证据

官方仓库为 [alibaba/lowcode-engine](https://github.com/alibaba/lowcode-engine)，本轮通过 GitHub API 查询 `main` 后固定到提交 **`f6305c2284950d79b9729781f081f24f113de345`**，提交时间 `2024-06-11T13:12:45Z`。下面的源码链接均固定到该 SHA。这不代表 2026 年最新 npm 版本，也不涵盖其他分支或发布包。

016 原始研究保存在工作区外的 `E:/dimlu-ai-pipeline/reports/016-canvas-panel/`：`research.md` 是详细对照，`upstream-manifest.json` 记录下载路径、固定 revision、取证时间及各文件 SHA256，`upstream/` 保存对应官方源码。本文只提炼影响本项目设计的结论。

| 官方实现事实                                                                      | 固定版本证据                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 对本项目的含义                                                                                          |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Skeleton 分离左侧、固定/浮动面板、主区域、右侧、底部；Panel 管理激活与可见性      | [Skeleton](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/editor-skeleton/src/skeleton.ts#L143-L245)、[Panel](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/editor-skeleton/src/widget/panel.ts#L175-L216)                                                                                                                                                          | 面板布局及会话状态属于编辑器宿主，不进入应用 Schema；保留现有全高外壳和图标栏。                         |
| Selection、Detecting、Dragon、DropLocation 分离选区、悬停、拖动手势与落点         | [Selection](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/document/selection.ts#L22-L58)、[Detecting](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/designer/detecting.ts#L24-L73)、[Dragon](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/designer/dragon.ts#L173-L328) | 保留现有拖放意图、预检与原子命令。悬停不能修改文档选区或撤销历史，也不应触发定位滚动。                  |
| Simulator 管理实例、视口、坐标和独立辅助层；该版本 Content 使用 iframe            | [HostView](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/builtin-simulator/host-view.tsx#L103-L134)、[Viewport](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/builtin-simulator/viewport.ts#L163-L186)                                                                                                                                   | 借鉴统一坐标与实例适配职责；不能据此直接迁移 iframe，或只对画布加 CSS transform 就宣称完成缩放。        |
| 元数据区分 props、component、supports、advanced，包含容器/浮层/测量目标及操作能力 | [configure](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/types/src/shell/type/configure.ts#L6-L27)、[ComponentMeta](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/component-meta.ts#L263-L282)                                                                                                                                                       | 继续分离编辑元数据与运行 Contract；有实际需求再增加小型 TS 能力描述，不复制全部实验字段或把回调序列化。 |
| ModalNodesManager 管理设计期可见浮层；父级选择器支持向上选择节点                  | [ModalNodesManager](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/document/node/modal-nodes-manager.ts#L34-L69)、[父级选择器](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/builtin-simulator/node-selector/index.tsx#L36-L99)                                                                                                           | 层级导航可先独立落地；浮层编辑展示与业务 open 状态必须分开。                                            |

以上证据没有证明本项目采用了阿里的 Schema、源码执行器或插件系统。页面 React 代码是本项目结合用户要求独立制定的能力，不归因于这些官方文件。

## 本轮已实现

### 层级路径与选父级

画布顶部从“页面名 / 节点 ID”改成可点击的完整路径：页面 → 各级容器 → 当前组件，插槽边保留名称。路径优先使用组件静态标题/标签，否则使用物料名称；完整类型和 ID 通过 Base UI Tooltip 展示。内容较长时只在路径区域横向滚动。

点击页面清除节点选中，点击任意祖先切换选区；选中工具条增加“选择父级”，根层节点返回页面。拖动中禁用路径切换。路径来自当前快照的纯 `nodePath`，不写 Schema、不增加历史、不重建运行计划。重复实例仍对应同一个 Schema 节点，路径表示定义层级。

入口：`packages/editor/node-path.ts`、`src/editor/CanvasBreadcrumb.tsx`、`src/editor/Canvas.tsx`。

### 统一 Monaco 编辑器

`src/ui/CodeEditor.tsx` 统一 JavaScript、TypeScript、JSON、CSS 编辑，使用固定版本 `monaco-editor@0.57.0`。编辑器按需加载；editor / JSON / CSS / TS workers 由 Vite 打包至同源，不依赖 CDN 或 AMD loader。每个编辑器拥有独立 model，销毁时释放订阅、model 和 editor；草稿由调用方保存。

页面代码、表达式、JSON/Schema 等现有代码输入共用该组件，支持展开编辑，展开视图仍使用同一受控草稿。加载失败或不支持 Worker 的环境使用同样 value/onChange 语义的 textarea 回退。回退只保证输入可用，不能当作 Monaco worker、补全、焦点和浏览器绘制已经通过验收。

Monaco 的语法提示辅助编辑；JavaScript 表达式仍按原表达式子集校验。选择 TypeScript 语言不会把表达式变成完整 TSX 执行环境。页面 TSX 转换移除类型注解，当前不提供完整 TypeScript 语义类型检查。

### 平台内页面 React 与 CSS

左侧新增“代码”Tab。页面可保存可选严格定义 `code: { enabled, language: 'jsx' | 'tsx', source, css }`，默认提供未启用的可运行 Hooks 示例；不会替换当前采购案例。启用后 default React 组件替代该页 Schema children 的显示，原 children 保留，禁用即可恢复。

保存时按需加载 `sucrase@3.35.1`，只转换和检查语法/模块导入，不求值作者模块；编辑模式显示占位。切换预览才执行 ES 模块并挂载组件。支持 React 原生事件、闭包、Hooks、函数/class/memo/forwardRef/lazy 组件，以及同实例 React 和既有 Runtime Hooks。退出预览会卸载并清理 effect，内部 Hook 状态重置；普通 Schema 页沿用原来的模式切换身份语义。

CSS 和代码组件经同树 React Portal 放入 ShadowRoot，保留 Runtime context并隔离普通页面选择器。JS 在当前窗口和线程运行，拥有浏览器权限，**不是安全沙箱**；无限循环会阻塞线程，作者需处理自己的异步回调和全局副作用。仅支持静态导入 `react`、`react/jsx-runtime`、`@dimlu/runtime`；未知模块、动态 import、import.meta 和 CommonJS require 不在支持范围。

代码草稿按页保留，冲突需要确认；异步保存检查文档身份/代数、版本、页面和最新草稿，预览求值检查组件仍活动且 Runtime 未结束。API 桥只读，模块/缺失 default/渲染错误显示局部错误及重试。细节见 [页面 React 代码](page-code.md)。

## 020 / 021 面板与画布增强

继续对照以上固定版本的职责分离，增加共享悬停、显式双向定位、静态面板路由和设计期浮层编辑范围。操作说明见 [面板与画布交互](editor-interactions.md)。

`EditorNavigation` 只保存临时交互：树、画布、路径共享 hover，但不改选区和历史；定位请求绑定文档、页面、计划、选区及请求序号，过期请求不执行。普通树选择不滚动，明确点击“在画布定位”才局部 reveal；“在组件树定位”激活结构、清搜索、展开祖先并聚焦对应行。pending 与 active 拖动均阻止定位，不保留结束后重放的请求。

`CanvasHost` 统一实例选择、裁剪交集与局部横纵滚动，避免 `scrollIntoView` 带动外壳。重复定义与 `instanceKey` 分开，多个实例可以显示选框，实际可见的主实例只显示一份工具条。条件隐藏、字段不可见与空循环提供明确反馈，定位可见祖先不偷偷更换选区。

面板描述分为 `panel-routes.ts` 元信息与 `panels.tsx` 类型化渲染，统一标题、图标、宽度、懒初始化及激活入口。代码和数据面板首次访问后保持挂载，定位切换不丢未应用草稿。这是本地静态扩展点，尚非动态插件注册。

Dialog、Drawer 的设计展示与业务打开状态分开：普通画布显示紧凑占位，选择浮层或可达后代进入单一实例编辑范围；嵌套浮层保留必要祖先上下文并隐藏其他分支。Renderer 通过可选纯 TypeScript `designPresentation` 透传策略，物料通过 `useMaterialPresentation` 消费。现有 Runtime、React 子树、Dialog.Root、Portal host 和 key 保持稳定，展示切换不调用业务打开/关闭/确认。

## 后续能力

| 顺序 | 能力                       | 先明确的验收边界                                                                                              |
| ---- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | 统一组件操作能力与命令判定 | 画布、树、键盘共享选中/移动/复制/删除的状态和原因；字段模型、插槽与作用域规则继续由文档命令兜底。             |
| 2    | 设备视口与缩放             | 基于已有 CanvasHost 补充坐标变换、拖放命中和 Portal 定位，再做真实鼠标验收；单纯 CSS transform 不算完成缩放。 |
| 3    | 动态面板和插件生命周期     | 有实际需求后再扩展当前静态描述，明确注册/卸载、草稿归属和错误隔离；暂不引入远程插件或任意停靠。               |

上述三项仍是后续规划。当前没有新增多选、节点锁定、自由绝对布局、缩放、iframe 画布或自动出码。React + Base UI + Tailwind 的现有组件基础保持不变。

## 验证与状态

面板与画布增强随 `022-editor-canvas-final` 正式验收。最终完整回归69文件571项测试通过（208.53s），保持默认超时、单worker和禁止文件并行；Schema导出、严格TypeScript/Vite构建、格式及独立评审全部通过。262份冻结源与开发源一致，020/021联合18份生产评审hash匹配。13项独立浮层测试及1377项React/Portal/Form身份探针覆盖嵌套、插槽、重复实例、拖动与零业务副作用；DOMRect边界另有10项独立断言。

真实冻结浏览器验证双向定位、Monaco草稿保留、单实例及footer嵌套范围、隐藏后代反馈、未绑定Select值保留、Drawer/日期/月选择三层Escape与回焦。1280、760和390宽度下外壳尺寸与视口一致、页面scrollTop为0。已修复footer祖先隐藏目标、隐藏重复实例抢焦、sticky提示条遮工具条和DOMRect展开丢字段四项问题。原021全量570通过/1失败为旧保存恢复测试假定默认展开；022仅适配这一测试，其他261份文件完全相同，原失败证据保留。实际pointer hover/drag由独立交互测试补证，不冒充浏览器手势验证。

以下为此前页面代码阶段的历史验收记录。

开发阶段页面代码专项 27 项测试通过，独立评审覆盖 18 组编译探针、5 组运行模块探针、同页不同文档迟到保存和已结束 Runtime 迟到求值。已发现的 API 桥污染、转义 require、普通对象方法误判和迟到身份问题均有回归。

页面代码阶段随 `018-code-canvas-temporal-final` 正式验收。完整行为回归为 017 冻结版本的 67 文件、512 项测试，通过原超时门限；018 唯一变化是删除测试查询不支持的 `exact` 选项，生产代码相同，并实际通过 6 项专项、5 组独立探针、Schema 导出、严格类型、构建和格式检查。独立评审核对全部 248 份冻结文件。016 的原始测试失败与 017 的测试类型错误记录均保留。

真实浏览器已验证本地 Monaco、展开编辑、TSX/Hooks 点击、CSS 样式隔离、刷新后设计态恢复、禁用后恢复原结构、祖先路径和父级选择。选区切换后旧测量框的工具条会立即隐藏，避免父级、复制或删除命中上一选区。数据与代码面板首次访问时初始化，随后保持挂载；展开编辑器的 Dialog 也延迟到首次打开才初始化。

日期时间控件同步统一为 32px 外框、固定图标、内部清空和错误/禁用样式，270px 范围控件实测自动分行且无外框横向溢出。018当时保留浏览器原生picker；后续019已用Base UI Popover与自有日历/时间面板替换，并完成535项全量回归及浏览器验收。操作见 [日期与时间](temporal-controls.md)，证据与各轮边界见 [开发流水线](development-pipeline.md)。
