# 本地项目保存与恢复

工作台自动保存当前已提交的应用定义和选中页面/组件，刷新后从当前浏览器恢复，并始终以编辑模式启动。顶部磁盘菜单显示“保存中 / 已保存 / 保存失败 / 恢复受保护”，提供重试与重置操作。文件菜单的 JSON 导出始终可用。

## 存储边界

独立 TypeScript `ProjectStorage` 接收 `{ getItem, setItem }` 适配器，默认读写浏览器 `localStorage` 的 `dimlu.workbench.project.v1`。协议为 `{ storageVersion: 1, savedAt, schema, selection? }`，其中 schema 是文档命令已校验提交的 `ApplicationSchema`；selection 是可丢弃的 `{ pageId, nodeId }` 编辑元数据。布局继续使用独立的 `dimlu.workbench.layout.v1`，布局或 selection 不合法时各自回退，不连带拒绝有效 Schema。

运行时状态、表单输入/错误、数据源结果/loading/error、saveCommitted 的运行值、请求和副作用、预览模式、Schema/属性/动作面板未提交草稿、撤销历史均不写入。Schema 中声明的初始状态值仍然属于应用定义。恢复会创建新 `EditorDocument` 和 `PageRuntime`，不恢复旧页面实例，不执行编辑态 `onEnter`，没有历史可撤销。

## 校验与原文保护

启动读取依次完成 JSON 解析、storageVersion 检查和完整编译校验（包含注册能力与依赖版本），全部通过才原子采用恢复文档。损坏 JSON、不支持的版本、无效 Schema 和读取异常都会进入保护状态。当前内存仍可编辑初始示例或导入合法定义，但初始化、选择、布局调整、自动保存和卸载均不会覆盖原本地项目。

能够读取的原字符串保留在内存，可通过“导出恢复原文”下载。使用“用当前项目替换本地副本”或“重置项目”需要 Base UI Dialog 显式确认；取消保持存储不动。浏览器完全拒绝读取时无法取得原文，界面会显示读取错误并保留存储。重置建立全新文档与编辑会话，清除撤销历史、未提交草稿并回到初始示例。

## 保存一致性

`start()` 订阅文档的已提交修改和选择变化，默认 350ms 合并连续更新。timer 只标记待保存工作，`flush()` 始终读取当下最新文档快照。pagehide 与正常卸载会同步尝试保存最新定义；`stop()` 取消 timer 和订阅，过期 timer 不会旧写回。React StrictMode 的 setup/cleanup/setup 复用同一控制器；HMR 替换文档时 `bindDocument()` 取消旧 timer 和旧订阅再绑定新文档。

写入遇到 QuotaExceededError / SecurityError 会明确显示失败，并保留当前内存文档和导出入口，只有实际 `setItem` 成功才显示已保存。重试使用最新定义，不使用失败请求的旧序列化内容。恢复保护状态只允许用户确认后写入。

本阶段只保存当前浏览器的单个项目；没有后台、账号、云同步和跨标签页冲突合并。清理浏览器站点数据会清除本地副本，JSON 文件可用于手动备份和迁移。

## 验证

开发测试覆盖最新 revision/Undo、损坏与未来版本原文保护、依赖校验、坏 selection 独立回退、读取/配额异常、重试最新定义、HMR 旧订阅与 timer 取消；真实 App 测试覆盖 StrictMode、pagehide、卸载后重新挂载恢复、编辑零请求、运行时表单输入和未应用 Schema 草稿排除、原文下载、替换/重置 Dialog 和失败状态。独立验收在冻结副本运行完整回归及浏览器验证。

N5 已正式验收：336 项测试、严格类型、构建、协议导出及格式检查全部通过。浏览器验收确认刷新后恢复项目定义并以编辑模式启动，运行输入与撤销历史未恢复；390×844 和 760×900 的正常页面及实际确认对话框均无外层滚动。

验收画面：[桌面恢复](project-storage-desktop.png)、[手机布局](project-storage-mobile.png)、[手机确认对话框](project-storage-mobile-dialog.png)、[平板布局](project-storage-tablet.png)。
