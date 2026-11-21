# 勾选框与开关

`ui.checkbox@1.0.0` 与 `ui.switch@1.0.0` 使用 Base UI Checkbox / Switch，保留 `checked / onCheckedChange`，回调直接传布尔值，不构造 HTML change 事件。两者共享布尔字段语义，展示和操作方式独立。单个 Checkbox 在物料面板中命名为“勾选框”，表示一个布尔值；多项下拉选择使用选择器的多选模式，值为数组。旧 `ui.checkbox` 标识保持兼容。

```tsx
<CheckboxMaterial label="确认信息" checked={confirmed} onCheckedChange={setConfirmed} />
<SwitchMaterial label="接收通知" checked={notify} onCheckedChange={setNotify} />
```

## 布尔值与校验

| 配置                          | false | true |
| ----------------------------- | ----- | ---- |
| 普通布尔字段                  | 有效  | 有效 |
| `required`：值不能为空        | 有效  | 有效 |
| `mustBeTrue`：必须勾选 / 开启 | 无效  | 有效 |

布尔字段初始值只能是 `true / false`，不能使用 `null`、文本 `"true"` 或数字。关闭和未勾选也会通过表单 store 提交为 `false`，不会因原生 checkbox 的 FormData 行为而丢失。

`mustBeTrue` 是 Schema v0.1 的新增规则，仅支持布尔字段，包括动态明细的布尔子字段。旧 `required` 规则保持不变。

```json
{
  "id": "confirmed",
  "path": ["confirmed"],
  "label": "确认信息",
  "type": "boolean",
  "initial": false,
  "rules": [{ "kind": "mustBeTrue", "message": "请先确认信息" }]
}
```

字段编辑器新增布尔字段时默认关闭，不会自动添加校验；点击“添加校验规则”默认选择“必须为 true”。也可切换为“必填”，该规则允许 `false`。绑定后的 `required` 属性仅由 `mustBeTrue` 派生，避免原生控件把普通布尔必填误解为必须勾选。

## 运行与编辑

- 两个组件均支持标签、辅助说明、禁用和字段错误。标签可点击，支持 Space 键切换和焦点提示；勾选框 16px、开关 30×18px，标签行至少 32px。
- 未提供 `onCheckedChange` 时，将 Schema 的 `checked` 作为初始值，使用本地 React 状态。切换编辑/预览保留状态，重置页面或修改定义恢复初始值；不会将预览操作写回 Schema。
- 绑定字段时，标签、默认值、校验、显示/禁用条件、失焦与提交锁由表单管理。表单重置恢复绑定字段的初始值；容器外独立控件的本地状态由“重置页面”恢复。
- 独立控件上的“必须勾选/开启”属性传递给 Base UI 的原生约束。需要平台表单校验和错误展示时，应绑定字段并设置 `mustBeTrue`；平台表单使用 store 校验。
- 可视化字段绑定仍限定到最近表单容器的布尔字段。支持创建并绑定、解除绑定、撤销和重做；解除绑定恢复模型初始值，并保留必须为 true 对应的属性，不复制预览值。
- 编辑模式用于选中、拖动画布组件本体、复制和删除；预览模式执行真实控件交互。边界测量排除 Base UI 的不可见辅助输入框。

运行契约中的 `field.changeEvent` 新增 `onCheckedChange`。原生 React `<input type="checkbox" {...useField(...).input} />` 仍使用 `onChange` 原生事件，两条适配路径操作同一份 store。字段节点禁止重复声明 `onChange / onValueChange / onCheckedChange / onBlur`。

独立 Schema 事件读取 `event` 本身，其值为 `true / false`，不使用 `event.target.checked`；使用原生 `onChange` 的代码组件仍读取原生事件。

导入 [布尔控件示例](../public/examples/boolean.json) 可验证必须勾选、普通开关提交 `false`、表单重置与独立开关。提交只验证本地表单，不调用远程服务。

测试覆盖本地/受控回调、字段值与规则、原生 React 适配、禁用/隐藏/提交锁、明细行校验、字段创建、绑定冲突、撤销及物料插入。浏览器验证覆盖 Space 键切换、标签点击、真实提交值、重置边界、拖动重排、选框贴合及全高外壳。

当前勾选框仅支持单个布尔值；勾选框组、半选状态及布尔三态尚未提供。
