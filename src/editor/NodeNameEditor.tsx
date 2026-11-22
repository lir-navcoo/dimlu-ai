import { useId, useLayoutEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { normalizeNodeName, readNodeName } from '../../packages/schema/node-name';
import type { NodeSchema } from '../../packages/schema/types';
import { Button, Input, Tip } from '../ui/primitives';
import { useAuthorGuard } from './author-guard';
import { useDragDrop } from './DragDrop';
import { DraftNotice, useDraft } from './session';
import { errorText } from './errors';
import './node-name-editor.css';

export function NodeNameEditor({
  document,
  snapshot,
  node,
  fallback,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  node: NodeSchema;
  fallback: string;
}) {
  const { pageId } = snapshot.selection;
  const key = `node-name:${pageId}/${node.id}`;
  const name = readNodeName(node);
  const [draft, setDraft, status] = useDraft(key, JSON.stringify(name) ?? 'unset', {
    text: name ?? '',
    error: '',
  });
  const latest = useRef({ draft, status });
  latest.current = { draft, status };
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const drag = useDragDrop();
  const id = useId();
  // Successful own commands change plan and normalize selection identity. Their
  // completion may survive those changes, but never a different author domain.
  const ownerContext = {
    key,
    document,
    selection: JSON.stringify(snapshot.selection),
    pageId,
    nodeId: node.id,
    component: node.component,
    enabled: drag?.enabled !== false,
    interacting: !!drag?.isInteracting,
    code: !!snapshot.plan.pages.get(pageId)?.schema.code?.enabled,
  };
  const lifetime = useRef({ context: ownerContext, active: true });
  if (
    !lifetime.current.active ||
    (Object.keys(ownerContext) as (keyof typeof ownerContext)[]).some(
      (field) => lifetime.current.context[field] !== ownerContext[field],
    )
  ) {
    lifetime.current.active = false;
    lifetime.current = { context: ownerContext, active: true };
  }
  const owner = lifetime.current;
  useLayoutEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
    };
  }, [owner]);
  const context = { ...ownerContext, plan: snapshot.plan, rawSelection: snapshot.selection };
  const permission = useRef({ context, active: true });
  if (
    !permission.current.active ||
    (Object.keys(context) as (keyof typeof context)[]).some(
      (field) => permission.current.context[field] !== context[field],
    )
  ) {
    permission.current.active = false;
    permission.current = { context, active: true };
  }
  const generation = permission.current;
  const active = () => {
    if (
      !owner.active ||
      lifetime.current !== owner ||
      !generation.active ||
      permission.current !== generation
    )
      return false;
    const current = document.getSnapshot();
    const target = current.plan.pages.get(pageId)?.schema;
    if (
      current.plan !== snapshot.plan ||
      current.selection !== snapshot.selection ||
      (drag?.enabled !== false) !== context.enabled ||
      !!drag?.isInteracting !== context.interacting ||
      !target ||
      findNode(target, node.id)?.node.component !== node.component
    ) {
      generation.active = false;
      return false;
    }
    return canAuthor();
  };
  const localRevision = useRef(0);
  const edit = (text: string) => {
    if (!active()) return;
    localRevision.current++;
    const value = { text, error: '' };
    latest.current = { ...latest.current, draft: value };
    setDraft(value);
  };
  const apply = () => {
    if (!active() || latest.current.status.stale) return;
    try {
      const expected = normalizeNodeName(latest.current.draft.text);
      const revision = localRevision.current;
      const changed = document.setNodeName(pageId, node.id, latest.current.draft.text);
      const current = document.getSnapshot();
      const target = current.plan.pages.get(pageId)?.schema;
      const currentNode = target && findNode(target, node.id)?.node;
      const accepted =
        currentNode &&
        readNodeName(currentNode) === expected &&
        (changed === true ||
          (changed === false &&
            current.plan === snapshot.plan &&
            current.selection === snapshot.selection));
      // Exact synchronous success/no-op completion only. The own new plan may have
      // expired permission; key, owner and local input must still belong to this call.
      if (
        accepted &&
        owner.active &&
        lifetime.current === owner &&
        revision === localRevision.current
      ) {
        generation.active = false;
        localRevision.current++;
        status.reset();
      }
    } catch (error) {
      if (!active()) return;
      localRevision.current++;
      setDraft((current) => ({ ...current, error: errorText(error) }));
    }
  };
  return (
    <section className="node-name-editor" role="group" aria-label="编辑器名称设置">
      <label htmlFor={id}>编辑器名称</label>
      <DraftNotice
        {...status}
        reset={() => {
          if (!active()) return;
          generation.active = false;
          localRevision.current++;
          status.reset();
        }}
        rebase={() => {
          if (!active()) return;
          localRevision.current++;
          latest.current.status.rebase();
        }}
      />
      <div className="node-name-entry">
        <Input
          id={id}
          aria-label="编辑器名称"
          value={draft.text}
          placeholder={fallback}
          onChange={(event) => edit(event.target.value)}
        />
        <Tip content="应用编辑器名称，留空恢复默认名称">
          <Button
            aria-label="应用编辑器名称"
            disabled={!status.dirty || status.stale}
            onClick={apply}
          >
            <Check size={13} />
          </Button>
        </Tip>
      </div>
      {draft.error && (
        <p className="property-error" role="alert">
          {draft.error}
        </p>
      )}
    </section>
  );
}
