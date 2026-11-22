import { bindingDraft, parseBinding, ValueInput, type BindingDraft } from './ValueEditor';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Dialog } from '@base-ui/react/dialog';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { nodeScopeNames } from '../../packages/editor/scope';
import type { ApplicationMethodReference } from '../../packages/editor/data';
import { applicationMethodActionId } from '../../packages/runtime/application-methods';
import type {
  ActionCall,
  ApplicationMethod,
  NodeSchema,
  PageSchema,
} from '../../packages/schema/types';
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { registry } from '../materials';
import { Button, Select, Tip } from '../ui/primitives';
import { DraftNotice, useDraft, useEditorSession, useSessionState } from './session';
import { errorText } from './errors';
import { useAuthorGuard } from './author-guard';
import { ExpressionContext } from './ExpressionContext';
import type { EventReferenceContext, EventReferenceOwner } from './EventReferencePaths';
import type { PageEntryReferenceContext, PageEntryReferenceOwner } from './PageEntryReferencePaths';
import { useDragDrop } from './DragDrop';

type CallDraft = {
  id: string;
  action: string;
  input: Record<string, BindingDraft>;
  resultTo: string;
};
function bindingSummary(binding: BindingDraft): string {
  switch (binding.kind) {
    case 'literal':
      return binding.text;
    case 'expression':
      return `{${binding.text}}`;
    case 'stateRef':
      return `状态 ${binding.stateId}`;
    case 'dataRef':
      return `${binding.sourceId}.${binding.path}`;
    case 'fieldRef':
      return `${binding.formId}.${binding.fieldId}`;
    case 'formValues':
      return `表单 ${binding.formId}`;
    default:
      return '';
  }
}
/** One-line overview for the compact action row; full editing moves into the dialog. */
function callSummary(call: CallDraft): string {
  const parts = Object.entries(call.input)
    .filter(([, binding]) => binding.kind !== 'unset')
    .map(([name, binding]) => `${name}=${bindingSummary(binding)}`);
  const result = call.resultTo ? ` → ${call.resultTo}` : '';
  return (parts.join('、') + result) || '未配置参数';
}
export type OpenApplicationMethods = (
  trigger: HTMLButtonElement,
  target?: { methodId: string } | { onCreated: (method: ApplicationMethod) => void },
) => void;
const actionLabels: Record<string, string> = {
  'app.navigate': '跳转应用页面',
  'state.set': '设置页面状态',
  'form.setValues': '回填表单',
  'form.reset': '重置表单',
  'form.submit': '提交表单',
  'ui.notify': '显示通知',
  'demo.saveRecord': '保存记录',
  'data.execute': '执行数据源',
};
const eventLabels: Record<string, string> = {
  onClick: '点击',
  onSubmit: '提交',
  onReset: '重置',
  onOpenChange: '打开状态变化',
  onConfirm: '确认',
  onChange: '输入变化',
  onValueChange: '值变化',
  onCheckedChange: '勾选变化',
  onBlur: '失焦',
  onSelectionChange: '选中行变化',
  onSortChange: '排序变化',
  onRowClick: '点击行',
  onPaginationChange: '分页变化',
};
export function ActionChainEditor({
  page,
  existing,
  draftKey,
  source = JSON.stringify(existing),
  scopes = [],
  pageScope = false,
  authoringAllowed = true,
  saveLabel = '保存事件',
  canSave,
  onSave,
  eventReference,
  pageReference,
  focusReference,
  onOpenMethods,
}: {
  page: PageSchema;
  existing: ActionCall[];
  draftKey: string;
  source?: string;
  scopes?: string[];
  pageScope?: boolean;
  authoringAllowed?: boolean;
  saveLabel?: string;
  canSave?: () => boolean;
  onSave: (calls: ActionCall[]) => unknown;
  eventReference?: EventReferenceContext;
  pageReference?: PageEntryReferenceContext;
  focusReference?: ApplicationMethodReference;
  onOpenMethods?: OpenApplicationMethods;
}) {
  const drag = useDragDrop();
  const actionRegistry =
    pageReference?.snapshot.plan.registry ?? eventReference?.snapshot.plan.registry ?? registry;
  const applicationDefinition =
    pageReference?.snapshot.plan.schema ?? eventReference?.snapshot.plan.schema;
  const applicationMethods = new Map(
    (applicationDefinition?.methods ?? []).map((method) => [
      applicationMethodActionId(method.id),
      method,
    ]),
  );
  const actionLabel = (id: string) => applicationMethods.get(id)?.title ?? actionLabels[id] ?? id;
  const actionContract = (id: string) =>
    Object.hasOwn(actionRegistry.actions, id) ? actionRegistry.actions[id] : undefined;
  const actionIds = Object.keys(actionRegistry.actions);
  const standardActionIds = actionIds.filter((id) => !applicationMethods.has(id));
  const methodActionIds = actionIds.filter((id) => applicationMethods.has(id));
  const renderActionOption = (id: string) => (
    <option key={id} value={id}>
      {actionLabel(id)} · {id}
    </option>
  );
  const renderMethodDescription = (id: string) => {
    const description = applicationMethods.get(id)?.description?.trim();
    return description ? (
      <p className="editor-note action-method-description">{description}</p>
    ) : null;
  };
  const initial = {
    calls: existing.map((call): CallDraft => ({
      id: call.id,
      action: call.action,
      resultTo: call.resultTo ?? '',
      input: Object.fromEntries(
        Object.entries(actionRegistry.actions[call.action].input).map(([name, field]) => [
          name,
          bindingDraft(call.input[name], field),
        ]),
      ),
    })),
    error: '',
  };
  const { drafts } = useEditorSession();
  const [draft, setDraft, status] = useDraft(draftKey, source, initial);
  // Yidao-style authoring: the list shows compact rows, parameters edit in a dialog.
  const [editingCall, setEditingCall] = useState<number | null>(null);
  const referenceFocus = useRef<HTMLElement>(null);
  const focusedCall = draft.calls.find(
    (call) => call.id === focusReference?.callId && call.action === focusReference.actionId,
  );
  useEffect(() => {
    if (!focusReference || !authoringAllowed) return;
    // Opening the dialog both surfaces the parameters and focuses them; the
    // compact row still scrolls into view once the dialog closes.
    setEditingCall((current) => {
      if (current !== null) return current;
      return draft.calls.findIndex(
        (call) => call.id === focusReference.callId && call.action === focusReference.actionId,
      );
    });
    const frame = requestAnimationFrame(() => {
      const target = referenceFocus.current;
      target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusReference, authoringAllowed]);
  // useDraft has already observed this exact entry in the same caller render.
  // Never perform this observation from a retained helper callback.
  const referenceEntry =
    eventReference && !pageScope ? drafts.read(draftKey, source, initial) : undefined;
  const savedEventSource =
    eventReference && !pageScope ? JSON.stringify(eventReference.savedActions ?? []) : undefined;
  const [, requestReferenceOwnerRender] = useReducer((revision: number) => revision + 1, 0);
  const referenceCurrent = useRef({
    page,
    draftKey,
    source,
    eventReference,
    pageScope,
    referenceEntry,
    draft,
    authoringAllowed,
    status,
    savedEventSource,
  });
  referenceCurrent.current = {
    page,
    draftKey,
    source,
    eventReference,
    pageScope,
    referenceEntry,
    draft,
    authoringAllowed,
    status,
    savedEventSource,
  };
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const pageReferenceEnabled = pageScope && !!pageReference && !eventReference;
  // Only this genuine useDraft render can acknowledge the complete page Entry.
  const pageEntry = pageReferenceEnabled ? drafts.read(draftKey, source, initial) : undefined;
  const pageDrag = useDragDrop();
  const pageEpoch = useRef(0);
  const pageOwnerContext = {
    enabled: pageReferenceEnabled,
    document: pageReference?.document,
    store: drafts,
    plan: pageReference?.snapshot.plan,
    selection: pageReference?.snapshot.selection,
    pageId: pageReference?.pageId,
    savedActions: pageReference?.savedActions,
    pageSource: pageReference?.pageSource,
    guard: pageReference?.canReference,
    page,
    draftKey,
    source,
    entry: pageEntry,
    entrySource: pageEntry?.source,
    entryDirty: pageEntry?.dirty,
    draftText: pageReferenceEnabled ? JSON.stringify(draft) : undefined,
    draft,
    authoringAllowed,
    dragEnabled: pageDrag?.enabled !== false,
    interacting: !!pageDrag?.isInteracting,
    code: !!page.code?.enabled,
  };
  const samePageContext = (a: typeof pageOwnerContext, b: typeof pageOwnerContext) =>
    (Object.keys(a) as (keyof typeof a)[]).every((key) => a[key] === b[key]);
  const pageGeneration = useRef({
    context: pageOwnerContext,
    epoch: pageEpoch.current,
    active: true,
  });
  if (
    !pageGeneration.current.active ||
    pageGeneration.current.epoch !== pageEpoch.current ||
    !samePageContext(pageGeneration.current.context, pageOwnerContext)
  ) {
    pageGeneration.current.active = false;
    pageGeneration.current = { context: pageOwnerContext, epoch: pageEpoch.current, active: true };
  }
  const pageOwnerGeneration = pageGeneration.current;
  const pageCurrent = useRef({ context: pageOwnerContext, pageDrag, pageReference, status });
  pageCurrent.current = { context: pageOwnerContext, pageDrag, pageReference, status };
  useLayoutEffect(() => {
    if (!pageReferenceEnabled || !pageReference) return;
    // StrictEffects requests a fresh parent render; it never revives old callbacks.
    if (!pageGeneration.current.active) requestReferenceOwnerRender();
    const invalidate = () => {
      pageEpoch.current++;
      pageGeneration.current.active = false;
      requestReferenceOwnerRender();
    };
    const stopDocument = pageReference.document.subscribe(invalidate);
    const stopDraft = drafts.subscribe(invalidate);
    return () => {
      pageGeneration.current.active = false;
      stopDocument();
      stopDraft();
    };
  }, [pageReferenceEnabled, pageReference?.document, drafts]);
  const requestPageReferenceRender = () => {
    if (!active.current || pageGeneration.current !== pageOwnerGeneration) return;
    pageOwnerGeneration.active = false;
    requestReferenceOwnerRender();
  };
  const refusePageReference = () => {
    // Retire this captured capability only; a newer generation is never touched.
    pageOwnerGeneration.active = false;
    return false;
  };
  const canReferencePage = () => {
    const current = pageCurrent.current;
    if (
      !active.current ||
      !pageReferenceEnabled ||
      !pageReference ||
      !pageEntry ||
      !pageOwnerGeneration.active ||
      pageGeneration.current !== pageOwnerGeneration ||
      pageEpoch.current !== pageOwnerGeneration.epoch ||
      !samePageContext(pageOwnerContext, current.context) ||
      current.status.stale ||
      pageEntry.value !== draft ||
      pageEntry.source !== source ||
      pageEntry.source !== pageOwnerContext.entrySource ||
      pageEntry.dirty !== pageOwnerContext.entryDirty ||
      JSON.stringify(draft) !== pageOwnerContext.draftText ||
      !authoringAllowed ||
      !current.context.authoringAllowed ||
      source !== pageReference.pageSource ||
      draftKey !== `page-enter:${pageReference.pageId}` ||
      current.pageDrag?.enabled === false ||
      current.pageDrag?.isInteracting
    )
      return refusePageReference();
    const actual = pageReference.document.getSnapshot();
    const live = actual.plan.pages.get(pageReference.pageId)?.schema;
    if (
      actual.plan !== pageReference.snapshot.plan ||
      actual.selection !== pageReference.snapshot.selection ||
      actual.selection.pageId !== pageReference.pageId ||
      live !== page ||
      live.code?.enabled ||
      live.onEnter !== pageReference.savedActions ||
      JSON.stringify(live) !== pageReference.pageSource
    )
      return refusePageReference();
    try {
      if (pageReference.canReference() !== true) return refusePageReference();
      return true;
    } catch {
      return refusePageReference();
    }
  };
  const latest = useRef({ authoringAllowed, draft, status, onSave, canSave, setDraft });
  latest.current = { authoringAllowed, draft, status, onSave, canSave, setDraft };
  const hasUnavailableAction = draft.calls.some((call) => !actionContract(call.action));
  const canAuthor = () => active.current && latest.current.authoringAllowed;
  const update = (index: number, patch: Partial<CallDraft>) => {
    if (!canAuthor()) return;
    setDraft((d) => ({
      ...d,
      error: '',
      calls: d.calls.map((call, i) => (i === index ? { ...call, ...patch } : call)),
    }));
  };
  const add = () => {
    if (!canAuthor()) return;
    // Uncommitted drafts on other nodes/events also own their identity.
    const id = `action-${crypto.randomUUID()}`;
    const action = 'state.set';
    setDraft((d) => ({
      ...d,
      error: '',
      calls: [
        ...d.calls,
        {
          id,
          action,
          resultTo: '',
          input: Object.fromEntries(
            Object.entries(actionRegistry.actions[action].input).map(([name, field]) => [
              name,
              bindingDraft(undefined, field),
            ]),
          ),
        },
      ],
    }));
    setEditingCall(draft.calls.length);
  };
  const appendMethod = (method: ApplicationMethod) => {
    if (!canAuthor()) return;
    const call: CallDraft = {
      id: `action-${crypto.randomUUID()}`,
      action: applicationMethodActionId(method.id),
      input: {
        payload: bindingDraft(undefined, { type: method.inputType ?? 'json', required: true }),
      },
      resultTo: '',
    };
    latest.current.setDraft((current) => ({
      ...current,
      error: '',
      calls: [...current.calls, call],
    }));
    setEditingCall(latest.current.draft.calls.length);
  };
  const save = () => {
    const current = latest.current;
    if (!canAuthor() || current.status.stale) return;
    try {
      if (current.canSave?.() === false) return;
      const calls: ActionCall[] = current.draft.calls.map((call) => {
        const contract = actionContract(call.action);
        if (!contract) throw new Error(`动作 ${call.action} 已不可用，请替换或移除后再保存。`);
        return {
          id: call.id,
          action: call.action,
          input: Object.fromEntries(
            Object.entries(contract.input).flatMap(([name, field]) => {
              try {
                const value = parseBinding(call.input[name], field);
                return value ? [[name, value]] : [];
              } catch (error) {
                throw new Error(`${call.action} / ${name}：${(error as Error).message}`);
              }
            }),
          ),
          ...(call.resultTo ? { resultTo: call.resultTo } : {}),
        };
      });
      current.onSave(calls);
      current.status.reset();
    } catch (error) {
      setDraft((d) => ({ ...d, error: errorText(error) }));
    }
  };
  // Full parameter editing for one call. Rendered inside the config dialog;
  // the compact list row only shows name and summary.
  const renderCallEditor = (call: CallDraft, index: number) => (
    <>
      <Select
        aria-label={`动作 ${index + 1} 类型`}
        value={call.action}
        onValueChange={(action) =>
          update(index, {
            action,
            resultTo: '',
            input: Object.fromEntries(
              Object.entries(actionRegistry.actions[action].input).map(([name, field]) => [
                name,
                action === 'app.navigate' && name === 'pageId'
                  ? bindingDraft(
                      {
                        kind: 'literal',
                        value: applicationDefinition?.entryPageId ?? page.id,
                      },
                      field,
                    )
                  : action === 'app.navigate' && name === 'replace'
                    ? bindingDraft({ kind: 'literal', value: false }, field)
                    : bindingDraft(undefined, field),
              ]),
            ),
          })
        }
      >
        {!actionContract(call.action) && (
          <option value={call.action} disabled>
            已不可用 · {call.action}
          </option>
        )}
        {methodActionIds.length > 0 ? (
          <>
            <optgroup label="常用动作">{standardActionIds.map(renderActionOption)}</optgroup>
            <optgroup label="应用自定义方法">
              {methodActionIds.map(renderActionOption)}
            </optgroup>
          </>
        ) : (
          standardActionIds.map(renderActionOption)
        )}
      </Select>
      {renderMethodDescription(call.action)}
      {onOpenMethods && applicationMethods.has(call.action) && (
        <Button
          type="button"
          variant="ghost"
          className="page-logic-methods-button"
          disabled={!!drag?.isInteracting || drag?.enabled === false}
          onClick={(event) => {
            const method = applicationMethods.get(call.action);
            if (method && canAuthor())
              onOpenMethods(event.currentTarget, { methodId: method.id });
          }}
        >
          编辑 JS
        </Button>
      )}
      {!actionContract(call.action) && (
        <p className="editor-note" role="status">
          此动作已不可用。请选择其他动作，或移除此项后再保存。
        </p>
      )}
      {Object.entries(actionContract(call.action)?.input ?? {}).map(([name, field]) => {
        const callId = call.id;
        const action = call.action;
        const binding = call.input[name];
        const referenceOwner: EventReferenceOwner | undefined =
          eventReference && !pageScope && referenceEntry
            ? {
                ...eventReference,
                draftKey,
                eventSource: source,
                entryIdentity: referenceEntry,
                draftIdentity: draft,
                callIdentity: call,
                index,
                callId,
                action,
                parameter: name,
                subscribeDraft: drafts.subscribe,
                requestCallerRender: requestReferenceOwnerRender,
                canChoose: () => {
                  const current = referenceCurrent.current;
                  const context = current.eventReference;
                  return (
                    active.current &&
                    authoringAllowed &&
                    current.authoringAllowed &&
                    !pageScope &&
                    !current.pageScope &&
                    !!context &&
                    context.document === eventReference.document &&
                    context.snapshot.plan === eventReference.snapshot.plan &&
                    context.snapshot.selection === eventReference.snapshot.selection &&
                    context.nodeId === eventReference.nodeId &&
                    context.eventName === eventReference.eventName &&
                    context.savedActions === eventReference.savedActions &&
                    current.page === page &&
                    current.draftKey === draftKey &&
                    current.source === source &&
                    current.savedEventSource === savedEventSource &&
                    source === savedEventSource &&
                    current.referenceEntry === referenceEntry &&
                    referenceEntry.value === draft &&
                    current.draft === draft &&
                    !current.status.stale &&
                    draft.calls[index] === call &&
                    call.id === callId &&
                    call.action === action &&
                    call.input[name] === binding &&
                    canSave?.() === true
                  );
                },
              }
            : undefined;
        const bindingKind = binding?.kind;
        const bindingSourceId = binding?.sourceId;
        const bindingPath = binding?.path;
        const boundSource = page.dataSources?.find((item) => item.id === bindingSourceId);
        const canChoosePageParameter = () => {
          const allowed =
            canReferencePage() &&
            draft.calls[index] === call &&
            call.id === callId &&
            call.action === action &&
            call.input[name] === binding &&
            binding.kind === bindingKind &&
            binding.sourceId === bindingSourceId &&
            binding.path === bindingPath &&
            bindingKind === 'dataRef' &&
            !!boundSource &&
            page.dataSources?.find((item) => item.id === bindingSourceId) === boundSource &&
            actionRegistry.actions[action]?.input[name] !== undefined;
          if (!allowed) return refusePageReference();
          return true;
        };
        const pageReferenceOwner: PageEntryReferenceOwner | undefined =
          pageReferenceEnabled && pageReference && pageEntry
            ? {
                ...pageReference,
                draftKey,
                entryIdentity: pageEntry,
                bindingIdentity: binding,
                parentGeneration: pageOwnerGeneration,
                authoringAllowed,
                draftIdentity: draft,
                callIdentity: call,
                index,
                callId,
                action,
                parameter: name,
                subscribeDraft: drafts.subscribe,
                requestCallerRender: requestPageReferenceRender,
                canChoose: canChoosePageParameter,
                choosePath: (path) => {
                  if (!canChoosePageParameter()) {
                    requestPageReferenceRender();
                    return;
                  }
                  const calls = [...draft.calls];
                  calls[index] = {
                    ...call,
                    input: { ...call.input, [name]: { ...binding, path } },
                  };
                  setDraft({ ...draft, calls, error: '' });
                },
              }
            : undefined;
        return action === 'app.navigate' &&
          name === 'pageId' &&
          (binding.kind === 'literal' || binding.kind === 'unset') ? (
          <label className="action-parameter" key={name}>
            <span className="action-parameter-label">
              <span>目标页面 *</span>
              <code>string</code>
            </span>
            <Select
              aria-label="目标页面"
              value={binding.kind === 'literal' ? binding.text : ''}
              onValueChange={(pageId) =>
                update(index, {
                  input: {
                    ...call.input,
                    [name]: bindingDraft({ kind: 'literal', value: pageId }, field),
                  },
                })
              }
            >
              {(applicationDefinition?.pages ?? [page]).map((target) => (
                <option key={target.id} value={target.id}>
                  {target.title} · {target.id}
                </option>
              ))}
            </Select>
          </label>
        ) : (
          <ValueInput
            key={name}
            label={name}
            field={field}
            draft={call.input[name]}
            page={page}
            pageScope={pageScope}
            eventReferenceOwner={referenceOwner}
            pageReferenceOwner={pageReferenceOwner}
            onChange={(value) => update(index, { input: { ...call.input, [name]: value } })}
          />
        );
      })}
      {actionContract(call.action)?.output && (
        <label className="action-parameter">
          返回值写入
          <Select
            aria-label={`动作 ${index + 1} 结果状态`}
            value={call.resultTo}
            onValueChange={(resultTo) => update(index, { resultTo })}
          >
            <option value="">不保存返回值</option>
            {page.state
              .filter(
                (state) =>
                  actionRegistry.actions[call.action].output === 'json' ||
                  actionRegistry.actions[call.action].output === state.type,
              )
              .map((state) => (
                <option key={state.id} value={state.id}>
                  {state.id}
                </option>
              ))}
          </Select>
        </label>
      )}
    </>
  );
  return (
    <>
      <p className="editor-note">动作按顺序执行，失败后停止。</p>
      {pageScope ? (
        <p className="editor-note">
          可用表达式：state / forms / sources；使用本页状态、表单和数据源。
        </p>
      ) : (
        <ExpressionContext scopeNames={scopes} eventAllowed={true} />
      )}
      <DraftNotice
        {...status}
        reset={() => {
          if (canAuthor()) latest.current.status.reset();
        }}
        rebase={() => {
          if (canAuthor()) latest.current.status.rebase();
        }}
      />
      {focusReference && !focusedCall && (
        <div
          ref={(element) => {
            referenceFocus.current = element;
          }}
          className="editor-note"
          role="status"
          tabIndex={-1}
        >
          此调用已在草稿中移除或替换。当前草稿已保留。
        </div>
      )}
        {draft.calls.map((call, index) => (
          <section
            ref={call === focusedCall ? referenceFocus : undefined}
            tabIndex={call === focusedCall ? -1 : undefined}
            className="action-card"
            aria-label={`动作 ${index + 1}`}
            key={call.id}
          >
            <header>
              <button
                type="button"
                className="action-card-open"
                aria-label={`打开动作 ${index + 1} 配置`}
                onClick={() => {
                  // Opening the dialog is a view action; actual editing stays
                  // gated by the disabled fieldset and control-level guards.
                  setEditingCall(index);
                }}
              >
                <strong>
                  {index + 1}. {actionLabel(call.action)}
                  {!actionContract(call.action) && (
                    <span className="action-card-badge">已不可用</span>
                  )}
                </strong>
                <span className="action-card-summary">{callSummary(call)}</span>
              </button>
              <div className="action-card-tools">
                {[
                  { label: '上移动作', Icon: ArrowUp, offset: -1 },
                  { label: '下移动作', Icon: ArrowDown, offset: 1 },
                ].map(({ label, Icon, offset }) => (
                  <Tip key={label} content={label}>
                    <Button
                      className="icon-button"
                      aria-label={`${label} ${index + 1}`}
                      disabled={index + offset < 0 || index + offset >= draft.calls.length}
                      onClick={() => {
                        if (!canAuthor()) return;
                        setEditingCall(null);
                        setDraft((d) => {
                          const calls = [...d.calls];
                          [calls[index], calls[index + offset]] = [
                            calls[index + offset],
                            calls[index],
                          ];
                          return { ...d, calls, error: '' };
                        });
                      }}
                    >
                      <Icon size={13} />
                    </Button>
                  </Tip>
                ))}
                <Tip content="编辑动作">
                  <Button
                    className="icon-button"
                    aria-label={`编辑动作 ${index + 1}`}
                    onClick={() => {
                      setEditingCall(index);
                    }}
                  >
                    <Pencil size={13} />
                  </Button>
                </Tip>
                <Tip content="删除动作">
                  <Button
                    className="icon-button"
                    aria-label={`删除动作 ${index + 1}`}
                    onClick={() => {
                      if (!canAuthor()) return;
                      setEditingCall(null);
                      setDraft((d) => ({
                        ...d,
                        error: '',
                        calls: d.calls.filter((_, i) => i !== index),
                      }));
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </Tip>
              </div>
            </header>
          </section>
        ))}
        {!draft.calls.length && (
          <p className="editor-note">
            {pageScope ? '尚未配置页面进入动作。' : '此事件尚未配置动作。'}
          </p>
        )}
        {draft.error && (
          <p role="alert" className="field-error action-error">
            {draft.error}
          </p>
        )}
        <div className="action-panel-footer">
          <div className="action-panel-footer-group">
            <Button disabled={!authoringAllowed} onClick={add}>
              <Plus size={13} />
              添加动作
            </Button>
            {onOpenMethods && authoringAllowed && (
              <Button
                type="button"
                variant="ghost"
                disabled={!!drag?.isInteracting || drag?.enabled === false || status.stale}
                onClick={(event) => {
                  if (canAuthor() && !latest.current.status.stale)
                    onOpenMethods(event.currentTarget, { onCreated: appendMethod });
                }}
              >
                新建并绑定 JS
              </Button>
            )}
          </div>
          <Button
            variant="primary"
            onClick={save}
            disabled={!authoringAllowed || !status.dirty || status.stale || hasUnavailableAction}
          >
            {saveLabel}
          </Button>
        </div>
        <Dialog.Root
          open={editingCall !== null && draft.calls[editingCall] !== undefined}
          onOpenChange={(open) => {
            if (!open) setEditingCall(null);
          }}
        >
          <Dialog.Portal>
            <Dialog.Backdrop className="material-modal-backdrop" />
            <Dialog.Popup className="material-modal action-config-dialog">
              <Dialog.Title className="action-config-heading">
                {editingCall !== null && draft.calls[editingCall]
                  ? `动作配置 · ${editingCall + 1}. ${actionLabel(draft.calls[editingCall].action)}`
                  : '动作配置'}
              </Dialog.Title>
              {editingCall !== null && draft.calls[editingCall] && (
                <fieldset
                  className="action-config-body"
                  disabled={!authoringAllowed}
                  inert={!authoringAllowed}
                >
                  {renderCallEditor(draft.calls[editingCall], editingCall)}
                </fieldset>
              )}
              <div className="action-config-footer">
                <Dialog.Close className="ui-button">完成</Dialog.Close>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
    </>
  );
}
function EventChain({
  document,
  snapshot,
  node,
  eventName,
  focusReference,
  onOpenMethods,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  node: NodeSchema;
  eventName: string;
  focusReference?: ApplicationMethodReference;
  onOpenMethods?: OpenApplicationMethods;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  return (
    <ActionChainEditor
      page={page}
      existing={node.on?.[eventName] ?? []}
      focusReference={focusReference}
      onOpenMethods={
        onOpenMethods && ((trigger, target) => canAuthor() && onOpenMethods(trigger, target))
      }
      draftKey={`event:${page.id}/${node.id}/${eventName}`}
      scopes={nodeScopeNames(page, node.id)}
      eventReference={{
        document,
        snapshot,
        nodeId: node.id,
        eventName,
        savedActions: node.on?.[eventName],
      }}
      canSave={canAuthor}
      onSave={(calls) =>
        canAuthor() && document.setEventActions(page.id, node.id, eventName, calls)
      }
    />
  );
}
export function ActionPanel({
  document,
  snapshot,
  node,
  onOpenMethods,
  eventTarget,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  node: NodeSchema;
  onOpenMethods?: OpenApplicationMethods;
  eventTarget?: ApplicationMethodReference;
}) {
  const drag = useDragDrop();
  const canOpenMethods = useAuthorGuard(document, snapshot, node.id, !!onOpenMethods);
  const events = registry.components[node.component].events ?? [];
  const allowed = events.filter(
    (name) =>
      !node.field || !['onChange', 'onValueChange', 'onCheckedChange', 'onBlur'].includes(name),
  );
  const [chosen, setChosen] = useSessionState(
    `event-choice:${snapshot.selection.pageId}/${node.id}`,
    allowed[0] ?? '',
  );
  useLayoutEffect(() => {
    const target = eventTarget?.owner?.eventName;
    if (target && target !== chosen && allowed.includes(target)) setChosen(target);
  }, [eventTarget]);
  const eventName = allowed.includes(chosen) ? chosen : allowed[0];
  const savedEvents = allowed.filter((name) => (node.on?.[name]?.length ?? 0) > 0);
  return (
    <section className="action-panel" aria-label="事件配置">
      {allowed.length ? (
        <>
          <section
            aria-label="已保存事件"
            className="min-w-0 max-w-full rounded border border-slate-200 bg-slate-50/60 p-2 text-xs"
          >
            <p className="text-[11px] text-slate-500">已保存事件</p>
            {savedEvents.length ? (
              <ul className="mt-1 grid min-w-0 gap-1">
                {savedEvents.map((name) => (
                  <li key={name} className="min-w-0 break-all leading-4">
                    {eventLabels[name] ?? name} · <code>{name}</code>{' '}
                    <span className="text-slate-500">
                      已保存 {node.on?.[name]?.length ?? 0} 个动作
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 break-all leading-4 text-slate-500">暂无已保存事件动作。</p>
            )}
          </section>
          <label className="action-parameter">
            组件事件
            <Select
              aria-label="组件事件"
              value={eventName}
              onValueChange={setChosen}
              className="h-auto min-h-7 py-1"
            >
              {allowed.map((name) => (
                <option key={name} value={name}>
                  <span className="block leading-4 break-all whitespace-normal">
                    {eventLabels[name] ?? name} · {name} ·{' '}
                    {(node.on?.[name]?.length ?? 0) > 0
                      ? `已保存 ${node.on?.[name]?.length ?? 0} 个动作`
                      : '未配置'}
                  </span>
                </option>
              ))}
            </Select>
          </label>
          {onOpenMethods && (
            <Button
              type="button"
              variant="ghost"
              className="page-logic-methods-button"
              disabled={!!drag?.isInteracting || drag?.enabled === false}
              onClick={(event) => {
                if (canOpenMethods()) onOpenMethods(event.currentTarget);
              }}
            >
              应用自定义方法
            </Button>
          )}
          <EventChain
            key={`${snapshot.selection.pageId}/${node.id}/${eventName}`}
            document={document}
            snapshot={snapshot}
            node={node}
            eventName={eventName}
            onOpenMethods={onOpenMethods}
            focusReference={eventTarget?.owner?.eventName === eventName ? eventTarget : undefined}
          />
        </>
      ) : (
        <p className="editor-note">
          {node.field ? 'change / blur 事件由表单字段适配器管理。' : '此物料没有可配置事件。'}
        </p>
      )}
    </section>
  );
}
