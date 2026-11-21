import type { ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorDocument } from '../packages/editor/document';
import type { ApplicationSchema } from '../packages/schema/types';
import { PageLifecyclePanel } from '../src/editor/PageLifecyclePanel';
import { EditorSessionProvider } from '../src/editor/session';
import { registry } from '../src/materials';
import { TipProvider } from '../src/ui/primitives';
import { changeControl } from './ui-helpers';

const retained = vi.hoisted(() => ({ save: undefined as undefined | ((event: unknown) => void) }));
vi.mock('../src/ui/primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/primitives')>();
  return {
    ...actual,
    // Preserve the actual Base UI button. Capture its callback solely to model
    // an already retained host callback, bypassing native disabled event suppression.
    Button: (props: ComponentProps<typeof actual.Button>) => {
      if (props.children === '保存进入动作')
        retained.save = props.onClick as (event: unknown) => void;
      return <actual.Button {...props} />;
    },
  };
});

beforeEach(() => {
  retained.save = undefined;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setup() {
  const schema: ApplicationSchema = {
    schemaVersion: '0.1.0',
    id: 'retained-entry-callback',
    title: '进入动作保留回调',
    entryPageId: 'a',
    dependencies: { components: {}, actions: {} },
    pages: ['a', 'b'].map((id) => ({ id, title: id, state: [], children: [] })),
  };
  const document = new EditorDocument(schema, registry);
  const tree = (allowed: boolean) => (
    <EditorSessionProvider>
      <TipProvider>
        <PageLifecyclePanel
          document={document}
          snapshot={document.getSnapshot()}
          authoringAllowed={allowed}
        />
      </TipProvider>
    </EditorSessionProvider>
  );
  const view = render(tree(true));
  fireEvent.click(screen.getByRole('button', { name: '添加动作' }));
  changeControl(screen.getByLabelText('动作 1 类型'), 'ui.notify');
  changeControl(screen.getByLabelText('title取值方式'), 'literal');
  changeControl(screen.getByRole('textbox', { name: 'title' }), '原页面草稿');
  const save = retained.save!;
  expect(save).toBeTypeOf('function');
  return { document, tree, view, save };
}

describe('retained page-entry save callbacks', () => {
  it('cannot publish through a callback captured while edit permission was allowed', () => {
    const { document, tree, view, save } = setup();
    const publish = vi.spyOn(document, 'setPageEnterActions');
    const before = document.getSnapshot();
    view.rerender(tree(false));
    act(() => save({}));
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });

  it('cannot publish after its authoring host unmounts', () => {
    const { document, view, save } = setup();
    const publish = vi.spyOn(document, 'setPageEnterActions');
    const before = document.getSnapshot();
    view.unmount();
    act(() => save({}));
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });

  it('cannot send the previous page draft into the newly selected page', () => {
    const { document, tree, view, save } = setup();
    document.select('b', null);
    view.rerender(tree(true));
    const publish = vi.spyOn(document, 'setPageEnterActions');
    const before = document.getSnapshot();
    act(() => save({}));
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
    expect(before.plan.schema.pages.every((page) => !page.onEnter)).toBe(true);
  });

  it('rejects a changed live page even before the authoring host receives a new snapshot', () => {
    const { document, save } = setup();
    // The host deliberately retains its prior snapshot to model an external update
    // before React receives that publication. The document is the authoritative base.
    document.createState('a', { id: 'external', type: 'string', initial: 'changed' });
    const publish = vi.spyOn(document, 'setPageEnterActions');
    const before = document.getSnapshot();
    act(() => save({}));
    expect(publish).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
    expect(screen.getByRole('alert').textContent).toContain('页面定义已变化');
  });
});
