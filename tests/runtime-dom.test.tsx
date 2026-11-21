import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RuntimeDomProvider,
  isDocumentElement,
  isDocumentInput,
  isDocumentNode,
  runtimePortalContainer,
  type RuntimeDomEnvironment,
  type RuntimeDomValue,
} from '../src/ui/runtime-dom';
import { Button, Select, Tip, TipProvider } from '../src/ui/primitives';
import { SelectMaterial } from '../src/SelectMaterial';
import { DateMaterial } from '../src/materials/temporal';
import { FieldFrame } from '../src/materials/shared';
import { ImageMaterial } from '../src/materials/data';
import { DialogMaterial, DrawerMaterial, MaterialEffects } from '../src/materials/feedback';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { registry } from '../src/materials';
import { formEditorApplication } from './form-editor-fixture';

// This is DOM ownership evidence, not browser frame input/layout or author-JS realm evidence.
const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  cleanup();
  for (const frame of frames.splice(0)) frame.remove();
  vi.restoreAllMocks();
});
function childDocument() {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  frames.push(frame);
  const doc = frame.contentDocument!;
  const mount = doc.createElement('div');
  const portalRoot = doc.createElement('div');
  doc.body.append(mount, portalRoot);
  let current = true;
  const environment: RuntimeDomEnvironment = {
    document: doc,
    portalRoot,
    isCurrent: () => current,
  };
  return {
    doc,
    mount,
    portalRoot,
    environment,
    query: within(doc.body),
    retire: () => {
      current = false;
    },
  };
}
type ChildDocument = ReturnType<typeof childDocument>;
function boundary(child: ChildDocument, environment: RuntimeDomValue, content: ReactNode) {
  return (
    <TipProvider>
      <RuntimeDomProvider environment={environment}>
        {createPortal(content, child.mount)}
      </RuntimeDomProvider>
    </TipProvider>
  );
}
function choose(option: HTMLElement) {
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 });
  fireEvent.click(option);
}
function Shared({ label, changed = () => {} }: { label: string; changed?: (v: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <Select
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        changed(next);
        setValue(next);
      }}
    >
      <option value="a">{label}甲</option>
      <option value="b">{label}乙</option>
    </Select>
  );
}

