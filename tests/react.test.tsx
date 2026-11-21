import { selectPage } from './ui-helpers';
import { StrictMode, act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { exampleApplication } from '../src/examples';
import { registry, materials } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer, useField, useForm } from '../packages/react-runtime/Renderer';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
afterEach(cleanup);

describe('React adapter', () => {
  it('reports empty repeats to an editor decorator while ordinary rendering stays empty', () => {
    const runtime = new PageRuntime(compileApplication(exampleApplication, registry), 'people');
    const Decorator = ({
      children,
      node,
      inactiveReason,
    }: import('../packages/react-runtime/Renderer').NodeRenderProps) => (
      <div data-node={node.id} data-inactive={inactiveReason}>
        {children}
      </div>
    );
    const view = render(
      <RuntimeRenderer runtime={runtime} materials={materials} nodeDecorator={Decorator} />,
    );
    expect(
      view.container.querySelector('[data-node="people-row"]')?.getAttribute('data-inactive'),
    ).toBe('empty-repeat');
    view.rerender(<RuntimeRenderer runtime={runtime} materials={materials} />);
    expect(view.container.querySelector('[data-inactive]')).toBeNull();
    expect(view.container.querySelector('.material-record')).toBeNull();
    runtime.dispose();
  });
  it('adds three rows, sorts, deletes the middle row, validates, submits and resets without reassigning DOM state', async () => {
    const rt = new PageRuntime(compileApplication(exampleApplication, registry), 'purchase');
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
    const formElement = view.container.querySelector('form')!;
    const groups = () => screen.getAllByRole('group', { name: /采购明细第/ });
    fireEvent.change(screen.getByRole('textbox', { name: '申请名称' }), {
      target: { value: '三行验收' },
    });
    fireEvent.click(screen.getByRole('button', { name: /新增明细/ }));
    fireEvent.click(screen.getByRole('button', { name: /新增明细/ }));
    const [a, b, c] = groups();
    const aInput = within(a).getByRole('textbox', { name: '物品名称' });
    const cInput = within(c).getByRole('textbox', { name: '物品名称' });
    fireEvent.change(within(b).getByRole('textbox', { name: '物品名称' }), {
      target: { value: '键盘' },
    });
    fireEvent.change(within(c).getByRole('spinbutton', { name: '采购数量' }), {
      target: { value: '0' },
    });
    fireEvent.blur(within(c).getByRole('spinbutton', { name: '采购数量' }));
    expect(within(c).getByText('数量至少为 1')).toBeTruthy();
    fireEvent.click(within(c).getByRole('button', { name: '上移' }));
    expect(groups()).toEqual([a, c, b]);
    expect(within(groups()[1]).getByRole('textbox', { name: '物品名称' })).toBe(cInput);
    expect((cInput as HTMLInputElement).name).toBe('items.1.name');
    fireEvent.click(within(groups()[1]).getByRole('button', { name: '删除' }));
    expect(groups()).toEqual([a, b]);
    expect(within(groups()[0]).getByRole('textbox', { name: '物品名称' })).toBe(aInput);
    expect(screen.queryByText('数量至少为 1')).toBeNull();
    fireEvent.change(within(b).getByRole('spinbutton', { name: '采购数量' }), {
      target: { value: '' },
    });
    fireEvent.submit(formElement);
    expect(within(b).getByText('请填写采购数量')).toBeTruthy();
    expect(rt.getPending()).toBe(0);
    fireEvent.change(within(b).getByRole('spinbutton', { name: '采购数量' }), {
      target: { value: '3' },
    });
    expect(screen.getByText('¥ 1995')).toBeTruthy();
    fireEvent.submit(formElement);
    expect((within(a).getByRole('button', { name: '删除' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: /新增明细/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() => expect(screen.getByText(/已提交「三行验收」/)).toBeTruthy());
    expect(rt.getForm('purchase').getSubmitValues().items).toEqual([
      { name: '办公设备', quantity: 2, price: 399 },
      { name: '键盘', quantity: 3, price: 399 },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '重置表单' }));
    expect(groups()).toHaveLength(1);
    expect(within(groups()[0]).getByRole('textbox', { name: '物品名称' })).not.toBe(aInput);
    expect(screen.getByText('¥ 798')).toBeTruthy();
    expect(rt.getForm('purchase').getSnapshot()).toMatchObject({
      isDirty: false,
      submitCount: 0,
      errors: {},
    });
    rt.dispose();
  });

  it('shows accessible validation, conditional fields, server feedback and resets defaults', async () => {
    const rt = new PageRuntime(compileApplication(exampleApplication, registry), 'purchase');
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
    const form = view.container.querySelector('form')!;
    expect(form.noValidate).toBe(true);
    fireEvent.submit(form);
    const name = screen.getByRole('textbox', { name: '申请名称' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    const errorId = name.getAttribute('aria-describedby')!.split(' ').at(-1)!;
    expect(document.getElementById(errorId)?.textContent).toBe('请填写申请名称');
    fireEvent.change(name, { target: { value: '失败申请' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: '预计单价 / 元' }), {
      target: { value: '6000' },
    });
    expect(screen.getByRole('textbox', { name: '审批说明' })).toBeTruthy();
    fireEvent.submit(form);
    expect(screen.getByText('超过 10,000 元，请填写审批说明')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: '审批说明' }), {
      target: { value: '扩容' },
    });
    fireEvent.submit(form);
    expect((name as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /正在提交/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await waitFor(() =>
      expect(screen.getByText('模拟服务拒绝了申请，请修改名称后重试。')).toBeTruthy(),
    );
    expect((name as HTMLInputElement).value).toBe('失败申请');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /重置表单/ }));
    expect((name as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('textbox', { name: '审批说明' })).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getByText('¥ 798')).toBeTruthy();
    rt.dispose();
  });

  it('lets ordinary TSX use shared hooks, native input events and handleSubmit', async () => {
    const save = vi.fn(async (_values: unknown, _signal: AbortSignal) => undefined);
    function NativeForm() {
      const form = useForm('purchase');
      const name = useField('purchase', 'name');
      return (
        <form onSubmit={form.handleSubmit(save)} noValidate>
          <label>
            {name.label}
            <input {...name.input} />
          </label>
          <button type="submit">Native save</button>
          <span>{name.touched ? 'touched' : 'untouched'}</span>
        </form>
      );
    }
    const app = structuredClone(exampleApplication);
    app.dependencies.components['react.form'] = '1.0.0';
    app.pages[0].children = [{ id: 'native', component: 'react.form', props: {} }];
    const rt = new PageRuntime(
      compileApplication(app, {
        ...registry,
        components: { ...registry.components, 'react.form': { version: '1.0.0', props: {} } },
      }),
      'purchase',
    );
    render(<RuntimeRenderer runtime={rt} materials={{ ...materials, 'react.form': NativeForm }} />);
    const input = screen.getByRole('textbox', { name: '申请名称' });
    fireEvent.change(input, { target: { value: '原生 React' } });
    fireEvent.blur(input);
    expect(screen.getByText('touched')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Native save' }));
    await waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(save.mock.calls[0][0]).toEqual({
      name: '原生 React',
      items: [{ name: '办公设备', quantity: 2, price: 399 }],
    });
    rt.dispose();
  });

  it('passes native change events, updates bindings and submits the first form', async () => {
    const rt = new PageRuntime(compileApplication(exampleApplication, registry), 'purchase');
    render(<RuntimeRenderer runtime={rt} materials={materials} />);
    fireEvent.change(screen.getByRole('textbox', { name: '申请名称' }), {
      target: { value: '团队显示器' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: '采购数量' }), {
      target: { value: '3' },
    });
    expect(rt.getForm('purchase').getSnapshot().values.name).toBe('团队显示器');
    expect(screen.getByText('¥ 1197')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /提交申请/ }));
    await waitFor(() => expect(screen.getByText(/已提交「团队显示器」/)).toBeTruthy());
    rt.dispose();
  });
  it('renders no repeated instances for an empty array and retains falsy loop items', () => {
    const app = structuredClone(exampleApplication);
    const page = app.pages[1];
    page.onEnter = [];
    page.children = [
      {
        id: 'row',
        component: 'ui.text',
        props: { value: { kind: 'expression', language: 'javascript', source: 'scope.item' } },
        repeat: {
          items: { kind: 'stateRef', stateId: 'people' },
          item: 'item',
          key: { kind: 'expression', language: 'javascript', source: 'scope.index' },
        },
      },
    ];
    const rt = new PageRuntime(compileApplication(app, registry), 'people');
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
    expect(view.container.textContent).toBe('');
    act(() => rt.setState('people', [0, false, 'value']));
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText('false')).toBeTruthy();
    rt.dispose();
  });
  it('provides named slot scopes and remounts native hook components on a new runtime instance', () => {
    const plan = compileApplication(exampleApplication, registry);
    const rt = new PageRuntime(plan, 'composition');
    const view = render(<RuntimeRenderer runtime={rt} materials={materials} />);
    expect(screen.getByText('联系邮箱：zhiyuan@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /本地计数/ }));
    expect(screen.getByRole('button', { name: /本地计数/ }).textContent).toContain('1');
    const next = new PageRuntime(plan, 'composition');
    view.rerender(<RuntimeRenderer runtime={next} materials={materials} />);
    expect(screen.getByRole('button', { name: /本地计数/ }).textContent).toContain('0');
    rt.dispose();
    next.dispose();
  });
  it('supports React StrictMode page lifecycle, navigation, search and rejecting invalid schema edits', async () => {
    seedLegacyProject();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: '预览模式' }));
    selectPage('people');
    const canvas = within(screen.getByLabelText('页面画布'));
    await waitFor(() => expect(canvas.getByText('陈嘉宁')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('姓名或部门'), { target: { value: '没有这个人' } });
    fireEvent.click(screen.getByRole('button', { name: /搜索成员/ }));
    await waitFor(() => expect(canvas.getByText('没有匹配的成员')).toBeTruthy());
    expect(canvas.queryByText('陈嘉宁')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Schema' }));
    fireEvent.change(screen.getByLabelText('应用定义 · JSON'), {
      target: { value: '{"schemaVersion":"999"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /校验并应用/ }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(canvas.getByText('没有匹配的成员')).toBeTruthy();
  });
});
