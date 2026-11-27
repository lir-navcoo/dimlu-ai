import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Dialog } from '@base-ui/react/dialog';
import { Plus, Trash2, X } from 'lucide-react';
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
import { buildHttpRequest, performHttpRequest } from '../../packages/runtime/http-transport';
type Props = { document: EditorDocument; snapshot: EditorSnapshot };
type DefinitionProps = Props & {
  lock: DefinitionLock;
  authoringAllowed: boolean;
};
type DefinitionKind = 'state' | 'source' | 'shared-source';
type DefinitionLock = { current: object | null };
type HttpParamDraft = { id: string; key: string; value: string };
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
    const definitions =
      captured.kind === 'state'
        ? page?.state
        : captured.kind === 'shared-source'
          ? rendered.plan.schema.sharedDataSources
          : page?.dataSources;
    const definition = definitions?.find((item) => item.id === captured.chosen);
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
            context.kind === 'state'
              ? page.state
              : context.kind === 'shared-source'
                ? (schema.sharedDataSources ??= [])
                : (page.dataSources ??= []);
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
          const data = context.kind !== 'state' ? (input as DataSourceDefinition) : undefined;
          if (data?.transport && !data.ref) {
            (schema.dependencies.transports ??= {})[data.transport] ??=
              receipt.before.plan.registry.transports![data.transport].version;
          }
          const label =
            context.kind === 'state'
              ? '页面状态'
              : context.kind === 'source'
                ? '数据源'
                : '共享数据源';
          const refSuffix = mode === '创建' && data?.ref ? `（引用 ${data.ref}）` : '';
          receipt.schema = JSON.stringify(schema);
          receipt.change = `${mode}${label} ${id}${refSuffix}`;
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
      <div className="workbench-dialog-scroll data-definition-fields">
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
        <p className="editor-note">
          ID 创建后保持稳定。初始值必须符合状态类型，修改会重置预览数据。
        </p>
      </div>
      <div className="workbench-dialog-actions data-definition-actions">
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
      </div>
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
  const [editorOpen, setEditorOpen] = useState(false);
  const pickState = (id: string) => {
    owner.run((operation) => {
      if (operation.write('clear', errorOwner.key, () => setError('')))
        operation.finish(() => {
          setChosen(id);
          setEditorOpen(true);
        });
    });
  };
  return (
    <section className="data-model-panel" aria-label="页面状态管理">
      <div className="data-model-heading">
        <strong>本页状态 · {page.state.length}</strong>
        <Tip content="新建页面状态">
          <Button disabled={!owner.allowed} aria-label="新建状态" onClick={() => pickState('@new')}>
            <Plus size={13} />
          </Button>
        </Tip>
      </div>
      {error && (
        <p role="alert" className="field-error action-error">
          {error}
        </p>
      )}
      {!!page.state.length && (
        <ul className="data-source-list" aria-label="状态列表">
          {page.state.map((item) => (
            <li className="data-source-row" key={item.id}>
              <button
                type="button"
                className="data-source-open"
                disabled={!owner.allowed}
                aria-label={`编辑状态 ${item.id}`}
                onClick={() => pickState(item.id)}
              >
                <span className="data-source-name">{item.id}</span>
                <span className="data-source-kind">{item.type}</span>
              </button>
              <Tip content="删除页面状态">
                <Button
                  variant="ghost"
                  disabled={!owner.allowed}
                  aria-label={`删除状态 ${item.id}`}
                  onClick={() => {
                    owner.run((operation) =>
                      operation.finish(() => setDeleteTarget({ id: item.id, plan: snapshot.plan })),
                    );
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      {!page.state.length && <p className="editor-note">尚无状态。点右上角「+」创建。</p>}
      <Dialog.Root open={editorOpen} onOpenChange={setEditorOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal state-definition-dialog">
            <div className="data-definition-dialog-head">
              <div className="data-definition-dialog-heading">
                <Dialog.Title>{state ? `编辑状态 · ${state.id}` : '新建状态'}</Dialog.Title>
                <Dialog.Description className="editor-note">
                  初始值必须符合状态类型；修改会重置预览数据。
                </Dialog.Description>
              </div>
              <Dialog.Close className="ui-button ui-button-ghost" aria-label="关闭状态编辑">
                <X size={14} />
              </Dialog.Close>
            </div>
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
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
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
  shared = false,
  formId,
}: DefinitionProps & {
  chosen: string;
  owners: OwnedEntry[];
  source?: DataSourceDefinition;
  onSaved: (id: string) => void;
  shared?: boolean;
  formId: string;
}) {
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const sharedSources = snapshot.plan.schema.sharedDataSources ?? [];
  const transports = snapshot.plan.registry.transports ?? {};
  const sharedOf = source?.ref ? sharedSources.find((item) => item.id === source.ref) : undefined;
  const transportId =
    sharedOf?.transport ??
    source?.transport ??
    (transports['http.request'] ? 'http.request' : (Object.keys(transports)[0] ?? ''));
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
        bindingDraft(
          source && id === (source.transport || sharedOf?.transport)
            ? source.input[key]
            : undefined,
          field,
        ),
      ]),
    );
  const [draft, setDraft, status, draftOwner] = useDefinitionDraft(
    shared ? `shared-source:${source?.id ?? '@new'}` : `source:${page.id}/${source?.id ?? '@new'}`,
    JSON.stringify({ definition: initial, contracts: transports, sharedOf: sharedOf?.id }),
    {
      id: initial.id,
      kind: initial.kind,
      transport: initial.transport,
      ref: source?.ref ?? '',
      input: makeInput(initial.transport),
      transportInputs: {} as Record<string, Record<string, BindingDraft>>,
      httpUrl: source?.input.url?.kind === 'literal' ? String(source.input.url.value) : '',
      httpMethod:
        source?.input.method?.kind === 'literal' ? String(source.input.method.value) : 'GET',
      httpParams: Object.entries(
        source?.input.params?.kind === 'literal' &&
          source.input.params.value &&
          typeof source.input.params.value === 'object' &&
          !Array.isArray(source.input.params.value)
          ? source.input.params.value
          : {},
      ).map(([key, value], index) => ({ id: `param-${index}`, key, value: String(value) })),
      nextHttpParamId: Object.keys(
        source?.input.params?.kind === 'literal' &&
          source.input.params.value &&
          typeof source.input.params.value === 'object' &&
          !Array.isArray(source.input.params.value)
          ? source.input.params.value
          : {},
      ).length,
      httpHeaders: JSON.stringify(
        source?.input.headers?.kind === 'literal' ? source.input.headers.value : {},
        null,
        2,
      ),
      httpBody: JSON.stringify(
        source?.input.body?.kind === 'literal' ? source.input.body.value : {},
        null,
        2,
      ),
      httpTimeout:
        source?.input.timeout?.kind === 'literal' && typeof source.input.timeout.value === 'number'
          ? String(source.input.timeout.value)
          : '',
      httpDirty: (source
        ? {}
        : {
            url: true,
            method: true,
            params: true,
            headers: true,
            body: true,
            timeout: true,
          }) as Record<string, boolean>,
      initial: JSON.stringify(initial.initial, null, 2),
      error: '',
    },
  );
  const owner = useDefinitionOwner({
    document,
    snapshot,
    lock,
    allowed: authoringAllowed,
    kind: shared ? 'shared-source' : 'source',
    chosen,
    definition: source,
    entries: [...owners, draftOwner],
  });
  const refMode = !shared && !!draft.ref;
  const sharedContract = refMode
    ? transports[sharedSources.find((item) => item.id === draft.ref)?.transport ?? '']
    : undefined;
  const contract = refMode ? sharedContract : transports[draft.transport];
  const httpMode = !shared && !refMode && draft.transport === 'http.request';
  const httpKind = draft.httpMethod === 'GET' ? 'query' : 'mutation';
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    time: number;
    body: string;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const sendController = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      const controller = sendController.current;
      sendController.current = null;
      controller?.abort();
    };
  }, []);
  const params = draft.httpParams as HttpParamDraft[];
  const paramsObject = () => {
    const result: Record<string, string> = {};
    for (const param of params) {
      if (!param.key.trim()) throw new Error('Params 键不能为空');
      if (Object.hasOwn(result, param.key)) throw new Error(`Params 键重复：${param.key}`);
      Object.defineProperty(result, param.key, {
        value: param.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };
  const updateParams = (next: HttpParamDraft[]) =>
    owner.change(() =>
      setDraft((d) => ({
        ...d,
        httpParams: next,
        httpDirty: { ...d.httpDirty, params: true },
        error: '',
      })),
    );
  const addParam = () =>
    owner.change(() =>
      setDraft((d) => ({
        ...d,
        httpParams: [
          ...(d.httpParams as HttpParamDraft[]),
          { id: `param-${d.nextHttpParamId}`, key: '', value: '' },
        ],
        nextHttpParamId: d.nextHttpParamId + 1,
        httpDirty: { ...d.httpDirty, params: true },
        error: '',
      })),
    );
  const discardDraft = () => {
    owner.change(() => {
      const controller = sendController.current;
      sendController.current = null;
      controller?.abort();
      setSending(false);
      setResponse(null);
      status.reset();
    });
  };
  const sendRequest = async () => {
    if (!owner.allowed || sendController.current) return;
    setResponse(null);
    setSending(true);
    const controller = new AbortController();
    sendController.current = controller;
    const started = performance.now();
    try {
      const dynamicFields = ['url', 'method', 'params', 'headers', 'body', 'timeout'].filter(
        (key) => !draft.httpDirty[key] && source?.input[key]?.kind === 'expression',
      );
      if (dynamicFields.length)
        throw new Error(
          `Send 无法解析未修改的动态绑定：${dynamicFields.join('、')}。请先改为字面值。`,
        );
      const request = {
        url: draft.httpUrl,
        method: draft.httpMethod,
        params: paramsObject(),
        headers: JSON.parse(draft.httpHeaders),
        ...(draft.httpMethod === 'GET' ? {} : { body: JSON.parse(draft.httpBody) }),
        ...(draft.httpTimeout.trim() ? { timeout: Number(draft.httpTimeout) } : {}),
      };
      const result = await performHttpRequest(request, controller.signal, async (res) => {
        const text = await res.text();
        let body = text;
        try {
          body = text ? JSON.stringify(JSON.parse(text), null, 2) : '';
        } catch {
          /* Plain-text response. */
        }
        return { status: res.status, statusText: res.statusText, body };
      });
      if (sendController.current === controller)
        setResponse({ ...result, time: Math.round(performance.now() - started) });
    } catch (error) {
      if (sendController.current !== controller) return;
      setResponse({
        status: 0,
        statusText: errorText(error),
        time: Math.round(performance.now() - started),
        body: '',
      });
    } finally {
      if (sendController.current === controller) {
        sendController.current = null;
        setSending(false);
      }
    }
  };
  const form = (
    <form
      id={formId}
      className="data-definition"
      aria-label={shared ? '共享数据源配置' : source ? '数据源配置' : '新建数据源配置'}
      onSubmit={(event) => {
        event.preventDefault();
        if (status.stale) return;
        owner.run(
          (operation) => {
            const ref = refMode ? draft.ref : undefined;
            const sharedDef = ref ? sharedSources.find((item) => item.id === ref) : undefined;
            if (!ref && !contract) throw new Error('请选择已注册 transport');
            const httpInput = httpMode
              ? {
                  ...source?.input,
                  ...(draft.httpDirty.url
                    ? { url: { kind: 'literal' as const, value: draft.httpUrl } }
                    : {}),
                  ...(draft.httpDirty.method
                    ? { method: { kind: 'literal' as const, value: draft.httpMethod } }
                    : {}),
                  ...(draft.httpDirty.params
                    ? { params: { kind: 'literal' as const, value: paramsObject() as Json } }
                    : {}),
                  ...(draft.httpDirty.headers
                    ? {
                        headers: {
                          kind: 'literal' as const,
                          value: JSON.parse(draft.httpHeaders) as Json,
                        },
                      }
                    : {}),
                  ...(draft.httpMethod === 'GET' && (!source || draft.httpDirty.method)
                    ? { body: undefined }
                    : draft.httpDirty.body
                      ? {
                          body: {
                            kind: 'literal' as const,
                            value: JSON.parse(draft.httpBody) as Json,
                          },
                        }
                      : {}),
                  ...(draft.httpDirty.timeout
                    ? draft.httpTimeout.trim()
                      ? { timeout: { kind: 'literal' as const, value: Number(draft.httpTimeout) } }
                      : { timeout: undefined }
                    : {}),
                }
              : undefined;
            const input = httpMode
              ? Object.fromEntries(
                  Object.entries(httpInput!).flatMap(([key, binding]) =>
                    binding === undefined ? [] : [[key, binding]],
                  ),
                )
              : Object.fromEntries(
                  Object.entries(
                    (ref ? transports[sharedDef!.transport] : contract)!.input,
                  ).flatMap(([name, field]) => {
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
            if (httpMode && !source)
              buildHttpRequest(
                Object.fromEntries(
                  Object.entries(input).flatMap(([key, binding]) =>
                    binding.kind === 'literal' ? [[key, binding.value]] : [],
                  ),
                ),
              );
            const id = source?.id ?? draft.id;
            if (shared) {
              const definition = {
                kind: draft.kind as 'query' | 'mutation',
                transport: draft.transport,
                input,
                initial: JSON.parse(draft.initial) as Json,
              };
              if (
                !operation.command(
                  source ? '保存' : '创建',
                  id,
                  { id, ...definition } as DataSourceDefinition,
                  () =>
                    source
                      ? document.updateSharedDataSource(source.id, definition)
                      : document.createSharedDataSource({ id, ...definition }),
                )
              )
                return;
            } else {
              const definition = ref
                ? { ref, input }
                : {
                    kind: (httpMode ? httpKind : draft.kind) as 'query' | 'mutation',
                    transport: draft.transport,
                    input,
                    initial: JSON.parse(draft.initial) as Json,
                  };
              if (
                !operation.command(
                  source ? '保存' : '创建',
                  id,
                  { id, ...definition } as DataSourceDefinition,
                  () =>
                    source
                      ? document.updateDataSource(
                          page.id,
                          source.id,
                          definition as Omit<DataSourceDefinition, 'id'>,
                        )
                      : document.createDataSource(page.id, {
                          id,
                          ...definition,
                        } as DataSourceDefinition),
                )
              )
                return;
            }
            if (!operation.write('reset', draftOwner.key, status.reset)) return;
            operation.finish(() => onSaved(id));
          },
          (error) => setDraft({ ...draft, error }),
        );
      }}
    >
      <div className="workbench-dialog-scroll data-definition-fields">
        {status.dirty && (
          <fieldset className="action-chain-controls" disabled={!owner.allowed}>
            <DraftNotice
              {...status}
              reset={discardDraft}
              rebase={() => owner.change(status.rebase)}
            />
          </fieldset>
        )}
        <section className="data-source-config-section">
          <h3>基础信息</h3>
          <label className="data-source-config-field">
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
          {!shared && !!sharedSources.length && (
            <label className="data-source-config-field">
              引用共享数据源
              <Select
                aria-label="数据源共享引用"
                value={draft.ref}
                disabled={!owner.allowed || !!source}
                onValueChange={(ref) =>
                  owner.change(() =>
                    setDraft((d) => {
                      const sharedDef = sharedSources.find((item) => item.id === ref);
                      return {
                        ...d,
                        ref,
                        transport: sharedDef?.transport ?? Object.keys(transports)[0] ?? '',
                        input: Object.fromEntries(
                          Object.entries(
                            transports[sharedDef?.transport ?? Object.keys(transports)[0] ?? '']
                              ?.input ?? {},
                          ).map(([name, field]) => [name, bindingDraft(undefined, field)]),
                        ),
                        error: '',
                      };
                    }),
                  )
                }
              >
                <option value="">本地定义</option>
                {sharedSources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} · {item.kind === 'query' ? '查询' : '写入'}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {refMode && (
            <p className="editor-note">
              引用共享数据源 {draft.ref}：类型与初始值由共享定义提供，下方参数为页面覆盖。
            </p>
          )}
          {!shared && !refMode && (
            <label className="data-source-config-field">
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
                        input: Object.hasOwn(cache, transport)
                          ? cache[transport]
                          : makeInput(transport),
                        transportInputs: { ...cache, [d.transport]: d.input },
                        error: '',
                      };
                    }),
                  )
                }
              >
                {Object.entries(transports).map(([id, transportContract]) => (
                  <option key={id} value={id}>
                    {id} · {transportContract.version}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </section>
        {httpMode ? (
          <section className="data-source-config-section http-request-designer">
            <h3>请求</h3>
            <div className="http-request-line">
              <Select
                aria-label="请求方法"
                value={draft.httpMethod}
                disabled={!owner.allowed}
                onValueChange={(httpMethod) =>
                  owner.change(() =>
                    setDraft((d) => ({
                      ...d,
                      httpMethod,
                      httpDirty: { ...d.httpDirty, method: true },
                      kind: httpMethod === 'GET' ? 'query' : 'mutation',
                      error: '',
                    })),
                  )
                }
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="请求 URL"
                placeholder="https://api.example.com/path"
                value={draft.httpUrl}
                readOnly={!owner.allowed}
                onChange={(event) =>
                  owner.change(() =>
                    setDraft((d) => ({
                      ...d,
                      httpUrl: event.target.value,
                      httpDirty: { ...d.httpDirty, url: true },
                      error: '',
                    })),
                  )
                }
              />
              <Button
                type="button"
                variant="primary"
                disabled={!owner.allowed || sending || !draft.httpUrl}
                onClick={sendRequest}
              >
                {sending ? '发送中…' : 'Send'}
              </Button>
            </div>
            <div className="data-source-config-field http-params-field">
              <span>Params</span>
              {params.map((param, index) => (
                <div className="http-param-row" key={param.id}>
                  <Input
                    aria-label={`Params 键 ${index + 1}`}
                    value={param.key}
                    readOnly={!owner.allowed}
                    onChange={(event) =>
                      updateParams(
                        params.map((item) =>
                          item.id === param.id ? { ...item, key: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Input
                    aria-label={`Params 值 ${index + 1}`}
                    value={param.value}
                    readOnly={!owner.allowed}
                    onChange={(event) =>
                      updateParams(
                        params.map((item) =>
                          item.id === param.id ? { ...item, value: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    aria-label={`删除 Params ${param.key || index + 1}`}
                    variant="ghost"
                    disabled={!owner.allowed}
                    onClick={() => updateParams(params.filter((item) => item.id !== param.id))}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="ghost" disabled={!owner.allowed} onClick={addParam}>
                <Plus size={14} />
                添加参数
              </Button>
            </div>
            <label className="data-source-config-field">
              Headers（JSON 对象）
              <CodeEditor
                label="请求 Headers"
                language="json"
                readOnly={!owner.allowed}
                height={96}
                value={draft.httpHeaders}
                onChange={(httpHeaders) =>
                  owner.change(() =>
                    setDraft((d) => ({
                      ...d,
                      httpHeaders,
                      httpDirty: { ...d.httpDirty, headers: true },
                      error: '',
                    })),
                  )
                }
              />
            </label>
            <label className="data-source-config-field">
              Timeout（毫秒，可留空使用默认值）
              <Input
                aria-label="请求超时"
                type="number"
                min={1}
                value={draft.httpTimeout}
                readOnly={!owner.allowed}
                onChange={(event) =>
                  owner.change(() =>
                    setDraft((d) => ({
                      ...d,
                      httpTimeout: event.target.value,
                      httpDirty: { ...d.httpDirty, timeout: true },
                      error: '',
                    })),
                  )
                }
              />
            </label>
            {draft.httpMethod !== 'GET' && (
              <label className="data-source-config-field">
                JSON Body
                <CodeEditor
                  label="请求 JSON Body"
                  language="json"
                  readOnly={!owner.allowed}
                  height={132}
                  value={draft.httpBody}
                  onChange={(httpBody) =>
                    owner.change(() =>
                      setDraft((d) => ({
                        ...d,
                        httpBody,
                        httpDirty: { ...d.httpDirty, body: true },
                        error: '',
                      })),
                    )
                  }
                />
              </label>
            )}
            {response && (
              <section className="http-response" aria-label="响应结果">
                <div className="http-response-heading">
                  <strong>Response</strong>
                  <span>
                    {response.status
                      ? `${response.status} ${response.statusText}`
                      : response.statusText}
                  </span>
                  <span>{response.time} ms</span>
                </div>
                <CodeEditor
                  label="响应 Body"
                  language="json"
                  readOnly
                  height={180}
                  value={response.body}
                  onChange={() => {}}
                />
              </section>
            )}
          </section>
        ) : (
          !refMode && (
            <section className="data-source-config-section">
              <h3>加载方式</h3>
              <label className="data-source-config-field">
                执行类型
                <Select
                  aria-label={shared ? '共享数据源执行类型' : '数据源执行类型'}
                  value={draft.kind}
                  disabled={!owner.allowed}
                  onValueChange={(kind) =>
                    owner.change(() =>
                      setDraft((d) => ({ ...d, kind: kind as 'query' | 'mutation', error: '' })),
                    )
                  }
                >
                  <option value="query">query · 查询</option>
                  <option value="mutation">mutation · 写入</option>
                </Select>
              </label>
              <p className="editor-note">
                返回 {contract?.output ?? '未选择'}；参数取自页面状态，字段变化不会自动请求。
              </p>
            </section>
          )
        )}
        {!httpMode && !refMode && (
          <section className="data-source-config-section">
            <h3>默认数据</h3>
            <label className="data-source-config-field">
              初始值（JSON）
              <CodeEditor
                label={shared ? '共享数据源初始值' : '数据源初始值'}
                language="json"
                readOnly={!owner.allowed}
                height={104}
                value={draft.initial}
                onChange={(initial) =>
                  owner.change(() => setDraft((d) => ({ ...d, initial, error: '' })))
                }
              />
            </label>
          </section>
        )}
        {(!httpMode || refMode) && !!Object.keys(contract?.input ?? {}).length && (
          <section className="data-source-config-section">
            <h3>请求参数</h3>
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
            <p className="editor-note">
              保存不执行请求；在预览中用 data.execute 动作发起查询并绑定结果。
            </p>
          </section>
        )}
      </div>
      <div className="workbench-dialog-actions data-definition-actions">
        {draft.error && (
          <p role="alert" className="field-error action-error">
            {draft.error}
          </p>
        )}
      </div>
    </form>
  );
  const sourceLabel = shared ? '共享数据源' : '数据源';
  const actionLabel = source ? '保存' : '创建';
  return (
    <>
      <div className="data-definition-dialog-head data-source-dialog-head">
        <div className="data-definition-dialog-heading">
          <Dialog.Title>
            {source ? `编辑${sourceLabel} · ${source.id}` : `新建${sourceLabel}`}
          </Dialog.Title>
          <Dialog.Description className="editor-note">
            {shared
              ? '共享定义保存不执行请求；各页面可在引用时覆盖参数。'
              : '配置保存不执行请求；字段变化也不会自动请求。'}
          </Dialog.Description>
        </div>
        <div className="data-source-toolbar">
          <Button
            type="submit"
            form={formId}
            variant="primary"
            aria-label={`${actionLabel}${sourceLabel}`}
            disabled={!owner.allowed || !contract || status.stale || (!!source && !status.dirty)}
          >
            {actionLabel}
          </Button>
          <Dialog.Close className="ui-button" aria-label={`关闭${sourceLabel}编辑`}>
            关闭
          </Dialog.Close>
        </div>
      </div>
      {form}
    </>
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
  const [editorOpen, setEditorOpen] = useState(false);
  const pickSource = (id: string) => {
    owner.run((operation) => {
      if (operation.write('clear', errorOwner.key, () => setError('')))
        operation.finish(() => {
          setChosen(id);
          setEditorOpen(true);
        });
    });
  };
  const sharedSources = snapshot.plan.schema.sharedDataSources ?? [];
  const [sharedChosen, setSharedChosen] = useState('@new');
  const [sharedEditorOpen, setSharedEditorOpen] = useState(false);
  const [sharedDelete, setSharedDelete] = useState<string | null>(null);
  const sharedSource = sharedSources.find((source) => source.id === sharedChosen);
  const pickShared = (id: string) => {
    owner.run((operation) => {
      if (operation.write('clear', errorOwner.key, () => setError('')))
        operation.finish(() => {
          setSharedChosen(id);
          setSharedEditorOpen(true);
        });
    });
  };
  return (
    <section className="data-model-panel" aria-label="数据源管理">
      <div className="data-model-heading">
        <strong>本页数据源 · {page.dataSources?.length ?? 0}</strong>
        <Tip content="新建数据源">
          <Button
            disabled={!owner.allowed}
            aria-label="新建数据源"
            onClick={() => pickSource('@new')}
          >
            <Plus size={13} />
          </Button>
        </Tip>
      </div>
      {error && (
        <p role="alert" className="field-error action-error">
          {error}
        </p>
      )}
      {!!page.dataSources?.length && (
        <ul className="data-source-list" aria-label="数据源列表">
          {page.dataSources.map((item) => (
            <li className="data-source-row" key={item.id}>
              <button
                type="button"
                className="data-source-open"
                disabled={!owner.allowed}
                aria-label={`编辑数据源 ${item.id}`}
                onClick={() => pickSource(item.id)}
              >
                <span className="data-source-name">{item.id}</span>
                <span className="data-source-kind">{item.kind === 'query' ? '查询' : '写入'}</span>
              </button>
              <Tip content="删除数据源">
                <Button
                  disabled={!owner.allowed}
                  variant="ghost"
                  aria-label={`删除数据源 ${item.id}`}
                  onClick={() => {
                    owner.run((operation) =>
                      operation.finish(() => setDeleteTarget({ id: item.id, plan: snapshot.plan })),
                    );
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      {!page.dataSources?.length && (
        <p className="editor-note">尚无数据源。点右上角「+」创建，或从动作里新建。</p>
      )}
      <div className="data-model-heading shared-heading">
        <strong>共享数据源 · {sharedSources.length}</strong>
        <Tip content="新建共享数据源">
          <Button
            disabled={!owner.allowed}
            aria-label="新建共享数据源"
            onClick={() => pickShared('@new')}
          >
            <Plus size={13} />
          </Button>
        </Tip>
      </div>
      {!!sharedSources.length ? (
        <ul className="data-source-list" aria-label="共享数据源列表">
          {sharedSources.map((item) => (
            <li className="data-source-row" key={item.id}>
              <button
                type="button"
                className="data-source-open"
                disabled={!owner.allowed}
                aria-label={`编辑共享数据源 ${item.id}`}
                onClick={() => pickShared(item.id)}
              >
                <span className="data-source-name">{item.id}</span>
                <span className="data-source-kind">
                  {item.kind === 'query' ? '查询' : '写入'} · 全应用共享
                </span>
              </button>
              <Tip content="删除共享数据源">
                <Button
                  disabled={!owner.allowed}
                  variant="ghost"
                  aria-label={`删除共享数据源 ${item.id}`}
                  onClick={() => setSharedDelete(item.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </Tip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="editor-note">共享数据源由整个应用复用，页面通过「引用共享数据源」接入。</p>
      )}
      <Dialog.Root open={sharedEditorOpen} onOpenChange={setSharedEditorOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal data-source-dialog drawer">
            <SourceEditor
              key={`shared/${sharedSource?.id ?? '@new'}`}
              document={document}
              snapshot={snapshot}
              source={sharedSource}
              onSaved={(id) => setSharedChosen(id)}
              chosen={sharedChosen}
              owners={[choiceOwner, errorOwner]}
              lock={lock}
              authoringAllowed={authoringAllowed}
              formId="shared-source-definition"
              shared
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={sharedDelete !== null}
        onOpenChange={(open) => !open && setSharedDelete(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal project-confirmation data-delete-dialog">
            <Dialog.Title className="project-confirmation-title">删除共享数据源？</Dialog.Title>
            <Dialog.Description className="project-confirmation-description">
              将删除共享数据源“{sharedDelete}”。若仍有页面引用它，删除会被阻止。
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
                  const target = sharedDelete;
                  if (!target) return;
                  owner.run((operation) => {
                    if (
                      !operation.command('删除', target, undefined, () =>
                        document.removeSharedDataSource(target),
                      )
                    )
                      return;
                    if (!operation.write('clear', errorOwner.key, () => setError(''))) return;
                    operation.finish(() => {
                      setSharedChosen(
                        sharedSources.find((item) => item.id !== target)?.id ?? '@new',
                      );
                      setSharedDelete(null);
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
      <Dialog.Root open={editorOpen} onOpenChange={setEditorOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal data-source-dialog drawer">
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
              formId="page-source-definition"
            />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
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
