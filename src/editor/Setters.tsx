import {
  Component,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Dialog } from '@base-ui/react/dialog';
import type { Setter } from '../../packages/editor/metadata';
import type { ContractField } from '../../packages/runtime/registry';
import type { Json } from '../../packages/schema/types';
import { Button, Checkbox, Input, Select, Textarea } from '../ui/primitives';
import { editorContext } from './context';
import { errorText } from './errors';
import { SelectOptionsEditor } from './SelectOptionsEditor';
import { TableColumnsEditor } from './TableColumnsEditor';
import { CodeEditor } from '../ui/CodeEditor';
import { RichTextMaterial } from '../materials/rich-text';

/** Literal-only authoring contract. onChange is validated by the document command. */
export interface ReactSetterProps {
  id: string;
  label: string;
  value: Json | undefined;
  onChange: (value: Json) => boolean;
  error: string;
  onError: (message: string) => void;
  /** Restore metadata default, or remove an optional explicit value, via the document command. */
  onReset: () => boolean;
  onDiscardDraft: () => void;
  field: ContractField;
  setter: Setter;
  options: Readonly<Record<string, Json>>;
  /** Session-scoped raw text keeps incomplete JSON/numbers without changing the value. */
  draft: string;
  onDraftChange: (source: string) => void;
  draftKey: string;
  /** Optional for older hosts; current PropertyInput supplies invocation-time author permission. */
  canEdit?: () => boolean;
}
export type ReactSetterRegistry = Readonly<Record<string, ComponentType<ReactSetterProps>>>;

