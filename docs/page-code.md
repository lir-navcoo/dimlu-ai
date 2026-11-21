# 页面 React 代码

页面左侧“代码”面板支持直接编写 JSX / TSX 和 CSS。启用后，页面的 `export default` React 组件替代 Schema 组件视图。已有 `children` 不删除，点击“禁用代码”即可恢复。不会把当前采购案例改成代码案例。

## 编辑与运行

选择 JSX / TSX、修改代码和 CSS，勾选“启用页面代码”，点击“保存并应用”。保存使用按需加载的 Sucrase 转换 JSX / TS 及 ES 模块，校验语法和模块导入，不执行作者模块。TSX 的类型注解会被移除；此阶段不提供 TypeScript 语义类型检查。

编辑模式仅显示代码页占位，不执行作者 JS。切换“预览”才加载并求值模块、挂载 React 组件。退出预览、切换页面或应用代码更新会卸载代码组件并清理 React effect；再次进入预览会重新求值，内部 Hook 状态重新初始化。页面 Runtime 仍由工作台管理；仅编辑/预览切换不重建 Runtime。

保存按页保留会话草稿；切换面板或页面不会丢弃尚未保存的代码。Undo / Redo 或其他编辑改变已保存的代码后，旧草稿显示冲突，先确认使用草稿再应用，或放弃草稿。异步编译结束时页面或文档已改变，旧结果不会覆盖新文档。

## 模块与 Hooks

支持静态导入 `react`、`react/jsx-runtime`、`@dimlu/runtime`，也支持从这三个模块重新导出。React 使用平台已有的同一个实例。未知模块保存时明确报错；不提供 npm 包加载、相对文件导入、动态 `import()`、`import.meta` 或 CommonJS `require()`。

```tsx
import { useState } from 'react';
import { useRuntime, useRuntimeState, useDesignMode } from '@dimlu/runtime';

export default function Page() {
  const [count, setCount] = useState(0);
  const runtime = useRuntime();
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

`@dimlu/runtime` 导出既有 `useRuntime`、`useRuntimeState`、`useForm`、`useField`、`useFieldArray`、`useDataSource`、`useDesignMode`。Hooks 读取当前页现有 Runtime 和表单/数据源定义；使用不存在的 ID 会进入局部错误界面。default 导出支持函数组件、class 组件、React.memo / forwardRef / lazy；lazy 组件有 Suspense 加载提示。组件同时收到 `runtime` prop。

## CSS 与运行边界

代码 CSS 和页面内容通过 React Portal 放入单独 ShadowRoot，同属原 React 树，保留 Runtime context。普通页面 CSS 选择器不会修改编辑器控件；页面内部用普通 class 和原生 HTML 样式。Shadow DOM 的样式继承、CSS 自定义属性以及显式向外创建的 Portal 仍遵循浏览器行为。

这不是安全沙箱：作者 JavaScript 在当前窗口和线程运行，能够访问浏览器全局对象、网络和存储。只运行可信作者代码；无限循环可能阻塞窗口。白名单是模块解析能力的范围，不是安全隔离。模块加载、缺失 default、渲染及 React effect 错误显示局部失败提示与重试，保留工作台。任意异步回调、事件处理器抛错和作者自行创建的全局副作用需由作者处理及清理。

## Schema 与文档命令

```json
{
  "code": {
    "enabled": true,
    "language": "tsx",
    "source": "export default function Page() { return <h1>Hello</h1>; }",
    "css": "h1 { color: steelblue; }"
  }
}
```

`PageSchema.code` 是可选严格对象，四个字段必须齐全，不允许其他字段。`EditorDocument.setPageCode(pageId, code | undefined)` 是原子的结构提交，支持撤销和重做，不加载编译器或执行作者代码。`undefined` 移除代码定义；禁用通常保留 source / css，仅设 `enabled: false`。运行时应用定义编译、项目存储、JSON 导入导出均保留代码原文，不保存临时编译产物。程序调用 setPageCode 或导入 JSON 仅进行 Schema 校验，代码语法错误在预览时局部显示；面板保存会先做代码语法和模块校验。
