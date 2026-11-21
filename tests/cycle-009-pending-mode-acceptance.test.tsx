import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import { PropertyPanel } from '../src/editor/Editor';
import { EditorSessionProvider } from '../src/editor/session';
import {
  createSetterRegistry,
  SetterRegistryProvider,
  type ReactSetterProps,
} from '../src/editor/Setters';
import { catalog } from '../src/editor/catalog';
import { exampleApplication } from '../src/examples';
import { registry } from '../src/materials';
import { changeControl } from './ui-helpers';

afterEach(cleanup);

describe('cycle 009 pending expression mode callback acceptance', () => {
  it.each(['change', 'reset'] as const)(
    'keeps an uncommitted expression draft when old literal %s fires',
    (operation) => {
      const document = new EditorDocument(exampleApplication, registry);
      const metadata = structuredClone(catalog);
      metadata['ui.heading'].properties.find((property) => property.name === 'title')!.setter = {
        kind: 'custom',
        id: 'acceptance.pending',
      };
      let captured: ReactSetterProps | undefined;
      const setters = createSetterRegistry({
        'acceptance.pending': function NativeLiteralSetter(props: ReactSetterProps) {
          captured = props;
          return <input id={props.id} value={String(props.value ?? '')} onChange={() => {}} />;
        },
      });
      function Inspector() {
        const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
        return <PropertyPanel document={document} snapshot={snapshot} materialCatalog={metadata} />;
      }
      render(
        <SetterRegistryProvider registry={setters}>
          <EditorSessionProvider>
            <Inspector />
          </EditorSessionProvider>
        </SetterRegistryProvider>,
      );
      const previous = captured!;
      changeControl(screen.getByLabelText('标题绑定方式'), 'expression');
      changeControl(screen.getByRole('textbox', { name: '标题' }), 'state.');
      const before = document.getSnapshot();
      let accepted: boolean | undefined;
      act(() => {
        accepted = operation === 'change' ? previous.onChange('迟到旧固定值') : previous.onReset();
      });
      const title = findNode(
        document.getSnapshot().plan.pages.get('purchase')!.schema,
        'purchase-heading',
      )!.node.props.title;
      expect({ accepted, title }).toEqual({
        accepted: false,
        title: { kind: 'literal', value: '创建采购申请' },
      });
      expect(document.getSnapshot()).toBe(before);
      expect(screen.getByLabelText('标题绑定方式').getAttribute('data-value')).toBe('expression');
      expect((screen.getByRole('textbox', { name: '标题' }) as HTMLTextAreaElement).value).toBe(
        'state.',
      );
    },
  );
});
