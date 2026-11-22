import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Archive, Plus, Trash2 } from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import type { ClipboardSummary } from '../../packages/editor/node-clipboard';
import {
  normalizeSavedFragmentName,
  SAVED_FRAGMENT_LIMIT,
  SAVED_FRAGMENT_NAME_LIMIT,
  type SavedFragmentSummary,
  type SavedFragmentsSnapshot,
} from '../../packages/editor/saved-fragments';
import {
  pageNodeOrder,
  selectedNodeIds,
  topSelectedNodeIds,
} from '../../packages/editor/selection';
import type { NodeSchema } from '../../packages/schema/types';
import { Button, Input, Tip } from '../ui/primitives';
import { useDragDrop } from './DragDrop';
import { errorText } from './errors';
import { useEditorSession, useSessionState } from './session';
import './fragments.css';

type Draft = { text: string; token: object };
const draftKeys = new WeakMap<EditorDocument, { key: string; initial: Draft }>();
let draftSequence = 0;
function documentDraft(document: EditorDocument) {
  let entry = draftKeys.get(document);
  if (!entry) {
    entry = { key: `fragments/name/${++draftSequence}`, initial: { text: '', token: {} } };
    draftKeys.set(document, entry);
  }
  return entry;
}
type OwnerContext = {
  document: EditorDocument;
  pageId: string;
  authoringAllowed: boolean;
  code: boolean;
  enabled: boolean;
  interacting: boolean;
};
type Owner = { context: OwnerContext; active: boolean };
type Context = OwnerContext & {
  plan: EditorSnapshot['plan'];
  selection: EditorSnapshot['selection'];
  fragments: Readonly<SavedFragmentsSnapshot>;
  clipboard: Readonly<ClipboardSummary>;
  publication: number;
};
type Permission = { context: Context; active: boolean };
type Prompt = {
  token: object;
  active: boolean;
  generation: Permission;
  owner: Owner;
  item: Readonly<SavedFragmentSummary>;
};
type Receipt = {
  kind: 'save' | 'insert' | 'remove';
  active: boolean;
  owner: Owner;
  initial: EditorSnapshot;
  fragments: Readonly<SavedFragmentsSnapshot>;
  clipboard: Readonly<ClipboardSummary>;
  documents: number;
  collections: number;
  clipboards: number;
  candidate?: EditorSnapshot;
  summary?: Readonly<SavedFragmentsSnapshot>;
  item?: Readonly<SavedFragmentSummary>;
  draft?: Draft;
  prompt?: Prompt;
  name?: string;
  rootCount: number;
  nodeCount: number;
  component?: string;
  sourceTitle: string;
  oldNodeIds: Set<string>;
};
function same<T extends object>(left: T, right: T) {
  return (Object.keys(right) as (keyof T)[]).every((key) => left[key] === right[key]);
}
function nodeCount(node: NodeSchema): number {
  return (
    1 +
    (node.children ?? []).reduce((sum, child) => sum + nodeCount(child), 0) +
    Object.values(node.slots ?? {}).reduce(
      (sum, slot) => sum + slot.children.reduce((total, child) => total + nodeCount(child), 0),
      0,
    )
  );
}
function matchesCollection(actual: Readonly<SavedFragmentsSnapshot>, pending: Receipt) {
  const before = pending.fragments.items;
  if (pending.kind === 'remove') {
    const expected = before.filter((item) => item !== pending.item);
    return (
      actual.items.length === expected.length &&
      expected.every((item, index) => actual.items[index] === item)
    );
  }
  const item = actual.items.at(-1);
  return (
    actual.items.length === before.length + 1 &&
    before.every((old, index) => actual.items[index] === old) &&
    !!item &&
    !before.some((old) => old.id === item.id) &&
    item.name === pending.name &&
    item.sourcePageId === pending.initial.selection.pageId &&
    item.sourcePageTitle === pending.sourceTitle &&
    item.rootCount === pending.rootCount &&
    item.nodeCount === pending.nodeCount &&
    (pending.rootCount === 1
      ? item.component === pending.component
      : !Object.hasOwn(item, 'component'))
  );
}
function matchesInsertion(actual: EditorSnapshot, pending: Receipt) {
  const pageId = pending.initial.selection.pageId;
  const before = pending.initial.plan.pages.get(pageId)!.schema;
  const after = actual.plan.pages.get(pageId)?.schema;
  if (
    actual.plan === pending.initial.plan ||
    actual.selection.pageId !== pageId ||
    actual.revision !== pending.initial.revision + 1 ||
    !after ||
    after.children.length !== before.children.length + pending.rootCount ||
    !before.children.every((node, index) => after.children[index]?.id === node.id)
  )
    return false;
  const ids = after.children.slice(-pending.rootCount).map((node) => node.id);
  const selected = selectedNodeIds(actual.selection);
  return (
    new Set(ids).size === pending.rootCount &&
    ids.every((id) => !pending.oldNodeIds.has(id)) &&
    actual.selection.nodeId === ids[0] &&
    selected.length === ids.length &&
    selected.every((id, index) => id === ids[index]) &&
    (ids.length === 1 ? !actual.selection.nodeIds : !!actual.selection.nodeIds)
  );
}

