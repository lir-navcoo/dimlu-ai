import { useEffect, useRef, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import type { EditorDocument, EditorSnapshot } from '../../packages/editor/document';
import type { PageCode } from '../../packages/schema/types';
import { Button, Checkbox, Select } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import { DraftNotice, useDraft } from '../editor/session';
import { errorText } from '../editor/errors';

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
  css: `.page { padding: 24px; color: #172033; font: 14px/1.6 system-ui; }
.page button { padding: 6px 12px; border: 1px solid #c8d2e2; border-radius: 6px; background: white; cursor: pointer; }
`,
};

export function CodePanel({
  document,
  snapshot,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
}) {
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
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const request = useRef(0);
  const version = ++generation.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  const active = () =>
    mounted.current &&
    version === generation.current &&
    document.getSnapshot().revision === snapshot.revision &&
    document.getSnapshot().selection.pageId === pageId;
  const change = (next: PageCode) => {
    if (!active()) return;
    request.current++;
    setBusy(false);
    setError('');
    setMessage('');
    setDraft(next);
  };
  const apply = async () => {
    if (!active() || status.stale || busy) return;
    const token = ++request.current;
    const expectedRevision = snapshot.revision;
    const expectedDraft = JSON.stringify(draft);
    setBusy(true);
    setError('');
    setMessage('');
    const stillCurrent = () =>
      mounted.current &&
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
      compilePageCode(JSON.parse(expectedDraft) as PageCode);
      if (!stillCurrent()) return;
      document.setPageCode(pageId, JSON.parse(expectedDraft) as PageCode);
      status.reset();
      setMessage('页面代码已保存。切换预览运行。');
    } catch (reason) {
      if (stillCurrent()) setError(errorText(reason));
    } finally {
      if (mounted.current && token === request.current) setBusy(false);
    }
  };
  const abandon = () => {
    if (active()) {
      request.current++;
      setBusy(false);
      setError('');
      setMessage('');
      status.reset();
    }
  };
  const disable = () => {
    if (!active()) return;
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
  return (
    <section className="page-code-panel" aria-label="页面代码">
      <p className="editor-note">
        默认导出 React 组件替代当前页面视图。原组件结构保留，禁用代码即可恢复。
      </p>
      <label className="page-code-enable">
        <Checkbox
          checked={draft.enabled}
          aria-label="启用页面代码"
          onCheckedChange={(enabled) => change({ ...draft, enabled: !!enabled })}
        />
        启用页面代码
      </label>
      <label className="action-parameter">
        <span>代码语言</span>
        <Select
          aria-label="页面代码语言"
          value={draft.language}
          onValueChange={(language) => {
            if (language === 'jsx' || language === 'tsx') change({ ...draft, language });
          }}
        >
          <option value="jsx">JSX</option>
          <option value="tsx">TSX</option>
        </Select>
      </label>
      <DraftNotice
        {...status}
        reset={abandon}
        rebase={() => {
          if (active()) status.rebase();
        }}
      />
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="page-code-tabs"
      >
        <Tabs.List className="property-tabs" aria-label="页面代码文件">
          <Tabs.Tab value="source">{draft.language.toUpperCase()}</Tabs.Tab>
          <Tabs.Tab value="css">CSS</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="source">
          <CodeEditor
            label="页面 React 代码"
            language={draft.language === 'tsx' ? 'typescript' : 'javascript'}
            value={draft.source}
            onChange={(text) => change({ ...draft, source: text })}
            height={400}
          />
        </Tabs.Panel>
        <Tabs.Panel value="css">
          <CodeEditor
            label="页面 CSS"
            language="css"
            value={draft.css}
            onChange={(text) => change({ ...draft, css: text })}
            height={400}
          />
        </Tabs.Panel>
      </Tabs.Root>
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
      <div className="page-code-actions">
        <Button variant="primary" disabled={busy || status.stale} onClick={() => void apply()}>
          {busy ? '正在校验…' : '保存并应用'}
        </Button>
        <Button disabled={!status.dirty && !busy} onClick={abandon}>
          放弃
        </Button>
        <Button disabled={!page.code?.enabled} onClick={disable}>
          禁用代码
        </Button>
      </div>
      <p className="editor-note">
        支持
        react、react/jsx-runtime、@dimlu/runtime。保存只校验，不运行。代码在当前窗口执行，请仅运行可信代码。
      </p>
    </section>
  );
}
