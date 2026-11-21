import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { compileApplication, PageRuntime } from '../packages/runtime/engine';
import { RuntimeRenderer, useDataSource } from '../packages/react-runtime/Renderer';
import { registry, materials } from '../src/materials';
import { dataSourceExample } from '../src/data-source-example';
afterEach(cleanup);
describe('data source React integration', () => {
  it('renders the mock query through dataRef and sources bindings only after preview activation', async () => {
    const runtime = new PageRuntime(compileApplication(dataSourceExample, registry), 'query', {
      designMode: true,
    });
    render(<RuntimeRenderer runtime={runtime} materials={materials} />);
    await runtime.enter();
    expect(runtime.getDataSource('people').getSnapshot().status).toBe('idle');
    expect(screen.queryByText('林知远')).toBeNull();
    act(() => runtime.setDesignMode(false));
    expect(runtime.getDataSource('people').getSnapshot().loading).toBe(true);
    await waitFor(() => expect(screen.getByText('林知远')).toBeTruthy());
    const data = runtime.getDataSource('people').getSnapshot().data;
    act(() => runtime.setDesignMode(true));
    act(() => runtime.setDesignMode(false));
    expect(runtime.getDataSource('people').getSnapshot().data).toBe(data);
    expect(runtime.getDataSource('people').getSnapshot().loading).toBe(false);
    runtime.dispose();
  });
  it('subscribes a native hook consumer to its source store', async () => {
    const schema = structuredClone(dataSourceExample);
    delete schema.pages[0].onEnter;
    schema.dependencies.components['react.sourceStatus'] = '1.0.0';
    schema.pages[0].children = [{ id: 'status', component: 'react.sourceStatus', props: {} }];
    const host = {
      ...registry,
      components: { ...registry.components, 'react.sourceStatus': { version: '1.0.0', props: {} } },
    };
    const runtime = new PageRuntime(compileApplication(schema, host), 'query');
    function Status() {
      const source = useDataSource('people');
      return <output>{source.status}</output>;
    }
    render(<RuntimeRenderer runtime={runtime} materials={{ 'react.sourceStatus': Status }} />);
    expect(screen.getByText('idle')).toBeTruthy();
    let pending: Promise<unknown>;
    act(() => {
      pending = runtime.getDataSource('people').refresh();
    });
    expect(screen.getByText('loading')).toBeTruthy();
    await act(async () => {
      await pending;
    });
    expect(screen.getByText('success')).toBeTruthy();
    runtime.dispose();
  });
});
