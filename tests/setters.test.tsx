import { useSyncExternalStore, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { validateCatalog, type MaterialCatalog } from '../packages/editor/metadata';
import { exampleApplication } from './fixtures/examples';
import { registry } from '../src/materials';
import { catalog } from '../src/editor/catalog';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import {
  createSetterRegistry,
  SetterRegistryProvider,
  type ReactSetterProps,
} from '../src/editor/Setters';
import type { Json } from '../packages/schema/types';
import { changeControl } from './ui-helpers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const literal = (value: string) => ({ kind: 'literal' as const, value });
const make = () => new EditorDocument(exampleApplication, registry);
const title = (document: EditorDocument) =>
  findNode(document.getSnapshot().plan.pages.get('purchase')!.schema, 'purchase-heading')!.node
    .props.value;
function customCatalog(name = 'value', id = 'host.title') {
  const next = structuredClone(catalog);
  next['ui.text'].properties.find((prop) => prop.name === name)!.setter = {
    kind: 'custom',
    id,
    options: { suffix: '!' },
  };
  return next;
}
function Inspector({
  document,
  metadata = catalog,
}: {
  document: EditorDocument;
  metadata?: MaterialCatalog;
}) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  return <PropertyPanel document={document} snapshot={snapshot} materialCatalog={metadata} />;
}
function Host({
  document,
  metadata,
  setter = HostSetter,
}: {
  document: EditorDocument;
  metadata?: MaterialCatalog;
  setter?: ComponentType<ReactSetterProps>;
}) {
  return (
    <SetterRegistryProvider registry={createSetterRegistry({ 'host.title': setter })}>
      <EditorSessionProvider>
        <Inspector document={document} metadata={metadata} />
      </EditorSessionProvider>
    </SetterRegistryProvider>
  );
}
function HostSetter(props: ReactSetterProps) {
  return (
    <div>
      <input
        id={props.id}
        value={String(props.value ?? '')}
        onChange={(event) => props.onChange(event.target.value + props.options.suffix)}
      />
      <button onClick={() => props.onChange(undefined as unknown as Json)}>提交错误类型</button>
      <button onClick={props.onReset}>恢复属性默认值</button>
      <button onClick={() => props.onError('宿主输入错误')}>报告输入错误</button>
    </div>
  );
}

