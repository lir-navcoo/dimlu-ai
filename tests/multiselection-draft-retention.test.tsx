import { type ComponentProps, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument, findNode } from '../packages/editor/document';
import { ActionPanel } from '../src/editor/ActionPanel';
import { ComponentTree } from '../src/editor/ComponentTree';
import { DragDropProvider } from '../src/editor/DragDrop';
import { FormPanel } from '../src/editor/FormPanel';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { EditorSessionProvider, useEditorSession } from '../src/editor/session';
import { TipProvider } from '../src/ui/primitives';
import { changeControl, closeActionConfig, openActionConfig } from './ui-helpers';
import { lit, selectionApplication, selectionRegistry } from './multiselection-fixture';

const held = vi.hoisted(() => ({ saves: new Map<string, () => void>() }));
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      if (typeof props.children === 'string' && props.onClick)
        held.saves.set(props.children, props.onClick as () => void);
      return <actual.Button {...props} />;
    },
  };
});
beforeEach(() => held.saves.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Session = ReturnType<typeof useEditorSession>;
type ActionHost = 'event' | 'page';
function setupAction(kind: ActionHost) {
  const schema = selectionApplication();
  schema.dependencies.components['ui.button'] = '1.0.0';
  schema.pages[0].children.push({
    id: 'action-node',
    component: 'ui.button',
    props: { label: lit('Action') },
    on: {
      onClick: [
        {
          id: 'event-action',
          action: 'state.set',
          input: { stateId: lit('caption'), value: lit('saved') },
        },
      ],
    },
  });
  const document = new EditorDocument(schema, selectionRegistry());
  document.select('a', 'action-node');
  const snapshot = document.getSnapshot();
  let session!: Session;
  function Host() {
    session = useEditorSession();
    return kind === 'event' ? (
      <ActionPanel
        document={document}
        snapshot={snapshot}
        node={findNode(snapshot.plan.pages.get('a')!.schema, 'action-node')!.node}
      />
    ) : (
      <PageLifecyclePanel document={document} snapshot={snapshot} authoringAllowed />
    );
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Host />
      </TipProvider>
    </EditorSessionProvider>,
  );
  const key = kind === 'event' ? 'event:a/action-node/onClick' : 'page-enter:a';
  const saveLabel = kind === 'event' ? '保存事件' : '保存进入动作';
  // Action parameters live inside the config dialog; open it for the callers.
  openActionConfig(1);
  return { document, session, view, key, saveLabel };
}

type FieldHost = 'new-form' | 'update-field' | 'new-bound-field';
function setupField(kind: FieldHost, numeric = false) {
  const schema = selectionApplication();
  schema.dependencies.components['ui.form'] = '1.0.0';
  schema.dependencies.components['ui.input'] = '1.0.0';
  schema.pages[0].children.push({
    id: 'form-node',
    component: 'ui.form',
    props: {},
    ...(kind === 'new-bound-field' ? { formId: 'model' } : {}),
    children: [
      { id: 'input-node', component: 'ui.input', props: { label: lit('Input'), value: lit('') } },
    ],
  });
  if (numeric)
    schema.pages[0].forms![0].fields[0] = {
      id: 'name',
      path: ['name'],
      label: 'Amount',
      type: 'number',
      initial: 1,
      rules: [],
    };
  const document = new EditorDocument(schema, selectionRegistry());
  const primary = kind === 'new-form' ? 'form-node' : 'input-node';
  document.select('a', primary);
  const snapshot = document.getSnapshot();
  let session!: Session;
  function Host() {
    session = useEditorSession();
    return (
      <FormPanel
        document={document}
        snapshot={snapshot}
        node={
          kind === 'update-field'
            ? undefined
            : findNode(snapshot.plan.pages.get('a')!.schema, primary)!.node
        }
        mode={kind === 'new-form' ? 'binding' : 'models'}
      />
    );
  }
  const view = render(
    <EditorSessionProvider>
      <TipProvider>
        <Host />
      </TipProvider>
    </EditorSessionProvider>,
  );
  if (kind === 'new-form') {
    fireEvent.click(screen.getByRole('button', { name: '创建表单模型' }));
    changeControl(screen.getByLabelText('新表单 ID'), 'fresh-model');
  } else {
    act(() =>
      session.openData({
        pageId: 'a',
        formId: 'model',
        ...(kind === 'update-field' ? { fieldId: 'name' } : { create: true }),
      }),
    );
  }
  if (kind !== 'update-field') changeControl(screen.getByLabelText('字段 ID'), 'fresh-field');
  const key =
    kind === 'new-form'
      ? 'new-form:a/form-node'
      : kind === 'update-field'
        ? 'field:a/model/name'
        : 'new-field:a/model/input-node';
  const form = screen.getByRole('form', {
    name: kind === 'update-field' ? '字段配置' : '新建字段配置',
  });
  return { document, session, view, primary, key, form };
}

describe('child save refusal retains unapplied drafts', () => {
  it('page source conflict keeps the original diagnostic and unapplied dirty draft', () => {
    const { document, session, key, saveLabel } = setupAction('page');
    changeControl(screen.getByLabelText('value'), '"source conflict draft"');
    closeActionConfig();
    const save = held.saves.get(saveLabel)!;
    const clear = vi.spyOn(session.drafts, 'clear');
    const publish = vi.spyOn(document, 'setPageEnterActions');
    act(() => document.createState('a', { id: 'external', type: 'string', initial: 'changed' }));
    const before = document.getSnapshot();
    act(() => save());
    expect(screen.getByRole('alert').textContent).toContain('页面定义已变化');
    expect(screen.getByText('有未保存草稿')).toBeTruthy();
    openActionConfig(1);
    expect((screen.getByLabelText('value') as HTMLTextAreaElement).value).toBe(
      '"source conflict draft"',
    );
    expect(session.drafts.read(key, '', undefined).dirty).toBe(true);
    expect(clear).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });

  it.each(['event', 'page'] as const)(
    '%s action host rejects synchronous selection change without resetting its dirty draft',
    (kind) => {
      const { document, session, view, key, saveLabel } = setupAction(kind);
      changeControl(screen.getByLabelText('value'), '"unapplied draft"');
      const save = held.saves.get(saveLabel)!;
      const entry = session.drafts.read(key, '', undefined);
      const clear = vi.spyOn(session.drafts, 'clear');
      const publish = vi.spyOn(
        document,
        kind === 'event' ? 'setEventActions' : 'setPageEnterActions',
      );
      const schema = document.exportJson();
      expect(entry.dirty).toBe(true);
      act(() => {
        document.selectMany('a', ['action-node', 'tail'], 'action-node');
        save();
      });
      expect(publish).not.toHaveBeenCalled();
      expect(document.exportJson()).toBe(schema);
      expect(clear).not.toHaveBeenCalled();
      expect(session.drafts.read(key, '', undefined)).toBe(entry);
      expect((screen.getByLabelText('value') as HTMLTextAreaElement).value).toBe(
        '"unapplied draft"',
      );
      expect(screen.getByText('有未保存草稿')).toBeTruthy();
      view.unmount();
      act(() => save());
      expect(clear).not.toHaveBeenCalled();
      expect(session.drafts.read(key, '', undefined)).toBe(entry);
    },
  );

  it.each(['event', 'page'] as const)(
    '%s action host clears a legitimate semantically unchanged save returning false',
    (kind) => {
      const { document, session, key, saveLabel } = setupAction(kind);
      const value = kind === 'event' ? 'saved' : 'entered';
      changeControl(screen.getByLabelText('value'), `  "${value}"  `);
      expect(session.drafts.read(key, '', undefined).dirty).toBe(true);
      const clear = vi.spyOn(session.drafts, 'clear');
      const publish = vi.spyOn(
        document,
        kind === 'event' ? 'setEventActions' : 'setPageEnterActions',
      );
      const before = document.getSnapshot();
      closeActionConfig();
      fireEvent.click(screen.getByRole('button', { name: saveLabel }));
      expect(publish).toHaveBeenCalledOnce();
      expect(publish.mock.results[0].value).toBe(false);
      expect(document.getSnapshot()).toBe(before);
      expect(clear).toHaveBeenCalledWith(key);
      expect(screen.queryByText('有未保存草稿')).toBeNull();
    },
  );

  it.each(['new-form', 'update-field', 'new-bound-field'] as const)(
    '%s field host refuses before validation, publication, success feedback or draft reset',
    (kind) => {
      const { document, session, key, primary, form } = setupField(kind);
      changeControl(screen.getByLabelText('字段名称'), 'Unapplied field draft');
      const entry = session.drafts.read(key, '', undefined);
      const clear = vi.spyOn(session.drafts, 'clear');
      const publish = vi.spyOn(
        document,
        kind === 'new-form'
          ? 'createForm'
          : kind === 'update-field'
            ? 'updateField'
            : 'createField',
      );
      const schema = document.exportJson();
      expect(entry.dirty).toBe(true);
      act(() => {
        document.selectMany('a', [primary, 'tail'], primary);
        fireEvent.submit(form);
      });
      expect(publish).not.toHaveBeenCalled();
      expect(document.exportJson()).toBe(schema);
      expect(clear).not.toHaveBeenCalled();
      expect(session.drafts.read(key, '', undefined)).toBe(entry);
      expect((screen.getByLabelText('字段名称') as HTMLInputElement).value).toBe(
        'Unapplied field draft',
      );
      expect(screen.getByText('有未保存草稿')).toBeTruthy();
      expect(screen.queryByText('配置已应用')).toBeNull();
    },
  );

  it('existing field host clears dirty numeric spelling on a legitimate no-op command', () => {
    const { document, session, key, form } = setupField('update-field', true);
    changeControl(screen.getByLabelText('字段默认值'), '1.0');
    expect(session.drafts.read(key, '', undefined).dirty).toBe(true);
    const before = document.getSnapshot();
    const publish = vi.spyOn(document, 'updateField');
    const clear = vi.spyOn(session.drafts, 'clear');
    fireEvent.submit(form);
    expect(publish).toHaveBeenCalledOnce();
    expect(publish.mock.results[0].value).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    expect(clear).toHaveBeenCalledWith(key);
    expect(screen.queryByText('有未保存草稿')).toBeNull();
    expect(screen.getByText('配置已应用')).toBeTruthy();
  });
});

describe('tree read-only navigation stays distinct from multi authoring', () => {
  it.each(['preview', 'code'] as const)(
    '%s permits plain single selection while refusing modifier toggles and drag handles',
    (mode) => {
      const schema = selectionApplication();
      if (mode === 'code') schema.pages[0].code!.enabled = true;
      const document = new EditorDocument(schema, selectionRegistry());
      document.select('a', 'alpha');
      function Host() {
        const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
        return (
          <DragDropProvider
            document={document}
            snapshot={snapshot}
            enabled={mode !== 'preview' && !snapshot.plan.pages.get('a')!.schema.code?.enabled}
          >
            <ComponentTree document={document} snapshot={snapshot} />
          </DragDropProvider>
        );
      }
      render(
        <EditorSessionProvider>
          <TipProvider>
            <Host />
          </TipProvider>
        </EditorSessionProvider>,
      );
      const tail = screen.getByRole('button', { name: '选中 文本 tail' });
      expect((tail as HTMLButtonElement).disabled).toBe(false);
      const before = document.getSnapshot();
      fireEvent.click(tail, { ctrlKey: true });
      fireEvent.keyDown(tail, { key: ' ', metaKey: true });
      expect(document.getSnapshot()).toBe(before);
      fireEvent.click(tail);
      expect(document.getSnapshot().selection).toEqual({ pageId: 'a', nodeId: 'tail' });
      expect(
        (screen.getByRole('button', { name: '拖动 文本 tail' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    },
  );
});
