# 表单内核 v0.1

本页记录单字段阶段的设计。当前动态数组与服务端错误的细化语义见 [v0.2](./form-v0.2.md)。

独立 TypeScript `FormRuntime` 持有字段数据，React Hooks 与 Schema 绑定共用同一实例，字段不镜像到 page.state。当前使用一个小而完整的同步校验内核，没有叠加第二套 React Hook Form 状态。

## 定义与绑定

页面可声明 forms。表单 id 在页面内唯一，字段 id 在表单内唯一且稳定；path 是独立的对象数据路径。禁止原型相关保留字、重复路径及前缀冲突；暂不支持数组下标。

```json
{
  "id": "purchase",
  "fields": [
    {
      "id": "applicantName",
      "path": ["applicant", "name"],
      "label": "申请名称",
      "type": "string",
      "initial": "",
      "rules": [{ "kind": "required", "message": "请填写申请名称" }]
    }
  ]
}
```

字段类型为 string、number、boolean。默认值匹配类型，数字也允许 null 表示尚未填写。数字输入清空后保存 null，不保存 NaN、空字符串或自动转换为零。

物料契约通过 `form: true` 声明容器，通过 `field: { type, valueProp }` 声明原生字段适配器；文本/数字使用 value，布尔值使用 checked。节点用 formId 绑定容器，用 `field: { formId, fieldId }` 绑定字段。绑定后的值、标签、required、disabled、error、name、onChange/onValueChange/onCheckedChange/onBlur 由内核管理，禁止重复声明。字段节点不能使用 when/repeat，显示规则写在字段定义中。

读取稳定字段用 `{ "kind": "fieldRef", "formId": "purchase", "fieldId": "applicantName" }`；读取可见字段载荷用 `{ "kind": "formValues", "formId": "purchase" }`。表达式可访问 `forms.purchase.values.applicant.name` 或快照属性，例如 `forms.purchase.isSubmitting`。

## 校验与联动

规则支持 required、min/max、minLength/maxLength、pattern、expression。数值规则只用于数字，长度与正则只用于字符串。空白文本视为空；空值跳过范围/长度/正则规则，由 required 决定是否必填。布尔值 false 为有效值，需要必须勾选时使用表达式。

when、disabled、expression.test 必须返回布尔值。规则可读明确的页面状态、当前表单 values 或 fieldRef；不提供事件、循环/插槽变量、跨表单依赖、元状态或提交载荷。无效运行时条件会产生配置错误并阻止提交。

值或页面状态变化后重新计算联动与同步校验。当前使用表单级订阅和全字段校验，没有路径级增量优化。错误在 blur 或提交尝试后显示；关联错误随编辑更新。隐藏字段保留值及 dirty/touched，跳过业务校验且从载荷中省略；禁用字段仍参与校验和提交。计算结果保持为派生表达式，不重复存储。

## 状态与提交

不可变快照包含 values、fields（value/error/visible/disabled/dirty/touched）、errors、isDirty、isValid、isSubmitting、isSubmitted、isSubmitSuccessful、submitCount、submitError。isValid 反映实际规则结果，不受错误是否展示影响。

handleSubmit 接收原生事件并 preventDefault，执行校验 → 锁定编辑与重复提交 → 业务回调 → 成功或错误反馈。绑定容器使用 noValidate 统一收集错误；未绑定的 HTML 表单保留浏览器校验。submitCount 包含校验失败的尝试，不包含被拦截的重复提交。

回调接收冻结的可见字段载荷与 AbortSignal。提交期间 formValues 固定为校验通过时的载荷，即使页面状态改变了字段显示条件，也不会改变在途提交的数据。抛错保留输入；`FormSubmissionError(message, { fieldId: message })` 映射服务端字段错误。编辑后清除服务端错误并重校验。服务端仍须独立校验业务规则。

reset 恢复默认值，清除错误、dirty/touched、提交状态及计数，并取消提交。销毁页面也取消提交。即使适配器忽略 AbortSignal，等待仍及时结束，旧动作结果及受保护 setState 不会回写。取消不撤销已发生的远端业务操作，事务及幂等由服务端实现。

## 原生 React 扩展

在 RuntimeRenderer 内直接使用 Hooks：

```tsx
import { useForm, useField } from '../packages/react-runtime/Renderer';

function PurchaseForm() {
  const form = useForm('purchase');
  const name = useField('purchase', 'name');
  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(async (values, signal) => {
        const response = await fetch('/api/purchases', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        });
        if (!response.ok) throw new Error('提交失败');
      })}
      onReset={(event) => {
        event.preventDefault();
        form.reset();
      }}
    >
      {name.visible && (
        <label>
          {name.label}
          <input {...name.input} aria-describedby={name.error ? 'name-error' : undefined} />
        </label>
      )}
      {name.error && (
        <small id="name-error" role="alert">
          {name.error}
        </small>
      )}
      <button type="submit" disabled={form.isSubmitting}>
        提交
      </button>
      <button type="reset">重置</button>
    </form>
  );
}
```

input.onChange 接收原生 change 事件，input.onBlur 可直接接入原生 blur 事件。`form.setValue(fieldId, value)` 更新允许编辑的字段，不绕过禁用、隐藏或提交锁。复杂行为继续写 TSX / TypeScript，不放入 Schema 字符串。示例 FormStatus 就是读取共享 Hook 的普通 React 组件。

## 采购验收及边界

- 默认数量 2、单价 399、金额 798；名称必填，数量为 1–999 的整数，单价至少 0.01。
- 金额超过 10,000 显示必填审批说明；名称为空时说明禁用；总金额最多 50,000。
- 名称含“失败”时模拟服务拒绝，保留输入并显示字段错误，修改名称后可重试。
- 提交中锁定输入和提交按钮；重置按钮可取消提交并恢复默认值。
- 检查器展示独立的页面状态和表单快照。

数组/动态字段组、异步字段校验、复杂业务类型、跨表单联动、精细依赖图、编辑器及持久化尚未实现。字段模型不承担数据库实体定义。

选择器等值回调控件可在契约中声明 `field.changeEvent: 'onValueChange'`，类型声明支持类型数组，直接传递实际值。文本/数字空值适配及示例见 [选择器](select.md)。

布尔控件使用 `checked / onCheckedChange`；`required` 允许 false，必须勾选或开启使用新增的 `mustBeTrue` 规则，仅适用于布尔字段。配置及重置边界见 [勾选框与开关](boolean-controls.md)。

数组值字段新增 `type: "array"` 与必需的 `itemType: "string" | "number"`，默认值为不重复的同类型数组。它不同于动态明细行 `forms[].arrays`；`required` 检查非空，`minLength / maxLength` 检查选项数量。单选绑定文本或数字，多选绑定数组。示例和空值语义见 [选择器](select.md)。
