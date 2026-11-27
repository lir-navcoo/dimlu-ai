import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from '../src/App';
import { seedLegacyProject } from './legacy-project';
import { materials, registry } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer, useField } from '../packages/react-runtime/Renderer';
import { formEditorApplication, nameField } from './form-editor-fixture';
import { changeControl, insertMaterial } from './ui-helpers';

afterEach(cleanup);

function textForm() {
  const app = structuredClone(formEditorApplication);
  const page = app.pages[0];
  page.state = [{ id: 'multiline', type: 'boolean', initial: true }];
  page.forms = [
    { id: 'model', fields: [{ ...structuredClone(nameField), initial: '初始\n内容' }] },
  ];
  const form = page.children[0];
  form.formId = 'model';
  form.children = [form.children![0]];
  const input = form.children[0];
  input.field = { formId: 'model', fieldId: 'name' };
  input.props = {
    multiline: { kind: 'stateRef', stateId: 'multiline' },
    rows: { kind: 'literal', value: 6 },
    hint: { kind: 'literal', value: '请输入完整说明' },
  };
  return app;
}

describe('unified text input', () => {
  it('preserves multiline values across mode changes and shares validation, submission and reset', async () => {
    const runtime = new PageRuntime(compileApplication(textForm(), registry), 'page');
    const view = render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const store = runtime.getForm('model');
    const input = () => screen.getByRole('textbox', { name: '姓名' }) as HTMLTextAreaElement;
    expect(input().tagName).toBe('TEXTAREA');
    expect(input().rows).toBe(6);
    expect(input().value).toBe('初始\n内容');
    const labelId = input().id;
    act(() => runtime.setState('multiline', false));
    expect(input().tagName).toBe('INPUT');
    expect(input().id).toBe(labelId);
    expect(store.getSnapshot().values).toEqual({ applicant: { name: '初始\n内容' } });
    act(() => runtime.setState('multiline', true));
    expect(input().value).toBe('初始\n内容');

    fireEvent.change(input(), { target: { value: '' } });
    fireEvent.blur(input());
    expect(input().getAttribute('aria-invalid')).toBe('true');
    const errorId = input().getAttribute('aria-describedby')!.split(' ').at(-1)!;
    expect(document.getElementById(errorId)?.textContent).toBe('请填写姓名');
    fireEvent.change(input(), { target: { value: '第一行\n第二行' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(store.getSnapshot().submitCount).toBe(0);
    let submitted: unknown;
    await act(async () => {
      await store.handleSubmit(async (values) => {
        submitted = values;
      })({ preventDefault() {} });
    });
    expect(submitted).toEqual({ applicant: { name: '第一行\n第二行' } });
    expect(input().getAttribute('aria-invalid')).toBe('false');
    fireEvent.reset(view.container.querySelector('form')!);
    expect(input().value).toBe('初始\n内容');
    expect(store.getSnapshot().isDirty).toBe(false);
    runtime.dispose();
  });

  it('applies input type, disabled, read-only and length props to the native control', () => {
    const app = structuredClone(formEditorApplication);
    const page = app.pages[0];
    page.forms = [{ id: 'model', fields: [{ ...structuredClone(nameField), initial: '' }] }];
    const form = page.children[0];
    form.formId = 'model';
    const input = form.children![0];
    delete input.field;
    input.props = {
      label: { kind: 'literal', value: '姓名' },
      value: { kind: 'literal', value: '' },
      type: { kind: 'literal', value: 'email' },
      disabled: { kind: 'literal', value: true },
      readOnly: { kind: 'literal', value: false },
      minLength: { kind: 'literal', value: 3 },
      maxLength: { kind: 'literal', value: 12 },
    };
    const runtime = new PageRuntime(compileApplication(app, registry), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const field = screen.getByRole('textbox', { name: '姓名' }) as HTMLInputElement;
    expect(field.type).toBe('email');
    expect(field.disabled).toBe(true);
    expect(field.minLength).toBe(3);
    expect(field.maxLength).toBe(12);
    runtime.dispose();
  });

  it('allows native React textarea code to reuse the same field adapter', () => {
    function NativeText() {
      const field = useField('model', 'name');
      return (
        <label>
          {field.label}
          <textarea {...field.input} />
        </label>
      );
    }
    const runtime = new PageRuntime(compileApplication(textForm(), registry), 'page');
    render(
      <RuntimeRenderer runtime={runtime} materials={{ ...materials, 'ui.input': NativeText }} />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: '姓名' }), {
      target: { value: '原生\n事件' },
    });
    expect(runtime.getForm('model').getSnapshot().values).toEqual({
      applicant: { name: '原生\n事件' },
    });
    runtime.dispose();
  });

  it('authors both modes in one palette entry and retains text and row configuration through undo', () => {
    seedLegacyProject();
    render(<App />);
    insertMaterial('文本输入');
    expect(screen.queryByRole('button', { name: '拖入 多行文本' })).toBeNull();
    expect(screen.queryByLabelText('显示行数')).toBeNull();
    const value = '保留第一行\n保留第二行';
    changeControl(screen.getByRole('textbox', { name: '输入值' }), value);
    changeControl(screen.getByLabelText('输入模式'), 'true');
    expect(screen.getByRole('textbox', { name: '文本输入' }).tagName).toBe('TEXTAREA');
    expect((screen.getByRole('textbox', { name: '文本输入' }) as HTMLTextAreaElement).value).toBe(
      value,
    );
    changeControl(screen.getByLabelText('显示行数'), '6');
    expect((screen.getByRole('textbox', { name: '文本输入' }) as HTMLTextAreaElement).rows).toBe(6);
    changeControl(screen.getByLabelText('输入模式'), 'false');
    expect(screen.getByRole('textbox', { name: '文本输入' }).tagName).toBe('INPUT');
    expect(screen.queryByLabelText('显示行数')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /撤销/ }));
    const restored = screen.getByRole('textbox', { name: '文本输入' }) as HTMLTextAreaElement;
    expect(restored.tagName).toBe('TEXTAREA');
    expect(restored.value).toBe(value);
    expect(restored.rows).toBe(6);
  });
});
