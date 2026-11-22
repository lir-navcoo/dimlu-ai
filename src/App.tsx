import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Dialog } from '@base-ui/react/dialog';
import { Combobox } from '@base-ui/react/combobox';
import {
  ChevronDown,
  Check,
  Eye,
  FileText,
  Files,
  PanelLeft,
  PanelRight,
  Pencil,
  Play,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { Button, Tip, TipProvider } from './ui/primitives';
import { ResizeHandle } from './ui/ResizeHandle';
import { PageRuntime } from '../packages/runtime/engine';
import { purchaseManagementExample } from './purchase-management-example';
import { registry } from './materials';
import { MaterialEffects } from './materials/feedback';
import { EditorDocument, findNode, type EditorSnapshot } from '../packages/editor/document';
import type { ApplicationMethodReference } from '../packages/editor/data';
import type { ApplicationMethod } from '../packages/schema/types';
import type { OpenApplicationMethods } from './editor/ActionPanel';
import { selectedNodeIds } from '../packages/editor/selection';
import { validateCatalog } from '../packages/editor/metadata';
import { catalog } from './editor/catalog';
import { EditorToolbar, PropertyPanel } from './editor/Editor';
import { designPanels, editorPanelRoute, type EditorPanelId } from './editor/panels';
import { CodePageCanvas } from './code/CodePage';
import './code/code.css';
import { EditorCanvas, type CanvasMode } from './editor/Canvas';
import { CanvasViewport, CanvasSurface } from './editor/CanvasViewport';
import { ViewportControls } from './editor/ViewportControls';
import { CanvasBreadcrumb } from './editor/CanvasBreadcrumb';
import { DragDropProvider, useDragDrop } from './editor/DragDrop';
import { DebugDock } from './editor/DebugDock';
import { isLogHostVisible, type LogPresentation } from './editor/LogNodeLocator';
import { EditorSessionProvider, useEditorSession, useSessionState } from './editor/session';
import { refreshEditorDocument } from './editor/refresh-document';
import {
  ProjectStorage,
  browserProjectStorage,
  type ProjectStorageAdapter,
  type ProjectStorageSnapshot,
} from '../packages/editor/project-storage';
import { ProjectMenu } from './editor/ProjectMenu';
import { MobilePreviewDialog } from './editor/MobilePreviewDialog';
import {
  ApplicationDirectory,
  type ApplicationDirectory as ApplicationDirectoryType,
} from '../packages/editor/application-directory';
import { isAuthorEscape } from './editor/author-escape';
import { CanvasStage, useCanvasStageVersion } from './editor/canvas-stage';
import {
  editorApplicationPath,
  editorApplicationsPath,
  editorRoutePath,
  isEditorApplicationLocation,
  isEditorLocation,
  isEditorPagesLocation,
  parseEditorLocation,
  writeEditorRoute,
} from './editor/router';
import { PageManagementHome } from './editor/PageManagementHome';
import { ApplicationSettingsHome } from './editor/ApplicationSettingsHome';
import { ApplicationRuntimeHost } from './ApplicationRuntimeHost';
import { applicationRoutePath } from '../packages/runtime/router';
import { applicationIdFromLocation } from '../packages/runtime/router';
import { compileApplication } from '../packages/runtime/engine';
import { ApplicationDirectoryHome } from './editor/ApplicationDirectoryHome';
import { Menu } from '@base-ui/react/menu';

const catalogErrors = validateCatalog(catalog, registry);
if (catalogErrors.length) throw new Error(catalogErrors.join('\n'));
function RuntimeStatus({ runtime }: { runtime: PageRuntime }) {
  useSyncExternalStore(runtime.subscribeMeta, runtime.getMetaVersion, runtime.getMetaVersion);
  return (
    <span className={`status-pill ${runtime.getPending() ? 'busy' : ''}`}>
      <i />
      {runtime.getPending() ? '正在执行动作' : '运行中'}
    </span>
  );
}
function RuntimeNotice({ runtime }: { runtime: PageRuntime }) {
  useSyncExternalStore(runtime.subscribeMeta, runtime.getMetaVersion, runtime.getMetaVersion);
  const last = runtime.getRecords().at(-1);
  return last?.level === 'error' ? (
    <div className="action-notice" role="alert">
      {last.message}
    </div>
  ) : null;
}
function useWindowSize() {
  const [size, setSize] = useState(() => ({ width: innerWidth, height: innerHeight }));
  useEffect(() => {
    const update = () => setSize({ width: innerWidth, height: innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}
type Layout = {
  leftWidth: number;
  rightWidth: number;
  debugHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};
const inspectorMin = 280;
const inspectorMax = 480;
const sidebarMax = 440;
const minCanvasWidth = 430;
const splitterWidth = 6;
const defaultLayout: Layout = {
  leftWidth: 248,
  rightWidth: 352,
  debugHeight: 240,
  leftCollapsed: false,
  rightCollapsed: false,
};
type LogHostAttempt = {
  generation: object;
  presentation: LogPresentation;
  host: HTMLDivElement | null;
  narrow: boolean;
  native: boolean;
  active: boolean;
  status: 'pending' | 'ready' | 'failed';
};
function useLayout() {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const current = localStorage.getItem('dimlu.workbench.layout.v2');
      const saved = JSON.parse(current ?? localStorage.getItem('dimlu.workbench.layout.v1') ?? '{}');
      if (!current && saved) {
        if (saved.leftWidth === 224) saved.leftWidth = defaultLayout.leftWidth;
        if (saved.rightWidth === 304) saved.rightWidth = defaultLayout.rightWidth;
      }
      return {
        leftWidth: Number.isFinite(saved.leftWidth)
          ? Math.max(192, Math.min(sidebarMax, saved.leftWidth))
          : defaultLayout.leftWidth,
        rightWidth: Number.isFinite(saved.rightWidth)
          ? Math.max(inspectorMin, Math.min(inspectorMax, saved.rightWidth))
          : defaultLayout.rightWidth,
        debugHeight: Number.isFinite(saved.debugHeight)
          ? Math.max(140, Math.min(600, saved.debugHeight))
          : defaultLayout.debugHeight,
        leftCollapsed: saved.leftCollapsed === true,
        rightCollapsed: saved.rightCollapsed === true,
      };
    } catch {
      return defaultLayout;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('dimlu.workbench.layout.v2', JSON.stringify(layout));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [layout]);
  return [layout, setLayout] as const;
}
function ResponsiveSide({
  narrow,
  collapsed,
  width,
  open,
  onOpenChange,
  title,
  side,
  triggerRef,
  suppressInitialFocus = false,
  restoreFocus = true,
  hostRef,
  onHostOpenComplete,
  top,
  children,
}: {
  narrow: boolean;
  collapsed: boolean;
  width: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  side: 'left' | 'right';
  triggerRef: React.RefObject<HTMLElement | null>;
  suppressInitialFocus?: boolean;
  restoreFocus?: boolean;
  hostRef?: React.RefObject<HTMLDivElement | null>;
  onHostOpenComplete?: (open: boolean) => void;
  top?: number;
  children: ReactNode;
}) {
  const drag = useDragDrop();
  if (!narrow)
    return (
      <div
        ref={hostRef}
        id={`${side}-panel`}
        className={`side-host ${side}`}
        style={{ width }}
        hidden={collapsed}
      >
        {children}
      </div>
    );
  return (
    <Dialog.Root
      onOpenChangeComplete={onHostOpenComplete}
      modal={side === 'right'}
      disablePointerDismissal={side === 'left' || !!drag?.session}
      open={open}
      onOpenChange={(value, details) => {
        if (
          drag?.session &&
          drag.isInteracting &&
          details.reason === 'escape-key' &&
          isAuthorEscape(details.event)
        ) {
          // A refused drag-time dismissal passes only to the existing author cancel fallback.
          details.cancel();
          details.allowPropagation();
          return;
        }
        if (!drag?.session) onOpenChange(value);
      }}
    >
      <Dialog.Portal keepMounted>
        {side === 'right' && <Dialog.Backdrop className="drawer-backdrop" />}
        <Dialog.Popup
          ref={hostRef}
          id={`${side}-panel`}
          className={`side-drawer ${side} ${drag?.session?.method === 'pointer' ? 'dragging' : ''}`}
          style={side === 'left' ? { top, width } : { width }}
          finalFocus={restoreFocus ? triggerRef : false}
          initialFocus={suppressInitialFocus ? false : undefined}
        >
          <div className="drawer-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="ui-button ui-button-ghost" aria-label={`关闭${title}`}>
              <X size={16} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function PageSwitcher({
  document,
  snapshot,
  onNavigatePage,
  onOpenPagePanel,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  onNavigatePage?: (pageId: string) => void;
  onOpenPagePanel: (panel: 'pages' | 'logic') => void;
}) {
  const drag = useDragDrop();
  const latest = useRef({ document, drag, onNavigatePage });
  latest.current = { document, drag, onNavigatePage };
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const titleCounts = new Map<string, number>();
  for (const page of snapshot.plan.schema.pages)
    titleCounts.set(page.title, (titleCounts.get(page.title) ?? 0) + 1);
  const pages = snapshot.plan.schema.pages.map((page) => ({
    value: page.id,
    title: page.title,
    label: `${page.title} · ${page.id}`,
    accessibleName: titleCounts.get(page.title) === 1 ? page.title : `${page.title} · ${page.id}`,
  }));
  const value = pages.find((page) => page.value === snapshot.selection.pageId)!;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const openPagePanel = (panel: 'pages' | 'logic') => {
    if (latest.current.drag?.isInteracting) return;
    setOpen(false);
    setQuery('');
    onOpenPagePanel(panel);
  };
  return (
    <Combobox.Root
      items={pages}
      value={value}
      isItemEqualToValue={(a, b) => a.value === b.value}
      onValueChange={(next) => {
        const current = latest.current;
        if (
          !next ||
          !active.current ||
          current.document !== document ||
          current.drag?.isInteracting ||
          current.document.getSnapshot().plan !== snapshot.plan ||
          !current.document.getSnapshot().plan.pages.has(next.value)
        )
          return;

        if (current.onNavigatePage) current.onNavigatePage(next.value);
        else current.document.selectPage(next.value);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setQuery('');
      }}
      autoHighlight
    >
      <Combobox.Trigger
        className="page-switcher ui-button"
        aria-label="切换页面"
        data-value={value.value}
        disabled={!!drag?.isInteracting}
      >
        <FileText size={14} aria-hidden="true" />
        <span>{value.title}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={5} className="menu-positioner">
          <Combobox.Popup className="page-popup" initialFocus>
            <Combobox.Input className="ui-input" aria-label="搜索页面" placeholder="搜索页面" />
            <Combobox.Empty className="editor-note">没有匹配的页面</Combobox.Empty>
            <Combobox.List className="page-options">
              {(page: typeof value) => (
                <Combobox.Item
                  key={page.value}
                  value={page}
                  data-value={page.value}
                  className="ui-select-item"
                  aria-label={page.accessibleName}
                >
                  <span className="quick-page-label">
                    <span>{page.title}</span>
                    <small>{page.value}</small>
                  </span>
                  <Combobox.ItemIndicator>
                    <Check size={13} />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
            <div className="page-popup-footer">
              <Button onClick={() => openPagePanel('pages')}>页面管理</Button>
              <Button onClick={() => openPagePanel('logic')}>页面进入动作</Button>
            </div>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
function PageTabs({
  snapshot,
  onPageChange,
  onOpenPagePanel,
}: {
  snapshot: EditorSnapshot;
  onPageChange: (pageId: string) => void;
  onOpenPagePanel: (panel: string) => void;
}) {
  const drag = useDragDrop();
  const current = snapshot.selection.pageId;
  return (
    <nav className="page-tabs-inline" aria-label="页面页签">
      <div className="page-tabs-scroll">
        {snapshot.plan.schema.pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className={`page-tab${page.id === current ? ' is-active' : ''}`}
            aria-current={page.id === current ? 'page' : undefined}
            aria-label={`切换到页面 ${page.title}`}
            disabled={!!drag?.isInteracting}
            onClick={() => {
              if (page.id !== current) onPageChange(page.id);
            }}
          >
            {page.title}
          </button>
        ))}
      </div>
      <Tip content="管理页面：新增、重命名、分组与入口" side="bottom">
        <Button
          variant="ghost"
          aria-label="管理页面"
          disabled={!!drag?.isInteracting}
          onClick={() => onOpenPagePanel('pages')}
        >
          <Files size={14} aria-hidden="true" />
        </Button>
      </Tip>
    </nav>
  );
}
function Sidebar({
  document,
  snapshot,
  authoringAllowed,
  onNavigatePage,
  onOpenMethods,
  onEditProperties,
  pageEntryTarget,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed: boolean;
  onNavigatePage?: (pageId: string) => void;
  onOpenMethods: OpenApplicationMethods;
  onEditProperties?: () => void;
  pageEntryTarget?: ApplicationMethodReference;
}) {
  const session = useEditorSession();
  const [visited, setVisited] = useState<Set<EditorPanelId>>(() => new Set([session.leftTab]));
  useEffect(() => {
    setVisited((current) =>
      current.has(session.leftTab) ? current : new Set([...current, session.leftTab]),
    );
  }, [session.leftTab]);
  return (
    <nav aria-label="页面设计" className="sidebar">
      {session.leftTab !== 'structure' && (
        <div className="sidebar-heading">{editorPanelRoute(session.leftTab)?.title}</div>
      )}
      {designPanels.map((panel) => (
        <Tabs.Panel key={panel.id} value={panel.id} className={panel.className} keepMounted>
          {(!panel.lazy || visited.has(panel.id) || session.leftTab === panel.id) &&
            panel.render({
              document,
              snapshot,
              authoringAllowed,
              onNavigatePage,
              onOpenMethods,
              onEditProperties,
              pageEntryTarget: session.leftTab === panel.id ? pageEntryTarget : undefined,
              dataNodeId:
                selectedNodeIds(snapshot.selection).length === 1 &&
                session.dataTarget?.pageId === snapshot.selection.pageId &&
                session.dataTarget.nodeId === snapshot.selection.nodeId
                  ? session.dataTarget.nodeId
                  : undefined,
            })}
        </Tabs.Panel>
      ))}
    </nav>
  );
}
function NavigationEnvironment({
  document,
  snapshot,
  mode,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  mode: CanvasMode;
}) {
  const { navigation } = useEditorSession();
  const drag = useDragDrop();
  const pageId = snapshot.selection.pageId;
  const enabled = mode === 'edit' && !snapshot.plan.pages.get(pageId)!.schema.code?.enabled;
  useLayoutEffect(() => () => navigation.resetKeyboardInteraction(), [navigation]);
  useLayoutEffect(() => {
    navigation.bind({
      document,
      plan: snapshot.plan,
      pageId,
      enabled,
      dragging: !!drag?.isInteracting,
    });
  }, [
    navigation,
    document,
    snapshot.plan,
    snapshot.selection,
    pageId,
    enabled,
    drag?.isInteracting,
  ]);
  return null;
}
type MethodReferenceRequest = { document: EditorDocument; reference: ApplicationMethodReference };

function Workbench({
  project,
  projectSnapshot,
  onManageApplication,
  onOpenMethods,
  onRunApplication,
  onManageApplications,
  methodReferenceRequest,
  onMethodReferenceHandled,
}: {
  project: ProjectStorage;
  projectSnapshot: ProjectStorageSnapshot;
  onManageApplication: () => void;
  onOpenMethods: OpenApplicationMethods;
  onRunApplication: () => void;
  onManageApplications?: () => void;
  methodReferenceRequest: MethodReferenceRequest | null;
  onMethodReferenceHandled: () => void;
}) {
  const document = refreshEditorDocument(projectSnapshot.document, registry);
  useLayoutEffect(() => {
    project.bindDocument(document, registry);
  }, [project, document]);
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );
  const {
    plan,
    selection: { pageId, nodeId },
  } = snapshot;
  const session = useEditorSession();
  const routeState = useRef({ document, plan, session });
  routeState.current = { document, plan, session };
  useLayoutEffect(() => {
    const restore = () => {
      const current = routeState.current;
      const route = parseEditorLocation(window.location);
      const routePageExists = !!route.pageId && current.plan.pages.has(route.pageId);
      const nextPageId = routePageExists
        ? route.pageId!
        : current.document.getSnapshot().selection.pageId;
      const currentPath = `${window.location.pathname}${window.location.search}`;

      if (current.document.getSnapshot().selection.pageId !== nextPageId) {
        current.document.selectPage(nextPageId);
      }

      const emptyPage = current.plan.pages.get(nextPageId)?.schema;
      const hasExplicitPanel = new URLSearchParams(window.location.search).has('panel');
      const effectivePanel =
        route.panel === 'structure' &&
        !hasExplicitPanel &&
        emptyPage &&
        !emptyPage.code?.enabled &&
        emptyPage.children.length === 0
          ? 'materials'
          : route.panel;
      const effectivePath = editorRoutePath(nextPageId, effectivePanel);
      current.session.setLeftTab(effectivePanel);
      writeEditorRoute(
        nextPageId,
        effectivePanel,
        !isEditorLocation(window.location) || !routePageExists || currentPath !== effectivePath,
      );
    };

    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [document]);
  const [layout, setLayout] = useLayout();
  const size = useWindowSize();
  const [reset, setReset] = useState(0),
    [mode, setMode] = useState<CanvasMode>('edit');
  const [runtime, setRuntime] = useState<PageRuntime | null>(null);
  const [canvasStage] = useState(() => new CanvasStage());
  const staged =
    import.meta.env.MODE === 'canvas-stage' && !plan.pages.get(pageId)!.schema.code?.enabled;
  canvasStage.context = { document, snapshot, runtime };
  useCanvasStageVersion(staged ? canvasStage : undefined);
  useLayoutEffect(() => {
    canvasStage.invalidate('binding');
  }, [canvasStage, document, plan, pageId, runtime]);
  const [rightOpen, setRightOpen] = useState(false),
    [debugOpen, setDebugOpen] = useSessionState('debug/open', false);
  const [propertyRequest, setPropertyRequest] = useState(0);
  const [debugMaximized] = useSessionState('debug/maximized', false);
  const rightNarrow = size.width < 760;
  const railWidth = rightNarrow ? 40 : 44;
  const panelBudget = size.width - railWidth - minCanvasWidth;
  const panelMinWidth = editorPanelRoute(session.leftTab)!.minWidth;
  const rightDocked = !rightNarrow && !layout.rightCollapsed;
  const rightMinimum = rightDocked ? inspectorMin + splitterWidth : 0;
  const leftNarrow =
    size.width < 1000 || panelBudget < panelMinWidth + splitterWidth + rightMinimum;
  const leftDocked = !leftNarrow && !layout.leftCollapsed;
  const leftPreference = Math.max(panelMinWidth, layout.leftWidth);
  const leftWidth = leftDocked
    ? Math.min(leftPreference, panelBudget - rightMinimum - splitterWidth)
    : leftPreference;
  const rightLimit = Math.min(
    inspectorMax,
    panelBudget - (leftDocked ? leftWidth + splitterWidth : 0) - splitterWidth,
  );
  const rightWidth = rightDocked ? Math.min(layout.rightWidth, rightLimit) : layout.rightWidth;
  const leftLimit = Math.min(
    sidebarMax,
    panelBudget - (rightDocked ? rightWidth + splitterWidth : 0) - splitterWidth,
  );
  const shell = useRef<HTMLDivElement>(null);
  const [workspaceTop, setWorkspaceTop] = useState(52);
  useLayoutEffect(() => {
    const root = shell.current;
    const workspace = root?.querySelector('.workspace');
    if (!root || !workspace) return;
    const update = () => setWorkspaceTop(workspace.getBoundingClientRect().top);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    for (const child of root.children) observer.observe(child);
    return () => observer.disconnect();
  }, [size.width, projectSnapshot.error]);
  const [logPresentation, setLogPresentation] = useState<LogPresentation | null>(null);
  const logOwner = useRef<LogPresentation | null>(null);
  const leftLogHost = useRef<HTMLDivElement>(null);
  const logHostAttempt = useRef<LogHostAttempt | null>(null);
  // An unsettled native opening keeps its original owner, even after retirement.
  const nativeLogOpening = useRef<LogHostAttempt | null>(null);
  const [nativeHostCommit, setNativeHostCommit] = useState<LogHostAttempt | null>(null);
  const [, setLogHostVersion] = useState(0);
  const [leftLogOpening, setLeftLogOpening] = useState<{
    token: object;
    document: EditorDocument;
    pageId: string;
  } | null>(null);
  const logContext = useRef({ document, snapshot, runtime, mode, session, leftNarrow, debugOpen });
  logContext.current = { document, snapshot, runtime, mode, session, leftNarrow, debugOpen };
  const currentLogHost = (attempt: LogHostAttempt) => {
    const current = logContext.current;
    const owner = attempt.presentation;
    return (
      attempt.active &&
      owner.active &&
      logHostAttempt.current === attempt &&
      logOwner.current === owner &&
      current.document === owner.document &&
      current.runtime === owner.runtime &&
      !owner.runtime.disposed &&
      current.snapshot === owner.expected &&
      owner.document.getSnapshot() === owner.expected &&
      current.mode === 'edit' &&
      !current.debugOpen &&
      current.session.leftTab === 'structure' &&
      current.session.leftOpen &&
      current.leftNarrow === attempt.narrow
    );
  };
  const settleLogHost = (attempt: LogHostAttempt, ready: boolean) => {
    if (logHostAttempt.current !== attempt || !attempt.active || attempt.status !== 'pending')
      return;
    attempt.status = ready ? 'ready' : 'failed';
    setLogHostVersion((value) => value + 1);
  };
  const completeLogHostOpening = (open: boolean) => {
    // This fixed subject is never replaced by a newer pending hidden attempt.
    const opening = nativeLogOpening.current;
    if (!opening) return;
    if (!open && logContext.current.session.leftOpen) return;
    nativeLogOpening.current = null;
    if (!currentLogHost(opening)) return;
    if (!opening.host) opening.host = leftLogHost.current;
    // The native event can precede Base UI's final hidden-attribute commit.
    // Consume it once, then check the same host in our own next commit.
    if (open) setNativeHostCommit(opening);
    else settleLogHost(opening, false);
  };
  const retireLogPresentation = (clearOpening = false) => {
    if (logOwner.current) logOwner.current.active = false;
    if (logHostAttempt.current) logHostAttempt.current.active = false;
    logHostAttempt.current = null;
    setNativeHostCommit(null);
    logOwner.current = null;
    setLogPresentation(null);
    if (clearOpening) setLeftLogOpening(null);
  };
  const navigatePanel = (panelId: string) => {
    const panel = editorPanelRoute(panelId);
    if (!panel) return;

    retireLogPresentation(true);
    session.activatePanel(panel.id);
    // 代码面板需要更宽的编辑区：过窄时自动放宽一次，保留用户手动调整过的宽度。
    if (panel.id === 'code')
      setLayout((current) => (current.leftWidth < 380 ? { ...current, leftWidth: 420 } : current));
    writeEditorRoute(pageId, panelId as EditorPanelId);
  };
  const navigatePage = (nextPageId: string) => {
    const current = document.getSnapshot();
    if (!current.plan.pages.has(nextPageId)) return;

    retireLogPresentation(true);
    let panel = session.leftTab;
    if (current.selection.pageId !== nextPageId) {
      document.selectPage(nextPageId);
      const page = current.plan.pages.get(nextPageId)!.schema;
      if (panel === 'structure' && !page.code?.enabled && page.children.length === 0) {
        panel = 'materials';
        session.setLeftTab(panel);
      }
    }
    writeEditorRoute(nextPageId, panel);
  };
  const [locatedCall, setLocatedCall] = useState<MethodReferenceRequest | null>(null);
  const referenceTarget =
    mode === 'edit' && locatedCall?.document === document && locatedCall.reference.pageId === pageId
      ? locatedCall.reference
      : undefined;
  const eventTarget =
    (!rightNarrow || rightOpen) && referenceTarget?.owner?.nodeId === nodeId
      ? referenceTarget
      : undefined;
  const pageEntryTarget = referenceTarget?.owner ? undefined : referenceTarget;
  useEffect(() => {
    if (!methodReferenceRequest) return;
    onMethodReferenceHandled();
    if (methodReferenceRequest.document !== document) return;
    const { reference } = methodReferenceRequest;
    const page = document.getSnapshot().plan.pages.get(reference.pageId)?.schema;
    if (!page) return;
    const owner = reference.owner;
    const calls = owner ? findNode(page, owner.nodeId)?.node.on?.[owner.eventName] : page.onEnter;
    if (!calls?.some((call) => call.id === reference.callId && call.action === reference.actionId))
      return;
    retireLogPresentation(true);
    if (debugOpen) setDebugOpen(false);
    setMode('edit');
    document.select(page.id, owner?.nodeId ?? null);
    setLocatedCall(methodReferenceRequest);
    if (owner) {
      session.activatePanel('structure', false);
      session.setLeftOpen(false);
      setRightOpen(true);
      setLayout((current) =>
        current.rightCollapsed ? { ...current, rightCollapsed: false } : current,
      );
    } else {
      setRightOpen(false);
      session.activatePanel('logic');
    }
    writeEditorRoute(
      page.id,
      owner ? 'structure' : 'logic',
      isEditorApplicationLocation(window.location),
    );
  }, [methodReferenceRequest]);
  const prepareLogPresentation = (next: LogPresentation) => {
    const current = logContext.current;
    const actual = next.document.getSnapshot();
    if (
      !next.active ||
      current.document !== next.document ||
      current.runtime !== next.runtime ||
      next.runtime.disposed ||
      next.runtime.plan !== actual.plan ||
      current.snapshot.plan !== actual.plan ||
      actual !== next.expected ||
      current.mode !== 'edit' ||
      actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled ||
      next.runtime.page !== actual.plan.pages.get(actual.selection.pageId)
    )
      return false;
    const existingOpenHost = current.session.leftOpen && isLogHostVisible(leftLogHost.current);
    const needsNativeOpening = current.leftNarrow && !existingOpenHost;
    if (needsNativeOpening && (current.session.leftOpen || nativeLogOpening.current !== null))
      return false;
    if (logOwner.current && logOwner.current !== next) logOwner.current.active = false;
    if (logHostAttempt.current) logHostAttempt.current.active = false;
    logOwner.current = next;
    const attempt: LogHostAttempt = {
      generation: {},
      presentation: next,
      host: leftLogHost.current,
      narrow: current.leftNarrow,
      native: needsNativeOpening,
      active: true,
      status: 'pending',
    };
    logHostAttempt.current = attempt;
    setNativeHostCommit(null);
    if (needsNativeOpening) nativeLogOpening.current = attempt;
    setLogPresentation(next);
    if (current.leftNarrow)
      setLeftLogOpening({
        token: next.token,
        document: next.document,
        pageId: actual.selection.pageId,
      });
    setDebugOpen(false);
    current.session.activatePanel('structure');
    setLayout((previous) =>
      previous.leftCollapsed ? { ...previous, leftCollapsed: false } : previous,
    );
    return next.active && logOwner.current === next;
  };
  const releaseLogPresentation = (owner: LogPresentation) => {
    if (logOwner.current !== owner) return;
    owner.active = false;
    if (logHostAttempt.current?.presentation === owner) {
      logHostAttempt.current.active = false;
      logHostAttempt.current = null;
    }
    setNativeHostCommit((previous) => (previous?.presentation === owner ? null : previous));
    logOwner.current = null;
    setLogPresentation((previous) => (previous === owner ? null : previous));
    // Keep this opening's initial-focus policy stable until the dialog closes.
  };
  useEffect(() => {
    if (
      leftLogOpening &&
      (!leftNarrow ||
        !session.leftOpen ||
        leftLogOpening.document !== document ||
        leftLogOpening.pageId !== pageId)
    )
      setLeftLogOpening(null);
  }, [leftNarrow, session.leftOpen, leftLogOpening, document, pageId]);
  useLayoutEffect(() => {
    const attempt = logHostAttempt.current;
    if (!attempt || attempt.status !== 'pending') return;
    if (!currentLogHost(attempt)) {
      settleLogHost(attempt, false);
      return;
    }
    // A native opening gets exactly one post-signal committed inspection.
    if (attempt.native && nativeHostCommit !== attempt) return;
    if (!attempt.host) attempt.host = leftLogHost.current;
    settleLogHost(attempt, attempt.host === leftLogHost.current && isLogHostVisible(attempt.host));
  });
  const awaitingLogHost =
    !!logHostAttempt.current?.active &&
    logHostAttempt.current.presentation === logPresentation &&
    logHostAttempt.current.status === 'pending';
  const logPresentationReady =
    !!logPresentation?.active &&
    logOwner.current === logPresentation &&
    logPresentation.document === document &&
    logPresentation.runtime === runtime &&
    snapshot === logPresentation.expected &&
    mode === 'edit' &&
    !debugOpen &&
    session.leftTab === 'structure' &&
    logHostAttempt.current?.presentation === logPresentation &&
    logHostAttempt.current.active &&
    logHostAttempt.current.status === 'ready' &&
    (leftNarrow ? session.leftOpen : !layout.leftCollapsed) &&
    !(rightNarrow && rightOpen);
  const leftTrigger = useRef<HTMLButtonElement>(null),
    rightTrigger = useRef<HTMLButtonElement>(null),
    canvasScroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rightNarrow && debugOpen) {
      session.setLeftOpen(false);
      setRightOpen(false);
    }
  }, [rightNarrow, debugOpen]);
  useEffect(() => {
    if (session.revealLeft) {
      setLayout((current) => ({ ...current, leftCollapsed: false }));
      session.setRevealLeft(false);
    }
  }, [session.revealLeft]);
  useEffect(() => {
    if (canvasScroll.current) {
      canvasScroll.current.scrollTop = 0;
      canvasScroll.current.scrollLeft = 0;
    }
  }, [pageId]);
  useEffect(() => {
    const next = new PageRuntime(plan, pageId, { designMode: mode === 'edit' });
    setRuntime(next);
    void next.enter();
    // Leave actions run before disposal so their lane stays alive; without
    // leave actions disposal stays synchronous to preserve focus-gap semantics.
    return () => {
      if (next.willRunLeaveActions()) void next.leave().finally(() => next.dispose());
      else next.dispose();
    };
  }, [plan, pageId, reset]);
  useEffect(() => {
    runtime?.setDesignMode(mode === 'edit');
  }, [runtime, mode]);
  useEffect(() => {
    if (!runtime) return;
    return runtime.subscribeEffects((effect) => {
      if (effect.type !== 'app.navigate' || typeof effect.data.pageId !== 'string') return;
      const targetPageId = effect.data.pageId;
      if (!plan.pages.has(targetPageId)) return;
      document.selectPage(targetPageId);
      writeEditorRoute(targetPageId, 'structure', effect.data.replace === true);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }, [document, plan, runtime]);
  function toggleLeft() {
    retireLogPresentation(true);
    if (leftNarrow) session.setLeftOpen(true);
    else setLayout((current) => ({ ...current, leftCollapsed: !current.leftCollapsed }));
  }
  function toggleRight() {
    retireLogPresentation();
    if (rightNarrow) setRightOpen(true);
    else setLayout((current) => ({ ...current, rightCollapsed: !current.rightCollapsed }));
  }
  function editProperties() {
    retireLogPresentation(true);
    setLocatedCall(null);
    setPropertyRequest((current) => current + 1);
    session.setLeftOpen(false);
    setRightOpen(true);
  }
  return (
    <DragDropProvider
      stage={staged ? canvasStage : undefined}
      document={document}
      snapshot={snapshot}
      enabled={mode === 'edit' && !plan.pages.get(pageId)!.schema.code?.enabled}
      onCommit={() => session.setLeftOpen(false)}
    >
      <NavigationEnvironment document={document} snapshot={snapshot} mode={mode} />
      <div className="app-shell" ref={shell} style={{ '--workspace-top': `${workspaceTop}px` } as React.CSSProperties}>
        <header className="app-header">
          <div className="app-header-context">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">d</span>
              <strong>dimlu</strong>
            </div>
            <Menu.Root>
              <Menu.Trigger
                className="app-context-button ui-button ui-button-ghost"
                aria-label="当前应用菜单"
              >
                <strong>{plan.schema.title}</strong>
                <ChevronDown size={12} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={6} className="menu-positioner">
                  <Menu.Popup className="ui-menu app-context-menu">
                    {onManageApplications && (
                      <Menu.Item className="ui-menu-item" onClick={onManageApplications}>
                        切换应用
                      </Menu.Item>
                    )}
                    <Menu.Item className="ui-menu-item" onClick={onManageApplication}>
                      应用设置
                    </Menu.Item>
                    <Menu.Item className="ui-menu-item" onClick={onRunApplication}>
                      运行当前应用
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
            <nav className="app-header-primary" aria-label="页面搭建导航">
              <PageSwitcher
                document={document}
                snapshot={snapshot}
                onNavigatePage={navigatePage}
                onOpenPagePanel={navigatePanel}
              />
            </nav>
          </div>
          <EditorToolbar
            document={document}
            snapshot={snapshot}
            authoringAllowed={mode === 'edit'}
          />
          <nav className="app-header-actions" aria-label="应用操作">
            <MobilePreviewDialog application={plan.schema} pageId={pageId} />
            <ProjectMenu project={project} snapshot={projectSnapshot} />
            <div className="canvas-mode" role="group" aria-label="画布模式">
              <Button
                aria-label="编辑模式"
                aria-pressed={mode === 'edit'}
                onClick={() => {
                  retireLogPresentation();
                  setMode('edit');
                }}
              >
                <Pencil size={13} aria-hidden="true" />
                <span>编辑</span>
              </Button>
              <Button
                aria-label="预览模式"
                aria-pressed={mode === 'preview'}
                onClick={() => {
                  retireLogPresentation();
                  setMode('preview');
                }}
              >
                <Eye size={14} aria-hidden="true" />
                <span>预览</span>
              </Button>
            </div>
            <Tip content="在当前浏览器运行应用" side="bottom">
              <Button
                variant="primary"
                className="app-header-nav-button"
                aria-label="运行应用"
                onClick={onRunApplication}
              >
                <Play size={13} aria-hidden="true" />
                <span>运行</span>
              </Button>
            </Tip>
          </nav>
        </header>
        {projectSnapshot.error && (
          <div className="project-storage-notice" role="alert">
            {projectSnapshot.error}。
            {projectSnapshot.protected
              ? '本地副本已保护，当前编辑不会覆盖；可通过“本地项目菜单”导出原文或确认替换。'
              : '当前修改仍保留在内存，可通过“本地项目菜单”重试保存，或使用文件菜单导出 JSON。'}
          </div>
        )}
        <Tabs.Root
          className="workspace"
          orientation="vertical"
          value={session.leftTab}
          onValueChange={(value) => navigatePanel(String(value))}
        >
          <Tabs.List
            className="activity-rail"
            aria-label="设计面板"
            activateOnFocus
            inert={rightNarrow && debugOpen}
          >
            {designPanels.map(({ id, title, icon: Icon }) => (
              <Tip key={id} content={title} side="right">
                <Tabs.Tab
                  value={id}
                  aria-label={id === 'structure' ? '结构' : title}
                  onClick={() => navigatePanel(id)}
                >
                  <Icon size={17} aria-hidden="true" />
                </Tabs.Tab>
              </Tip>
            ))}
          </Tabs.List>
          <ResponsiveSide
            narrow={leftNarrow}
            collapsed={layout.leftCollapsed}
            width={leftWidth}
            open={session.leftOpen}
            onOpenChange={(open) => {
              retireLogPresentation(true);
              session.setLeftOpen(open);
            }}
            suppressInitialFocus={
              !!pageEntryTarget ||
              (!!leftLogOpening &&
                leftLogOpening.document === document &&
                leftLogOpening.pageId === pageId)
            }
            hostRef={leftLogHost}
            onHostOpenComplete={completeLogHostOpening}
            restoreFocus={!(rightNarrow && rightOpen)}
            title="页面设计"
            top={workspaceTop}
            side="left"
            triggerRef={leftTrigger}
          >
            <Sidebar
              document={document}
              snapshot={snapshot}
              authoringAllowed={mode === 'edit'}
              onNavigatePage={navigatePage}
              onOpenMethods={onOpenMethods}
              onEditProperties={rightNarrow && mode === 'edit' ? editProperties : undefined}
              pageEntryTarget={!leftNarrow || session.leftOpen ? pageEntryTarget : undefined}
            />
          </ResponsiveSide>
          {!leftNarrow && !layout.leftCollapsed && (
            <ResizeHandle
              label="调整左侧面板宽度"
              value={leftWidth}
              min={panelMinWidth}
              max={leftLimit}
              onChange={(leftWidth) => setLayout((current) => ({ ...current, leftWidth }))}
              controls="left-panel"
            />
          )}
          <main className="main-area">
            <div className="canvas-tools" role="group" aria-label="画布工具">
              <div className="canvas-toolbar" inert={rightNarrow && debugOpen}>
                <Button
                  ref={leftTrigger}
                  aria-label={
                    leftNarrow
                      ? '打开页面设计'
                      : layout.leftCollapsed
                        ? '展开左侧面板'
                        : '收起左侧面板'
                  }
                  variant="ghost"
                  onClick={toggleLeft}
                >
                  <PanelLeft size={15} aria-hidden="true" />
                </Button>
                <PageTabs
                  snapshot={snapshot}
                  onPageChange={(nextPageId) => {
                    retireLogPresentation();
                    navigatePage(nextPageId);
                  }}
                  onOpenPagePanel={navigatePanel}
                />
                <CanvasBreadcrumb document={document} snapshot={snapshot} />
                <div
                  className="canvas-toolbar-viewport"
                  inert={debugOpen && (rightNarrow || debugMaximized)}
                >
                  <ViewportControls mode={mode} />
                </div>
                <div className="canvas-toolbar-actions">
                  {runtime && !runtime.disposed && <RuntimeStatus runtime={runtime} />}
                  <Tip content="重置当前页面的运行数据" side="bottom">
                    <Button
                      variant="ghost"
                      onClick={() => setReset((n) => n + 1)}
                      aria-label="重置页面"
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                    </Button>
                  </Tip>
                  <Button
                    ref={rightTrigger}
                    aria-label={
                      rightNarrow
                        ? '打开属性检查器'
                        : layout.rightCollapsed
                          ? '展开右侧面板'
                          : '收起右侧面板'
                    }
                    variant="ghost"
                    onClick={rightNarrow && mode === 'edit' && nodeId ? editProperties : toggleRight}
                  >
                    <PanelRight size={15} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
            {runtime && !runtime.disposed && (
              <MaterialEffects
                key={runtime.instanceId}
                runtime={runtime}
                environment={staged ? canvasStage.runtimeEnvironment() : undefined}
              />
            )}
            <div
              ref={canvasScroll}
              className="canvas-scroll"
              data-mode={mode}
              aria-label="页面画布"
              inert={debugOpen && (rightNarrow || debugMaximized)}
            >
              <CanvasViewport mode={mode} stage={staged ? canvasStage : undefined}>
                {runtime &&
                runtime.plan === plan &&
                runtime.page.schema.id === pageId &&
                !runtime.disposed ? (
                  plan.pages.get(pageId)!.schema.code?.enabled ? (
                    <CanvasSurface>
                      <CodePageCanvas
                        code={plan.pages.get(pageId)!.schema.code!}
                        runtime={runtime}
                        mode={mode}
                        openCode={() => navigatePanel('code')}
                      />
                    </CanvasSurface>
                  ) : (
                    <EditorCanvas
                      document={document}
                      snapshot={snapshot}
                      runtime={runtime}
                      mode={mode}
                    >
                      <RuntimeNotice runtime={runtime} />
                    </EditorCanvas>
                  )
                ) : (
                  <p>正在创建运行实例…</p>
                )}
              </CanvasViewport>
            </div>
            {runtime && !runtime.disposed && (
              <DebugDock
                runtime={runtime}
                plan={plan}
                document={document}
                authorSnapshot={snapshot}
                authoringAllowed={mode === 'edit'}
                logPresentation={{
                  current: logPresentation,
                  ready: logPresentationReady,
                  awaitingHost: awaitingLogHost,
                  read: () => logOwner.current,
                  prepare: prepareLogPresentation,
                  release: releaseLogPresentation,
                }}
                open={debugOpen}
                setOpen={setDebugOpen}
                mobile={rightNarrow}
                height={layout.debugHeight}
                maxHeight={Math.max(140, size.height - 260)}
                setHeight={(debugHeight) => setLayout((current) => ({ ...current, debugHeight }))}
              />
            )}
          </main>
          {!rightNarrow && !layout.rightCollapsed && (
            <ResizeHandle
              label="调整右侧面板宽度"
              reverse
              value={rightWidth}
              min={inspectorMin}
              max={rightLimit}
              onChange={(width) => {
                if (width !== rightWidth) setLayout((current) => ({ ...current, rightWidth: width }));
              }}
              controls="right-panel"
            />
          )}
          <ResponsiveSide
            narrow={rightNarrow}
            collapsed={layout.rightCollapsed}
            width={rightWidth}
            open={rightOpen}
            onOpenChange={(open) => {
              retireLogPresentation();
              setRightOpen(open);
            }}
            title="属性检查器"
            side="right"
            triggerRef={rightTrigger}
            suppressInitialFocus={!!eventTarget}
          >
            <aside className="inspector">
              <div className="property-panel-title">
                <Settings2 size={14} aria-hidden="true" />
                <span>组件设置</span>
              </div>
              <PropertyPanel
                key={`${pageId}/${nodeId}`}
                document={document}
                snapshot={snapshot}
                onOpenMethods={mode === 'edit' ? onOpenMethods : undefined}
                eventTarget={eventTarget}
                propertyRequest={propertyRequest}
              />
            </aside>
          </ResponsiveSide>
        </Tabs.Root>
      </div>
    </DragDropProvider>
  );
}
function RoutedWorkspace({
  project,
  projectSnapshot,
  directory,
  onSelectApplication,
  onDeleteApplication,
  onRenameApplicationId,
  onEditApplication,
}: {
  project: ProjectStorage;
  projectSnapshot: ProjectStorageSnapshot;
  directory: ApplicationDirectoryType | null;
  onSelectApplication?: (appId: string) => void;
  onDeleteApplication?: (appId: string, replacementAppId?: string) => void;
  onRenameApplicationId?: (nextId: string) => void;
  onEditApplication?: (appId: string, pageId: string) => void;
}) {
  const [applicationDialog, setApplicationDialog] = useState<'settings' | 'methods' | null>(null);
  const [directMethod, setDirectMethod] = useState<{
    method?: ApplicationMethod;
    trigger: HTMLButtonElement;
    onCreated?: (method: ApplicationMethod) => void;
  } | null>(null);
  const methodsTrigger = useRef<HTMLButtonElement>(null);
  const pendingReference = useRef<MethodReferenceRequest | null>(null);
  const [methodReferenceRequest, setMethodReferenceRequest] =
    useState<MethodReferenceRequest | null>(null);
  const [route, setRoute] = useState<
    'runtime' | 'application' | 'pages' | 'applications' | 'editor'
  >(() =>
    window.location.pathname === '/' || window.location.pathname === editorApplicationsPath()
      ? 'applications'
      : window.location.pathname === '/apps' || window.location.pathname.startsWith('/apps/')
        ? 'runtime'
        : isEditorApplicationLocation(window.location)
          ? 'application'
          : isEditorPagesLocation(window.location)
            ? 'pages'
            : 'editor',
  );
  useEffect(() => {
    const update = () => {
      pendingReference.current = null;
      setApplicationDialog(null);
      setDirectMethod(null);
      setRoute(
        window.location.pathname === '/' || window.location.pathname === editorApplicationsPath()
          ? 'applications'
          : window.location.pathname === '/apps' || window.location.pathname.startsWith('/apps/')
            ? 'runtime'
            : isEditorApplicationLocation(window.location)
              ? 'application'
              : isEditorPagesLocation(window.location)
                ? 'pages'
                : 'editor',
      );
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  const openApplications = () => {
    project.flush();
    window.history.pushState({}, '', editorApplicationsPath());
    setRoute('applications');
  };
  const openApplicationSettings = () => {
    methodsTrigger.current = null;
    window.history.pushState({}, '', editorApplicationPath());
    setApplicationDialog('settings');
  };
  const openApplicationSettingsRoute = () => {
    window.history.pushState({}, '', editorApplicationPath());
    setApplicationDialog(null);
    setRoute('application');
  };
  const openApplicationRuntime = () => {
    const schema = projectSnapshot.document.getSnapshot().plan.schema;
    window.history.pushState({}, '', applicationRoutePath(schema.id));
    setRoute('runtime');
  };
  const backToEditor = () => {
    const pageId = projectSnapshot.document.getSnapshot().selection.pageId;
    window.history.pushState({}, '', editorRoutePath(pageId, 'structure'));
    setRoute('editor');
  };
  const openMethodReference = (reference: ApplicationMethodReference) => {
    const document = projectSnapshot.document;
    const request = { document, reference: { ...reference } };
    if (applicationDialog) {
      pendingReference.current = request;
      setApplicationDialog(null);
    } else {
      writeEditorRoute(reference.pageId, reference.owner ? 'structure' : 'logic');
      setMethodReferenceRequest(request);
      setRoute('editor');
    }
  };
  if (route === 'runtime') {
    let runtimePlan = projectSnapshot.document.getSnapshot().plan;
    const requestedAppId = applicationIdFromLocation(window.location);
    if (directory && requestedAppId && requestedAppId !== runtimePlan.schema.id) {
      try {
        runtimePlan = compileApplication(directory.getApplication(requestedAppId), registry);
      } catch {
        // Keep the active plan so the runtime host can render its typed unknown-app error.
      }
    }
    return <ApplicationRuntimeHost plan={runtimePlan} onEditApplication={onEditApplication} />;
  }
  if (route === 'applications')
    return directory && onSelectApplication && onDeleteApplication ? (
      <ApplicationDirectoryHome
        directory={directory}
        onSelect={onSelectApplication}
        onDelete={onDeleteApplication}
      />
    ) : (
      <main className="application-runtime-error" role="alert">
        应用目录在当前自定义存储适配器下不可用。
      </main>
    );
  if (route === 'application')
    return (
      <ApplicationSettingsHome
        project={project}
        projectSnapshot={projectSnapshot}
        onBack={backToEditor}
        onOpenReference={openMethodReference}
        onRenameApplicationId={onRenameApplicationId}
      />
    );
  if (route === 'pages')
    return (
      <PageManagementHome
        project={project}
        projectSnapshot={projectSnapshot}
        onBack={backToEditor}
        onManageApplication={openApplicationSettings}
      />
    );
  return (
    <>
      <Workbench
        project={project}
        projectSnapshot={projectSnapshot}
        onManageApplication={openApplicationSettings}
        onOpenMethods={(trigger, target) => {
          if (target && 'methodId' in target) {
            const method = projectSnapshot.document
              .getSnapshot()
              .plan.schema.methods?.find((candidate) => candidate.id === target.methodId);
            if (method) setDirectMethod({ method, trigger });
            return;
          }
          if (target) {
            setDirectMethod({ trigger, onCreated: target.onCreated });
            return;
          }
          methodsTrigger.current = trigger;
          setApplicationDialog('methods');
        }}
        onRunApplication={openApplicationRuntime}
        onManageApplications={directory ? openApplications : undefined}
        methodReferenceRequest={methodReferenceRequest}
        onMethodReferenceHandled={() => setMethodReferenceRequest(null)}
      />
      {directMethod && (
        <ApplicationSettingsHome
          project={project}
          projectSnapshot={projectSnapshot}
          onBack={backToEditor}
          directMethod={directMethod}
          onDirectMethodClosed={() => setDirectMethod(null)}
        />
      )}
      <Dialog.Root
        open={applicationDialog !== null}
        onOpenChangeComplete={(open) => {
          if (!open && pendingReference.current) {
            setMethodReferenceRequest(pendingReference.current);
            pendingReference.current = null;
          }
        }}
        onOpenChange={(open) => {
          if (open) return;
          if (applicationDialog === 'settings') backToEditor();
          setApplicationDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup
            className="material-modal application-settings-dialog"
            aria-label={applicationDialog === 'methods' ? '应用自定义方法' : '应用设置'}
            finalFocus={() => {
              const trigger = methodsTrigger.current;
              if (pendingReference.current) return false;
              return trigger?.isConnected && !trigger.disabled ? trigger : true;
            }}
          >
            <ApplicationSettingsHome
              project={project}
              projectSnapshot={projectSnapshot}
              embedded
              methodsOnly={applicationDialog === 'methods'}
              onOpenReference={openMethodReference}
              onBack={backToEditor}
              onRenameApplicationId={
                onRenameApplicationId &&
                ((nextId) => {
                  onRenameApplicationId(nextId);
                  setApplicationDialog(null);
                })
              }
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

export default function App({
  projectStorage,
  saveDelayMs,
}: { projectStorage?: ProjectStorageAdapter; saveDelayMs?: number } = {}) {
  const [storageAdapter] = useState(() => projectStorage ?? browserProjectStorage());
  const [directory] = useState(() =>
    projectStorage
      ? null
      : new ApplicationDirectory(storageAdapter, registry, purchaseManagementExample),
  );
  const [activeAppId, setActiveAppId] = useState(
    directory?.activeAppId ?? purchaseManagementExample.id,
  );
  const project = useMemo(
    () =>
      directory
        ? new ProjectStorage(
            directory.storageAdapterFor(activeAppId),
            registry,
            purchaseManagementExample,
            { debounceMs: saveDelayMs, storageKey: directory.storageKey },
          )
        : new ProjectStorage(storageAdapter, registry, purchaseManagementExample, {
            debounceMs: saveDelayMs,
          }),
    [directory, activeAppId, saveDelayMs, storageAdapter],
  );
  const selectApplication = (appId: string) => {
    if (!directory) return;
    directory.setActive(appId);
    setActiveAppId(appId);
    window.history.pushState({}, '', '/editor');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const editApplication = (appId: string, pageId: string) => {
    if (!directory) return;
    const entry = directory.getApplications().find((application) => application.id === appId);
    const storageId = entry?.key ?? appId;
    directory.setActive(storageId);
    setActiveAppId(storageId);
    window.history.pushState({}, '', editorRoutePath(pageId, 'structure'));
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const deleteApplication = (appId: string, replacementAppId?: string) => {
    if (!directory) return;
    const wasActive = directory.activeAppId === appId;
    directory.removeApplication(appId, replacementAppId);
    if (wasActive && replacementAppId) {
      setActiveAppId(replacementAppId);
      window.history.pushState({}, '', '/editor');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };
  const renameApplicationId = (nextId: string) => {
    if (!directory) return;
    project.flush();
    const renamedKey = directory.renameApplicationId(activeAppId, nextId);
    setActiveAppId(renamedKey);
    window.history.replaceState(
      {},
      '',
      editorRoutePath(snapshot.document.getSnapshot().selection.pageId, 'structure'),
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const snapshot = useSyncExternalStore(
    project.subscribe,
    project.getSnapshot,
    project.getSnapshot,
  );
  useEffect(() => {
    project.start();
    window.addEventListener('pagehide', project.flush);
    return () => {
      window.removeEventListener('pagehide', project.flush);
      project.stop();
    };
  }, [project]);
  return (
    <TipProvider delay={350}>
      <EditorSessionProvider key={snapshot.session}>
        <RoutedWorkspace
          project={project}
          projectSnapshot={snapshot}
          directory={directory}
          onSelectApplication={directory ? selectApplication : undefined}
          onDeleteApplication={directory ? deleteApplication : undefined}
          onRenameApplicationId={directory ? renameApplicationId : undefined}
          onEditApplication={directory ? editApplication : undefined}
        />
      </EditorSessionProvider>
    </TipProvider>
  );
}
