import { FieldArrayPanel } from './FieldArrayPanel';
import { useAuthorGuard } from './author-guard';
import { useDragDrop } from './DragDrop';
import { selectedNodeIds } from '../../packages/editor/selection';
import { validTemporal } from '../../packages/schema/formats';
import { MaterialIcon } from '../ui/MaterialIcon';
import { Button, Select, Tip } from '../ui/primitives';
import { CodeEditor } from '../ui/CodeEditor';
import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { EditorDocument, findNode, type EditorSnapshot } from '../../packages/editor/document';
import type { MaterialCatalog, PropertyMetadata } from '../../packages/editor/metadata';
import type { ContractField } from '../../packages/runtime/registry';
import type { Json, NodeSchema, Value } from '../../packages/schema/types';
import { catalog } from './catalog';
import { registry } from '../materials';
import { errorText } from './errors';
import { FormPanel } from './FormPanel';
import { LiteralSetter } from './Setters';
import { StylePanel } from './StylePanel';
import { NodeLogicPanel } from './NodeLogicPanel';
import { useDraft, useEditorSession } from './session';
import { Menu } from '@base-ui/react/menu';
import { Tabs } from '@base-ui/react/tabs';
import { ChevronDown, FileJson, MousePointer2, Redo2, Undo2, Zap } from 'lucide-react';
import { ActionPanel, type OpenApplicationMethods } from './ActionPanel';
import type { ApplicationMethodReference } from '../../packages/editor/data';
import { ClipboardMenuGroup } from './ClipboardMenu';
import { bindingDraft, parseBinding, ValueInput, type BindingDraft } from './ValueEditor';
import { describeNodeName, displayNodeName } from './node-display-name';
import { NodeNameEditor } from './NodeNameEditor';
import { nodeScopeNames } from '../../packages/editor/scope';
import { ExpressionContext } from './ExpressionContext';
import { PageSettingsPanel } from './PageSettingsPanel';
type Props = {
  document: EditorDocument;
  snapshot: EditorSnapshot;
};
export { ComponentTree } from './ComponentTree';
function defaultLiteral(
  meta: PropertyMetadata,
  contract: ContractField,
  fallback: Json | undefined,
): Json {
  if (fallback !== undefined) return structuredClone(fallback);
  if (meta.setter.kind === 'select') return meta.setter.options[0].value;
  switch (contract.type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'object':
      return {};
    case 'array':
      return [];
    case 'null':
      return null;
    default:
      return '';
  }
}
function display(value: Value | undefined): string {
  if (!value) return '';
  return value.kind === 'expression'
    ? value.source
    : value.kind === 'literal'
      ? JSON.stringify(value.value, null, 2)
      : JSON.stringify(value, null, 2);
}
function PropertyInput({
  document,
  snapshot,
  node,
  meta,
  materialCatalog,
}: Props & {
  node: NodeSchema;
  meta: PropertyMetadata;
  materialCatalog: MaterialCatalog;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const authorDrag = useDragDrop();
  const { drafts } = useEditorSession();
  const [, requestReferenceOwnerRender] = useReducer((revision: number) => revision + 1, 0);
  const value = node.props[meta.name];
  const contract = registry.components[node.component].props[meta.name];
  const modeFor = (v: Value | undefined) =>
    !v
      ? 'unset'
      : v.kind === 'literal'
        ? 'literal'
        : v.kind === 'expression'
          ? 'expression'
          : v.kind === 'dataRef'
            ? 'dataRef'
            : 'reference';
  const [input, setInput, status] = useDraft(
    `prop:${snapshot.selection.pageId}/${node.id}/${meta.name}`,
    JSON.stringify(value) ?? 'unset',
    {
      mode: modeFor(value),
      draft: display(value),
      error: '',
      binding: undefined as BindingDraft | undefined,
    },
  );
  const { mode, draft, error } = input;
  // The applied value may still be literal while an expression/reference draft is active.
  // Retained host callbacks must consult the latest authoring mode, not their render closure.
  const latestMode = useRef(mode);
  latestMode.current = mode;
  // Columns own session drafts as well as core writes. Returning to a prior author
  // context must not revive callbacks that once belonged to an expired context.
  // Compare explicit values, not function identities or the pre-mount guard result.
  const columnsContext = {
    document,
    plan: snapshot.plan,
    selection: snapshot.selection,
    pageId: snapshot.selection.pageId,
    nodeId: node.id,
    component: node.component,
    property: meta.name,
    setter: meta.setter.kind,
    mode,
    enabled: authorDrag?.enabled !== false,
    interacting: !!authorDrag?.isInteracting,
  };
  const columnsAuthor = useRef({ context: columnsContext, active: true });
  if (
    !columnsAuthor.current.active ||
    (Object.keys(columnsContext) as (keyof typeof columnsContext)[]).some(
      (key) => columnsAuthor.current.context[key] !== columnsContext[key],
    )
  ) {
    columnsAuthor.current.active = false;
    columnsAuthor.current = { context: columnsContext, active: true };
  }
  const columnsGeneration = columnsAuthor.current;
  const setMode = (mode: string) => setInput((current) => ({ ...current, mode }));
  const setDraft = (draft: string) => setInput((current) => ({ ...current, draft }));
  const setError = (error: string) => setInput((current) => ({ ...current, error }));
  const id = useId(),
    session = useRef(0),
    group = useRef(id);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectedNodeId = node.id;
  const commit = (next: Value | undefined) => {
    if (!canAuthor()) return false;
    try {
      const currentPage = document.getSnapshot().plan.pages.get(snapshot.selection.pageId);
      const node = currentPage && findNode(currentPage.schema, selectedNodeId)?.node;
      if (!node) throw new Error('属性目标节点不存在');
      if (
        (node.component === 'ui.date' || node.component === 'ui.time') &&
        (meta.name === 'range' || meta.name === 'mode') &&
        (!next || next.kind === 'literal')
      ) {
        if (node.field) throw new Error('请先解除字段绑定，再修改日期时间模式');
        if (node.props.value?.kind !== 'literal') throw new Error('请先处理日期时间值的动态绑定');
        const current = node.props.value.value;
        const range =
          meta.name === 'range'
            ? next?.kind === 'literal' && next.value === true
            : node.props.range?.kind === 'literal' && node.props.range.value === true;
        const format =
          node.component === 'ui.time'
            ? 'time'
            : meta.name === 'mode'
              ? next?.kind === 'literal'
                ? String(next.value)
                : 'date'
              : node.props.mode?.kind === 'literal'
                ? String(node.props.mode.value)
                : 'date';
        let value: Json = range
          ? Array.isArray(current)
            ? current
            : current === ''
              ? []
              : [current, current]
          : Array.isArray(current)
            ? (current[0] ?? '')
            : current;
        if (
          meta.name === 'mode' &&
          (Array.isArray(value)
            ? value.some(
                (v) => v !== '' && !validTemporal(v, format as Parameters<typeof validTemporal>[1]),
              )
            : value !== '' && !validTemporal(value, format as Parameters<typeof validTemporal>[1]))
        )
          value = range ? [] : '';
        document.setProps(
          snapshot.selection.pageId,
          node.id,
          { [meta.name]: next, value: { kind: 'literal', value } },
          group.current,
        );
      } else if (
        node.component === 'ui.select' &&
        meta.name === 'multiple' &&
        (!next || next.kind === 'literal')
      ) {
        const previous = node.props.multiple;
        const wasMultiple = previous?.kind === 'literal' && previous.value === true;
        const isMultiple = next?.kind === 'literal' && next.value === true;
        if (wasMultiple !== isMultiple) {
          if (node.field) throw new Error('请先解除字段绑定，再切换选择模式并绑定兼容字段');
          if (node.props.value?.kind !== 'literal')
            throw new Error('请先处理选中值的动态绑定，再切换选择模式');
          const current = node.props.value.value;
          const value = isMultiple
            ? current === null || current === ''
              ? []
              : [current]
            : Array.isArray(current)
              ? (current[0] ?? null)
              : current;
          document.setProps(
            snapshot.selection.pageId,
            node.id,
            { multiple: next, value: { kind: 'literal', value } },
            group.current,
          );
        } else document.setProp(snapshot.selection.pageId, node.id, meta.name, next, group.current);
      } else document.setProp(snapshot.selection.pageId, node.id, meta.name, next, group.current);
      status.reset();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const change = (source: string) => {
    if (!canAuthor()) return;
    setDraft(source);
    if (mode === 'expression') commit({ kind: 'expression', language: 'javascript', source });
    else {
      try {
        const literal = meta.setter.kind === 'text' ? source : (JSON.parse(source) as Json);
        commit({ kind: 'literal', value: literal });
      } catch (e) {
        setError(errorText(e));
      }
    }
  };
  const managed =
    !!node.field &&
    ['value', 'checked', 'label', 'required', 'disabled', 'error', 'name'].includes(meta.name);
  // A host setter can retain a callback after a binding or selection update.
  const canEditLiteral = () => {
    if (meta.setter.kind === 'columns') {
      if (!columnsGeneration.active || columnsAuthor.current !== columnsGeneration) return false;
      const actual = document.getSnapshot();
      if (
        actual.plan !== snapshot.plan ||
        actual.selection !== snapshot.selection ||
        latestMode.current !== mode ||
        (authorDrag?.enabled !== false) !== columnsContext.enabled ||
        !!authorDrag?.isInteracting !== columnsContext.interacting
      ) {
        // Live drag/document changes may precede a render. Expire this generation
        // permanently when observed, while an initial pre-layout false stays transient.
        columnsGeneration.active = false;
        return false;
      }
    }
    if (!canAuthor()) return false;
    if (latestMode.current !== 'literal') return false;
    const currentSnapshot = document.getSnapshot();
    if (
      !mounted.current ||
      currentSnapshot.selection.pageId !== snapshot.selection.pageId ||
      currentSnapshot.selection.nodeId !== node.id
    )
      return false;
    const currentPage = currentSnapshot.plan.pages.get(snapshot.selection.pageId);
    const currentNode = currentPage && findNode(currentPage.schema, node.id)?.node;
    const current = currentNode?.props[meta.name];
    const owned =
      currentNode &&
      ((currentNode.field &&
        ['value', 'checked', 'label', 'required', 'disabled', 'error', 'name'].includes(
          meta.name,
        )) ||
        (currentNode.component === 'ui.fieldArray' &&
          currentNode.props.formId &&
          ['fields', 'value', 'label', 'minItems', 'maxItems', 'disabled'].includes(meta.name)));
    return !!currentNode && (!current || current.kind === 'literal') && !owned;
  };
  if (managed)
    return (
      <div className="property-field">
        <span>{meta.label}</span>
        <small>由表单字段 {node.field!.fieldId} 管理</small>
      </div>
    );
  return (
    <div
      className="property-field"
      onFocusCapture={() => {
        if (!group.current) group.current = `${id}-${++session.current}`;
      }}
      onBlurCapture={(e) => {
        if (!canAuthor()) return;
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          document.endGroup();
          group.current = '';
        }
      }}
    >
      <div className="property-label">
        <label htmlFor={id}>
          {meta.label}
          {contract.required && <b aria-hidden="true"> *</b>}
        </label>
        <Select
          aria-label={`${meta.label}绑定方式`}
          value={mode}
          onValueChange={(e) => {
            if (!canAuthor()) return;
            document.endGroup();
            group.current = `${id}-${++session.current}`;
            const next = e;
            setMode(next);
            setError('');
            if (next === 'expression') {
              setDraft('');
            }
            if (next === 'dataRef')
              setInput((current) => ({
                ...current,
                binding: { ...bindingDraft(value, contract), kind: 'dataRef' },
              }));
            if (next === 'literal')
              commit({
                kind: 'literal',
                value: defaultLiteral(
                  meta,
                  contract,
                  materialCatalog[node.component]?.defaultProps[meta.name],
                ),
              });
            if (next === 'unset') commit(undefined);
          }}
        >
          {!contract.required && <option value="unset">未设置</option>}
          <option value="literal">固定值</option>
          <option value="expression">表达式</option>
          <option value="dataRef">数据源</option>
          {mode === 'reference' && <option value="reference">引用（保留）</option>}
        </Select>
      </div>
      {mode === 'unset' ? null : mode === 'dataRef' ? (
        <ValueInput
          label={meta.label}
          field={contract}
          page={snapshot.plan.pages.get(snapshot.selection.pageId)!.schema}
          showMode={false}
          showLabel={false}
          draft={input.binding ?? bindingDraft(value, contract)}
          referenceOwner={{
            document,
            snapshot,
            nodeId: node.id,
            property: meta.name,
            draftIdentity: input,
            subscribeDraft: drafts.subscribe,
            requestCallerRender: requestReferenceOwnerRender,
            canChoose: () =>
              mounted.current && canAuthor() && latestMode.current === 'dataRef' && !status.stale,
          }}
          onChange={(binding) => {
            setInput((current) => ({ ...current, binding }));
            try {
              commit(parseBinding(binding, contract));
            } catch (error) {
              setError(errorText(error));
            }
          }}
        />
      ) : mode === 'reference' ? (
        <pre className="reference-value">{draft}</pre>
      ) : mode === 'expression' ? (
        <CodeEditor
          id={id}
          label={meta.label}
          language="javascript"
          value={draft}
          placeholder="请输入 JavaScript 表达式"
          onChange={change}
        />
      ) : value && value.kind !== 'literal' ? (
        <small>当前值使用动态绑定，请先明确切换为固定值。</small>
      ) : (
        <LiteralSetter
          id={id}
          label={meta.label}
          value={value?.value}
          field={contract}
          setter={meta.setter}
          options={meta.setter.kind === 'custom' ? (meta.setter.options ?? {}) : {}}
          draft={draft}
          onDraftChange={(draft) => {
            if (canEditLiteral()) setDraft(draft);
          }}
          error={error}
          onError={(error) => {
            if (canEditLiteral()) setError(error);
          }}
          onDiscardDraft={() => {
            if (canEditLiteral()) status.reset();
          }}
          draftKey={`${snapshot.selection.pageId}/${node.id}/${meta.name}`}
          canEdit={canEditLiteral}
          onChange={(next) => {
            if (!canEditLiteral()) return false;
            if (meta.setter.kind === 'columns') {
              document.endGroup();
              try {
                return commit({ kind: 'literal', value: next });
              } finally {
                document.endGroup();
              }
            }
            if (meta.setter.kind === 'options') document.endGroup();
            return commit({ kind: 'literal', value: next });
          }}
          onReset={() => {
            if (!canEditLiteral()) return false;
            const fallback = materialCatalog[node.component]?.defaultProps[meta.name];
            if (fallback === undefined && contract.required) {
              setError('必填属性没有可恢复的默认值');
              return false;
            }
            document.endGroup();
            return commit(
              fallback === undefined
                ? undefined
                : { kind: 'literal', value: structuredClone(fallback) },
            );
          }}
        />
      )}
      {error && (
        <p role="alert" className="property-error">
          {error}
        </p>
      )}
      {status.dirty && (
        <div className="property-draft">
          <small>{status.stale ? '定义已更新，未应用输入仍保留' : '未应用草稿'}</small>
          <Button aria-label={`${meta.label}放弃草稿`} onClick={status.reset}>
            放弃草稿
          </Button>
        </div>
      )}
      {mode === 'expression' && (
        <>
          <ExpressionContext
            scopeNames={nodeScopeNames(
              snapshot.plan.pages.get(snapshot.selection.pageId)!.schema,
              node.id,
            )}
            eventAllowed={false}
          />
          {!draft && <small>输入有效表达式后应用</small>}
        </>
      )}
    </div>
  );
}
export function PropertyPanel({
  document,
  snapshot,
  materialCatalog = catalog,
  onOpenMethods,
  eventTarget,
  propertyRequest,
  authoringAllowed = false,
  focusReference,
  pageLogicRequest,
}: Props & {
  materialCatalog?: MaterialCatalog;
  onOpenMethods?: OpenApplicationMethods;
  eventTarget?: ApplicationMethodReference;
  propertyRequest?: number;
  authoringAllowed?: boolean;
  focusReference?: ApplicationMethodReference;
  pageLogicRequest?: object;
}) {
  const [tab, setTab] = useState(eventTarget ? 'events' : 'properties');
  useLayoutEffect(() => {
    setTab('properties');
  }, [propertyRequest]);
  useLayoutEffect(() => {
    if (eventTarget) setTab('events');
  }, [eventTarget]);
  const { pageId, nodeId } = snapshot.selection;
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const node = nodeId ? findNode(page, nodeId)?.node : undefined;
  const meta = node && materialCatalog[node.component];
  const savedEventCount = node
    ? Object.values(node.on ?? {}).filter((calls) => calls.length > 0).length
    : 0;
  const editable =
    meta?.properties.filter((p) => {
      if (
        node?.field &&
        ['value', 'checked', 'label', 'required', 'disabled', 'error', 'name'].includes(p.name)
      )
        return false;
      if (
        node?.component === 'ui.fieldArray' &&
        node.props.formId &&
        ['fields', 'value', 'label', 'minItems', 'maxItems', 'disabled'].includes(p.name)
      )
        return false;
      if (!p.visibleWhen) return true;
      const dependency = node?.props[p.visibleWhen.prop];
      // Runtime expressions/references may change later; keep their settings accessible.
      if (dependency && dependency.kind !== 'literal') return true;
      const actual = dependency ? dependency.value : meta.defaultProps[p.visibleWhen.prop];
      return actual === p.visibleWhen.equals;
    }) ?? [];
  return (
    <div className="property-panel">
      {page.code?.enabled ? (
        <PageSettingsPanel
          key={pageId}
          document={document}
          snapshot={snapshot}
          authoringAllowed={authoringAllowed}
          onOpenMethods={onOpenMethods ?? (() => {})}
          focusReference={focusReference}
          pageLogicRequest={pageLogicRequest}
        />
      ) : selectedNodeIds(snapshot.selection).length > 1 ? (
        <p className="multi-selection-note">
          已选 {selectedNodeIds(snapshot.selection).length} 项，选择一个组件编辑属性。
        </p>
      ) : node ? (
        <>
          <div className="selected-material">
            <span>
              <MaterialIcon name={meta?.icon} />
            </span>
            <div>
              <Tip content={describeNodeName(node, meta?.title ?? node.component)}>
                <strong className="node-author-label">
                  {displayNodeName(node, meta?.title ?? node.component)}
                </strong>
              </Tip>
              <code>{node.id}</code>
            </div>
            {meta && (registry.components[node.component].events ?? []).length > 0 && (
              <Tip
                content={
                  savedEventCount
                    ? `已配置 ${savedEventCount} 个事件，点击打开事件配置`
                    : '打开组件事件配置'
                }
              >
                <Button
                  type="button"
                  variant="ghost"
                  className="event-quick-button"
                  aria-label="打开组件事件配置"
                  onClick={() => setTab('events')}
                >
                  <Zap size={13} aria-hidden="true" />
                  事件{savedEventCount ? ` · ${savedEventCount}` : ''}
                </Button>
              </Tip>
            )}
          </div>
          <NodeNameEditor
            document={document}
            snapshot={snapshot}
            node={node}
            fallback={meta?.title ?? node.component}
          />

          <Tabs.Root value={tab} onValueChange={setTab} className="inspector-tabs">
            <Tabs.List className="panel-tabs" aria-label="组件设置">
              <Tabs.Tab value="properties">属性</Tabs.Tab>
              <Tabs.Tab value="styles">样式</Tabs.Tab>
              <Tabs.Tab value="events">事件</Tabs.Tab>
              <Tabs.Tab value="logic">逻辑</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="properties" keepMounted>
              {!meta && (
                <p className="editor-note">该组件尚未提供编辑元数据，现有属性会完整保留。</p>
              )}
              {meta &&
                [...new Set(editable.map((p) => p.group))].map((group) => (
                  <section key={group} className="property-group">
                    <h3>{group}</h3>
                    {editable
                      .filter((p) => p.group === group)
                      .map((p) => (
                        <PropertyInput
                          key={`${pageId}/${node.id}/${p.name}`}
                          document={document}
                          snapshot={snapshot}
                          node={node}
                          meta={p}
                          materialCatalog={materialCatalog}
                        />
                      ))}
                  </section>
                ))}
              {meta && !meta.properties.length && (
                <p className="editor-note">该容器没有可编辑属性，可向其添加子节点。</p>
              )}
              {node.component === 'ui.fieldArray' && (
                <FieldArrayPanel document={document} snapshot={snapshot} node={node} />
              )}
              <FormPanel
                key={`${pageId}/${node.id}`}
                document={document}
                snapshot={snapshot}
                node={node}
              />
            </Tabs.Panel>
            <Tabs.Panel value="events" keepMounted>
              <ActionPanel
                document={document}
                snapshot={snapshot}
                node={node}
                onOpenMethods={onOpenMethods}
                eventTarget={tab === 'events' ? eventTarget : undefined}
              />
            </Tabs.Panel>
            <Tabs.Panel value="styles">
              <StylePanel
                key={`${pageId}/${node.id}`}
                document={document}
                snapshot={snapshot}
                node={node}
              />
            </Tabs.Panel>
            <Tabs.Panel value="logic">
              <NodeLogicPanel
                key={`${pageId}/${node.id}`}
                document={document}
                snapshot={snapshot}
                node={node}
              />
            </Tabs.Panel>
          </Tabs.Root>
        </>
      ) : (
        <div className="page-settings-landing">
          <p className="page-settings-hint">选择组件后配置</p>
          <PageSettingsPanel
            document={document}
            snapshot={snapshot}
            authoringAllowed={authoringAllowed}
            // 预览模式下仍渲染禁用的「应用自定义方法」按钮；PageLifecyclePanel
            // 内部用 authoringAllowed/canOpenMethods 守卫实际调用。
            onOpenMethods={onOpenMethods ?? (() => {})}
            focusReference={focusReference}
            pageLogicRequest={pageLogicRequest}
          />
        </div>
      )}
    </div>
  );
}
export function EditorToolbar({
  document,
  snapshot,
  authoringAllowed = true,
}: Props & { authoringAllowed?: boolean }) {
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="editor-toolbar" role="group" aria-label="文档操作">
      <div className="editor-history-actions" role="group" aria-label="编辑历史">
        <Tip content="撤销" side="bottom">
          <Button
            variant="ghost"
            aria-label="↶ 撤销"
            disabled={!snapshot.canUndo}
            onClick={document.undo}
          >
            <Undo2 size={15} aria-hidden="true" />
          </Button>
        </Tip>
        <Tip content="重做" side="bottom">
          <Button
            variant="ghost"
            aria-label="↷ 重做"
            disabled={!snapshot.canRedo}
            onClick={document.redo}
          >
            <Redo2 size={15} aria-hidden="true" />
          </Button>
        </Tip>
      </div>
      <Menu.Root>
        <Menu.Trigger
          className="ui-button ui-button-ghost editor-file-button"
          aria-label="文件菜单"
        >
          <FileJson size={14} aria-hidden="true" />
          <span>文件</span>
          <ChevronDown size={11} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} className="menu-positioner">
            <Menu.Popup className="ui-menu">
              <Menu.Item
                className="ui-menu-item"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([document.exportJson()], { type: 'application/json' }),
                  );
                  const anchor = window.document.createElement('a');
                  anchor.href = url;
                  anchor.download = 'dimlu-application.json';
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                导出 JSON
              </Menu.Item>
              <Menu.Item className="ui-menu-item" onClick={() => file.current?.click()}>
                导入 JSON
              </Menu.Item>
              <Menu.LinkItem
                className="ui-menu-item"
                href="/examples/purchase-management.json"
                download
              >
                下载采购管理案例
              </Menu.LinkItem>
              <Menu.LinkItem
                className="ui-menu-item"
                href="/schema/application.v0.1.json"
                target="_blank"
                rel="noreferrer"
              >
                协议定义 ↗
              </Menu.LinkItem>
              <ClipboardMenuGroup
                document={document}
                snapshot={snapshot}
                authoringAllowed={authoringAllowed}
                onFeedback={(text, error) => {
                  setMessage(text);
                  setMessageError(error);
                }}
              />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        aria-label="导入应用文件"
        hidden
        onChange={async (e) => {
          const input = e.currentTarget,
            selected = input.files?.[0];
          if (!selected) return;
          try {
            document.importJson(await selected.text());
            setMessage('导入成功');
            setMessageError(false);
          } catch (error) {
            setMessage(errorText(error));
            setMessageError(true);
          } finally {
            input.value = '';
          }
        }}
      />
      {message && <p role={messageError ? 'alert' : 'status'}>{message}</p>}
    </div>
  );
}
