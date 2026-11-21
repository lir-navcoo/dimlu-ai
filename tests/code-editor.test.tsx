import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../src/ui/CodeEditor';
import { TipProvider } from '../src/ui/primitives';

const probe = vi.hoisted(() => ({
  controls: [] as {
    value: string;
    listener?: () => void;
    emit: () => void;
    dispose: ReturnType<typeof vi.fn>;
  }[],
  create: vi.fn(),
  language: vi.fn(),
  disposeModel: vi.fn(),
  disposeListener: vi.fn(),
}));
vi.mock('../src/ui/monaco', () => ({
  monaco: {
    Uri: { parse: (value: string) => value },
    editor: {
      createModel: (value: string) => ({ value, dispose: probe.disposeModel }),
      setModelLanguage: probe.language,
      create: (_host: HTMLElement, { model }: { model: { value: string } }) => {
        probe.create();
        const control = {
          value: model.value,
          getValue() {
            return this.value;
          },
          setValue(value: string) {
            this.value = value;
            this.listener?.();
          },
          getModel: () => model,
          updateOptions: vi.fn(),
          getDomNode: () => null,
          listener: undefined as (() => void) | undefined,
          onDidChangeModelContent(listener: () => void) {
            this.listener = listener;
            return { dispose: probe.disposeListener };
          },
          emit() {
            this.listener?.();
          },
          dispose: vi.fn(),
        };
        probe.controls.push(control);
        return control;
      },
    },
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  probe.controls.length = 0;
});

describe('controlled code editor lifecycle', () => {
  it('syncs external drafts silently, uses the current callback and suppresses disposed callbacks', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('IntersectionObserver', undefined);
    const first = vi.fn(),
      current = vi.fn();
    const view = render(
      <TipProvider>
        <CodeEditor label="代码" language="javascript" value="one" onChange={first} />
      </TipProvider>,
    );
    await waitFor(() => expect(probe.create).toHaveBeenCalledOnce());
    const control = probe.controls[0];
    view.rerender(
      <TipProvider>
        <CodeEditor label="代码" language="css" value="two" onChange={current} />
      </TipProvider>,
    );
    await waitFor(() => expect(control.value).toBe('two'));
    expect(first).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    act(() => {
      control.value = 'three';
      control.emit();
    });
    expect(current).toHaveBeenCalledExactlyOnceWith('three');
    expect(first).not.toHaveBeenCalled();
    await waitFor(() => expect(probe.language).toHaveBeenLastCalledWith(expect.anything(), 'css'));
    view.unmount();
    control.emit();
    expect(current).toHaveBeenCalledOnce();
    expect(control.dispose).toHaveBeenCalledOnce();
    expect(probe.disposeModel).toHaveBeenCalledOnce();
    expect(probe.disposeListener).toHaveBeenCalledOnce();
  });
  it('keeps text editable when workers are unavailable and shares edits with the expanded view', async () => {
    vi.stubGlobal('Worker', undefined);
    const onChange = vi.fn();
    render(
      <TipProvider>
        <CodeEditor label="样式代码" language="css" value="color: red" onChange={onChange} />
      </TipProvider>,
    );
    fireEvent.change(screen.getByLabelText('样式代码'), { target: { value: 'color: blue' } });
    expect(onChange).toHaveBeenLastCalledWith('color: blue');
    fireEvent.click(screen.getByRole('button', { name: '展开样式代码' }));
    const modal = await screen.findByRole('dialog', { name: '样式代码' });
    const input = modal.querySelector('textarea')!;
    fireEvent.change(input, { target: { value: 'color: green' } });
    expect(onChange).toHaveBeenLastCalledWith('color: green');
    expect(probe.create).not.toHaveBeenCalled();
  });
});
