import { useState } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import { errorText } from '../editor/errors';
import { DraftNotice, useDraft } from '../editor/session';
import { CodeEditor } from '../ui/CodeEditor';
import { Button } from '../ui/primitives';

export function PageActionCodePanel({
  document,
  snapshot,
  authoringAllowed = true,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed?: boolean;
}) {
  const { pageId } = snapshot.selection;
  const saved = snapshot.plan.pages.get(pageId)!.schema.actionCode?.source;
  const [source, setSource, status] = useDraft(
    `page-action-code:${pageId}`,
    JSON.stringify(saved) ?? 'unset',
    saved ?? '',
  );
  const [notice, setNotice] = useState<{ error: boolean; text: string }>();
  const isCurrent = () => document.getSnapshot() === snapshot;
  const change = (next: string) => {
    if (!authoringAllowed || !isCurrent()) return;
    setSource(next);
    setNotice(undefined);
  };
  const save = () => {
    if (!authoringAllowed || !isCurrent() || status.stale) return;
    try {
      document.setPageActionCode(pageId, source.trim() ? { source } : undefined);
      status.reset();
      setNotice({ error: false, text: '页面动作代码已保存。' });
    } catch (error) {
      setNotice({ error: true, text: `保存失败：${errorText(error)}` });
    }
  };
  const discard = () => {
    if (!authoringAllowed || !isCurrent()) return;
    status.reset();
    setNotice(undefined);
  };
  return (
    <section className="page-code-panel page-action-code-panel" aria-label="页面动作代码编辑区">
      <div className="page-code-scroll">
        <DraftNotice
          {...status}
          reset={discard}
          readOnly={!authoringAllowed}
          rebase={() => {
            if (authoringAllowed && isCurrent()) status.rebase();
          }}
        />
        <CodeEditor
          label="页面动作源码"
          language="javascript"
          value={source}
          onChange={change}
          fill
          readOnly={!authoringAllowed}
        />
        {notice?.error ? (
          <pre className="field-error" role="alert">
            {notice.text}
          </pre>
        ) : (
          notice && (
            <p className="editor-note" role="status">
              {notice.text}
            </p>
          )
        )}
      </div>
      <div className="page-code-actions">
        <Button variant="primary" disabled={!authoringAllowed || status.stale} onClick={save}>
          保存动作代码
        </Button>
        <Button disabled={!authoringAllowed || !status.dirty} onClick={discard}>
          放弃动作草稿
        </Button>
      </div>
    </section>
  );
}
