import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Dialog } from '@base-ui/react/dialog';
import { Plus, Trash2 } from 'lucide-react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type {
  DataSourceDefinition,
  DataType,
  Json,
  NodeSchema,
  StateDefinition,
} from '../../packages/schema/types';
import { Button, Input, Select, Tip } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import { DraftNotice, useDraft, useEditorSession, useSessionState } from './session';
import { bindingDraft, parseBinding, ValueInput, type BindingDraft } from './ValueEditor';
import { errorText } from './errors';
import { FormPanel } from './FormPanel';
import { useDragDrop } from './DragDrop';
type Props = { document: EditorDocument; snapshot: EditorSnapshot };
type DefinitionProps = Props & {
  lock: DefinitionLock;
  authoringAllowed: boolean;
};
type DefinitionKind = 'state' | 'source';
type DefinitionLock = { current: object | null };
type OwnedEntry = {
  key: string;
  source: string;
  initial: string;
  entry: { value: unknown; source: string; dirty: boolean };
};
function useDefinitionDraft<T>(key: string, source: string, initial: T) {
  // Capture the complete Entry during render; guards never read/create a store Entry.
  const tuple = useDraft(key, source, initial);
  const { drafts } = useEditorSession();
  const owner: OwnedEntry = {
    key,
    source,
    initial: JSON.stringify(initial),
    entry: drafts.read(key, source, initial),
  };
  return [...tuple, owner] as const;
}
type DefinitionContext = Props & {
  lock: DefinitionLock;
  kind: DefinitionKind;
  chosen: string;
  definition?: StateDefinition | DataSourceDefinition;
  entries: OwnedEntry[];
  allowed: boolean;
  drag: ReturnType<typeof useDragDrop>;
  enabled: boolean;
  interacting: boolean;
};
type DefinitionReceipt = {
  context: DefinitionContext;
  store: ReturnType<typeof useEditorSession>['drafts'];
  token: object;
  active: boolean;
  before: EditorSnapshot;
  candidate?: EditorSnapshot;
  schema?: string;
  change?: string;
  documents: number;
  drafts: number;
  budget: number;
  phase: 'command' | 'reset' | 'clear' | 'final';
  key?: string;
};
function sameDefinitionContext(a: DefinitionContext, b: DefinitionContext) {
  return (
    a.document === b.document &&
    a.lock === b.lock &&
    a.kind === b.kind &&
    a.snapshot.plan === b.snapshot.plan &&
    a.snapshot.selection === b.snapshot.selection &&
    a.chosen === b.chosen &&
    a.definition === b.definition &&
    a.allowed === b.allowed &&
    a.enabled === b.enabled &&
    a.interacting === b.interacting &&
    a.entries.length === b.entries.length &&
    a.entries.every(
      (entry, i) =>
        entry.key === b.entries[i].key &&
        entry.source === b.entries[i].source &&
        entry.entry === b.entries[i].entry,
    )
  );
}
function definitionCandidate(receipt: DefinitionReceipt, actual: EditorSnapshot) {
  const before = receipt.before;
  return (
    actual.plan !== before.plan &&
    actual.revision === before.revision + 1 &&
    actual.change === receipt.change &&
    JSON.stringify(actual.plan.schema) === receipt.schema &&
    JSON.stringify(actual.selection) === JSON.stringify(before.selection)
  );
}
function useDefinitionOwner(input: Omit<DefinitionContext, 'drag' | 'enabled' | 'interacting'>) {
  const drag = useDragDrop();
  const context = {
    ...input,
    drag,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
  };
  const { drafts } = useEditorSession();
  const store = useRef(drafts);
  store.current = drafts;
  const mounted = useRef(false);
  const current = useRef(context);
  current.current = context;
  const permission = useRef({ context, active: true });
  const pending = useRef<DefinitionReceipt | null>(null);
  const [, publish] = useState(0);
  if (!permission.current.active || !sameDefinitionContext(permission.current.context, context)) {
    permission.current.active = false;
    permission.current = { context, active: true };
  }
  const generation = permission.current;
  // An operation receipt outlives ordinary callback retirement, never its mounted owner.
  const observe = () => {
    const receipt = pending.current;
    // Final is one last effect: synchronous reentry stays locked, with no later writes.
    if (!receipt?.active || receipt.phase === 'final') return !!receipt?.active;
    const captured = receipt.context;
    const latest = current.current;
    const actual = captured.document.getSnapshot();
    const initial = receipt.before;
    const livePage = actual.plan.pages.get(initial.selection.pageId)?.schema;
    const environment =
      mounted.current &&
      context.lock.current === receipt.token &&
      store.current === receipt.store &&
      latest.lock === captured.lock &&
      latest.document === captured.document &&
      latest.kind === captured.kind &&
      latest.chosen === captured.chosen &&
      latest.allowed &&
      captured.allowed &&
      latest.snapshot.selection.pageId === initial.selection.pageId &&
      latest.drag?.enabled !== false &&
      !latest.drag?.isInteracting &&
      !livePage?.code?.enabled;
    if (!environment || receipt.documents > 1 || receipt.drafts > receipt.budget) {
      receipt.active = false;
      return false;
    }
    if (actual !== initial) {
      if (
        !definitionCandidate(receipt, actual) ||
        (receipt.candidate && receipt.candidate !== actual)
      )
        receipt.active = false;
      else receipt.candidate = actual;
    } else if (receipt.candidate) receipt.active = false;
    const rendered = latest.snapshot;
    const knownRender =
      (rendered.plan === initial.plan && rendered.selection === initial.selection) ||
      (receipt.candidate &&
        rendered.plan === receipt.candidate.plan &&
        rendered.selection === receipt.candidate.selection);
    const page = rendered.plan.pages.get(initial.selection.pageId)?.schema;
    const definition =
      captured.kind === 'state'
        ? page?.state.find((item) => item.id === captured.chosen)
        : page?.dataSources?.find((item) => item.id === captured.chosen);
    if (
      !knownRender ||
      latest.definition !== definition ||
      latest.entries.length !== captured.entries.length
    )
      receipt.active = false;
    latest.entries.forEach((entry, i) => {
      const old = captured.entries[i];
      if (!old || entry.key !== old.key) {
        receipt.active = false;
        return;
      }
      if (entry.entry === old.entry) return;
      // Old/new getters can recreate either known clean form after our single clear.
      const allowedReset =
        receipt.phase === 'reset' &&
        entry.key === receipt.key &&
        !entry.entry.dirty &&
        entry.entry.source === entry.source &&
        JSON.stringify(entry.entry.value) === entry.initial;
      const allowedClear =
        receipt.phase === 'clear' &&
        entry.key === receipt.key &&
        entry.entry.value === '' &&
        entry.entry.source === 'ui' &&
        !entry.entry.dirty;
      if (!allowedReset && !allowedClear) receipt.active = false;
    });
    return receipt.active;
  };
  const observer = useRef(observe);
  observer.current = observe;
  observe();
  useLayoutEffect(() => {
    mounted.current = true;
    if (!permission.current.active) publish((value) => value + 1);
    const changed = (kind: 'documents' | 'drafts') => {
      permission.current.active = false;
      const receipt = pending.current;
      if (receipt) receipt[kind]++;
      observer.current();
      publish((value) => value + 1);
    };
    const stopDocument = context.document.subscribe(() => changed('documents'));
    const stopDraft = drafts.subscribe(() => changed('drafts'));
    return () => {
      mounted.current = false;
      permission.current.active = false;
      if (pending.current) pending.current.active = false;
      stopDocument();
      stopDraft();
    };
  }, [context.document, drafts]);
  const allowed =
    context.allowed &&
    context.drag?.enabled !== false &&
    !context.drag?.isInteracting &&
    !context.snapshot.plan.pages.get(context.snapshot.selection.pageId)?.schema.code?.enabled;
  const preflight = () => {
    const actual = context.document.getSnapshot();
    if (
      !mounted.current ||
      !generation.active ||
      permission.current !== generation ||
      !sameDefinitionContext(context, current.current) ||
      actual.plan !== context.snapshot.plan ||
      actual.selection !== context.snapshot.selection ||
      drafts !== store.current ||
      !allowed ||
      current.current.drag?.enabled === false ||
      current.current.drag?.isInteracting ||
      actual.plan.pages.get(actual.selection.pageId)?.schema.code?.enabled
    ) {
      generation.active = false;
      return false;
    }
    // A valid fresh owner only waits for the shared operation; it is not retired.
    return !context.lock.current;
  };
  const run = (
    action: (operation: {
      command: (
        mode: '创建' | '保存' | '删除',
        id: string,
        input: StateDefinition | DataSourceDefinition | undefined,
        invoke: () => boolean,
      ) => boolean;
      write: (phase: 'reset' | 'clear', key: string, invoke: () => void) => boolean;
      finish: (invoke: () => void) => void;
    }) => void,
    showError?: (message: string) => void,
  ) => {
    if (!preflight()) return;
    generation.active = false;
    const token = {};
    context.lock.current = token;
    const receipt: DefinitionReceipt = {
      context,
      store: drafts,
      token,
      active: true,
      before: context.document.getSnapshot(),
      documents: 0,
      drafts: 0,
      budget: 0,
      phase: 'command',
    };
    pending.current = receipt;
    // Exact snapshots may be observed by a render before our publication listener runs.
    const ready = () =>
      observe() &&
      receipt.documents === (receipt.candidate ? 1 : 0) &&
      receipt.drafts === receipt.budget;
    try {
      action({
        command: (mode, id, input, invoke) => {
          const schema = structuredClone(receipt.before.plan.schema);
          const page = schema.pages.find((item) => item.id === receipt.before.selection.pageId)!;
          const list: (StateDefinition | DataSourceDefinition)[] =
            context.kind === 'state' ? page.state : (page.dataSources ??= []);
          if (mode === '创建') list.push(structuredClone(input!));
          else if (mode === '保存')
            Object.assign(
              list.find((item) => item.id === id)!,
              input,
              { id },
            );
          else
            list.splice(
              list.findIndex((item) => item.id === id),
              1,
            );
          if (context.kind === 'source' && mode !== '删除') {
            const transport = (input as DataSourceDefinition).transport;
            (schema.dependencies.transports ??= {})[transport] ??=
              receipt.before.plan.registry.transports![transport].version;
          }
          receipt.schema = JSON.stringify(schema);
          receipt.change = `${mode}${context.kind === 'state' ? '页面状态 ' : '数据源 '}${id}`;
          const changed = invoke();
          return (
            ready() &&
            (changed
              ? receipt.documents === 1
              : receipt.documents === 0 && context.document.getSnapshot() === receipt.before)
          );
        },
        write: (phase, key, invoke) => {
          if (!ready()) return false;
          receipt.phase = phase;
          receipt.key = key;
          receipt.budget++;
          invoke();
          return ready();
        },
        finish: (invoke) => {
          if (!ready()) return;
          receipt.phase = 'final';
          invoke();
        },
      });
    } catch (error) {
      if (
        receipt.documents === 0 &&
        receipt.drafts === 0 &&
        context.document.getSnapshot() === receipt.before &&
        ready()
      ) {
        receipt.phase = 'final';
        showError?.(errorText(error));
      }
    } finally {
      receipt.active = false;
      if (pending.current === receipt) pending.current = null;
      if (context.lock.current === token) context.lock.current = null;
    }
  };
  return {
    allowed,
    run,
    change: (invoke: () => void) => run((operation) => operation.finish(invoke)),
  };
}

