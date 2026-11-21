import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import {
  createSetterRegistry,
  SetterRegistryProvider,
  type ReactSetterProps,
} from '../src/editor/Setters';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
function Inspector({ document }: { document: EditorDocument }) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  return <PropertyPanel document={document} snapshot={snapshot} />;
}
function mount(document: EditorDocument, setter?: (props: ReactSetterProps) => React.ReactNode) {
  render(
    <SetterRegistryProvider
      registry={createSetterRegistry(setter ? { 'style.value': setter } : {})}
    >
      <EditorSessionProvider>
        <Inspector document={document} />
      </EditorSessionProvider>
    </SetterRegistryProvider>,
  );
  fireEvent.click(screen.getByRole('tab', { name: '样式' }));
}
const make = () => new EditorDocument(exampleApplication, registry);
const style = (doc: EditorDocument, id = 'purchase-heading') =>
  findNode(doc.getSnapshot().plan.pages.get('purchase')!.schema, id)!.node.style;

describe('style inspector', () => {
  it('lazily mounts styles and preserves invalid and binding drafts across inspector tabs', () => {
    const doc = make();
    let width!: ReactSetterProps;
    let height!: ReactSetterProps;
    mount(doc, (props) => {
      if (props.options.property === 'width') width = props;
      if (props.options.property === 'height') height = props;
      return <input id={props.id} aria-label={props.label} value={props.draft} readOnly />;
    });
    const oldWidth = width;
    const oldHeight = height;
    act(() => {
      width.onDraftChange('bad');
      width.onError('invalid width');
    });
    fireEvent.click(screen.getByRole('button', { name: '高度绑定设置' }));
    changeControl(screen.getByRole('combobox', { name: '高度绑定取值方式' }), 'expression');
    changeControl(screen.getByRole('textbox', { name: '高度绑定' }), 'state.');
    fireEvent.click(screen.getByRole('tab', { name: '属性' }));
    expect(document.querySelector('.style-panel')).toBeNull();
    const before = doc.exportJson();
    act(() => {
      expect(oldWidth.onChange('12px')).toBe(false);
      expect(oldHeight.onReset()).toBe(false);
      oldWidth.onDraftChange('obsolete');
      oldWidth.onError('obsolete');
      oldWidth.onDiscardDraft();
      oldHeight.onDraftChange('obsolete');
      oldHeight.onError('obsolete');
      oldHeight.onDiscardDraft();
    });
    fireEvent.click(screen.getByRole('tab', { name: '样式' }));
    expect((screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement).value).toBe('bad');
    expect(screen.getByRole('alert').textContent).toBe('invalid width');
    fireEvent.click(screen.getByRole('button', { name: '高度绑定设置' }));
    expect((screen.getByRole('textbox', { name: '高度绑定' }) as HTMLTextAreaElement).value).toBe(
      'state.',
    );
    act(() => {
      expect(oldWidth.onReset()).toBe(false);
      expect(oldHeight.onChange(99)).toBe(false);
    });
    expect(doc.exportJson()).toBe(before);
    expect((screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement).value).toBe('bad');
  });
  it('accepts natural values, keeps invalid input local, restores and supports undo', () => {
    const doc = make();
    mount(doc);
    changeControl(screen.getByRole('textbox', { name: '宽度' }), '100%');
    expect(style(doc)?.width).toEqual({ kind: 'literal', value: '100%' });
    changeControl(screen.getByRole('textbox', { name: '高度' }), '16');
    expect(style(doc)?.height).toEqual({ kind: 'literal', value: 16 });
    const before = doc.exportJson();
    changeControl(screen.getByRole('textbox', { name: '高度' }), '-12');
    expect(doc.exportJson()).toBe(before);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '高度' }) as HTMLInputElement).value).toBe('-12');
    fireEvent.click(screen.getByRole('button', { name: '恢复高度' }));
    expect(style(doc)?.height).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => doc.undo());
    expect(style(doc)?.height).toEqual({ kind: 'literal', value: 16 });
  });
  it('clears invalid drafts from collapsed groups, and restores a group in one undo', () => {
    const doc = make();
    mount(doc);
    changeControl(screen.getByRole('textbox', { name: '宽度' }), '10px');
    changeControl(screen.getByRole('textbox', { name: '高度' }), '20px');
    changeControl(screen.getByRole('textbox', { name: '高度' }), 'bad');
    fireEvent.click(screen.getByRole('button', { name: '尺寸' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复尺寸分组' }));
    expect(style(doc)).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: '尺寸' }));
    expect((screen.getByRole('textbox', { name: '高度' }) as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => doc.undo());
    expect(style(doc)).toEqual({
      width: { kind: 'literal', value: '10px' },
      height: { kind: 'literal', value: '20px' },
    });
  });
  it('only expands binding controls on request and applies expression through the shared editor', () => {
    const doc = make();
    mount(doc);
    expect(screen.queryByRole('combobox', { name: '宽度绑定取值方式' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '宽度绑定设置' }));
    changeControl(screen.getByRole('combobox', { name: '宽度绑定取值方式' }), 'expression');
    changeControl(screen.getByRole('textbox', { name: '宽度绑定' }), "'30px'");
    fireEvent.click(screen.getByRole('button', { name: '应用绑定' }));
    expect(style(doc)?.width).toEqual({
      kind: 'expression',
      language: 'javascript',
      source: "'30px'",
    });
    expect(screen.queryByRole('textbox', { name: '宽度' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '切换固定值' }));
    expect(style(doc)?.width).toBeUndefined();
    expect(screen.getByRole('textbox', { name: '宽度' })).toBeTruthy();
  });
  it('protects latest bindings and selection from callbacks retained by a host React style setter', () => {
    const doc = make();
    let retained: ReactSetterProps | undefined;
    mount(doc, (props) => {
      if (props.options.property === 'width') retained = props;
      return <input id={props.id} aria-label={props.label} value={props.draft} readOnly />;
    });
    const old = retained!;
    act(() =>
      doc.setStyle('purchase', 'purchase-heading', {
        width: { kind: 'expression', language: 'javascript', source: "'40px'" },
      }),
    );
    let changed = true;
    act(() => {
      changed = old.onChange('99px');
    });
    expect(changed).toBe(false);
    expect(style(doc)?.width?.kind).toBe('expression');
    act(() => doc.select('purchase', 'purchase-name'));
    const before = doc.exportJson();
    act(() => {
      old.onChange('88px');
      old.onReset();
      old.onDraftChange('obsolete');
      old.onError('obsolete');
    });
    expect(doc.exportJson()).toBe(before);
    expect(doc.getSnapshot().selection.nodeId).toBe('purchase-name');
  });
  it('clears all folded drafts and keeps fixed binding input free of JSON quoting', () => {
    const doc = make();
    mount(doc);
    fireEvent.click(screen.getByRole('button', { name: '宽度绑定设置' }));
    changeControl(screen.getByRole('combobox', { name: '宽度绑定取值方式' }), 'literal');
    changeControl(screen.getByRole('textbox', { name: '宽度绑定' }), '100%');
    fireEvent.click(screen.getByRole('button', { name: '应用绑定' }));
    expect(style(doc)?.width).toEqual({ kind: 'literal', value: '100%' });
    changeControl(screen.getByRole('textbox', { name: '高度' }), 'bad');
    fireEvent.click(screen.getByRole('button', { name: '尺寸' }));
    fireEvent.click(screen.getByRole('button', { name: '恢复全部样式' }));
    fireEvent.click(screen.getByRole('button', { name: '尺寸' }));
    expect(style(doc)).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox', { name: '高度' }) as HTMLInputElement).value).toBe('');
    act(() => doc.undo());
    expect(style(doc)?.width).toEqual({ kind: 'literal', value: '100%' });
  });
  it('shows only supported keys, semantic target hints and no native title', () => {
    const doc = make();
    doc.select('purchase', 'purchase-name');
    mount(doc);
    expect(screen.getByText(/尺寸、间距和背景作用于整个字段/)).toBeTruthy();
    expect(document.querySelector('[title]')).toBeNull();
    expect(screen.getByRole('button', { name: '间距' }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });
  it.each(['expression', 'dataRef', 'unset'])(
    'protects a pending %s style binding from every retained literal setter callback',
    (mode) => {
      const doc = make();
      doc.setStyle('purchase', 'purchase-heading', { width: { kind: 'literal', value: 24 } });
      let captured!: ReactSetterProps;
      mount(doc, (props) => {
        if (props.options.property === 'width') captured = props;
        return <input id={props.id} aria-label={props.label} value={props.draft} readOnly />;
      });
      const old = captured;
      fireEvent.click(screen.getByRole('button', { name: '宽度绑定设置' }));
      changeControl(screen.getByRole('combobox', { name: '宽度绑定取值方式' }), mode);
      if (mode === 'expression')
        changeControl(screen.getByRole('textbox', { name: '宽度绑定' }), 'state.');
      const before = doc.exportJson();
      act(() => {
        expect(old.onChange('99px')).toBe(false);
        expect(old.onReset()).toBe(false);
        old.onDraftChange('obsolete');
        old.onError('obsolete');
        old.onDiscardDraft();
      });
      expect(doc.exportJson()).toBe(before);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('combobox', { name: '宽度绑定取值方式' }).textContent).toContain(
        mode === 'expression' ? 'JavaScript 表达式' : mode === 'dataRef' ? '数据源' : '不设置',
      );
      if (mode === 'expression')
        expect(
          (screen.getByRole('textbox', { name: '宽度绑定' }) as HTMLTextAreaElement).value,
        ).toBe('state.');
      fireEvent.click(screen.getByRole('button', { name: '切换固定值' }));
      expect(style(doc)?.width).toEqual({ kind: 'literal', value: 24 });
      expect(screen.getByRole('textbox', { name: '宽度' })).toBeTruthy();
      act(() => {
        expect(old.onChange('must remain inactive')).toBe(false);
        expect(old.onReset()).toBe(false);
        old.onDraftChange('obsolete');
        old.onError('obsolete');
        old.onDiscardDraft();
      });
      expect(doc.exportJson()).toBe(before);
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );
});
