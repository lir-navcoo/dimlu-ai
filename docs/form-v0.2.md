# 表单内核 v0.2：动态明细

在 v0.1 字段模型上增加一层对象数组、派生计算与整单规则。应用 Schema 仍为实验版本 0.1.0，本次是可选字段的增量扩展；旧的单字段表单仍可运行。

## 身份与数据路径

字段模板属于表单或数组；数组的 id 与表单根字段 id 不重名。模板字段 id 在数组内唯一。数组 path 是提交数据的对象路径，模板字段 path 是相对于行对象的路径；两者都可嵌套对象。

```json
{
  "id": "purchase",
  "fields": [],
  "arrays": [
    {
      "id": "items",
      "path": ["items"],
      "label": "采购明细",
      "minItems": 1,
      "maxItems": 20,
      "initial": [{ "name": "显示器", "quantity": 2 }],
      "fields": [
        {
          "id": "itemName",
          "path": ["name"],
          "label": "物品名称",
          "type": "string",
          "initial": "",
          "rules": [{ "kind": "required", "message": "请填写物品名称" }]
        },
        { "id": "quantity", "path": ["quantity"], "label": "数量", "type": "number", "initial": 1 }
      ]
    }
  ]
}
```

行默认数据使用普通嵌套业务对象；未提供的字段补齐模板默认值，未知路径或错误类型会报错。模板路径必须互不包含，根字段与数组路径也不能冲突。

运行时为每行生成稳定 rowId，排序只改变 index。字段身份使用 `{ arrayId, rowId, fieldId }`，错误键为 `arrayId/rowId/fieldId`，可用导出的 fieldKey 生成。原生 input 的 name 使用当前路径，例如 items.1.quantity，它不负责保存字段身份。

values.items 和提交载荷只包含业务对象；内部 rowId 不会被加入载荷。业务需要持久化主键时，显式声明自己的字段。数组快照保存 rows，每项包含 id、index、values 和 fields；与 v0.1 一样，所有快照冻结。

## 编辑与校验

append(value) 按模板默认值生成新行，返回 rowId；remove(rowId) 删除指定行；move(rowId, toIndex) 将指定行移动到最终下标。后两者接受稳定身份，避免旧索引操作到其他行。非法目标下标报错；已经移除的 rowId 不会操作其他行。排序保留行及其 React DOM 身份、错误和 touched 状态。

数组支持 minItems/maxItems、when 和 disabled。行数限制属于校验，程序可临时进入超限状态，但无法提交；采购示例在达到上限时禁用新增按钮。隐藏数组保留内部数据、跳过行校验、从提交载荷省略；禁用数组保留校验和载荷，但不能编辑。模板字段沿用独立的 when/disabled 和同步规则。

行规则中的 scope.row 是当前完整行的业务数据，scope.index 是当前位置；根字段规则不提供行上下文。普通表达式仍使用既有 JavaScript 子集。

错误保存在稳定身份上。修改一个字段只清除该字段的服务端错误，保留其他行的反馈；删除行移除其错误；排序和新增不会把已有错误分配给另一行。根字段服务端错误使用原有字段 id，集合错误使用数组 id；FormSubmissionError 的字段键可由 fieldKey 生成。服务端若返回下标错误，适配器应使用提交时捕获的行身份映射。

dirty 包含值变化和行身份顺序变化；添加后删除新增行可以恢复为干净状态，排序后移回原序也可以。删除原始行再创建同值行仍属于结构变化。reset 重建默认行并生成新的 rowId，以清除行组件的局部状态；旧行事件不会命中新行。

## 派生计算与整单规则

汇总等逻辑用普通 TypeScript 纯函数，注册在 registry.computations 中。应用 dependencies.computations 声明精确版本。表单 computed 声明计算结果身份及能力引用：

```ts
// 宿主注册；函数使用标准 TypeScript，不放进 JSON 字符串。
const computations = {
  'purchase.total': {
    version: '1.0.0',
    compute(values) {
      return values.items.reduce((total, row) => total + row.quantity * row.price, 0);
    },
  },
};
```

```json
{
  "computed": [{ "id": "total", "compute": "purchase.total" }],
  "rules": [
    {
      "test": {
        "kind": "expression",
        "language": "javascript",
        "source": "forms.purchase.computed.total <= 50000"
      },
      "message": "单笔采购金额不能超过 50,000 元"
    }
  ]
}
```

计算输入为冻结的完整 values，包括隐藏值。计算不依赖可见性或其他计算，以避免可见性和汇总之间形成循环。函数必须同步返回有限 JSON 数据；修改输入、抛错或返回非法值都会使表单无效并在提交时展示配置错误。宿主负责函数的业务正确性及纯度。

computed 只在刷新时派生，不支持赋值，也不自动进入提交载荷。字段条件、行规则、整单规则和 Schema 组件属性均可读 forms.purchase.computed.total。rules 中的布尔校验作用于整单，反馈在 formErrors；isValid 始终包含计算及整单规则的结果，错误在提交尝试后展示。

采购示例把单价限制为两位小数，以行金额的分为单位汇总，界面和模拟服务使用同一组 TypeScript 金额函数。金额是演示能力，未引入完整的货币类型系统。

## 原生 React

```tsx
function Items() {
  const { fields, append, remove, move, disabled } = useFieldArray('purchase', 'items');
  return (
    <section>
      <button type="button" disabled={disabled} onClick={() => append()}>
        新增
      </button>
      {fields.map((row, index) => (
        <ItemRow
          key={row.id}
          rowId={row.id}
          onRemove={() => remove(row.id)}
          onMoveUp={() => move(row.id, Math.max(0, index - 1))}
        />
      ))}
    </section>
  );
}
function ItemRow({ rowId, onRemove, onMoveUp }) {
  const name = useField('purchase', { arrayId: 'items', rowId, fieldId: 'itemName' });
  return (
    <div>
      <label>
        {name.label}
        <input {...name.input} />
      </label>
      {name.error && <span role="alert">{name.error}</span>}
      <button type="button" disabled={name.disabled} onClick={onMoveUp}>
        上移
      </button>
      <button type="button" disabled={name.disabled} onClick={onRemove}>
        删除
      </button>
    </div>
  );
}
```

Hooks 的字段参数支持原来的根字段字符串，也支持稳定的行字段地址。避免在循环中直接调用 Hook，使用独立的行/单元格组件。示例 react.purchaseItems 通过普通 .map、key、原生 input 与事件实现，Schema 负责引用该物料。v0.2 没有额外引入可视化循环 DSL。

## 提交与边界

v0.1 的校验、锁定、失败保留输入、防重、取消和重置继续适用。提交中锁定 append/remove/move 和所有单元格。载荷固定为校验通过时的快照；重置或销毁取消等待，即使适配器忽略信号，旧结果也不会覆盖当前运行状态。

验收：新增三行 → 填写 → 排序 → 删除中间行 → 校验 → 提交 → 重置。自动化覆盖稳定错误归属、DOM 复用、数字清空、最少/最多行、金额规则、提交锁和重置取消。

当前支持一层对象数组和嵌套对象路径。嵌套数组、异步校验、路径级增量订阅、服务端持久化和可视化设计器仍未实现。更新仍按整个表单重算并通知；复杂大表单需要后续性能验证。