function TextSetter(props: ReactSetterProps) {
  const control = {
    id: props.id,
    value: props.error ? props.draft : String(props.value ?? ''),
    onChange: (event: { target: { value: string } }) => {
      props.onDraftChange(event.target.value);
      props.onChange(event.target.value);
    },
  };
  return props.setter.kind === 'text' && props.setter.multiline ? (
    <Textarea {...control} rows={3} />
  ) : (
    <Input {...control} />
  );
}
function JsonSetter(props: ReactSetterProps) {
  const change = (source: string) => {
    props.onDraftChange(source);
    try {
      props.onChange(JSON.parse(source));
    } catch (error) {
      props.onError(errorText(error));
    }
  };
  return props.setter.kind === 'number' ? (
    <Input
      id={props.id}
      type="number"
      step="any"
      value={props.draft}
      onChange={(event) => change(event.target.value)}
    />
  ) : (
    <CodeEditor
      id={props.id}
      label={props.label}
      language="json"
      value={props.draft}
      onChange={change}
    />
  );
}
function BooleanSetter(props: ReactSetterProps) {
  return <Checkbox id={props.id} checked={props.value === true} onCheckedChange={props.onChange} />;
}
function SelectSetter(props: ReactSetterProps) {
  if (props.setter.kind !== 'select') return null;
  const options = props.setter.options;
  return (
    <Select
      id={props.id}
      value={JSON.stringify(props.value) ?? ''}
      onValueChange={(source) => props.onChange(JSON.parse(source))}
    >
      {props.value !== undefined &&
        !options.some((option) => JSON.stringify(option.value) === JSON.stringify(props.value)) && (
          <option value={JSON.stringify(props.value)}>{String(props.value)}（自定义）</option>
        )}
      {options.map((option) => (
        <option key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}
function OptionsSetter(props: ReactSetterProps) {
  return (
    <SelectOptionsEditor value={props.value} draftKey={props.draftKey} onCommit={props.onChange} />
  );
}
function ColorSetter(props: ReactSetterProps) {
  const value = props.error ? props.draft : String(props.value ?? '');
  const change = (source: string) => {
    props.onDraftChange(source);
    props.onChange(source);
  };
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <span className="color-setter">
      <input
        type="color"
        aria-label={`${props.label} 颜色选取`}
        value={hex}
        onChange={(event) => change(event.target.value)}
      />
      <Input
        id={props.id}
        value={value}
        placeholder="如 #1e293b 或 red"
        onChange={(event) => change(event.target.value)}
      />
    </span>
  );
}
function RichTextSetter(props: ReactSetterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const saved = typeof props.value === 'string' ? props.value : '';
  const preview =
    saved
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || '空内容';
  const editable = props.canEdit?.() ?? true;
  const openEditor = () => {
    if (!editable) return;
    setDraft(saved);
    setOpen(true);
  };
  const save = () => {
    if (!editable) return;
    props.onDraftChange(draft);
    if (props.onChange(draft)) setOpen(false);
  };
  return (
    <>
      <span className="rich-text-setter">
        <Button id={props.id} disabled={!editable} onClick={openEditor}>
          编辑富文本…
        </Button>
        <span className="rich-text-setter-preview">{preview}</span>
        {props.error && <small className="field-error">{props.error}</small>}
      </span>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="material-modal-backdrop" />
          <Dialog.Popup className="material-modal rich-text-dialog" aria-label={props.label}>
            <Dialog.Title className="rich-text-dialog-title">编辑{props.label}</Dialog.Title>
            <Dialog.Description className="rich-text-dialog-description">
              直接输入富文本，保存后作为该组件的固定默认值。
            </Dialog.Description>
            <RichTextMaterial label={props.label} value={draft} onValueChange={setDraft} />
            <div className="rich-text-dialog-actions">
              <Dialog.Close className="ui-button">取消</Dialog.Close>
              <Button variant="primary" onClick={save}>
                保存默认值
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

const builtins: ReactSetterRegistry = Object.freeze({
  text: TextSetter,
  richText: RichTextSetter,
  number: JsonSetter,
  boolean: BooleanSetter,
  json: JsonSetter,
  select: SelectSetter,
  options: OptionsSetter,
  columns: TableColumnsEditor,
  color: ColorSetter,
});
/** Each host supplies an immutable registry snapshot; the same ID intentionally replaces a setter. */
export function createSetterRegistry(overrides: ReactSetterRegistry = {}): ReactSetterRegistry {
  return Object.freeze({ ...builtins, ...overrides });
}
const SetterContext = editorContext<ReactSetterRegistry>('setters', builtins);
export function useSetterRegistry() {
  return useContext(SetterContext);
}
export function SetterRegistryProvider({
  registry,
  children,
}: {
  registry: ReactSetterRegistry;
  children: ReactNode;
}) {
  return <SetterContext.Provider value={registry}>{children}</SetterContext.Provider>;
}
function fallbackSetter(field: ContractField): Setter {
  return field.type === 'string'
    ? { kind: 'text' }
    : field.type === 'number' || field.type === 'boolean'
      ? { kind: field.type }
      : { kind: 'json' };
}
class SetterBoundary extends Component<
  {
    renderer: ComponentType<ReactSetterProps>;
    setterProps: ReactSetterProps;
    fallback: ReactNode;
  },
  { failed: boolean; renderer: ComponentType<ReactSetterProps> }
> {
  state = { failed: false, renderer: this.props.renderer };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  static getDerivedStateFromProps(props: SetterBoundary['props'], state: SetterBoundary['state']) {
    return props.renderer !== state.renderer ? { renderer: props.renderer, failed: false } : null;
  }
  render() {
    if (this.state.failed)
      return (
        <>
          <p className="editor-note" role="status">
            设置器无法显示，已使用基础编辑器。
          </p>
          {this.props.fallback}
          <Button
            onClick={() => {
              this.props.setterProps.onDiscardDraft();
              this.setState({ failed: false });
            }}
          >
            重试设置器
          </Button>
        </>
      );
    const Setter = this.props.renderer;
    return <Setter {...this.props.setterProps} />;
  }
}
/** Builtins and host React setters share this host; bindings never enter it. */
export function LiteralSetter(props: ReactSetterProps) {
  const registry = useContext(SetterContext);
  const id = props.setter.kind === 'custom' ? props.setter.id : props.setter.kind;
  const renderer = Object.hasOwn(registry, id) ? registry[id] : undefined;
  const lifetime = useRef({ renderer, id, active: true });
  if (lifetime.current.renderer !== renderer || lifetime.current.id !== id) {
    lifetime.current.active = false;
    lifetime.current = { renderer, id, active: true };
  }
  const currentLifetime = lifetime.current;
  useEffect(() => {
    currentLifetime.active = true;
    return () => {
      currentLifetime.active = false;
    };
  }, [currentLifetime]);
  // Retained callbacks belong to this mounted host generation. Returning to the same
  // authoring mode or replacing the registered renderer cannot reactivate old setters.
  const hostProps = props;
  props = {
    ...hostProps,
    canEdit: () => currentLifetime.active && (hostProps.canEdit?.() ?? true),
    onChange: (value) => {
      if (!currentLifetime.active) return false;
      const accepted = hostProps.onChange(value);
      // A columns Apply receipt cannot finish a draft in a host replaced during commit.
      return hostProps.setter.kind === 'columns' ? currentLifetime.active && accepted : accepted;
    },
    onReset: () => currentLifetime.active && hostProps.onReset(),
    onDraftChange: (draft) => {
      if (currentLifetime.active) hostProps.onDraftChange(draft);
    },
    onError: (message) => {
      if (currentLifetime.active) hostProps.onError(message);
    },
    onDiscardDraft: () => {
      if (currentLifetime.active) hostProps.onDiscardDraft();
    },
  };
  const fallback =
    props.setter.kind === 'custom'
      ? fallbackSetter(props.field)
      : props.setter.kind === 'columns'
        ? ({ kind: 'json' } as const)
        : props.setter;
  const Fallback = builtins[fallback.kind];
  const fallbackControl = <Fallback {...props} setter={fallback} options={{}} />;
  if (!renderer)
    return (
      <>
        <p className="editor-note" role="status">
          设置器 {id} 未注册，已使用基础编辑器。
        </p>
        {fallbackControl}
      </>
    );
  return (
    <SetterBoundary key={id} renderer={renderer} setterProps={props} fallback={fallbackControl} />
  );
}
