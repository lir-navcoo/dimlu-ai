import { useLayoutEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { PageCode } from '../../packages/schema/types';
import { Button, Checkbox, Select } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import { DraftNotice, useDraft } from '../editor/session';
import { errorText } from '../editor/errors';
import { PageActionCodePanel } from './PageActionCodePanel';

export const starterPageCode: PageCode = {
  enabled: false,
  language: 'tsx',
  source: `import { useState } from 'react';

export default function Page() {
  const [count, setCount] = useState(0);
  return (
    <main className="page">
      <h1>我的 React 页面</h1>
      <p>在平台内编写 JSX / TSX，使用原生 React Hooks。</p>
      <button onClick={() => setCount(count + 1)}>点击次数：{count}</button>
    </main>
  );
}
`,
  css: `.page { margin: 16px; padding: 24px; color: #172033; font: 14px/1.6 system-ui; }
.page button { padding: 6px 12px; border: 1px solid #c8d2e2; border-radius: 6px; background: white; cursor: pointer; }
`,
};

type CodePanelProps = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  variant?: 'workspace' | 'settings' | 'combined';
  authoringAllowed?: boolean;
  /** 右侧检查器只需要控制项，编辑器只在画布工作区挂载一次。 */
  controlsOnly?: boolean;
};

export function CodePanel(props: CodePanelProps) {
  // React 页面代码在编辑态画布内直接用 Monaco 编辑；面板只保留页面动作源码编辑器。
  return <PageActionCodePanel {...props} />;
}