describe('explicit runtime DOM environment', () => {
  it('resolves three states and exact local roots with current-document realm guards', () => {
    const child = childDocument();
    const env = child.environment;
    expect(runtimePortalContainer(undefined)).toBeUndefined();
    expect(runtimePortalContainer(null)).toBeNull();
    expect(runtimePortalContainer(env)).toBe(child.portalRoot);
    expect(runtimePortalContainer(env, child.mount)).toBe(child.mount);
    expect(runtimePortalContainer(env, null)).toBeNull();
    expect(runtimePortalContainer(env, document.body)).toBeNull();
    const detached = child.doc.createElement('div');
    expect(runtimePortalContainer(env, detached)).toBeNull();
    expect(runtimePortalContainer({ ...env, portalRoot: detached })).toBeNull();
    expect(runtimePortalContainer({ ...env, portalRoot: document.body })).toBeNull();
    expect(
      runtimePortalContainer({ ...env, document: document.implementation.createHTMLDocument() }),
    ).toBeNull();
    const mismatched = { defaultView: window } as unknown as Document;
    expect(runtimePortalContainer({ ...env, document: mismatched })).toBeNull();
    expect(
      runtimePortalContainer({
        ...env,
        isCurrent: () => {
          throw new Error('retired access');
        },
      }),
    ).toBeNull();
    const throwingDocument = new Proxy(env, {
      get(target, key, receiver) {
        if (key === 'document') throw new Error('navigation access');
        return Reflect.get(target, key, receiver);
      },
    });
    expect(runtimePortalContainer(throwingDocument)).toBeNull();
    const throwingRoot = new Proxy(child.mount, {
      get() {
        throw new Error('root access');
      },
    });
    expect(runtimePortalContainer(env, throwingRoot)).toBeNull();
    const input = child.doc.createElement('input');
    const text = child.doc.createTextNode('child');
    expect(isDocumentNode(text, child.doc)).toBe(true);
    expect(isDocumentElement(child.mount, child.doc)).toBe(true);
    expect(isDocumentInput(input, child.doc)).toBe(true);
    expect(isDocumentElement(text, child.doc)).toBe(false);
    expect(isDocumentInput(child.mount, child.doc)).toBe(false);
    for (const guard of [isDocumentNode, isDocumentElement, isDocumentInput]) {
      expect(guard(document.createElement('input'), child.doc)).toBe(false);
      expect(guard(input, document)).toBe(false);
      expect(guard(input, undefined)).toBe(false);
      expect(guard(null, child.doc)).toBe(false);
      expect(
        guard({ nodeType: 1, ownerDocument: child.doc } as unknown as EventTarget, child.doc),
      ).toBe(false);
    }
    child.retire();
    expect(runtimePortalContainer(env)).toBeNull();
  });

  it('isolates real shared Select and Tip outlets while editor controls retain parent portals', async () => {
    const child = childDocument();
    const changed = vi.fn();
    const view = render(
      <TipProvider>
        <RuntimeDomProvider environment={child.environment}>
          {createPortal(
            <>
              <Shared label="业务" changed={changed} />
              <Tip content="业务帮助">
                <Button>业务提示</Button>
              </Tip>
            </>,
            child.mount,
          )}
        </RuntimeDomProvider>
        <Shared label="编辑器" />
        <Tip content="编辑器帮助">
          <Button>编辑器提示</Button>
        </Tip>
      </TipProvider>,
    );
    const trigger = child.query.getByRole('combobox', { name: '业务' });
    fireEvent.click(trigger);
    const option = await child.query.findByRole('option', { name: '业务乙' });
    expect(child.portalRoot.contains(option)).toBe(true);
    expect(screen.queryByRole('option', { name: '业务乙' })).toBeNull();
    choose(option);
    expect(changed).toHaveBeenCalledExactlyOnceWith('b');
    await waitFor(() => expect(child.query.queryByRole('listbox')).toBeNull());
    const help = child.query.getByRole('button', { name: '业务提示' });
    fireEvent.keyDown(trigger, { key: 'Tab' });
    act(() => help.focus());
    const tip = await child.query.findByRole('tooltip', { name: '业务帮助' });
    expect(child.portalRoot.contains(tip)).toBe(true);
    expect(help.hasAttribute('title')).toBe(false);
    act(() => trigger.focus());
    const editor = screen.getByRole('combobox', { name: '编辑器' });
    fireEvent.click(editor);
    const editorOption = await screen.findByRole('option', { name: '编辑器乙' });
    expect(editorOption.ownerDocument).toBe(document);
    choose(editorOption);
    const editorHelp = screen.getByRole('button', { name: '编辑器提示' });
    fireEvent.keyDown(editor, { key: 'Tab' });
    act(() => editorHelp.focus());
    expect((await screen.findByRole('tooltip', { name: '编辑器帮助' })).ownerDocument).toBe(
      document,
    );
    expect(child.query.queryByText('编辑器帮助')).toBeNull();
    view.unmount();
    expect(child.portalRoot.childElementCount).toBe(0);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('routes the business single and multiple selectors without coercing controlled values or clear callbacks', async () => {
    const child = childDocument();
    const single = vi.fn();
    const multi = vi.fn();
    const options = [
      { value: 0, label: '数字零' },
      { value: '0', label: '文本零' },
    ];
    function Host() {
      const [value, setValue] = useState<string | number | null>(null);
      const [values, setValues] = useState<(string | number)[]>([]);
      return (
        <>
          <SelectMaterial
            label="单选"
            options={options}
            value={value}
            onValueChange={(next) => {
              single(next);
              setValue(next);
            }}
          />
          <SelectMaterial
            multiple
            label="多选"
            options={options}
            value={values}
            onValueChange={(next) => {
              multi(next);
              setValues(next);
            }}
          />
        </>
      );
    }
    render(boundary(child, child.environment, <Host />));
    const singleTrigger = child.query.getByRole('combobox', { name: '单选' });
    for (const [label, value] of [
      ['数字零', 0],
      ['文本零', '0'],
    ] as const) {
      fireEvent.click(singleTrigger);
      const option = await child.query.findByRole('option', { name: label });
      expect(child.portalRoot.contains(option)).toBe(true);
      choose(option);
      expect(single).toHaveBeenLastCalledWith(value);
      await waitFor(() => expect(child.query.queryByRole('listbox')).toBeNull());
    }
    fireEvent.click(child.query.getByRole('button', { name: '清空单选' }));
    expect(single).toHaveBeenLastCalledWith(null);
    const multiTrigger = child.query.getByRole('combobox', { name: '多选' });
    fireEvent.click(multiTrigger);
    choose(await child.query.findByRole('option', { name: '数字零' }));
    choose(child.query.getByRole('option', { name: '文本零' }));
    expect(multi).toHaveBeenLastCalledWith([0, '0']);
    expect(multiTrigger.textContent).toBe('数字零、文本零');
    fireEvent.keyDown(child.query.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(child.query.queryByRole('listbox')).toBeNull());
    fireEvent.click(child.query.getByRole('button', { name: '清空多选' }));
    expect(multi).toHaveBeenLastCalledWith([]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keeps initial date refs, nested months and blur in the owning document and suppresses late blur', async () => {
    const child = childDocument();
    const blur = vi.fn();
    const frameBlur = vi.fn();
    const content = (
      <>
        <FieldFrame label="组合" onBlur={frameBlur}>
          {() => (
            <>
              <input aria-label="组合甲" />
              <input aria-label="组合乙" />
            </>
          )}
        </FieldFrame>
        <DateMaterial label="计划" value="2026-11-08" onBlur={blur} />
        <button>外部操作</button>
      </>
    );
    const view = render(boundary(child, child.environment, content));
    const first = child.query.getByRole('textbox', { name: '组合甲' });
    const second = child.query.getByRole('textbox', { name: '组合乙' });
    fireEvent.blur(first, { relatedTarget: second });
    expect(frameBlur).not.toHaveBeenCalled();
    fireEvent.blur(second, {
      relatedTarget: child.query.getByRole('button', { name: '外部操作' }),
    });
    expect(frameBlur).toHaveBeenCalledOnce();
    const input = child.query.getByRole('textbox', { name: '计划' });
    act(() => input.focus());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const popup = await child.query.findByRole('dialog', { name: '计划选择面板' });
    expect(child.portalRoot.contains(popup)).toBe(true);
    const months = within(popup).getByRole('combobox', { name: '月份' });
    act(() => months.focus());
    fireEvent.click(months);
    const december = await child.query.findByRole('option', { name: '12月' });
    expect(popup.contains(december)).toBe(false);
    expect(child.portalRoot.contains(december)).toBe(true);
    act(() => december.focus());
    expect(blur).not.toHaveBeenCalled();
    choose(december);
    await waitFor(() => expect(child.doc.activeElement).toBe(months));
    expect(within(popup).getByRole('button', { name: '2026-12-08' })).toBeTruthy();
    fireEvent.keyDown(months, { key: 'Escape' });
    await waitFor(() => expect(child.query.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(child.doc.activeElement).toBe(input));
    // Null relatedTarget must examine the child activeElement, not global document.activeElement.
    fireEvent.blur(input, { relatedTarget: null });
    await act(async () => {});
    expect(blur).not.toHaveBeenCalled();
    act(() => child.query.getByRole('button', { name: '外部操作' }).focus());
    await waitFor(() => expect(blur).toHaveBeenCalledOnce());
    act(() => input.focus());
    act(() => {
      input.blur();
      view.rerender(boundary(child, null, content));
    });
    await act(async () => {});
    expect(blur).toHaveBeenCalledOnce();
    view.rerender(boundary(child, child.environment, content));
    act(() => input.focus());
    act(() => {
      input.blur();
      view.unmount();
    });
    await act(async () => {});
    expect(blur).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: '计划选择面板' })).toBeNull();
  });

  it('places image previews in the runtime root and preserves the exact local overlay mount and footer', async () => {
    const child = childDocument();
    render(
      boundary(
        child,
        child.environment,
        <>
          <ImageMaterial src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="示意图" preview />
          <DrawerMaterial
            title="局部详情"
            triggerLabel="打开详情"
            slots={{ footer: () => <span>局部页脚</span> }}
          >
            <p>局部正文</p>
          </DrawerMaterial>
        </>,
      ),
    );
    const local = child.mount.querySelector('.material-overlay-mount');
    expect(local).toBeTruthy();
    fireEvent.click(child.query.getByRole('button', { name: '预览示意图' }));
    const image = await child.query.findByRole('dialog', { name: '示意图' });
    expect(child.portalRoot.contains(image)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(image).getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(child.query.queryByRole('dialog', { name: '示意图' })).toBeNull());
    fireEvent.click(child.query.getByRole('button', { name: '打开详情' }));
    const drawer = await child.query.findByRole('dialog', { name: '局部详情' });
    expect(drawer.closest('.material-overlay-mount')).toBe(local);
    expect(child.portalRoot.contains(drawer)).toBe(false);
    expect(within(drawer).getByText('局部正文').closest('.material-modal-body')).toBeTruthy();
    expect(within(drawer).getByText('局部页脚').closest('footer')).toBeTruthy();
    fireEvent.click(within(drawer).getByRole('button', { name: '关闭局部详情' }));
    await waitFor(() => expect(child.query.queryByRole('dialog', { name: '局部详情' })).toBeNull());
    expect(child.mount.querySelector('.material-overlay-mount')).toBe(local);
  });

  it('moves external MaterialEffects to the explicit environment without recreating its manager or subscription', async () => {
    const first = childDocument();
    const second = childDocument();
    const runtime = new PageRuntime(compileApplication(formEditorApplication, registry), 'page');
    const unsubscribe = vi.fn();
    const original = runtime.subscribeEffects;
    const subscribe = vi.spyOn(runtime, 'subscribeEffects').mockImplementation((listener) => {
      const off = original(listener);
      return () => {
        unsubscribe();
        off();
      };
    });
    const host = (environment: RuntimeDomValue) => (
      <TipProvider>
        <MaterialEffects runtime={runtime} environment={environment} />
      </TipProvider>
    );
    const view = render(host(first.environment));
    const notify = (title: string) =>
      act(() => runtime.emitEffect({ type: 'ui.notify', data: { title, timeout: 0 } }));
    notify('保留通知');
    expect(first.portalRoot.contains(await first.query.findByText('保留通知'))).toBe(true);
    expect(screen.queryByText('保留通知')).toBeNull();
    // Base UI keeps collapsed Toast.Close aria-hidden until the toast receives focus.
    act(() => first.query.getByRole('dialog', { name: '保留通知' }).focus());
    const close = first.query.getByRole('button', { name: '关闭通知' });
    fireEvent.keyDown(close, { key: 'Tab' });
    act(() => close.focus());
    expect(
      first.portalRoot.contains(await first.query.findByRole('tooltip', { name: '关闭通知' })),
    ).toBe(true);
    view.rerender(host(second.environment));
    expect(second.portalRoot.contains(await second.query.findByText('保留通知'))).toBe(true);
    await waitFor(() => expect(first.portalRoot.childElementCount).toBe(0));
    expect(subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).not.toHaveBeenCalled();
    notify('新环境通知');
    expect(await second.query.findAllByText('新环境通知')).toHaveLength(1);
    expect(second.query.getAllByText('保留通知')).toHaveLength(1);
    expect(screen.queryByText('新环境通知')).toBeNull();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
    notify('卸载后通知');
    expect(first.portalRoot.childElementCount).toBe(0);
    expect(second.portalRoot.childElementCount).toBe(0);
    expect(screen.queryByText('卸载后通知')).toBeNull();
    runtime.dispose();
  });

  it('fails closed on provider-only invalidation without unmounting consumers and rejects an initially unavailable date session', async () => {
    const child = childDocument();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Shared label="保树" />
          <DateMaterial label="保树日期" value="2026-11-08" />
          <DialogMaterial
            title="保树弹窗"
            triggerLabel="打开保树弹窗"
            open={open}
            onOpenChange={setOpen}
          >
            <p>保树正文</p>
          </DialogMaterial>
        </>
      );
    }
    const tree = <Host />;
    const view = render(boundary(child, child.environment, tree));
    const select = child.query.getByRole('combobox', { name: '保树' });
    const date = child.query.getByRole('button', { name: '选择保树日期' });
    const dialog = child.query.getByRole('button', { name: '打开保树弹窗' });
    const local = child.mount.querySelector('.material-overlay-mount');
    const preserve = () => {
      expect(child.query.getByRole('combobox', { name: '保树' })).toBe(select);
      expect(child.query.getByRole('button', { name: '选择保树日期' })).toBe(date);
      expect(child.query.getByRole('button', { name: '打开保树弹窗' })).toBe(dialog);
      expect(child.mount.querySelector('.material-overlay-mount')).toBe(local);
    };
    const invalidate = async (environment: RuntimeDomValue) => {
      view.rerender(boundary(child, environment, tree));
      await waitFor(() => {
        expect(child.query.queryByRole('listbox')).toBeNull();
        expect(child.query.queryByRole('dialog')).toBeNull();
        expect(child.portalRoot.querySelector('[role="dialog"], [role="listbox"]')).toBeNull();
        expect(local!.querySelector('[role="dialog"]')).toBeNull();
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByRole('listbox')).toBeNull();
      preserve();
    };
    fireEvent.click(select);
    await child.query.findByRole('option', { name: '保树乙' });
    await invalidate(null);
    view.rerender(boundary(child, child.environment, tree));
    if (!child.query.queryByRole('listbox')) fireEvent.click(select);
    choose(await child.query.findByRole('option', { name: '保树乙' }));
    await waitFor(() => expect(child.query.queryByRole('listbox')).toBeNull());
    expect(select.textContent).toContain('保树乙');
    fireEvent.click(date);
    await child.query.findByRole('dialog', { name: '保树日期选择面板' });
    await invalidate({ ...child.environment, isCurrent: () => false });
    view.rerender(boundary(child, child.environment, tree));
    if (!child.query.queryByRole('dialog')) fireEvent.click(date);
    const datePopup = await child.query.findByRole('dialog', { name: '保树日期选择面板' });
    fireEvent.click(within(datePopup).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(child.query.queryByRole('dialog')).toBeNull());
    fireEvent.click(dialog);
    await child.query.findByRole('dialog', { name: '保树弹窗' });
    await invalidate(null);
    view.rerender(boundary(child, child.environment, tree));
    const localPopup = await child.query.findByRole('dialog', { name: '保树弹窗' });
    expect(localPopup.closest('.material-overlay-mount')).toBe(local);
    fireEvent.click(within(localPopup).getByRole('button', { name: '关闭保树弹窗' }));
    await waitFor(() => expect(child.query.queryByRole('dialog')).toBeNull());
    preserve();
    // A separate newly mounted date starts unavailable; restoring a provider is not an open request.
    const initiallyUnavailable = (
      <DateMaterial key="pending" label="初始不可用" value="2026-11-08" />
    );
    view.rerender(boundary(child, null, initiallyUnavailable));
    const unavailableTrigger = child.query.getByRole('button', { name: '选择初始不可用' });
    fireEvent.click(unavailableTrigger);
    view.rerender(boundary(child, child.environment, initiallyUnavailable));
    expect(child.query.getByRole('button', { name: '选择初始不可用' })).toBe(unavailableTrigger);
    await act(async () => {});
    expect(child.query.queryByRole('dialog')).toBeNull();
    fireEvent.click(unavailableTrigger);
    expect(
      child.portalRoot.contains(
        await child.query.findByRole('dialog', { name: '初始不可用选择面板' }),
      ),
    ).toBe(true);
    view.unmount();
    expect(child.portalRoot.childElementCount).toBe(0);
  });
});
