import { useLayoutEffect, useRef, useState } from 'react';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { ApplicationMethodReference } from '../../packages/editor/data';
import { Button } from '../ui/primitives';
import { PageLifecyclePanel } from './PageLifecyclePanel';
import type { OpenApplicationMethods } from './ActionPanel';
import { ReactCodePanel, starterPageCode } from '../code/CodePanel';
import { errorText } from './errors';
import { CodeEditor } from '../ui/CodeEditor';
import { DraftNotice, useDraft } from './session';
import { useAuthorGuard } from './author-guard';
import { Tabs } from '@base-ui/react/tabs';

/**
 * 右侧检查器中的页面设置：未选中组件或启用页面代码时显示。
 */
export function PageSettingsPanel({
  document,
  snapshot,
  authoringAllowed = false,
  onOpenMethods,
  focusReference,
  pageLogicRequest,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed?: boolean;
  onOpenMethods?: OpenApplicationMethods;
  focusReference?: ApplicationMethodReference;
  pageLogicRequest?: object;
}) {
  const { pageId } = snapshot.selection;
  const codeEnabled = !!snapshot.plan.pages.get(pageId)!.schema.code?.enabled;
  const [selectedSection, setSection] = useState<'logic' | 'css' | 'code'>(() =>
    pageLogicRequest || focusReference || !codeEnabled ? 'logic' : 'code',
  );
  useLayoutEffect(() => {
    if (codeEnabled) setSection('code');
  }, [codeEnabled, pageId]);
  useLayoutEffect(() => {
    if (pageLogicRequest || focusReference) setSection('logic');
  }, [pageLogicRequest, focusReference]);
  const section = codeEnabled && selectedSection === 'css' ? 'code' : selectedSection;
  return (
    <div className="page-settings">
      <Tabs.Root
        className="page-settings-tabs-root"
        value={section}
        onValueChange={(value) => setSection(value as 'logic' | 'css' | 'code')}
      >
        <Tabs.List className="page-settings-tabs" aria-label="页面设置">
          <Tabs.Tab value="logic">页面逻辑</Tabs.Tab>
          {!codeEnabled && <Tabs.Tab value="css">页面 CSS</Tabs.Tab>}
          <Tabs.Tab value="code">页面代码</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="logic" keepMounted>
          {section === 'logic' && (
            <PageLifecyclePanel
              key={snapshot.selection.pageId}
              document={document}
              snapshot={snapshot}
              authoringAllowed={authoringAllowed}
              onOpenMethods={onOpenMethods}
              focusReference={focusReference}
            />
          )}
        </Tabs.Panel>
        {!codeEnabled && (
          <Tabs.Panel value="css" keepMounted>
            {section === 'css' && (
              <PageCssEntry
                key={pageId}
                document={document}
                snapshot={snapshot}
                authoringAllowed={authoringAllowed}
              />
            )}
          </Tabs.Panel>
        )}
        <Tabs.Panel value="code" keepMounted>
          {section === 'code' && (
            <PageCodeEntry
              document={document}
              snapshot={snapshot}
              authoringAllowed={authoringAllowed}
            />
          )}
        </Tabs.Panel>
      </Tabs.Root>
    </div>
  );
}

function PageCssEntry({
  document,
  snapshot,
  authoringAllowed,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed: boolean;
}) {
  const { pageId } = snapshot.selection;
  const saved = snapshot.plan.pages.get(pageId)!.schema.css ?? '';
  const initial = saved || ':root {\n}';
  const [draft, setDraft, status] = useDraft(`page-css:${pageId}`, saved, initial);
  const [error, setError] = useState('');
  const canAuthor = useAuthorGuard(document, snapshot, undefined, authoringAllowed);
  useLayoutEffect(() => setError(''), [document, pageId, saved]);
  const apply = () => {
    if (!canAuthor() || !status.dirty || status.stale) return;
    try {
      document.setPageCss(pageId, draft);
      status.reset();
      setError('');
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <div className="page-code-entry">
      <DraftNotice
        {...status}
        readOnly={!authoringAllowed}
        reset={() => {
          if (!canAuthor()) return;
          status.reset();
          setError('');
        }}
        rebase={() => {
          if (!canAuthor()) return;
          status.rebase();
          setError('');
        }}
      />
      <CodeEditor
        label="普通页面 CSS 源码"
        language="css"
        value={draft}
        height={210}
        readOnly={!authoringAllowed}
        placeholder=""
        onChange={(value) => {
          if (!canAuthor()) return;
          setDraft(value);
          setError('');
        }}
      />
      <Button
        type="button"
        variant="primary"
        disabled={!authoringAllowed || !status.dirty || status.stale}
        onClick={apply}
      >
        保存页面 CSS
      </Button>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function PageCodeEntry({
  document,
  snapshot,
  authoringAllowed,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  authoringAllowed: boolean;
}) {
  const { pageId } = snapshot.selection;
  const enabled = !!snapshot.plan.pages.get(pageId)!.schema.code?.enabled;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const activation = useRef<object | null>(null);
  useLayoutEffect(() => {
    setPending(false);
    setError('');
    return () => {
      activation.current = null;
    };
  }, [document, pageId, authoringAllowed]);
  const open = async () => {
    if (!authoringAllowed || activation.current || document.getSnapshot() !== snapshot) return;
    const token = {};
    activation.current = token;
    const code = {
      ...(snapshot.plan.pages.get(pageId)!.schema.code ?? starterPageCode),
      enabled: true,
    };
    setPending(true);
    setError('');
    try {
      const { compilePageCode } = await import('../code/compiler');
      if (activation.current !== token || document.getSnapshot() !== snapshot) return;
      compilePageCode(code);
      document.setPageCode(pageId, code);
    } catch (reason) {
      if (activation.current === token) setError(errorText(reason));
    } finally {
      if (activation.current === token) {
        activation.current = null;
        setPending(false);
      }
    }
  };
  return (
    <div className="page-code-entry">
      {!enabled ? (
        <>
          <p className="editor-note">
            页面代码用 React / TSX 替换当前页面视图。启用后，画布将切换为 TSX 与 CSS 编辑工作区。
          </p>
          <Button
            type="button"
            variant="primary"
            disabled={!authoringAllowed || pending}
            onClick={() => void open()}
          >
            {pending ? '正在校验…' : '启用页面代码'}
          </Button>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </>
      ) : (
        <ReactCodePanel
          key={pageId}
          document={document}
          snapshot={snapshot}
          variant="settings"
          controlsOnly
          authoringAllowed={authoringAllowed}
        />
      )}
    </div>
  );
}
