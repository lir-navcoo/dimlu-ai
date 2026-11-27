import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ArrowLeft, Code2, PanelsTopLeft, Plus, Search, Trash2, X } from 'lucide-react';
import type { ProjectStorage, ProjectStorageSnapshot } from '../../packages/editor/project-storage';
import {
  applicationMethodReferences,
  type ApplicationMethodReference,
} from '../../packages/editor/data';
import { refreshEditorDocument } from './refresh-document';
import { registry } from '../materials';
import { Button, Input, Textarea } from '../ui/primitives';
import { BrandLogo } from '../ui/BrandLogo';
import { CodeEditor } from '../ui/CodeEditor';
import { editorPagesPath } from './router';
import { executeApplicationMethod } from '../../packages/runtime/application-methods';
import { isJson, type ApplicationMethod } from '../../packages/schema/types';
import './page-management.css';

type MethodTestState =
  { status: 'idle' | 'running' | 'stale' } | { status: 'success' | 'error'; text: string };

function matchesMethod(
  method: Pick<ApplicationMethod, 'title' | 'description' | 'id'>,
  query: string,
) {
  return (
    !query ||
    [method.title, method.id, method.description ?? ''].some((value) =>
      value.toLocaleLowerCase().includes(query),
    )
  );
}

function MethodReferences({
  references,
  onOpenReference,
}: {
  references: ApplicationMethodReference[];
  onOpenReference?: (reference: ApplicationMethodReference) => void;
}) {
  return (
    <ul className="application-method-references" aria-label="已保存的调用位置">
      {references.map((reference) => {
        const { pageId, pageTitle, path, callId } = reference;
        const label = (
          <>
            {pageTitle} <code>({pageId})</code> ·{' '}
            {path.replace(/\/(\d+)$/, (_, index: string) => ` · 动作 ${Number(index) + 1}`)}
          </>
        );
        return (
          <li key={JSON.stringify([pageId, callId])}>
            {onOpenReference ? (
              <button type="button" onClick={() => onOpenReference(reference)}>
                {label}
              </button>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ApplicationSettingsHome({
  project,
  projectSnapshot,
  onBack,
  onRenameApplicationId,
  embedded = false,
  methodsOnly = false,
  onOpenReference,
  directMethod,
  onDirectMethodClosed,
}: {
  project: ProjectStorage;
  projectSnapshot: ProjectStorageSnapshot;
  onBack: () => void;
  onRenameApplicationId?: (appId: string) => void;
  embedded?: boolean;
  methodsOnly?: boolean;
  onOpenReference?: (reference: ApplicationMethodReference) => void;
  directMethod?: {
    method?: ApplicationMethod;
    trigger: HTMLButtonElement;
    onCreated?: (method: ApplicationMethod) => void;
  };
  onDirectMethodClosed?: () => void;
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
  const [title, setTitle] = useState(snapshot.plan.schema.title);
  const [applicationId, setApplicationId] = useState(snapshot.plan.schema.id);
  const [error, setError] = useState<string | null>(null);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(
    snapshot.plan.schema.methods?.[0]?.id ?? null,
  );
  const [methodEditor, setMethodEditor] = useState<{
    document: typeof document;
    method?: ApplicationMethod;
  } | null>(() => (directMethod ? { document, method: directMethod.method } : null));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [methodError, setMethodError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const newMethodButton = useRef<HTMLButtonElement>(null);
  const methodSearch = useRef<HTMLInputElement>(null);
  const methodReturnFocus = useRef<HTMLButtonElement | HTMLInputElement | null>(null);
  const methodTest = useRef<object | null>(null);
  const [methodQuery, setMethodQuery] = useState('');
  const normalizedMethodQuery = methodQuery.trim().toLocaleLowerCase();
  const [methodTitle, setMethodTitle] = useState(directMethod?.method?.title ?? '');
  const [methodDescription, setMethodDescription] = useState(
    directMethod?.method?.description ?? '',
  );
  const [methodSource, setMethodSource] = useState(
    directMethod?.method?.source ?? 'return input.payload;',
  );
  const [methodInputType, setMethodInputType] = useState<
    NonNullable<ApplicationMethod['inputType']>
  >(directMethod?.method?.inputType ?? 'json');
  const [methodOutputType, setMethodOutputType] = useState<
    NonNullable<ApplicationMethod['outputType']>
  >(directMethod?.method?.outputType ?? 'json');
  const [methodPayload, setMethodPayload] = useState('{}');
  const [methodTestState, setMethodTestState] = useState<MethodTestState>({ status: 'idle' });
  const application = snapshot.plan.schema;
  const methods = application.methods ?? [];
  const visibleMethods = methods.filter((method) => matchesMethod(method, normalizedMethodQuery));
  const selectedMethod = visibleMethods.find((method) => method.id === selectedMethodId);
  const referencedMethodId = methodEditor?.method?.id ?? selectedMethod?.id;
  const references = useMemo(
    () => (referencedMethodId ? applicationMethodReferences(application, referencedMethodId) : []),
    [application, referencedMethodId],
  );
  const saveTitle = (event: FormEvent) => {
    event.preventDefault();
    try {
      document.renameApplication(title);
      setTitle(document.getSnapshot().plan.schema.title);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const openMethod = (method?: ApplicationMethod) => {
    if (method) setSelectedMethodId(method.id);
    methodReturnFocus.current = null;
    methodTest.current = null;
    setMethodTitle(method?.title ?? '');
    setMethodDescription(method?.description ?? '');
    setMethodSource(method?.source ?? 'return input.payload;');
    setMethodInputType(method?.inputType ?? 'json');
    setMethodOutputType(method?.outputType ?? 'json');
    setMethodPayload('{}');
    setMethodError(null);
    setMethodTestState({ status: 'idle' });
    setMethodEditor({ document, method });
  };
  const closeMethod = () => {
    methodTest.current = null;
    setDeleteOpen(false);
    setMethodEditor(null);
  };
  const methodDraft = {
    title: methodTitle,
    description: methodDescription,
    source: methodSource,
    inputType: methodInputType,
    outputType: methodOutputType,
  };
  const verifyMethod = () => {
    if (methodEditor?.document !== document) throw new Error('应用已变化，请重新打开方法。');
    const original = methodEditor.method;
    if (!original) return;
    const latest = document
      .getSnapshot()
      .plan.schema.methods?.find((method) => method.id === original.id);
    if (JSON.stringify(latest) !== JSON.stringify(original))
      throw new Error('方法已变化，请关闭后重新打开。');
  };
  const saveMethod = () => {
    if (!methodEditor) return;
    try {
      verifyMethod();
      if (methodEditor.method) {
        document.updateApplicationMethod(methodEditor.method.id, methodDraft);
        if (!matchesMethod({ ...methodDraft, id: methodEditor.method.id }, normalizedMethodQuery))
          methodReturnFocus.current = methodSearch.current;
      } else {
        const id = document.createApplicationMethod(methodDraft);
        directMethod?.onCreated?.({ ...methodDraft, id });
        setSelectedMethodId(id);
        if (!matchesMethod({ ...methodDraft, id }, normalizedMethodQuery)) setMethodQuery('');
      }
      closeMethod();
    } catch (reason) {
      setMethodError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const deleteMethod = () => {
    const method = methodEditor?.method;
    if (!deleteOpen || !method) return;
    try {
      verifyMethod();
      const nextId =
        application.methods?.find((candidate) => candidate.id !== method.id)?.id ?? null;
      document.removeApplicationMethod(method.id);
      setSelectedMethodId(nextId);
      methodReturnFocus.current = newMethodButton.current;
      closeMethod();
    } catch (reason) {
      setDeleteError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const invalidateMethodTest = () => {
    methodTest.current = null;
    setMethodTestState((current) =>
      current.status === 'idle' || current.status === 'stale' ? current : { status: 'stale' },
    );
  };
  const testMethod = async () => {
    if (!methodEditor || methodTest.current) return;
    const attempt = {};
    methodTest.current = attempt;
    setMethodTestState({ status: 'running' });
    try {
      const payload = JSON.parse(methodPayload) as unknown;
      if (!isJson(payload)) throw new Error('测试输入必须是 JSON');
      const result = await executeApplicationMethod(
        {
          ...methodDraft,
          id: methodEditor.method?.id ?? 'draft',
        },
        payload,
        {
          signal: new AbortController().signal,
          getState: () => ({}),
          setState: () => {},
          setFormValues: () => {},
          resetForm: () => {},
          submitForm: async () => {},
          executeDataSource: async () => {
            throw new Error('方法测试暂不执行页面数据源');
          },
          emitEffect: () => {},
        },
      );
      if (methodTest.current === attempt)
        setMethodTestState({ status: 'success', text: JSON.stringify(result, null, 2) });
    } catch (reason) {
      if (methodTest.current === attempt)
        setMethodTestState({
          status: 'error',
          text: reason instanceof Error ? reason.message : String(reason),
        });
    } finally {
      if (methodTest.current === attempt) methodTest.current = null;
    }
  };
  const settings = !directMethod && (
    <main className={embedded ? 'application-settings-embedded' : 'page-management-home'}>
      <header className={`page-management-header ${embedded ? 'embedded-header' : ''}`}>
        {!embedded && (
          <div className="brand">
            <BrandLogo className="brand-logo" />
          </div>
        )}
        <div>
          <h1>{methodsOnly ? '应用自定义方法' : '应用设置'}</h1>
          {!methodsOnly && <p>配置应用身份与默认打开页面。</p>}
        </div>
        {embedded ? (
          <Dialog.Close
            className="ui-button embedded-close"
            aria-label={methodsOnly ? '关闭应用自定义方法' : '关闭应用设置'}
          >
            <X size={15} />
            关闭
          </Dialog.Close>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                window.history.pushState({}, '', editorPagesPath());
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
            >
              <PanelsTopLeft size={15} />
              应用页面
            </Button>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft size={15} />
              返回搭建
            </Button>
          </>
        )}
      </header>
      {projectSnapshot.error && (
        <div className="project-storage-notice" role="alert">
          {projectSnapshot.error}
        </div>
      )}
      <section
        className={`application-settings-content${embedded ? ' workbench-dialog-scroll' : ''}`}
      >
        {!methodsOnly && (
          <>
            <div className="application-settings-heading">
              <div>
                <h2>应用基本信息</h2>
                <p>应用是可独立保存与运行的整体，页面是应用内可单独访问的界面。</p>
              </div>
              <span className="application-id">ID：{application.id}</span>
            </div>
            <form className="application-settings-form" onSubmit={saveTitle}>
              <label htmlFor="application-title">应用名称</label>
              <div className="application-title-input">
                <Input
                  id="application-title"
                  value={title}
                  aria-invalid={!!error}
                  aria-describedby={error ? 'application-title-error' : undefined}
                  onChange={(event) => setTitle(event.target.value)}
                />
                <Button type="submit">保存名称</Button>
              </div>
              {error && (
                <p id="application-title-error" className="application-settings-error" role="alert">
                  {error}
                </p>
              )}
            </form>
            {onRenameApplicationId && (
              <form
                className="application-id-setting"
                onSubmit={(event) => {
                  event.preventDefault();
                  try {
                    onRenameApplicationId(applicationId);
                    setError(null);
                  } catch (reason) {
                    setError(reason instanceof Error ? reason.message : String(reason));
                  }
                }}
              >
                <label htmlFor="application-id">应用 ID</label>
                <div className="application-title-input">
                  <Input
                    id="application-id"
                    value={applicationId}
                    onChange={(event) => setApplicationId(event.target.value)}
                  />
                  <Button type="submit" variant="ghost">
                    修改 ID
                  </Button>
                </div>
                <p>用于应用运行地址和目录识别；修改后原项目存储会保留作备份。</p>
              </form>
            )}
            <div className="application-entry-setting">
              <label htmlFor="application-entry-page">入口页面</label>
              <select
                id="application-entry-page"
                value={application.entryPageId}
                onChange={(event) => document.setEntryPage(event.target.value)}
              >
                {application.pages.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title}
                  </option>
                ))}
              </select>
              <p>用户打开应用时，默认进入此页面。应用始终可以包含多个页面。</p>
            </div>
          </>
        )}
        <section
          className={`application-methods-setting${methodsOnly ? ' application-methods-only' : ''}`}
          aria-label="应用自定义方法"
        >
          <header className="application-methods-heading">
            <div>
              {!methodsOnly && (
                <h2>
                  <Code2 size={16} /> 自定义方法
                </h2>
              )}
              <p>在这里编写可复用 JavaScript，再从页面事件或进入动作中调用。</p>
            </div>
            <Button ref={newMethodButton} variant="ghost" onClick={() => openMethod()}>
              <Plus size={15} />
              新建方法
            </Button>
          </header>
          <div className="page-search application-method-search">
            <Search size={13} aria-hidden="true" />
            <Input
              ref={methodSearch}
              aria-label="搜索自定义方法"
              placeholder="搜索名称、ID 或说明"
              value={methodQuery}
              onChange={(event) => setMethodQuery(event.target.value)}
            />
            <span className="page-search-meta" role="status" aria-atomic="true">
              <span className="sr-only">匹配方法数：</span>
              {visibleMethods.length}/{methods.length}
            </span>
            {methodQuery && (
              <Button
                type="button"
                variant="ghost"
                className="page-search-clear"
                aria-label="清除方法搜索"
                onClick={() => {
                  setMethodQuery('');
                  methodSearch.current?.focus();
                }}
              >
                <X size={13} aria-hidden="true" />
              </Button>
            )}
          </div>
          <div className="application-methods-layout">
            <nav className="application-method-list" aria-label="方法列表">
              {visibleMethods.map((method) => (
                <button
                  type="button"
                  key={method.id}
                  aria-current={selectedMethod?.id === method.id ? 'true' : undefined}
                  onClick={() => openMethod(method)}
                >
                  <strong>{method.title}</strong>
                  <code>{method.id}</code>
                </button>
              ))}
              {!visibleMethods.length && (
                <p>{methods.length ? '没有匹配的方法。' : '还没有自定义方法。'}</p>
              )}
            </nav>
            {selectedMethod ? (
              <div className="application-method-summary">
                <strong>{selectedMethod.title}</strong>
                <code>{selectedMethod.id}</code>
                <span>{selectedMethod.description || '暂无方法说明'}</span>
                {references.length ? (
                  <details>
                    <summary>已保存的调用 · {references.length} 处</summary>
                    <MethodReferences references={references} onOpenReference={onOpenReference} />
                  </details>
                ) : (
                  <span>暂无已保存的调用</span>
                )}
                <Button variant="ghost" onClick={() => openMethod(selectedMethod)}>
                  编辑方法
                </Button>
              </div>
            ) : null}
          </div>
        </section>
        {!methodsOnly && (
          <div className="application-settings-footer">
            <span>当前应用包含 {application.pages.length} 个页面</span>
          </div>
        )}
      </section>
    </main>
  );
  return (
    <>
      {settings}
      <Dialog.Root
        open={methodEditor !== null}
        onOpenChange={(open) => !open && closeMethod()}
        onOpenChangeComplete={(open) => {
          if (!open) onDirectMethodClosed?.();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup
            className="material-modal application-method-dialog"
            finalFocus={() => {
              const trigger = methodReturnFocus.current ?? directMethod?.trigger;
              return trigger?.isConnected && !trigger.disabled ? trigger : true;
            }}
          >
            <Dialog.Title className="application-method-dialog-title">
              {methodEditor?.method?.title ?? '新建自定义方法'}
            </Dialog.Title>
            <Dialog.Description className="application-method-dialog-description">
              {directMethod?.onCreated
                ? '保存方法后会添加到当前动作草稿，请配置参数并保存动作。'
                : '配置方法信息、JavaScript 实现和测试输入。'}
            </Dialog.Description>
            {methodEditor ? (
              <>
                <div className="workbench-dialog-scroll application-method-scroll">
                  <div className="application-method-editor">
                    <div className="application-method-fields">
                      <label>
                        方法名称
                        <Input
                          value={methodTitle}
                          onChange={(event) => setMethodTitle(event.target.value)}
                        />
                      </label>
                      <label>
                        输入 payload 类型
                        <select
                          value={methodInputType}
                          onChange={(event) => {
                            setMethodInputType(event.target.value as typeof methodInputType);
                            invalidateMethodTest();
                          }}
                        >
                          {['json', 'object', 'array', 'string', 'number', 'boolean', 'null'].map(
                            (type) => (
                              <option key={type}>{type}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        返回值类型
                        <select
                          value={methodOutputType}
                          onChange={(event) => {
                            setMethodOutputType(event.target.value as typeof methodOutputType);
                            invalidateMethodTest();
                          }}
                        >
                          {['json', 'object', 'array', 'string', 'number', 'boolean', 'null'].map(
                            (type) => (
                              <option key={type}>{type}</option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>
                    <label className="application-method-description">
                      方法说明
                      <Textarea
                        value={methodDescription}
                        rows={2}
                        placeholder="描述用途、输入约定或副作用"
                        onChange={(event) => setMethodDescription(event.target.value)}
                      />
                    </label>
                    <CodeEditor
                      label="方法 JavaScript 代码"
                      language="javascript"
                      height={300}
                      value={methodSource}
                      onChange={(value) => {
                        setMethodSource(value);
                        invalidateMethodTest();
                      }}
                    />
                    <p className="application-method-help">
                      代码通过 <code>input.payload</code> 读取输入，通过 <code>context</code>{' '}
                      访问当前页面状态、表单和数据源；需返回匹配类型的 JSON
                      值。代码在当前窗口执行，不是安全沙箱，请仅运行可信代码。
                    </p>
                    <div className="application-method-test">
                      <strong>快速测试</strong>
                      <p className="editor-note">
                        使用空白页面状态试跑。表单操作和通知为模拟，数据源调用会报错。
                      </p>
                      <CodeEditor
                        label="测试 payload JSON"
                        language="json"
                        height={130}
                        value={methodPayload}
                        onChange={(value) => {
                          setMethodPayload(value);
                          invalidateMethodTest();
                        }}
                        expandable={false}
                      />
                      <Button
                        variant="ghost"
                        disabled={methodTestState.status === 'running'}
                        onClick={() => void testMethod()}
                      >
                        测试当前方法
                      </Button>
                      <div role="status" className="application-method-test-status">
                        {methodTestState.status === 'running' && '正在试跑…'}
                        {methodTestState.status === 'stale' && '测试内容已修改，请重新试跑。'}
                        {methodTestState.status === 'success' && '试跑成功'}
                      </div>
                      {methodTestState.status === 'error' && (
                        <p className="application-settings-error" role="alert">
                          {methodTestState.text}
                        </p>
                      )}
                      {methodTestState.status === 'success' && (
                        <pre className="application-method-result">{methodTestState.text}</pre>
                      )}
                    </div>
                  </div>
                </div>
                <div className="workbench-dialog-actions">
                  {methodError && (
                    <p role="alert" className="application-settings-error">
                      {methodError}
                    </p>
                  )}
                  <div className="application-method-actions">
                    <Dialog.Close className="ui-button">取消</Dialog.Close>
                    <Button onClick={saveMethod}>保存方法</Button>
                    {methodEditor.method && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteOpen(true);
                        }}
                      >
                        <Trash2 size={14} />
                        删除方法
                      </Button>
                    )}
                  </div>
                </div>
              </>
            ) : null}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {/* 删除确认弹窗独立于方法编辑弹窗：嵌套时 fixed 定位会相对外层 transform 容器而非视口。 */}
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup
            className="material-modal application-delete-dialog"
            initialFocus={cancelDelete}
            finalFocus={() => methodReturnFocus.current !== newMethodButton.current}
          >
            <Dialog.Title>删除方法？</Dialog.Title>
            <Dialog.Description>
              {references.length && methodEditor?.method
                ? `「${methodEditor.method.title}」仍有 ${references.length} 处已保存的调用。请先移除这些调用。`
                : methodEditor?.method
                  ? `将删除「${methodEditor.method.title}」。`
                  : ''}
            </Dialog.Description>
            {references.length > 0 && <MethodReferences references={references} />}
            {deleteError && (
              <p role="alert" className="application-settings-error">
                {deleteError}
              </p>
            )}
            <div className="application-delete-actions">
              <Dialog.Close ref={cancelDelete} className="ui-button">
                取消
              </Dialog.Close>
              <Button variant="danger" onClick={deleteMethod} disabled={references.length > 0}>
                确认删除
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
