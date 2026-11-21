import { useCallback, useLayoutEffect, useRef } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { ApplicationMethodReference } from '../../packages/editor/data';
import { selectedNodeIds } from '../../packages/editor/selection';
import { Button } from '../ui/primitives';
import { ActionChainEditor, type OpenApplicationMethods } from './ActionPanel';
import { useAuthorGuard } from './author-guard';
import { useDragDrop } from './DragDrop';

/** Page entry is authored independently of component selection and event scopes. */
export function PageLifecyclePanel({
  document,
  snapshot,
  authoringAllowed,
  onOpenMethods,
  focusReference,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed: boolean;
  onOpenMethods?: OpenApplicationMethods;
  focusReference?: ApplicationMethodReference;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, undefined, authoringAllowed);
  const canOpenMethods = useAuthorGuard(
    document,
    snapshot,
    undefined,
    authoringAllowed,
    'navigation',
  );
  const drag = useDragDrop();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const page = snapshot.plan.pages.get(snapshot.selection.pageId)!.schema;
  const source = JSON.stringify(page);
  const current = useRef({ document, snapshot, pageId: page.id, source, authoringAllowed, drag });
  current.current = { document, snapshot, pageId: page.id, source, authoringAllowed, drag };
  const canReference = useCallback(() => {
    const target = current.current;
    const actual = document.getSnapshot();
    const live = actual.plan.pages.get(page.id)?.schema;
    return (
      canAuthor() &&
      mounted.current &&
      authoringAllowed &&
      target.authoringAllowed &&
      target.document === document &&
      target.pageId === page.id &&
      target.source === source &&
      target.snapshot.plan === snapshot.plan &&
      target.snapshot.selection === snapshot.selection &&
      actual.plan === snapshot.plan &&
      actual.selection === snapshot.selection &&
      live === page &&
      live.onEnter === page.onEnter &&
      JSON.stringify(live) === source
    );
  }, [document, snapshot.plan, snapshot.selection, page, source, authoringAllowed]);
  const preflight = () => {
    if (canAuthor()) return true;
    const target = current.current;
    const actual = document.getSnapshot();
    const live = actual.plan.pages.get(page.id)?.schema;
    // A schema publication also recreates selection identity. Equal selection values
    // permit only this diagnostic; author writes still require the strict guard above.
    if (
      mounted.current &&
      authoringAllowed &&
      target.authoringAllowed &&
      target.document === document &&
      target.snapshot === snapshot &&
      target.drag?.enabled !== false &&
      !target.drag?.isInteracting &&
      live &&
      !live.code?.enabled &&
      selectedNodeIds(actual.selection).length < 2 &&
      JSON.stringify(actual.selection) === JSON.stringify(snapshot.selection) &&
      JSON.stringify(live) !== source
    )
      throw new Error('页面定义已变化，请确认或放弃草稿后再保存');
    return false;
  };
  return (
    <section className="action-panel" aria-label="页面生命周期配置">
      {onOpenMethods && (
        <Button
          type="button"
          variant="ghost"
          className="page-logic-methods-button"
          disabled={!authoringAllowed || !!drag?.isInteracting}
          onClick={(event) => {
            if (canOpenMethods()) onOpenMethods(event.currentTarget);
          }}
        >
          应用自定义方法
        </Button>
      )}
      <h3>页面进入时</h3>
      <p className="editor-note">
        编辑时保存配置不会执行动作。页面实例首次进入预览时执行；重置页面或应用定义变更后会创建新实例。
      </p>
      {!authoringAllowed && (
        <p className="editor-note">当前为预览模式，请切回编辑模式配置进入动作。</p>
      )}
      <ActionChainEditor
        key={page.id}
        page={page}
        existing={page.onEnter ?? []}
        focusReference={focusReference}
        onOpenMethods={
          onOpenMethods && ((trigger, target) => canOpenMethods() && onOpenMethods(trigger, target))
        }
        draftKey={`page-enter:${page.id}`}
        source={source}
        pageScope
        pageReference={{
          document,
          snapshot,
          pageId: page.id,
          savedActions: page.onEnter,
          pageSource: source,
          canReference,
        }}
        authoringAllowed={authoringAllowed}
        canSave={preflight}
        saveLabel="保存进入动作"
        onSave={(calls) => {
          if (!preflight()) return;
          const target = current.current;
          if (!target.authoringAllowed) throw new Error('请切回编辑模式保存进入动作');
          const live = target.document.getSnapshot().plan.pages.get(target.pageId)?.schema;
          if (!live || JSON.stringify(live) !== target.source)
            throw new Error('页面定义已变化，请确认或放弃草稿后再保存');
          return target.document.setPageEnterActions(target.pageId, calls);
        }}
      />
    </section>
  );
}
