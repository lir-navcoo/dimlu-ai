# 物料库调研与取舍

调研日期：2026-11-08。目标为 React 运行时低代码平台，UI 基础继续使用 Base UI + Tailwind CSS。

## 官方资料与证据

阿里 LowCodeEngine 没有要求每个平台提供一份固定的“必选 UI 组件表”。官方规范定义了组件、区块、模板及其描述、分发方式；具体组件集合由宿主选择。下面的优先级是针对本项目的设计建议。

- [官方物料仓库](https://github.com/alibaba/lowcode-materials)：提供 Fusion、Ant Design 等物料实现及低代码描述。
- [物料协议](https://github.com/alibaba/lowcode-engine/blob/main/docs/docs/specs/material-spec.md)：组件、区块、模板等概念与元数据。
- [资产协议](https://github.com/alibaba/lowcode-engine/blob/main/docs/docs/specs/assets-spec.md)：组件包与编辑资产组织。
- [编辑器物料扩展](https://github.com/alibaba/lowcode-engine/blob/main/docs/docs/guide/expand/editor/material.md)：组件实现、属性设置器与编辑能力的衔接。

本次检查的物料仓库 main 修订为 `8d0d912e5872988ae11050cafcf1cc46bad21514`，提交时间为 2024-09-21。以下链接固定到该源码修订；本调研没有验证这些包在当前 npm 上的版本及依赖兼容性。

| 源码                                                                                                                                                                     | 可借鉴的能力                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| [AntD 物料目录](https://github.com/alibaba/lowcode-materials/tree/8d0d912e5872988ae11050cafcf1cc46bad21514/packages/antd-lowcode-materials/lowcode)                      | 布局、表单、数据展示、反馈组件分类       |
| [Row 元数据](https://github.com/alibaba/lowcode-materials/blob/8d0d912e5872988ae11050cafcf1cc46bad21514/packages/antd-lowcode-materials/lowcode/grid.row/meta.ts)        | 容器标记、嵌套规则、子项白名单           |
| [Form.Item 元数据](https://github.com/alibaba/lowcode-materials/blob/8d0d912e5872988ae11050cafcf1cc46bad21514/packages/antd-lowcode-materials/lowcode/form.item/meta.ts) | 字段名称、标签、校验、受控值属性适配     |
| [Table 元数据](https://github.com/alibaba/lowcode-materials/blob/8d0d912e5872988ae11050cafcf1cc46bad21514/packages/antd-lowcode-materials/lowcode/table/meta.ts)         | 数据源、行身份、列配置、列渲染作用域插槽 |
| [Input 插入片段](https://github.com/alibaba/lowcode-materials/blob/8d0d912e5872988ae11050cafcf1cc46bad21514/packages/antd-lowcode-materials/lowcode/input/snippets.ts)   | 物料标题、预览与默认 Schema 片段         |
| [Button 元数据](https://github.com/alibaba/lowcode-materials/blob/8d0d912e5872988ae11050cafcf1cc46bad21514/packages/antd-lowcode-materials/lowcode/button/meta.ts)       | 属性设置器、事件、变量支持               |

## 当前组件取舍

| 类别                 | 组件                                               | 当前处理                                                          |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| 页面基础             | 布局容器、标题、文本、按钮                         | 保留，负责页面结构、内容和操作                                    |
| 表单基础             | 表单容器、文本输入、数字输入、选择器、勾选框、开关 | 保留；文本输入统一单行/多行，选择器支持文本和数字实际值、数组多选 |
| 常用展示             | 标签、空状态                                       | 保留，通用且可独立使用                                            |
| 示例组件             | 成员行、成员插槽卡片、React 计数器                 | 从面板隐藏，保留已有 Schema 的渲染兼容                            |
| 汇总组件             | 摘要                                               | 从面板隐藏，简单汇总先由文本和布局组合                            |
| 依赖上下文的业务实现 | 采购明细、表单状态                                 | 继续仅供示例运行，不直接提供拖入                                  |

基础物料原为 12 项，本轮新增 19 项，物料面板共 **31 项**。`MaterialMetadata.palette` 只控制是否显示，`insertable` 控制是否支持直接插入；组件注册表继续决定运行时能力。隐藏物料不移除其运行实现，旧示例和已保存定义仍可运行。

## 后续补齐顺序

以下为调研时的优先级。第一轮组件已按 [实施记录](components-phase-one.md) 完成；上传、折叠面板、服务端查询分页接口及可选扩展仍待后续实施。选择器已完成单选 / 多选、可视化选项配置与字段适配；勾选框、开关已完成布尔适配和必须为 true 校验。见 [选择器](select.md) 与 [布尔控件](boolean-controls.md)。

1. **业务表单**：单选组、日期/时间。优先补齐不同值类型、空值、受控事件和校验语义；上传需要文件服务契约后接入。
2. **通用页面**：图片、链接、普通卡片、Tabs、折叠面板。卡片使用通用标题/内容/底部插槽，避免绑定“成员”等领域对象。
3. **CRUD**：通用表格、列表、分页。必须同时支持稳定行 key、列/行作用域插槽、加载/错误/空状态及查询分页接口。
4. **交互反馈**：对话框、抽屉、提示、加载状态。先确定 Portal、焦点管理及画布内选中/编辑方式；不能只封装外观。
5. **可选扩展**：统计指标、图表、富文本和领域区块，按实际需求装载。

成员目录、采购业务可作为独立业务物料包或区块。计数器继续作为原生 React Hooks 扩展示例，避免占据日常物料面板。

## 架构重点

- **分离运行契约与编辑描述**：组件标识、版本、props、事件和插槽属于运行契约；图标、分类、属性编辑器和面板可见性属于编辑元数据。
- **统一字段适配**：明确值的所有者、空值、`value`/`checked` 等受控属性及事件取值路径。标签、初始值和校验继续归字段模型管理。
- **通用容器与具名插槽**：嵌套约束应同时用于插入、移动和导入校验；表格列等场景需要显式作用域参数和引用检查。
- **默认插入片段**：由简单默认 props 演进到可包含子树、插槽和必要上下文的片段，插入时原子生成唯一 ID 并完整校验。
- **稳定身份**：组件 ID、循环 key、表格行 key 分别承担结构与业务身份，不能使用数组下标替代。
- **保留原生 React 扩展**：复杂业务通过 TSX、Hooks 和原生事件实现。Schema 承担组合与声明，编辑器不能改变业务组件的身份和状态语义。

借鉴阿里的物料描述、插入片段、嵌套约束和作用域插槽设计；当前项目无需因此引入 Ant Design 或整套复制其组件目录。文本输入已统一支持单行/多行；选择器已验证多种值类型与字段适配链路，勾选框、开关已验证布尔值回调及校验语义，单选组、多选组及日期/时间已在本轮补齐。
