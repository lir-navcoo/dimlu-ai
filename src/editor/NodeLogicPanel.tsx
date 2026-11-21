import { useEffect, useRef } from 'react';
import { RotateCcw } from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import { nodeLogicScopes } from '../../packages/editor/scope';
import type { NodeSchema } from '../../packages/schema/types';
import type { ContractField } from '../../packages/runtime/registry';
import { Button, Checkbox, Disclosure, Input, Tip } from '../ui/primitives';
import { DraftNotice, useDraft } from './session';
import { bindingDraft, parseBinding, ValueInput } from './ValueEditor';
import { errorText } from './errors';
import { useAuthorGuard } from './author-guard';

const conditionField: ContractField = { type: 'boolean' };
const itemsField: ContractField = { type: 'array', required: true };
const keyField: ContractField = { type: 'json', required: true };
const namesText = (names: string[]) =>
  names.length ? names.map((name) => `scope[${JSON.stringify(name)}]`).join(' / ') : '无行作用域';

/** Local drafts are section-scoped; publication is one atomic command. */
export function NodeLogicPanel({
  document,
  snapshot,
  node,
}: {
  document: EditorDocument;
  snapshot: EditorSnapshot;
  node: NodeSchema;
}) {
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const { pageId } = snapshot.selection;
  const page = snapshot.plan.pages.get(pageId)!.schema;
  const [when, setWhen, whenStatus] = useDraft(
    `logic:${pageId}/${node.id}/when`,
    JSON.stringify(node.when) ?? 'unset',
    { binding: bindingDraft(node.when, conditionField), error: '' },
  );
  const [repeat, setRepeat, repeatStatus] = useDraft(
    `logic:${pageId}/${node.id}/repeat`,
    JSON.stringify(node.repeat) ?? 'unset',
    {
      enabled: !!node.repeat,
      items: bindingDraft(node.repeat?.items, itemsField),
      item: node.repeat?.item ?? 'item',
      index: node.repeat?.index ?? '',
      key: bindingDraft(node.repeat?.key, keyField),
      error: '',
    },
  );
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lifetime = useRef(0);
  const generation = ++lifetime.current;
  const active = () => {
    const current = document.getSnapshot();
    return (
      canAuthor() &&
      mounted.current &&
      lifetime.current === generation &&
      current.revision === snapshot.revision &&
      current.selection.pageId === pageId &&
      current.selection.nodeId === node.id &&
      !!findNode(current.plan.pages.get(pageId)!.schema, node.id)
    );
  };
  const guarded = (callback: () => void) => () => {
    if (active()) callback();
  };
  const notices = (status: typeof whenStatus) => ({
    ...status,
    reset: guarded(status.reset),
    rebase: guarded(status.rebase),
  });
  const scopes = nodeLogicScopes(page, node.id);
  const local = new Set(scopes.outer);
  if (repeat.enabled) {
    local.add(repeat.item);
    local.add(repeat.index || 'index');
  }
  const reset = (section: 'when' | 'repeat' | 'all') => {
    if (!active()) return;
    try {
      document.setNodeLogic(
        pageId,
        node.id,
        section === 'all'
          ? { when: undefined, repeat: undefined }
          : section === 'when'
            ? { when: undefined }
            : { repeat: undefined },
      );
      if (section !== 'repeat') whenStatus.reset();
      if (section !== 'when') repeatStatus.reset();
    } catch (error) {
      if (section === 'when') setWhen((old) => ({ ...old, error: errorText(error) }));
      else setRepeat((old) => ({ ...old, error: errorText(error) }));
    }
  };
  const apply = () => {
    if (!active() || whenStatus.stale || repeatStatus.stale || node.field) return;
    let nextWhen: NodeSchema['when'];
    try {
      nextWhen = parseBinding(when.binding, conditionField);
    } catch (error) {
      setWhen((old) => ({ ...old, error: errorText(error) }));
      return;
    }
    try {
      const nextRepeat = repeat.enabled
        ? {
            items: parseBinding(repeat.items, itemsField)!,
            item: repeat.item,
            ...(repeat.index ? { index: repeat.index } : {}),
            key: parseBinding(repeat.key, keyField)!,
          }
        : undefined;
      document.setNodeLogic(pageId, node.id, { when: nextWhen, repeat: nextRepeat });
      whenStatus.reset();
      repeatStatus.reset();
    } catch (error) {
      if (repeat.enabled) setRepeat((old) => ({ ...old, error: errorText(error) }));
      else setWhen((old) => ({ ...old, error: errorText(error) }));
    }
  };
  return (
    <div className="node-logic-panel">
      <p className="editor-note">
        显示条件和循环统一应用；表达式使用当前 JavaScript 子集，不支持 event。
      </p>
      {node.field ? (
        <p className="editor-note">
          此组件由表单字段管理。显示条件属于字段定义，不能在字段组件上设置条件或循环。可用外层布局控制视图；隐藏容器不会停止内部字段校验。
        </p>
      ) : (
        <>
          <Disclosure title="显示条件" defaultOpen>
            <p className="editor-note">
              结果必须为布尔值。循环时，每条记录分别判断显示条件。可用作用域：
              {namesText([...local])}。
            </p>
            <DraftNotice {...notices(whenStatus)} />
            <ValueInput
              label="显示条件"
              field={conditionField}
              page={page}
              draft={when.binding}
              onChange={(binding) => {
                if (active()) setWhen({ binding, error: '' });
              }}
            />
            {when.error && (
              <p className="field-error" role="alert">
                {when.error}
              </p>
            )}
            <Tip content="恢复显示条件">
              <Button aria-label="恢复显示条件" onClick={() => reset('when')}>
                <RotateCcw size={13} />
                恢复显示条件
              </Button>
            </Tip>
          </Disclosure>
          <Disclosure title="循环渲染" defaultOpen>
            {node.formId ? (
              <p className="editor-note">
                表单容器不能循环。多行编辑使用动态明细组件；循环视图不会创建独立表单模型。
              </p>
            ) : (
              <>
                <DraftNotice {...notices(repeatStatus)} />
                <label className="action-parameter">
                  <span>
                    <Checkbox
                      aria-label="启用循环"
                      checked={repeat.enabled}
                      onCheckedChange={(enabled) => {
                        if (active())
                          setRepeat((old) => ({ ...old, enabled: !!enabled, error: '' }));
                      }}
                    />{' '}
                    启用循环
                  </span>
                </label>
                {repeat.enabled && (
                  <>
                    <p className="editor-note">
                      循环数据在外层作用域计算：{namesText(scopes.outer)}。数据必须是数组。
                    </p>
                    <ValueInput
                      label="循环数据"
                      field={itemsField}
                      page={page}
                      draft={repeat.items}
                      onChange={(items) => {
                        if (active()) setRepeat((old) => ({ ...old, items, error: '' }));
                      }}
                    />
                    <label className="action-parameter">
                      记录变量
                      <Input
                        aria-label="记录变量"
                        value={repeat.item}
                        onChange={(event) => {
                          if (active())
                            setRepeat((old) => ({ ...old, item: event.target.value, error: '' }));
                        }}
                      />
                    </label>
                    <label className="action-parameter">
                      索引变量
                      <Input
                        aria-label="索引变量"
                        value={repeat.index}
                        placeholder="默认 index"
                        onChange={(event) => {
                          if (active())
                            setRepeat((old) => ({ ...old, index: event.target.value, error: '' }));
                        }}
                      />
                    </label>
                    <p className="editor-note">
                      有效索引变量：{repeat.index || 'index'}
                      。条件、标识、属性和事件使用本层作用域：{namesText([...local])}。
                    </p>
                    <ValueInput
                      label="记录标识"
                      field={keyField}
                      page={page}
                      draft={repeat.key}
                      onChange={(key) => {
                        if (active()) setRepeat((old) => ({ ...old, key, error: '' }));
                      }}
                    />
                    <p className="editor-note">
                      必须明确设置字符串或有限数字标识，各记录不可重复。按索引作标识会跟随位置，排序后无法保持原记录的
                      React 状态。循环实例共享同一组件定义；输入明细请使用动态明细组件。
                    </p>
                  </>
                )}
              </>
            )}
            {repeat.error && (
              <p className="field-error" role="alert">
                {repeat.error}
              </p>
            )}
            <Tip content="恢复循环渲染">
              <Button aria-label="恢复循环渲染" onClick={() => reset('repeat')}>
                <RotateCcw size={13} />
                恢复循环渲染
              </Button>
            </Tip>
          </Disclosure>
          <div className="action-card-tools">
            <Button
              variant="primary"
              disabled={whenStatus.stale || repeatStatus.stale}
              onClick={apply}
            >
              应用组件逻辑
            </Button>
            <Tip content="恢复全部组件逻辑">
              <Button aria-label="恢复全部组件逻辑" onClick={() => reset('all')}>
                <RotateCcw size={13} />
              </Button>
            </Tip>
          </div>
          <p className="editor-note">容器的显示条件只控制视图，不会停止隐藏字段的表单校验。</p>
        </>
      )}
    </div>
  );
}
