import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PageRuntime } from '../packages/runtime/engine';
import type { Value } from '../packages/schema/types';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import {
  createSetterRegistry,
  SetterRegistryProvider,
  type ReactSetterProps,
  type ReactSetterRegistry,
} from '../src/editor/Setters';
import { exampleApplication } from './fixtures/examples';
import { materials, registry } from '../src/materials';
import { changeControl } from './ui-helpers';

afterEach(cleanup);
const literal = (value: number | string): Value => ({ kind: 'literal', value });
const make = () => new EditorDocument(exampleApplication, registry);
const headerStyle = {
  color: literal('#1e293b'),
  fontSize: literal(22),
  fontWeight: literal(700),
  lineHeight: literal(1.4),
  marginBottom: literal(2),
};
const selected = (document: EditorDocument) => {
  const { pageId, nodeId } = document.getSnapshot().selection;
  return findNode(document.getSnapshot().plan.pages.get(pageId)!.schema, nodeId!)!.node;
};
function Workbench({
  document,
  setters,
  onRuntime,
}: {
  document: EditorDocument;
  setters?: ReactSetterRegistry;
  onRuntime?: (runtime: PageRuntime) => void;
}) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  const runtime = useMemo(
    () => new PageRuntime(snapshot.plan, snapshot.selection.pageId, { designMode: true }),
    [snapshot.plan, snapshot.selection.pageId],
  );
  useEffect(() => () => runtime.dispose(), [runtime]);
  onRuntime?.(runtime);
  return (
    <SetterRegistryProvider registry={setters ?? createSetterRegistry()}>
      <EditorSessionProvider>
        <PropertyPanel document={document} snapshot={snapshot} />
        <RuntimeRenderer runtime={runtime} materials={materials} designMode />
      </EditorSessionProvider>
    </SetterRegistryProvider>
  );
}
const showStyle = () => fireEvent.click(screen.getByRole('tab', { name: '样式' }));

