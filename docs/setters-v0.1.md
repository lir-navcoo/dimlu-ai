# 可注册 React Setter v0.1

属性设置器是设计元数据，不进入应用 Schema、能力依赖和发布数据。现有 text（含多行）、number、boolean、json、options、select 及绑定/表达式行为保留，固定值控件统一经过 `LiteralSetter` 宿主。

宿主可在 `PropertyMetadata.setter` 使用 `{ kind: 'custom', id: 'acme.color', options: { ... } }`，并向属性面板传入相应 `materialCatalog`。普通 TSX 设置器由 React 层注册，示例：

```tsx
const ColorSetter = ({ id, value, onChange, onReset }: ReactSetterProps) => (
  <>
    <input id={id} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    <button onClick={onReset}>恢复默认值</button>
  </>
);
const setters = createSetterRegistry({ 'acme.color': ColorSetter });
// 同一个 ID 后提供的组件会覆盖原组件；例如 { text: ColorSetter } 替换内置文本设置器。
<SetterRegistryProvider registry={setters}>
  <EditorSessionProvider>
    <PropertyPanel document={document} snapshot={snapshot} materialCatalog={metadata} />
  </EditorSessionProvider>
</SetterRegistryProvider>;
```

`ReactSetterProps` 提供 `id/label`、literal `value`、`onChange`、`error/onError`、`onReset`、`onDiscardDraft`、字段契约、设置器元数据、JSON options 与会话草稿 `draft/onDraftChange/draftKey`。`onChange` 返回是否提交成功；所有值仍通过原 PropertyInput 命令入口校验、撤销与编译，不向设置器暴露文档对象。注册表是不可变快照，可由 Provider 替换，不提供动态包、依赖注入或完整插件生命周期。

`onReset` 先恢复物料 defaultProps；没有默认且属性可选时删除显式值；必填又无默认时拒绝并提示。`onDiscardDraft` 仅丢弃未提交输入，重试渲染错误时不会修改定义。date/time 模式和 select multiple 的关联属性转换仍走既有原子提交路径。

仅固定值模式渲染 Setter；绑定、引用与表达式由原界面负责，未知或异常设置器不会改变绑定。未注册或渲染抛错时局部退回按字段类型选择的内置控件；替换注册组件后可恢复。字段托管属性在设置器挂载前过滤；保留的异步回调也检查当前属性是否已绑定/托管或移除。

所有五种可保留回调（提交、恢复、草稿修改、错误报告、放弃草稿）同时检查固定值宿主生命周期和当前会话模式；即使应用定义仍是固定值，已切到表达式或数据源的未应用草稿也不会被旧 Setter 改写。失效回调静默拒绝，保留定义、历史、选中位置、草稿和已有错误。固定值宿主卸载或注册渲染器替换后，该代回调永久失效，之后切回固定值不会重新激活它。

扩展设置器作为宿主可信 React 代码，不是安全沙箱；宿主自行处理其网络等副作用与事件处理器异常。应用定义仍只存 Json/Value，设置器函数不进入 JSON。

样式面板复用同一宿主，内置普通 TSX `StyleValueSetter` 注册为 `style.value`，`options.property` 表明样式属性。外层 Provider 的同 ID 实现可覆盖该默认设置器；组合面板可使用 `useSetterRegistry()` 继承外层注册表。样式回调经 `setStyle`，恢复删除显式声明并清除草稿，沿用组件属性和默认 CSS；与业务属性恢复物料默认值的语义不同。具体用法见 [节点样式](styles-v0.1.md)。
