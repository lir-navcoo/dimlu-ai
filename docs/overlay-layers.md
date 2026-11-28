# 浮层层级

所有 body Portal 共用 `src/styles.css` 的有界语义层级：工作台侧栏遮罩/面板 80/90，业务 Dialog/Drawer 遮罩/弹层 1400/1401，交互 Popup 1500，Tooltip 1600，通知 2000。CSS 变量集中声明，独立物料样式保留相同默认值。

物料 Select、编辑器 Select、Menu 和页面 Combobox 的定位器使用同一 Popup 层；Tooltip 位于其上。因此采购抽屉和窄屏属性检查器中的选项、菜单与提示都能出现在承载弹层之上。编辑器 Select 不再使用独立的 Tailwind z-index 常量。

继续使用 Base UI 原有 Portal、modal、focus trap、Escape 和焦点恢复机制，不通过关闭 modal 或 pointer-events 绕过遮挡，也不把业务选项移入画布滚动容器。固定层级用于当前模态面与其子浮层，未扩展为任意层数的嵌套模态管理器。

功能回归验证抽屉中真实 Portal 选项选择、焦点恢复、Escape 先关闭子浮层，以及属性检查器中的 Select/Menu/Tip。JSDOM 不执行真实层叠绘制，最终可见性与鼠标命中由独立浏览器验收确认。

013已正式验收：真实浏览器中Drawer/Dialog选项中心命中返回Popup内选项文本，Popup1500高于模态1401；鼠标、键盘选择、Escape、焦点返回和Tooltip1600均通过。011的部门遮挡原始失败截图与命中证据保留，012中间快照不改写；最终报告位于外部 `E:\dimlu-ai-pipeline\reports\013-overlay-layer-fix\browser-evidence.json`。最终组合60文件469项测试及全部检查、52组独立评审通过，主Agent已正式接受。

稳定修复画面见 [采购申请独立运行页](readme-purchase-runtime.jpg)，完整状态见 [开发流水线](development-pipeline.md)。
