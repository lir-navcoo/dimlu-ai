# 统一文本输入

物料面板保留一个“文本输入”（`ui.input`）。`multiline` 缺省为 `false`，使用原生单行输入；设置为 `true` 时，由 Base UI Input 的 `render` 渲染原生 `textarea`。

```json
{
  "id": "description",
  "component": "ui.input",
  "props": {
    "multiline": { "kind": "literal", "value": true },
    "rows": { "kind": "literal", "value": 4 },
    "placeholder": { "kind": "literal", "value": "填写说明" }
  },
  "field": { "formId": "model", "fieldId": "description" }
}
```

`model.description` 必须在当前页面的表单模型中存在且为字符串字段。绑定后，值、标签、必填、禁用、错误和变更/失焦事件由该字段管理；不重复声明组件的 `value` 和 `label`。

右侧“输入模式”提供单行/多行。旧 Schema 未配置模式时显示“未设置”，先将绑定方式改为固定值即可设置模式。新插入组件显式默认单行。显示行数仅在多行时出现；模式为表达式/引用时保留行数配置入口，不按瞬时运行结果隐藏。

行数默认 4，面板提供 2、3、4、6、8、10 行。导入或表达式中的有限数字向下取整并限制为 1–20 行，非有限数使用 4 行；运行时仍先执行属性类型校验。支持原生纵向调整高度，不实现内容自动增高。

两种模式共用字符串值、原生 React `onChange` / `onBlur`、字段校验、提交和重置。多行 Enter 输入换行。`useField(...).input` 可以直接传给原生 React `input` 或 `textarea`。

模式切换不会修改 Schema 中保存的文本、字段定义或字段绑定。动态模式切换也不会自行修改表单模型中的换行；原生单行输入显示时会移除可见换行，随后用户编辑将写入新的单行值。工作台修改任何有效 Schema 属性仍按统一规则重建预览实例，未提交的预览输入不会跨定义修改保留。

运行时表单模型属于页面，字段通过 `formId + fieldId` 显式引用；原生 Enter 提交和 reset 按钮则依赖 HTML 表单关联。编辑器现在默认只提供最近表单容器模型的字段，已绑定组件跨模型移动时提示先解除绑定。已有显式定义仍可运行，详细规则见 [字段绑定作用域](form-binding-scope.md)。

验证覆盖：单行/多行渲染、行数、动态模式切换、换行值保留、失焦校验、提交载荷、表单重置、原生 TSX 适配、编辑器切换与撤销。浏览器实测 6 行高度、Enter 换行且不触发提交、重置及固定全高外壳。
