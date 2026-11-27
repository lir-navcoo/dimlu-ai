import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { registry, materials } from '../src/materials';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer } from '../packages/react-runtime/Renderer';
import type { ApplicationSchema, Json, Value } from '../packages/schema/types';

afterEach(cleanup);
const lit = (value: Json): Value => ({ kind: 'literal', value });
const expr = (source: string): Value => ({ kind: 'expression', language: 'javascript', source });

describe('layout click events', () => {
  it('declares onClick in the contract and dispatches clicks to the action chain', () => {
    const app: ApplicationSchema = {
      schemaVersion: '0.1.0',
      id: 'layout-click',
      title: 'LayoutClick',
      entryPageId: 'page',
      dependencies: {
        components: { 'ui.layout': '1.0.0', 'ui.text': '1.0.0' },
        actions: { 'state.set': '1.0.0' },
      },
      pages: [
        {
          id: 'page',
          title: 'LayoutClick',
          state: [{ id: 'clicks', type: 'number', initial: 0 }],
          children: [
            {
              id: 'clickable',
              component: 'ui.layout',
              props: { variant: lit('stack') },
              on: {
                onClick: [
                  {
                    id: 'count-click',
                    action: 'state.set',
                    input: {
                      stateId: lit('clicks'),
                      value: expr('state.clicks + 1'),
                    },
                  },
                ],
              },
              children: [
              { id: 'inner', component: 'ui.text', props: { value: lit('内部文本') } },
              {
                id: 'counter',
                component: 'ui.text',
                props: { value: expr('String(state.clicks)') },
              },
            ],
            },
          ],
        },
      ],
    };
    const runtime = new PageRuntime(compileApplication(app, registry), 'page');
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    const layout = document.body.querySelector('.material-layout') as HTMLElement;
    expect(layout).toBeTruthy();
    // Runtime: clicking the container runs its action chain.
    fireEvent.click(layout);
    expect(screen.getByText('1')).toBeTruthy();
    // A click on a child bubbles to the container handler as a normal DOM event.
    fireEvent.click(screen.getByText('内部文本'));
    expect(screen.getByText('2')).toBeTruthy();
    runtime.dispose();
  });
});