/** A document-session collection. Captured forests remain private to EditorDocument. */
export function FragmentPanel({
  document,
  snapshot,
  authoringAllowed = false,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed?: boolean;
}) {
  const fragments = useSyncExternalStore(
    document.subscribeSavedFragments,
    document.getSavedFragmentsSnapshot,
    document.getSavedFragmentsSnapshot,
  );
  const clipboard = useSyncExternalStore(
    document.subscribeClipboard,
    document.getClipboardSnapshot,
    document.getClipboardSnapshot,
  );
  const session = useEditorSession();
  const draftEntry = documentDraft(document);
  const [draft, setDraft] = useSessionState(draftEntry.key, draftEntry.initial);
  const readDraft = () =>
    session.drafts.read<Draft>(`ui:${draftEntry.key}`, 'ui', draftEntry.initial).value;
  const drag = useDragDrop();
  const nameId = useId();
  const panel = useRef<HTMLElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const receipt = useRef<Receipt | null>(null);
  const [publication, setPublication] = useState(0);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const promptRef = useRef<Prompt | null>(null);
  const closedPrompt = useRef<Prompt | null>(null);
  const [status, setStatus] = useState<{
    owner: Owner;
    text: string;
    error: boolean;
    prompt?: Prompt;
  } | null>(null);
  const current = useRef({
    document,
    snapshot,
    fragments,
    clipboard,
    authoringAllowed,
    drag,
    readDraft,
  });
  current.current = { document, snapshot, fragments, clipboard, authoringAllowed, drag, readDraft };
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)?.schema;
  const ownerContext: OwnerContext = {
    document,
    pageId: snapshot.selection.pageId,
    authoringAllowed,
    code: !!page?.code?.enabled,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
  };
  const owner = useRef<Owner>({ context: ownerContext, active: true });
  if (!owner.current.active || !same(owner.current.context, ownerContext)) {
    owner.current.active = false;
    if (receipt.current) receipt.current.active = false;
    if (promptRef.current) promptRef.current.active = false;
    owner.current = { context: ownerContext, active: true };
  }
  const capturedOwner = owner.current;
  const context: Context = {
    ...ownerContext,
    plan: snapshot.plan,
    selection: snapshot.selection,
    fragments,
    clipboard,
    publication,
  };
  const permission = useRef<Permission>({ context, active: true });
  if (!permission.current.active || !same(permission.current.context, context)) {
    permission.current.active = false;
    permission.current = { context, active: true };
  }
  const generation = permission.current;
  const allowed =
    authoringAllowed && !page?.code?.enabled && !drag?.isInteracting && drag?.enabled !== false;

  // Draft typing owns author flags, not the ordinary mutation plan/selection generation.
  // Observe even without a receipt, so a live code/drag roundtrip cannot revive its owner.
  const observeAuthorOwner = (target: Owner) => {
    const latest = current.current;
    const captured = target.context;
    const actual = latest.document.getSnapshot();
    if (
      !target.active ||
      latest.document !== captured.document ||
      actual.selection.pageId !== captured.pageId ||
      latest.authoringAllowed !== captured.authoringAllowed ||
      !!actual.plan.pages.get(captured.pageId)?.schema.code?.enabled !== captured.code ||
      (latest.drag?.enabled !== false) !== captured.enabled ||
      !!latest.drag?.isInteracting !== captured.interacting
    ) {
      target.active = false;
      if (owner.current === target) permission.current.active = false;
      if (receipt.current?.owner === target) receipt.current.active = false;
      if (promptRef.current?.owner === target) promptRef.current.active = false;
      return false;
    }
    return true;
  };
  const observe = (rendered?: {
    snapshot: EditorSnapshot;
    fragments: Readonly<SavedFragmentsSnapshot>;
    clipboard: Readonly<ClipboardSummary>;
  }) => {
    observeAuthorOwner(owner.current);
    const pending = receipt.current;
    if (!pending?.active) return;
    const latest = current.current;
    const captured = pending.owner.context;
    const actual = latest.document.getSnapshot();
    const liveFragments = latest.document.getSavedFragmentsSnapshot();
    const liveClipboard = latest.document.getClipboardSnapshot();
    if (
      !pending.owner.active ||
      owner.current !== pending.owner ||
      latest.document !== captured.document ||
      actual.selection.pageId !== captured.pageId ||
      latest.authoringAllowed !== captured.authoringAllowed ||
      !!actual.plan.pages.get(captured.pageId)?.schema.code?.enabled !== captured.code ||
      (latest.drag?.enabled !== false) !== captured.enabled ||
      !!latest.drag?.isInteracting !== captured.interacting
    ) {
      pending.owner.active = false;
      pending.active = false;
      return;
    }
    if (liveClipboard !== pending.clipboard) pending.active = false;
    if (pending.kind === 'insert') {
      if (liveFragments !== pending.fragments) pending.active = false;
      const unchanged =
        actual.plan === pending.initial.plan && actual.selection === pending.initial.selection;
      if (!unchanged) {
        if (
          !matchesInsertion(actual, pending) ||
          (pending.candidate && pending.candidate !== actual)
        )
          pending.active = false;
        else pending.candidate = actual;
      } else if (pending.candidate) pending.active = false;
      if (
        rendered &&
        (rendered.fragments !== pending.fragments ||
          !(
            (rendered.snapshot.plan === pending.initial.plan &&
              rendered.snapshot.selection === pending.initial.selection) ||
            (pending.candidate &&
              rendered.snapshot.plan === pending.candidate.plan &&
              rendered.snapshot.selection === pending.candidate.selection)
          ))
      )
        pending.active = false;
    } else {
      if (
        actual.plan !== pending.initial.plan ||
        actual.selection !== pending.initial.selection ||
        actual.revision !== pending.initial.revision
      )
        pending.active = false;
      if (liveFragments !== pending.fragments) {
        if (
          !matchesCollection(liveFragments, pending) ||
          (pending.summary && pending.summary !== liveFragments)
        )
          pending.active = false;
        else pending.summary = liveFragments;
      } else if (pending.summary) pending.active = false;
      if (
        rendered &&
        (rendered.snapshot.plan !== pending.initial.plan ||
          rendered.snapshot.selection !== pending.initial.selection ||
          (rendered.fragments !== pending.fragments && rendered.fragments !== pending.summary))
      )
        pending.active = false;
    }
    if (rendered && rendered.clipboard !== pending.clipboard) pending.active = false;
  };
  observe({ snapshot, fragments, clipboard });

  const ownRemoval = (target: Prompt) => {
    const pending = receipt.current;
    return (
      pending?.active &&
      pending.kind === 'remove' &&
      pending.prompt === target &&
      pending.owner === target.owner &&
      pending.owner.active
    );
  };
  const inspectPrompt = () => {
    const target = promptRef.current;
    if (
      target &&
      !ownRemoval(target) &&
      (!target.generation.active || permission.current !== target.generation)
    )
      target.active = false;
  };
  inspectPrompt();
  useLayoutEffect(() => {
    mounted.current = true;
    // StrictMode cleanup must not resurrect tokens captured before cleanup.
    if (!owner.current.active || !permission.current.active) {
      owner.current = { context: ownerContext, active: true };
      permission.current = { context, active: true };
      setPublication((value) => value + 1);
    }
    return () => {
      mounted.current = false;
      owner.current.active = false;
      permission.current.active = false;
      if (receipt.current) receipt.current.active = false;
      if (promptRef.current) promptRef.current.active = false;
    };
  }, []);
  useLayoutEffect(() => {
    const changed = () => {
      if (!mounted.current || current.current.document !== document) return;
      permission.current.active = false;
      observe();
      inspectPrompt();
      setPublication((value) => value + 1);
    };
    const stopDocument = document.subscribe(changed);
    const stopFragments = document.subscribeSavedFragments(changed);
    const stopClipboard = document.subscribeClipboard(changed);
    return () => {
      stopDocument();
      stopFragments();
      stopClipboard();
    };
  }, [document]);
  const closePrompt = (target: Prompt) => {
    if (promptRef.current !== target) return;
    closedPrompt.current = target;
    promptRef.current = null;
    setPrompt(null);
  };
  useLayoutEffect(() => {
    if (prompt && !prompt.active) closePrompt(prompt);
  });

  const active = (token: Permission) => {
    observe();
    if (!mounted.current || !token.active || permission.current !== token) return false;
    const latest = current.current;
    const captured = token.context;
    const actual = latest.document.getSnapshot();
    if (
      latest.document !== captured.document ||
      actual.plan !== captured.plan ||
      actual.selection !== captured.selection ||
      latest.snapshot.plan !== captured.plan ||
      latest.snapshot.selection !== captured.selection ||
      actual.selection.pageId !== captured.pageId ||
      latest.document.getSavedFragmentsSnapshot() !== captured.fragments ||
      latest.fragments !== captured.fragments ||
      latest.document.getClipboardSnapshot() !== captured.clipboard ||
      latest.clipboard !== captured.clipboard ||
      latest.authoringAllowed !== captured.authoringAllowed ||
      !!actual.plan.pages.get(captured.pageId)?.schema.code?.enabled !== captured.code ||
      (latest.drag?.enabled !== false) !== captured.enabled ||
      !!latest.drag?.isInteracting !== captured.interacting
    ) {
      token.active = false;
      return false;
    }
    return captured.authoringAllowed && !captured.code && captured.enabled && !captured.interacting;
  };
  const run = (
    kind: Receipt['kind'],
    token: Permission,
    item?: Readonly<SavedFragmentSummary>,
    targetPrompt?: Prompt,
  ) => {
    if (!active(token)) return;
    if (item && !fragments.items.includes(item)) return;
    if (
      kind === 'remove' &&
      (!targetPrompt ||
        !targetPrompt.active ||
        promptRef.current !== targetPrompt ||
        targetPrompt.owner !== owner.current)
    )
      return;
    const initial = document.getSnapshot();
    const source = initial.plan.pages.get(initial.selection.pageId)!.schema;
    const ids = selectedNodeIds(initial.selection);
    if (kind === 'save' && (!ids.length || readDraft() !== draft)) return;
    const roots = kind === 'save' ? topSelectedNodeIds(source, ids) : [];
    const pending: Receipt = {
      kind,
      active: true,
      owner: owner.current,
      initial,
      fragments,
      clipboard,
      documents: 0,
      collections: 0,
      clipboards: 0,
      item,
      prompt: targetPrompt,
      draft: kind === 'save' ? draft : undefined,
      rootCount: kind === 'save' ? roots.length : (item?.rootCount ?? 0),
      nodeCount:
        kind === 'save'
          ? roots.reduce((total, id) => total + nodeCount(findNode(source, id)!.node), 0)
          : (item?.nodeCount ?? 0),
      component:
        kind === 'save' && roots.length === 1
          ? findNode(source, roots[0]!)!.node.component
          : undefined,
      sourceTitle: source.title,
      oldNodeIds: new Set(pageNodeOrder(source)),
    };
    if (receipt.current) receipt.current.active = false;
    receipt.current = pending;
    const stopDocument = document.subscribe(() => {
      pending.documents++;
      if (pending.documents > (kind === 'insert' ? 1 : 0)) pending.active = false;
      observe();
    });
    const stopFragments = document.subscribeSavedFragments(() => {
      pending.collections++;
      if (pending.collections > (kind === 'insert' ? 0 : 1)) pending.active = false;
      observe();
    });
    const stopClipboard = document.subscribeClipboard(() => {
      pending.clipboards++;
      pending.active = false;
    });
    const ownsFeedback = () => {
      observe();
      return (
        mounted.current &&
        pending.active &&
        receipt.current === pending &&
        pending.owner.active &&
        owner.current === pending.owner &&
        current.current.document === document
      );
    };
    let sent = false;
    const feedback = (text: string, error = false) => {
      if (!ownsFeedback()) return;
      const failedPrompt = error && kind === 'remove' ? pending.prompt : undefined;
      if (
        error &&
        kind === 'remove' &&
        (!failedPrompt ||
          !failedPrompt.active ||
          promptRef.current !== failedPrompt ||
          failedPrompt.owner !== pending.owner)
      )
        return;
      sent = true;
      setStatus({ owner: pending.owner, text, error, prompt: failedPrompt });
    };
    try {
      if (kind === 'save') {
        pending.name = normalizeSavedFragmentName(draft.text);
        const id = document.saveFragment(initial.selection.pageId, ids, draft.text);
        const actual = document.getSavedFragmentsSnapshot();
        if (
          !ownsFeedback() ||
          pending.documents !== 0 ||
          pending.collections !== 1 ||
          pending.clipboards !== 0 ||
          actual !== pending.summary ||
          actual.items.at(-1)?.id !== id ||
          readDraft() !== draft
        )
          return;
        setDraft((previous) =>
          previous === draft && ownsFeedback() ? { text: '', token: {} } : previous,
        );
        feedback(`已保存会话片段「${pending.name}」。`);
      } else if (kind === 'insert') {
        const inserted = document.insertSavedFragment(initial.selection.pageId, item!.id);
        const actual = document.getSnapshot();
        const selected = selectedNodeIds(actual.selection);
        if (
          !ownsFeedback() ||
          pending.documents !== 1 ||
          pending.collections !== 0 ||
          pending.clipboards !== 0 ||
          actual !== pending.candidate ||
          !Array.isArray(inserted) ||
          inserted.length !== pending.rootCount ||
          !inserted.every((id, index) => selected[index] === id)
        )
          return;
        feedback(`已插入「${item!.name}」到页面末尾，可撤销。`);
      } else {
        document.removeSavedFragment(item!.id);
        if (
          !ownsFeedback() ||
          pending.documents !== 0 ||
          pending.collections !== 1 ||
          pending.clipboards !== 0 ||
          document.getSavedFragmentsSnapshot() !== pending.summary
        )
          return;
        closePrompt(targetPrompt!);
        feedback(`已删除会话片段「${item!.name}」，已插入的副本不受影响。`);
      }
    } catch (reason) {
      const actual = document.getSnapshot();
      if (
        !sent &&
        ownsFeedback() &&
        pending.documents === 0 &&
        pending.collections === 0 &&
        pending.clipboards === 0 &&
        actual.plan === initial.plan &&
        actual.selection === initial.selection &&
        actual.revision === initial.revision &&
        document.getSavedFragmentsSnapshot() === fragments &&
        document.getClipboardSnapshot() === clipboard &&
        (kind !== 'save' || readDraft() === draft) &&
        active(token)
      )
        feedback(errorText(reason), true);
    } finally {
      stopDocument();
      stopFragments();
      stopClipboard();
      pending.active = false;
      if (receipt.current === pending) receipt.current = null;
      inspectPrompt();
    }
  };
  const openRemoval = (item: Readonly<SavedFragmentSummary>) => {
    if (!active(generation) || !fragments.items.includes(item)) return;
    if (promptRef.current) promptRef.current.active = false;
    const next: Prompt = { token: {}, active: true, generation, owner: owner.current, item };
    closedPrompt.current = null;
    promptRef.current = next;
    setPrompt(next);
  };
  const ownedStatus = status?.owner === owner.current && status.owner.active ? status : null;
  const visibleStatus = ownedStatus && !ownedStatus.prompt ? ownedStatus : null;
  const promptError =
    ownedStatus?.error &&
    prompt?.active &&
    promptRef.current === prompt &&
    ownedStatus.prompt === prompt
      ? ownedStatus
      : null;
  return (
    <section className="fragment-panel" aria-label="会话片段" ref={panel} tabIndex={-1}>
      <div className="fragment-heading">
        <Tip
          content="把选中的静态组件存为片段，在本文档的其他页面插入；不包含页面代码、CSS 或模型。"
          side="right"
        >
          <strong tabIndex={0}>会话片段</strong>
        </Tip>
        <span>
          {fragments.items.length} / {SAVED_FRAGMENT_LIMIT}
        </span>
      </div>
      <div className="fragment-save">
        <label htmlFor={nameId}>片段名称 · 最多 {SAVED_FRAGMENT_NAME_LIMIT} 个字符</label>
        <Input
          id={nameId}
          value={draft.text}
          placeholder="例如：页面页头"
          disabled={!allowed}
          onChange={(event) => {
            if (
              !mounted.current ||
              owner.current !== capturedOwner ||
              !capturedOwner.active ||
              !observeAuthorOwner(capturedOwner) ||
              !allowed ||
              current.current.document !== document ||
              readDraft() !== draft
            )
              return;
            const next = { text: event.target.value, token: {} };
            setDraft((previous) => (previous === draft ? next : previous));
          }}
        />
        <Button
          disabled={!allowed || !selectedNodeIds(snapshot.selection).length}
          onClick={() => run('save', generation)}
        >
          <Archive size={14} aria-hidden="true" /> 保存所选
        </Button>
      </div>
      <p className="editor-note">
        仅当前会话保留，导入应用文件会保留会话片段；片段仅含静态组件与内联样式，插入的副本可撤销。
      </p>
      {visibleStatus && (
        <p
          className={`fragment-feedback${visibleStatus.error ? ' is-error' : ''}`}
          role={visibleStatus.error ? 'alert' : 'status'}
        >
          {visibleStatus.text}
        </p>
      )}
      <ul className="fragment-list" aria-label="已保存的会话片段">
        {fragments.items.map((item) => (
          <li className="fragment-row" key={item.id}>
            <div className="fragment-info">
              <Tip content={`${item.name} · 来自 ${item.sourcePageTitle}`} side="right">
                <span className="fragment-name" tabIndex={0}>
                  {item.name}
                </span>
              </Tip>
              <span className="fragment-count">
                {item.rootCount} 个顶层组件 · 共 {item.nodeCount} 个组件
              </span>
            </div>
            <div className="fragment-actions">
              <Tip content={`插入「${item.name}」到页面末尾`}>
                <Button
                  variant="ghost"
                  aria-label={`插入会话片段 ${item.name}`}
                  disabled={!allowed}
                  onClick={() => run('insert', generation, item)}
                >
                  <Plus size={14} aria-hidden="true" />
                </Button>
              </Tip>
              <Tip content={`删除会话片段「${item.name}」`}>
                <Button
                  variant="ghost"
                  aria-label={`删除会话片段 ${item.name}`}
                  disabled={!allowed}
                  onClick={() => openRemoval(item)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              </Tip>
            </div>
          </li>
        ))}
      </ul>
      {!fragments.items.length && (
        <p className="editor-note">选中组件并命名保存，即可在其他页面插入。</p>
      )}
      <AlertDialog.Root
        open={!!prompt?.active}
        onOpenChange={(open) => {
          if (!open && prompt) closePrompt(prompt);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="material-modal-backdrop" />
          <AlertDialog.Popup
            className="material-modal project-confirmation fragment-confirmation"
            initialFocus={cancel}
            finalFocus={() => {
              const closed = closedPrompt.current;
              return mounted.current &&
                !promptRef.current &&
                closed?.active &&
                closed.owner === owner.current &&
                closed.owner.active
                ? panel.current
                : false;
            }}
          >
            <AlertDialog.Title className="project-confirmation-title">
              删除会话片段？
            </AlertDialog.Title>
            <AlertDialog.Description className="project-confirmation-description">
              删除「{prompt?.item.name}」后，页面撤销无法恢复该片段；已插入页面的副本不受影响。
            </AlertDialog.Description>
            {promptError && (
              <p className="fragment-feedback is-error" role="alert">
                {promptError.text}
              </p>
            )}
            <div className="project-confirmation-actions">
              <Button
                ref={cancel}
                onClick={() => {
                  if (prompt) closePrompt(prompt);
                }}
              >
                取消
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (prompt) run('remove', prompt.generation, prompt.item, prompt);
                }}
              >
                确认删除
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </section>
  );
}
