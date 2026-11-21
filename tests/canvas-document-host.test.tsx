import { StrictMode, createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CanvasDocumentHost } from '../src/editor/CanvasDocumentHost';
import { useRuntimeDomEnvironment, type RuntimeDomEnvironment } from '../src/ui/runtime-dom';

const ParentContext = createContext('未提供');
// These private document names follow the platform entry, not a production test API.
const CONTENT_ID = 'canvas-content';
const PORTAL_ID = 'canvas-portals';
const MODULE_MARKER = 'data-dimlu-runtime-entry';
type ReadyVariant =
  'valid' | 'wrong-url' | 'missing-root' | 'missing-module' | 'partial-css' | 'css-rules-error';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function Probe({ label = '原内容' }: { label?: string }) {
  const parent = useContext(ParentContext);
  const environment = useRuntimeDomEnvironment();
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount((value) => value + 1)}>自增 {count}</button>
      <span>
        {label}/{parent}
      </span>
      {environment &&
        createPortal(<span data-testid="环境出口">同一环境出口</span>, environment.portalRoot)}
    </>
  );
}
function host({
  pageKey = 'page-a',
  width = 800,
  height = 600,
  callback,
  label = '原内容',
  context = '父上下文',
}: {
  pageKey?: string;
  width?: number;
  height?: number;
  callback: (environment: RuntimeDomEnvironment | null) => void;
  label?: string;
  context?: string;
}) {
  return (
    <ParentContext.Provider value={context}>
      <CanvasDocumentHost
        pageKey={pageKey}
        width={width}
        height={height}
        onEnvironmentChange={callback}
      >
        <Probe label={label} />
      </CanvasDocumentHost>
    </ParentContext.Provider>
  );
}

// JSDOM does not fetch/evaluate Vite modules or runtime CSS. This fixture uses the
// rendered iframe's actual src document/window and native DOM/events. Only completion,
// module marker and CSSOM sheet readiness are controlled signals, not browser evidence.
// No second renderer, contentWindow replacement, Portal mock, srcdoc or document.write.
function prepare(frame: HTMLIFrameElement, variant: ReadyVariant = 'valid', linked = false) {
  if (variant === 'wrong-url') frame.src = new URL('/not-the-runtime.html', frame.src).href;
  const doc = frame.contentDocument!;
  const win = doc.defaultView!;
  const ChildEvent = win.Event;
  if (!doc.documentElement) doc.appendChild(doc.createElement('html'));
  if (!doc.head) doc.documentElement.appendChild(doc.createElement('head'));
  if (!doc.body) doc.documentElement.appendChild(doc.createElement('body'));
  vi.spyOn(doc, 'readyState', 'get').mockReturnValue('complete');
  const content = doc.createElement('div');
  content.id = CONTENT_ID;
  const portals = doc.createElement('div');
  portals.id = PORTAL_ID;
  doc.body.append(content, portals);
  if (variant === 'missing-root') portals.remove();
  if (variant !== 'missing-module') doc.documentElement.setAttribute(MODULE_MARKER, 'ready');
  const style = doc.createElement('style');
  style.textContent = ':root { --dimlu-runtime-baseline: ready; }';
  doc.head.appendChild(style);
  const links: HTMLLinkElement[] = [];
  if (linked || variant === 'partial-css' || variant === 'css-rules-error') {
    for (let index = 0; index < 2; index++) {
      const link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(`/assets/required-${index}.css`, frame.src).href;
      link.disabled = false;
      doc.head.appendChild(link);
      const sheet =
        variant === 'partial-css' && index === 0
          ? null
          : variant === 'css-rules-error' && index === 0
            ? new Proxy(style.sheet!, {
                get(target, key, receiver) {
                  if (key === 'cssRules') throw new Error('unreadable required sheet');
                  return Reflect.get(target, key, receiver);
                },
              })
            : style.sheet;
      vi.spyOn(link, 'sheet', 'get').mockReturnValue(sheet);
      links.push(link);
    }
  }
  return {
    frame,
    doc,
    win,
    content,
    portals,
    links,
    event: (type: string) => new ChildEvent(type),
    query: within(doc.body),
  };
}
function renderedFrame(container: HTMLElement) {
  const frame = container.querySelector('iframe');
  expect(frame).toBeTruthy();
  return frame!;
}
function load(frame: HTMLIFrameElement) {
  act(() => frame.dispatchEvent(new frame.ownerDocument.defaultView!.Event('load')));
}
function lastReady(spy: ReturnType<typeof vi.fn>) {
  const values = spy.mock.calls
    .map(([value]) => value as RuntimeDomEnvironment | null)
    .filter((value) => value !== null);
  expect(values.length).toBeGreaterThan(0);
  return values.at(-1)!;
}

