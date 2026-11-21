import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Maximize2, Minimize2, X } from 'lucide-react';
import { Button, Tip } from '../ui/primitives';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SchemaError, type PageRuntime, type ApplicationPlan } from '../../packages/runtime/engine';
import type { DataSourceSnapshot } from '../../packages/runtime/data-source';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { DraftNotice, useDraft, useSessionState } from './session';
import { CodeEditor } from '../ui/CodeEditor';
import { useLogNodeLocator, type LogPresentationBridge } from './LogNodeLocator';

const sourceStatus: Record<DataSourceSnapshot['status'], string> = {
  idle: '空闲',
  loading: '加载中',
  success: '成功',
  error: '失败',
};
const SourceSnapshot = memo(function SourceSnapshot({
  id,
  snapshot,
}: {
  id: string;
  snapshot: DataSourceSnapshot;
}) {
  const json = useMemo(() => JSON.stringify(snapshot, null, 2), [snapshot]);
  return (
    <article className="min-w-0" aria-label={`数据源 ${id}`}>
      <h4 className="mb-1 text-xs font-medium break-words">
        <code>{id}</code> · {sourceStatus[snapshot.status]}
      </h4>
      <pre className="state-json" aria-label={`数据源 ${id} 当前快照`}>
        {json}
      </pre>
    </article>
  );
});