export function ReactCodePanel({
  document,
  snapshot,
  variant = 'combined',
  authoringAllowed = true,
  controlsOnly = false,
}: CodePanelProps) {
  const { pageId } = snapshot.selection;
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const source = JSON.stringify(page.code) ?? 'unset';
  const [draft, setDraft, status] = useDraft(
    `page-code:${pageId}`,
    source,
    page.code ?? starterPageCode,
  );
  const [tab, setTab] = useState('source');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const generation = useRef(0);
  const identity = useRef({ document, version: 0 });
  if (identity.current.document !== document)
    identity.current = { document, version: identity.current.version + 1 };
  const documentVersion = identity.current.version;
  const canAuthor = useRef(authoringAllowed);
  canAuthor.current = authoringAllowed;
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const request = useRef(0);
  const version = ++generation.current;
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  useLayoutEffect(() => {
    setBusy(false);
    setError('');
    setMessage('');
    return () => {
      request.current++;
    };
  }, [document, pageId, authoringAllowed]);
  const active = () =>
    mounted.current &&
    version === generation.current &&
    document.getSnapshot().revision === snapshot.revision &&
    document.getSnapshot().selection.pageId === pageId;
  const change = (next: PageCode | ((current: PageCode) => PageCode)) => {
    if (!authoringAllowed || !active()) return;
    request.current++;
    setBusy(false);
    setError('');
    setMessage('');
    setDraft(next);
  };
  const apply = async () => {
    if (!authoringAllowed || !active() || status.stale || busy) return;
    const token = ++request.current;
    const expectedRevision = snapshot.revision;
    const expectedDraft = JSON.stringify(draft);
    const code = variant === 'settings' && page.code?.enabled ? { ...draft, enabled: true } : draft;
    setBusy(true);
    setError('');
    setMessage('');
    const stillCurrent = () =>
      mounted.current &&
      canAuthor.current &&
      token === request.current &&
      identity.current.document === document &&
      identity.current.version === documentVersion &&
      JSON.stringify(currentDraft.current) === expectedDraft &&
      document.getSnapshot().revision === expectedRevision &&
      document.getSnapshot().selection.pageId === pageId &&
      document.getSnapshot().plan.pages.get(pageId) !== undefined;
    try {
      const { compilePageCode } = await import('./compiler');
      if (!stillCurrent()) return;
      compilePageCode(code);
      if (!stillCurrent()) return;
      document.setPageCode(pageId, code);
      status.reset();
      setMessage('页面代码已保存。切换预览运行。');
    } catch (reason) {
      if (stillCurrent()) setError(errorText(reason));
    } finally {
      if (mounted.current && token === request.current) setBusy(false);
    }
  };
  const abandon = () => {
    if (authoringAllowed && active()) {
      request.current++;
      setBusy(false);
      setError('');
      setMessage('');
      status.reset();
    }
  };
  const disable = () => {
    if (!authoringAllowed || !active()) return;
    request.current++;
    setBusy(false);
    setError('');
    setMessage('');
    try {
      if (page.code) document.setPageCode(pageId, { ...page.code, enabled: false });
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const workspace = variant === 'workspace';
  const settings = variant !== 'workspace';
  const showWorkspace = variant !== 'settings';
  const showEditor = !controlsOnly && showWorkspace;
  return (
    <section
      className={`page-code-panel react-code-panel ${workspace ? 'is-workspace' : 'is-settings'}`}
      aria-label={workspace ? '页面代码编辑器' : '页面代码设置'}
    >
      {settings && (
        <div className="page-code-settings-controls">
          <p className="editor-note">
            默认导出 React 组件替代当前页面视图。原组件结构保留，禁用代码即可恢复。
          </p>
          {(variant === 'combined' || !page.code?.enabled) && (
            <label className="page-code-enable">
              <Checkbox
                checked={draft.enabled}
                disabled={!authoringAllowed}
                aria-label="启用页面代码"
                onCheckedChange={(enabled) =>
                  change((current) => ({ ...current, enabled: !!enabled }))
                }
              />
              启用页面代码
            </label>
          )}
          <label className="action-parameter">
            <span>代码语言</span>
            <Select
              aria-label="页面代码语言"
              value={draft.language}
              disabled={!authoringAllowed}
              onValueChange={(language) => {
                if (language === 'jsx' || language === 'tsx')
                  change((current) => ({ ...current, language }));
              }}
            >
              <option value="jsx">JSX</option>
              <option value="tsx">TSX</option>
            </Select>
          </label>
          <DraftNotice
            {...status}
            reset={abandon}
            readOnly={!authoringAllowed}
            rebase={() => {
              if (authoringAllowed && active()) status.rebase();
            }}
          />
          {error && (
            <pre className="field-error" role="alert">
              {error}
            </pre>
          )}
          {message && (
            <p role="status" className="editor-note">
              {message}
            </p>
          )}
          <p className="editor-note">
            支持
            react、react/jsx-runtime、@dimlu/runtime。保存只校验，不运行。代码在当前窗口执行，请仅运行可信代码。
          </p>
          <div className="page-code-actions">
            <Button
              variant="primary"
              disabled={!authoringAllowed || busy || status.stale}
              onClick={() => void apply()}
            >
              {busy ? '正在校验…' : '保存并应用'}
            </Button>
            <Button disabled={!authoringAllowed || (!status.dirty && !busy)} onClick={abandon}>
              放弃
            </Button>
            <Button disabled={!authoringAllowed || !page.code?.enabled} onClick={disable}>
              禁用代码
            </Button>
          </div>
        </div>
      )}
      {showEditor && (
        <Tabs.Root
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="page-code-tabs"
        >
          <Tabs.List className="property-tabs" aria-label="页面代码文件">
            <Tabs.Tab value="source">{draft.language === 'tsx' ? 'TSX' : 'JSX'}</Tabs.Tab>
            <Tabs.Tab value="css">CSS</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="source">
            <CodeEditor
              label="页面 React 代码"
              language={draft.language === 'tsx' ? 'typescript' : 'javascript'}
              value={draft.source}
              onChange={(text) => change((current) => ({ ...current, source: text }))}
              readOnly={!authoringAllowed}
              fill
            />
          </Tabs.Panel>
          <Tabs.Panel value="css">
            <CodeEditor
              label="页面 CSS"
              language="css"
              value={draft.css}
              onChange={(text) => change((current) => ({ ...current, css: text }))}
              readOnly={!authoringAllowed}
              fill
            />
          </Tabs.Panel>
        </Tabs.Root>
      )}
    </section>
  );
}
