import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RuntimeDomProvider, type RuntimeDomEnvironment } from '../ui/runtime-dom';

type Attachment =
  | { kind: 'loading' | 'error'; pageKey: string; message?: string }
  | { kind: 'ready'; pageKey: string; environment: RuntimeDomEnvironment; root: HTMLElement };
type Props = {
  pageKey: string;
  width: number;
  height: number;
  children: ReactNode;
  onEnvironmentChange?: (environment: RuntimeDomEnvironment | null) => void;
};

export function CanvasDocumentHost({
  pageKey,
  width,
  height,
  children,
  onEnvironmentChange,
}: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const generation = useRef(0);
  const observer = useRef(onEnvironmentChange);
  const retire = useRef<((message: string) => void) | undefined>(undefined);
  const [attachment, setAttachment] = useState<Attachment>({ kind: 'loading', pageKey });
  const dimensionsValid =
    Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const environment =
    dimensionsValid &&
    attachment.pageKey === pageKey &&
    attachment.kind === 'ready' &&
    attachment.environment.isCurrent()
      ? attachment.environment
      : null;
  useLayoutEffect(() => {
    observer.current = onEnvironmentChange;
    onEnvironmentChange?.(environment);
  }, [environment, onEnvironmentChange]);
  useLayoutEffect(() => {
    const element = frame.current!;
    const token = ++generation.current;
    let active = true;
    let attachedDocument: Document | undefined;
    let attachedContent: HTMLElement | undefined;
    let attachedPortals: HTMLElement | undefined;
    let clearChild = () => {};
    let timer: number | undefined;
    const expected = new URL(
      `${import.meta.env.BASE_URL}canvas-runtime.html`,
      element.ownerDocument.baseURI,
    );
    const matchesURL = (url: URL) =>
      url.origin === expected.origin &&
      url.pathname === expected.pathname &&
      url.search === expected.search;
    const current = () =>
      active && generation.current === token && frame.current === element && element.isConnected;
    const stop = () => {
      active = false;
      window.clearTimeout(timer);
      element.removeEventListener('load', onLoad);
      clearChild();
    };
    const fail = (message: string) => {
      if (!current()) return;
      stop();
      observer.current?.(null);
      setAttachment({ kind: 'error', pageKey, message });
    };
    const inspect = (loaded: boolean) => {
      if (!current()) return;
      try {
        const document = element.contentDocument;
        const view = document?.defaultView;
        if (!document || !view || view !== element.contentWindow || view.document !== document)
          throw new Error('运行文档不可访问');
        const url = new URL(view.location.href);
        if (!loaded && (url.href === 'about:blank' || document.readyState !== 'complete')) return;
        if (expected.origin !== element.ownerDocument.location.origin || !matchesURL(url))
          throw new Error('运行文档地址不匹配');
        const root = document.getElementById('canvas-content');
        const portalRoot = document.getElementById('canvas-portals');
        if (
          attachedDocument &&
          (attachedDocument !== document ||
            attachedContent !== root ||
            attachedPortals !== portalRoot)
        )
          throw new Error('运行文档身份已变化，请重新打开页面');
        if (
          document.readyState !== 'complete' ||
          document.documentElement.dataset.dimluRuntimeEntry !== 'ready' ||
          view
            .getComputedStyle(document.documentElement)
            .getPropertyValue('--dimlu-runtime-baseline')
            .trim() !== 'ready' ||
          !root ||
          !portalRoot ||
          !root.isConnected ||
          !portalRoot.isConnected ||
          root.ownerDocument !== document ||
          portalRoot.ownerDocument !== document
        )
          throw new Error('运行文档或基础样式未就绪');
        const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]');
        for (const link of links) {
          if (new URL(link.href).origin !== expected.origin || link.disabled || !link.sheet)
            throw new Error('运行文档样式加载失败');
          void link.sheet.cssRules;
        }
        if (!document.styleSheets.length) throw new Error('运行文档缺少样式表');
        for (const sheet of document.styleSheets) void sheet.cssRules;
        if (attachedDocument === document) return;
        attachedDocument = document;
        attachedContent = root;
        attachedPortals = portalRoot;
        window.clearTimeout(timer);
        const onPageHide = () => fail('运行文档已离开，请重新打开页面');
        const onResourceError = (event: Event) => {
          if (
            event.target instanceof view.HTMLLinkElement &&
            event.target.relList.contains('stylesheet')
          )
            fail('运行文档样式加载失败');
        };
        view.addEventListener('pagehide', onPageHide);
        document.addEventListener('error', onResourceError, true);
        clearChild = () => {
          view.removeEventListener('pagehide', onPageHide);
          document.removeEventListener('error', onResourceError, true);
        };
        const runtimeEnvironment: RuntimeDomEnvironment = {
          document,
          portalRoot,
          isCurrent: () => {
            try {
              return (
                current() &&
                element.contentDocument === document &&
                element.contentWindow === view &&
                document.defaultView === view &&
                view.document === document &&
                root.isConnected &&
                portalRoot.isConnected &&
                root.ownerDocument === document &&
                portalRoot.ownerDocument === document &&
                document.getElementById('canvas-content') === root &&
                document.getElementById('canvas-portals') === portalRoot &&
                matchesURL(new URL(view.location.href))
              );
            } catch {
              return false;
            }
          },
        };
        setAttachment({ kind: 'ready', pageKey, environment: runtimeEnvironment, root });
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : '运行文档加载失败');
      }
    };
    function onLoad() {
      inspect(true);
    }
    retire.current = fail;
    setAttachment({ kind: 'loading', pageKey });
    element.addEventListener('load', onLoad);
    timer = window.setTimeout(() => fail('运行文档加载超时'), 10000);
    inspect(false);
    return () => {
      stop();
      if (retire.current === fail) retire.current = undefined;
      observer.current?.(null);
    };
  }, [pageKey]);
  useLayoutEffect(() => {
    if (!dimensionsValid) retire.current?.('画布尺寸无效');
  }, [dimensionsValid, pageKey]);
  const message = !dimensionsValid
    ? '画布尺寸无效'
    : attachment.pageKey === pageKey && attachment.kind === 'error'
      ? attachment.message
      : '正在加载运行文档…';
  const failed =
    !dimensionsValid || (attachment.pageKey === pageKey && attachment.kind === 'error');
  return (
    <div style={{ position: 'relative' }}>
      <iframe
        key={pageKey}
        ref={frame}
        aria-label="画布运行文档"
        src={`${import.meta.env.BASE_URL}canvas-runtime.html`}
        style={{
          border: 0,
          display: 'block',
          width: dimensionsValid ? width : 0,
          height: dimensionsValid ? height : 0,
          visibility: environment ? 'visible' : 'hidden',
        }}
      />
      {!environment && (
        <p
          role={failed ? 'alert' : 'status'}
          style={{ position: 'absolute', top: 0, left: 0, margin: 0, padding: 16 }}
        >
          {message}
        </p>
      )}
      {environment && attachment.kind === 'ready' && (
        <RuntimeDomProvider environment={environment}>
          {createPortal(children, attachment.root)}
        </RuntimeDomProvider>
      )}
    </div>
  );
}
