import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link2, RotateCcw } from 'lucide-react';
import { findNode, type EditorDocument, type EditorSnapshot } from '../../packages/editor/document';
import type { ContractField } from '../../packages/runtime/registry';
import {
  isStyleProperty,
  styleChoices,
  styleValueError,
  type StyleProperty,
} from '../../packages/schema/style';
import type { NodeSchema, Value } from '../../packages/schema/types';
import { Button, Disclosure, Input, Select, Tip } from '../ui/primitives';
import {
  createSetterRegistry,
  LiteralSetter,
  SetterRegistryProvider,
  useSetterRegistry,
  type ReactSetterProps,
} from './Setters';
import { DraftNotice, useDraft, useEditorSession } from './session';
import { bindingDraft, parseBinding, ValueInput } from './ValueEditor';
import { errorText } from './errors';
import { useAuthorGuard } from './author-guard';
import { nodeScopeNames } from '../../packages/editor/scope';

const groups: { title: string; properties: StyleProperty[] }[] = [
  {
    title: '尺寸',
    properties: ['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight'],
  },
  {
    title: '间距',
    properties: [
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'gap',
      'rowGap',
      'columnGap',
    ],
  },
  {
    title: '布局',
    properties: [
      'display',
      'flexDirection',
      'flexWrap',
      'alignItems',
      'justifyContent',
      'flexGrow',
      'flexShrink',
      'flexBasis',
    ],
  },
  {
    title: '文字与背景',
    properties: ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign'],
  },
];
const labels: Record<StyleProperty, string> = {
  width: '宽度',
  height: '高度',
  minWidth: '最小宽度',
  minHeight: '最小高度',
  maxWidth: '最大宽度',
  maxHeight: '最大高度',
  marginTop: '上外边距',
  marginRight: '右外边距',
  marginBottom: '下外边距',
  marginLeft: '左外边距',
  paddingTop: '上内边距',
  paddingRight: '右内边距',
  paddingBottom: '下内边距',
  paddingLeft: '左内边距',
  gap: '整体间隙',
  rowGap: '行间隙',
  columnGap: '列间隙',
  display: '显示方式',
  flexDirection: '排列方向',
  flexWrap: '换行方式',
  alignItems: '交叉轴对齐',
  justifyContent: '主轴对齐',
  flexGrow: '伸展比例',
  flexShrink: '收缩比例',
  flexBasis: '基础尺寸',
  color: '文字颜色',
  backgroundColor: '背景颜色',
  fontSize: '字号',
  fontWeight: '字重',
  lineHeight: '行高',
  textAlign: '文字对齐',
};
const field: ContractField = { type: 'json' };
function naturalValue(source: string) {
  const text = source.trim();
  if (!text) throw new Error('请输入样式值，或使用恢复按钮清除');
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) ? Number(text) : text;
}
/** An ordinary registered React setter; host applications may replace style.value. */
export function StyleValueSetter(props: ReactSetterProps) {
  const property = String(props.options.property);
  if (!isStyleProperty(property)) throw new Error('无效样式设置器');
  const choices = styleChoices(property);
  const change = (source: string) => {
    props.onDraftChange(source);
    try {
      const next = naturalValue(source);
      const error = styleValueError(property, next);
      if (error) throw new Error(error);
      props.onChange(next);
    } catch (error) {
      props.onError(errorText(error));
    }
  };
  if (choices)
    return (
      <Select
        id={props.id}
        aria-label={props.label}
        value={String(props.value ?? '')}
        onValueChange={change}
      >
        <option value="" disabled>
          跟随组件设置
        </option>
        {choices.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
    );
  const color = property === 'color' || property === 'backgroundColor';
  return (
    <div className={color ? 'style-color-control' : undefined}>
      {color && (
        <span
          className="style-color-swatch"
          aria-hidden="true"
          style={{
            backgroundColor:
              typeof props.value === 'string' && !styleValueError(property, props.value)
                ? props.value
                : 'transparent',
          }}
        />
      )}
      <Input
        id={props.id}
        aria-label={props.label}
        value={props.draft}
        placeholder={String(props.options.placeholder ?? '跟随组件设置')}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );
}
type Props = { document: EditorDocument; snapshot: EditorSnapshot; node: NodeSchema };
const prefixFor = (page: string, node: string) => `style:${page}/${node}/`;
function StyleField({ document, snapshot, node, property }: Props & { property: StyleProperty }) {
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const { pageId } = snapshot.selection;
  const value = node.style?.[property];
  const [bindingOpen, setBindingOpen] = useState(!!value && value.kind !== 'literal');
  const source = JSON.stringify(value) ?? 'unset';
  const id = useId();
  const mounted = useRef(true);
  const group = useRef('');
  const counter = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const key = `${prefixFor(pageId, node.id)}${property}`;
  const [input, setInput, status] = useDraft(key, source, {
    text: value?.kind === 'literal' ? String(value.value) : '',
    error: '',
    binding: {
      ...bindingDraft(value, field),
      ...(value?.kind === 'literal' ? { text: String(value.value) } : {}),
    },
  });
  const initialBinding = {
    ...bindingDraft(value, field),
    ...(value?.kind === 'literal' ? { text: String(value.value) } : {}),
  };
  const bindingChanged = JSON.stringify(input.binding) !== JSON.stringify(initialBinding);
  const bindingDraftActive =
    input.binding.kind !== 'literal' && (input.binding.kind !== 'unset' || bindingChanged);
  const literalActive = (!value || value.kind === 'literal') && !bindingDraftActive;
  const latestLiteralActive = useRef(literalActive);
  latestLiteralActive.current = literalActive;
  const identity = () => {
    if (!canAuthor()) return;
    const current = document.getSnapshot();
    if (
      !mounted.current ||
      current.selection.pageId !== pageId ||
      current.selection.nodeId !== node.id
    )
      return;
    const page = current.plan.pages.get(pageId);
    return page && findNode(page.schema, node.id)?.node;
  };
  const setError = (error: string) => {
    if (identity()) setInput((old) => ({ ...old, error }));
  };
  const canLiteral = () => {
    if (!latestLiteralActive.current) return false;
    const current = identity();
    if (!current) return false;
    return !current.style?.[property] || current.style[property]?.kind === 'literal';
  };
  const commit = (next: Value | undefined, grouped = false) => {
    if (!identity()) return false;
    try {
      if (!grouped) document.endGroup();
      document.setStyle(pageId, node.id, { [property]: next }, grouped ? group.current : undefined);
      status.reset();
      return true;
    } catch (error) {
      setError(errorText(error));
      return false;
    }
  };
  const reset = () => commit(undefined);
  const dynamic = value && value.kind !== 'literal';
  return (
    <div
      className={`style-field ${bindingOpen ? 'style-field-expanded' : ''}`}
      onFocusCapture={() => {
        if (!group.current) group.current = `${id}-${++counter.current}`;
      }}
      onBlurCapture={(event) => {
        if (!canAuthor()) return;
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          document.endGroup();
          group.current = '';
        }
      }}
    >
      <div className="style-field-label">
        <label htmlFor={id}>{labels[property]}</label>
        <div className="style-field-actions">
          <Tip content={`${labels[property]}绑定设置`}>
            <Button
              variant="ghost"
              aria-label={`${labels[property]}绑定设置`}
              aria-expanded={bindingOpen}
              onClick={() => {
                if (identity()) setBindingOpen((open) => !open);
              }}
            >
              <Link2 size={12} />
            </Button>
          </Tip>
          <Tip content={`恢复${labels[property]}，清除覆盖与草稿`}>
            <Button variant="ghost" aria-label={`恢复${labels[property]}`} onClick={reset}>
              <RotateCcw size={12} />
            </Button>
          </Tip>
        </div>
      </div>
      {!literalActive ? (
        <div className="style-bound-value">
          {dynamic ? '已绑定' : '待应用绑定'} ·{' '}
          {(dynamic ? value.kind : input.binding.kind) === 'expression' ? '表达式' : '数据引用'}
        </div>
      ) : (
        <LiteralSetter
          id={id}
          label={labels[property]}
          field={field}
          setter={{ kind: 'custom', id: 'style.value', options: { property } }}
          options={{ property }}
          value={value?.kind === 'literal' ? value.value : undefined}
          draft={input.text}
          draftKey={key}
          error={input.error}
          onDraftChange={(text) => {
            if (canLiteral()) setInput((old) => ({ ...old, text }));
          }}
          onChange={(next) => canLiteral() && commit({ kind: 'literal', value: next }, true)}
          onError={(error) => {
            if (canLiteral()) setError(error);
          }}
          onReset={() => canLiteral() && reset()}
          onDiscardDraft={() => {
            if (canLiteral()) status.reset();
          }}
        />
      )}
      {bindingOpen && (
        <div className="style-binding-editor">
          <ValueInput
            label={`${labels[property]}绑定`}
            field={input.binding.kind === 'literal' ? { type: 'string' } : field}
            draft={input.binding}
            page={snapshot.plan.pages.get(pageId)!.schema}
            expressionContext={{
              scopeNames: nodeScopeNames(snapshot.plan.pages.get(pageId)!.schema, node.id),
              eventAllowed: false,
            }}
            showLabel={false}
            onChange={(binding) => {
              if (identity()) setInput((old) => ({ ...old, binding, error: '' }));
            }}
          />
          <div className="style-binding-actions">
            <Button
              onClick={() => {
                if (!identity()) return;
                try {
                  const next =
                    input.binding.kind === 'literal'
                      ? { kind: 'literal' as const, value: naturalValue(input.binding.text) }
                      : parseBinding(input.binding, field);
                  commit(next);
                } catch (error) {
                  setError(errorText(error));
                }
              }}
            >
              应用绑定
            </Button>
            {(dynamic || bindingDraftActive) && (
              <Button
                onClick={() => {
                  if (!identity()) return;
                  if (dynamic) {
                    if (commit(undefined)) setBindingOpen(false);
                  } else {
                    status.reset();
                    setBindingOpen(false);
                  }
                }}
              >
                切换固定值
              </Button>
            )}
          </div>
        </div>
      )}
      {input.error && <small role="alert">{input.error}</small>}
      <DraftNotice {...status} />
    </div>
  );
}
export function StylePanel({ document, snapshot, node }: Props) {
  const canAuthor = useAuthorGuard(document, snapshot, node.id);
  const outer = useSetterRegistry();
  const setters = useMemo(
    () => createSetterRegistry({ 'style.value': StyleValueSetter, ...outer }),
    [outer],
  );
  const { drafts } = useEditorSession();
  const capability = snapshot.plan.registry.components[node.component].style;
  const { pageId } = snapshot.selection;
  const reset = (properties: readonly StyleProperty[]) => {
    if (!canAuthor()) return;
    const current = document.getSnapshot().selection;
    if (current.pageId !== pageId || current.nodeId !== node.id) return;
    document.endGroup();
    document.setStyle(
      pageId,
      node.id,
      Object.fromEntries(properties.map((key) => [key, undefined])),
    );
    for (const property of properties) drafts.clear(`${prefixFor(pageId, node.id)}${property}`);
  };
  if (!capability) return <p className="editor-note">该组件暂未提供样式设置。</p>;
  return (
    <SetterRegistryProvider registry={setters}>
      <div className="style-panel">
        <div className="style-panel-header">
          <span>仅保存显式覆盖</span>
          <Tip content="恢复全部样式，同时清除未应用草稿">
            <Button
              variant="ghost"
              aria-label="恢复全部样式"
              onClick={() => {
                if (!canAuthor()) return;
                reset(capability.properties);
                drafts.clearPrefix(prefixFor(pageId, node.id));
              }}
            >
              <RotateCcw size={13} />
              恢复全部
            </Button>
          </Tip>
        </div>
        <p className="editor-note">
          {capability.target === 'field'
            ? '尺寸、间距和背景作用于整个字段；文字设置作用于标签与输入区域。'
            : capability.target === 'popup'
              ? '样式作用于打开的弹层面板。'
              : '样式作用于组件主体。'}
          恢复后沿用组件属性与默认样式。
        </p>
        {groups.map((group, index) => {
          const properties = group.properties.filter((key) => capability.properties.includes(key));
          return (
            properties.length > 0 && (
              <section className="style-section" key={group.title}>
                <Disclosure title={group.title} defaultOpen={index === 0}>
                  <div className="style-fields">
                    {properties.map((property) => (
                      <StyleField
                        key={property}
                        document={document}
                        snapshot={snapshot}
                        node={node}
                        property={property}
                      />
                    ))}
                  </div>
                </Disclosure>
                <Tip content={`恢复${group.title}分组，同时清除草稿`}>
                  <Button
                    className="style-group-reset"
                    variant="ghost"
                    aria-label={`恢复${group.title}分组`}
                    onClick={() => reset(properties)}
                  >
                    <RotateCcw size={12} />
                  </Button>
                </Tip>
              </section>
            )
          );
        })}
      </div>
    </SetterRegistryProvider>
  );
}