describe('cycle 009 independent style inspector acceptance', () => {
  it('accepts natural units and retains invalid drafts and redo across selection changes', () => {
    const document = make();
    document.setStyle('purchase', 'purchase-heading', { width: literal(120) });
    document.setStyle('purchase', 'purchase-heading', { width: literal(121) });
    document.undo();
    render(<Workbench document={document} />);
    showStyle();
    const before = document.getSnapshot();
    changeControl(screen.getByRole('textbox', { name: '宽度' }), '12p');
    expect(document.getSnapshot()).toBe(before);
    expect(before.canRedo).toBe(true);
    act(() => document.select('purchase', 'purchase-name'));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => document.select('purchase', 'purchase-heading'));
    showStyle();
    expect((screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement).value).toBe('12p');
    act(() => document.redo());
    expect(selected(document).style?.width).toEqual(literal(121));
    expect((screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement).value).toBe('12p');
    changeControl(screen.getByRole('textbox', { name: '宽度' }), '100%');
    expect(selected(document).style?.width).toEqual(literal('100%'));
    changeControl(screen.getByRole('textbox', { name: '宽度' }), 'auto');
    expect(selected(document).style?.width).toEqual(literal('auto'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps one typing focus session in one history entry and starts from an unset display', () => {
    const document = make();
    const view = render(<Workbench document={document} />);
    showStyle();
    const control = screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement;
    expect(control.value).toBe('');
    expect(selected(document).style).toEqual(headerStyle);
    fireEvent.focus(control);
    changeControl(control, '1');
    changeControl(control, '12');
    changeControl(control, '12p');
    changeControl(control, '12px');
    fireEvent.blur(control);
    expect(view.container.querySelector<HTMLElement>('.material-text')!.style.width).toBe(
      '12px',
    );
    act(() => document.undo());
    expect(selected(document).style).toEqual(headerStyle);
    expect(document.getSnapshot().canUndo).toBe(false);
    act(() => document.redo());
    expect(selected(document).style?.width).toEqual(literal('12px'));
  });

  it('resets a declaration, group and all declarations atomically and clears the matching drafts', () => {
    const document = make();
    document.setStyle('purchase', 'purchase-heading', {
      width: literal(120),
      height: literal(40),
      marginLeft: literal(3),
    });
    render(<Workbench document={document} />);
    showStyle();
    changeControl(screen.getByRole('textbox', { name: '宽度' }), 'bad-unit');
    fireEvent.click(screen.getByRole('button', { name: '恢复宽度' }));
    expect(selected(document).style).toEqual({
      ...headerStyle,
      height: literal(40),
      marginLeft: literal(3),
    });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => document.undo());
    expect((screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement).value).toBe('120');
    changeControl(screen.getByRole('textbox', { name: '高度' }), 'bad-height');
    fireEvent.click(screen.getByRole('button', { name: '恢复尺寸分组' }));
    expect(selected(document).style).toEqual({ ...headerStyle, marginLeft: literal(3) });
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => document.undo());
    expect(selected(document).style).toEqual({
      ...headerStyle,
      width: literal(120),
      height: literal(40),
      marginLeft: literal(3),
    });
    expect((screen.getByRole('textbox', { name: '高度' }) as HTMLInputElement).value).toBe('40');
    changeControl(screen.getByRole('textbox', { name: '宽度' }), 'bad-width');
    fireEvent.click(screen.getByRole('button', { name: '恢复全部样式' }));
    expect(selected(document).style).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => document.undo());
    expect(selected(document).style).toEqual({
      ...headerStyle,
      width: literal(120),
      height: literal(40),
      marginLeft: literal(3),
    });
    expect((screen.getByRole('textbox', { name: '宽度' }) as HTMLInputElement).value).toBe('120');
  });

  it('stages bindings explicitly and updates runtime style from state/expression bindings', () => {
    const document = make();
    document.createState('purchase', { id: 'appearanceWidth', type: 'number', initial: 180 });
    document.setStyle('purchase', 'purchase-heading', { width: literal(120) });
    let currentRuntime!: PageRuntime;
    const view = render(
      <Workbench
        document={document}
        onRuntime={(runtime) => {
          currentRuntime = runtime;
        }}
      />,
    );
    showStyle();
    fireEvent.click(screen.getByRole('button', { name: '宽度绑定设置' }));
    changeControl(screen.getByLabelText('宽度绑定取值方式'), 'stateRef');
    changeControl(screen.getByLabelText('宽度绑定页面状态'), 'appearanceWidth');
    expect(selected(document).style?.width).toEqual(literal(120));
    fireEvent.click(screen.getByRole('button', { name: '应用绑定' }));
    expect(selected(document).style?.width).toEqual({
      kind: 'stateRef',
      stateId: 'appearanceWidth',
    });
    expect(view.container.querySelector<HTMLElement>('.material-text')!.style.width).toBe(
      '180px',
    );
    act(() => currentRuntime.setState('appearanceWidth', 220));
    expect(view.container.querySelector<HTMLElement>('.material-text')!.style.width).toBe(
      '220px',
    );
    changeControl(screen.getByLabelText('宽度绑定取值方式'), 'expression');
    changeControl(screen.getByRole('textbox', { name: '宽度绑定' }), 'state.appearanceWidth + 10');
    expect(selected(document).style?.width?.kind).toBe('stateRef');
    fireEvent.click(screen.getByRole('button', { name: '应用绑定' }));
    expect(view.container.querySelector<HTMLElement>('.material-text')!.style.width).toBe(
      '190px',
    );
    const accepted = document.getSnapshot();
    changeControl(screen.getByRole('textbox', { name: '宽度绑定' }), 'state.');
    fireEvent.click(screen.getByRole('button', { name: '应用绑定' }));
    expect(document.getSnapshot()).toBe(accepted);
    expect(view.container.querySelector<HTMLElement>('.material-text')!.style.width).toBe(
      '190px',
    );
  });

  it('filters controls by the material capability instead of listing all supported global keys', () => {
    const document = make();
    document.select('purchase', 'purchase-form');
    render(<Workbench document={document} />);
    showStyle();
    fireEvent.click(screen.getByRole('button', { name: '文字与背景' }));
    expect(screen.queryByRole('textbox', { name: '文字颜色' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '字号' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '背景颜色' })).toBeTruthy();
  });

  it.each(['selection', 'binding'] as const)(
    'rejects retained style setter callbacks after a %s change',
    (change) => {
      const document = make();
      let captured: ReactSetterProps | undefined;
      const setters = createSetterRegistry({
        'style.value': function CapturingStyleSetter(props: ReactSetterProps) {
          if (props.options.property === 'width') captured = props;
          return (
            <input
              id={props.id}
              aria-label={props.label}
              value={String(props.value ?? '')}
              onChange={() => {}}
            />
          );
        },
      });
      render(<Workbench document={document} setters={setters} />);
      showStyle();
      const previous = captured!;
      if (change === 'selection') act(() => document.select('purchase', 'purchase-name'));
      else
        act(() =>
          document.setStyle('purchase', 'purchase-heading', {
            width: { kind: 'expression', language: 'javascript', source: '200' },
          }),
        );
      const before = document.getSnapshot();
      let accepted: boolean | undefined, reset: boolean | undefined;
      act(() => {
        accepted = previous.onChange(321);
        reset = previous.onReset();
        previous.onDraftChange('late draft');
        previous.onError('late error');
      });
      expect({ accepted, reset }).toEqual({ accepted: false, reset: false });
      expect(document.getSnapshot()).toBe(before);
      if (change === 'selection') {
        act(() => document.select('purchase', 'purchase-heading'));
        showStyle();
        expect(screen.queryByText('late error')).toBeNull();
      }
    },
  );
});