const defaults = (type: DataType | 'json'): Json =>
  type === 'array'
    ? []
    : type === 'object'
      ? {}
      : type === 'boolean'
        ? false
        : type === 'number'
          ? 0
          : type === 'string'
            ? ''
            : null;
const types: DataType[] = ['string', 'number', 'boolean', 'array', 'object', 'null'];
function StateEditor({
  document,
  snapshot,
  state,
  onSaved,
  chosen,
  owners,
  lock,
  authoringAllowed,
}: DefinitionProps & {
  chosen: string;
  owners: OwnedEntry[];
  state?: StateDefinition;
  onSaved: (id: string) => void;
}) {
  const pageId = snapshot.selection.pageId;
  const initial = state ?? { id: '', type: 'string' as const, initial: '' };
  const [draft, setDraft, status, draftOwner] = useDefinitionDraft(
    `state:${pageId}/${state?.id ?? '@new'}`,
    JSON.stringify(initial),
    {
      id: initial.id,
      type: initial.type,
      initial: JSON.stringify(initial.initial, null, 2),
      error: '',
    },
  );
  const owner = useDefinitionOwner({
    document,
    snapshot,
    lock,
    allowed: authoringAllowed,
    kind: 'state',
    chosen,
    definition: state,
    entries: [...owners, draftOwner],
  });
  return (
    <form
      className="data-definition"
      aria-label={state ? '页面状态配置' : '新建页面状态'}
      onSubmit={(event) => {
        event.preventDefault();
        if (status.stale) return;
        owner.run(
          (operation) => {
            const input = {
              type: draft.type,
              initial: JSON.parse(draft.initial) as Json,
            };
            const id = state?.id ?? draft.id;
            if (
              !operation.command(state ? '保存' : '创建', id, { id, ...input }, () =>
                state
                  ? document.updateState(pageId, state.id, input)
                  : document.createState(pageId, { id, ...input }),
              )
            )
              return;
            if (!operation.write('reset', draftOwner.key, status.reset)) return;
            operation.finish(() => onSaved(id));
          },
          (error) => setDraft({ ...draft, error }),
        );
      }}
    >
      {status.dirty && (
        <fieldset className="action-chain-controls" disabled={!owner.allowed}>
          <DraftNotice
            {...status}
            reset={() => owner.change(status.reset)}
            rebase={() => owner.change(status.rebase)}
          />
        </fieldset>
      )}
      <label>
        状态 ID
        <Input
          aria-label="状态 ID"
          value={draft.id}
          disabled={!!state || !owner.allowed}
          onChange={(event) =>
            owner.change(() => setDraft((d) => ({ ...d, id: event.target.value, error: '' })))
          }
        />
      </label>
      <label>
        状态类型
        <Select
          aria-label="状态类型"
          value={draft.type}
          disabled={!owner.allowed}
          onValueChange={(type) =>
            owner.change(() => setDraft((d) => ({ ...d, type: type as DataType, error: '' })))
          }
        >
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
      </label>
      <label>
        初始值（JSON）
        <CodeEditor
          label="状态初始值"
          language="json"
          readOnly={!owner.allowed}
          value={draft.initial}
          height={132}
          onChange={(initial) =>
            owner.change(() => setDraft((d) => ({ ...d, initial, error: '' })))
          }
        />
      </label>
      {draft.error && (
        <p role="alert" className="field-error action-error">
          {draft.error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!owner.allowed || status.stale || (!!state && !status.dirty)}
      >
        {state ? '保存状态' : '创建状态'}
      </Button>
      <p className="editor-note">ID 创建后保持稳定。初始值必须符合状态类型，修改会重置预览数据。</p>
    </form>
  );
}
function StatesPanel({ document, snapshot, lock, authoringAllowed }: DefinitionProps) {
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const [chosen, setChosen, , choiceOwner] = useDefinitionDraft(
    `ui:state-choice:${page.id}`,
    'ui',
    page.state[0]?.id ?? '@new',
  );
  const state = page.state.find((state) => state.id === chosen);
  const [error, setError, , errorOwner] = useDefinitionDraft(`ui:state-error:${page.id}`, 'ui', '');
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    plan: EditorSnapshot['plan'];
  } | null>(null);
  const owner = useDefinitionOwner({
    document,
    snapshot,
    lock,
    allowed: authoringAllowed,
    kind: 'state',
    chosen,
    definition: state,
    entries: [choiceOwner, errorOwner],
  });
  return (
    <section className="data-model-panel" aria-label="页面状态管理">
      <div className="data-model-heading">
        <strong>本页状态 · {page.state.length}</strong>
        <Tip content="新建页面状态">
          <Button
            disabled={!owner.allowed}
            aria-label="新建状态"
            onClick={() => {
              owner.run((operation) => {
                if (operation.write('clear', errorOwner.key, () => setError('')))
                  operation.finish(() => setChosen('@new'));
              });
            }}
          >
            <Plus size={13} />
          </Button>
        </Tip>
      </div>
      {!!page.state.length && (
        <div className="data-model-picker">
          <Select
            disabled={!owner.allowed}
            aria-label="管理状态"
            value={state?.id ?? '@new'}
            onValueChange={(id) => {
              owner.run((operation) => {
                if (operation.write('clear', errorOwner.key, () => setError('')))
                  operation.finish(() => setChosen(id));
              });
            }}
          >
            <option value="@new">新建状态</option>
            {page.state.map((state) => (
              <option key={state.id} value={state.id}>
                {state.id} · {state.type}
              </option>
            ))}
          </Select>
          {state && (
            <Tip content="删除页面状态">
              <Button
                disabled={!owner.allowed}
                aria-label={`删除状态 ${state.id}`}
                onClick={() => {
                  owner.run((operation) =>
                    operation.finish(() => setDeleteTarget({ id: state.id, plan: snapshot.plan })),
                  );
                }}
              >
                <Trash2 size={13} />
              </Button>
            </Tip>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="field-error action-error">
          {error}
        </p>
      )}
      <StateEditor
        key={`${page.id}/${state?.id ?? '@new'}`}
        document={document}
        snapshot={snapshot}
        state={state}
        onSaved={setChosen}
        chosen={chosen}
        owners={[choiceOwner, errorOwner]}
        lock={lock}
        authoringAllowed={authoringAllowed}
      />
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal project-confirmation data-delete-dialog">
            <Dialog.Title className="project-confirmation-title">删除页面状态？</Dialog.Title>
            <Dialog.Description className="project-confirmation-description">
              将删除状态“{deleteTarget?.id}”。若仍有组件、动作或数据源引用，删除会被阻止。
            </Dialog.Description>
            {error && (
              <p role="alert" className="field-error action-error">
                {error}
              </p>
            )}
            <div className="project-confirmation-actions">
              <Dialog.Close className="ui-button">取消</Dialog.Close>
              <Button
                variant="danger"
                disabled={!owner.allowed}
                onClick={() => {
                  const target = deleteTarget;
                  if (!target) return;
                  if (
                    !owner.allowed ||
                    target.plan !== document.getSnapshot().plan ||
                    target.plan.pages
                      .get(page.id)
                      ?.schema.state.find((item) => item.id === target.id) !== state
                  ) {
                    setDeleteTarget(null);
                    setError('页面或状态已变化，请重新选择后操作。');
                    return;
                  }
                  owner.run((operation) => {
                    if (
                      !operation.command('删除', target.id, undefined, () =>
                        document.removeState(page.id, target.id),
                      )
                    )
                      return;
                    if (!operation.write('clear', errorOwner.key, () => setError(''))) return;
                    operation.finish(() => {
                      setChosen(page.state.find((item) => item.id !== target.id)?.id ?? '@new');
                      setDeleteTarget(null);
                    });
                  }, setError);
                }}
              >
                确认删除
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
function SourceEditor({
  document,
  snapshot,
  source,
  onSaved,
  chosen,
  owners,
  lock,
  authoringAllowed,
}: DefinitionProps & {
  chosen: string;
  owners: OwnedEntry[];
  source?: DataSourceDefinition;
  onSaved: (id: string) => void;
}) {
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const transports = snapshot.plan.registry.transports ?? {};
  const transportId = source?.transport ?? Object.keys(transports)[0] ?? '';
  const initial = source ?? {
    id: '',
    kind: 'query' as const,
    transport: transportId,
    input: {},
    initial: defaults(transports[transportId]?.output ?? 'json'),
  };
  const makeInput = (id: string): Record<string, BindingDraft> =>
    Object.fromEntries(
      Object.entries(transports[id]?.input ?? {}).map(([key, field]) => [
        key,
        bindingDraft(id === source?.transport ? source.input[key] : undefined, field),
      ]),
    );
  const [draft, setDraft, status, draftOwner] = useDefinitionDraft(
    `source:${page.id}/${source?.id ?? '@new'}`,
    JSON.stringify({ definition: initial, contracts: transports }),
    {
      id: initial.id,
      kind: initial.kind,
      transport: initial.transport,
      input: makeInput(initial.transport),
      transportInputs: {} as Record<string, Record<string, BindingDraft>>,
      initial: JSON.stringify(initial.initial, null, 2),
      error: '',
    },
  );
  const owner = useDefinitionOwner({
    document,
    snapshot,
    lock,
    allowed: authoringAllowed,
    kind: 'source',
    chosen,
    definition: source,
    entries: [...owners, draftOwner],
  });
  const contract = transports[draft.transport];
  return (
    <form
      className="data-definition"
      aria-label={source ? '数据源配置' : '新建数据源配置'}
      onSubmit={(event) => {
        event.preventDefault();
        if (status.stale) return;
        owner.run(
          (operation) => {
            if (!contract) throw new Error('请选择已注册 transport');
            const input = Object.fromEntries(
              Object.entries(contract.input).flatMap(([name, field]) => {
                try {
                  const value = parseBinding(
                    draft.input[name] ?? bindingDraft(undefined, field),
                    field,
                  );
                  return value ? [[name, value]] : [];
                } catch (error) {
                  throw new Error(`${name}：${(error as Error).message}`);
                }
              }),
            );
            const definition = {
              kind: draft.kind,
              transport: draft.transport,
              input,
              initial: JSON.parse(draft.initial) as Json,
            };
            const id = source?.id ?? draft.id;
            if (
              !operation.command(source ? '保存' : '创建', id, { id, ...definition }, () =>
                source
                  ? document.updateDataSource(page.id, source.id, definition)
                  : document.createDataSource(page.id, { id, ...definition }),
              )
            )
              return;
            if (!operation.write('reset', draftOwner.key, status.reset)) return;
            operation.finish(() => onSaved(id));
          },
          (error) => setDraft({ ...draft, error }),
        );
      }}
    >
      {status.dirty && (
        <fieldset className="action-chain-controls" disabled={!owner.allowed}>
          <DraftNotice
            {...status}
            reset={() => owner.change(status.reset)}
            rebase={() => owner.change(status.rebase)}
          />
        </fieldset>
      )}
      <label>
        数据源 ID
        <Input
          aria-label="数据源 ID"
          value={draft.id}
          disabled={!!source || !owner.allowed}
          onChange={(event) =>
            owner.change(() => setDraft((d) => ({ ...d, id: event.target.value, error: '' })))
          }
        />
      </label>
      <label>
        执行类型
        <Select
          aria-label="数据源执行类型"
          value={draft.kind}
          disabled={!owner.allowed}
          onValueChange={(kind) =>
            owner.change(() =>
              setDraft((d) => ({
                ...d,
                kind: kind as 'query' | 'mutation',
                error: '',
              })),
            )
          }
        >
          <option value="query">query · 查询，最新请求生效</option>
          <option value="mutation">mutation · 写入，忙时拒绝重复</option>
        </Select>
      </label>
      <label>
        Transport
        <Select
          aria-label="数据源 Transport"
          value={draft.transport}
          disabled={!owner.allowed}
          onValueChange={(transport) =>
            owner.change(() =>
              setDraft((d) => {
                const cache = d.transportInputs ?? {};
                return {
                  ...d,
                  transport,
                  input: Object.hasOwn(cache, transport) ? cache[transport] : makeInput(transport),
                  transportInputs: { ...cache, [d.transport]: d.input },
                  error: '',
                };
              }),
            )
          }
        >
          {!Object.keys(transports).length && <option value="">尚未注册 transport</option>}
          {Object.entries(transports).map(([id, contract]) => (
            <option key={id} value={id}>
              {id} · {contract.version}
            </option>
          ))}
        </Select>
      </label>
      <label>
        初始值（JSON）
        <CodeEditor
          label="数据源初始值"
          language="json"
          readOnly={!owner.allowed}
          height={132}
          value={draft.initial}
          onChange={(initial) =>
            owner.change(() => setDraft((d) => ({ ...d, initial, error: '' })))
          }
        />
      </label>
      <p className="editor-note">
        返回类型：{contract?.output ?? '未选择'}。参数仅使用页面作用域，不能读取 event /
        scope；字段变化不会自动请求。
      </p>
      {Object.entries(contract?.input ?? {}).map(([name, field]) => (
        <ValueInput
          key={name}
          label={name}
          field={field}
          draft={draft.input[name] ?? bindingDraft(undefined, field)}
          page={page}
          pageScope
          readOnly={!owner.allowed}
          onChange={(value) =>
            owner.change(() =>
              setDraft((d) => ({
                ...d,
                input: { ...d.input, [name]: value },
                error: '',
              })),
            )
          }
        />
      ))}
      {draft.error && (
        <p role="alert" className="field-error action-error">
          {draft.error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!owner.allowed || !contract || status.stale || (!!source && !status.dirty)}
      >
        {source ? '保存数据源' : '创建数据源'}
      </Button>
      <p className="editor-note">
        配置保存不执行请求。预览中的 data.execute 动作可发起查询，结果直接绑定到组件。
      </p>
    </form>
  );
}
function SourcesPanel({ document, snapshot, lock, authoringAllowed }: DefinitionProps) {
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const [chosen, setChosen, , choiceOwner] = useDefinitionDraft(
    `ui:source-choice:${page.id}`,
    'ui',
    page.dataSources?.[0]?.id ?? '@new',
  );
  const source = page.dataSources?.find((source) => source.id === chosen);
  const [error, setError, , errorOwner] = useDefinitionDraft(
    `ui:source-error:${page.id}`,
    'ui',
    '',
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    plan: EditorSnapshot['plan'];
  } | null>(null);
  const owner = useDefinitionOwner({
    document,
    snapshot,
    lock,
    allowed: authoringAllowed,
    kind: 'source',
    chosen,
    definition: source,
    entries: [choiceOwner, errorOwner],
  });
  return (
    <section className="data-model-panel" aria-label="数据源管理">
      <div className="data-model-heading">
        <strong>本页数据源 · {page.dataSources?.length ?? 0}</strong>
        <Tip content="新建数据源">
          <Button
            disabled={!owner.allowed}
            aria-label="新建数据源"
            onClick={() => {
              owner.run((operation) => {
                if (operation.write('clear', errorOwner.key, () => setError('')))
                  operation.finish(() => setChosen('@new'));
              });
            }}
          >
            <Plus size={13} />
          </Button>
        </Tip>
      </div>
      {!!page.dataSources?.length && (
        <div className="data-model-picker">
          <Select
            disabled={!owner.allowed}
            aria-label="管理数据源"
            value={source?.id ?? '@new'}
            onValueChange={(id) => {
              owner.run((operation) => {
                if (operation.write('clear', errorOwner.key, () => setError('')))
                  operation.finish(() => setChosen(id));
              });
            }}
          >
            <option value="@new">新建数据源</option>
            {page.dataSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.id} · {source.kind}
              </option>
            ))}
          </Select>
          {source && (
            <Tip content="删除数据源">
              <Button
                disabled={!owner.allowed}
                aria-label={`删除数据源 ${source.id}`}
                onClick={() => {
                  owner.run((operation) =>
                    operation.finish(() => setDeleteTarget({ id: source.id, plan: snapshot.plan })),
                  );
                }}
              >
                <Trash2 size={13} />
              </Button>
            </Tip>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="field-error action-error">
          {error}
        </p>
      )}
      <SourceEditor
        key={`${page.id}/${source?.id ?? '@new'}`}
        document={document}
        snapshot={snapshot}
        source={source}
        onSaved={setChosen}
        chosen={chosen}
        owners={[choiceOwner, errorOwner]}
        lock={lock}
        authoringAllowed={authoringAllowed}
      />
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal project-confirmation data-delete-dialog">
            <Dialog.Title className="project-confirmation-title">删除数据源？</Dialog.Title>
            <Dialog.Description className="project-confirmation-description">
              将删除数据源“{deleteTarget?.id}”。若页面逻辑仍引用它，删除会被阻止。
            </Dialog.Description>
            {error && (
              <p role="alert" className="field-error action-error">
                {error}
              </p>
            )}
            <div className="project-confirmation-actions">
              <Dialog.Close className="ui-button">取消</Dialog.Close>
              <Button
                variant="danger"
                disabled={!owner.allowed}
                onClick={() => {
                  const target = deleteTarget;
                  if (!target) return;
                  if (
                    !owner.allowed ||
                    target.plan !== document.getSnapshot().plan ||
                    target.plan.pages
                      .get(page.id)
                      ?.schema.dataSources?.find((item) => item.id === target.id) !== source
                  ) {
                    setDeleteTarget(null);
                    setError('页面或数据源已变化，请重新选择后操作。');
                    return;
                  }
                  owner.run((operation) => {
                    if (
                      !operation.command('删除', target.id, undefined, () =>
                        document.removeDataSource(page.id, target.id),
                      )
                    )
                      return;
                    if (!operation.write('clear', errorOwner.key, () => setError(''))) return;
                    operation.finish(() => {
                      setChosen(
                        page.dataSources?.find((item) => item.id !== target.id)?.id ?? '@new',
                      );
                      setDeleteTarget(null);
                    });
                  }, setError);
                }}
              >
                确认删除
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
export function DataPanel({
  document,
  snapshot,
  node,
  authoringAllowed,
}: Props & {
  node?: NodeSchema;
  authoringAllowed?: boolean;
}) {
  const lock = useRef<object | null>(null);
  const pageId = snapshot.selection.pageId;
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const session = useEditorSession();
  const [tab, setTab] = useSessionState(`data-tab:${pageId}`, 'forms');
  useEffect(() => {
    if (session.dataTarget?.pageId === pageId) setTab('forms');
  }, [session.dataTarget, pageId]);
  return (
    <Tabs.Root className="data-panel" value={tab} onValueChange={setTab}>
      <div className="data-panel-context">
        <strong>页面数据</strong>
        <span>{page.title} · 状态、表单、数据源</span>
      </div>
      <Tabs.List className="panel-tabs" aria-label="数据配置类型">
        <Tabs.Tab value="states" aria-label="页面状态配置">
          页面状态
        </Tabs.Tab>
        <Tabs.Tab value="forms">表单模型</Tabs.Tab>
        <Tabs.Tab value="sources">数据源</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="states" keepMounted>
        <StatesPanel
          document={document}
          snapshot={snapshot}
          lock={lock}
          authoringAllowed={authoringAllowed !== false}
        />
      </Tabs.Panel>
      <Tabs.Panel value="forms" keepMounted>
        <FormPanel key={pageId} document={document} snapshot={snapshot} node={node} mode="models" />
      </Tabs.Panel>
      <Tabs.Panel value="sources" keepMounted>
        <SourcesPanel
          document={document}
          snapshot={snapshot}
          lock={lock}
          authoringAllowed={authoringAllowed !== false}
        />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
