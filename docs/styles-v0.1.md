# 节点样式 v0.1

`NodeSchema.style` 是可选的 `Partial<Record<StyleProperty, Value>>`。协议版本保持 `0.1.0`，没有该字段的旧文档行为不变。样式与业务 props 独立，不把旧物料属性迁移或同步为样式。

## 值与支持范围

共享定义在 `packages/schema/style.ts`，不依赖 React 或 DOM。首批属性：

- 尺寸：width/height/minWidth/minHeight/maxWidth/maxHeight。
- 间距：四边 margin/padding，以及 gap/rowGap/columnGap。
- 布局：display、flexDirection、flexWrap、alignItems、justifyContent、flexGrow、flexShrink、flexBasis。
- 文字：color、backgroundColor、fontSize、fontWeight、lineHeight、textAlign。

长度数字为 React 像素；字符串单位限 px/%/rem/em/vw/vh，也接受字符串 `0`。margin 可负，其他长度非负。width/height/minWidth/minHeight、margin 和 flexBasis 可为 auto；maxWidth/maxHeight 可为 none。lineHeight 数字是无单位倍数，也接受非负长度与 normal。fontWeight 接受 normal/bold 或 1–1000 整数。flexGrow/flexShrink 仅非负有限数字。枚举以共享模块的明确列表为准，不接受任意 CSS 继承关键字。

颜色接受 #RGB/#RGBA/#RRGGBB/#RRGGBBAA，或共享模块列出的常见命名颜色（含 transparent/currentColor）。本轮不接受任意 CSS 键、selector、伪状态、断点、主题 token、url/var/calc、RGB/HSL 函数或任意 CSS 字符串。以此提供确定的领域校验，后续语法扩展需单独审查。

## 物料目标与优先级

组件契约须声明 `style: { target: 'root' | 'field' | 'popup', properties: [...] }`。未声明目标或不支持某属性时，编译拒绝显式声明。运行时传普通 React `style` prop，由物料转发到已有真实 DOM，不添加统一包装节点。

`src/materials/style.ts` 明确本地物料能力。普通物料指原根元素；输入/选择/日期/单选组/勾选组指已有整字段根元素；Dialog/Drawer 指 Popup，触发器及编辑 host 不受盒子样式影响。隐藏的旧演示和专用代码物料不宣称通用样式能力。

文本、标题、按钮、标签、链接、空态和字段支持文字子集。Heading 将文字样式转发给已有 h2；字段在既有外框应用盒子样式，同时将文字子集转发给已有 label/控件/选项文字，避免默认字体 CSS 遮蔽显式设置。复杂容器、表格、列表、弹层等首批仅开放盒子/布局/backgroundColor，未承诺统一改写所有内部/嵌套物料文字。

优先级为基础 CSS → 旧 props 派生样式 → Node.style。例如 Layout.gap/padding 被显式样式覆盖，删除声明恢复旧值；Dialog.width 仍提供默认宽度，显式 width 覆盖 Popup 宽度。gap 在运行时规范化为 rowGap/columnGap，Layout/Form 的派生间距也使用明确长属性，避免 React 删除混合 shorthand 时清掉未变化的回退值。单独 rowGap/columnGap 高于同组 gap。

组件自身显隐优先：TabPanel 的 hidden 以及 Popup 的 data-closed 使用局部 display:none!important，显式 display 不会显示未激活页签或已关闭弹层。设计态原有可编辑展示行为保留。

## 编译、命令与运行行为

style Value 进入结构/语义/类型/引用/作用域检查和冻结计划，其状态、表单、数据源依赖参与更新订阅。删除被引用的状态、数据源或字段以及跨插槽移动均检查样式引用。组件契约样式能力先复制再冻结，不冻结调用方注册表。

`EditorDocument.setStyle(pageId, nodeId, patch, group?)` 原子应用多个声明，undefined 删除单项，空对象自动从节点移除。失败不改定义/历史；成功支持分组撤销、重做、复制节点、JSON 导入导出与本地项目恢复。该命令不清改业务 props。

动态声明逐项求值和领域校验；某项失败只忽略该项，其他样式与组件继续渲染。错误在 React effect 中记录为 style.error，含 nodeId、实例与 style.key，并按当前错误签名去重。错误值的描述不依赖业务对象的 toString。依赖恢复后自动重新应用；以后再次出现错误可重新记录。不保存运行数据、执行状态或编辑草稿到应用 Schema。

## 样式面板

选中组件后，右侧“样式”Tab 只显示该物料声明支持的属性，按尺寸、间距、布局、文字与背景分组，默认仅展开尺寸。尺寸与间距使用紧凑双列；复杂绑定按字段显式展开。全高工作台仍只滚动内容区。

固定值直接输入 `16`、`12px`、`100%` 或 `auto`，无需 JSON 引号；枚举使用 Base UI Select，颜色提供文本与色块预览。空占位“跟随组件设置”只表示回退，不会把默认值写入 Schema。无效输入保留为当前页/节点/属性的独立草稿，不改变定义与历史；切换组件或折叠后仍能继续编辑。外部撤销导致定义变化时按现有草稿策略提示冲突与确认。

每项的链接图标展开共用 Value 编辑器，支持表达式、页面状态、表单字段、表单数据和数据源。选择取值方式并点击“应用绑定”才提交；固定值仍使用自然输入。已绑定声明显示绑定提示，不能被保留的旧固定值 Setter 回调覆盖，需显式“切换固定值”或恢复。切换固定值清除原绑定，恢复组件默认行为，随后可输入新值。

正在编辑尚未应用的动态绑定或清除声明草稿时，固定值控件暂停显示；旧 Setter 的五种回调均静默失效，不改写草稿和错误。“切换固定值”可显式放弃该草稿并保留原已提交固定值；若原声明已经是动态绑定，则清除原绑定。最初未设置样式的 unset 状态仍可直接输入自然固定值，不受此保护误伤。

单项恢复、分组恢复与“恢复全部”删除对应显式声明，同时清除该范围内未应用的草稿与错误，包括已折叠字段。分组或全部恢复是单次原子命令，可一次撤销；撤销恢复样式定义，不恢复已明确丢弃的输入草稿。恢复不会修改旧组件属性。

面板通过 N7 的 `LiteralSetter` 使用普通 TSX `StyleValueSetter`，注册 ID 为 `style.value`，`options.property` 指定属性。内部保留外层 registry，宿主可使用 `SetterRegistryProvider` 按同 ID 替换。所有写入仍经 `setStyle` 校验；旧回调在字段卸载、切换节点或切换页面后失效。悬浮帮助统一为 Base UI Tip，无原生 HTML title。

N7 Setter、N8 样式协议和 N9 面板的正式验收状态见 [开发流水线](development-pipeline.md)。HTTP、出码、完整插件系统及 when/repeat 可视化配置继续延期。
