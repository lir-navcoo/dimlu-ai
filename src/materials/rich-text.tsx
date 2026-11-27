import { useCallback, useEffect, useRef } from 'react';
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from 'lucide-react';
import { createSlatePlugin, KEYS, type Value } from 'platejs';
import {
  Plate,
  PlateContent,
  createPlatePlugin,
  PlateElement,
  usePlateEditor,
  useEditorRef,
  useEditorSelector,
  type PlateElementProps,
} from 'platejs/react';
import { createStaticEditor, serializeHtml } from 'platejs/static';
import {
  BlockquotePlugin,
  BoldPlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  ItalicPlugin,
  StrikethroughPlugin,
  CodePlugin,
  HighlightPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react';
import {
  BaseBlockquotePlugin,
  BaseBoldPlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseItalicPlugin,
  BaseStrikethroughPlugin,
  BaseCodePlugin,
  BaseHighlightPlugin,
  BaseSubscriptPlugin,
  BaseSuperscriptPlugin,
  BaseUnderlinePlugin,
} from '@platejs/basic-nodes';
import { IndentPlugin } from '@platejs/indent/react';
import { BaseIndentPlugin } from '@platejs/indent';
import { ListPlugin, useListToolbarButton, useListToolbarButtonState } from '@platejs/list/react';
import { BaseListPlugin } from '@platejs/list';
import { useMarkToolbarButton, useMarkToolbarButtonState } from '@platejs/utils/react';
import {
  FieldFrame,
  useMaterialValue,
  boolProp,
  requiredText,
  textProp,
  type Contracts,
  type FieldPresentation,
} from './shared';
import { textStyle } from './style';
import { RichTextView, normalizeLegacyListHtml, safeUrl } from './rich-text-view';

export interface RichTextMaterialProps extends FieldPresentation {
  value: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
}

function H1Element(props: PlateElementProps) {
  return <PlateElement as="h1" {...props} />;
}
function H2Element(props: PlateElementProps) {
  return <PlateElement as="h2" {...props} />;
}
function H3Element(props: PlateElementProps) {
  return <PlateElement as="h3" {...props} />;
}
function BlockquoteElement(props: PlateElementProps) {
  return <PlateElement as="blockquote" {...props} />;
}
function LegacyListElement(props: PlateElementProps) {
  const listStyleType = (props.element as unknown as Record<string, string>)[KEYS.listType];
  return (
    <PlateElement
      as="div"
      data-list-style-type={listStyleType}
      data-legacy-list="true"
      {...props}
    />
  );
}

const legacyListPluginConfig = {
  key: 'legacyListHtml',
  node: { isElement: true },
};
const LegacyListPlugin = createPlatePlugin(legacyListPluginConfig).withComponent(LegacyListElement);
const BaseLegacyListPlugin = createSlatePlugin(legacyListPluginConfig);

function linkProps(node: Record<string, unknown>) {
  const href = typeof node.href === 'string' ? safeUrl(node.href, 'href') : undefined;
  const target = href && node.target === '_blank' ? '_blank' : undefined;
  return { href, target, rel: target ? 'noopener noreferrer' : undefined };
}

function imageProps(node: Record<string, unknown>) {
  const dimension = (value: unknown) =>
    (typeof value === 'string' || typeof value === 'number') && /^\d{1,4}$/.test(String(value))
      ? Number(value)
      : undefined;
  return {
    src: typeof node.src === 'string' ? safeUrl(node.src, 'src') : undefined,
    alt: typeof node.alt === 'string' ? node.alt : '',
    width: dimension(node.width),
    height: dimension(node.height),
  };
}

const linkConfig = {
  key: KEYS.a,
  node: { isElement: true, isInline: true },
  parsers: {
    html: {
      deserializer: {
        disableDefaultNodeProps: true,
        rules: [{ validNodeName: 'A' }],
        query: ({ element }: { element: HTMLElement }) =>
          element.tagName === 'A' && !!safeUrl(element.getAttribute('href') ?? '', 'href'),
        parse: ({ element, type }: { element: HTMLElement; type: string }) => ({
          type,
          ...linkProps({
            href: element.getAttribute('href'),
            target: element.getAttribute('target'),
          }),
        }),
      },
    },
  },
};
const imageConfig = {
  key: KEYS.img,
  node: { isElement: true, isInline: true, isVoid: true },
  parsers: {
    html: {
      deserializer: {
        disableDefaultNodeProps: true,
        rules: [{ validNodeName: 'IMG' }],
        withoutChildren: true,
        query: ({ element }: { element: HTMLElement }) =>
          element.tagName === 'IMG' && !!safeUrl(element.getAttribute('src') ?? '', 'src'),
        parse: ({ element, type }: { element: HTMLElement; type: string }) => ({
          type,
          ...imageProps({
            src: element.getAttribute('src'),
            alt: element.getAttribute('alt'),
            width: element.getAttribute('width'),
            height: element.getAttribute('height'),
          }),
        }),
      },
    },
  },
};

function LinkElement(props: PlateElementProps) {
  return (
    <PlateElement
      as="a"
      {...props}
      attributes={{ ...props.attributes, ...linkProps(props.element) }}
    />
  );
}
function ImageElement(props: PlateElementProps) {
  const image = imageProps(props.element);
  return (
    <PlateElement as="span" {...props}>
      <span contentEditable={false}>{image.src && <img {...image} loading="lazy" />}</span>
      {props.children}
    </PlateElement>
  );
}
const LinkPlugin = createPlatePlugin(linkConfig).withComponent(LinkElement);
const ImagePlugin = createPlatePlugin(imageConfig).withComponent(ImageElement);
const BaseLinkPlugin = createSlatePlugin({
  ...linkConfig,
  render: {
    node: ({ element, children }: Pick<PlateElementProps, 'element' | 'children'>) => (
      <a {...linkProps(element)}>{children}</a>
    ),
  },
});
const BaseImagePlugin = createSlatePlugin({
  ...imageConfig,
  render: {
    node: ({ element }: Pick<PlateElementProps, 'element'>) => {
      const image = imageProps(element);
      return image.src ? <img {...image} loading="lazy" /> : null;
    },
  },
});

const FixedToolbarPlugin = createPlatePlugin({
  key: 'richTextFixedToolbar',
  render: {
    beforeEditable: ({ readOnly }) => <RichTextToolbar disabled={!!readOnly} label="富文本" />,
  },
});

const editorPlugins = [
  FixedToolbarPlugin,
  LegacyListPlugin,
  LinkPlugin,
  ImagePlugin,
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
  CodePlugin,
  HighlightPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  H1Plugin.withComponent(H1Element),
  H2Plugin.withComponent(H2Element),
  H3Plugin.withComponent(H3Element),
  BlockquotePlugin.withComponent(BlockquoteElement),
  IndentPlugin,
  ListPlugin,
];
const staticPlugins = [
  BaseLegacyListPlugin,
  BaseLinkPlugin,
  BaseImagePlugin,
  BaseBoldPlugin,
  BaseItalicPlugin,
  BaseUnderlinePlugin,
  BaseStrikethroughPlugin,
  BaseCodePlugin,
  BaseHighlightPlugin,
  BaseSubscriptPlugin,
  BaseSuperscriptPlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseBlockquotePlugin,
  BaseIndentPlugin,
  BaseListPlugin,
];

function serializeValue(value: Value) {
  const staticEditor = createStaticEditor({ plugins: staticPlugins, value });
  return serializeHtml(staticEditor, { stripClassNames: true, stripDataAttributes: true });
}

function ToolbarButton({
  label,
  children,
  pressed,
  disabled,
  onClick,
  onMouseDown,
}: {
  label: string;
  children: React.ReactNode;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="plate-rich-text-tool"
      aria-label={label}
      aria-pressed={pressed}
      data-active={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={onMouseDown}
    >
      {children}
    </button>
  );
}

function MarkTool({
  nodeType,
  label,
  children,
  disabled,
}: {
  nodeType: string;
  label: string;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const state = useMarkToolbarButtonState({ nodeType });
  const { props } = useMarkToolbarButton(state);
  return (
    <ToolbarButton
      label={label}
      disabled={disabled}
      pressed={props.pressed}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
    >
      {children}
    </ToolbarButton>
  );
}

function ListTool({
  nodeType,
  label,
  children,
  disabled,
}: {
  nodeType: string;
  label: string;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const state = useListToolbarButtonState({ nodeType });
  const { props } = useListToolbarButton(state);
  return (
    <ToolbarButton
      label={label}
      disabled={disabled}
      pressed={props.pressed}
      onClick={props.onClick}
      onMouseDown={props.onMouseDown}
    >
      {children}
    </ToolbarButton>
  );
}

function BlockTool({
  nodeType,
  label,
  children,
  disabled,
}: {
  nodeType: string;
  label: string;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const editor = useEditorRef();
  const pressed = useEditorSelector(
    (current) => !!current.selection && !!current.api.some({ match: { type: nodeType } }),
    [nodeType],
  );
  return (
    <ToolbarButton
      label={label}
      disabled={disabled}
      pressed={pressed}
      onClick={() => editor.tf.toggleBlock(nodeType)}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </ToolbarButton>
  );
}

function HistoryTool({
  action,
  label,
  children,
  disabled,
}: {
  action: 'undo' | 'redo';
  label: string;
  children: React.ReactNode;
  disabled: boolean;
}) {
  const editor = useEditorRef();
  return (
    <ToolbarButton
      label={label}
      disabled={disabled}
      pressed={false}
      onClick={() => editor.tf[action]()}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </ToolbarButton>
  );
}

function RichTextToolbar({ disabled, label }: { disabled: boolean; label: string }) {
  return (
    <div className="plate-rich-text-toolbar" role="toolbar" aria-label={`${label}格式工具栏`}>
      <div className="plate-rich-text-tool-group" role="group" aria-label="文本格式">
        <HistoryTool action="undo" label="撤销" disabled={disabled}>
          <Undo2 size={15} aria-hidden="true" />
        </HistoryTool>
        <HistoryTool action="redo" label="重做" disabled={disabled}>
          <Redo2 size={15} aria-hidden="true" />
        </HistoryTool>
        <span className="plate-rich-text-divider" aria-hidden="true" />
        <MarkTool nodeType="bold" label="粗体" disabled={disabled}>
          <Bold size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="italic" label="斜体" disabled={disabled}>
          <Italic size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="underline" label="下划线" disabled={disabled}>
          <Underline size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="strikethrough" label="删除线" disabled={disabled}>
          <Strikethrough size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="code" label="行内代码" disabled={disabled}>
          <Code2 size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="highlight" label="高亮" disabled={disabled}>
          <Highlighter size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="subscript" label="下标" disabled={disabled}>
          <Subscript size={15} aria-hidden="true" />
        </MarkTool>
        <MarkTool nodeType="superscript" label="上标" disabled={disabled}>
          <Superscript size={15} aria-hidden="true" />
        </MarkTool>
      </div>
      <span className="plate-rich-text-divider" aria-hidden="true" />
      <div className="plate-rich-text-tool-group" role="group" aria-label="段落格式">
        <BlockTool nodeType="h1" label="标题 1" disabled={disabled}>
          <Heading1 size={15} aria-hidden="true" />
        </BlockTool>
        <BlockTool nodeType="h2" label="标题 2" disabled={disabled}>
          <Heading2 size={15} aria-hidden="true" />
        </BlockTool>
        <BlockTool nodeType="h3" label="标题 3" disabled={disabled}>
          <Heading3 size={15} aria-hidden="true" />
        </BlockTool>
        <BlockTool nodeType="blockquote" label="引用" disabled={disabled}>
          <Quote size={15} aria-hidden="true" />
        </BlockTool>
        <ListTool nodeType={KEYS.ul} label="无序列表" disabled={disabled}>
          <List size={15} aria-hidden="true" />
        </ListTool>
        <ListTool nodeType={KEYS.ol} label="有序列表" disabled={disabled}>
          <ListOrdered size={15} aria-hidden="true" />
        </ListTool>
      </div>
    </div>
  );
}

export function RichTextMaterial({
  value,
  onValueChange,
  placeholder = '请输入内容',
  ...field
}: RichTextMaterialProps) {
  const [html, change] = useMaterialValue(value, onValueChange);
  const readOnly = !!field.disabled || !!field.readOnly;
  const initialValue = html ? normalizeLegacyListHtml(html) : undefined;
  const editor = usePlateEditor({ plugins: editorPlugins, value: initialValue });
  const lastHtml = useRef(html);
  const externalValue = useRef<Value>(undefined);
  const revision = useRef(0);
  useEffect(() => {
    if (html === lastHtml.current) return;
    lastHtml.current = html;
    revision.current += 1;
    editor.tf.setValue(html ? normalizeLegacyListHtml(html) : undefined);
    externalValue.current = editor.children;
  }, [editor, html]);
  const publish = useCallback(
    (next: Value) => {
      if (next === externalValue.current) return;
      const token = ++revision.current;
      void serializeValue(next).then((serialized) => {
        if (token !== revision.current) return;
        lastHtml.current = serialized;
        change(serialized);
      });
    },
    [change],
  );

  return (
    <FieldFrame {...field}>
      {(a11y) =>
        field.readOnly ? (
          <div className="plate-rich-text plate-rich-text-static" style={textStyle(field.style)}>
            <RichTextView html={html ?? ''} />
          </div>
        ) : (
          <Plate
            editor={editor}
            onValueChange={({ value: next }) => publish(next)}
            readOnly={readOnly}
          >
            <div className="plate-rich-text" style={textStyle(field.style)}>
              <PlateContent
                {...a11y}
                className="plate-rich-text-editor"
                role="textbox"
                aria-multiline="true"
                disabled={field.disabled}
                placeholder={placeholder}
                readOnly={readOnly}
              />
              <input
                type="hidden"
                name={field.name}
                value={html ?? ''}
                readOnly
                aria-hidden="true"
              />
            </div>
          </Plate>
        )
      }
    </FieldFrame>
  );
}

export function RichTextDisplayMaterial({ value, ...field }: RichTextMaterialProps) {
  return (
    <FieldFrame {...field}>
      {() => (
        <div className="plate-rich-text plate-rich-text-static" style={textStyle(field.style)}>
          <RichTextView html={value ?? ''} />
        </div>
      )}
    </FieldFrame>
  );
}

export const richTextContracts: Contracts = {
  'ui.richTextDisplay': {
    version: '1.0.0',
    props: {
      label: requiredText,
      value: { ...textProp, required: true },
      hint: textProp,
    },
    events: ['onClick'],
    validateProps: (props) =>
      props.value !== undefined && typeof props.value !== 'string'
        ? ['value 必须为 HTML 文本']
        : [],
  },
  'ui.richText': {
    version: '1.0.0',
    field: { type: 'string', valueProp: 'value', changeEvent: 'onValueChange' },
    props: {
      label: requiredText,
      value: { ...textProp, required: true },
      placeholder: textProp,
      hint: textProp,
      disabled: boolProp,
      readOnly: boolProp,
      required: boolProp,
    },
    events: ['onValueChange', 'onBlur', 'onClick'],
    validateProps: (props) =>
      props.value !== undefined && typeof props.value !== 'string'
        ? ['value 必须为 HTML 文本']
        : [],
  },
};
