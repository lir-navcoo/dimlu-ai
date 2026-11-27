import { describe, expect, it, vi } from 'vitest';
import { flatFormApplication as exampleApplication } from './flat-form-fixture';
import { registry } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { FormSubmissionError } from '../packages/runtime/form';
import { compileValue } from '../packages/runtime/expression';
import { validateApplication } from '../packages/schema/validate';
import type { Value } from '../packages/schema/types';

const expression = (source: string): Value => ({
  kind: 'expression',
  language: 'javascript',
  source,
});
const create = () => new PageRuntime(compileApplication(exampleApplication, registry), 'purchase');

describe('form kernel', () => {
  it('pins the validated submission payload while page state changes visibility', async () => {
    const app = structuredClone(exampleApplication);
    app.pages[0].forms![0].fields[0].when = expression("state.result === 'open'");
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase');
    const form = rt.getForm('purchase');
    rt.setState('result', 'open');
    form.setValue('name', '已校验的值');
    let resolve!: () => void;
    const pending = form.submit(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    rt.setState('result', 'closed');
    expect(form.getSnapshot().fields.name.visible).toBe(false);
    expect(
      compileValue({ kind: 'formValues', formId: 'purchase' }).evaluate(rt.context()),
    ).toHaveProperty('name', '已校验的值');
    resolve();
    expect(await pending).toBe(true);
    expect(form.getSubmitValues()).not.toHaveProperty('name');
    rt.dispose();
  });
  it('keeps one isolated source of values, immutable snapshots and explicit dirty/touched state', () => {
    const rt = create(),
      other = create();
    const form = rt.getForm('purchase');
    const before = form.getSnapshot();
    expect(rt.getState()).toEqual({ result: '' });
    expect(before.isValid).toBe(false);
    expect(before.errors).toEqual({});
    form.setValue('name', '显示器');
    form.blur('name');
    expect(form.getSnapshot().fields.name).toMatchObject({
      dirty: true,
      touched: true,
      value: '显示器',
    });
    expect(before.values.name).toBe('');
    expect(other.getForm('purchase').getSnapshot().values.name).toBe('');
    expect(Object.isFrozen(form.getSnapshot().fields.name)).toBe(true);
    expect(
      compileValue({ kind: 'fieldRef', formId: 'purchase', fieldId: 'name' }).evaluate(
        rt.context(),
      ),
    ).toBe('显示器');
    rt.dispose();
    other.dispose();
  });

  it('validates required/range/integer/cross-field rules and permits a cleared number without NaN', () => {
    const rt = create(),
      form = rt.getForm('purchase');
    form.setValue('quantity', null);
    expect(form.validate()).toBe(false);
    expect(form.getSnapshot().errors.quantity).toBe('请填写采购数量');
    form.setValue('quantity', 1.5);
    expect(form.getSnapshot().errors.quantity).toBe('数量必须为整数');
    form.setValue('quantity', 1000);
    expect(form.getSnapshot().errors.quantity).toBe('数量最多为 999');
    form.setValue('name', '设备');
    form.setValue('quantity', 2);
    form.setValue('price', 30000);
    expect(form.getSnapshot().errors.price).toContain('50,000');
    form.setValue('quantity', 1);
    expect(form.getSnapshot().errors.price).toBeUndefined();
    expect(() => form.setValue('price', NaN)).toThrow();
    rt.dispose();
  });

  it('retains hidden values but skips their validation and payload; disabled values still validate', () => {
    const rt = create(),
      form = rt.getForm('purchase');
    form.setValue('price', 6000);
    expect(form.getSnapshot().fields.approvalReason).toMatchObject({
      visible: true,
      disabled: true,
    });
    form.setValue('approvalReason', 'ignored');
    expect(form.getSnapshot().values.approvalReason).toBe('');
    form.validate();
    expect(form.getSnapshot().errors.approvalReason).toBeTruthy();
    form.setValue('name', '设备');
    form.setValue('approvalReason', '团队扩容');
    form.setValue('price', 399);
    expect(form.getSnapshot().fields.approvalReason.visible).toBe(false);
    expect(form.getSnapshot().errors.approvalReason).toBeUndefined();
    expect(form.getSnapshot().values.approvalReason).toBe('团队扩容');
    expect(form.getSubmitValues()).not.toHaveProperty('approvalReason');
    form.setValue('price', 6000);
    expect(form.getSubmitValues().approvalReason).toBe('团队扩容');
    rt.dispose();
  });

  it('reacts to booleans from page state and the same form', () => {
    const app = structuredClone(exampleApplication);
    const page = app.pages[0];
    const definition = page.forms![0];
    page.state.push({ id: 'locked', type: 'boolean', initial: false });
    definition.fields.push({
      id: 'showName',
      path: ['showName'],
      label: '显示名称',
      type: 'boolean',
      initial: false,
    });
    definition.fields[0].when = { kind: 'fieldRef', formId: definition.id, fieldId: 'showName' };
    definition.fields[0].disabled = { kind: 'stateRef', stateId: 'locked' };
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase');
    const form = rt.getForm(definition.id);
    expect(form.getSnapshot().fields.name.visible).toBe(false);
    form.setValue('showName', true);
    expect(form.getSnapshot().fields.name).toMatchObject({ visible: true, disabled: false });
    form.setValue('name', '设备');
    rt.setState('locked', true);
    expect(form.getSnapshot().fields.name).toMatchObject({ visible: true, disabled: true });
    expect(form.getSubmitValues().name).toBe('设备');
    form.setValue('showName', false);
    expect(form.getSubmitValues()).not.toHaveProperty('name');
    expect(form.getSnapshot().values.name).toBe('设备');
    rt.dispose();
  });

  it('supports nested data paths independent of stable field IDs and refreshes rules on page state changes', () => {
    const app = structuredClone(exampleApplication);
    const field = app.pages[0].forms![0].fields[0];
    field.path = ['applicant', 'displayName'];
    field.when = expression("state.result === 'open'");
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase');
    const form = rt.getForm('purchase');
    expect(form.getSnapshot().fields.name.visible).toBe(false);
    rt.setState('result', 'open');
    form.setValue('name', 'Alice');
    expect(form.getSnapshot().values.applicant).toEqual({ displayName: 'Alice' });
    expect(
      compileValue({ kind: 'fieldRef', formId: 'purchase', fieldId: 'name' }).evaluate(
        rt.context(),
      ),
    ).toBe('Alice');
    rt.dispose();
  });

  it('blocks invalid and duplicate submits; server errors preserve input and a corrected retry succeeds', async () => {
    const rt = create(),
      form = rt.getForm('purchase');
    const never = vi.fn();
    expect(await form.submit(never)).toBe(false);
    expect(never).not.toHaveBeenCalled();
    form.setValue('name', '失败');
    let reject!: (error: unknown) => void;
    const service = vi.fn(
      () =>
        new Promise<void>((_resolve, r) => {
          reject = r;
        }),
    );
    const pending = form.submit(service);
    expect(form.getSnapshot().isSubmitting).toBe(true);
    expect(await form.submit(service)).toBe(false);
    form.setValue('name', 'blocked while pending');
    expect(form.getSnapshot().values.name).toBe('失败');
    reject(new FormSubmissionError('拒绝', { name: '名称不可用' }));
    expect(await pending).toBe(false);
    expect(service).toHaveBeenCalledOnce();
    expect(form.getSnapshot()).toMatchObject({
      submitError: '拒绝',
      isSubmitting: false,
      errors: { name: '名称不可用' },
    });
    expect(form.getSnapshot().values.name).toBe('失败');
    form.setValue('name', '修正');
    expect(
      await form.submit(async (values) => {
        expect(values.name).toBe('修正');
      }),
    ).toBe(true);
    expect(form.getSnapshot()).toMatchObject({
      isSubmitSuccessful: true,
      submitCount: 3,
      errors: {},
    });
    form.reset();
    expect(form.getSnapshot()).toMatchObject({
      isDirty: false,
      isSubmitted: false,
      isSubmitSuccessful: false,
      submitCount: 0,
      errors: {},
    });
    expect(form.getSnapshot().fields.name.touched).toBe(false);
    rt.dispose();
  });

  it.each(['reset', 'dispose'] as const)(
    '%s cancels an abort-ignoring adapter and prevents late state/results',
    async (operation) => {
      let resolve!: (value: string) => void;
      let lateWrite!: () => void;
      let signal!: AbortSignal;
      const app = structuredClone(exampleApplication);
      app.dependencies.actions.slow = '1.0.0';
      const rt = new PageRuntime(
        compileApplication(app, {
          ...registry,
          actions: {
            ...registry.actions,
            slow: {
              version: '1.0.0',
              input: {},
              output: 'string',
              execute: (_input, ctx) => {
                signal = ctx.signal;
                lateWrite = () => ctx.setState('result', 'late side effect');
                return new Promise<string>((r) => {
                  resolve = r;
                });
              },
            },
          },
        }),
        'purchase',
      );
      const form = rt.getForm('purchase');
      form.setValue('name', '设备');
      const submit = form.submit(async (_values, signal) => {
        const ok = await rt.run(
          [{ schema: { id: 'slow', action: 'slow', input: {}, resultTo: 'result' }, input: {} }],
          {},
          undefined,
          'submit',
          undefined,
          { signal, throwOnError: true },
        );
        if (!ok) throw new Error('cancelled');
      });
      if (operation === 'reset') form.reset();
      else rt.dispose();
      expect(signal.aborted).toBe(true);
      expect(await submit).toBe(false);
      expect(rt.getPending()).toBe(0);
      lateWrite();
      resolve('late result');
      await Promise.resolve();
      expect(rt.getState().result).toBe('');
      if (operation === 'reset')
        expect(form.getSnapshot()).toMatchObject({
          submitCount: 0,
          isSubmitting: false,
          values: { name: '', quantity: 2, price: 399 },
        });
      rt.dispose();
    },
  );

  it('fails closed on nonboolean runtime conditions and never calls the submit service', async () => {
    const app = structuredClone(exampleApplication);
    app.pages[0].forms![0].fields[0].when = expression('state.result');
    const rt = new PageRuntime(compileApplication(app, registry), 'purchase');
    const service = vi.fn();
    expect(await rt.getForm('purchase').submit(service)).toBe(false);
    expect(service).not.toHaveBeenCalled();
    expect(rt.getForm('purchase').getSnapshot().errors.name).toContain('配置错误');
    rt.dispose();
  });
});

describe('form schema contracts', () => {
  it('rejects colliding paths, invalid defaults, invalid rules and unknown references', () => {
    const app = structuredClone(exampleApplication),
      fields = app.pages[0].forms![0].fields;
    fields[1].path = ['name', 'child'];
    fields[1].initial = 'bad';
    fields[1].rules = [{ kind: 'pattern', value: '[', message: 'bad' }];
    app.pages[0].children[0].props.title = { kind: 'fieldRef', formId: 'missing', fieldId: 'bad' };
    const codes = validateApplication(app, registry).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'field.path',
        'field.type',
        'rule.type',
        'rule.pattern',
        'form.missing',
        'field.missing',
      ]),
    );
  });
  it('rejects known non-boolean references and invalid scopes in standalone field conditions', () => {
    const app = structuredClone(exampleApplication);
    const field = app.pages[0].forms![0].fields[0];
    const validateCondition = (condition: Value) => {
      field.when = condition;
      return validateApplication(app, registry)
        .filter((issue) => issue.path.endsWith('/fields/0/when'))
        .map((issue) => issue.code);
    };
    expect(validateCondition({ kind: 'stateRef', stateId: 'result' })).toContain('logic.type');
    expect(
      validateCondition({ kind: 'fieldRef', formId: 'purchase', fieldId: 'quantity' }),
    ).toContain('logic.type');
    expect(validateCondition(expression('event.checked'))).toContain('event.scope');
    expect(validateCondition(expression('scope.row.visible'))).toContain('form.rule');
  });

  it('rejects conflicting bindings, incompatible adapters and cross-form rules', () => {
    const app = structuredClone(exampleApplication),
      page = app.pages[0];
    page.forms!.push({
      id: 'other',
      fields: [{ id: 'x', path: ['x'], type: 'string', label: 'X', initial: '' }],
    });
    page.forms![0].fields[0].when = expression("forms.other.values.x === ''");
    const node = page.children[2].children![0];
    node.props.value = { kind: 'literal', value: 'duplicate source' };
    node.field!.fieldId = 'quantity';
    const codes = validateApplication(app, registry).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['field.binding', 'form.rule']));
  });
});
