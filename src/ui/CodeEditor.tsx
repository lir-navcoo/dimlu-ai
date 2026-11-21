import { useEffect, useId, useRef, useState } from 'react';
import type { editor } from 'monaco-editor/editor/editor.api.js';
import { Dialog } from '@base-ui/react/dialog';
import { Maximize2, X } from 'lucide-react';
import { Button, Tip } from './primitives';
import './code-editor.css';

export interface CodeEditorProps {
  id?: string;
  label: string;
  language: 'javascript' | 'typescript' | 'json' | 'css';
  value: string;
  onChange: (value: string) => void;
  height?: number;
  fill?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  expandable?: boolean;
}

/** Controlled text is owned by the caller's draft, never by a shared Monaco model. */
export function CodeEditor(props: CodeEditorProps) {
  const uid = useId();
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const instance = useRef<editor.IStandaloneCodeEditor | null>(null);
  const applying = useRef(false);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>(
    typeof Worker === 'undefined' ? 'fallback' : 'loading',
  );
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [dialogVisited, setDialogVisited] = useState(false);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !frame.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || typeof Worker === 'undefined') return;
    let alive = true;
    let model: editor.ITextModel | undefined;
    let subscription: { dispose(): void } | undefined;
    let control: editor.IStandaloneCodeEditor | undefined;
    void import('./monaco')
      .then(({ monaco }) => {
        if (!alive || !host.current) return;
        const initial = latest.current;
        const extension = { javascript: 'jsx', typescript: 'tsx', json: 'json', css: 'css' }[
          initial.language
        ];
        model = monaco.editor.createModel(
          initial.value,
          initial.language,
          monaco.Uri.parse(`inmemory://dimlu/${encodeURIComponent(uid)}.${extension}`),
        );
        control = monaco.editor.create(host.current, {
          model,
          automaticLayout: true,
          fontSize: 12,
          lineHeight: 19,
          fontFamily: "Consolas, 'SFMono-Regular', monospace",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          lineNumbersMinChars: 3,
          folding: true,
          glyphMargin: false,
          tabSize: 2,
          padding: { top: 8, bottom: 8 },
          overviewRulerLanes: 0,
          renderLineHighlight: 'line',
          readOnly: initial.readOnly,
          ariaLabel: initial.label,
          fixedOverflowWidgets: true,
          // Keep a native textarea for label focus and assistive input compatibility.
          editContext: false,
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        });
        instance.current = control;
        const input = control
          .getDomNode()
          ?.querySelector<HTMLTextAreaElement>('textarea.inputarea');
        if (input && initial.id) input.id = initial.id;
        subscription = control.onDidChangeModelContent(() => {
          if (alive && !applying.current) latest.current.onChange(control!.getValue());
        });
        setState('ready');
      })
      .catch((reason: unknown) => {
        control?.dispose();
        model?.dispose();
        subscription?.dispose();
        if (alive) {
          instance.current = null;
          setError(reason instanceof Error ? reason.message : String(reason));
          setState('fallback');
        }
      });
    return () => {
      alive = false;
      subscription?.dispose();
      control?.dispose();
      model?.dispose();
      instance.current = null;
    };
  }, [uid, visible]);
  useEffect(() => {
    const control = instance.current;
    if (!control) return;
    if (control.getValue() !== props.value) {
      applying.current = true;
      try {
        control.setValue(props.value);
      } finally {
        applying.current = false;
      }
    }
    control.updateOptions({ readOnly: props.readOnly, ariaLabel: props.label });
    void import('./monaco').then(({ monaco }) => {
      if (instance.current === control && control.getModel())
        monaco.editor.setModelLanguage(control.getModel()!, latest.current.language);
    });
  }, [props.value, props.language, props.readOnly, props.label, state]);
  return (
    <div
      ref={frame}
      className={`code-editor ${props.fill ? 'code-editor-fill' : ''}`}
      style={props.fill ? undefined : { height: props.height ?? 144 }}
      data-code-language={props.language}
    >
      <div className="code-editor-monaco" ref={host} hidden={state !== 'ready'} />
      {state !== 'ready' && (
        <textarea
          id={props.id}
          aria-label={props.label}
          className="code-editor-fallback ui-textarea"
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          readOnly={props.readOnly}
          placeholder={props.placeholder}
          spellCheck={false}
        />
      )}
      {state === 'loading' && <span className="code-editor-status">正在加载代码编辑器…</span>}
      {error && (
        <span className="code-editor-status" role="status">
          代码编辑器加载失败，已使用文本编辑：{error}
        </span>
      )}
      {props.expandable !== false && (
        <Tip content="展开代码编辑器">
          <Button
            className="code-editor-expand"
            variant="ghost"
            aria-label={`展开${props.label}`}
            onClick={() => {
              setDialogVisited(true);
              setExpanded(true);
            }}
          >
            <Maximize2 size={12} />
          </Button>
        </Tip>
      )}
      {props.expandable !== false && dialogVisited && (
        <Dialog.Root open={expanded} onOpenChange={setExpanded}>
          <Dialog.Portal>
            <Dialog.Backdrop className="material-modal-backdrop" />
            <Dialog.Popup className="code-editor-dialog">
              <div className="code-editor-dialog-header">
                <Dialog.Title>{props.label}</Dialog.Title>
                <Dialog.Close className="ui-button" aria-label={`关闭${props.label}编辑器`}>
                  <X size={14} />
                </Dialog.Close>
              </div>
              <Dialog.Description className="editor-note">
                编辑内容与原面板同步，关闭后可继续配置。
              </Dialog.Description>
              <CodeEditor {...props} id={undefined} fill expandable={false} />
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}
