import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Toast } from '@base-ui/react/toast';
import { AlertCircle, CheckCircle2, Info, X, PanelsTopLeft, PanelRightOpen } from 'lucide-react';
import {
  useDesignMode,
  useMaterialPresentation,
  useMaterialNode,
  useHasSlot,
  materialStyleTarget,
  type SlotRenderers,
} from '../../packages/react-runtime/Renderer';
import type { PageRuntime } from '../../packages/runtime/engine';
import type { Registry } from '../../packages/runtime/registry';
import { Button, Tip } from '../ui/primitives';
import {
  RuntimeDomProvider,
  runtimePortalContainer,
  useRuntimeDomEnvironment,
  type RuntimeDomEnvironment,
} from '../ui/runtime-dom';
import { isAuthorEscape } from '../editor/author-escape';
import {
  boolProp,
  textProp,
  numberProp,
  requiredText,
  useMaterialValue,
  enumErrors,
  type Contracts,
} from './shared';

type ModalProps = {
  style?: React.CSSProperties;
  title: string;
  description?: string;
  triggerLabel?: string;
  showTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: string;
  cancelLabel?: string;
  showFooter?: boolean;
  width?: number;
  children?: ReactNode;
  slots?: SlotRenderers;
};
function OverlayMaterial({
  title,
  description,
  triggerLabel = '打开',
  showTrigger = true,
  open = false,
  onOpenChange,
  onConfirm,
  confirmLabel = '确定',
  cancelLabel = '取消',
  showFooter = true,
  width = 480,
  children,
  slots = {},
  drawer = false,
  style,
}: ModalProps & { drawer?: boolean }) {
  const [shown, change] = useMaterialValue(open, onOpenChange),
    [host, setHost] = useState<HTMLDivElement | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const design = useDesignMode(),
    hasFooter = useHasSlot('footer', slots);
  const presentation = useMaterialPresentation();
  const environment = useRuntimeDomEnvironment();
  const container = environment === undefined ? host : runtimePortalContainer(environment, host);
  const node = useMaterialNode();
  const overlayMode = design ? (presentation?.overlay ?? 'expanded') : undefined;
  const PlaceholderIcon = drawer ? PanelRightOpen : PanelsTopLeft;
  return (
    <section
      className={`material-overlay-host ${design ? 'design' : ''}`}
      data-overlay-presentation={overlayMode}
      data-overlay-node={node?.id}
    >
      <Dialog.Root
        open={design ? overlayMode !== 'collapsed' : shown}
        modal={!design}
        onOpenChange={(next, details) => {
          if (design && details.reason === 'escape-key' && isAuthorEscape(details.event)) {
            // Controlled design presentation stays open without claiming the editor's Escape.
            details.cancel();
            details.allowPropagation();
            return;
          }
          if (!design && !busy) {
            setError('');
            change(next);
          }
        }}
      >
        {showTrigger && (
          <Dialog.Trigger className="ui-button material-overlay-trigger">
            {triggerLabel}
          </Dialog.Trigger>
        )}
        {design && overlayMode === 'collapsed' && (
          <div className="material-overlay-placeholder" aria-label={`${title}设计占位`}>
            <PlaceholderIcon size={17} aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>{drawer ? '抽屉' : '对话框'} · 选中以编辑内容</small>
            </span>
          </div>
        )}
        <div ref={setHost} className="material-overlay-mount" />
        {host && (
          <Dialog.Portal container={container} keepMounted>
            <Dialog.Backdrop className={`material-modal-backdrop ${design ? 'design' : ''}`} />
            <Dialog.Popup
              initialFocus={design ? false : undefined}
              finalFocus={design ? false : undefined}
              data-overlay-presentation={overlayMode}
              className={`material-modal ${drawer ? 'drawer' : ''} ${design ? 'design' : ''}`}
              style={{ '--modal-width': `${width}px`, ...style } as React.CSSProperties}
              {...materialStyleTarget(style)}
            >
              <header>
                <div>
                  <Dialog.Title>{title}</Dialog.Title>
                  {description && <Dialog.Description>{description}</Dialog.Description>}
                  {design && (
                    <small>
                      {drawer ? '抽屉' : '对话框'}内容 ·{' '}
                      {showTrigger ? '预览时通过触发按钮打开' : '预览时由页面操作打开'}
                    </small>
                  )}
                </div>
                <Tip content="关闭">
                  <Dialog.Close
                    className="ui-button ui-button-ghost material-icon-button"
                    aria-label={`关闭${title}`}
                    disabled={busy}
                  >
                    <X size={15} />
                  </Dialog.Close>
                </Tip>
              </header>
              <div className="material-modal-body">{children}</div>
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              {showFooter && (
                <footer data-overlay-slot-footer={hasFooter || undefined}>
                  {hasFooter ? (
                    slots.footer?.({})
                  ) : (
                    <>
                      <Dialog.Close className="ui-button" disabled={busy}>
                        {cancelLabel}
                      </Dialog.Close>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await onConfirm?.();
                            change(false);
                          } catch (cause) {
                            setError((cause as Error).message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? '处理中…' : confirmLabel}
                      </Button>
                    </>
                  )}
                  {!hasFooter && design && slots.footer?.({})}
                </footer>
              )}
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </Dialog.Root>
    </section>
  );
}
export function DialogMaterial(props: ModalProps) {
  return <OverlayMaterial {...props} />;
}
export function DrawerMaterial(props: ModalProps) {
  return <OverlayMaterial {...props} drawer />;
}
export function AlertMaterial({
  title,
  description,
  tone = 'info',
  closable = false,
  visible = true,
  onVisibleChange,
  style,
}: {
  style?: React.CSSProperties;
  title: string;
  description?: string;
  tone?: 'info' | 'success' | 'warning' | 'error';
  closable?: boolean;
  visible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}) {
  const [shown, change] = useMaterialValue(visible, onVisibleChange),
    design = useDesignMode();
  if (!shown && !design) return null;
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'info' ? Info : AlertCircle;
  return (
    <div
      className={`material-alert ${tone}`}
      style={style}
      {...materialStyleTarget(style)}
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
    >
      <Icon size={17} />
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
      </div>
      {closable && (
        <Tip content="关闭提醒">
          <Button
            className="material-icon-button"
            variant="ghost"
            aria-label="关闭提醒"
            onClick={() => change(false)}
          >
            <X size={14} />
          </Button>
        </Tip>
      )}
    </div>
  );
}
export function LoadingMaterial({
  loading = true,
  label = '正在加载…',
  blocking = true,
  children,
  style,
}: {
  style?: React.CSSProperties;
  loading?: boolean;
  label?: string;
  blocking?: boolean;
  children?: ReactNode;
}) {
  const design = useDesignMode();
  return (
    <section
      className="material-loading"
      style={style}
      {...materialStyleTarget(style)}
      aria-busy={loading || undefined}
    >
      <div
        inert={loading && blocking && !design ? true : undefined}
        className="material-loading-content"
      >
        {children}
      </div>
      {loading && (
        <div
          className={`material-loading-indicator ${blocking && !design ? 'blocking' : ''}`}
          role="status"
        >
          <span className="material-spinner" />
          {label}
        </div>
      )}
    </section>
  );
}
function ToastViewport() {
  const { toasts } = Toast.useToastManager();
  const container = runtimePortalContainer(useRuntimeDomEnvironment());
  return (
    <Toast.Portal container={container}>
      <Toast.Viewport className="material-toast-viewport" aria-label="消息通知">
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className={`material-toast ${toast.type ?? 'info'}`}
          >
            <Toast.Content>
              <Toast.Title />
              <Toast.Description />
            </Toast.Content>
            <Tip content="关闭通知">
              <Toast.Close
                className="ui-button ui-button-ghost material-icon-button"
                aria-label="关闭通知"
              >
                <X size={14} />
              </Toast.Close>
            </Tip>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}
export function MaterialEffects({
  runtime,
  environment,
}: {
  runtime: PageRuntime;
  environment?: RuntimeDomEnvironment | null;
}) {
  const manager = useMemo(() => Toast.createToastManager(), [runtime]);
  useEffect(
    () =>
      runtime.subscribeEffects((effect) => {
        if (effect.type === 'ui.notify')
          manager.add({
            title: String(effect.data.title ?? ''),
            description: effect.data.description ? String(effect.data.description) : undefined,
            type: String(effect.data.tone ?? 'info'),
            timeout: Number(effect.data.timeout ?? 4000),
          });
      }),
    [runtime, manager],
  );
  return (
    <Toast.Provider toastManager={manager} limit={4}>
      <RuntimeDomProvider environment={environment}>
        <ToastViewport />
      </RuntimeDomProvider>
    </Toast.Provider>
  );
}
const overlayContract: Contracts[string] = {
  version: '1.0.0',
  children: true,
  slots: { footer: [] },
  props: {
    title: requiredText,
    description: textProp,
    triggerLabel: textProp,
    showTrigger: boolProp,
    open: boolProp,
    confirmLabel: textProp,
    cancelLabel: textProp,
    showFooter: boolProp,
    width: numberProp,
  },
  events: ['onOpenChange', 'onConfirm'],
  validateProps: (props) =>
    'width' in props && (Number(props.width) < 240 || Number(props.width) > 1200)
      ? ['弹层宽度必须在 240 到 1200 之间']
      : [],
};
export const feedbackContracts: Contracts = {
  'ui.dialog': overlayContract,
  'ui.drawer': overlayContract,
  'ui.alert': {
    version: '1.0.0',
    props: {
      title: requiredText,
      description: textProp,
      tone: textProp,
      closable: boolProp,
      visible: boolProp,
    },
    events: ['onVisibleChange'],
    validateProps: (props) => enumErrors(props, { tone: ['info', 'success', 'warning', 'error'] }),
  },
  'ui.loading': {
    version: '1.0.0',
    children: true,
    props: { loading: boolProp, label: textProp, blocking: boolProp },
  },
};
export const feedbackActions: Registry['actions'] = {
  'ui.notify': {
    version: '1.0.0',
    input: { title: requiredText, description: textProp, tone: textProp, timeout: numberProp },
    execute(input, context) {
      if (!String(input.title).trim()) throw new Error('通知标题不能为空');
      if (
        input.tone !== undefined &&
        !['info', 'success', 'warning', 'error'].includes(String(input.tone))
      )
        throw new Error('通知类型无效');
      if (
        input.timeout !== undefined &&
        (typeof input.timeout !== 'number' || input.timeout < 0 || input.timeout > 60000)
      )
        throw new Error('通知时长必须在 0 到 60000 毫秒之间');
      context.emitEffect({ type: 'ui.notify', data: input });
    },
  },
};
