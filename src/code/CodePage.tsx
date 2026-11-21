import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {
  Component,
  Suspense,
  createElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  RuntimeRenderer,
  useRuntime,
  useRuntimeState,
  useForm,
  useField,
  useFieldArray,
  useDataSource,
  useDesignMode,
} from '../../packages/react-runtime/Renderer';
import type { PageRuntime } from '../../packages/runtime/engine';
import type { PageCode } from '../../packages/schema/types';
import type { CompiledPageCode } from './compiler';
import { materials } from '../materials';
import { Button } from '../ui/primitives';
import { errorText } from '../editor/errors';

const runtimeExports = Object.freeze({
  useRuntime,
  useRuntimeState,
  useForm,
  useField,
  useFieldArray,
  useDataSource,
  useDesignMode,
});
const modules: Readonly<Record<string, unknown>> = Object.freeze({
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@dimlu/runtime': runtimeExports,
});

/** This runs trusted author code in the current window; it is NOT a sandbox. */
export function evaluatePageCode(
  compiled: CompiledPageCode,
): ComponentType<{ runtime: PageRuntime }> {
  const module = { exports: {} as Record<string, unknown> };
  const requireModule = (id: string) => {
    if (!Object.hasOwn(modules, id)) throw new Error(`不支持导入模块 ${id}`);
    return modules[id];
  };
  new Function('require', 'module', 'exports', compiled.code)(
    requireModule,
    module,
    module.exports,
  );
  const result = module.exports.default;
  const tag =
    result && typeof result === 'object' ? (result as { $$typeof?: symbol }).$$typeof : undefined;
  if (
    typeof result !== 'function' &&
    ![Symbol.for('react.memo'), Symbol.for('react.forward_ref'), Symbol.for('react.lazy')].includes(
      tag!,
    )
  )
    throw new Error(
      '页面代码需要 export default 一个 React 组件（函数、class、memo、forwardRef 或 lazy）。',
    );
  return result as ComponentType<{ runtime: PageRuntime }>;
}

function Failure({ message, retry }: { message: string; retry: () => void }) {
  return (
    <section className="page-code-failure" role="alert">
      <strong>页面代码运行失败</strong>
      <pre>{message}</pre>
      <Button onClick={retry}>重试代码</Button>
    </section>
  );
}
class CodeBoundary extends Component<
  { children: ReactNode; retry: () => void },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: errorText(error) };
  }
  render() {
    return this.state.error ? (
      <Failure message={this.state.error} retry={this.props.retry} />
    ) : (
      this.props.children
    );
  }
}

function ShadowContent({ css, children }: { css: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  useLayoutEffect(() => {
    if (host.current)
      setRoot(host.current.shadowRoot ?? host.current.attachShadow({ mode: 'open' }));
  }, []);
  return (
    <div ref={host} className="page-code-host">
      {root &&
        createPortal(
          <>
            <style>{`:host { display: block; min-width: 0; }\n${css}`}</style>
            {children}
          </>,
          root,
        )}
    </div>
  );
}
function ActiveCode({ code, runtime }: { code: PageCode; runtime: PageRuntime }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    component?: ComponentType<{ runtime: PageRuntime }>;
    error?: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const current = () => active && !runtime.disposed;
    setLoaded(null);
    void import('./compiler')
      .then(({ compilePageCode }) => {
        if (!current()) return;
        const compiled = compilePageCode(code);
        if (!current()) return;
        const component = evaluatePageCode(compiled);
        if (current()) setLoaded({ component });
      })
      .catch((error: unknown) => {
        if (current()) setLoaded({ error: errorText(error) });
      });
    return () => {
      active = false;
    };
  }, [code.source, code.language, attempt, runtime]);
  const retry = () => {
    setLoaded(null);
    setAttempt((value) => value + 1);
  };
  if (runtime.disposed) return <p role="status">页面运行实例已结束。</p>;
  if (loaded?.error) return <Failure message={loaded.error} retry={retry} />;
  if (!loaded?.component) return <p role="status">正在编译页面代码…</p>;
  return (
    <CodeBoundary key={attempt} retry={retry}>
      <ShadowContent css={code.css}>
        <Suspense fallback={<p>正在加载代码组件…</p>}>
          {createElement(loaded.component, { runtime })}
        </Suspense>
      </ShadowContent>
    </CodeBoundary>
  );
}

export function CodePageCanvas({
  code,
  runtime,
  mode,
  openCode,
}: {
  code: PageCode;
  runtime: PageRuntime;
  mode: 'edit' | 'preview';
  openCode: () => void;
}) {
  if (mode === 'edit')
    return (
      <section className="page-code-placeholder">
        <strong>React 代码页面</strong>
        <p>编辑模式保留页面结构，不执行作者代码。切换预览运行页面。</p>
        <Button onClick={openCode}>打开页面代码</Button>
      </section>
    );
  return (
    <RuntimeRenderer runtime={runtime} materials={materials}>
      <ActiveCode
        key={`${runtime.instanceId}/${code.language}/${code.source}`}
        code={code}
        runtime={runtime}
      />
    </RuntimeRenderer>
  );
}
