import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../src/ui/CodeEditor';
import { TipProvider } from '../src/ui/primitives';

const probe = vi.hoisted(() => ({
  controls: [] as {
    value: string;
    listener?: () => void;
    emit: () => void;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    updateOptions: ReturnType<typeof vi.fn>;
  }[],
  create: vi.fn(),
  createError: undefined as Error | undefined,
  createdHost: undefined as HTMLElement | undefined,
  language: vi.fn(),
  disposeModel: vi.fn(),
  disposeListener: vi.fn(),
  layout: vi.fn(),
  layoutError: undefined as Error | undefined,
  resizeCallback: undefined as ResizeObserverCallback | undefined,
  observerDisconnected: false,
  rect: { width: 320, height: 144 },
}));
vi.mock('../src/ui/monaco', () => ({
  monaco: {
    Uri: { parse: (value: string) => value },
    editor: {
      createModel: (value: string) => ({ value, dispose: probe.disposeModel }),
      setModelLanguage: probe.language,
      create: (host: HTMLElement, options: { model: { value: string }; placeholder?: string }) => {
        const { model } = options;
        if (probe.createError) throw probe.createError;
        probe.createdHost = host;
        probe.create(options);
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
          layout: () => {
            probe.layout();
            if (probe.layoutError) throw probe.layoutError;
          },
          focus: vi.fn(),
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
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
    const { width, height } = probe.rect;
    return {
      x: 0,
      y: 0,
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON() {},
    } as DOMRect;
  });
});
afterEach(() => {
  cleanup();
  probe.rect = { width: 320, height: 144 };
  probe.createError = undefined;
  probe.layoutError = undefined;
  probe.resizeCallback = undefined;
  probe.observerDisconnected = false;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  probe.controls.length = 0;
  probe.createdHost = undefined;
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
  it('keeps a multiline placeholder separate from the source before and after Monaco loads', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('IntersectionObserver', undefined);
    const onChange = vi.fn();
    const example = ':root {\n  background-color: #f8fafc;\n}';
    const editor = (placeholder?: string) => (
      <CodeEditor
        label="页面 CSS"
        language="css"
        value=""
        onChange={onChange}
        placeholder={placeholder}
        expandable={false}
      />
    );
    const view = render(editor(example));
    const fallback = screen.getByRole<HTMLTextAreaElement>('textbox', { name: '页面 CSS' });
    expect(fallback.placeholder).toBe(example);
    expect(fallback.value).toBe('');

    await waitFor(() => expect(probe.create).toHaveBeenCalledOnce());
    expect(probe.create).toHaveBeenCalledWith(
      expect.objectContaining({ model: expect.objectContaining({ value: '' }), placeholder: example }),
    );
    const control = probe.controls[0];
    view.rerender(editor('/* another example */'));
    expect(control.updateOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ placeholder: '/* another example */' }),
    );
    view.rerender(editor());
    expect(control.updateOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ placeholder: undefined }),
    );
    expect(control.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('waits for a positive host size before creating Monaco', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          probe.resizeCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    probe.rect = { width: 0, height: 0 };
    render(
      <TipProvider>
        <CodeEditor label="代码" language="javascript" value="one" onChange={vi.fn()} />
      </TipProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(probe.create).not.toHaveBeenCalled();
    expect(probe.createdHost).toBeUndefined();
    act(() => {
      probe.rect = { width: 320, height: 144 };
      probe.resizeCallback?.([], {} as ResizeObserver);
    });
    await waitFor(() => expect(probe.create).toHaveBeenCalledOnce());
    expect(probe.createdHost?.hasAttribute('hidden')).toBe(false);
    await waitFor(() => expect(probe.layout).toHaveBeenCalledOnce());
  });
  it.each(['constructor', 'observe'] as const)(
    'keeps plain text editable when ResizeObserver %s throws',
    async (stage) => {
      vi.stubGlobal('Worker', class {});
      vi.stubGlobal('IntersectionObserver', undefined);
      const disconnect = vi.fn();
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor() {
            if (stage === 'constructor') throw new Error('observer setup failed');
          }
          observe() {
            throw new Error('observer setup failed');
          }
          disconnect = disconnect;
        },
      );
      const onChange = vi.fn();
      render(
        <CodeEditor
          label="代码"
          language="javascript"
          value="one"
          onChange={onChange}
          expandable={false}
        />,
      );
      expect((await screen.findByRole('status')).textContent).toContain('observer setup failed');
      fireEvent.change(screen.getByLabelText('代码'), { target: { value: 'two' } });
      expect(onChange).toHaveBeenCalledWith('two');
      expect(probe.create).not.toHaveBeenCalled();
      expect(disconnect).toHaveBeenCalledTimes(stage === 'observe' ? 1 : 0);
    },
  );
  it('falls back when Monaco creation throws during resize observation', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          probe.resizeCallback = callback;
        }
        observe() {}
        disconnect() {
          probe.observerDisconnected = true;
        }
      },
    );
    probe.rect = { width: 0, height: 0 };
    render(
      <TipProvider>
        <CodeEditor label="代码" language="javascript" value="one" onChange={vi.fn()} />
      </TipProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    probe.createError = new Error('create failed');
    act(() => {
      probe.rect = { width: 320, height: 144 };
      probe.resizeCallback?.([], {} as ResizeObserver);
    });
    expect((await screen.findByRole('status')).textContent).toContain('create failed');
    expect(screen.getByLabelText('代码').getBoundingClientRect().width).toBeGreaterThan(0);
    expect(probe.observerDisconnected).toBe(true);
  });
  it('falls back when the first visible layout throws', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('IntersectionObserver', undefined);
    probe.layoutError = new Error('layout failed');
    render(
      <TipProvider>
        <CodeEditor label="代码" language="javascript" value="one" onChange={vi.fn()} />
      </TipProvider>,
    );
    expect((await screen.findByRole('status')).textContent).toContain('layout failed');
    expect(screen.getByLabelText('代码').getBoundingClientRect().width).toBeGreaterThan(0);
    expect(probe.controls[0].dispose).toHaveBeenCalledOnce();
    expect(probe.disposeModel).toHaveBeenCalledOnce();
  });
  it('does not steal focus after fallback blurs while Monaco loads', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          probe.resizeCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    const view = render(
      <TipProvider>
        <CodeEditor label="代码" language="javascript" value="one" onChange={vi.fn()} />
      </TipProvider>,
    );
    const fallback = screen.getByLabelText('代码');
    fireEvent.focus(fallback);
    fireEvent.blur(fallback);
    await waitFor(() => expect(probe.create).toHaveBeenCalledOnce());
    expect(probe.controls[0].focus).not.toHaveBeenCalled();
    view.unmount();
  });
  it('preloads before visibility, loads on focus and relayouts after resize', async () => {
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          probe.resizeCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    let options: IntersectionObserverInit | undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(_callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
          options = init;
        }
        observe() {}
        disconnect() {}
      },
    );
    render(
      <TipProvider>
        <CodeEditor label="代码" language="javascript" value="one" onChange={vi.fn()} />
      </TipProvider>,
    );
    expect(options?.rootMargin).toBe('300px 0px');
    fireEvent.focus(screen.getByLabelText('代码'));
    await waitFor(() => expect(probe.create).toHaveBeenCalledOnce());
    expect(probe.layout).toHaveBeenCalledOnce();
    await waitFor(() => expect(probe.controls[0].focus).toHaveBeenCalledOnce());
    act(() => probe.resizeCallback?.([], {} as ResizeObserver));
    expect(probe.layout).toHaveBeenCalledTimes(2);
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