export function DebugDock({
  runtime,
  plan,
  document,
  authorSnapshot,
  authoringAllowed = false,
  logPresentation,
  open,
  setOpen,
  height,
  maxHeight,
  setHeight,
  mobile,
}: {
  runtime: PageRuntime;
  plan: ApplicationPlan;
  document: EditorDocument;
  authorSnapshot?: EditorSnapshot;
  authoringAllowed?: boolean;
  logPresentation?: LogPresentationBridge;
  open: boolean;
  setOpen: (open: boolean) => void;
  mobile: boolean;
  height: number;
  maxHeight: number;
  setHeight: (value: number) => void;
}) {
  const [tab, setTab] = useSessionState('debug/tab', 'schema');
  const [maximized, setMaximized] = useSessionState('debug/maximized', false);
  const canonical = useMemo(() => JSON.stringify(plan.schema, null, 2), [plan]);
  const [source, setSource, draft] = useDraft('application-schema', canonical, canonical);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const lastTab = useRef<HTMLButtonElement | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && (mobile || maximized) && !dock.current?.contains(window.document.activeElement))
      dock.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open, mobile, maximized]);
  useSyncExternalStore(runtime.subscribeMeta, runtime.getMetaVersion, runtime.getMetaVersion);
  const all = useMemo(() => ['*'], []);
  const subscribe = useMemo(
    () => (fn: () => void) => runtime.subscribeState(all, fn),
    [runtime, all],
  );
  const snapshot = useMemo(() => () => runtime.snapshot(all), [runtime, all]);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const actual = authorSnapshot ? document.getSnapshot() : undefined;
  const sourceOwnerCurrent =
    !runtime.disposed &&
    runtime.plan === plan &&
    plan.pages.get(runtime.page.schema.id) === runtime.page &&
    (!authorSnapshot ||
      (authorSnapshot.plan === plan &&
        authorSnapshot.selection.pageId === runtime.page.schema.id &&
        actual?.plan === plan &&
        actual.selection.pageId === runtime.page.schema.id));
  // The aggregate allocates on read; existing meta-version renders drive updates.
  const sources = sourceOwnerCurrent ? Object.entries(runtime.getDataSourcesSnapshot()) : null;
  const logs = [...runtime.getRecords()].reverse();
  const locator = useLogNodeLocator({
    document,
    plan,
    runtime,
    authorSnapshot,
    authoringAllowed,
    presentation: logPresentation,
    open,
    tab,
    maximized,
  });
  const close = () => {
    locator.cancel();
    setOpen(false);
    lastTab.current?.focus();
  };
  return (
    <Tabs.Root
      ref={dock}
      render={<section aria-label="运行调试" />}
      id="debug-dock"
      className={`debug-dock ${open ? 'open' : ''} ${open && maximized ? 'maximized' : ''}`}
      style={open && !mobile && !maximized ? { height: Math.min(height, maxHeight) } : undefined}
      value={tab}
      onValueChange={(value) => {
        locator.cancel();
        setTab(String(value));
        setOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          close();
        }
      }}
    >
      {open && !maximized && (
        <ResizeHandle
          label="调整调试区高度"
          axis="y"
          reverse
          value={Math.min(height, maxHeight)}
          min={140}
          max={maxHeight}
          onChange={setHeight}
          controls="debug-content"
        />
      )}
      <div className="debug-toolbar">
        <Tabs.List className="panel-tabs" aria-label="调试视图">
          {(
            [
              ['schema', 'Schema'],
              ['state', '页面状态'],
              ['logs', '执行记录'],
            ] as const
          ).map(([id, label]) => (
            <Tip key={id} content={id === 'schema' && draft.dirty ? 'Schema 有未保存草稿' : label}>
              <Tabs.Tab
                value={id}
                aria-label={label}
                onFocus={(event) => {
                  lastTab.current = event.currentTarget;
                }}
                onClick={(event) => {
                  locator.cancel();
                  lastTab.current = event.currentTarget;
                  setOpen(true);
                }}
              >
                {label}
                {id === 'schema' && draft.dirty && (
                  <span className="unsaved-dot" aria-hidden="true" />
                )}
                {id === 'logs' && logs.length > 0 && <small>{logs.length}</small>}
              </Tabs.Tab>
            </Tip>
          ))}
        </Tabs.List>
        <span className="debug-description">{open ? 'Esc 收起' : '展开运行调试'}</span>
        {open && (
          <>
            {!mobile && (
              <Button
                aria-label={maximized ? '还原调试区' : '最大化调试区'}
                variant="ghost"
                onClick={() => {
                  locator.cancel();
                  setMaximized(!maximized);
                }}
              >
                {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </Button>
            )}
            <Button aria-label="关闭调试区" variant="ghost" onClick={close}>
              <X size={14} />
            </Button>
          </>
        )}
      </div>
      <div id="debug-content" className="debug-content" hidden={!open}>
        <Tabs.Panel value="schema" className="debug-panel" keepMounted>
          <div className="schema-panel">
            <div className="schema-actions">
              <label htmlFor="schema-editor">应用定义 · JSON</label>
              <Button
                disabled={draft.stale}
                className="apply-button"
                onClick={() => {
                  try {
                    const changed = document.importJson(source);
                    draft.reset();
                    setMessage({
                      ok: true,
                      text: changed
                        ? '校验通过，已应用。运行状态已重置。'
                        : '校验通过，定义没有变化。',
                    });
                  } catch (error) {
                    setMessage({
                      ok: false,
                      text:
                        error instanceof SchemaError
                          ? error.issues.map((i) => `${i.path} · ${i.message}`).join('\n')
                          : (error as Error).message,
                    });
                  }
                }}
              >
                校验并应用
              </Button>
              <Button onClick={draft.reset} disabled={!draft.dirty}>
                重新载入
              </Button>
            </div>
            <DraftNotice {...draft} />
            <CodeEditor
              id="schema-editor"
              label="应用定义 · JSON"
              language="json"
              fill
              value={source}
              onChange={(value) => {
                setSource(value);
                setMessage(null);
              }}
            />
            {message && (
              <pre
                role={message.ok ? 'status' : 'alert'}
                className={`validation-message ${message.ok ? 'ok' : 'error'}`}
              >
                {message.text}
              </pre>
            )}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="state" className="debug-panel" keepMounted>
          <div className="inspector-body state-columns">
            <section>
              <h3>页面状态 · {runtime.page.schema.id}</h3>
              <pre className="state-json">{JSON.stringify(runtime.getState(), null, 2)}</pre>
            </section>
            <section>
              <h3>表单状态</h3>
              <pre className="state-json">
                {JSON.stringify(runtime.getFormsSnapshot(), null, 2)}
              </pre>
            </section>
            <section className="col-span-full min-w-0" aria-label="数据源状态">
              <h3>数据源状态{sourceOwnerCurrent && ` · ${runtime.page.schema.id}`}</h3>
              {sources === null ? (
                <p className="muted">数据源状态正在更新</p>
              ) : sources.length ? (
                <div className="grid min-w-0 grid-cols-1 gap-3">
                  <p className="muted">空闲、加载中或失败时，data 可能保留已有值。</p>
                  {sources.map(([id, source]) => (
                    <SourceSnapshot key={`${runtime.instanceId}:${id}`} id={id} snapshot={source} />
                  ))}
                </div>
              ) : (
                <p className="muted">当前页面暂无数据源</p>
              )}
            </section>
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="logs" className="debug-panel" keepMounted>
          <div className="inspector-body logs" aria-live="polite">
            {logs.length ? (
              logs.map((log) => (
                <article key={log.sequence} className={`log ${log.level}`}>
                  <div>
                    <span>{log.kind}</span>
                    <time>{log.time}</time>
                  </div>
                  <p>{log.message}</p>
                  {log.nodeId && (
                    <span className="inline-flex items-center gap-1">
                      <code>node · {log.nodeId}</code>
                      {locator.control(log)}
                    </span>
                  )}
                </article>
              ))
            ) : (
              <p className="muted">暂时没有执行记录</p>
            )}
          </div>
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  );
}
