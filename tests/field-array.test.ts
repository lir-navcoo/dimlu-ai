import { describe, expect, it, vi } from 'vitest';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { fieldKey, FormSubmissionError } from '../packages/runtime/form';
import { validateApplication } from '../packages/schema/validate';
import type { FieldTarget, Value } from '../packages/schema/types';
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });
const target = (rowId: string, fieldId = 'quantity'): FieldTarget => ({
  arrayId: 'items',
  rowId,
  fieldId,
});
const create = () => new PageRuntime(compileApplication(exampleApplication, registry), 'purchase');

describe('field array identities and validation', () => {
  it('validates maximum row counts and omits a hidden collection without losing its state', () => {
    const app = structuredClone(exampleApplication),
      array = app.pages[0].forms![0].arrays![0];
    array.maxItems = 2;
    array.when = expr("state.result !== 'hidden'");
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase'),
      form = rt.getForm('purchase');
    form.append('items', { name: '键盘' });
    form.append('items', { name: '鼠标' });
    expect(form.getSnapshot().arrays.items.error).toBe('采购明细最多允许 2 行');
    expect(form.getSnapshot().isValid).toBe(false);
    rt.setState('result', 'hidden');
    expect(form.getSnapshot().arrays.items.error).toBeUndefined();
    expect(form.getSubmitValues()).not.toHaveProperty('items');
    expect(form.append('items')).toBeUndefined();
    rt.setState('result', '');
    expect(form.getSnapshot().arrays.items.rows).toHaveLength(3);
    expect(form.getSnapshot().arrays.items.error).toBeTruthy();
    rt.dispose();
  });

  it('treats inherited object property names as ordinary own data paths', () => {
    const app = structuredClone(exampleApplication),
      formDefinition = app.pages[0].forms![0];
    formDefinition.arrays![0].path = ['toString', 'lines'];
    formDefinition.fields[0].id = 'hasOwnProperty';
    app.pages[0].children = [];
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase'),
      form = rt.getForm('purchase');
    form.setValue('hasOwnProperty', '设备');
    expect(form.validate()).toBe(true);
    expect(form.getSubmitValues().toString).toEqual({
      lines: [{ name: '办公设备', quantity: 2, price: 399 }],
    });
    expect(Object.hasOwn(Object.prototype.toString, 'lines')).toBe(false);
    rt.dispose();
  });
  it('moves values, errors and touched with stable identities; deleting the middle row leaves others intact', () => {
    const rt = create(),
      form = rt.getForm('purchase');
    const a = form.getSnapshot().arrays.items.rows[0].id;
    const b = form.append('items', { name: '键盘', quantity: 3, price: 99 })!;
    const c = form.append('items', { name: '显示器', quantity: 0, price: 1999 })!;
    form.blur(target(c));
    const before = form.getSnapshot();
    expect(before.errors[fieldKey(target(c))]).toBe('数量至少为 1');
    form.move('items', c, 0);
    expect(form.getSnapshot().arrays.items.rows.map((r) => r.id)).toEqual([c, a, b]);
    expect(form.getFieldState(target(c))).toMatchObject({
      value: 0,
      touched: true,
      error: '数量至少为 1',
    });
    expect(form.getFieldName(target(c))).toBe('items.0.quantity');
    form.remove('items', a);
    expect(form.getSnapshot().arrays.items.rows.map((r) => r.id)).toEqual([c, b]);
    expect(form.getFieldName(target(b))).toBe('items.1.quantity');
    form.setValue(target(c), 2);
    expect(form.getSnapshot().errors[fieldKey(target(c))]).toBeUndefined();
    expect(form.getSubmitValues().items).toEqual([
      { name: '显示器', quantity: 2, price: 1999 },
      { name: '键盘', quantity: 3, price: 99 },
    ]);
    expect(before.arrays.items.rows.map((r) => r.id)).toEqual([a, b, c]);
    expect(Object.isFrozen(form.getSnapshot().arrays.items.rows[0].fields)).toBe(true);
    rt.dispose();
  });

  it('preserves server field errors across row moves, appends, sibling edits and removals', async () => {
    const rt = create(),
      form = rt.getForm('purchase');
    form.setValue('name', '服务校验');
    const a = form.getSnapshot().arrays.items.rows[0].id;
    const b = form.append('items', { name: '键盘' })!;
    const key = fieldKey(target(b, 'itemName'));
    await form.submit(async () => {
      throw new FormSubmissionError('物品已停用', { [key]: '请选择其他物品' });
    });
    form.move('items', b, 0);
    form.append('items', { name: '鼠标' });
    form.setValue(target(a), 5);
    form.remove('items', a);
    expect(form.getFieldState(target(b, 'itemName'))?.error).toBe('请选择其他物品');
    expect(form.getSnapshot().errors[key]).toBe('请选择其他物品');
    form.setValue(target(b, 'itemName'), '新键盘');
    expect(form.getSnapshot().errors[key]).toBeUndefined();
    expect(await form.submit(async () => undefined)).toBe(true);
    rt.dispose();
  });

  it('checks collection bounds, each row, blank numbers and the derived order budget', async () => {
    const rt = create(),
      form = rt.getForm('purchase');
    form.setValue('name', '设备');
    form.remove('items', form.getSnapshot().arrays.items.rows[0].id);
    const save = vi.fn();
    expect(await form.submit(save)).toBe(false);
    expect(form.getSnapshot().arrays.items.error).toBe('采购明细至少需要 1 行');
    const row = form.append('items')!;
    expect(form.getFieldState(target(row, 'itemName'))?.error).toBe('请填写物品名称');
    form.setValue(target(row, 'itemName'), '工作站');
    form.setValue(target(row), null);
    expect(form.getFieldState(target(row))?.error).toBe('请填写采购数量');
    form.setValue(target(row), 1.5);
    expect(form.getFieldState(target(row))?.error).toBe('数量必须为整数');
    form.setValue(target(row), 2);
    form.setValue(target(row, 'price'), 30000);
    expect(form.getSnapshot().computed.total).toBe(60000);
    expect(form.getSnapshot().formErrors).toContain('单笔采购金额不能超过 50,000 元');
    expect(form.getSnapshot().fields.approvalReason.visible).toBe(true);
    form.setValue('approvalReason', '高性能设备');
    form.setValue(target(row, 'price'), 9999.99);
    expect(form.getSnapshot().computed.total).toBe(19999.98);
    expect(form.getSnapshot().formErrors).toEqual([]);
    form.setValue(target(row, 'price'), 0.001);
    expect(form.getFieldState(target(row, 'price'))?.error).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    rt.dispose();
  });

  it('keeps decimal totals consistent and derives values without adding them or row keys to payloads', () => {
    const rt = create(),
      form = rt.getForm('purchase');
    const row = form.getSnapshot().arrays.items.rows[0].id;
    form.setValue(target(row), 3);
    form.setValue(target(row, 'price'), 0.1);
    form.append('items', { name: '配件', quantity: 1, price: 0.2 });
    expect(form.getSnapshot().computed.total).toBe(0.5);
    expect(form.getSubmitValues()).toEqual({
      name: '',
      items: [
        { name: '办公设备', quantity: 3, price: 0.1 },
        { name: '配件', quantity: 1, price: 0.2 },
      ],
    });
    expect(() => form.append('items', { price: NaN })).toThrow();
    expect(() => form.append('items', { unknown: true })).toThrow();
    expect(() => form.append('items', { quantity: '2' })).toThrow();
    rt.dispose();
  });

  it('restores defaults and fresh row identities on reset, rejecting stale row callbacks', () => {
    const rt = create(),
      form = rt.getForm('purchase');
    const original = form.getSnapshot().arrays.items.rows[0].id;
    const appended = form.append('items', { name: '键盘' })!;
    form.remove('items', appended);
    expect(form.getSnapshot().isDirty).toBe(false);
    form.setValue(target(original), 5);
    form.blur(target(original));
    form.reset();
    const row = form.getSnapshot().arrays.items.rows[0];
    expect(row.id).not.toBe(original);
    form.setValue(target(original), 900);
    expect(form.getSnapshot()).toMatchObject({
      isDirty: false,
      submitCount: 0,
      errors: {},
      computed: { total: 798 },
    });
    expect(row.fields.quantity).toMatchObject({ value: 2, touched: false, dirty: false });
    rt.dispose();
  });

  it('locks every array operation during submit; reset cancels and isolates the old payload', async () => {
    const rt = create(),
      form = rt.getForm('purchase');
    form.setValue('name', '设备');
    const a = form.getSnapshot().arrays.items.rows[0].id,
      b = form.append('items', { name: '键盘' })!;
    let complete!: () => void;
    let payload: unknown;
    const pending = form.submit((values) => {
      payload = values;
      return new Promise<void>((r) => {
        complete = r;
      });
    });
    expect(form.append('items')).toBeUndefined();
    form.move('items', b, 0);
    form.remove('items', a);
    form.setValue(target(a), 100);
    expect(form.getSnapshot().arrays.items.rows.map((r) => r.id)).toEqual([a, b]);
    form.reset();
    expect(await pending).toBe(false);
    complete();
    await Promise.resolve();
    expect(payload).toEqual({
      name: '设备',
      items: [
        { name: '办公设备', quantity: 2, price: 399 },
        { name: '键盘', quantity: 1, price: 399 },
      ],
    });
    expect(form.getSnapshot().arrays.items.rows).toHaveLength(1);
    expect(form.getSnapshot().isSubmitSuccessful).toBe(false);
    rt.dispose();
  });

  it('supports nested paths, row-scoped visibility, hidden omission and array disabling', () => {
    const app = structuredClone(exampleApplication),
      array = app.pages[0].forms![0].arrays![0];
    array.path = ['order', 'lines'];
    array.fields[0].path = ['product', 'name'];
    array.initial = [{ product: { name: '键盘' }, quantity: 2, price: 399 }];
    array.fields[0].when = expr('scope.row.quantity > 1');
    array.disabled = expr("state.result === 'locked'");
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase'),
      form = rt.getForm('purchase');
    const row = form.getSnapshot().arrays.items.rows[0].id;
    expect(form.getFieldName(target(row, 'itemName'))).toBe('order.lines.0.product.name');
    form.setValue(target(row), 1);
    expect(form.getSubmitValues().order).toEqual({ lines: [{ quantity: 1, price: 399 }] });
    rt.setState('result', 'locked');
    expect(form.append('items')).toBeUndefined();
    rt.setState('result', '');
    form.setValue(target(row), 2);
    expect(form.getFieldState(target(row, 'itemName'))?.value).toBe('键盘');
    rt.dispose();
  });

  it('fails closed when a registered computation mutates input or returns invalid output', async () => {
    for (const compute of [
      () => NaN,
      (values: Readonly<Record<string, unknown>>) => {
        (values.items as unknown[]).push({});
        return 0;
      },
    ]) {
      const rt = new PageRuntime(
        compileApplication(exampleApplication, {
          ...registry,
          computations: { 'purchase.total': { version: '1.0.0', compute } },
        }),
        'purchase',
      );
      const form = rt.getForm('purchase'),
        service = vi.fn();
      form.setValue('name', '设备');
      expect(await form.submit(service)).toBe(false);
      expect(service).not.toHaveBeenCalled();
      expect(form.getSnapshot().formErrors.join()).toContain('配置错误');
      expect(form.getSnapshot().arrays.items.rows).toHaveLength(1);
      rt.dispose();
    }
  });
});

describe('array schema contracts', () => {
  it('rejects collisions, invalid bounds, unknown row data, wrong template defaults and missing computations', () => {
    const app = structuredClone(exampleApplication),
      form = app.pages[0].forms![0],
      array = form.arrays![0];
    array.path = ['name', 'child'];
    array.minItems = 5;
    array.maxItems = 2;
    array.fields[1].initial = 'bad';
    array.fields[2].id = array.fields[1].id;
    array.initial = [{ typo: 2 }];
    form.computed![0].compute = 'missing';
    const codes = validateApplication(app, registry).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'field.path',
        'field.id',
        'field.type',
        'array.range',
        'array.initial',
        'computed.missing',
        'dependency.undeclared',
      ]),
    );
  });
  it('checks exact computation versions and row payload types before creating a runtime', () => {
    const app = structuredClone(exampleApplication);
    app.dependencies.computations!['purchase.total'] = '2.0.0';
    app.pages[0].forms![0].arrays![0].initial = [{ name: '键盘', quantity: '2' }];
    expect(validateApplication(app, registry).map((i) => i.code)).toEqual(
      expect.arrayContaining(['dependency.version', 'array.initial']),
    );
  });
});