describe('registered React property setters', () => {
  it('uses host TSX metadata and options, validates commits, and supports undo/redo/reset', () => {
    const document = make();
    render(<Host document={document} metadata={customCatalog()} />);
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), '宿主');
    expect(title(document)).toEqual({ kind: 'literal', value: '宿主!' });
    act(() => document.undo());
    expect(title(document)).toEqual({ kind: 'literal', value: '创建采购申请' });
    act(() => document.redo());
    expect(title(document)).toEqual({ kind: 'literal', value: '宿主!' });
    const before = document.exportJson();
    fireEvent.click(screen.getByRole('button', { name: '提交错误类型' }));
    expect(document.exportJson()).toBe(before);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复属性默认值' }));
    expect(title(document)).toEqual({ kind: 'literal', value: '新的文本' });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => document.undo());
    expect(title(document)).toEqual({ kind: 'literal', value: '宿主!' });
  });
  it('replaces an existing setter ID and routes builtins through the same registry', () => {
    const document = make();
    const replacement = (props: ReactSetterProps) => (
      <input
        id={props.id}
        aria-label={`${props.label}替代编辑器`}
        value={String(props.value)}
        onChange={(event) => props.onChange(event.target.value)}
      />
    );
    const view = render(
      <SetterRegistryProvider registry={createSetterRegistry({ text: replacement })}>
        <EditorSessionProvider>
          <Inspector document={document} />
        </EditorSessionProvider>
      </SetterRegistryProvider>,
    );
    changeControl(screen.getByRole('textbox', { name: '文本内容替代编辑器' }), '替换内置');
    expect(title(document)).toEqual({ kind: 'literal', value: '替换内置' });
    view.rerender(
      <SetterRegistryProvider registry={createSetterRegistry()}>
        <EditorSessionProvider>
          <Inspector document={document} />
        </EditorSessionProvider>
      </SetterRegistryProvider>,
    );
    expect(screen.queryByRole('textbox', { name: '文本内容替代编辑器' })).toBeNull();
    expect((screen.getByRole('textbox', { name: '文本内容' }) as HTMLInputElement).value).toBe(
      '替换内置',
    );
  });
  it('falls back locally for missing and throwing setters without changing accepted values', () => {
    const document = make(),
      metadata = customCatalog('value', 'host.missing');
    const view = render(<Host document={document} metadata={metadata} />);
    expect(screen.getByText(/host.missing 未注册/)).toBeTruthy();
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), JSON.stringify('基础编辑'));
    expect(title(document)).toEqual({ kind: 'literal', value: '基础编辑' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = () => {
      throw new Error('host render error');
    };
    view.rerender(<Host document={document} metadata={customCatalog()} setter={Broken} />);
    expect(screen.getByText(/设置器无法显示/)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: '文本内容' })).toBeTruthy();
    changeControl(screen.getByRole('textbox', { name: '文本内容' }), JSON.stringify('异常回退'));
    expect(title(document)).toEqual({ kind: 'literal', value: '异常回退' });
    view.rerender(<Host document={document} metadata={customCatalog()} />);
    expect(screen.queryByText(/设置器无法显示/)).toBeNull();
    expect(screen.getByRole('button', { name: '恢复属性默认值' })).toBeTruthy();
  });
  it('never renders a literal setter for dynamic bindings and rejects retained callbacks', () => {
    const document = make();
    let retained: ReactSetterProps | undefined;
    function Capture(props: ReactSetterProps) {
      retained = props;
      return <HostSetter {...props} />;
    }
    render(<Host document={document} metadata={customCatalog()} setter={Capture} />);
    const previous = retained!;
    act(() =>
      document.setProp('purchase', 'purchase-heading', 'value', {
        kind: 'expression',
        language: 'javascript',
        source: '"动态标题"',
      }),
    );
    expect(screen.queryByRole('button', { name: '提交错误类型' })).toBeNull();
    const before = document.exportJson();
    act(() => {
      expect(previous.onChange('不能覆盖')).toBe(false);
      expect(previous.onReset()).toBe(false);
    });
    expect(document.exportJson()).toBe(before);
    expect(screen.queryByRole('button', { name: '标题放弃草稿' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('textbox', { name: '文本内容' })).toBeTruthy();
  });
  it('keeps missing setters from affecting expressions and field-owned properties', () => {
    const document = make();
    const metadata = customCatalog('value', 'host.missing');
    act(() =>
      document.setProp('purchase', 'purchase-heading', 'value', {
        kind: 'expression',
        language: 'javascript',
        source: '"表达式"',
      }),
    );
    render(<Host document={document} metadata={metadata} />);
    expect(screen.queryByText(/未注册/)).toBeNull();
    const spy = vi.fn(HostSetter);
    const inputMetadata = structuredClone(catalog);
    inputMetadata['ui.input'].properties.find((prop) => prop.name === 'value')!.setter = {
      kind: 'custom',
      id: 'host.title',
    };
    cleanup();
    act(() => document.select('purchase', 'purchase-name'));
    render(<Host document={document} metadata={inputMetadata} setter={spy} />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('输入值绑定方式')).toBeNull();
  });
  it('resets optional values by removal and rejects reset of required values with no default', () => {
    const document = make(),
      metadata = customCatalog('tone');
    document.setProp('purchase', 'purchase-heading', 'tone', literal('muted'));
    const view = render(<Host document={document} metadata={metadata} />);
    fireEvent.click(screen.getByRole('button', { name: '恢复属性默认值' }));
    expect(
      findNode(document.getSnapshot().plan.pages.get('purchase')!.schema, 'purchase-heading')!.node
        .props.tone,
    ).toBeUndefined();
    const required = customCatalog();
    delete required['ui.text'].defaultProps.value;
    view.rerender(<Host document={document} metadata={required} />);
    const before = document.exportJson();
    fireEvent.click(screen.getByRole('button', { name: '恢复属性默认值' }));
    expect(document.exportJson()).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain('必填属性没有可恢复的默认值');
  });
  it('checks custom metadata without requiring its UI implementation in runtime schema', () => {
    const metadata = customCatalog();
    expect(validateCatalog(metadata, registry)).toEqual([]);
    metadata['ui.text'].properties[0].setter = { kind: 'custom', id: '' };
    expect(validateCatalog(metadata, registry)).toContain('ui.text.value 自定义设置器配置无效');
  });
  it.each(['expression', 'invalid-expression', 'dataRef'])(
    'rejects retained literal callbacks while an unapplied %s authoring session is active',
    (mode) => {
      const document = make();
      let captured!: ReactSetterProps;
      render(
        <Host
          document={document}
          metadata={customCatalog()}
          setter={(props) => {
            captured = props;
            return <input id={props.id} value={String(props.value)} readOnly />;
          }}
        />,
      );
      const old = captured;
      changeControl(
        screen.getByRole('combobox', { name: '文本内容绑定方式' }),
        mode === 'dataRef' ? 'dataRef' : 'expression',
      );
      if (mode === 'invalid-expression')
        changeControl(screen.getByRole('textbox', { name: '文本内容' }), 'state.');
      const before = document.exportJson();
      const selection = document.getSnapshot().selection;
      const alerts = screen.queryAllByRole('alert').map((element) => element.textContent);
      act(() => {
        expect(old.onChange('obsolete')).toBe(false);
        expect(old.onReset()).toBe(false);
        old.onDraftChange('obsolete');
        old.onError('obsolete');
        old.onDiscardDraft();
      });
      expect(document.exportJson()).toBe(before);
      expect(document.getSnapshot().selection).toBe(selection);
      expect(screen.getByRole('combobox', { name: '文本内容绑定方式' }).textContent).toContain(
        mode === 'dataRef' ? '数据源' : '表达式',
      );
      expect(screen.queryAllByRole('alert').map((element) => element.textContent)).toEqual(alerts);
      if (mode !== 'dataRef')
        expect((screen.getByRole('textbox', { name: '文本内容' }) as HTMLTextAreaElement).value).toBe(
          mode === 'invalid-expression' ? 'state.' : '',
        );
      changeControl(screen.getByRole('combobox', { name: '文本内容绑定方式' }), 'literal');
      const fixed = document.exportJson();
      act(() => {
        expect(old.onChange('must remain inactive')).toBe(false);
        expect(old.onReset()).toBe(false);
        old.onDraftChange('obsolete');
        old.onError('obsolete');
        old.onDiscardDraft();
      });
      expect(document.exportJson()).toBe(fixed);
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );
  it.each([
    ['ui.select', 'multiple', 'a', 'b'],
    ['ui.date', 'range', '2026-11-08', '2026-11-09'],
  ])(
    'uses latest related values and protects new bindings for %s',
    (component, property, initial, next) => {
      const source = structuredClone(exampleApplication);
      source.dependencies.components[component] = registry.components[component].version;
      source.pages[0].children.push({
        id: 'host-target',
        component,
        props: Object.fromEntries(
          Object.entries({
            ...catalog[component].defaultProps,
            value: initial,
            [property]: false,
          }).map(([key, value]) => [key, { kind: 'literal' as const, value }]),
        ),
      });
      const document = new EditorDocument(source, registry);
      document.select('purchase', 'host-target');
      const metadata = structuredClone(catalog);
      metadata[component].properties.find((prop) => prop.name === property)!.setter = {
        kind: 'custom',
        id: 'host.title',
      };
      let captured!: ReactSetterProps;
      function Capture(props: ReactSetterProps) {
        captured = props;
        return null;
      }
      render(<Host document={document} metadata={metadata} setter={Capture} />);
      const old = captured;
      act(() =>
        document.setProp('purchase', 'host-target', 'value', {
          kind: 'expression',
          language: 'javascript',
          source: JSON.stringify(next),
        }),
      );
      const before = document.exportJson();
      act(() => {
        expect(old.onChange(true)).toBe(false);
      });
      expect(document.exportJson()).toBe(before);
      act(() =>
        document.setProp('purchase', 'host-target', 'value', { kind: 'literal', value: next }),
      );
      const latestLiteral = document.exportJson();
      act(() => {
        expect(old.onChange(true)).toBe(false);
      });
      expect(document.exportJson()).toBe(latestLiteral);
      const fresh = captured;
      expect(fresh).not.toBe(old);
      act(() => {
        expect(fresh.onChange(true)).toBe(true);
      });
      const node = findNode(
        document.getSnapshot().plan.pages.get('purchase')!.schema,
        'host-target',
      )!.node;
      expect(node.props.value).toEqual({
        kind: 'literal',
        value: component === 'ui.select' ? [next] : [next, next],
      });
    },
  );
});
