# 选择器

`ui.select@1.0.0` 为 Base UI 选择器物料，支持单选 / 多选，采用 React 受控属性 `value / onValueChange`，不伪造 HTML change 事件。

## 配置

```tsx
<SelectMaterial
  label="优先级"
  value={priority}
  onValueChange={setPriority}
  options={[
    { label: '低', value: 0 },
    { label: '普通', value: 1 },
    { label: '暂不可用', value: 9, disabled: true },
  ]}
/>
```

每项包含 `label`、`value` 和可选的 `disabled`。实际值支持非空文本或有限数字；同类型实际值不能重复，数字 `0` 与文本 `"0"` 是两个不同值。空数组允许，展开时显示“暂无选项”。名称与实际值分别配置，选择回调直接传实际值。

右侧选项编辑器可修改名称、类型、实际值、禁用状态，添加/删除后点击“应用选项”统一提交。每次应用独立进入撤销历史。无效草稿保留，文档与预览保持上一次有效定义。全数字选项新增时沿用数字类型。

`options` 同时支持固定数组、状态引用和 JavaScript 表达式。编辑器检查固定值，渲染器检查解析后的动态值；动态数据无效时仅该节点显示错误，数据恢复后重新显示。选项移除当前值时保留该值并显示说明；不会静默修改表单数据。若业务要求提交值必须属于当前选项，应在字段规则中额外声明成员校验，必填规则只检查是否为空。

## 多选模式

物料面板仍只有一个“选择器”，右侧“选择模式”设置 `multiple`；默认 `false` 单选，`true` 多选。多选使用 Base UI 原生数组 `value / onValueChange`，选择一项后菜单保持打开，再次点击取消该项，Escape 关闭。已选名称在 32px 控件内以顿号连接，过长时省略；清空按钮保持在组件内，回调传 `[]`。

```tsx
const [selected, setSelected] = useState<(string | number)[]>([]);
<SelectMaterial
  multiple
  label="采购类别"
  value={selected}
  onValueChange={setSelected}
  options={[
    { label: '办公用品', value: 'office' },
    { label: '设备采购', value: 'equipment' },
  ]}
/>;
```

固定值切换模式时原子转换：单选 `null / ""` 转为 `[]`，其他值转为 `[value]`；多选转单选取第一项，空数组转 `null`。模式与值共同撤销。已绑定字段须先解绑，再切换并绑定兼容字段；已有动态值不会被自动覆盖。

多选绑定数组字段：`type: "array"`、`itemType: "string" | "number"`、`initial: []`。数组元素必须匹配声明类型且不重复。`required` 拒绝空数组，`minLength / maxLength` 按选中项数校验；可选空值跳过长度规则，与文本规则一致。数组按顺序比较内容以判断是否修改，回到初始值即恢复未修改；写入时复制数组，提交和重置保留类型。

```json
{
  "id": "categories",
  "path": ["categories"],
  "label": "类别",
  "type": "array",
  "itemType": "string",
  "initial": [],
  "rules": [
    { "kind": "required", "message": "请选择类别" },
    { "kind": "maxLength", "value": 3, "message": "最多选择三项" }
  ]
}
```

数组字段表示一个值列表，与 `forms[].arrays` 的动态明细行分开；动态行的子字段也可使用数组值。数据面板支持创建、编辑 JSON 数组默认值及选项数规则，创建并绑定时根据选项推导元素类型。多选独立使用时可混合文本和数字，绑定时须统一为字段元素类型。旧单选定义与 `ui.checkbox` 标识继续兼容，单个布尔控件在界面中称为“勾选框”。

导入 [多选选择器示例](../public/examples/multi-select.json) 可验证文本数组、数字数组、禁用项、选择数量、独立多选与重置。

## 字段与空值

| 使用方式     | 值                    | 清空结果        |
| ------------ | --------------------- | --------------- |
| 绑定文本字段 | 字符串                | `""`            |
| 绑定数字字段 | 数字或 `null`         | `null`          |
| 多选         | 文本或数字数组        | `[]`            |
| 独立受控组件 | 字符串、数字或 `null` | 回调接收 `null` |

`""` 与 `null` 均显示占位提示，不能作为选项实际值。数字 `0` 是有效选择。`clearable` 默认开启，`disabled` 禁止选择和清空；单个禁用选项不能被用户选取。独立组件没有 `onValueChange` 时使用 React 本地状态，Schema 中的 `value` 作为初始值；可直接选择和清空，不修改 Schema。切换编辑/预览保持本地选择，修改定义或重置页面恢复初始值。传入 `onValueChange` 后仍按受控组件工作，值由字段或动作管理。

可视化绑定仍限定到最近表单容器的模型，单选支持文本、数字字段，多选支持声明元素类型的数组字段。所有选项的实际值必须与绑定字段类型一致；混合类型可独立使用，但不提供创建绑定字段入口。标签、默认值、必填规则、禁用条件、错误和事件由表单模型管理，禁止同时声明 `onChange / onValueChange / onBlur`。解除绑定恢复模型初始值，数字空值保留 `null`。

运行契约新增可选的 `field.changeEvent`：省略或 `onChange` 继续使用原生 input/textarea 事件，`onValueChange` 接收控件的值回调。`field.type` 支持一个类型或类型数组；校验上下文 `fieldItemType` 提供绑定数组的元素类型。`validateProps` 接收编辑器中的部分固定属性，以及运行时完整解析属性，不改变 Schema 的 Value 协议。

独立选择器的 Schema 动作表达式读取 `event` 本身，不能使用 `event.target.value`。绑定状态时注意状态的声明类型：清空可能传入 `null`，固定数字类型的页面状态不接受 `null`；需要空值时可使用包含 nullable 属性的对象状态、注册动作，或直接绑定支持空值的表单数字字段。

## 交互与验证

业务触发器高 32px；选项浮层通过 Portal 渲染，限制高度并在内部滚动。清空和删除等图标提示使用 Base UI Tooltip。失焦在焦点离开整个控件（含浮层）时通知表单，展开或在内部转移焦点不会提前显示必填错误。

编辑模式保留选中、拖动本体、复制/删除；不会打开业务浮层。预览模式使用 Base UI 的键盘导航、选择、Escape 关闭和焦点恢复。

可导入 [独立选择器示例](../public/examples/select.json)，包含文本分类、数字优先级、禁用项、必填、提交和重置。示例仅校验本地表单，不调用远程提交接口。

交互测试覆盖值类型、清空、重置、必填、禁用/只读、动态选项与错误恢复、值事件动作、配置事务与撤销、数字字段创建和物料插入。浏览器验证覆盖键盘选择、实际提交类型、重置、模式隔离、拖动本体与滚动外壳。

搜索、远程加载与级联后续接入。
