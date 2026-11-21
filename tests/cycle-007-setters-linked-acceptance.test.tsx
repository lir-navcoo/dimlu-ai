import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { EditorDocument, findNode } from '../packages/editor/document';
import type { MaterialCatalog } from '../packages/editor/metadata';
import type { Json, Value } from '../packages/schema/types';
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

afterEach(cleanup);

function Inspector({
  document,
  metadata,
}: {
  document: EditorDocument;
  metadata: MaterialCatalog;
}) {
  const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot);
  return <PropertyPanel document={document} snapshot={snapshot} materialCatalog={metadata} />;
}

describe('cycle 007 linked-property stale callback acceptance', () => {
  for (const component of ['ui.select', 'ui.date'] as const) {
    for (const operation of ['change', 'reset'] as const) {
      it(`preserves a new dynamic value when retained ${component} ${operation} executes`, () => {
        const document = new EditorDocument(exampleApplication, registry);
        const name = component === 'ui.select' ? 'multiple' : 'range';
        const initiallyMultiple = operation === 'reset';
        const props: Record<string, Value> = Object.fromEntries(
          Object.entries(catalog[component].defaultProps).map(([key, value]) => [
            key,
            { kind: 'literal', value: structuredClone(value) },
          ]),
        );
        const previousValue: Json =
          component === 'ui.select'
            ? initiallyMultiple
              ? ['option1']
              : 'option1'
            : initiallyMultiple
              ? ['2026-01-01', '2026-01-02']
              : '2026-01-01';
        props[name] = { kind: 'literal', value: initiallyMultiple };
        props.value = { kind: 'literal', value: previousValue };
        const nodeId = document.insertNode('purchase', { component, props });
        const metadata = structuredClone(catalog);
        metadata[component].properties.find((property) => property.name === name)!.setter = {
          kind: 'custom',
          id: 'acceptance.linked',
        };
        let captured: ReactSetterProps | undefined;
        const setters = createSetterRegistry({
          'acceptance.linked': function LinkedSetter(setterProps: ReactSetterProps) {
            captured = setterProps;
            return <span>关联属性设置器</span>;
          },
        });
        render(
          <SetterRegistryProvider registry={setters}>
            <EditorSessionProvider>
              <Inspector document={document} metadata={metadata} />
            </EditorSessionProvider>
          </SetterRegistryProvider>,
        );
        const retained = captured!;
        const nextValue = component === 'ui.select' ? 'option2' : '2026-02-02';
        const dynamic: Value = {
          kind: 'expression',
          language: 'javascript',
          source: JSON.stringify(
            initiallyMultiple
              ? component === 'ui.select'
                ? [nextValue]
                : [nextValue, '2026-02-03']
              : nextValue,
          ),
        };
        act(() => document.setProp('purchase', nodeId, 'value', dynamic));
        const before = document.getSnapshot();
        let accepted: boolean | undefined;
        act(() => {
          accepted = operation === 'reset' ? retained.onReset() : retained.onChange(true);
        });
        const actual = findNode(
          document.getSnapshot().plan.pages.get('purchase')!.schema,
          nodeId,
        )!.node;
        expect({ accepted, value: actual.props.value }).toEqual({
          accepted: false,
          value: dynamic,
        });
        expect(document.getSnapshot()).toBe(before);
      });
    }
  }
});