describe('unused canvas document host', () => {
  it('keeps its real document, environment, child state and parent context through same-page public updates', async () => {
    const first = vi.fn();
    const next = vi.fn();
    const view = render(host({ callback: first }));
    const frame = renderedFrame(view.container);
    expect(frame.getAttribute('aria-label')).toBe('画布运行文档');
    expect(frame.hasAttribute('title')).toBe(false);
    expect(screen.queryByRole('button', { name: '自增 0' })).toBeNull();
    const child = prepare(frame);
    load(frame);
    const counter = await child.query.findByRole('button', { name: '自增 0' });
    const environment = lastReady(first);
    expect(environment.document).toBe(child.doc);
    expect(environment.portalRoot).toBe(child.portals);
    expect(environment.isCurrent()).toBe(true);
    expect(child.portals.contains(child.query.getByTestId('环境出口'))).toBe(true);
    expect(child.query.getByText('原内容/父上下文')).toBeTruthy();
    fireEvent.click(counter);
    expect(counter.textContent).toBe('自增 1');
    first.mockClear();
    view.rerender(
      host({ callback: first, width: 390, height: 400, label: '新内容', context: '新上下文' }),
    );
    expect(renderedFrame(view.container)).toBe(frame);
    expect(frame.contentDocument).toBe(child.doc);
    expect(child.query.getByRole('button', { name: '自增 1' })).toBe(counter);
    expect(child.query.getByText('新内容/新上下文')).toBeTruthy();
    expect(frame.style.width).toBe('390px');
    expect(frame.style.height).toBe('400px');
    expect(first.mock.calls.some(([value]) => value === null)).toBe(false);
    view.rerender(
      host({ callback: next, width: 390, height: 400, label: '新内容', context: '新上下文' }),
    );
    expect(next).toHaveBeenLastCalledWith(environment);
    expect(next.mock.calls.some(([value]) => value === null)).toBe(false);
    expect(frame.contentDocument).toBe(child.doc);
    expect(child.query.getByRole('button', { name: '自增 1' })).toBe(counter);
    child.win.location.hash = '#ordinary-anchor';
    expect(environment.isCurrent()).toBe(true);
    first.mockClear();
    next.mockClear();
    act(() => child.win.dispatchEvent(child.event('pagehide')));
    expect(environment.isCurrent()).toBe(false);
    expect(next).toHaveBeenLastCalledWith(null);
    expect(first).not.toHaveBeenCalled();
    await waitFor(() => expect(child.query.queryByRole('button')).toBeNull());
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('settles an already-completed document through StrictMode setup cleanup setup without a second load event', async () => {
    const observer = vi.fn();
    let prepared: ReturnType<typeof prepare> | undefined;
    const view = render(
      <StrictMode>
        <div
          ref={(node) => {
            const frame = node?.querySelector('iframe');
            if (frame && prepared?.doc !== frame.contentDocument)
              prepared = prepare(frame, 'valid', true);
          }}
        >
          {host({ callback: observer })}
        </div>
      </StrictMode>,
    );
    expect(prepared).toBeDefined();
    const child = prepared!;
    // Deliberately no synthetic load here: completed-document reconciliation must work.
    const counter = await child.query.findByRole('button', { name: '自增 0' });
    const current = lastReady(observer);
    expect(current.document).toBe(child.doc);
    expect(current.isCurrent()).toBe(true);
    for (const [environment] of observer.mock.calls) {
      if (environment && environment !== current) expect(environment.isCurrent()).toBe(false);
    }
    fireEvent.click(counter);
    const settledCalls = observer.mock.calls.length;
    view.rerender(
      <StrictMode>
        <div>{host({ callback: observer, label: '严格模式更新' })}</div>
      </StrictMode>,
    );
    expect(renderedFrame(view.container)).toBe(child.frame);
    expect(child.frame.contentDocument).toBe(child.doc);
    expect(child.query.getByRole('button', { name: '自增 1' })).toBe(counter);
    expect(child.query.getByText('严格模式更新/父上下文')).toBeTruthy();
    expect(observer.mock.calls.slice(settledCalls).some(([value]) => value === null)).toBe(false);
  });

  it('fails closed with a visible error for invalid dimensions, URL, roots, module or a required shared stylesheet', async () => {
    const dimensions = vi.fn();
    const invalid = render(host({ callback: dimensions, width: 0 }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '自增 0' })).toBeNull();
    expect(dimensions.mock.calls.every(([value]) => value === null)).toBe(true);
    invalid.unmount();
    for (const variant of [
      'wrong-url',
      'missing-root',
      'missing-module',
      'partial-css',
      'css-rules-error',
    ] as const) {
      const observer = vi.fn();
      const view = render(host({ callback: observer, pageKey: variant }));
      const frame = renderedFrame(view.container);
      const child = prepare(frame, variant);
      load(frame);
      await screen.findByRole('alert');
      expect(observer.mock.calls.length).toBeGreaterThan(0);
      expect(observer.mock.calls.every(([value]) => value === null)).toBe(true);
      expect(child.query.queryByRole('button')).toBeNull();
      expect(child.portals.childElementCount).toBe(0);
      expect(screen.queryByRole('button', { name: '自增 0' })).toBeNull();
      view.unmount();
    }
  });

  it('retires synchronously on child pagehide and owned resource errors and isolates replacement and unmount from stale events', async () => {
    const observer = vi.fn();
    const view = render(host({ callback: observer }));
    const first = prepare(renderedFrame(view.container), 'valid', true);
    load(first.frame);
    await first.query.findByRole('button', { name: '自增 0' });
    const retired = lastReady(observer);
    observer.mockClear();
    act(() => {
      first.win.dispatchEvent(first.event('pagehide'));
      expect(retired.isCurrent()).toBe(false);
      expect(observer).toHaveBeenLastCalledWith(null);
    });
    await screen.findByRole('alert');
    load(first.frame);
    expect(first.query.queryByRole('button')).toBeNull();
    expect(observer.mock.calls.every(([value]) => value === null)).toBe(true);
    view.rerender(host({ callback: observer, pageKey: 'page-b' }));
    const second = prepare(renderedFrame(view.container), 'valid', true);
    expect(second.frame).not.toBe(first.frame);
    expect(second.doc).not.toBe(first.doc);
    load(second.frame);
    const button = await second.query.findByRole('button', { name: '自增 0' });
    const current = lastReady(observer);
    expect(current).not.toBe(retired);
    expect(current.isCurrent()).toBe(true);
    observer.mockClear();
    load(first.frame);
    act(() => {
      first.win.dispatchEvent(first.event('pagehide'));
      first.links[0].dispatchEvent(first.event('error'));
    });
    expect(observer).not.toHaveBeenCalled();
    expect(current.isCurrent()).toBe(true);
    expect(second.query.getByRole('button', { name: '自增 0' })).toBe(button);
    act(() => second.links[0].dispatchEvent(second.event('error')));
    expect(current.isCurrent()).toBe(false);
    expect(observer).toHaveBeenLastCalledWith(null);
    await screen.findByRole('alert');
    view.rerender(host({ callback: observer, pageKey: 'page-c' }));
    const third = prepare(renderedFrame(view.container));
    load(third.frame);
    await third.query.findByRole('button', { name: '自增 0' });
    const final = lastReady(observer);
    observer.mockClear();
    view.unmount();
    expect(final.isCurrent()).toBe(false);
    expect(observer).toHaveBeenLastCalledWith(null);
    expect(third.portals.childElementCount).toBe(0);
    expect(third.content.childElementCount).toBe(0);
    observer.mockClear();
    load(third.frame);
    act(() => third.win.dispatchEvent(third.event('pagehide')));
    expect(observer).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '自增 0' })).toBeNull();
  });

  it('uses a bounded ten-second pending timeout and cannot revive until a fresh pageKey', () => {
    vi.useFakeTimers();
    const observer = vi.fn();
    const view = render(host({ callback: observer }));
    const frame = renderedFrame(view.container);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: '自增 0' })).toBeNull();
    act(() => vi.advanceTimersByTime(9999));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('alert')).toBeTruthy();
    const late = prepare(frame);
    load(frame);
    expect(late.query.queryByRole('button')).toBeNull();
    expect(observer.mock.calls.every(([value]) => value === null)).toBe(true);
    view.rerender(host({ callback: observer, pageKey: 'fresh-page' }));
    const fresh = prepare(renderedFrame(view.container));
    load(fresh.frame);
    expect(fresh.query.getByRole('button', { name: '自增 0' })).toBeTruthy();
    const current = lastReady(observer);
    expect(current.isCurrent()).toBe(true);
    act(() => vi.advanceTimersByTime(20000));
    expect(current.isCurrent()).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a settled document or root identity replacement instead of attaching another tree in the same lifetime', async () => {
    // Explicit defensive fixture boundary: JSDOM's iframe src assignment replaces the
    // document without the real browser's preceding pagehide. This is not a reproduced
    // normal navigation failure; the host must still reject a changed settled identity.
    for (const changed of ['document', 'content-root', 'portal-root'] as const) {
      const observer = vi.fn();
      const view = render(host({ callback: observer, pageKey: changed }));
      const child = prepare(renderedFrame(view.container));
      load(child.frame);
      const counter = await child.query.findByRole('button', { name: '自增 0' });
      const environment = lastReady(observer);
      observer.mockClear();
      load(child.frame);
      expect(environment.isCurrent()).toBe(true);
      expect(child.query.getByRole('button', { name: '自增 0' })).toBe(counter);
      expect(observer.mock.calls.every(([value]) => value === environment)).toBe(true);
      observer.mockClear();
      if (changed === 'document') {
        child.frame.src = child.frame.src;
        const replacement = prepare(child.frame);
        expect(replacement.doc).not.toBe(child.doc);
      } else {
        const original = changed === 'content-root' ? child.content : child.portals;
        const replacement = child.doc.createElement('div');
        replacement.id = original.id;
        original.replaceWith(replacement);
      }
      load(child.frame);
      expect(environment.isCurrent()).toBe(false);
      expect(observer.mock.calls.at(-1)?.[0] === null).toBe(true);
      expect(observer.mock.calls.every(([value]) => value === null)).toBe(true);
      expect(screen.getByRole('alert')).toBeTruthy();
      const replacementBody = child.frame.contentDocument!.body;
      expect(within(replacementBody).queryByRole('button')).toBeNull();
      expect(replacementBody.querySelector('[data-testid="环境出口"]')).toBeNull();
      load(child.frame);
      expect(observer.mock.calls.every(([value]) => value === null)).toBe(true);
      expect(within(replacementBody).queryByRole('button')).toBeNull();
      expect(screen.queryByRole('button', { name: '自增 0' })).toBeNull();
      view.unmount();
    }
  });
});
