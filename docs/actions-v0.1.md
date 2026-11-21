# 事件与动作 v0.1

右侧“事件”面板读取物料注册表的 `ComponentContract.events`，选择原生 React 风格的 `onClick`、`onSubmit`、`onOpenChange` 等事件，再配置顺序执行的动作。字段绑定后的 change / blur 回调由表单适配器管理，不开放覆盖。

每个事件是一份独立草稿，可以添加、删除、上下移动动作，以及配置参数和返回值保存位置。点击“保存事件”后整条链通过 `EditorDocument.setEventActions(pageId, nodeId, eventName, actions)` 一次校验、提交和记录撤销历史。参数不合法不会改变当前页面；切换组件、事件或面板会保留草稿。若同一事件的已提交定义变化，必须选择“确认使用草稿”或“放弃草稿”解决冲突。新动作使用 UUID，未提交的其他组件草稿也不会争用身份。

## Schema 与 React

继续使用现有 `NodeSchema.on`、`ActionCall`、`Value`，没有引入新的流程语言。示例：

```json
{
  "onClick": [
    {
      "id": "open-editor",
      "action": "state.set",
      "input": {
        "stateId": { "kind": "literal", "value": "drawerOpen" },
        "value": { "kind": "literal", "value": true }
      }
    }
  ]
}
```

参数可以使用固定 JSON 值、`stateRef`、`fieldRef`、`formValues` 或标准 JavaScript 表达式子集。`stateRef.path` 使用可逆的 JSON 字符串数组，例如 `["profile", "name"]`；含点键名 `["first.name"]` 和空键 `[""]` 均能完整保留。固定字符串直接输入文本，其他固定值使用 JSON。可用表达式根为 `state`、`forms`、`event`、`scope`。`scope.row` 等参数仅在实际提供它们的插槽/循环中可用；事件命令拒绝不存在的作用域。事件值保持 React 物料实际回调的参数，例如输入事件读取 `event.target.value`，Base UI `onOpenChange` 的 `event` 就是布尔值。

`resultTo` 只提供给声明返回值的动作，目标为同页类型兼容的状态。动作依赖在提交时从注册表自动补全，动作 ID 必须全页唯一。已有 Schema JSON 的导入、运行及导出方式保持一致。

复杂异步业务用宿主注册的 TypeScript 函数实现，通过 `ActionContract` 声明参数类型、返回类型和版本。物料继续使用 TSX、Hooks 和原生回调；表达式不是任意 JavaScript 执行器，不支持把整段脚本或函数体粘进配置。

## 内建动作

| 动作             | 参数                                                   | 行为                                             |
| ---------------- | ------------------------------------------------------ | ------------------------------------------------ |
| `state.set`      | `stateId: string`、`value: Json`                       | 校验目标状态类型后设置                           |
| `form.setValues` | `formId: string`、`values: object`                     | 按业务数据路径原子回填                           |
| `form.reset`     | `formId: string`                                       | 取消当前提交，恢复模型初始值、清理错误和触碰状态 |
| `form.submit`    | `formId: string`                                       | 校验模型，再运行对应容器的 `onSubmit`            |
| `ui.notify`      | `title: string`、可选 `description`、`tone`、`timeout` | 发出当前页面实例的消息通知                       |

宿主注册的动作自动出现在动作类型列表中。`demo.saveRecord` 只是本地异步业务函数示例，不是新的物料。

### 回填语义

`form.setValues` 和 `FormRuntime.setValues` 都是 **patch**：键使用字段 `path` 组成的业务嵌套对象，不能使用字段内部 ID 替代。只更新传入路径，未传字段和明细数组保持原值；传入明细数组则整组替换，重新生成内部行身份。普通多选字段仍使用基本值数组。明细中未传的子字段采用定义的初始值。

例如字段 ID 为 `customerName`、路径为 `['customer', 'name']`，应回填 `{ "customer": { "name": "小林" } }`。未知路径、类型错误、非法明细行均在修改前检查，失败不发布变更，也不清除原有错误。成功只发布一次。回填可以设置隐藏或禁用字段，以支持业务记录加载；提交中拒绝回填，防止改变已经锁定的提交快照。成功回填不改变模型的重置基线，也不自动清除 touched。

已知字面量 `formId` 和 `values` 在导入、保存事件以及删除/修改字段时也执行同一套 patch 预检；被字面量回填引用的路径不能直接删掉或改成不兼容类型。动态值在运行时使用相同检查。

### 提交语义

原生 `<form onSubmit>` 和动作 `form.submit` 共用 `PageRuntime.submitForm`，统一字段校验、提交快照、提交状态、错误和取消逻辑。表单内按钮使用 `type="submit"` 即可；表单外按钮配置 `form.submit`。普通 `formValues` 参数在提交期间读取已锁定的业务值。

按 `formId` 程序化提交时，页面必须有唯一、且不在重复节点或插槽中的对应表单容器。模型自身不是 UI 实例，多个容器或带参数实例不能猜测提交目标，运行时会给出错误。原生提交则显式传入当前容器和实例 `scope`、`instanceKey`，保留实际实例上下文。

校验失败、提交失败、已在提交或提交被取消，都会终止调用方动作链。`onSubmit` 内不能再次提交自身，跨表单 `A → B → A` 也会立即报告循环。外层动作被替换或页面销毁时，取消信号传播到表单和提交子链；重置表单也会取消正在进行的提交。已取消的宿主动作即使忽略 `AbortSignal`，也不能通过 `ActionContext` 迟到写状态、回填、重置、提交或通知。宿主函数仍应尊重 `signal`，避免外部服务继续工作。

异步动作顺序等待，失败停止后续操作；运行日志记录动作开始、成功和错误，工作台显示等待数量。表单的 `isSubmitting` 可直接绑定按钮 `disabled`；`ui.formStatus` 展示待提交、校验与服务端错误。`onConfirm` 返回动作 Promise，弹层可显示处理中和错误。编辑模式不会执行物料业务事件。

弹层仍使用原生受控 `open/onOpenChange`：`open` 绑定布尔状态，`onOpenChange` 用 `state.set` 写入 `event`。打开、关闭和确认不使用组件定位指令。

## 完整示例

导入 [actions.json](../public/examples/actions.json)，切换预览模式：

1. 点击表格某行“编辑”：保存记录 ID，重置表单，通过 `scope.row` 原子回填，再打开抽屉。
2. 编辑姓名和部门。表单内“保存记录”使用原生提交；底部“提交表单”使用动作提交。
3. `demo.saveRecord` 等待本地模拟服务，把返回数组写回 `records`，发送成功通知并关闭抽屉。
4. 清空姓名可验证必填；姓名包含“失败”可验证服务错误，表单保留输入，后续通知和关闭不会执行。

示例单一来源是 `src/action-example.ts`，执行 `npm.cmd run schema:export` 同步 JSON。当前示例仅使用内存数据，没有真实服务器持久化；网络数据源、鉴权和路由是后续能力。
