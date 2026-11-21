# 画布视口与编辑缩放

本轮目标是让画布内容宽度、编辑显示比例和坐标处理分别管理。当前实现与验收状态见 [一天工作记录](workday-2026-11-09.md)；本文说明设计契约，不代表尚未完成的浏览器验收已经通过。

## 操作约定

- 内容宽度：自动、桌面 1440px、平板 768px、手机 390px、自定义 240～3840px 整数。自动宽度为可用内容宽度与 960px 的较小值，最低 240px。
- 编辑缩放：50%～150%，可恢复 100%。缩放只改变显示比例，不改变逻辑内容宽度。
- 适应宽度：持续跟随画布可用宽度，仍受 50%～150% 限制；显示实际比例。达到下限时，宽页面仍需横向滚动。手动调整比例会退出适应模式。
- 自定义宽度：有效整数在 Enter 或失焦后应用；无效草稿不改变画布，Escape 恢复已应用值。
- 预览：保留内容宽度，始终按 100% 显示；返回编辑后恢复编辑比例或适应模式。预览中的缩放控件禁用。
- 正在按住准备拖动、鼠标拖动或键盘拖动时，视口设置冻结；结束后仅应用最新的可用尺寸测量，不补执行已拒绝的用户操作。

设备名称只是内容布局宽度预设。当前使用同一页面内的容器，**不模拟独立浏览器窗口**：`window.innerWidth`、`matchMedia`、`@media` 和 `vw` 仍取实际浏览器窗口。需要真正的设备媒体查询预览时，应另做 iframe 宿主与事件、焦点、Portal 和生命周期协议。

## 架构边界

`ViewportStore` 属于编辑会话，不写入 Schema、撤销历史或 localStorage。修改宽度和倍率不替换 Runtime、React root、业务节点或 Portal 容器。

`CanvasViewport` 测量未缩放的画布滚动区。`CanvasSurface` 提供真实逻辑宽度，其物理占位为逻辑尺寸乘以比例；只有业务内容层进行设计态缩放。选框、落点、工具条和浮层范围横条使用未缩放的屏幕尺寸。

预览内容祖先没有缩放 transform，包括不设置 `scale(1)`，以维持现有 Base UI 弹层和 fixed 定位语义。普通 Schema 页面沿用现有 Runtime 生命周期。代码页沿用既有编辑/预览切换生命周期；承诺同一次预览中调宽不重挂 Hook，不额外承诺跨编辑/预览保留代码组件 DOM。

坐标只在明确边界转换：`getBoundingClientRect`、指针、`elementFromPoint`、选框和 6px 拖动阈值均为客户端 CSS 像素；内部滚动容器的 `scrollLeft`、`scrollTop` 是该容器的逻辑像素，需要按它自身的视觉比例换算。外层未缩放画布滚动区比例为 1。真实 DOMRect 字段显式读取，不依赖对象展开。

宽度或倍率变化保留可见页面的逻辑中心，再由原生滚动范围夹取。只有内容滚动；定位和自动滚动不得以 `window.scrollBy` 作为后备。

## 官方产品对照

本轮读取官方仓库固定提交的文档与源码，没有运行这三款产品，也不把默认分支称为稳定发布版。

| 对照产品         | 可借鉴的架构                                                      | 本项目采用的部分                  |
| ---------------- | ----------------------------------------------------------------- | --------------------------------- |
| AliLowCodeEngine | Viewport 分离宽度、内容宽度和 scale，集中进行全局/局部坐标转换    | 会话视口与统一坐标边界            |
| TinyEngine       | 设备宽度与比例分离，iframe 内外事件区别处理，预览有独立通信方案   | 宽度和比例独立；本轮不迁移 iframe |
| GrapesJS         | Device 宽度与媒体断点独立；Canvas 有 zoom、世界坐标与 fitViewport | 按宽持续适应，不按长页面高度压缩  |

官方证据：

- [Ali Viewport](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/builtin-simulator/viewport.ts)、[Dragon 事件边界](https://github.com/alibaba/lowcode-engine/blob/f6305c2284950d79b9729781f081f24f113de345/packages/designer/src/designer/dragon.ts)。
- [Tiny 设备工具](https://github.com/opentiny/tiny-engine/blob/3c46a9752cada9c1a3d667b5641857a5920f71ff/packages/toolbars/media/src/Main.vue)、[CanvasResizeBorder](https://github.com/opentiny/tiny-engine/blob/3c46a9752cada9c1a3d667b5641857a5920f71ff/packages/canvas/container/src/components/CanvasResizeBorder.vue)、[预览](https://github.com/opentiny/tiny-engine/blob/3c46a9752cada9c1a3d667b5641857a5920f71ff/packages/common/js/preview.ts)。
- [GrapesJS Device](https://github.com/GrapesJS/grapesjs/blob/e023d69b9fa97fbbc693052c9818f0c477b105a5/packages/core/src/device_manager/model/Device.ts)、[CanvasView](https://github.com/GrapesJS/grapesjs/blob/e023d69b9fa97fbbc693052c9818f0c477b105a5/packages/core/src/canvas/view/CanvasView.ts)、[Preview 命令](https://github.com/GrapesJS/grapesjs/blob/e023d69b9fa97fbbc693052c9818f0c477b105a5/packages/core/src/commands/view/Preview.ts)。

完整研究及获取时间、URL 和 SHA256 记录保留在 `E:/dimlu-ai-pipeline/reports/024-viewport-foundation/research.md` 与同目录 `raw/manifest.json`。本轮不包含响应式 Schema、断点样式继承、无限画布或不可信代码安全沙箱。

## 验收要求

独立测试检查坐标往返、非整数比例、内部双轴滚动、裁剪、中心锚点、拖动期间冻结及 Form/React/Portal/代码状态身份。冻结快照上串行执行相关回归、完整测试、Schema 导出、严格类型检查、构建和格式检查。

实际浏览器还需覆盖 50% / 100% / 150% / 非整数适应比例、窄窗口、真实鼠标拖放、定位、嵌套浮层与日期/选择器，以及页面外壳不滚动。JSDOM 模拟几何测试不能替代这些验证；未完成项会在工作记录中保留。
